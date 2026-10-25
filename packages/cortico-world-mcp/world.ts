import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { BlobInput, ToolDef, ToolOutcome, World, WorldHost } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import type { WorldContext } from 'cortico/world.ts';
import { allowedTools, mcpConfigGroup, type McpConfigSection } from './config.ts';

const PLAYWRIGHT_CLI = fileURLToPath(new URL('./node_modules/@playwright/mcp/cli.js', import.meta.url));
/** Tools that only look at the page; the rest change it. */
const READ_TOOLS = new Set(['browser_snapshot', 'browser_find', 'browser_take_screenshot', 'browser_wait_for', 'browser_tabs']);

interface McpTool { name: string; description?: string; inputSchema: Record<string, unknown> }
interface McpContent { type: string; text?: string; data?: string; mimeType?: string }

/**
 * Parameters the bridge removes: a `filename` makes Playwright write the result to disk and return only its path,
 * so a screenshot would never reach the model as an image.
 */
const DROPPED_PARAMETERS = ['filename'];

/** The tool's input schema without the dropped parameters. */
export function bridgedSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = { ...(schema.properties as Record<string, unknown> | undefined) };
  for (const name of DROPPED_PARAMETERS) delete properties[name];
  const required = Array.isArray(schema.required) ? schema.required.filter(name => !DROPPED_PARAMETERS.includes(name as string)) : undefined;
  return { ...schema, properties, ...(required ? { required } : {}) };
}

/** Playwright appends the code it ran for developers; it means nothing to the persona and costs tokens. */
const stripGeneratedCode = (text: string) => text.replace(/### Ran Playwright code\n```[a-z]*\n[\s\S]*?```\n?/g, '');

/** An MCP result as a tool outcome: text joined and cut to the limit, images attached as blobs the model can see. */
export function toOutcome(result: Record<string, unknown>, maxTextChars: number): ToolOutcome {
  const parts = (Array.isArray(result.content) ? result.content : []) as McpContent[];
  let text = stripGeneratedCode(parts.filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n')).trim();
  if (text.length > maxTextChars) text = `${text.slice(0, maxTextChars)}\n[cut: ${text.length - maxTextChars} more characters not shown]`;
  const blobs: BlobInput[] = parts.filter(part => part.type === 'image' && typeof part.data === 'string')
    .map((part, index) => ({ bytes: Buffer.from(part.data!, 'base64'), mime: part.mimeType ?? 'image/png', name: `screenshot-${index + 1}`, fallbackText: '[browser screenshot]' }));
  return { text: text || (blobs.length ? '[screenshot attached]' : '[no output]'), ...(blobs.length ? { blobs } : {}), ...(result.isError === true ? { failed: true as const } : {}) };
}

/**
 * Bridges MCP servers into tools. The persona decides every step; the server only carries it out.
 * The browser is Playwright on an installed browser with an in-memory profile, so it is never signed in.
 */
export class McpWorld implements World {
  readonly id = 'mcp';
  private client?: Client;
  private listed: McpTool[] = [];
  constructor(private readonly ctx: WorldContext<McpConfigSection>) {}

  envPromptVars() { return { 'mcp.tools': this.listed.map(tool => tool.name).join(', ') }; }

  async start(_host: WorldHost) {
    const { browser } = this.ctx.cfg;
    const args = [PLAYWRIGHT_CLI, '--browser', browser.channel, '--isolated', '--image-responses', 'allow', '--output-dir', join(this.ctx.dataDir, 'mcp', 'browser')];
    if (browser.headless) args.push('--headless');
    const client = new Client({ name: 'cortico-world-mcp', version: '0.1.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args, stderr: 'ignore' }));
    const allowed = allowedTools(this.ctx.cfg);
    this.listed = ((await client.listTools()).tools as McpTool[]).filter(tool => allowed.has(tool.name));
    this.client = client;
  }

  async stop() {
    const client = this.client;
    this.client = undefined; this.listed = [];
    await client?.close();
  }

  tools(): ToolDef[] {
    return this.listed.map(tool => ({
      name: tool.name,
      description: tool.description ?? tool.name,
      parameters: bridgedSchema(tool.inputSchema),
      tags: [READ_TOOLS.has(tool.name) ? 'read' : 'act'],
      handler: async (args, context) => {
        context.signal?.throwIfAborted();
        if (!this.client) throw new Error('The browser is not running');
        const { filename: _dropped, ...sent } = args;
        const result = await this.client.callTool({ name: tool.name, arguments: sent }, undefined, { signal: context.signal, timeout: 120_000 });
        return toOutcome(result, this.ctx.cfg.browser.maxTextChars);
      },
    }));
  }

  webUi(language: Language = 'zh') {
    const override = join(this.ctx.botDir, 'prompts', 'worlds', 'mcp', 'ENV_PROMPT.md');
    return {
      config: [mcpConfigGroup(language)],
      promptDocs: [{ key: 'worlds.mcp.environment', title: language.startsWith('zh') ? 'MCP 工具 · 环境提示词' : 'MCP tools · environment prompt',
        description: language.startsWith('zh') ? '告诉她能上网、怎么用浏览器。' : 'Tells the persona it can browse and how.',
        path: existsSync(override) ? override : fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url)), deploymentPath: override, role: 'envPrompt' as const,
        vars: [{ name: 'mcp.tools', description: 'Browser tools that are available.' }] }],
    };
  }
}
