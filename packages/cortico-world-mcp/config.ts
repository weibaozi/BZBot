import type { ConfigGroup } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';

/** Tools the browser exposes by default: reading and moving around a page, no scripts, uploads or forms. */
export const BROWSER_TOOLS = [
  'browser_navigate', 'browser_navigate_back', 'browser_snapshot', 'browser_find', 'browser_click', 'browser_hover',
  'browser_press_key', 'browser_type', 'browser_take_screenshot', 'browser_wait_for', 'browser_tabs', 'browser_close',
];

export interface McpConfigSection {
  enabled: boolean;
  browser: {
    /** Show the browser window, so someone can watch it browse. */
    headless: boolean;
    /** Installed browser channel Playwright drives. */
    channel: 'chrome' | 'msedge';
    /** Comma-separated tool names exposed to the model. */
    tools: string;
    /** Longest text a tool result may return; the rest is cut with a note. */
    maxTextChars: number;
  };
}

export const MCP_DEFAULTS: McpConfigSection = {
  enabled: false,
  browser: { headless: false, channel: 'chrome', tools: BROWSER_TOOLS.join(','), maxTextChars: 8_000 },
};

export const allowedTools = (cfg: McpConfigSection) => new Set(cfg.browser.tools.split(',').map(name => name.trim()).filter(Boolean));

export function mcpConfigGroup(language: Language): ConfigGroup {
  const zh = language.startsWith('zh');
  return {
    id: 'world:mcp', owner: 'world:mcp',
    schema: { type: 'object', title: zh ? 'MCP 工具' : 'MCP tools', properties: {
      'worlds.mcp.browser.headless': { type: 'boolean', title: zh ? '隐藏浏览器窗口' : 'Hide the browser window',
        description: zh ? '关闭时浏览器窗口可见，能看着她逛。重启生效。' : 'Off shows the window so you can watch. Applies after a restart.', 'x-hot': false },
      'worlds.mcp.browser.channel': { type: 'string', enum: ['chrome', 'msedge'], title: zh ? '浏览器' : 'Browser', 'x-hot': false },
      'worlds.mcp.browser.tools': { type: 'string', title: zh ? '开放的浏览器工具' : 'Exposed browser tools',
        description: zh ? '逗号分隔的工具名。重启生效。' : 'Comma-separated tool names. Applies after a restart.', 'x-hot': false },
      'worlds.mcp.browser.maxTextChars': { type: 'integer', minimum: 1000, maximum: 200_000, multipleOf: 1000,
        title: zh ? '单次结果文本上限' : 'Text limit per result', 'x-suffix': zh ? '字' : 'chars', 'x-hot': true },
    } },
  };
}
