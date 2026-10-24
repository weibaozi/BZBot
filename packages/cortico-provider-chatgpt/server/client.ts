import { createHash } from 'node:crypto';
import { BaseProvider, type ListedModel, type ProviderHost } from 'cortico/providers/base.ts';
import { ResponsesProvider } from 'cortico/providers/openai-responses-compat/native.ts';
import type { GenerateOptions, Generation } from 'cortico/core/generation.ts';
import type { Request } from 'cortico/protocol/open-responses/index.ts';
import { ChatGptAuth, RESOURCE } from './auth.ts';
import { NativeResponseAssembly } from 'cortico/providers/transport/response-assembly.ts';
import type { StreamEvent } from 'cortico/protocol/open-responses/index.ts';
import { ResponseProtocolError } from 'cortico/protocol/open-responses/stream.ts';

/** Subscription metadata is out of band; output and terminal events remain strictly validated. */
export class PlanResponseAssembly extends NativeResponseAssembly {
  private readonly completedItems = new Set<string>();
  override feed(payload: unknown, emit: (event: StreamEvent) => void) {
    if (payload && typeof payload === 'object' && 'type' in payload && payload.type === 'response.metadata') return;
    const event = payload as StreamEvent;
    if (event && ['response.completed', 'response.incomplete', 'response.failed'].includes(event.type) && 'response' in event
      && Array.isArray(event.response?.output) && event.response.output.length === 0) {
      // Plan inference can deliver all output through item events and leave terminal output empty.
      const streamed = this.snapshot()?.output ?? [];
      if (event.type === 'response.completed' && streamed.some(item => !this.completedItems.has(item.id)))
        throw new ResponseProtocolError('ChatGPT completed before all streamed items finished');
      payload = { ...event, response: { ...event.response, output: streamed } };
    }
    super.feed(payload, emit);
    if (event?.type === 'response.output_item.done' && event.item) this.completedItems.add(event.item.id);
  }
}

const UNSUPPORTED = ['background', 'conversation', 'max_output_tokens', 'max_tool_calls', 'metadata', 'moderation',
  'multi_agent', 'prompt', 'prompt_cache_retention', 'safety_identifier', 'temperature', 'top_logprobs', 'top_p',
  'truncation', 'user', 'previous_response_id'];

/** ChatGPT plan inference is stateless and streamed, including connectivity probes. */
export class PlanResponses extends ResponsesProvider {
  protected override responseAssembly() { return new PlanResponseAssembly(); }
  protected override buildResponseBody(request: Request, options: GenerateOptions): Record<string, unknown> {
    const body = super.buildResponseBody(request, options);
    for (const field of UNSUPPORTED) delete body[field];
    body.store = false; body.stream = true;
    const tools = body.tools as Array<Record<string, unknown>> | undefined;
    if (tools?.length) {
      if (tools.some(tool => tool.type !== 'function' && tool.type !== 'custom')) throw new Error('ChatGPT provider supports local function/custom tools only');
      body.tools = [{ type: 'namespace', name: 'mybot', description: 'Tools provided by myBot', tools }];
    }
    body.input = (body.input as Array<Record<string, unknown>>).map(item =>
      item.type === 'function_call' || item.type === 'custom_tool_call' ? { ...item, namespace: 'mybot' } : item);
    return body;
  }
  override respond(request: Request, options: GenerateOptions = {}): Promise<Generation> {
    return super.respond(request, { ...options, onEvent: options.onEvent ?? (() => {}) });
  }
}

/**
 * The plan endpoint reuses cached prompt prefixes only for requests carrying a `session_id` header; with
 * `prompt_cache_key` alone every request missed in measurement, and it rejects explicit cache breakpoints.
 * The id is a UUID derived from the provider directory and the session, so it holds across restarts.
 */
export function planSessionHeaders(stateDir: string, sessionId: string | undefined): Record<string, string> {
  if (!sessionId) return {};
  const hex = createHash('sha256').update(`${stateDir}\0${sessionId}`).digest('hex');
  return { session_id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}` };
}

export class ChatGptClient extends BaseProvider {
  constructor(private auth: ChatGptAuth, private host: ProviderHost, private images: () => boolean) { super(); }
  async respond(request: Request, options: GenerateOptions = {}) {
    if (!request.model || request.model === '__login_required__') throw new Error('Select a model after signing in with ChatGPT');
    const signal = options.signal ? AbortSignal.any([options.signal, this.auth.signal]) : this.auth.signal;
    const client = new PlanResponses({ baseUrl: RESOURCE, apiKey: await this.auth.accessToken(), log: this.host.log,
      extraHeaders: planSessionHeaders(this.host.stateDir, options.sessionId),
      media: { enabled: this.images, read: this.host.readBlob }, keepThinking: this.host.keepThinking });
    signal.throwIfAborted();
    return client.respond(request, { ...options, signal });
  }
}

export async function listPlanModels(auth: ChatGptAuth): Promise<ListedModel[]> {
  const response = await fetch(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${await auth.accessToken()}` },
    signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!response.ok) throw new Error(`ChatGPT model list failed (HTTP ${response.status})`);
  const body = await response.json() as { models?: Array<{ visibility?: string; slug?: string; display_name?: string }> };
  if (!Array.isArray(body.models)) throw new Error('ChatGPT returned no model catalog');
  return body.models.filter(row => row.visibility === 'list' && typeof row.slug === 'string').map(row => ({
    id: row.slug!, displayName: row.display_name,
  }));
}
