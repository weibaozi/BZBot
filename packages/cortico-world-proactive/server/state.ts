import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export interface ProactiveState {
  version: 1;
  target: string;
  cursor: number;
  lastIncomingAt: number | null;
  lastActivityAt: number;
  nextAt: number;
  unanswered: number;
  day: string;
  sentToday: number;
  attempt: { at: number; counted: boolean } | null;
  lastOutcome: 'none' | 'sent' | 'silent';
}
export function readState(path: string): ProactiveState | null {
  if (!existsSync(path)) return null;
  const state = JSON.parse(readFileSync(path, 'utf8')) as ProactiveState;
  if (state.version !== 1 || !Number.isSafeInteger(state.cursor) || !Number.isFinite(state.nextAt) || !Number.isInteger(state.unanswered) || !Number.isInteger(state.sentToday)) throw new Error('Invalid proactive state file');
  return state;
}
export function writeState(path: string, state: ProactiveState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2) + '\n');
  renameSync(`${path}.tmp`, path);
}
