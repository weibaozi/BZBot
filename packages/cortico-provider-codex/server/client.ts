import { createHash } from 'node:crypto';
import { BaseProvider, type ProviderHost } from 'cortico/providers/base.ts';
import { ResponsesProvider } from 'cortico/providers/openai-responses-compat/native.ts';
import { NativeResponseAssembly } from 'cortico/providers/transport/response-assembly.ts';
import type { GenerateOptions } from 'cortico/core/generation.ts';
import type { Request, StreamEvent } from 'cortico/protocol/open-responses/index.ts';
import { decodeGeneratedImage, type ImageGenerationRequest, type ImageGenerationResult } from 'cortico/providers/image-generation.ts';
import { CodexAuth, CODEX_BASE_URL } from './auth.ts';

class CodexAssembly extends NativeResponseAssembly {
  override feed(payload: unknown, emit: (event: StreamEvent) => void) {
    if ((payload as { type?: string })?.type === 'response.metadata') return;
    super.feed(payload, emit);
  }
}
export class CodexResponses extends ResponsesProvider {
  protected override responseAssembly() { return new CodexAssembly(); }
  protected override buildResponseBody(request: Request, options: GenerateOptions) {
    const body = super.buildResponseBody(request, options);
    for (const key of ['max_output_tokens', 'temperature', 'top_p', 'truncation', 'previous_response_id']) delete body[key];
    body.instructions ??= ''; body.store = false; body.stream = true;
    return body;
  }
  override respond(request: Request, options: GenerateOptions = {}) { return super.respond(request, { ...options, onEvent: options.onEvent ?? (() => {}) }); }
}
export class CodexClient extends BaseProvider {
  constructor(private auth: CodexAuth, private host: ProviderHost, private images: () => boolean,
    private controllerModel: () => string, private endpoint = CODEX_BASE_URL) { super(); }
  private async headers(signal?: AbortSignal) {
    const c = await this.auth.credentials(signal);
    return { Authorization: `Bearer ${c.accessToken}`, 'chatgpt-account-id': c.accountId,
      'OpenAI-Beta': 'responses=experimental', originator: 'mybot_codex', 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  }
  async respond(request: Request, options: GenerateOptions = {}) {
    const signal = AbortSignal.any([this.auth.signal, ...(options.signal ? [options.signal] : [])]);
    const headers = await this.headers(signal); signal.throwIfAborted();
    if (options.sessionId) Object.assign(headers, { session_id: createHash('sha256').update(`${this.host.stateDir}\0${options.sessionId}`).digest('hex') });
    return new CodexResponses({ baseUrl: this.endpoint, extraHeaders: headers, log: this.host.log,
      media: { enabled: this.images, read: this.host.readBlob }, keepThinking: this.host.keepThinking }).respond(request, { ...options, signal });
  }
  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const signal = AbortSignal.any([this.auth.signal, AbortSignal.timeout((request.timeoutSeconds ?? 180) * 1000), ...(request.signal ? [request.signal] : [])]);
    const headers = await this.headers(signal);
    const response = await fetch(`${this.endpoint}/responses`, { method: 'POST', redirect: 'error', headers, signal,
      body: JSON.stringify({ model: request.controllerModel ?? this.controllerModel(), instructions: 'Generate the requested image using the image generation tool.',
        input: [{ role: 'user', content: [{ type: 'input_text', text: request.prompt }] }],
        tools: [{ type: 'image_generation', action: 'generate', model: request.model, ...(request.size ? { size: request.size } : {}) }],
        tool_choice: { type: 'image_generation' }, store: false, stream: true }) });
    if (!response.ok) throw new Error(`Codex image generation failed (HTTP ${response.status})`);
    return readImageStream(response);
  }
}

/** A completed response is required; partial previews are not reported as finished images. */
export async function readImageStream(response: Response): Promise<ImageGenerationResult> {
  if (!response.body) throw new Error('Codex image response has no body');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', bytes = 0;
  const items = new Map<string, Record<string, unknown>>();
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes > 64_000_000) throw new Error('Codex image response exceeds 64 MB');
      pending = (pending + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') continue;
        const event = JSON.parse(data) as { type?: string; item?: Record<string, unknown>; response?: { status?: string; output?: Array<Record<string, unknown>> } };
        if (event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete') throw new Error('Codex did not complete image generation');
        if (event.type === 'response.output_item.done' && event.item?.type === 'image_generation_call' && typeof event.item.id === 'string') items.set(event.item.id, event.item);
        if (event.type === 'response.completed') {
          if (event.response?.status !== 'completed') throw new Error('Codex image response is not completed');
          const output = event.response.output?.length ? event.response.output : [...items.values()];
          const images = output.filter(item => item.type === 'image_generation_call' && item.status === 'completed').map(item => decodeGeneratedImage(item.result));
          if (!images.length || images.length > 4) throw new Error('Codex returned no completed image; this account or model may not support image generation');
          return { images };
        }
      }
    }
    throw new Error('Codex image stream ended before completion');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
