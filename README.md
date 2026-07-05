# Codex Max

Codex Max is a local VS Code extension that opens a workspace tab with a compact board of embedded Codex chats. Each card runs its own Codex CLI thread through `codex exec --json`, so several conversations can stay visible at once.

## Screenshot

![Codex Max chat board](chats.jpg)

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
Board settings also control chat card height, chat background color, send shortcut behavior, auto-scroll, Codex CLI status, account limits, and voice input.

## Workspaces

Codex Max has its own workspace switcher in the board toolbar. A Codex Max workspace is a saved board layout with its own chat cards, display settings, selected project folder, and chat state. This lets you keep separate boards for different projects without mixing their conversations.

- Use the workspace dropdown near the visible chat counter to switch between saved workspaces.
- Use `New workspace` to create a fresh board. New workspaces start with four chats in a 2x2 layout.
- Each chat title includes the current project folder name in square brackets, for example `Codex chat 1 [codex.max]`.
- In `Chat information`, `Chat project` is the folder used for that chat, while `Current workspace` is the active VS Code workspace folder. You can choose a project manually or use the current workspace.
- Workspace-specific settings are saved independently, including rows, columns, max chat height, background color, and voice settings.

## Voice Input

Codex Max can insert dictated text into the active chat composer. The microphone button is shown in each chat composer, and a configurable shortcut can toggle voice input for the chat whose input is focused.

Voice input engines:

- `Browser Web Speech`: uses the browser/webview speech API when it is available. It depends on VS Code/webview microphone permissions and the host platform.
- `Local Whisper`: uses local `whisper.cpp` runtime and free GGML Whisper models. Audio is transcribed locally and is not sent to the selected Codex model.
- `Off`: hides voice behavior while keeping normal text input.

Local Whisper supports downloading the runtime and selected model from Board Settings. After selecting a model and clicking `Apply`, Codex Max keeps one persistent Whisper process warm so later voice captures do not need to reload the model every time.

Available Local Whisper models include:

- `Whisper tiny q5_1`: smallest and fastest multilingual model.
- `Whisper base q5_1`: balanced small multilingual model.
- `Whisper base q8_0`: a cleaner base model with a larger quantization.
- `Whisper small q5_1`: recommended balanced model for Russian.
- `Whisper small q8_0`: slower than q5_1, often cleaner.
- `Whisper medium q5_0`: larger multilingual model with better recognition but slower startup and transcription.
- `Whisper large-v3 turbo Russian q5_1`: Russian fine-tuned model for better Russian recognition.

Useful voice settings:

- `Voice shortcut`: keyboard shortcut for toggling voice input.
- `Microphone`: selected capture device for Local Whisper. `Default` uses the current Windows recording device.
- `Mic stop delay`: how long Codex Max waits after stopping recording so final words can still be transcribed.
- `Request access`: asks the webview for microphone access when Browser Web Speech is used.
- `Windows settings`: opens Windows microphone privacy settings.

## Event Details

Codex command, file, web, tool, and reasoning events render as compact rows. Click the `+` control on the right to expand full command details, logs, or JSON payloads.
Expanded event rows scroll internally and do not resize other transcript rows. Codex-style markdown file links open the file in VS Code.
