/** Return shapes of the myBot panels' methods. The browser bundle imports these as types only. */

export interface FileEntryView { name: string; mtime: string; bytes: number }

export interface LongTermFileView {
  path: string;
  what: string;
  tokens: number;
  perm: string;
  inPrefix: boolean | null;
}

export interface ContextView {
  estTokens: number;
  maxTokens: number;
  softRatio: number;
}

export interface OverviewState {
  run: { paused: boolean; phase: string; batches: number };
  context: ContextView & {
    prefixTokens: number;
    lastUsage: { prompt: number; cached: number } | null;
  };
  /** Long-term files edited since the live prefix was built. */
  pending: string[];
  today: { requests: number; promptTokens: number; cachedTokens: number };
  events: Array<{ ts: string; source: string; type: string; origin: string; text: string }>;
}

export interface TiersState {
  short: ContextView & { memoActive: FileEntryView[]; archived: number; handoffs: FileEntryView[] };
  long: { budget: number; used: number; files: LongTermFileView[] };
  dream: {
    dreaming: boolean;
    emergences: string[];
    commits: Array<{ hash: string; date: string; author: string; message: string }>;
  };
}
