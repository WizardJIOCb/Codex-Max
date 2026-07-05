# Codex Max

Codex Max is a local VS Code extension that opens a workspace tab with a compact board of embedded Codex chats. Each card runs its own Codex CLI thread through `codex exec --json`, so several conversations can stay visible at once.

## Run in VS Code

1. Open this folder in VS Code.
2. Press `F5` to start an Extension Development Host.
3. Run `Codex Max: Open Chat Board` from the Command Palette.
4. Add chats with the `+` button or `Codex Max: Add Chat`.

## Notes

- The extension uses `codex exec --json` for new embedded chats.
- Existing cards resume with `codex exec resume --json <thread_id>`.
- Chat board state is stored in VS Code workspace state.
- The board is tuned for up to 12 visible chat cards on a large editor area.
- Each card has its own title, transcript, model, reasoning effort, verbosity, web search, and filesystem access controls.

## Settings

- `codexMax.codexExecutable`: path or name of the Codex CLI executable.
- `codexMax.defaultSandbox`: `read-only`, `workspace-write`, or `danger-full-access`.
- `codexMax.model`: optional model override.
- `codexMax.maxVisibleChats`: soft visible-card target before the UI warns you.
- `codexMax.chatsPerRow`: default number of chat cards per horizontal row.
- `codexMax.chatsPerColumn`: default number of chat card rows visible vertically.

## Chat Card Controls

- `Model`: optional model id. Leave blank to use your Codex default.
- `Reason`: `minimal`, `low`, `medium`, `high`, or `xhigh`.
- `Voice`: response verbosity.
- `Web`: off, cached search, or live search.
- `Files`: read-only, workspace write, or full access.

## Board Settings

Use the gear button in the Codex Max toolbar to set how many chats are shown horizontally. The value is stored per workspace and can be set from 1 to 12.
You can also set how many chat rows are visible vertically. The value is stored per workspace and can be set from 1 to 6.

## Event Details

Codex command, file, web, tool, and reasoning events render as compact rows. Click the `+` control on the right to expand full command details, logs, or JSON payloads.
Expanded event rows scroll internally and do not resize other transcript rows. Codex-style markdown file links open the file in VS Code.
