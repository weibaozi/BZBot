/**
 * myBot's bot package: corti-soulmate unchanged in behaviour, with myBot's admin panels added to its
 * Persona page (docs/admin-webui.md). corti-soulmate is imported from the pinned Cortico checkout
 * next to this package, which is why the package only runs inside the myBot repository.
 */
import type { BotDefinition, BotParts } from 'cortico/bot.ts';
import type { Core } from 'cortico/core/core.ts';
import type { CoreConfig } from 'cortico/core/types.ts';
import soulmate, { type BotConfig } from '../../vendor/cortico/bots/corti-soulmate/index.ts';
import type { CortiSoulmate } from '../../vendor/cortico/bots/corti-soulmate/persona/index.ts';
import { withMyBotPanels } from './server/pages.ts';

/** Also the Persona page's name; the browser bundle in dist/ is served under it. */
export const BOT_ID = 'mybot';

const definition: BotDefinition<BotConfig> = {
  ...soulmate,
  id: BOT_ID,
  build(loaded, worlds, services): BotParts<BotConfig> {
    const parts = soulmate.build(loaded, worlds, services);
    const persona = parts.persona as CortiSoulmate;
    let core: Core<CoreConfig> | null = null;
    const deps = {
      core: () => core,
      persona,
      memoryDir: loaded.memoryDir,
      dataDir: loaded.dataDir,
      context: () => ({ maxTokens: loaded.config.context.maxTokens, softRatio: loaded.config.context.softRatio }),
    };
    return {
      ...parts,
      onStart: async (ctx) => {
        core = ctx.core as unknown as Core<CoreConfig>;
        await parts.onStart?.(ctx);
      },
      webUi: parts.webUi && {
        ...parts.webUi,
        webUiPages: (ctx) => withMyBotPanels(parts.webUi?.webUiPages?.(ctx) ?? [], BOT_ID, deps),
      },
    };
  },
};

export default definition;
