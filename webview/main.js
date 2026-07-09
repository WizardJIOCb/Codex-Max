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
    animateMessages: true,
    modelProvider: "codex",
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
  reasoning: "high",
  verbosity: "medium",
  sandbox: "danger-full-access",
  webSearch: "live",
  speedTier: "standard"
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
let pendingPersistTimer = 0;
let pendingPersistNeedsFullSync = false;
let pendingBoardUsageFrame = 0;
let pendingIncomingChatMessages = [];
let pendingIncomingChatFrame = 0;
let chatUpdateBatchDepth = 0;
let batchedChatRenderModes = new Map();
let batchedPersistNeeded = false;
let animatedMessageKeys = new Set();
let pendingRenderStatsFrame = 0;
let rateLimitsRequestedOnce = false;
let draggedChatId = "";
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
let modelProviderStatus = null;
let modelProviderStatusLoading = false;
let microphonePermissionNotice = "";
let renderStats = createRenderStats();

window.addEventListener("error", (event) => {
  showFatal(event.error || event.message || "Unknown webview error");
});

window.addEventListener("unhandledrejection", (event) => {
  showFatal(event.reason || "Unhandled webview promise rejection");
});

vscode.postMessage({ type: "ready" });

window.addEventListener("beforeunload", () => {
  if (typeof flushIncomingChatMessages === "function") {
    flushIncomingChatMessages();
  }
  if (typeof persistNow === "function") {
    persistNow();
  }
});

function createRenderStats() {
  return {
    startedAt: Date.now(),
    board: 0,
    boardGrid: 0,
    chatCard: 0,
    chatChrome: 0,
    chatMessages: 0,
    messageNodesCreated: 0,
    messageNodesReused: 0,
    messageTailPatches: 0,
    messageFullRebuilds: 0,
    toolbar: 0,
    usage: 0,
    incomingBatches: 0,
    incomingMessages: 0,
    persistFlushes: 0,
    persistFullSyncs: 0
  };
}

function countRenderStat(key, amount) {
  if (!renderStats || !Object.prototype.hasOwnProperty.call(renderStats, key)) {
    return;
  }

  renderStats[key] += Number.isFinite(Number(amount)) ? Number(amount) : 1;
  scheduleRenderStatsPanelRefresh();
}

function resetRenderStats() {
  renderStats = createRenderStats();
  if (pendingRenderStatsFrame) {
    cancelAnimationFrame(pendingRenderStatsFrame);
    pendingRenderStatsFrame = 0;
  }
  refreshRenderStatsPanel();
}

function scheduleRenderStatsPanelRefresh() {
  if (pendingRenderStatsFrame || !document.getElementById("renderStatsCard")) {
    return;
  }

  pendingRenderStatsFrame = requestAnimationFrame(() => {
    pendingRenderStatsFrame = 0;
    refreshRenderStatsPanel();
  });
}
