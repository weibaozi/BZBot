/**
 * The Persona page bundle of myBot: corti-soulmate's six panels (workspace, memory, history,
 * checkpoints, reset, dream) plus ours. Every panel id that `server/pages.ts` or the Persona
 * declares must be a key here, or the page reports the panel as missing.
 */
import type { WebUiClientBundle } from 'cortico/web/shared/client-panel.ts';
import soulmate from '../../../vendor/cortico/bots/corti-soulmate/webui/client.ts';
import { overviewPanel } from './overview.ts';
import { roadmapPanel } from './roadmap.ts';
import { tiersPanel } from './tiers.ts';

const bundle: WebUiClientBundle = {
  panels: { ...soulmate.panels, overview: overviewPanel, tiers: tiersPanel, roadmap: roadmapPanel },
};

export default bundle;
