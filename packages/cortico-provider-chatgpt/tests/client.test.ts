import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { PlanResponses, PlanResponseAssembly } from '../server/client.ts';
import { createResponse } from 'cortico/protocol/open-responses/index.ts';
import type { Request } from 'cortico/protocol/open-responses/index.ts';

it('uses streaming for probes, omits unsupported settings, preserves history and groups local tools', async () => {
  let received: Record<string, any> = {};
  const request: Request = { model: 'test-model', temperature: 0.4, max_output_tokens: 8192,
    input: [{ type: 'message', role: 'system', content: 'Personality' }, { type: 'message', role: 'user', content: 'Hello' }],
    tools: [{ type: 'function', name: 'send_reply', description: 'Reply', parameters: { type: 'object', properties: {} }, strict: false }] };
  const server = createServer((req, res) => { void (async () => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    received = JSON.parse(raw);
    const response = { ...createResponse('response_local', request), status: 'completed', output: [], usage: { input_tokens: 12, output_tokens: 0, total_tokens: 12 } };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ type: 'response.created', sequence_number: 0, response: { ...response, status: 'in_progress' } })}\n\ndata: ${JSON.stringify({ type: 'response.metadata', sequence_number: 1, response_id: response.id, metadata: {} })}\n\ndata: ${JSON.stringify({ type: 'response.completed', sequence_number: 2, response })}\n\n`);
  })(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = new PlanResponses({ baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` });
    const result = await client.respond(request, { diagnostic: true });
    expect(result.response.status).toBe('completed');
    expect(received).toMatchObject({ stream: true, store: false, instructions: 'Personality' });
    expect(received).not.toHaveProperty('temperature'); expect(received).not.toHaveProperty('max_output_tokens');
    expect(received.input).toHaveLength(1);
    expect(received.tools[0]).toMatchObject({ type: 'namespace', name: 'mybot', tools: [{ name: 'send_reply' }] });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('metadata cannot substitute for completion and unknown content events still fail', () => {
  const assembly = new PlanResponseAssembly();
  assembly.feed({ type: 'response.created', sequence_number: 0, response: createResponse('local', { model: 'test-model' }) }, () => {});
  assembly.feed({ type: 'response.metadata', sequence_number: 1, response_id: 'local', metadata: {} }, () => {});
  expect(() => assembly.finish()).toThrow();
  expect(() => assembly.feed({ type: 'response.unknown_content', sequence_number: 2 }, () => {})).toThrow('Unknown');
});

it('preserves a fully streamed local tool call when the terminal response omits its output', () => {
  const assembly = new PlanResponseAssembly();
  const response = createResponse('local', { model: 'test-model' });
  const call = { type: 'function_call', id: 'call_item', call_id: 'call_1', name: 'send_reply', namespace: 'mybot', arguments: '', status: 'in_progress' };
  const events = [
    { type: 'response.created', response },
    { type: 'response.output_item.added', output_index: 0, item: call },
    { type: 'response.function_call_arguments.delta', output_index: 0, item_id: call.id, delta: '{}' },
    { type: 'response.function_call_arguments.done', output_index: 0, item_id: call.id, arguments: '{}' },
    { type: 'response.output_item.done', output_index: 0, item: { ...call, arguments: '{}', status: 'completed' } },
    { type: 'response.completed', response: { ...response, status: 'completed', output: [] } },
  ];
  events.forEach((event, sequence_number) => assembly.feed({ ...event, sequence_number }, () => {}));
  expect(assembly.finish().output).toEqual([{ ...call, arguments: '{}', status: 'completed' }]);
});

it('never upgrades an unfinished streamed item to a completed tool call', () => {
  const assembly = new PlanResponseAssembly(); const response = createResponse('local', { model: 'test-model' });
  assembly.feed({ type: 'response.created', sequence_number: 0, response }, () => {});
  assembly.feed({ type: 'response.output_item.added', sequence_number: 1, output_index: 0,
    item: { type: 'function_call', id: 'item', call_id: 'call', name: 'send_reply', arguments: '', status: 'in_progress' } }, () => {});
  expect(() => assembly.feed({ type: 'response.completed', sequence_number: 2, response: { ...response, status: 'completed', output: [] } }, () => {})).toThrow('before all');
});
