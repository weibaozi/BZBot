import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { nullLogger } from 'cortico/core/util.ts';
import { createResponse } from 'cortico/protocol/open-responses/index.ts';
import { CodexClient, readImageStream } from '../server/client.ts';
import { issuer } from './fixtures.ts';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5mQAAAAASUVORK5CYII=';
it('retains completed image items across split CRLF stream boundaries', async () => {
  const frames = [{ type: 'response.output_item.done', item: { type: 'image_generation_call', id: 'image', status: 'completed', result: png } }, { type: 'response.completed', response: { status: 'completed', output: [] } }];
  const bytes = new TextEncoder().encode(frames.map(frame => `data: ${JSON.stringify(frame)}\r\n\r\n`).join(''));
  const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  expect((await readImageStream(new Response(stream))).images[0].mime).toBe('image/png');
});
it('uses independent OAuth for real HTTP chat and image requests and keeps controller/image model distinct', async () => {
  const local = await issuer(); await fetch((await local.auth.begin()).url);
  const seen: Array<Record<string, any>> = [];
  const server = createServer((req, res) => { void (async () => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); seen.push(body);
    expect(req.headers['chatgpt-account-id']).toBe('local-account'); expect(req.headers.authorization).toMatch(/^Bearer local-access/);
    const response = { ...createResponse('local', { model: body.model }), status: 'completed',
      output: body.tools?.[0]?.type === 'image_generation' ? [{ type: 'image_generation_call', id: 'picture', status: 'completed', result: png }] : [] };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ type: 'response.created', sequence_number: 0, response: { ...response, status: 'in_progress', output: [] } })}\n\ndata: ${JSON.stringify({ type: 'response.completed', sequence_number: 1, response })}\n\n`);
  })().catch(() => res.writeHead(500).end()); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new CodexClient(local.auth, { stateDir: local.dir, secret: () => '', readBlob: () => null, keepThinking: () => true, log: nullLogger() },
    () => true, () => 'controller-model', `http://127.0.0.1:${(server.address() as { port: number }).port}`);
  try {
    expect((await client.respond({ model: 'chat-model', input: [], temperature: .6, max_output_tokens: 100 }, { sessionId: 'main' })).response.status).toBe('completed');
    expect(seen[0]).toMatchObject({ stream: true, store: false }); expect(seen[0]).not.toHaveProperty('temperature');
    const images = await client.generateImage({ model: 'image-model', prompt: 'A blue circle', controllerModel: 'selected-text-model' });
    expect(images.images[0].mime).toBe('image/png'); expect(images.images[0].bytes.length).toBeGreaterThan(40);
    expect(seen[1]).toMatchObject({ model: 'selected-text-model', tools: [{ type: 'image_generation', model: 'image-model', action: 'generate' }], tool_choice: { type: 'image_generation' } });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

it.each([
  [{ type: 'response.output_item.done', item: { type: 'image_generation_call', id: 'x', status: 'completed', result: png } }],
  [{ type: 'response.completed', response: { status: 'completed', output: [] } }],
  [{ type: 'response.failed' }],
  [{ type: 'response.completed', response: { status: 'completed', output: [{ type: 'image_generation_call', status: 'completed', result: 'bad' }] } }],
])('rejects unfinished, empty or invalid image streams %#', async (...frames) => {
  const response = new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''));
  await expect(readImageStream(response)).rejects.toThrow();
});
