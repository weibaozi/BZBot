import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { MCP_DEFAULTS, type McpConfigSection } from './config.ts';
import { McpWorld } from './world.ts';

export const MCP: WorldDefinition<McpConfigSection> = {
  id: 'mcp', label: 'MCP 工具', defaults: () => structuredClone(MCP_DEFAULTS), create: ctx => new McpWorld(ctx),
  describe: { tools: describeTools([], {}), events: [] },
};
