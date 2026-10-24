import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { generateHttp } from '../server/models.ts';
import { PNG } from './helpers.ts';

it('caption HTTP requests use JSON data and image content without forcing model temperature', async () => {
  const requests: Array<Record<string, any>> = [];
  let invalid = false;
  const server = createServer(async (req, res) => {
    expect(req.url).toBe('/v1/chat/completions');
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: invalid ? 'not-json' : '```json\n{"query":"抱抱"}\n```' } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number }; const options = { url: `http://127.0.0.1:${address.port}/v1`, model: 'fixture-model', key: '', timeoutSeconds: 5 };
    expect(await generateHttp({ instruction: 'Task', data: { reply: 'Reply' }, image: { bytes: PNG, mime: 'image/png' } }, options)).toEqual({ query: '抱抱' });
    expect(requests[0].temperature).toBeUndefined();
    expect(requests[0].messages[0]).toEqual({ role: 'system', content: 'Task' });
    expect(requests[0].messages[1].content[1].image_url.url).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    invalid = true; await expect(generateHttp({ instruction: 'Task', data: {} }, options)).rejects.toThrow('valid JSON');
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});
