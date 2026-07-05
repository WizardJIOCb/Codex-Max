const app = document.getElementById("app");

let state = {
  chats: [],
  selectedChatId: null,
  activeWorkspaceId: null,
  workspaces: [],
  accountRateLimits: null,
  boardSettings: {
    chatsPerRow: 3,
    chatsPerColumn: 2,
    maxChatHeight: 0,
    chatBackground: DEFAULT_CHAT_BACKGROUND,
    sendWithCtrlEnter: false,
    autoScroll: true,
    voiceShortcut: "alt-v",
    speechToText: "browser",
    localWhisperModel: "small-q5_1",
    localWhisperCaptureId: -1,
    localWhisperStopGraceMs: DEFAULT_WHISPER_LIVE_STOP_GRACE_MS,
    currentWorkspacePath: ""
  }
};
let config = {
  maxVisibleChats: 12,
  defaultChatsPerRow: 3,
  defaultChatsPerColumn: 2,
  workspaceName: "Workspace",
  workspacePath: ""
};
const DEFAULT_CHAT_SETTINGS = {
  model: "gpt-5.5",
  reasoning: "medium",
  verbosity: "medium",
  sandbox: "read-only",
  webSearch: "cached"
};
let activeSelectMenu = null;
let activeWorkspaceMenu = null;
let activeChatInfoId = null;
let imageViewerZoom = 1;
let accountRateLimitsLoading = false;
let durationTimer = null;
let chatScrollState = new Map();
let chatAutoScrollPaused = new Set();
let chatPausedScrollTop = new Map();
let chatStickyScroll = new Set();
let chatUserScrollIntent = new Set();
let pendingChatRenderIds = new Set();
let pendingChatRenderFrame = 0;
let rateLimitsRequestedOnce = false;
let voiceRecognition = null;
let voiceChatId = "";
let voiceBaseText = "";
let localVoiceSession = null;
let nativeWhisperLive = false;
let nativeWhisperStopping = false;
let nativeWhisperChunks = [];
let nativeWhisperStartedAt = 0;
let whisperStatus = null;
let whisperDownloadState = null;
let whisperPrewarmState = null;
let codexStatus = null;
let codexStatusLoading = false;
let microphonePermissionNotice = "";

window.addEventListener("error", (event) => {
  showFatal(event.error || event.message || "Unknown webview error");
});

window.addEventListener("unhandledrejection", (event) => {
  showFatal(event.reason || "Unhandled webview promise rejection");
});

vscode.postMessage({ type: "ready" });
