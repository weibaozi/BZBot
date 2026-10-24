import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { embedHttp } from '../server/search.ts';

it('uses an OpenAI compatible embedding endpoint and orders batch results by index', async () => {
  let requestBody: unknown;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requestBody = JSON.parse(Buffer.concat(chunks).toString());
    expect(req.url).toBe('/v1/embeddings');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ index: 1, embedding: [0, 3] }, { index: 0, embedding: [2, 0] }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const output = await embedHttp(['hug', 'happy'], { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, model: 'fixture-model', queryPrefix: '', key: '' });
    expect(output).toEqual([[1, 0], [0, 1]]);
    expect(requestBody).toEqual({ model: 'fixture-model', input: ['hug', 'happy'], encoding_format: 'float' });
  } finally { server.close(); await once(server, 'close'); }
});
it('does not follow embedding redirects', async () => {
  const server = createServer((_req, res) => { res.writeHead(302, { location: 'http://127.0.0.1:1/secret' }); res.end(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    await expect(embedHttp(['hug'], { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, model: 'fixture-model', queryPrefix: '', key: '' })).rejects.toThrow();
  } finally { server.close(); await once(server, 'close'); }
});
