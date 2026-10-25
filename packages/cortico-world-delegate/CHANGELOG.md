# `DelegateWorld`

## 0.1.2

- The allowlist now also includes the global trusted QQ numbers (Settings → Global variables); the plugin's own field is an additional list.

## 0.1.1

- Add configurable extra writable directories, command network access and live web search. Defaults retain task-only writes and disabled network/search; changes apply when each task starts.

## 0.1.0

- Add asynchronous local Codex submission, task status and cancellation for current allowlisted QQ private requests.
- Persist task IDs in SQLite, run serial sandboxed subprocesses and append completion events to the existing conversation.
- Add a task management panel, hot configuration, interruption recovery and tests with real Codex, SQLite and OneBot.
