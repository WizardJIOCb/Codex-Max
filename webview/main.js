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

window.addEventListener("message", (event) => {
  const message = event.data;

  if (message.type === "hydrate") {
    try {
      config = Object.assign(config, message.config || {});
      state = normalizeState(message.state);
      state.boardSettings = normalizeBoardSettings(state.boardSettings);
      render();
      persist();
      requestRateLimitsOnce();
      requestCodexStatus();
    } catch (error) {
      showFatal(error);
    }
    return;
  }

  if (message.type === "addChat") {
    addChat();
    return;
  }

  if (message.type === "chatStatus") {
    updateChat(message.chatId, (chat) => {
      if (message.status === "running") {
        chat.runStartedAt = chat.runStartedAt && chat.status === "running" ? chat.runStartedAt : Date.now();
        chat.runFinishedAt = 0;
      } else if (chat.status === "running") {
        chat.runFinishedAt = Date.now();
      }
      chat.status = message.status;
      if (message.status !== "running") {
        chat.isThinking = false;
      }
    });
    return;
  }

  if (message.type === "chatThinking") {
    updateChat(message.chatId, (chat) => {
      chat.isThinking = Boolean(message.thinking) && chat.status === "running";
    });
    return;
  }

  if (message.type === "chatSession") {
    updateChat(message.chatId, (chat) => {
      chat.sessionId = message.sessionId;
    }, { render: "chrome" });
    return;
  }

  if (message.type === "chatActivity") {
    addMessage(message.chatId, "activity", message.text);
    return;
  }

  if (message.type === "assistantMessage") {
    addAssistantMessage(message.chatId, message.text);
    return;
  }

  if (message.type === "changeSummary") {
    return;
  }

  if (message.type === "filesAttached") {
    attachFiles(message.chatId, message.attachments);
    return;
  }

  if (message.type === "projectSelected") {
    updateChat(message.chatId, (chat) => {
      chat.projectPath = normalizeProjectPath(message.projectPath || currentWorkspacePath() || "");
      chat.title = chatTitleWithProject(chat.title, chat.projectPath);
    }, { render: "chrome" });
    activeChatInfoId = message.chatId;
    refreshChatInfoDialog(false);
    return;
  }

  if (message.type === "workspaceSelected") {
    const workspacePath = normalizeProjectPath(message.workspacePath || "");
    state.boardSettings = normalizeBoardSettings(Object.assign({}, state.boardSettings, {
      currentWorkspacePath: workspacePath
    }));
    const workspace = activeWorkspaceProfile();
    if (workspace) {
      workspace.path = workspacePath;
      workspace.name = projectFolderName(workspacePath) || workspace.name || "Workspace";
      workspace.boardSettings = cloneBoardSettings(state.boardSettings);
    }
    if (message.chatId) {
      updateChat(message.chatId, (chat) => {
        chat.projectPath = workspacePath;
        chat.title = chatTitleWithProject(chat.title, workspacePath);
      }, { render: "chrome" });
      activeChatInfoId = message.chatId;
      refreshToolbar();
      refreshChatInfoDialog(false);
    } else {
      refreshToolbar();
    }
    persist();
    return;
  }

  if (message.type === "workspaceImport") {
    applyWorkspaceImport(message.state, message.path || "");
    return;
  }

  if (message.type === "workspacePresetImport") {
    applyWorkspacePreset(message.preset, message.path || "");
    return;
  }

  if (message.type === "newWorkspaceSelected") {
    createWorkspaceProfileAndSwitch(normalizeProjectPath(message.workspacePath || ""));
    return;
  }

  if (message.type === "imagePreview") {
    applyImagePreview(message);
    return;
  }

  if (message.type === "chatError") {
    updateChat(message.chatId, (chat) => {
      if (chat.status === "running") {
        chat.runFinishedAt = Date.now();
      }
      chat.isThinking = false;
      chat.status = "error";
      chat.note = message.error;
      chat.messages.push({
        role: "error",
        text: message.error,
        title: "Error",
        detail: message.error,
        status: "error",
        kind: "error",
        at: Date.now()
      });
    });
  }

  if (message.type === "chatEvent") {
    addEventMessage(message.chatId, message.event);
    return;
  }

  if (message.type === "accountRateLimits") {
    accountRateLimitsLoading = false;
    state.accountRateLimits = normalizeRateLimits(message.rateLimits);
    refreshBoardUsage();
    persist();
    return;
  }

  if (message.type === "accountRateLimitsRefreshFinished") {
    accountRateLimitsLoading = false;
    refreshBoardUsage();
    return;
  }

  if (message.type === "codexStatus") {
    codexStatusLoading = false;
    codexStatus = message.status || null;
    refreshBoardSettingsCodex();
    return;
  }

  if (message.type === "whisperStatus") {
    whisperStatus = message.status || null;
    whisperDownloadState = message.downloading ? {
      target: message.downloading,
      progress: message.progress || 0,
      message: message.message || "",
      active: true
    } : null;
    refreshBoardSettingsWhisper();
    return;
  }

  if (message.type === "whisperDownloadProgress") {
    whisperDownloadState = {
      target: message.target || "",
      progress: Number(message.progress || 0),
      message: "Downloading...",
      active: true
    };
    refreshBoardSettingsWhisper();
    return;
  }

  if (message.type === "whisperDownloadError") {
    whisperDownloadState = {
      target: message.target || "",
      progress: 0,
      message: message.error || "Download failed.",
      active: false
    };
    refreshBoardSettingsWhisper();
    return;
  }

  if (message.type === "whisperPrewarmStarted") {
    whisperPrewarmState = {
      modelId: message.modelId || "",
      active: true,
      error: ""
    };
    refreshBoardSettingsWhisper();
    return;
  }

  if (message.type === "whisperPrewarmFinished") {
    whisperPrewarmState = {
      modelId: message.modelId || "",
      active: false,
      error: message.error || ""
    };
    refreshBoardSettingsWhisper();
    return;
  }

  if (message.type === "voiceTranscription") {
    applyVoiceTranscription(message.chatId, message.text || "");
    return;
  }

  if (message.type === "voiceTranscriptionStatus") {
    addVoiceActivity(message.chatId, message.text || "Local Whisper is transcribing...");
    return;
  }

  if (message.type === "voiceTranscriptionError") {
    addVoiceActivity(message.chatId, "Local Whisper stopped: " + (message.error || "transcription failed") + ".");
    return;
  }

  if (message.type === "whisperLiveStarted") {
    nativeWhisperLive = true;
    nativeWhisperStopping = false;
    voiceChatId = message.chatId || voiceChatId;
    nativeWhisperStartedAt = Date.now();
    updateVoiceButtons();
    return;
  }

  if (message.type === "whisperLiveStopping") {
    if (voiceChatId === message.chatId) {
      nativeWhisperLive = false;
      nativeWhisperStopping = true;
      updateVoiceButtons();
    }
    return;
  }

  if (message.type === "whisperLiveText") {
    applyWhisperLiveText(message.chatId, message.text || "");
    return;
  }

  if (message.type === "whisperLiveFinalText") {
    applyWhisperLiveFinalText(message.chatId, message.text || "");
    return;
  }

  if (message.type === "whisperLiveStopped") {
    if (message.error && !isSilentWhisperStopError(message.error)) {
      addVoiceActivity(message.chatId, "Local Whisper live stopped: " + message.error);
    }
    nativeWhisperLive = false;
    nativeWhisperStopping = false;
    if (voiceChatId === message.chatId) {
      voiceChatId = "";
    }
    nativeWhisperChunks = [];
    nativeWhisperStartedAt = 0;
    updateVoiceButtons();
    return;
  }

  if (message.type === "whisperLiveError") {
    addVoiceActivity(message.chatId, "Local Whisper live failed: " + (message.error || "unknown error"));
    nativeWhisperLive = false;
    nativeWhisperStopping = false;
    if (voiceChatId === message.chatId) {
      voiceChatId = "";
    }
    nativeWhisperChunks = [];
    nativeWhisperStartedAt = 0;
    updateVoiceButtons();
    return;
  }

  if (message.type === "officialOpened") {
    updateChat(message.chatId, (chat) => {
      chat.status = "opened";
      chat.lastOpenedAt = Date.now();
    }, { render: "chrome" });
  }
});

window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) {
    return;
  }

  if (event.key === "Escape") {
    closeSelectMenu();
    closeWorkspaceMenu();
    closeBoardSettings();
    closeChatInfo();
    closeImageViewer();
    return;
  }

  if (shouldToggleVoiceFromKey(event)) {
    const chatId = focusedPromptChatId();
    if (chatId) {
      event.preventDefault();
      toggleVoiceInput(chatId);
    }
  }
});

function focusedPromptChatId() {
  const active = document.activeElement;
  if (!active || !active.classList || !active.classList.contains("promptInput")) {
    return "";
  }

  const card = typeof active.closest === "function" ? active.closest("[data-chat-id]") : null;
  if (card && card.dataset.chatId) {
    return card.dataset.chatId;
  }

  return "";
}

function normalizeState(nextState) {
  const savedWorkspaces = Array.isArray(nextState && nextState.workspaces) ? nextState.workspaces : [];
  const legacyBoardSettings = normalizeBoardSettings(nextState && nextState.boardSettings);
  const legacyWorkspacePath = currentWorkspacePathFromSettings(legacyBoardSettings);
  const legacyChats = Array.isArray(nextState && nextState.chats) ? nextState.chats : [];
  let workspaces = savedWorkspaces
    .map((workspace, index) => normalizeWorkspaceProfile(workspace, index))
    .filter(Boolean);

  if (!workspaces.length) {
    workspaces = [createWorkspaceProfile({
      id: nextState && nextState.activeWorkspaceId ? String(nextState.activeWorkspaceId) : newId(),
      name: projectFolderName(legacyWorkspacePath) || config.workspaceName || "Workspace",
      path: legacyWorkspacePath,
      selectedChatId: nextState && nextState.selectedChatId ? nextState.selectedChatId : null,
      boardSettings: legacyBoardSettings,
      chats: legacyChats
    }, 0)];
  }

  const activeWorkspaceId = String(nextState && nextState.activeWorkspaceId || "");
  let active = workspaces.find((workspace) => workspace.id === activeWorkspaceId) || workspaces[0];
  if (!active) {
    active = createWorkspaceProfile({}, 0);
    workspaces = [active];
  }

  return {
    selectedChatId: active.selectedChatId || null,
    activeWorkspaceId: active.id,
    workspaces,
    accountRateLimits: normalizeRateLimits(nextState && nextState.accountRateLimits),
    boardSettings: cloneBoardSettings(active.boardSettings),
    chats: active.chats.length ? active.chats.map((chat) => cloneChat(chat, active.path)) : [createChatForWorkspace(1, active.path)]
  };
}

function createWorkspaceProfile(source, index) {
  const base = source || {};
  const boardSettings = normalizeBoardSettings(base.boardSettings || {});
  const workspacePath = normalizeProjectPath(base.path || boardSettings.currentWorkspacePath || config.workspacePath || "");
  boardSettings.currentWorkspacePath = workspacePath;
  const chats = Array.isArray(base.chats)
    ? base.chats.map((chat, chatIndex) => normalizeChat(chat, chatIndex, workspacePath))
    : [];
  return {
    id: String(base.id || newId()),
    name: String(base.name || projectFolderName(workspacePath) || "Workspace " + (index + 1)),
    path: workspacePath,
    selectedChatId: base.selectedChatId ? String(base.selectedChatId) : null,
    boardSettings,
    chats: chats.length ? chats : [createChatForWorkspace(1, workspacePath)]
  };
}

function normalizeWorkspaceProfile(workspace, index) {
  if (!workspace || typeof workspace !== "object") {
    return null;
  }

  return createWorkspaceProfile(workspace, index);
}

function normalizeChat(chat, index, fallbackWorkspacePath) {
  const source = chat || {};
  const now = Date.now();
  const messages = Array.isArray(source.messages) ? source.messages.map((item) => ({
    role: String(item.role || "assistant"),
    text: String(item.text || ""),
    at: Number(item.at || now),
    eventId: item.eventId ? String(item.eventId) : "",
    kind: item.kind ? String(item.kind) : "",
    status: item.status ? String(item.status) : "",
    title: item.title ? String(item.title) : "",
    detail: item.detail ? String(item.detail) : "",
    runStartedAt: Number(item.runStartedAt || 0),
    runFinishedAt: Number(item.runFinishedAt || 0),
    raw: item.raw ? String(item.raw) : "",
    changes: Array.isArray(item.changes) ? item.changes.map(normalizeChangeEntry) : []
  })) : [];
  repairFileChangeSummaries(messages);
  const messageTimes = messages.map((item) => item.at).filter((value) => Number.isFinite(value) && value > 0);
  const firstMessageAt = messageTimes.length ? Math.min.apply(null, messageTimes) : now;
  const lastMessageAt = messageTimes.length ? Math.max.apply(null, messageTimes) : firstMessageAt;
  const createdAt = Number(source.createdAt || firstMessageAt || now) || now;
    const updatedAt = Number(source.updatedAt || source.lastOpenedAt || lastMessageAt || createdAt) || createdAt;
  const status = source.status === "running" ? "idle" : String(source.status || "idle");
  const runStartedAt = Number(source.runStartedAt || 0);
  const runFinishedAt = Number(source.runFinishedAt || 0);
  const projectPath = normalizeProjectPath(source.projectPath || fallbackWorkspacePath || currentWorkspacePath());
  const fallbackTitle = "Codex chat " + (index + 1);

  return {
    id: String(source.id || newId()),
    title: chatTitleWithProject(String(source.title || fallbackTitle), projectPath),
    sessionId: source.sessionId || null,
    status,
    note: String(source.note || ""),
    projectPath,
    draftPrompt: String(source.draftPrompt || ""),
    lastOpenedAt: Number(source.lastOpenedAt || 0),
    createdAt,
    updatedAt,
    runStartedAt,
    runFinishedAt: status === "running" ? 0 : runFinishedAt,
    isThinking: status === "running" && Boolean(source.isThinking),
    settings: normalizeSettings(source.settings),
    pendingAttachments: Array.isArray(source.pendingAttachments) ? source.pendingAttachments.map(normalizeAttachment) : [],
    messages
  };
}

function repairFileChangeSummaries(messages) {
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "changeSummary" || !/^completed files$/i.test(message.title || message.text || "")) {
      continue;
    }

    const fileEvent = previousFileChangeEvent(messages, index);
    const filePath = fileEvent ? filePathFromFileChangeDetail(fileEvent.detail) : "";
    if (!filePath) {
      continue;
    }

    message.title = "Edited " + basenameForDisplay(filePath);
    message.text = message.title;
    message.detail = "edited";
    message.changes = [{
      path: filePath,
      kind: "edited",
      additions: null,
      deletions: null,
      diff: ""
    }];
    if (fileEvent && fileEvent.detail) {
      message.raw = fileEvent.detail;
    }
  }
}

function normalizeChangeEntry(entry) {
  const value = entry || {};
  return {
    path: String(value.path || value.file || value.name || ""),
    kind: normalizeChangeKind(value.kind || value.action || "edited"),
    additions: Number.isFinite(Number(value.additions)) ? Number(value.additions) : null,
    deletions: Number.isFinite(Number(value.deletions)) ? Number(value.deletions) : null,
    diff: String(value.diff || value.patch || value.unified_diff || value.unifiedDiff || "")
  };
}

function normalizeChangeKind(value) {
  const text = String(value || "edited").toLowerCase();
  if (["update", "updated", "edit", "edited", "done", "completed", "in_progress"].includes(text)) {
    return "edited";
  }
  if (["create", "created", "add", "added"].includes(text)) {
    return "created";
  }
  if (["delete", "deleted", "remove", "removed"].includes(text)) {
    return "deleted";
  }
  if (["rename", "renamed", "move", "moved"].includes(text)) {
    return "renamed";
  }
  return text || "edited";
}

function previousFileChangeEvent(messages, fromIndex) {
  for (let index = fromIndex - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (item.role === "event" && item.kind === "files") {
      return item;
    }
  }

  return null;
}

function filePathFromFileChangeDetail(detail) {
  const text = String(detail || "").trim();
  if (!text) {
    return "";
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed.path) {
      return String(parsed.path);
    }
    if (Array.isArray(parsed.changes) && parsed.changes.length) {
      const first = parsed.changes[0];
      return typeof first === "string" ? first : String(first.path || first.file || first.name || "");
    }
    if (Array.isArray(parsed.files) && parsed.files.length) {
      const first = parsed.files[0];
      return typeof first === "string" ? first : String(first.path || first.file || first.name || "");
    }
  } catch {
    const line = text.split(/\r?\n/).find((item) => /:\s*[A-Za-z]:\\|:\s*\//.test(item));
    if (line) {
      return line.replace(/^\w+:\s*/, "").trim();
    }
  }

  return "";
}

function basenameForDisplay(value) {
  const clean = String(value || "").replace(/[?#].*$/, "");
  return clean.split(/[\\/]/).pop() || clean || "file";
}

function createChat(index) {
  return createChatForWorkspace(index, currentWorkspacePath());
}

function createChatForWorkspace(index, workspacePath) {
  const now = Date.now();
  const projectPath = normalizeProjectPath(workspacePath || "");
  return {
    id: newId(),
    title: chatTitleWithProject("Codex chat " + index, projectPath),
    sessionId: null,
    status: "idle",
    note: "",
    projectPath,
    draftPrompt: "",
    lastOpenedAt: 0,
    createdAt: now,
    updatedAt: now,
    runStartedAt: 0,
    runFinishedAt: 0,
    isThinking: false,
    settings: Object.assign({}, DEFAULT_CHAT_SETTINGS),
    pendingAttachments: [],
    messages: [{
      role: "system",
      text: "Ask Codex anything about this workspace.",
      at: now
    }]
  };
}

function cloneBoardSettings(settings) {
  return normalizeBoardSettings(JSON.parse(JSON.stringify(settings || {})));
}

function cloneChat(chat, workspacePath) {
  return normalizeChat(JSON.parse(JSON.stringify(chat || {})), 0, workspacePath || currentWorkspacePath());
}

function applyChatSurface(value) {
  const chatBackground = normalizeHexColor(value, DEFAULT_CHAT_BACKGROUND);
  document.documentElement.style.setProperty("--chatSurface", chatBackground);
  app.style.setProperty("--chatSurface", chatBackground);
  app.style.background = chatBackground;
  const shell = app.querySelector(".shell");
  if (shell) {
    shell.style.setProperty("--chatSurface", chatBackground);
    shell.style.background = chatBackground;
  }
  return chatBackground;
}

function render(options) {
  const renderOptions = options && typeof options === "object" ? options : {};
  clearPendingChatRenders();
  closeSelectMenu();
  closeWorkspaceMenu();
  const previousBoardScroll = renderOptions.preserveBoardScroll ? captureBoardScrollState() : null;
  const previousScrollState = captureMessageScrollState();
  const board = normalizeBoardSettings(state.boardSettings);
  const configuredColumns = board.chatsPerRow;
  const configuredRows = board.chatsPerColumn;
  const maxChatHeight = board.maxChatHeight;
  const sendWithCtrlEnter = board.sendWithCtrlEnter;
  const chatBackground = board.chatBackground;
  const autoScroll = board.autoScroll;
  const voiceShortcut = board.voiceShortcut;
  const speechToText = board.speechToText;
  const localWhisperModel = board.localWhisperModel;
  const localWhisperCaptureId = board.localWhisperCaptureId;
  const localWhisperStopGraceMs = board.localWhisperStopGraceMs;

  applyChatSurface(chatBackground);

  app.innerHTML = `
    <div class="shell" style="--chatSurface: ${escapeAttr(chatBackground)}; background: ${escapeAttr(chatBackground)};">
      ${renderToolbar()}
      <main class="board">
        ${renderBoardGrid(board)}
      </main>
      ${renderBoardSettingsDialog(configuredColumns, configuredRows, maxChatHeight, sendWithCtrlEnter, chatBackground, autoScroll, voiceShortcut, speechToText, localWhisperModel, localWhisperCaptureId, localWhisperStopGraceMs)}
      ${renderChatInfoDialog()}
      ${renderImageViewerDialog()}
    </div>
  `;

  bindToolbarControls();
  bindBoardSettingsDialog();
  bindChatInfoDialog();
  bindImageViewerDialog();

  bindChatCards(previousScrollState, autoScroll);

  restoreBoardScroll(previousBoardScroll);
  updateVoiceButtons();
  syncDurationTimer();
}

function renderBoardGrid(boardSettings) {
  const board = normalizeBoardSettings(boardSettings || state.boardSettings);
  const chatCount = state.chats.length;
  if (!chatCount) {
    return '<section class="empty">No chats yet</section>';
  }

  const configuredColumns = board.chatsPerRow;
  const configuredRows = board.chatsPerColumn;
  const maxChatHeight = board.maxChatHeight;
  const columns = chatCount === 1 ? 1 : Math.max(1, Math.min(configuredColumns, chatCount));
  const rows = Math.max(1, Math.min(configuredRows, Math.ceil(chatCount / columns)));
  const gridClass = 'grid cols-' + columns + ' rows-' + rows + (maxChatHeight ? ' height-capped' : '');
  const gridStyle = maxChatHeight ? ' style="--chatMaxHeight: ' + maxChatHeight + 'px; grid-auto-rows: ' + maxChatHeight + 'px; min-height: 0;"' : '';
  return '<section class="' + gridClass + '"' + gridStyle + '>' + state.chats.map(renderChat).join("") + '</section>';
}

function refreshBoardGrid(options) {
  const refreshOptions = options && typeof options === "object" ? options : {};
  clearPendingChatRenders();
  const boardNode = document.querySelector(".board");
  if (!boardNode) {
    render(refreshOptions);
    return;
  }

  const previousBoardScroll = refreshOptions.preserveBoardScroll ? captureBoardScrollState() : null;
  const previousScrollState = captureMessageScrollState();
  const board = normalizeBoardSettings(state.boardSettings);
  boardNode.innerHTML = renderBoardGrid(board);
  bindChatCards(previousScrollState, board.autoScroll);
  refreshToolbar();
  restoreBoardScroll(previousBoardScroll);
  updateVoiceButtons();
  syncDurationTimer();
}

function refreshBoardAfterSettingsChange() {
  applyChatSurface(state.boardSettings.chatBackground);
  refreshBoardGrid({ preserveBoardScroll: true });
  if (activeChatInfoId) {
    refreshChatInfoDialog(false);
  }
}

function bindChatCards(previousScrollState, autoScroll) {
  const scrollState = previousScrollState || new Map();
  for (const chat of state.chats) {
    const card = document.querySelector('[data-chat-id="' + chat.id + '"]');
    if (card) {
      bindChatCardControls(chat, card, scrollState.get(chat.id), autoScroll);
    }
  }
}

function renderToolbar() {
  const chatCount = state.chats.length;
  const overLimit = chatCount > config.maxVisibleChats;
  const usage = boardUsageInfo(state.chats, state.accountRateLimits);
  const workspacePath = currentWorkspacePath();
  const workspaceName = projectFolderName(workspacePath) || config.workspaceName;

  return `
    <header class="toolbar">
      <div class="brand">
        <strong>Codex Max</strong>
        <span title="${escapeAttr(workspacePath)}">${escapeHtml(workspaceName)}</span>
      </div>
      <span class="counter">${chatCount}/${config.maxVisibleChats} visible target</span>
      ${renderWorkspaceSelector()}
      ${renderBoardUsage(usage)}
      ${overLimit ? '<span class="hint">Board is getting dense</span>' : ''}
      <button id="openBoardSettings" class="secondary" title="Board settings">
        <svg viewBox="0 0 24 24" aria-hidden="true" class="smallIcon">
          <path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8 8 0 0 0-2.6-1.5L14 2.5h-4L9.6 5a8 8 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5A8.6 8.6 0 0 0 4.5 12c0 .5 0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a8 8 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"></path>
        </svg>
      </button>
      <button id="addChat" title="Add chat">+</button>
    </header>
  `;
}

function bindToolbarControls() {
  const addChatButton = document.getElementById("addChat");
  const settingsButton = document.getElementById("openBoardSettings");
  if (addChatButton) {
    addChatButton.addEventListener("click", addChat);
  }
  if (settingsButton) {
    settingsButton.addEventListener("click", openBoardSettings);
  }
  bindBoardUsageRefresh();

  const workspaceSelector = document.getElementById("workspaceSelector");
  if (!workspaceSelector) {
    return;
  }

  workspaceSelector.addEventListener("click", (event) => {
    event.stopPropagation();
    openWorkspaceMenu(workspaceSelector);
  });
  workspaceSelector.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    openWorkspaceMenu(workspaceSelector);
  });
}

function refreshToolbar() {
  const toolbar = document.querySelector(".toolbar");
  if (!toolbar) {
    return;
  }

  const template = document.createElement("template");
  template.innerHTML = renderToolbar().trim();
  const nextToolbar = template.content.firstElementChild;
  if (!nextToolbar) {
    return;
  }

  toolbar.replaceWith(nextToolbar);
  bindToolbarControls();
}

function scheduleChatCardRender(chatId) {
  if (!chatId) {
    return;
  }

  pendingChatRenderIds.add(chatId);
  if (pendingChatRenderFrame) {
    return;
  }

  pendingChatRenderFrame = requestAnimationFrame(flushChatCardRenders);
}

function clearPendingChatRenders() {
  if (pendingChatRenderFrame) {
    cancelAnimationFrame(pendingChatRenderFrame);
    pendingChatRenderFrame = 0;
  }
  pendingChatRenderIds.clear();
}

function flushChatCardRenders() {
  const ids = Array.from(pendingChatRenderIds);
  pendingChatRenderIds.clear();
  pendingChatRenderFrame = 0;
  if (!ids.length) {
    return;
  }

  for (const chatId of ids) {
    renderChatCard(chatId, { deferAfterRender: true });
  }
  refreshBoardUsage();
  updateVoiceButtons();
  syncDurationTimer();
}

function renderChatCard(chatId, options) {
  const renderOptions = options && typeof options === "object" ? options : {};
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  if (!chat || !card) {
    render();
    return;
  }

  const previous = captureSingleMessageScrollState(card);
  const board = normalizeBoardSettings(state.boardSettings);
  const template = document.createElement("template");
  template.innerHTML = renderChat(chat).trim();
  const nextCard = template.content.firstElementChild;
  if (!nextCard) {
    render();
    return;
  }

  card.replaceWith(nextCard);
  bindChatCardControls(chat, nextCard, previous, board.autoScroll);
  if (!renderOptions.deferAfterRender) {
    refreshBoardUsage();
    updateVoiceButtons();
    syncDurationTimer();
  }
}

function renderChatChrome(chatId) {
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  if (!chat || !card) {
    return false;
  }

  const template = document.createElement("template");
  template.innerHTML = renderChat(chat).trim();
  const nextCard = template.content.firstElementChild;
  const nextHeader = nextCard ? nextCard.querySelector(".chatHeader") : null;
  const nextComposer = nextCard ? nextCard.querySelector(".composer") : null;
  const currentHeader = card.querySelector(".chatHeader");
  const currentComposer = card.querySelector(".composer");
  if (!nextHeader || !nextComposer || !currentHeader || !currentComposer) {
    renderChatCard(chatId);
    return false;
  }

  currentHeader.replaceWith(nextHeader);
  currentComposer.replaceWith(nextComposer);
  bindChatChromeControls(chat, card);
  refreshBoardUsage();
  updateVoiceButtons();
  syncDurationTimer();
  return true;
}

function renderEventMessage(chatId, eventId) {
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  if (!chat || !card || !eventId) {
    return false;
  }

  const messages = card.querySelector(".messages");
  const existingNode = messages
    ? Array.from(messages.querySelectorAll("[data-message-id]")).find((node) => node.dataset.messageId === eventId)
    : null;
  const messageIndex = Array.isArray(chat.messages)
    ? chat.messages.findIndex((message) => message.role === "event" && message.eventId === eventId)
    : -1;
  const message = messageIndex >= 0 ? chat.messages[messageIndex] : null;
  if (!messages || !existingNode || !message) {
    return false;
  }

  const wasExpanded = existingNode.classList.contains("expanded");
  const previousScroll = captureSingleMessageScrollState(card);
  const template = document.createElement("template");
  template.innerHTML = renderMessage(message, chat, messageIndex).trim();
  const nextNode = template.content.firstElementChild;
  if (!nextNode) {
    return false;
  }

  if (wasExpanded) {
    nextNode.classList.add("expanded");
    const summary = nextNode.querySelector(".eventSummary, .changeCard");
    const toggle = nextNode.querySelector(".eventToggle, .changeAction");
    if (summary) {
      summary.setAttribute("aria-expanded", "true");
    }
    if (toggle) {
      const title = nextNode.classList.contains("changeSummary") ? "Collapse changes" : "Collapse details";
      toggle.setAttribute("title", title);
      toggle.setAttribute("aria-label", title);
    }
  }

  existingNode.replaceWith(nextNode);
  bindMessageContentControls(nextNode);
  const board = normalizeBoardSettings(state.boardSettings);
  restoreMessageScroll(chatId, messages, previousScroll, board.autoScroll, chatScrollSignature(chat));
  refreshBoardUsage();
  updateVoiceButtons();
  syncDurationTimer();
  return true;
}

function captureSingleMessageScrollState(card) {
  const chatId = card && card.dataset ? card.dataset.chatId : "";
  const messages = card ? card.querySelector(".messages") : null;
  if (!chatId || !messages) {
    return null;
  }

  return {
    scrollTop: messages.scrollTop,
    scrollHeight: messages.scrollHeight,
    clientHeight: messages.clientHeight,
    atBottom: isScrolledToBottom(messages),
    signature: messages.dataset.scrollSignature || ""
  };
}

function captureBoardScrollState() {
  const board = document.querySelector(".board");
  if (!board) {
    return null;
  }

  return {
    scrollTop: board.scrollTop,
    scrollLeft: board.scrollLeft
  };
}

function restoreBoardScroll(previous) {
  if (!previous) {
    return;
  }

  const board = document.querySelector(".board");
  if (!board) {
    return;
  }

  const apply = () => {
    const maxTop = Math.max(0, board.scrollHeight - board.clientHeight);
    const maxLeft = Math.max(0, board.scrollWidth - board.clientWidth);
    board.scrollTop = Math.min(previous.scrollTop, maxTop);
    board.scrollLeft = Math.min(previous.scrollLeft, maxLeft);
  };

  apply();
  requestAnimationFrame(apply);
}

function refreshBoardUsage() {
  const usageNode = document.querySelector(".boardUsage");
  if (!usageNode) {
    return;
  }

  const template = document.createElement("template");
  template.innerHTML = renderBoardUsage(boardUsageInfo(state.chats, state.accountRateLimits)).trim();
  const nextUsage = template.content.firstElementChild;
  if (nextUsage) {
    usageNode.replaceWith(nextUsage);
    bindBoardUsageRefresh();
  }
}

function bindBoardUsageRefresh() {
  const usageNode = document.querySelector(".boardUsage");
  if (!usageNode || usageNode.dataset.boundRefresh === "true") {
    return;
  }

  usageNode.dataset.boundRefresh = "true";
  usageNode.addEventListener("click", refreshAccountLimitsFromPill);
  usageNode.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    refreshAccountLimitsFromPill();
  });
}

function refreshAccountLimitsFromPill() {
  if (accountRateLimitsLoading) {
    return;
  }

  accountRateLimitsLoading = true;
  refreshBoardUsage();
  vscode.postMessage({
    type: "refreshRateLimits"
  });
}

function bindChatChromeControls(chat, card) {
  if (!chat || !card) {
    return;
  }

  const title = card.querySelector(".title");
  if (title) {
    title.addEventListener("input", (event) => {
      chat.title = event.target.value;
      chat.updatedAt = Date.now();
      persist();
    });
  }

  const removeButton = card.querySelector("[data-action='remove']");
  const clearButton = card.querySelector("[data-action='clear']");
  const infoButton = card.querySelector("[data-action='info']");
  if (removeButton) {
    removeButton.addEventListener("click", () => removeChat(chat.id));
  }
  if (clearButton) {
    clearButton.addEventListener("click", () => clearChat(chat.id));
  }
  if (infoButton) {
    infoButton.addEventListener("click", () => openChatInfo(chat.id));
  }
  const contextInfoButton = card.querySelector("[data-action='context-info']");
  if (contextInfoButton) {
    contextInfoButton.addEventListener("click", () => openChatInfo(chat.id));
  }
  const attachButton = card.querySelector("[data-action='attach']");
  if (attachButton) {
    attachButton.addEventListener("click", () => {
      vscode.postMessage({ type: "pickFiles", chatId: chat.id });
    });
  }
  const voiceButton = card.querySelector("[data-action='voice']");
  if (voiceButton) {
    voiceButton.addEventListener("click", () => toggleVoiceInput(chat.id));
  }
  const voiceFileButton = card.querySelector("[data-action='voice-file']");
  if (voiceFileButton) {
    voiceFileButton.addEventListener("click", () => pickLocalWhisperAudioFile(chat.id));
  }
  const sendButton = card.querySelector(".send");
  if (sendButton) {
    sendButton.addEventListener("click", () => {
      if (chat.status === "running") {
        stopChat(chat.id);
      } else {
        sendPrompt(chat.id);
      }
    });
  }

  for (const control of card.querySelectorAll("[data-setting]")) {
    control.addEventListener("change", (event) => {
      chat.settings[event.target.dataset.setting] = event.target.value;
      chat.updatedAt = Date.now();
      renderChatChrome(chat.id);
      persist();
    });
    control.addEventListener("input", (event) => {
      chat.settings[event.target.dataset.setting] = event.target.value;
      chat.updatedAt = Date.now();
      persist();
    });
  }

  for (const chip of card.querySelectorAll("[data-select-setting]")) {
    chip.addEventListener("click", (event) => {
      event.stopPropagation();
      openSelectMenu(chat.id, event.currentTarget);
    });
    chip.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      openSelectMenu(chat.id, event.currentTarget);
    });
  }

  for (const remove of card.querySelectorAll("[data-remove-attachment]")) {
    remove.addEventListener("click", (event) => {
      removeAttachment(chat.id, event.currentTarget.dataset.removeAttachment);
    });
  }

  const promptInput = card.querySelector(".promptInput");
  if (!promptInput) {
    return;
  }
  promptInput.addEventListener("input", () => {
    chat.draftPrompt = promptInput.value;
    chat.updatedAt = Date.now();
    resizePromptInput(promptInput);
    persist();
  });
  promptInput.addEventListener("keydown", (event) => {
    if (shouldToggleVoiceFromKey(event)) {
      event.preventDefault();
      toggleVoiceInput(chat.id);
      return;
    }

    if (!shouldSendFromKey(event)) {
      return;
    }

    event.preventDefault();
    sendPrompt(chat.id);
  });
  resizePromptInput(promptInput);
  bindFileDrop(card, chat.id, chat.status === "running");
}

function bindChatCardControls(chat, card, previousScroll, autoScroll) {
  if (!chat || !card) {
    return;
  }

  bindChatChromeControls(chat, card);

  const messages = card.querySelector(".messages");
  restoreMessageScroll(chat.id, messages, previousScroll, autoScroll, chatScrollSignature(chat));
  if (messages) {
    bindMessageScrollControls(chat.id, messages);
  }

  bindMessageContentControls(card);
}

function bindMessageContentControls(root) {
  if (!root) {
    return;
  }

  for (const summary of root.querySelectorAll(".eventSummary")) {
    summary.addEventListener("click", (event) => {
      const item = event.currentTarget.closest(".message.event");
      if (item) {
        toggleEventDetails(item);
      }
    });
    summary.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      const item = event.currentTarget.closest(".message.event");
      if (item) {
        toggleEventDetails(item);
      }
    });
  }

  for (const summary of root.querySelectorAll(".changeCard")) {
    summary.addEventListener("click", (event) => {
      const item = event.currentTarget.closest(".message.changeSummary");
      if (item) {
        toggleChangeDetails(item);
      }
    });
    summary.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      const item = event.currentTarget.closest(".message.changeSummary");
      if (item) {
        toggleChangeDetails(item);
      }
    });
  }

  for (const link of root.querySelectorAll("[data-open-file]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      vscode.postMessage({
        type: "openFile",
        path: event.currentTarget.dataset.openFile
      });
    });
  }

  for (const link of root.querySelectorAll("[data-open-url]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      vscode.postMessage({
        type: "openExternal",
        url: event.currentTarget.dataset.openUrl
      });
    });
  }

  for (const preview of root.querySelectorAll("[data-image-path]")) {
    requestImagePreview(preview);
  }

  for (const preview of root.querySelectorAll("[data-image-open]")) {
    preview.addEventListener("click", (event) => {
      event.preventDefault();
      openImageViewer(event.currentTarget);
    });
  }

  for (const button of root.querySelectorAll("[data-copy-chat]")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      copyMessageText(event.currentTarget);
    });
  }
}

function captureMessageScrollState() {
  const snapshot = new Map(chatScrollState);
  for (const card of document.querySelectorAll("[data-chat-id]")) {
    const chatId = card.dataset.chatId;
    const messages = card.querySelector(".messages");
    if (!chatId || !messages) {
      continue;
    }

    snapshot.set(chatId, {
      scrollTop: messages.scrollTop,
      scrollHeight: messages.scrollHeight,
      clientHeight: messages.clientHeight,
      atBottom: isScrolledToBottom(messages),
      signature: messages.dataset.scrollSignature || ""
    });
  }

  return snapshot;
}

function restoreMessageScroll(chatId, messages, previous, autoScroll, signature) {
  if (!messages) {
    return;
  }

  applyMessageScroll(chatId, messages, previous, autoScroll, signature);
  requestAnimationFrame(() => {
    if (chatStickyScroll.has(chatId) && !chatAutoScrollPaused.has(chatId)) {
      messages.scrollTop = messages.scrollHeight;
      rememberMessageScroll(chatId, messages, signature);
    } else if (chatAutoScrollPaused.has(chatId)) {
      restorePausedScrollTop(chatId, messages);
      rememberMessageScroll(chatId, messages, signature);
    }
  });
}

function bindMessageScrollControls(chatId, messages) {
  messages.addEventListener("wheel", (event) => {
    chatUserScrollIntent.add(chatId);
    if (event.deltaY < 0 || !isScrolledToBottom(messages)) {
      pauseChatAutoScroll(chatId, messages);
    }
  }, { passive: true });

  messages.addEventListener("touchmove", () => {
    chatUserScrollIntent.add(chatId);
    if (!isScrolledToBottom(messages)) {
      pauseChatAutoScroll(chatId, messages);
    }
  }, { passive: true });

  messages.addEventListener("pointerdown", () => {
    chatUserScrollIntent.add(chatId);
    if (!isScrolledToBottom(messages)) {
      pauseChatAutoScroll(chatId, messages);
    }
  }, { passive: true });

  messages.addEventListener("scroll", () => {
    const userInitiated = chatUserScrollIntent.has(chatId);
    rememberMessageScroll(chatId, messages, undefined, userInitiated);
    if (userInitiated) {
      requestAnimationFrame(() => chatUserScrollIntent.delete(chatId));
    }
  }, { passive: true });
}

function pauseChatAutoScroll(chatId, messages) {
  chatAutoScrollPaused.add(chatId);
  chatStickyScroll.delete(chatId);
  if (messages) {
    chatPausedScrollTop.set(chatId, messages.scrollTop);
  }
}

function resumeChatAutoScroll(chatId) {
  chatAutoScrollPaused.delete(chatId);
  chatPausedScrollTop.delete(chatId);
}

function restorePausedScrollTop(chatId, messages) {
  if (!messages || !chatPausedScrollTop.has(chatId)) {
    return;
  }

  const maxTop = Math.max(0, messages.scrollHeight - messages.clientHeight);
  messages.scrollTop = Math.min(chatPausedScrollTop.get(chatId), maxTop);
}

function applyMessageScroll(chatId, messages, previous, autoScroll, signature) {
  if (!messages) {
    return;
  }

  const currentSignature = signature || messages.dataset.scrollSignature || "";
  const contentChanged = !previous || previous.signature !== currentSignature;
  const paused = chatAutoScrollPaused.has(chatId);
  const shouldStickToBottom = !paused && (!previous || (autoScroll && previous.atBottom && contentChanged));
  messages.dataset.scrollSignature = currentSignature;
  if (shouldStickToBottom) {
    chatStickyScroll.add(chatId);
    messages.scrollTop = messages.scrollHeight;
  } else if (paused) {
    chatStickyScroll.delete(chatId);
    restorePausedScrollTop(chatId, messages);
  } else {
    chatStickyScroll.delete(chatId);
    const maxTop = Math.max(0, messages.scrollHeight - messages.clientHeight);
    messages.scrollTop = Math.min(previous.scrollTop, maxTop);
  }

  rememberMessageScroll(chatId, messages, currentSignature);
}

function rememberMessageScroll(chatId, messages, signature, userInitiated) {
  if (!chatId || !messages) {
    return;
  }

  const currentSignature = signature || messages.dataset.scrollSignature || "";
  const atBottom = isScrolledToBottom(messages);
  if (userInitiated) {
    if (atBottom) {
      resumeChatAutoScroll(chatId);
    } else {
      pauseChatAutoScroll(chatId, messages);
    }
  }

  chatScrollState.set(chatId, {
    scrollTop: messages.scrollTop,
    scrollHeight: messages.scrollHeight,
    clientHeight: messages.clientHeight,
    atBottom,
    signature: currentSignature
  });
}

function isScrolledToBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 4;
}

function shouldToggleVoiceFromKey(event) {
  const board = normalizeBoardSettings(state.boardSettings);
  const shortcut = board.voiceShortcut;
  const key = String(event.key || "").toLowerCase();
  if (board.speechToText === "off" || shortcut === "off" || event.isComposing) {
    return false;
  }
  if (shortcut === "alt-v") {
    return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === "v";
  }
  if (shortcut === "ctrl-shift-v") {
    return (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && key === "v";
  }
  if (shortcut === "ctrl-m") {
    return (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && key === "m";
  }
  return false;
}

function shouldSendFromKey(event) {
  if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing) {
    return false;
  }

  const board = normalizeBoardSettings(state.boardSettings);
  const hasModifier = event.ctrlKey || event.metaKey;
  return board.sendWithCtrlEnter ? hasModifier : !hasModifier;
}

function copyMessageText(button) {
  const chat = state.chats.find((item) => item.id === button.dataset.copyChat);
  const index = Number.parseInt(button.dataset.copyIndex, 10);
  const message = chat && Array.isArray(chat.messages) ? chat.messages[index] : null;
  const text = message ? String(message.text || "") : "";
  if (!text) {
    return;
  }

  const copied = () => {
    button.classList.add("copied");
    button.title = "Copied";
    setTimeout(() => {
      button.classList.remove("copied");
      button.title = "Copy message";
    }, 1200);
  };

  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    navigator.clipboard.writeText(text).then(copied).catch(() => fallbackCopyText(text, copied));
    return;
  }

  fallbackCopyText(text, copied);
}

function fallbackCopyText(text, onCopied) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
    onCopied();
  } catch {
    // Clipboard can be unavailable in some webview contexts.
  } finally {
    textarea.remove();
  }
}

function syncDurationTimer() {
  const hasRunningDuration = Boolean(document.querySelector('[data-duration-end="0"]'));
  if (hasRunningDuration && !durationTimer) {
    durationTimer = setInterval(updateDurationLabels, 1000);
  } else if (!hasRunningDuration && durationTimer) {
    clearInterval(durationTimer);
    durationTimer = null;
  }
  updateDurationLabels();
}

function updateDurationLabels() {
  for (const item of document.querySelectorAll("[data-duration-start]")) {
    const start = Number(item.dataset.durationStart || 0);
    const end = Number(item.dataset.durationEnd || 0);
    const label = item.querySelector("[data-duration-label]");
    if (!start || !label) {
      continue;
    }

    label.textContent = (end ? "Worked for " : "Working for ") + formatDuration((end || Date.now()) - start);
  }
}

function requestImagePreview(element) {
  if (!element || element.dataset.imageRequest) {
    return;
  }

  const requestId = newId();
  element.dataset.imageRequest = requestId;
  vscode.postMessage({
    type: "imagePreview",
    requestId,
    path: element.dataset.imagePath || ""
  });
}

function applyImagePreview(message) {
  const requestId = String(message.requestId || "");
  if (!requestId) {
    return;
  }

  const element = document.querySelector('[data-image-request="' + cssEscape(requestId) + '"]');
  if (!element) {
    return;
  }

  const img = element.querySelector("img");
  const placeholder = element.querySelector(".imagePreviewPlaceholder");
  if (message.dataUri && img) {
    img.src = message.dataUri;
    img.hidden = false;
    element.classList.add("loaded");
    return;
  }

  if (placeholder) {
    placeholder.textContent = message.error || "Preview unavailable";
  }
}

function cssEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return String(value).replace(/"/g, '\\"');
}

function openSelectMenu(chatId, chip) {
  if (!chip || chip.disabled) {
    return;
  }

  if (activeSelectMenu && activeSelectMenu.chip === chip) {
    closeSelectMenu();
    return;
  }

  closeSelectMenu();
  const chat = state.chats.find((item) => item.id === chatId);
  if (!chat) {
    return;
  }

  const setting = chip.dataset.selectSetting;
  const selectedValue = chip.dataset.selectValue || "";
  const options = parseSelectOptions(chip.dataset.selectOptions);
  if (!setting || !options.length) {
    return;
  }

  chip.classList.add("open");
  const menu = document.createElement("div");
  menu.className = "selectMenu";
  menu.setAttribute("role", "listbox");

  for (const item of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    button.dataset.value = item.value;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", item.value === selectedValue ? "true" : "false");
    if (item.value === selectedValue) {
      button.classList.add("active");
    }

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      chat.settings[setting] = item.value;
      chat.updatedAt = Date.now();
      closeSelectMenu();
      renderChatChrome(chatId);
      persist();
    });
    menu.appendChild(button);
  }

  document.body.appendChild(menu);
  positionSelectMenu(menu, chip);

  const closeOnOutside = (event) => {
    if (!menu.contains(event.target) && event.target !== chip && !chip.contains(event.target)) {
      closeSelectMenu();
    }
  };
  setTimeout(() => document.addEventListener("click", closeOnOutside, { once: true }), 0);

  activeSelectMenu = {
    menu,
    chip,
    closeOnOutside
  };
}

function openWorkspaceMenu(button) {
  if (!button) {
    return;
  }

  if (activeWorkspaceMenu && activeWorkspaceMenu.button === button) {
    closeWorkspaceMenu();
    return;
  }

  closeSelectMenu();
  closeWorkspaceMenu();
  button.classList.add("open");
  button.setAttribute("aria-expanded", "true");

  const menu = document.createElement("div");
  menu.className = "selectMenu workspaceMenu";
  menu.setAttribute("role", "listbox");

  const newButton = document.createElement("button");
  newButton.type = "button";
  newButton.textContent = "New workspace";
  newButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closeWorkspaceMenu();
    vscode.postMessage({ type: "pickNewWorkspace" });
  });
  menu.appendChild(newButton);

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.textContent = "Export workspaces";
  exportButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closeWorkspaceMenu();
    syncActiveWorkspaceFromState();
    vscode.postMessage({ type: "exportWorkspaces", state });
  });
  menu.appendChild(exportButton);

  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.textContent = "Import workspaces";
  importButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closeWorkspaceMenu();
    vscode.postMessage({ type: "importWorkspaces" });
  });
  menu.appendChild(importButton);

  const divider = document.createElement("div");
  divider.className = "workspaceMenuDivider";
  menu.appendChild(divider);

  for (const workspace of workspaceList()) {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = workspace.name;
    item.title = workspace.path || workspace.name;
    item.dataset.workspaceId = workspace.id;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", workspace.id === state.activeWorkspaceId ? "true" : "false");
    if (workspace.id === state.activeWorkspaceId) {
      item.classList.add("active");
    }
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      closeWorkspaceMenu();
      switchWorkspace(workspace.id);
    });
    menu.appendChild(item);
  }

  document.body.appendChild(menu);
  positionSelectMenu(menu, button);

  const closeOnOutside = (event) => {
    if (!menu.contains(event.target) && event.target !== button && !button.contains(event.target)) {
      closeWorkspaceMenu();
    }
  };
  setTimeout(() => document.addEventListener("click", closeOnOutside, { once: true }), 0);

  activeWorkspaceMenu = {
    menu,
    button,
    closeOnOutside
  };
}

function closeSelectMenu() {
  if (!activeSelectMenu) {
    return;
  }

  document.removeEventListener("click", activeSelectMenu.closeOnOutside);
  activeSelectMenu.chip.classList.remove("open");
  activeSelectMenu.menu.remove();
  activeSelectMenu = null;
}

function closeWorkspaceMenu() {
  if (!activeWorkspaceMenu) {
    return;
  }

  document.removeEventListener("click", activeWorkspaceMenu.closeOnOutside);
  activeWorkspaceMenu.button.classList.remove("open");
  activeWorkspaceMenu.button.setAttribute("aria-expanded", "false");
  activeWorkspaceMenu.menu.remove();
  activeWorkspaceMenu = null;
}

function positionSelectMenu(menu, chip) {
  const rect = chip.getBoundingClientRect();
  menu.style.left = rect.left + "px";
  menu.style.top = rect.bottom + 6 + "px";
  menu.style.minWidth = Math.max(86, Math.ceil(rect.width) + 18) + "px";

  const menuRect = menu.getBoundingClientRect();
  const overflowRight = menuRect.right - window.innerWidth + 8;
  if (overflowRight > 0) {
    menu.style.left = Math.max(8, rect.left - overflowRight) + "px";
  }

  const overflowBottom = menuRect.bottom - window.innerHeight + 8;
  if (overflowBottom > 0) {
    menu.style.top = Math.max(8, rect.top - menuRect.height - 6) + "px";
  }
}

function parseSelectOptions(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.value === "string") : [];
  } catch {
    return [];
  }
}

function showFatal(error) {
  const message = error && error.stack ? error.stack : String(error || "Unknown error");
  app.innerHTML = `
    <div class="fatal">
      <h2>Codex Max could not render the chat board</h2>
      <pre>${escapeHtml(message)}</pre>
      <button id="resetBrokenState" type="button">Reset chat board state</button>
    </div>
  `;

  const reset = document.getElementById("resetBrokenState");
  if (reset) {
    reset.addEventListener("click", () => {
      const workspacePath = normalizeProjectPath(config.workspacePath || "");
      const workspace = createWorkspaceProfile({
        id: newId(),
        name: projectFolderName(workspacePath) || "Workspace",
        path: workspacePath,
        boardSettings: normalizeBoardSettings({ currentWorkspacePath: workspacePath }),
        chats: []
      }, 0);
      state = {
        chats: workspace.chats.map((chat) => cloneChat(chat, workspace.path)),
        selectedChatId: null,
        activeWorkspaceId: workspace.id,
        workspaces: [workspace],
        accountRateLimits: state.accountRateLimits,
        boardSettings: cloneBoardSettings(workspace.boardSettings)
      };
      render();
      persist();
    });
  }
}

function showToast(message) {
  const existing = document.querySelector(".toast");
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = String(message || "");
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4200);
}

function toggleEventDetails(item) {
  const expanded = !item.classList.contains("expanded");
  item.classList.toggle("expanded", expanded);
  const summary = item.querySelector(".eventSummary");
  const toggle = item.querySelector(".eventToggle");
  if (summary) {
    summary.setAttribute("aria-expanded", expanded ? "true" : "false");
  }
  if (toggle) {
    const title = expanded ? "Collapse details" : "Expand details";
    toggle.setAttribute("title", title);
    toggle.setAttribute("aria-label", title);
  }
}

function toggleChangeDetails(item) {
  const expanded = !item.classList.contains("expanded");
  item.classList.toggle("expanded", expanded);
  const summary = item.querySelector(".changeCard");
  const toggle = item.querySelector(".changeAction");
  if (summary) {
    summary.setAttribute("aria-expanded", expanded ? "true" : "false");
  }
  if (toggle) {
    const title = expanded ? "Collapse changes" : "Expand changes";
    toggle.setAttribute("title", title);
    toggle.setAttribute("aria-label", title);
  }
}

function renderBoardSettingsDialog(columns, rows, maxChatHeight, sendWithCtrlEnter, chatBackground, autoScroll, voiceShortcut, speechToText, localWhisperModel, localWhisperCaptureId, localWhisperStopGraceMs) {
  const isHeightAuto = !maxChatHeight;
  const heightValue = maxChatHeight || 720;
  return `
    <div class="modalBackdrop" id="boardSettingsModal" hidden>
      <section class="modal boardSettingsModal" role="dialog" aria-modal="true" aria-labelledby="boardSettingsTitle">
        <header class="modalHeader">
          <h2 id="boardSettingsTitle">Board settings${EXTENSION_VERSION ? ' <span class="settingsVersion">v' + escapeHtml(EXTENSION_VERSION) + '</span>' : ""}</h2>
          <button class="iconButton secondary" id="closeBoardSettings" title="Close">x</button>
        </header>
        <div class="modalBody">
          <div class="fieldRow">
            <label for="chatsPerRow">Chats per row</label>
            <input id="chatsPerRow" type="number" min="1" max="12" value="${columns}" />
          </div>
          <div class="stepper" aria-label="Chats per row presets">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((value) => '<button class="' + (value === columns ? "active" : "") + '" data-columns="' + value + '">' + value + '</button>').join("")}
          </div>
          <div class="fieldRow">
            <label for="chatsPerColumn">Chats per column</label>
            <input id="chatsPerColumn" type="number" min="1" max="6" value="${rows}" />
          </div>
          <div class="stepper" aria-label="Chats per column presets">
            ${[1, 2, 3, 4, 5, 6].map((value) => '<button class="' + (value === rows ? "active" : "") + '" data-rows="' + value + '">' + value + '</button>').join("")}
          </div>
          <div class="fieldRow heightRow">
            <label for="maxChatHeightMode">Max chat height</label>
            <div class="heightControls">
              <select id="maxChatHeightMode">
                <option value="auto"${isHeightAuto ? " selected" : ""}>Auto</option>
                <option value="pixels"${isHeightAuto ? "" : " selected"}>Pixels</option>
              </select>
              <input id="maxChatHeight" type="number" min="280" max="2400" step="20" value="${heightValue}" ${isHeightAuto ? "disabled" : ""} />
            </div>
          </div>
          <div class="fieldRow checkboxRow">
            <label for="sendWithCtrlEnter">Send with Ctrl+Enter</label>
            <input id="sendWithCtrlEnter" class="settingCheckbox" type="checkbox" ${sendWithCtrlEnter ? "checked" : ""} />
          </div>
          <div class="fieldRow checkboxRow">
            <label for="autoScrollMessages">Auto-scroll new messages</label>
            <input id="autoScrollMessages" class="settingCheckbox" type="checkbox" ${autoScroll ? "checked" : ""} />
          </div>
          <div id="codexStatusCard" class="codexStatusCard">
            ${renderCodexStatus()}
          </div>
          <div class="fieldRow">
            <label for="voiceShortcut">Voice shortcut</label>
            <select id="voiceShortcut">
              <option value="off"${voiceShortcut === "off" ? " selected" : ""}>Off</option>
              <option value="alt-v"${voiceShortcut === "alt-v" ? " selected" : ""}>Alt+V</option>
              <option value="ctrl-shift-v"${voiceShortcut === "ctrl-shift-v" ? " selected" : ""}>Ctrl+Shift+V</option>
              <option value="ctrl-m"${voiceShortcut === "ctrl-m" ? " selected" : ""}>Ctrl+M</option>
            </select>
          </div>
          <div class="fieldRow">
            <label for="speechToText">Speech-to-text engine</label>
            <select id="speechToText">
              <option value="browser"${speechToText === "browser" ? " selected" : ""}>Browser Web Speech</option>
              <option value="local-whisper"${speechToText === "local-whisper" ? " selected" : ""}>Local Whisper</option>
              <option value="off"${speechToText === "off" ? " selected" : ""}>Off</option>
            </select>
          </div>
          <div class="localWhisperSettings">
            <div class="fieldRow">
              <label for="localWhisperModel">Local Whisper model</label>
              <select id="localWhisperModel">
                ${LOCAL_WHISPER_MODELS.map((model) => '<option value="' + escapeAttr(model.id) + '"' + (model.id === localWhisperModel ? " selected" : "") + '>' + escapeHtml(model.label + " - " + model.size) + '</option>').join("")}
              </select>
            </div>
            <div class="fieldRow">
              <label for="localWhisperCaptureId">Microphone</label>
              <select id="localWhisperCaptureId" title="Microphone device used by Local Whisper live input">
                ${renderCaptureDeviceOptions(localWhisperCaptureId)}
              </select>
            </div>
            <div class="fieldRow">
              <label for="localWhisperStopGraceMs">Mic stop delay (ms)</label>
              <input id="localWhisperStopGraceMs" type="number" min="100" max="10000" step="100" value="${escapeAttr(localWhisperStopGraceMs)}" title="How long Local Whisper waits for final output after you stop listening" />
            </div>
            <div id="localWhisperStatus" class="whisperStatus">
              ${renderWhisperStatus(localWhisperModel)}
            </div>
            <div class="fieldRow actionRow">
              <label>Local runtime</label>
              <button id="downloadWhisperRuntime" type="button">Download whisper.cpp</button>
            </div>
            <div class="fieldRow actionRow">
              <label>Selected model</label>
              <button id="downloadWhisperModel" type="button">Download model</button>
            </div>
            <div class="fieldRow actionRow">
              <label>Microphone</label>
              <button id="requestMicrophoneAccess" type="button">Request access</button>
            </div>
            <div class="fieldRow actionRow">
              <label>System privacy</label>
              <button id="openMicrophoneSettings" type="button">Windows settings</button>
            </div>
          </div>
          <div class="fieldRow colorRow">
            <label for="chatBackground">Chat background</label>
            <div class="colorControls">
              <input id="chatBackgroundPicker" type="color" value="${escapeAttr(chatBackground)}" title="Chat background color" />
              <input id="chatBackground" type="text" value="${escapeAttr(chatBackground)}" placeholder="${DEFAULT_CHAT_BACKGROUND}" />
              <button id="resetChatBackground" type="button">Default</button>
            </div>
          </div>
          <div class="fieldRow actionRow">
            <label for="refreshRateLimits">Account limits</label>
            <button id="refreshRateLimits" type="button">Refresh limits</button>
          </div>
          <div class="fieldRow actionRow">
            <label>Workspace preset</label>
            <div class="dualActions">
              <button id="exportWorkspacePreset" type="button">Export</button>
              <button id="importWorkspacePreset" type="button">Import</button>
            </div>
          </div>
          <p class="modalHint">Rows control density. Enter sends by default; auto-scroll follows new replies only while you are already at the bottom.</p>
          <p class="modalHint">Browser voice input uses the browser Web Speech API. Local Whisper uses free multilingual ggml models and does not use the selected Codex model.</p>
        </div>
        <footer class="modalFooter">
          <button id="cancelBoardSettings" type="button">Cancel</button>
          <button id="applyBoardSettings" class="primary" type="button">Apply</button>
        </footer>
      </section>
    </div>
  `;
}

function renderCodexStatus() {
  const status = codexStatus || {};
  const overall = codexStatusLoading ? "checking" : (status.overall || "checking");
  const title = overall === "connected"
    ? "Codex connected"
    : overall === "needs-login"
      ? "Codex needs login"
      : overall === "missing"
        ? "Codex CLI not ready"
        : "Checking Codex...";
  const executable = status.executable ? status.executable : "codex";
  const version = status.version ? status.version : "";
  const login = status.loginStatus ? status.loginStatus : "";
  const issue = Array.isArray(status.issues) && status.issues.length ? status.issues[0] : "";
  const installButton = overall === "missing"
    ? '<button type="button" data-codex-action="install">Install CLI</button>'
    : "";
  const loginButton = overall === "needs-login"
    ? '<button type="button" data-codex-action="login">Login</button>'
    : "";
  const doctorButton = overall !== "checking"
    ? '<button type="button" data-codex-action="doctor">Doctor</button>'
    : "";
  const refreshText = codexStatusLoading ? "Checking..." : "Refresh";
  return `
    <div class="codexStatusHeader">
      <div class="codexStatusTitle">
        <span class="codexStatusDot" aria-hidden="true"></span>
        <span>${escapeHtml(title)}</span>
      </div>
      <button id="refreshCodexStatus" type="button" ${codexStatusLoading ? "disabled" : ""}>${escapeHtml(refreshText)}</button>
    </div>
    <div class="codexStatusText">
      <div><strong>Executable:</strong> ${escapeHtml(executable)}</div>
      ${version ? '<div><strong>Version:</strong> ' + escapeHtml(version) + '</div>' : ""}
      ${login ? '<div><strong>Auth:</strong> ' + escapeHtml(login) + '</div>' : ""}
      ${issue ? '<div>' + escapeHtml(issue) + '</div>' : ""}
    </div>
    <div class="codexStatusActions">
      ${installButton}
      ${loginButton}
      ${doctorButton}
      <button type="button" data-codex-action="version">Version</button>
    </div>
  `;
}

function bindBoardSettingsDialog() {
  const modal = document.getElementById("boardSettingsModal");
  const closeButton = document.getElementById("closeBoardSettings");
  const cancelButton = document.getElementById("cancelBoardSettings");
  const applyButton = document.getElementById("applyBoardSettings");
  const input = document.getElementById("chatsPerRow");
  const rowInput = document.getElementById("chatsPerColumn");
  const heightMode = document.getElementById("maxChatHeightMode");
  const heightInput = document.getElementById("maxChatHeight");
  const sendWithCtrlEnter = document.getElementById("sendWithCtrlEnter");
  const autoScrollMessages = document.getElementById("autoScrollMessages");
  const voiceShortcut = document.getElementById("voiceShortcut");
  const speechToText = document.getElementById("speechToText");
  const localWhisperModel = document.getElementById("localWhisperModel");
  const localWhisperCaptureId = document.getElementById("localWhisperCaptureId");
  const localWhisperStopGraceMs = document.getElementById("localWhisperStopGraceMs");
  const downloadWhisperRuntime = document.getElementById("downloadWhisperRuntime");
  const downloadWhisperModel = document.getElementById("downloadWhisperModel");
  const requestMicrophoneAccess = document.getElementById("requestMicrophoneAccess");
  const openMicrophoneSettings = document.getElementById("openMicrophoneSettings");
  const chatBackground = document.getElementById("chatBackground");
  const chatBackgroundPicker = document.getElementById("chatBackgroundPicker");
  const resetChatBackground = document.getElementById("resetChatBackground");
  const refreshRateLimits = document.getElementById("refreshRateLimits");
  const exportWorkspacePreset = document.getElementById("exportWorkspacePreset");
  const importWorkspacePreset = document.getElementById("importWorkspacePreset");
  const codexStatusCard = document.getElementById("codexStatusCard");

  if (!modal || !closeButton || !cancelButton || !applyButton || !input || !rowInput || !heightMode || !heightInput || !sendWithCtrlEnter || !autoScrollMessages || !voiceShortcut || !speechToText || !localWhisperModel || !localWhisperCaptureId || !localWhisperStopGraceMs || !downloadWhisperRuntime || !downloadWhisperModel || !requestMicrophoneAccess || !openMicrophoneSettings || !chatBackground || !chatBackgroundPicker || !resetChatBackground || !refreshRateLimits || !exportWorkspacePreset || !importWorkspacePreset || !codexStatusCard) {
    return;
  }

  const draft = normalizeBoardSettings(state.boardSettings);
  const updateModalControls = () => {
    input.value = draft.chatsPerRow;
    rowInput.value = draft.chatsPerColumn;
    heightMode.value = draft.maxChatHeight ? "pixels" : "auto";
    heightInput.disabled = !draft.maxChatHeight;
    heightInput.value = draft.maxChatHeight || heightInput.value || 720;
    sendWithCtrlEnter.checked = draft.sendWithCtrlEnter;
    autoScrollMessages.checked = draft.autoScroll;
    voiceShortcut.value = draft.voiceShortcut;
    speechToText.value = draft.speechToText;
    localWhisperModel.value = draft.localWhisperModel;
    localWhisperCaptureId.value = draft.localWhisperCaptureId;
    localWhisperStopGraceMs.value = draft.localWhisperStopGraceMs;
    refreshBoardSettingsWhisper();
    chatBackground.value = draft.chatBackground;
    chatBackgroundPicker.value = draft.chatBackground;

    for (const button of modal.querySelectorAll("[data-columns]")) {
      button.classList.toggle("active", Number(button.dataset.columns) === draft.chatsPerRow);
    }
    for (const button of modal.querySelectorAll("[data-rows]")) {
      button.classList.toggle("active", Number(button.dataset.rows) === draft.chatsPerColumn);
    }
  };

  closeButton.addEventListener("click", closeBoardSettings);
  cancelButton.addEventListener("click", closeBoardSettings);
  applyButton.addEventListener("click", applyBoardSettingsDraft);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeBoardSettings();
    }
  });

  input.addEventListener("change", (event) => {
    draft.chatsPerRow = clampInt(event.target.value, 1, 12);
    updateModalControls();
  });

  rowInput.addEventListener("change", (event) => {
    draft.chatsPerColumn = clampInt(event.target.value, 1, 6);
    updateModalControls();
  });

  heightMode.addEventListener("change", (event) => {
    if (event.target.value === "auto") {
      draft.maxChatHeight = 0;
      updateModalControls();
      return;
    }

    draft.maxChatHeight = normalizeMaxChatHeight(heightInput.value || 720);
    updateModalControls();
  });

  heightInput.addEventListener("change", (event) => {
    draft.maxChatHeight = normalizeMaxChatHeight(event.target.value);
    if (!draft.maxChatHeight) {
      draft.maxChatHeight = 280;
    }
    updateModalControls();
  });

  sendWithCtrlEnter.addEventListener("change", (event) => {
    draft.sendWithCtrlEnter = event.target.checked;
    updateModalControls();
  });

  autoScrollMessages.addEventListener("change", (event) => {
    draft.autoScroll = event.target.checked;
    updateModalControls();
  });

  voiceShortcut.addEventListener("change", (event) => {
    draft.voiceShortcut = normalizeVoiceShortcut(event.target.value);
    updateModalControls();
  });

  speechToText.addEventListener("change", (event) => {
    draft.speechToText = normalizeSpeechToTextEngine(event.target.value);
    updateModalControls();
  });

  localWhisperModel.addEventListener("change", (event) => {
    draft.localWhisperModel = normalizeLocalWhisperModel(event.target.value);
    updateModalControls();
  });

  localWhisperCaptureId.addEventListener("change", (event) => {
    draft.localWhisperCaptureId = normalizeLocalWhisperCaptureId(event.target.value);
    updateModalControls();
  });

  localWhisperStopGraceMs.addEventListener("change", (event) => {
    draft.localWhisperStopGraceMs = normalizeWhisperStopGraceMs(event.target.value);
    updateModalControls();
  });

  downloadWhisperRuntime.addEventListener("click", () => {
    downloadWhisperRuntime.disabled = true;
    vscode.postMessage({ type: "downloadWhisperRuntime" });
  });

  downloadWhisperModel.addEventListener("click", () => {
    downloadWhisperModel.disabled = true;
    vscode.postMessage({ type: "downloadWhisperModel", modelId: draft.localWhisperModel });
  });

  requestMicrophoneAccess.addEventListener("click", () => {
    requestMicrophoneAccess.disabled = true;
    requestMicrophoneAccess.textContent = "Requesting...";
    requestMicrophonePermission().finally(() => {
      requestMicrophoneAccess.disabled = false;
      requestMicrophoneAccess.textContent = "Request access";
      refreshBoardSettingsWhisper();
    });
  });

  openMicrophoneSettings.addEventListener("click", () => {
    vscode.postMessage({ type: "openMicrophoneSettings" });
  });

  chatBackground.addEventListener("change", (event) => {
    draft.chatBackground = normalizeHexColor(event.target.value, draft.chatBackground);
    updateModalControls();
  });

  chatBackgroundPicker.addEventListener("input", (event) => {
    draft.chatBackground = normalizeHexColor(event.target.value, draft.chatBackground);
    updateModalControls();
  });

  resetChatBackground.addEventListener("click", () => {
    draft.chatBackground = DEFAULT_CHAT_BACKGROUND;
    updateModalControls();
  });

  refreshRateLimits.addEventListener("click", () => {
    refreshRateLimits.disabled = true;
    refreshRateLimits.textContent = "Refreshing...";
    vscode.postMessage({ type: "refreshRateLimits" });
    setTimeout(() => {
      refreshRateLimits.disabled = false;
      refreshRateLimits.textContent = "Refresh limits";
    }, 5000);
  });

  exportWorkspacePreset.addEventListener("click", () => {
    const preset = currentWorkspacePreset();
    preset.boardSettings = normalizeBoardSettings(draft);
    vscode.postMessage({ type: "exportWorkspacePreset", preset });
  });

  importWorkspacePreset.addEventListener("click", () => {
    vscode.postMessage({ type: "importWorkspacePreset" });
  });

  codexStatusCard.addEventListener("click", (event) => {
    const refreshButton = event.target.closest("#refreshCodexStatus");
    if (refreshButton) {
      requestCodexStatus();
      return;
    }

    const actionButton = event.target.closest("[data-codex-action]");
    if (actionButton) {
      vscode.postMessage({
        type: "openCodexActionTerminal",
        action: actionButton.dataset.codexAction || ""
      });
    }
  });

  for (const button of modal.querySelectorAll("[data-columns]")) {
    button.addEventListener("click", (event) => {
      draft.chatsPerRow = clampInt(event.currentTarget.dataset.columns, 1, 12);
      updateModalControls();
    });
  }

  for (const button of modal.querySelectorAll("[data-rows]")) {
    button.addEventListener("click", (event) => {
      draft.chatsPerColumn = clampInt(event.currentTarget.dataset.rows, 1, 6);
      updateModalControls();
    });
  }

  function applyBoardSettingsDraft() {
    draft.chatsPerRow = clampInt(input.value, 1, 12);
    draft.chatsPerColumn = clampInt(rowInput.value, 1, 6);
    draft.maxChatHeight = heightMode.value === "auto" ? 0 : normalizeMaxChatHeight(heightInput.value || 720);
    draft.chatBackground = normalizeHexColor(chatBackground.value, DEFAULT_CHAT_BACKGROUND);
    draft.sendWithCtrlEnter = sendWithCtrlEnter.checked;
    draft.autoScroll = autoScrollMessages.checked;
    draft.voiceShortcut = normalizeVoiceShortcut(voiceShortcut.value);
    draft.speechToText = normalizeSpeechToTextEngine(speechToText.value);
    draft.localWhisperModel = normalizeLocalWhisperModel(localWhisperModel.value);
    draft.localWhisperCaptureId = normalizeLocalWhisperCaptureId(localWhisperCaptureId.value);
    draft.localWhisperStopGraceMs = normalizeWhisperStopGraceMs(localWhisperStopGraceMs.value);
    state.boardSettings = normalizeBoardSettings(draft);
    if (state.boardSettings.speechToText === "off") {
      stopVoiceInput();
    } else if (state.boardSettings.speechToText === "local-whisper") {
      vscode.postMessage({
        type: "prewarmWhisperModel",
        modelId: state.boardSettings.localWhisperModel,
        captureId: state.boardSettings.localWhisperCaptureId
      });
    }
    closeBoardSettings();
    refreshBoardAfterSettingsChange();
    persist();
  }

  updateModalControls();
}

function requestCodexStatus() {
  codexStatusLoading = true;
  refreshBoardSettingsCodex();
  vscode.postMessage({ type: "requestCodexStatus" });
}

function refreshBoardSettingsCodex() {
  const card = document.getElementById("codexStatusCard");
  if (!card) {
    return;
  }

  const status = codexStatus || {};
  const overall = codexStatusLoading ? "checking" : (status.overall || "checking");
  card.classList.toggle("connected", overall === "connected");
  card.classList.toggle("warning", overall === "needs-login" || overall === "checking");
  card.classList.toggle("missing", overall === "missing");
  card.classList.toggle("checking", overall === "checking");
  card.innerHTML = renderCodexStatus();
}

function refreshBoardSettingsWhisper() {
  const statusNode = document.getElementById("localWhisperStatus");
  const modelSelect = document.getElementById("localWhisperModel");
  const captureSelect = document.getElementById("localWhisperCaptureId");
  const runtimeButton = document.getElementById("downloadWhisperRuntime");
  const modelButton = document.getElementById("downloadWhisperModel");
  if (!statusNode || !modelSelect || !runtimeButton || !modelButton) {
    return;
  }

  const modelId = normalizeLocalWhisperModel(modelSelect.value || state.boardSettings.localWhisperModel);
  const runtimeInstalled = Boolean(whisperStatus && whisperStatus.runtime && whisperStatus.runtime.installed);
  const runtimeSupported = !whisperStatus || !whisperStatus.runtime || whisperStatus.runtime.supported !== false;
  const selectedModel = whisperStatus && Array.isArray(whisperStatus.models)
    ? whisperStatus.models.find((model) => model.id === modelId)
    : null;
  const modelInstalled = Boolean(selectedModel && selectedModel.installed);
  const downloadingTarget = whisperDownloadState && whisperDownloadState.active ? whisperDownloadState.target : "";
  statusNode.innerHTML = renderWhisperStatus(modelId);
  if (captureSelect) {
    const captureId = normalizeLocalWhisperCaptureId(captureSelect.value || state.boardSettings.localWhisperCaptureId);
    captureSelect.innerHTML = renderCaptureDeviceOptions(captureId);
    captureSelect.value = String(captureId);
  }
  runtimeButton.disabled = downloadingTarget === "runtime" || !runtimeSupported;
  modelButton.disabled = Boolean(downloadingTarget && downloadingTarget !== "runtime") || !modelId;
  runtimeButton.textContent = downloadingTarget === "runtime"
    ? "Downloading..."
    : (!runtimeSupported ? "Unavailable" : (runtimeInstalled ? "Update" : "Install"));
  modelButton.textContent = downloadingTarget === modelId
    ? "Downloading..."
    : (modelInstalled ? "Update" : "Install");
}

function renderWhisperStatus(modelId) {
  const selected = LOCAL_WHISPER_MODELS.find((model) => model.id === normalizeLocalWhisperModel(modelId)) || LOCAL_WHISPER_MODELS[0];
  const runtime = whisperStatus && whisperStatus.runtime ? whisperStatus.runtime : null;
  const modelStatus = whisperStatus && Array.isArray(whisperStatus.models)
    ? whisperStatus.models.find((model) => model.id === selected.id)
    : null;
  const runtimeSupported = !runtime || runtime.supported !== false;
  const runtimeText = runtime && runtime.installed
    ? "Runtime installed"
    : (runtimeSupported ? "Runtime not installed" : "Runtime unavailable");
  const modelText = modelStatus && modelStatus.installed ? "Model installed" : "Model not installed";
  const runtimePlatform = runtime && runtime.platform ? runtime.platform : "";
  const runtimeReason = runtime && runtime.reason
    ? '<div class="whisperNotice">' + escapeHtml(runtime.reason) + '</div>'
    : "";
  const progressPercent = Math.max(0, Math.min(100, Math.round(Number(whisperDownloadState && whisperDownloadState.progress || 0))));
  const progress = whisperDownloadState
    ? '<div class="whisperProgress" style="--progress: ' + progressPercent + '%"><span>' + escapeHtml(whisperDownloadState.message || "Downloading...") + '</span><strong>' + progressPercent + '%</strong></div>'
    : "";
  const micNotice = microphonePermissionNotice
    ? '<div class="whisperNotice">' + escapeHtml(microphonePermissionNotice) + '</div>'
    : "";
  const prewarmNotice = whisperPrewarmState && whisperPrewarmState.modelId === selected.id
    ? whisperPrewarmState.active
      ? '<div class="whisperNotice">Warming up selected model...</div>'
      : whisperPrewarmState.error
        ? '<div class="whisperNotice">Warmup failed: ' + escapeHtml(whisperPrewarmState.error) + '</div>'
        : '<div class="whisperNotice">Selected model is warmed up.</div>'
    : "";
  return `
    <div><strong>${escapeHtml(selected.label)}</strong> <span>${escapeHtml(selected.size)}</span></div>
    <div>${escapeHtml(selected.description)}. Multilingual model, supports Russian.</div>
    ${runtimePlatform ? '<div>Runtime platform: ' + escapeHtml(runtimePlatform) + '</div>' : ''}
    <div>${escapeHtml(runtimeText)} · ${escapeHtml(modelText)}</div>
    <div>${runtimeSupported ? 'Default microphone uses the current system recording device. Pick a named input if the default is wrong.' : 'Local Whisper can still download models, but live transcription needs a supported local runtime.'}</div>
    ${runtimeReason}
    ${progress}
    ${micNotice}
    ${prewarmNotice}
  `;
}

function renderCaptureDeviceOptions(selectedValue) {
  const selected = normalizeLocalWhisperCaptureId(selectedValue);
  const devices = whisperStatus && Array.isArray(whisperStatus.captureDevices) && whisperStatus.captureDevices.length
    ? whisperStatus.captureDevices
    : [{ id: -1, label: "Default microphone", isDefault: true }];
  const seen = new Set();
  const options = [];

  for (const device of devices) {
    const id = normalizeLocalWhisperCaptureId(device.id);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const prefix = id >= 0 ? id + ": " : "";
    const label = String(device.label || (id === -1 ? "Default microphone" : "Microphone " + id)).trim();
    options.push('<option value="' + escapeAttr(id) + '"' + (id === selected ? " selected" : "") + '>' + escapeHtml(prefix + label) + '</option>');
  }

  if (!seen.has(selected)) {
    options.push('<option value="' + escapeAttr(selected) + '" selected>' + escapeHtml(selected + ": Custom capture device") + '</option>');
  }

  return options.join("");
}

async function requestMicrophonePermission() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    microphonePermissionNotice = "Microphone API is not available in this VS Code webview.";
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    microphonePermissionNotice = "Microphone access granted for this webview.";
  } catch (error) {
    const reason = error && error.name ? error.name : "NotAllowedError";
    microphonePermissionNotice = "Microphone access failed: " + reason + ". Enable microphone access for VS Code in Windows privacy settings; if it still fails, this VS Code webview is blocking media capture.";
  }
}

function openBoardSettings() {
  const modal = document.getElementById("boardSettingsModal");
  if (!modal) {
    return;
  }

  modal.hidden = false;
  vscode.postMessage({ type: "requestWhisperStatus" });
  requestCodexStatus();
  const input = document.getElementById("chatsPerRow");
  if (input) {
    input.focus();
    input.select();
  }
}

function closeBoardSettings() {
  const modal = document.getElementById("boardSettingsModal");
  if (modal) {
    modal.hidden = true;
  }
}

function renderChatInfoDialog() {
  const chat = state.chats.find((item) => item.id === activeChatInfoId);
  const body = chat ? chatInfoHtml(chat) : "";
  const hidden = chat ? "" : " hidden";

  return `
    <div class="modalBackdrop" id="chatInfoModal"${hidden}>
      <section class="modal chatInfoModal" role="dialog" aria-modal="true" aria-labelledby="chatInfoTitle">
        <header class="modalHeader">
          <h2 id="chatInfoTitle">Chat information</h2>
          <button class="iconButton secondary" id="closeChatInfo" title="Close">x</button>
        </header>
        <div class="modalBody chatInfoBody" id="chatInfoBody">${body}</div>
        <footer class="modalFooter">
          <button id="closeChatInfoFooter" class="primary" type="button">Close</button>
        </footer>
      </section>
    </div>
  `;
}

function bindChatInfoDialog() {
  const modal = document.getElementById("chatInfoModal");
  const closeButton = document.getElementById("closeChatInfo");
  const footerButton = document.getElementById("closeChatInfoFooter");
  if (!modal || !closeButton || !footerButton) {
    return;
  }

  closeButton.addEventListener("click", closeChatInfo);
  footerButton.addEventListener("click", closeChatInfo);
  const chooseProject = document.getElementById("chooseChatProject");
  const chooseWorkspace = document.getElementById("chooseCurrentWorkspace");
  const useWorkspace = document.getElementById("useWorkspaceProject");
  if (chooseProject) {
    chooseProject.addEventListener("click", chooseProjectForActiveChat);
  }
  if (chooseWorkspace) {
    chooseWorkspace.addEventListener("click", chooseWorkspaceForActiveChat);
  }
  if (useWorkspace) {
    useWorkspace.addEventListener("click", useWorkspaceForActiveChat);
  }
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeChatInfo();
    }
  });
}

function openChatInfo(chatId) {
  activeChatInfoId = chatId;
  refreshChatInfoDialog(true);
}

function refreshChatInfoDialog(focusClose) {
  const existing = document.getElementById("chatInfoModal");
  if (!existing) {
    render();
    return;
  }

  const template = document.createElement("template");
  template.innerHTML = renderChatInfoDialog().trim();
  const next = template.content.firstElementChild;
  if (!next) {
    return;
  }

  existing.replaceWith(next);
  bindChatInfoDialog();
  const closeButton = document.getElementById("closeChatInfo");
  if (focusClose && closeButton) {
    closeButton.focus();
  }
}

function closeChatInfo() {
  activeChatInfoId = null;
  const modal = document.getElementById("chatInfoModal");
  if (modal) {
    modal.hidden = true;
  }
}

function chooseProjectForActiveChat() {
  if (!activeChatInfoId) {
    return;
  }

  vscode.postMessage({
    type: "pickProject",
    chatId: activeChatInfoId
  });
}

function chooseWorkspaceForActiveChat() {
  if (!activeChatInfoId) {
    return;
  }

  vscode.postMessage({
    type: "pickWorkspaceProject",
    chatId: activeChatInfoId
  });
}

function useWorkspaceForActiveChat() {
  if (!activeChatInfoId) {
    return;
  }

  const workspacePath = currentWorkspacePath();
  updateChat(activeChatInfoId, (chat) => {
    chat.projectPath = workspacePath;
    chat.title = chatTitleWithProject(chat.title, chat.projectPath);
  }, { render: "chrome" });
  refreshChatInfoDialog(false);
}

function renderImageViewerDialog() {
  return `
    <div class="modalBackdrop" id="imageViewerModal" hidden>
      <section class="modal imageViewerModal" role="dialog" aria-modal="true" aria-labelledby="imageViewerTitle">
        <header class="modalHeader">
          <h2 id="imageViewerTitle">Image preview</h2>
          <button class="iconButton secondary" id="closeImageViewer" title="Close">x</button>
        </header>
        <div class="modalBody imageViewerBody">
          <div class="imageViewerViewport">
            <img id="imageViewerImage" alt="">
          </div>
          <p class="imageViewerCaption" id="imageViewerCaption"></p>
        </div>
        <footer class="modalFooter">
          <div class="imageViewerControls" aria-label="Image zoom controls">
            <button id="zoomImageOut" type="button" title="Zoom out">-</button>
            <span class="imageViewerZoomLabel" id="imageViewerZoomLabel">100%</span>
            <button id="zoomImageIn" type="button" title="Zoom in">+</button>
            <button id="resetImageZoom" type="button" title="Reset zoom">Reset</button>
          </div>
          <button id="openImageViewerFile" type="button">Open file</button>
          <button id="closeImageViewerFooter" class="primary" type="button">Close</button>
        </footer>
      </section>
    </div>
  `;
}

function bindImageViewerDialog() {
  const modal = document.getElementById("imageViewerModal");
  const closeButton = document.getElementById("closeImageViewer");
  const footerButton = document.getElementById("closeImageViewerFooter");
  const openFileButton = document.getElementById("openImageViewerFile");
  const zoomOut = document.getElementById("zoomImageOut");
  const zoomIn = document.getElementById("zoomImageIn");
  const resetZoom = document.getElementById("resetImageZoom");
  const viewport = modal ? modal.querySelector(".imageViewerViewport") : null;
  if (!modal || !closeButton || !footerButton || !openFileButton || !zoomOut || !zoomIn || !resetZoom || !viewport) {
    return;
  }

  closeButton.addEventListener("click", closeImageViewer);
  footerButton.addEventListener("click", closeImageViewer);
  zoomOut.addEventListener("click", () => setImageViewerZoom(imageViewerZoom - 0.25));
  zoomIn.addEventListener("click", () => setImageViewerZoom(imageViewerZoom + 0.25));
  resetZoom.addEventListener("click", () => setImageViewerZoom(1));
  viewport.addEventListener("wheel", handleImageViewerWheel, { passive: false });
  openFileButton.addEventListener("click", () => {
    const path = openFileButton.dataset.openFile || "";
    if (path) {
      vscode.postMessage({ type: "openFile", path });
    }
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeImageViewer();
    }
  });
}

function openImageViewer(preview) {
  const modal = document.getElementById("imageViewerModal");
  const image = document.getElementById("imageViewerImage");
  const caption = document.getElementById("imageViewerCaption");
  const openFileButton = document.getElementById("openImageViewerFile");
  if (!modal || !image || !caption || !openFileButton) {
    return;
  }

  const img = preview.querySelector("img");
  const path = preview.dataset.imagePath || "";
  const label = preview.dataset.imageCaption || path || "image";
  if (!img || !img.src || img.hidden) {
    const placeholder = preview.querySelector(".imagePreviewPlaceholder");
    if (placeholder) {
      placeholder.textContent = "Image is still loading...";
    }
    requestImagePreview(preview);
    return;
  }

  image.src = img.src;
  image.alt = label;
  caption.textContent = label + (path && path !== label ? " - " + path : "");
  openFileButton.dataset.openFile = path;
  openFileButton.hidden = !path;
  setImageViewerZoom(1);
  modal.hidden = false;
  const closeButton = document.getElementById("closeImageViewer");
  if (closeButton) {
    closeButton.focus();
  }
}

function closeImageViewer() {
  const modal = document.getElementById("imageViewerModal");
  const image = document.getElementById("imageViewerImage");
  if (modal) {
    modal.hidden = true;
  }
  if (image) {
    image.removeAttribute("src");
  }
}

function handleImageViewerWheel(event) {
  const modal = document.getElementById("imageViewerModal");
  if (!modal || modal.hidden) {
    return;
  }

  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  const step = event.ctrlKey || event.metaKey ? 0.15 : 0.25;
  setImageViewerZoom(imageViewerZoom + direction * step);
}

function setImageViewerZoom(value) {
  imageViewerZoom = Math.max(0.25, Math.min(4, Number(value) || 1));
  const image = document.getElementById("imageViewerImage");
  const label = document.getElementById("imageViewerZoomLabel");
  if (image) {
    image.style.width = Math.round(imageViewerZoom * 100) + "%";
  }
  if (label) {
    label.textContent = Math.round(imageViewerZoom * 100) + "%";
  }
}

function setChatsPerRow(value) {
  state.boardSettings = normalizeBoardSettings(Object.assign({}, state.boardSettings, {
    chatsPerRow: value
  }));
  refreshBoardAfterSettingsChange();
  persist();
  openBoardSettings();
}

function setChatsPerColumn(value) {
  state.boardSettings = normalizeBoardSettings(Object.assign({}, state.boardSettings, {
    chatsPerColumn: value
  }));
  refreshBoardAfterSettingsChange();
  persist();
  openBoardSettings();
}

function setMaxChatHeight(value) {
  state.boardSettings = normalizeBoardSettings(Object.assign({}, state.boardSettings, {
    maxChatHeight: value
  }));
  refreshBoardAfterSettingsChange();
  persist();
  openBoardSettings();
}

function chatScrollSignature(chat) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const parts = [
    chat.status || "",
    chat.isThinking ? "thinking" : "",
    String(chat.runStartedAt || ""),
    String(chat.runFinishedAt || ""),
    String(messages.length)
  ];

  for (const message of messages) {
    const changes = Array.isArray(message.changes)
      ? message.changes.map((change) => [
          change.path || "",
          change.kind || "",
          change.additions == null ? "" : change.additions,
          change.deletions == null ? "" : change.deletions,
          String(change.diff || "").length
        ].join(":")).join(",")
      : "";
    parts.push([
      message.role || "",
      message.kind || "",
      message.status || "",
      message.eventId || "",
      String(message.at || ""),
      String(message.text || "").length,
      String(message.title || ""),
      String(message.detail || "").length,
      String(message.raw || "").length,
      changes
    ].join("|"));
  }

  return parts.join(";");
}

function renderChat(chat) {
  const isRunning = chat.status === "running";
  const messages = renderChatMessages(chat);
  const statusTitle = chat.sessionId ? "Thread: " + chat.sessionId : "New Codex thread";
  const settings = normalizeSettings(chat.settings);
  const board = normalizeBoardSettings(state.boardSettings);
  const sendShortcut = board.sendWithCtrlEnter ? "Ctrl+Enter" : "Enter";
  const sendButtonTitle = isRunning ? "Stop" : "Send";
  const sendButtonClass = isRunning ? "send iconButton stopSend" : "send iconButton";
  const sendButtonIcon = isRunning
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.6"></rect></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="m5 12 7-7 7 7"></path></svg>';
  const attachments = Array.isArray(chat.pendingAttachments) ? chat.pendingAttachments : [];
  const attachmentTray = attachments.length
    ? '<div class="attachmentTray">' + attachments.map(renderAttachmentChip).join("") + '</div>'
    : "";
  const contextInfo = contextUsageInfo(chat, settings.model);
  chat.settings = settings;

  return `
    <article class="chat" data-chat-id="${escapeAttr(chat.id)}">
      <header class="chatHeader">
        <input class="title" value="${escapeAttr(chat.title)}" title="${escapeAttr(statusTitle)}" />
        <div class="actions">
          <span class="status ${escapeAttr(chat.status)}" title="${escapeAttr(chat.status)}">${escapeHtml(statusLabel(chat.status))}</span>
          <button class="iconButton secondary" data-action="clear" title="Clear messages">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
              <path d="M6 7l1 14h10l1-14"></path>
              <path d="M9 7V4h6v3"></path>
            </svg>
          </button>
          <button class="iconButton secondary" data-action="info" title="Chat information">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 17v-6"></path>
              <path d="M12 7h.01"></path>
              <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"></path>
            </svg>
          </button>
          <button class="iconButton secondary" data-action="remove" title="Remove chat">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12"></path>
              <path d="M18 6L6 18"></path>
            </svg>
          </button>
        </div>
      </header>
      <section class="messages">${messages}</section>
      <footer class="composer">
        <div class="promptDock">
          ${attachmentTray}
          <textarea class="promptInput" rows="1" placeholder="Message Codex... ${sendShortcut} to send" ${isRunning ? "disabled" : ""}>${escapeHtml(chat.draftPrompt || "")}</textarea>
          <div class="composerBar">
            <div class="composerLeft">
              <button class="composerIcon" type="button" data-action="attach" title="Attach files" ${isRunning ? "disabled" : ""}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14"></path>
                  <path d="M5 12h14"></path>
                </svg>
              </button>
              <button class="composerIcon voiceInput${voiceChatId === chat.id ? nativeWhisperStopping ? " stopping" : " listening" : ""}" type="button" data-action="voice" title="${escapeAttr(voiceButtonTitle(chat.id))}" ${isRunning || board.speechToText === "off" ? "disabled" : ""}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"></path>
                  <path d="M19 10v1a7 7 0 0 1-14 0v-1"></path>
                  <path d="M12 18v3"></path>
                  <path d="M8 21h8"></path>
                </svg>
              </button>
              <div class="composerSettings" aria-label="Codex prompt settings">
                ${selectChip("sandbox", "Filesystem access", settings.sandbox, [
                  ["read-only", "Read access"],
                  ["workspace-write", "Write access"],
                  ["danger-full-access", "Full access"]
                ], isRunning)}
                ${selectChip("reasoning", "Reasoning effort", settings.reasoning, [
                  ["minimal", "Minimal"],
                  ["low", "Low"],
                  ["medium", "Medium"],
                  ["high", "High"],
                  ["xhigh", "Extra High"]
                ], isRunning)}
                ${selectChip("verbosity", "Response detail", settings.verbosity, [
                  ["low", "Short"],
                  ["medium", "Normal"],
                  ["high", "Full"]
                ], isRunning)}
                ${selectChip("webSearch", "Web search mode", settings.webSearch, [
                  ["disabled", "Web off"],
                  ["cached", "Web"],
                  ["live", "Live web"]
                ], isRunning)}
              </div>
            </div>
            <div class="composerRight">
              ${renderContextIndicator(contextInfo)}
              ${modelSelectChip(settings.model, isRunning)}
              <button class="${sendButtonClass}" title="${sendButtonTitle}" aria-label="${sendButtonTitle}">
                ${sendButtonIcon}
              </button>
            </div>
          </div>
        </div>
      </footer>
    </article>
  `;
}

function renderChatMessages(chat) {
  const items = Array.isArray(chat.messages)
    ? chat.messages.filter((item) => !(item.role === "event" && item.kind === "thinking" && item.status === "running"))
    : [];
  const start = Number(chat.runStartedAt || 0);
  const end = Number(chat.runFinishedAt || 0);
  const insertAfter = turnDurationInsertIndex(items, start);
  let html = "";

  for (let index = 0; index < items.length; index += 1) {
    html += renderMessage(items[index], chat, index);
    if (index === insertAfter) {
      html += renderTurnDuration(start, end);
    }
  }

  if (insertAfter === -1 && chat.status === "running" && start && !end) {
    html += renderTurnDuration(start, 0);
  }

  if (chat.status === "running" && chat.isThinking) {
    html += renderThinkingLine();
  }

  return html;
}

function renderThinkingLine() {
  return `
    <div class="thinkingLine">
      <span>Thinking</span>
    </div>
  `;
}

function turnDurationInsertIndex(messages, startedAt) {
  const start = Number(startedAt || 0);
  if (!start) {
    return -2;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && Number(message.at || 0) <= start) {
      return index;
    }
  }

  return -1;
}

function renderAttachmentChip(attachment) {
  const label = attachment.relativePath || attachment.name || "file";
  const title = (attachment.path || label) + (attachment.size ? " - " + formatBytes(attachment.size) : "");
  return `
    <span class="attachmentChip" title="${escapeAttr(title)}">
      <span>${escapeHtml(label)}</span>
      <button class="attachmentRemove" type="button" data-remove-attachment="${escapeAttr(attachment.id)}" title="Remove attachment" aria-label="Remove attachment">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8"></path>
          <path d="M12 4l-8 8"></path>
        </svg>
      </button>
    </span>
  `;
}

function renderMessage(item, chat, index) {
  if (item.role === "changeSummary") {
    const title = item.title || item.text || "Edited files";
    const detail = item.detail || "Updated";
    const messageId = item.eventId ? ' data-message-id="' + escapeAttr(item.eventId) + '"' : "";
    return `
      <div class="message changeSummary"${messageId}>
        <div class="changeCard" role="button" tabindex="0" aria-expanded="false" title="Toggle changed files">
          <span class="changeIcon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14"></path>
              <path d="M5 12h14"></path>
            </svg>
          </span>
          <div>
            <div class="changeTitle">${escapeHtml(title)}</div>
            <div class="changeMeta">${escapeHtml(detail)}</div>
          </div>
          <span class="changeAction" title="Expand changes" aria-label="Expand changes">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path class="changeToggleVertical" d="M8 3.5v9"></path>
              <path d="M3.5 8h9"></path>
            </svg>
          </span>
        </div>
        <div class="changeDetail">
          ${renderChangeDetails(item)}
        </div>
      </div>
    `;
  }

  if (item.role === "event") {
    const title = item.title || item.text || "Codex event";
    const detail = item.detail || item.text || "";
    const preview = compactPreview(detail);
    const messageId = item.eventId ? ' data-message-id="' + escapeAttr(item.eventId) + '"' : "";
    const eventDetail = item.kind === "files"
      ? renderChangeDetails(item)
      : (detail ? '<pre>' + escapeHtml(detail) + '</pre>' : '<div class="eventEmpty">No additional details</div>');
    return `
      <div class="message event ${escapeAttr(item.kind || "event")} ${escapeAttr(item.status || "info")}"${messageId}>
        <div class="eventSummary" role="button" tabindex="0" aria-expanded="false" title="Toggle details">
          <span class="eventBadge">${escapeHtml(eventBadge(item.kind, item.status))}</span>
          <span class="eventTitle">${escapeHtml(title)}</span>
          ${preview ? '<span class="eventPreview">' + escapeHtml(preview) + '</span>' : ''}
          <button class="eventToggle" type="button" tabindex="-1" title="Expand details" aria-label="Expand details">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path class="eventToggleVertical" d="M8 3.5v9"></path>
              <path d="M3.5 8h9"></path>
            </svg>
          </button>
        </div>
        <div class="eventDetail">
          ${eventDetail}
        </div>
      </div>
    `;
  }

  if (item.role === "user") {
    return `
      <div class="message user">
        ${renderPlainText(item.text)}
        <div class="userMeta">
          <span title="${escapeAttr(formatDateTime(item.at))}">${escapeHtml(formatMessageTime(item.at))}</span>
          <button class="copyMessage" type="button" data-copy-chat="${escapeAttr(chat.id)}" data-copy-index="${escapeAttr(index)}" title="Copy message" aria-label="Copy message">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="8" y="8" width="10" height="10" rx="2"></rect>
              <path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  const html = item.role === "assistant" ? renderMarkdown(item.text) : renderPlainText(item.text);
  return `<div class="message ${escapeAttr(item.role)}">${html}</div>`;
}

function renderTurnDuration(startedAt, finishedAt) {
  const start = Number(startedAt || 0);
  const end = Number(finishedAt || 0);
  if (!start) {
    return "";
  }

  const label = end ? "Worked for " : "Working for ";
  const duration = formatDuration((end || Date.now()) - start);
  return `
    <div class="turnDuration" data-duration-start="${escapeAttr(start)}" data-duration-end="${escapeAttr(end)}">
      <span data-duration-label="true">${escapeHtml(label + duration)}</span>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6 3.5 10.5 8 6 12.5"></path>
      </svg>
    </div>
  `;
}

function statusLabel(status) {
  if (status === "running") {
    return "Run";
  }
  if (status === "error") {
    return "Error";
  }
  if (status === "opened") {
    return "Open";
  }
  return "Idle";
}

function eventBadge(kind, status) {
  if (kind === "files" && status === "running") {
    return "EDIT";
  }
  if (kind === "thinking" && status === "running") {
    return "THINK";
  }
  if (status === "running") {
    return "RUN";
  }
  if (status === "error") {
    return "ERR";
  }
  if (kind === "command") {
    return "CMD";
  }
  if (kind === "files") {
    return "FILE";
  }
  if (kind === "web") {
    return "WEB";
  }
  if (kind === "tool") {
    return "TOOL";
  }
  if (kind === "thinking") {
    return "THINK";
  }
  return "INFO";
}

function compactPreview(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }

  return text.length > 96 ? text.slice(0, 96) + "..." : text;
}

function renderPlainText(value) {
  return '<p>' + escapeHtml(value).replace(/\n/g, "<br>") + '</p>';
}

function renderMarkdown(value) {
  const text = String(value || "");
  const parts = [];
  const ticks = String.fromCharCode(96, 96, 96);
  const tick = String.fromCharCode(96);
  const fence = new RegExp(ticks + "([^\\n" + tick + "]*)\\n?([\\s\\S]*?)" + ticks, "g");
  let lastIndex = 0;
  let match;

  while ((match = fence.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(renderMarkdownText(text.slice(lastIndex, match.index)));
    }

    const lang = String(match[1] || "").trim();
    const code = match[2] || "";
    parts.push('<pre><code' + (lang ? ' data-lang="' + escapeAttr(lang) + '"' : '') + '>' + escapeHtml(code.trim()) + '</code></pre>');
    lastIndex = fence.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(renderMarkdownText(text.slice(lastIndex)));
  }

  return parts.join("");
}

function renderMarkdownText(value) {
  const blocks = String(value || "").replace(/^\n+|\n+$/g, "").split(/\n{2,}/);
  if (!blocks.length || (blocks.length === 1 && !blocks[0])) {
    return "";
  }

  return blocks.map((block) => {
    const lines = block.split(/\n/).filter((line) => line.trim().length);
    if (!lines.length) {
      return "";
    }

    if (lines.every((line) => /^\s*[-*_]{3,}\s*$/.test(line))) {
      return "<hr>";
    }

    if (lines.every((line) => /^    /.test(line))) {
      return '<pre><code>' + escapeHtml(lines.map((line) => line.replace(/^    /, "")).join("\n")) + '</code></pre>';
    }

    if (lines[0].trim() === "\\[" && lines[lines.length - 1].trim() === "\\]") {
      return '<div class="mathBlock">' + escapeHtml(lines.slice(1, -1).join("\n")) + '</div>';
    }

    if (isMarkdownTable(lines)) {
      return renderMarkdownTable(lines);
    }

    if (isHtmlDetailsBlock(lines)) {
      return renderHtmlDetailsBlock(lines);
    }

    if (isDefinitionList(lines)) {
      return renderDefinitionList(lines);
    }

    if (lines.every((line) => /^\s*>\s?/.test(line))) {
      return '<blockquote>' + renderMarkdownText(lines.map((line) => line.replace(/^\s*>\s?/, "")).join("\n")) + '</blockquote>';
    }

    if (lines.every((line) => parseMarkdownListItem(line))) {
      return renderMarkdownList(lines);
    }

    if (/^#{1,4}\s+/.test(lines[0]) && lines.length === 1) {
      const level = Math.min(4, lines[0].match(/^#+/)[0].length + 2);
      return '<h' + level + '>' + renderInlineMarkdown(lines[0].replace(/^#{1,4}\s+/, "")) + '</h' + level + '>';
    }

    return renderMixedMarkdownLines(lines);
  }).join("");
}

function renderMixedMarkdownLines(lines) {
  let html = "";
  let paragraph = [];
  let index = 0;

  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }

    html += '<p>' + paragraph.map(renderInlineMarkdown).join("<br>") + '</p>';
    paragraph = [];
  };

  while (index < lines.length) {
    if (parseMarkdownListItem(lines[index])) {
      flushParagraph();
      const listLines = [];
      while (index < lines.length && parseMarkdownListItem(lines[index])) {
        listLines.push(lines[index]);
        index += 1;
      }
      html += renderMarkdownList(listLines);
      continue;
    }

    paragraph.push(lines[index]);
    index += 1;
  }

  flushParagraph();
  return html;
}

function isMarkdownTable(lines) {
  if (lines.length < 2 || !lines[0].includes("|")) {
    return false;
  }

  const separator = splitMarkdownTableRow(lines[1]);
  return separator.length > 1 && separator.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderMarkdownTable(lines) {
  const headers = splitMarkdownTableRow(lines[0]);
  const rows = lines.slice(2).map(splitMarkdownTableRow).filter((row) => row.length);
  const head = '<thead><tr>' + headers.map((cell) => '<th>' + renderInlineMarkdown(cell) + '</th>').join("") + '</tr></thead>';
  const body = rows.length ? '<tbody>' + rows.map((row) => {
    const cells = headers.map((_, index) => row[index] || "");
    return '<tr>' + cells.map((cell) => '<td>' + renderInlineMarkdown(cell) + '</td>').join("") + '</tr>';
  }).join("") + '</tbody>' : "";

  return '<table>' + head + body + '</table>';
}

function splitMarkdownTableRow(line) {
  return String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseMarkdownListItem(line) {
  const source = String(line || "");
  let match = source.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.+)$/);
  if (match) {
    return {
      indent: match[1].replace(/\t/g, "    ").length,
      type: "task",
      checked: /x/i.test(match[2]),
      text: match[3]
    };
  }

  match = source.match(/^(\s*)[-*]\s+(.+)$/);
  if (match) {
    return {
      indent: match[1].replace(/\t/g, "    ").length,
      type: "ul",
      checked: false,
      text: match[2]
    };
  }

  match = source.match(/^(\s*)\d+[.)]\s+(.+)$/);
  if (match) {
    return {
      indent: match[1].replace(/\t/g, "    ").length,
      type: "ol",
      checked: false,
      text: match[2]
    };
  }

  return null;
}

function renderMarkdownList(lines) {
  const items = lines.map(parseMarkdownListItem).filter(Boolean);
  let html = "";
  let index = 0;

  while (index < items.length) {
    const result = renderMarkdownListLevel(items, index, items[index].indent, items[index].type);
    html += result.html;
    index = result.next;
  }

  return html;
}

function renderMarkdownListLevel(items, start, indent, type) {
  const tag = type === "ol" ? "ol" : "ul";
  const className = type === "task" ? ' class="taskList"' : "";
  let html = "<" + tag + className + ">";
  let index = start;

  while (index < items.length) {
    const item = items[index];
    if (item.indent < indent || (item.indent === indent && item.type !== type)) {
      break;
    }
    if (item.indent > indent) {
      break;
    }

    let content = renderMarkdownListItemContent(item);
    index += 1;

    while (index < items.length && items[index].indent > indent) {
      const child = renderMarkdownListLevel(items, index, items[index].indent, items[index].type);
      content += child.html;
      index = child.next;
    }

    html += "<li>" + content + "</li>";
  }

  html += "</" + tag + ">";
  return { html, next: index };
}

function renderMarkdownListItemContent(item) {
  if (item.type !== "task") {
    return renderInlineMarkdown(item.text);
  }

  const checkedClass = item.checked ? " checked" : "";
  const check = item.checked ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"></path></svg>' : "";
  return '<span class="taskBox' + checkedClass + '" aria-hidden="true">' + check + '</span><span>' + renderInlineMarkdown(item.text) + '</span>';
}

function isDefinitionList(lines) {
  if (lines.length < 2 || lines.length % 2 !== 0) {
    return false;
  }

  for (let index = 1; index < lines.length; index += 2) {
    if (!/^\s*:\s+/.test(lines[index])) {
      return false;
    }
  }

  return true;
}

function renderDefinitionList(lines) {
  let html = "<dl>";
  for (let index = 0; index < lines.length; index += 2) {
    html += "<dt>" + renderInlineMarkdown(lines[index].trim()) + "</dt>";
    html += "<dd>" + renderInlineMarkdown(lines[index + 1].replace(/^\s*:\s+/, "")) + "</dd>";
  }
  return html + "</dl>";
}

function isHtmlDetailsBlock(lines) {
  return /^\s*<details>\s*$/i.test(lines[0]) && /^\s*<\/details>\s*$/i.test(lines[lines.length - 1]);
}

function renderHtmlDetailsBlock(lines) {
  const inner = lines.slice(1, -1);
  let summary = "Details";
  const body = [];

  for (const line of inner) {
    const match = line.match(/^\s*<summary>([\s\S]*)<\/summary>\s*$/i);
    if (match) {
      summary = match[1];
    } else {
      body.push(line);
    }
  }

  return '<details><summary>' + renderInlineMarkdown(summary) + '</summary>' + renderMarkdownText(body.join("\n")) + '</details>';
}

function renderInlineMarkdown(value) {
  const tick = String.fromCharCode(96);
  const inlineCode = new RegExp(tick + "([^" + tick + "]+)" + tick, "g");
  const link = /(!?)\[([^\]]+)\]\((<[^>]+>|[^)]+)\)/g;
  const source = String(value || "");
  let output = "";
  let lastIndex = 0;
  let match;

  while ((match = link.exec(source)) !== null) {
    if (match.index > lastIndex) {
      output += renderBasicInline(source.slice(lastIndex, match.index), inlineCode);
    }

    const isImage = match[1] === "!";
    const label = match[2] || match[3] || "file";
    const target = normalizeMarkdownLinkTarget(match[3]);

    if (isImage) {
      output += isPreviewableImageTarget(target)
        ? renderImagePreview(target, label, inlineCode)
        : '<span class="imageReference" title="' + escapeAttr(target) + '">Image: <strong>' + renderBasicInline(label, inlineCode) + '</strong></span>';
    } else if (/^https?:\/\//i.test(target)) {
      output += '<button class="inlineLink" data-open-url="' + escapeAttr(target) + '" title="' + escapeAttr(target) + '">' + renderBasicInline(label, inlineCode) + '</button>';
    } else {
      output += '<button class="inlineLink" data-open-file="' + escapeAttr(target) + '" title="' + escapeAttr(target) + '">' + renderBasicInline(label, inlineCode) + '</button>';
    }
    lastIndex = link.lastIndex;
  }

  if (lastIndex < source.length) {
    output += renderBasicInline(source.slice(lastIndex), inlineCode);
  }

  return output;
}

function renderBasicInline(value, inlineCode) {
  const source = String(value || "");
  let output = "";
  let lastIndex = 0;
  let match;

  inlineCode.lastIndex = 0;
  while ((match = inlineCode.exec(source)) !== null) {
    if (match.index > lastIndex) {
      output += renderInlineDecorations(escapeHtml(source.slice(lastIndex, match.index)));
    }

    output += isPreviewableImageTarget(match[1])
      ? renderImagePreview(match[1], imageLabel(match[1]), inlineCode)
      : "<code>" + escapeHtml(match[1]) + "</code>";
    lastIndex = inlineCode.lastIndex;
  }

  if (lastIndex < source.length) {
    output += renderInlineDecorations(escapeHtml(source.slice(lastIndex)));
  }

  return output;
}

function isPreviewableImageTarget(value) {
  const target = String(value || "").trim();
  if (!target || /^https?:\/\//i.test(target)) {
    return false;
  }

  return /\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i.test(target);
}

function renderImagePreview(target, label, inlineCode) {
  const caption = label || imageLabel(target);
  return '<span class="imagePreviewFrame">' +
    '<button class="imagePreviewButton" type="button" data-image-open="true" data-image-path="' + escapeAttr(target) + '" data-image-caption="' + escapeAttr(caption) + '" title="Open image preview: ' + escapeAttr(target) + '">' +
    '<span class="imagePreviewPlaceholder">Loading image...</span>' +
    '<img hidden alt="' + escapeAttr(caption) + '">' +
    '<span class="imagePreviewCaption">' + renderInlineDecorations(escapeHtml(caption)) + '</span>' +
    '</button>' +
    '</span>';
}

function renderChangeDetails(item) {
  const changes = Array.isArray(item.changes) ? item.changes.filter((change) => change.path) : [];
  const rows = changes.length
    ? changes.map(renderChangeFileRow).join("")
    : "";
  const diff = changes.map((change) => change.diff).filter(Boolean).join("\n\n");
  const body = diff
    ? renderDiffBlock(diff)
    : '<div class="changeEmpty">No textual diff was available for this file change.</div>';

  return rows + body;
}

function renderDiffBlock(value) {
  const lines = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => !/^(---|\+\+\+)\s/.test(line))
    .map(renderDiffLine)
    .join("");
  return '<pre class="changeDiff">' + lines + '</pre>';
}

function renderDiffLine(line) {
  let cls = "diffContext";
  if (/^@@/.test(line)) {
    cls = "diffHunk";
  } else if (/^\+/.test(line)) {
    cls = "diffAdd";
  } else if (/^-/.test(line)) {
    cls = "diffDelete";
  }

  return '<span class="diffLine ' + cls + '">' + escapeHtml(line || " ") + '</span>';
}

function renderChangeFileRow(change) {
  const counts = changeCountsHtml(change);
  return `
    <div class="changeFileRow">
      <span class="changeFilePath" title="${escapeAttr(change.path)}">${escapeHtml(change.path)}</span>
      <span class="changeCounts">${counts || escapeHtml(change.kind || "edited")}</span>
    </div>
  `;
}

function changeCountsHtml(change) {
  const parts = [];
  if (change.additions !== null && change.additions !== undefined) {
    parts.push('<span class="changeAdd">+' + escapeHtml(change.additions) + '</span>');
  }
  if (change.deletions !== null && change.deletions !== undefined) {
    parts.push('<span class="changeDelete">-' + escapeHtml(change.deletions) + '</span>');
  }
  return parts.join(" ");
}

function imageLabel(value) {
  const clean = String(value || "").replace(/[?#].*$/, "");
  return clean.split(/[\\/]/).pop() || clean || "image";
}

function renderInlineDecorations(value) {
  return renderAutolinks(renderAllowedInlineHtml(renderBold(renderInlineMath(value))));
}

function renderInlineMath(value) {
  return String(value).replace(/\\\(([^\n]+?)\\\)/g, '<span class="mathInline">$1</span>');
}

function renderBold(value) {
  return String(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

function renderAllowedInlineHtml(value) {
  return String(value)
    .replace(/&lt;(kbd|sub|sup|mark)&gt;([\s\S]*?)&lt;\/\1&gt;/gi, "<$1>$2</$1>")
    .replace(/&lt;br\s*\/?&gt;/gi, "<br>");
}

function renderAutolinks(value) {
  return String(value)
    .replace(/(^|[\s(])((?:https?:\/\/)[^\s<]+)/g, (match, prefix, url) => {
      const clean = url.replace(/[.,;:!?)]$/, "");
      const suffix = url.slice(clean.length);
      return prefix + '<button class="inlineLink" data-open-url="' + escapeAttr(clean) + '" title="' + escapeAttr(clean) + '">' + escapeHtml(clean) + '</button>' + suffix;
    })
    .replace(/(^|[\s(])([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi, '$1<span class="inlineEmail">$2</span>');
}


function normalizeMarkdownLinkTarget(value) {
  let target = String(value || "").trim();
  target = target.replace(/^<|>$/g, "");
  target = target.replace(/&lt;|&gt;/g, "");
  if (/^\/[A-Za-z]:/.test(target)) {
    target = target.slice(1);
  }

  return target;
}

function addChat() {
  state.chats.push(createChat(state.chats.length + 1));
  refreshBoardGrid({ preserveBoardScroll: true });
  persist();
}

function workspaceList() {
  if (!Array.isArray(state.workspaces)) {
    state.workspaces = [];
  }
  if (!state.workspaces.length) {
    const workspace = activeWorkspaceProfile();
    if (workspace && !state.workspaces.some((item) => item.id === workspace.id)) {
      state.workspaces.push(workspace);
    }
  }
  return state.workspaces;
}

function createWorkspaceProfileAndSwitch(selectedPath) {
  syncActiveWorkspaceFromState();
  const workspacePath = normalizeProjectPath(selectedPath || config.workspacePath || "");
  const baseName = projectFolderName(workspacePath) || "Workspace";
  const boardSettings = normalizeBoardSettings({
    chatsPerRow: 2,
    chatsPerColumn: 2,
    currentWorkspacePath: workspacePath
  });
  const workspace = createWorkspaceProfile({
    id: newId(),
    name: uniqueWorkspaceName(baseName),
    path: workspacePath,
    boardSettings,
    chats: [
      createChatForWorkspace(1, workspacePath),
      createChatForWorkspace(2, workspacePath),
      createChatForWorkspace(3, workspacePath),
      createChatForWorkspace(4, workspacePath)
    ]
  }, workspaceList().length);
  workspaceList().push(workspace);
  switchWorkspace(workspace.id);
}

function uniqueWorkspaceName(baseName) {
  const base = String(baseName || "Workspace").trim() || "Workspace";
  const used = new Set(workspaceList().map((workspace) => String(workspace.name || "")));
  if (!used.has(base)) {
    return base;
  }

  let index = 2;
  while (used.has(base + " " + index)) {
    index += 1;
  }
  return base + " " + index;
}

function switchWorkspace(workspaceId) {
  if (!workspaceId || workspaceId === state.activeWorkspaceId) {
    return;
  }

  syncActiveWorkspaceFromState();
  const workspace = workspaceList().find((item) => item.id === workspaceId);
  if (!workspace) {
    return;
  }

  state.activeWorkspaceId = workspace.id;
  state.selectedChatId = workspace.selectedChatId || null;
  state.boardSettings = cloneBoardSettings(workspace.boardSettings);
  state.chats = workspace.chats.length
    ? workspace.chats.map((chat) => cloneChat(chat, workspace.path))
    : [createChatForWorkspace(1, workspace.path)];
  activeChatInfoId = null;
  chatScrollState = new Map();
  chatAutoScrollPaused = new Set();
  chatPausedScrollTop = new Map();
  chatStickyScroll = new Set();
  render();
  persist();
}

function applyWorkspaceImport(importedState, sourcePath) {
  state = normalizeState(importedState || {});
  syncActiveWorkspaceFromState();
  activeChatInfoId = null;
  chatScrollState = new Map();
  chatAutoScrollPaused = new Set();
  chatPausedScrollTop = new Map();
  chatStickyScroll = new Set();
  render();
  persist();
  showToast("Imported Codex Max workspaces" + (sourcePath ? " from " + sourcePath : "") + ".");
}

function applyWorkspacePreset(preset, sourcePath) {
  const normalized = normalizeWorkspacePreset(preset || {});
  state.boardSettings = cloneBoardSettings(normalized.boardSettings);
  const workspace = activeWorkspaceProfile();
  if (workspace) {
    workspace.name = normalized.name || workspace.name;
    workspace.path = currentWorkspacePathFromSettings(normalized.boardSettings);
    workspace.boardSettings = cloneBoardSettings(normalized.boardSettings);
  }
  refreshBoardAfterSettingsChange();
  persist();
  showToast("Applied workspace preset" + (sourcePath ? " from " + sourcePath : "") + ".");
}

function currentWorkspacePreset() {
  const workspace = activeWorkspaceProfile();
  return {
    name: workspace && workspace.name ? workspace.name : "Workspace preset",
    projectName: projectFolderName(currentWorkspacePath()) || "",
    boardSettings: cloneBoardSettings(state.boardSettings)
  };
}

function normalizeWorkspacePreset(preset) {
  const boardSettings = normalizeBoardSettings(preset && preset.boardSettings || preset || {});
  return {
    name: String(preset && preset.name || "Workspace preset"),
    projectName: String(preset && preset.projectName || ""),
    boardSettings
  };
}

function removeChat(chatId) {
  vscode.postMessage({ type: "stopChat", chatId });
  state.chats = state.chats.filter((chat) => chat.id !== chatId);
  if (activeChatInfoId === chatId) {
    activeChatInfoId = null;
  }
  if (!state.chats.length) {
    state.chats.push(createChat(1));
  }
  refreshBoardGrid({ preserveBoardScroll: true });
  persist();
}

function clearChat(chatId) {
  updateChat(chatId, (chat) => {
    chat.status = "idle";
    chat.messages = [{
      role: "system",
      text: "Chat cleared. The Codex thread id is preserved.",
      at: Date.now()
    }];
  });
}

function openOfficialCodex(chatId, target) {
  updateChat(chatId, (chat) => {
    chat.status = "running";
  }, { render: "chrome" });
  vscode.postMessage({
    type: "openOfficialCodex",
    chatId,
    target,
    state
  });
}

function bindFileDrop(card, chatId, isRunning) {
  if (!card || isRunning) {
    return;
  }
  if (card.dataset.dropBound === "true") {
    return;
  }

  card.dataset.dropBound = "true";

  card.addEventListener("dragover", (event) => {
    const current = state.chats.find((chat) => chat.id === chatId);
    if (current && current.status === "running") {
      return;
    }
    if (!hasDraggedFiles(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    card.classList.add("dragOver");
  });

  card.addEventListener("dragleave", (event) => {
    if (!event.relatedTarget || !card.contains(event.relatedTarget)) {
      card.classList.remove("dragOver");
    }
  });

  card.addEventListener("drop", (event) => {
    const current = state.chats.find((chat) => chat.id === chatId);
    if (current && current.status === "running") {
      return;
    }
    if (!hasDraggedFiles(event)) {
      return;
    }

    event.preventDefault();
    card.classList.remove("dragOver");
    handleDroppedFiles(chatId, event.dataTransfer.files);
  });
}

function hasDraggedFiles(event) {
  const transfer = event && event.dataTransfer;
  const types = transfer && transfer.types ? Array.prototype.slice.call(transfer.types) : [];
  return types.includes("Files");
}

function handleDroppedFiles(chatId, fileList) {
  const files = Array.from(fileList || []).filter((file) => file && file.name);
  if (!files.length) {
    return;
  }

  Promise.all(files.map(readDroppedFile)).then((attachments) => {
    attachFiles(chatId, attachments.filter(Boolean));
  }).catch((error) => {
    addMessage(chatId, "error", "Could not attach dropped file: " + (error.message || error));
  });
}

function readDroppedFile(file) {
  return new Promise((resolve) => {
    const size = Number(file.size || 0);
    const truncated = size > MAX_ATTACHMENT_BYTES;
    const reader = new FileReader();
    const blob = truncated ? file.slice(0, MAX_ATTACHMENT_BYTES) : file;

    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      resolve(normalizeAttachment({
        id: newId(),
        name: file.name,
        path: "",
        relativePath: "",
        size,
        isText: true,
        truncated,
        content
      }));
    };

    reader.onerror = () => {
      resolve(normalizeAttachment({
        id: newId(),
        name: file.name,
        path: "",
        relativePath: "",
        size,
        isText: false,
        truncated,
        content: ""
      }));
    };

    reader.readAsText(blob);
  });
}

function attachFiles(chatId, attachments) {
  const clean = Array.isArray(attachments) ? attachments.map(normalizeAttachment).filter((item) => item.name) : [];
  if (!clean.length) {
    return;
  }

  updateChat(chatId, (chat) => {
    const existing = Array.isArray(chat.pendingAttachments) ? chat.pendingAttachments : [];
    chat.pendingAttachments = existing.concat(clean).slice(-20);
  }, { render: "chrome" });
}

function removeAttachment(chatId, attachmentId) {
  updateChat(chatId, (chat) => {
    chat.pendingAttachments = (chat.pendingAttachments || []).filter((item) => item.id !== attachmentId);
  }, { render: "chrome" });
}

function stopChat(chatId) {
  if (voiceChatId === chatId) {
    stopVoiceInput();
  }
  vscode.postMessage({ type: "stopChat", chatId });
  updateChat(chatId, (chat) => {
    chat.runFinishedAt = Date.now();
    chat.isThinking = false;
    chat.status = "idle";
    chat.messages.push({
      role: "activity",
      text: "Stopped.",
      at: Date.now()
    });
  });
}

function resizePromptInput(textarea) {
  if (!textarea) {
    return;
  }

  const minHeight = 34;
  const maxHeight = 132;
  textarea.style.height = minHeight + "px";
  const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
  textarea.style.height = nextHeight + "px";
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

function speechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function voiceShortcutLabel(value) {
  const shortcut = normalizeVoiceShortcut(value);
  if (shortcut === "alt-v") {
    return "Alt+V";
  }
  if (shortcut === "ctrl-shift-v") {
    return "Ctrl+Shift+V";
  }
  if (shortcut === "ctrl-m") {
    return "Ctrl+M";
  }
  return "Off";
}

function voiceButtonTitle(chatId) {
  const board = normalizeBoardSettings(state.boardSettings);
  const shortcut = voiceShortcutLabel(board.voiceShortcut);
  if (board.speechToText === "off") {
    return "Voice input is disabled in workspace settings";
  }
  if (board.speechToText === "browser" && !speechRecognitionConstructor()) {
    return "Voice input unavailable in this VS Code webview";
  }
  if (voiceChatId === chatId) {
    if (nativeWhisperStopping) {
      return "Finishing Local Whisper transcription...";
    }
    return (board.speechToText === "local-whisper" ? "Stop Local Whisper live input" : "Stop voice input") + (shortcut === "Off" ? "" : " (" + shortcut + ")");
  }
  const engine = board.speechToText === "local-whisper" ? "Local Whisper" : "Voice input";
  return engine + (shortcut === "Off" ? "" : " (" + shortcut + ")");
}

function toggleVoiceInput(chatId) {
  if ((voiceRecognition || localVoiceSession || nativeWhisperLive || nativeWhisperStopping) && voiceChatId === chatId) {
    stopVoiceInput();
    return;
  }

  startVoiceInput(chatId);
}

function startVoiceInput(chatId) {
  if (nativeWhisperStopping) {
    return;
  }
  stopVoiceInput();
  const board = normalizeBoardSettings(state.boardSettings);
  const Recognition = speechRecognitionConstructor();
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  const textarea = card ? card.querySelector(".promptInput") : null;
  if (board.speechToText === "off") {
    addVoiceActivity(chatId, "Voice input is disabled in workspace settings.");
    return;
  }
  if (board.speechToText === "local-whisper") {
    startLocalWhisperInput(chatId, chat, textarea, board);
    return;
  }
  if (!Recognition || !chat || !textarea || chat.status === "running") {
    if (!Recognition) {
      addVoiceActivity(chatId, "Voice input is not available in this VS Code webview. Current engine: Browser Web Speech.");
    }
    return;
  }

  const recognition = new Recognition();
  voiceRecognition = recognition;
  voiceChatId = chatId;
  voiceBaseText = textarea.value.trim();

  recognition.lang = navigator.language || "ru-RU";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let transcript = "";
    for (let index = 0; index < event.results.length; index += 1) {
      transcript += event.results[index][0] && event.results[index][0].transcript
        ? event.results[index][0].transcript
        : "";
    }

    const nextText = [voiceBaseText, transcript.trim()].filter(Boolean).join(" ");
    textarea.value = nextText;
    chat.draftPrompt = nextText;
    chat.updatedAt = Date.now();
    resizePromptInput(textarea);
    persist();
  };

  recognition.onerror = (event) => {
    const reason = event && event.error ? String(event.error) : "recognition error";
    addVoiceActivity(chatId, "Voice input stopped: " + reason + ".");
    stopVoiceInput(false);
  };

  recognition.onend = () => {
    if (voiceRecognition === recognition) {
      stopVoiceInput(false);
    }
  };

  updateVoiceButtons();
  try {
    recognition.start();
    textarea.focus();
  } catch {
    addVoiceActivity(chatId, "Voice input could not be started in this VS Code webview.");
    stopVoiceInput(false);
  }
}

function startLocalWhisperInput(chatId, chat, textarea, board) {
  if (!chat || !textarea || chat.status === "running") {
    return;
  }

  voiceChatId = chatId;
  voiceBaseText = textarea.value.trim();
  nativeWhisperLive = true;
  nativeWhisperStopping = false;
  nativeWhisperChunks = [];
  updateVoiceButtons();
  textarea.focus();
  vscode.postMessage({
    type: "startWhisperLive",
    chatId,
    modelId: board.localWhisperModel,
    captureId: board.localWhisperCaptureId
  });
}

function finishLocalWhisperInput(session, shouldTranscribe) {
  try {
    session.processor.disconnect();
  } catch {}
  try {
    session.source.disconnect();
  } catch {}
  try {
    session.stream.getTracks().forEach((track) => track.stop());
  } catch {}
  try {
    session.audioContext.close();
  } catch {}

  if (!shouldTranscribe) {
    return;
  }

  const samples = mergeAudioChunks(session.chunks);
  if (!samples.length) {
    addVoiceActivity(session.chatId, "Local Whisper did not capture any audio.");
    return;
  }

  addVoiceActivity(session.chatId, "Local Whisper is transcribing...");
  const wav = encodeWav(samples, session.sampleRate);
  vscode.postMessage({
    type: "transcribeWhisperAudio",
    chatId: session.chatId,
    modelId: session.modelId,
    dataUri: "data:audio/wav;base64," + arrayBufferToBase64(wav)
  });
}

function mergeAudioChunks(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function stopVoiceInput(callStop) {
  const recognition = voiceRecognition;
  const localSession = localVoiceSession;
  const nativeChatId = nativeWhisperLive || nativeWhisperStopping ? voiceChatId : "";
  voiceRecognition = null;
  localVoiceSession = null;
  if (nativeChatId && callStop !== false) {
    nativeWhisperLive = false;
    nativeWhisperStopping = true;
  } else {
    nativeWhisperLive = false;
    nativeWhisperStopping = false;
    voiceChatId = "";
    voiceBaseText = "";
    nativeWhisperChunks = [];
  }
  if (recognition && callStop !== false) {
    try {
      recognition.stop();
    } catch {
      // The browser speech engine may already be stopped.
    }
  }
  if (localSession) {
    finishLocalWhisperInput(localSession, callStop !== false);
  }
  if (nativeChatId && callStop !== false) {
    const board = normalizeBoardSettings(state.boardSettings);
    vscode.postMessage({
      type: "stopWhisperLive",
      chatId: nativeChatId,
      stopGraceMs: board.localWhisperStopGraceMs
    });
  }
  updateVoiceButtons();
}

function updateVoiceButtons() {
  const Recognition = speechRecognitionConstructor();
  const board = normalizeBoardSettings(state.boardSettings);
  for (const button of document.querySelectorAll("[data-action='voice']")) {
    const card = button.closest("[data-chat-id]");
    const active = card && card.dataset.chatId === voiceChatId;
    const unavailable = board.speechToText === "browser" && !Recognition;
    button.classList.toggle("listening", Boolean(active && !nativeWhisperStopping));
    button.classList.toggle("stopping", Boolean(active && nativeWhisperStopping));
    button.classList.toggle("unavailable", Boolean(unavailable));
    button.title = card ? voiceButtonTitle(card.dataset.chatId) : voiceButtonTitle("");
  }
}

function pickLocalWhisperAudioFile(chatId) {
  const board = normalizeBoardSettings(state.boardSettings);
  if (board.speechToText !== "local-whisper") {
    addVoiceActivity(chatId, "Select Local Whisper in Board settings before transcribing audio files.");
    return;
  }

  vscode.postMessage({
    type: "pickWhisperAudioFile",
    chatId,
    modelId: board.localWhisperModel
  });
}

function addVoiceActivity(chatId, text) {
  const chat = state.chats.find((item) => item.id === chatId);
  if (!chat) {
    return;
  }

  chat.messages.push({
    role: "activity",
    text,
    at: Date.now()
  });
  chat.updatedAt = Date.now();
  scheduleChatCardRender(chatId);
  persist();
}

function applyVoiceTranscription(chatId, text) {
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  const textarea = card ? card.querySelector(".promptInput") : null;
  const transcript = String(text || "").trim();
  if (!chat || !textarea || !transcript) {
    addVoiceActivity(chatId, "Local Whisper returned an empty transcript.");
    return;
  }

  const base = textarea.value.trim() || voiceBaseText;
  const nextText = [base, transcript].filter(Boolean).join(" ");
  textarea.value = nextText;
  chat.draftPrompt = nextText;
  chat.updatedAt = Date.now();
  resizePromptInput(textarea);
  textarea.focus();
  persist();
}

function applyWhisperLiveText(chatId, text) {
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  const textarea = card ? card.querySelector(".promptInput") : null;
  const chunk = collapseWhisperRepeats(String(text || "").trim());
  if (!chat || !textarea || !chunk) {
    return;
  }

  const lastChunk = nativeWhisperChunks[nativeWhisperChunks.length - 1] || "";
  if (lastChunk === chunk) {
    return;
  }

  const mergedWithLast = lastChunk ? mergeWhisperChunks(lastChunk, chunk) : "";
  if (mergedWithLast) {
    nativeWhisperChunks[nativeWhisperChunks.length - 1] = mergedWithLast;
  } else {
    const duplicateIndex = findSimilarWhisperChunk(nativeWhisperChunks, chunk);
    if (duplicateIndex >= 0) {
      const previous = nativeWhisperChunks[duplicateIndex];
      nativeWhisperChunks[duplicateIndex] = collapseWhisperRepeats(chooseBetterWhisperChunk(previous, chunk));
    } else if (lastChunk && (chunk.startsWith(lastChunk) || lastChunk.startsWith(chunk) || whisperChunksOverlap(lastChunk, chunk))) {
      nativeWhisperChunks[nativeWhisperChunks.length - 1] = collapseWhisperRepeats(chooseBetterWhisperChunk(lastChunk, chunk));
    } else {
      nativeWhisperChunks.push(chunk);
    }
  }
  if (nativeWhisperChunks.length > 80) {
    nativeWhisperChunks = nativeWhisperChunks.slice(-80);
  }

  const base = voiceBaseText || "";
  const nextText = collapseWhisperRepeats([base, nativeWhisperChunks.join(" ")].filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
  textarea.value = nextText;
  chat.draftPrompt = nextText;
  chat.updatedAt = Date.now();
  resizePromptInput(textarea);
  persist();
}

function applyWhisperLiveFinalText(chatId, text) {
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  const textarea = card ? card.querySelector(".promptInput") : null;
  const transcript = collapseWhisperRepeats(String(text || "").trim());
  if (isLikelyWhisperSubtitleCredit(transcript)) {
    return;
  }
  if (!chat || !textarea || !transcript) {
    return;
  }

  const finalTranscript = preserveLiveLeadingPrefix(nativeWhisperChunks.join(" "), transcript);
  nativeWhisperChunks = [finalTranscript];
  const base = voiceBaseText || "";
  const nextText = collapseWhisperRepeats([base, finalTranscript].filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
  textarea.value = nextText;
  chat.draftPrompt = nextText;
  chat.updatedAt = Date.now();
  resizePromptInput(textarea);
  persist();
}

function whisperChunksOverlap(previous, next) {
  const prevWords = String(previous || "").toLowerCase().split(/\s+/).filter(Boolean);
  const nextWords = String(next || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!prevWords.length || !nextWords.length) {
    return false;
  }

  const max = Math.min(5, prevWords.length, nextWords.length);
  for (let count = max; count >= 2; count -= 1) {
    if (prevWords.slice(-count).join(" ") === nextWords.slice(0, count).join(" ")) {
      return true;
    }
  }
  return false;
}

function preserveLiveLeadingPrefix(liveText, finalText) {
  const liveParts = String(liveText || "").trim().split(/\s+/).filter(Boolean);
  const finalParts = String(finalText || "").trim().split(/\s+/).filter(Boolean);
  if (liveParts.length < 2 || finalParts.length < 2) {
    return String(finalText || "").trim();
  }

  const liveWords = liveParts.map(normalizeWhisperWord);
  const finalWords = finalParts.map(normalizeWhisperWord);
  const maxSkip = Math.min(3, liveWords.length - 1);
  for (let skip = 1; skip <= maxSkip; skip += 1) {
    const prefix = liveParts.slice(0, skip);
    if (!isShortWhisperPrefix(prefix)) {
      continue;
    }

    const common = commonWhisperPrefix(liveWords.concat(finalWords), skip, liveWords.length);
    if (common >= Math.min(4, finalWords.length, liveWords.length - skip)) {
      return collapseWhisperRepeats(prefix.concat(finalParts).join(" "));
    }
  }

  return String(finalText || "").trim();
}

function isShortWhisperPrefix(parts) {
  const text = parts.join(" ").toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, "").trim();
  if (!text) {
    return false;
  }
  if (text.length <= 8) {
    return true;
  }
  return /^(ну|а|и|так|да|вот|ладно|короче)(\s|$)/i.test(text);
}

function mergeWhisperChunks(previous, next) {
  const prevParts = String(previous || "").trim().split(/\s+/).filter(Boolean);
  const nextParts = String(next || "").trim().split(/\s+/).filter(Boolean);
  if (prevParts.length < 3 || nextParts.length < 3) {
    return "";
  }

  const prevWords = prevParts.map(normalizeWhisperWord);
  const nextWords = nextParts.map(normalizeWhisperWord);
  const prefix = commonWhisperPrefix(prevWords.concat(nextWords), 0, prevWords.length);
  if (prefix >= 3 && prefix >= Math.min(prevWords.length, nextWords.length) * 0.55) {
    return collapseWhisperRepeats((nextParts.length >= prevParts.length ? nextParts : prevParts).join(" "));
  }

  const best = bestWhisperOverlap(prevWords, nextWords);
  if (!best || best.count < 3) {
    return "";
  }

  const prevCoverage = best.count / Math.max(1, prevWords.length - best.prevStart);
  const nextCoverage = best.count / Math.max(1, Math.min(nextWords.length, best.nextStart + best.count) - best.nextStart);
  if (prevCoverage < 0.55 || nextCoverage < 0.55) {
    return "";
  }

  if (best.nextStart === 0) {
    return collapseWhisperRepeats(prevParts.slice(0, best.prevStart).concat(nextParts).join(" "));
  }

  return collapseWhisperRepeats(prevParts.slice(0, best.prevStart + best.count).concat(nextParts.slice(best.nextStart + best.count)).join(" "));
}

function bestWhisperOverlap(prevWords, nextWords) {
  let best = null;
  const minPrevStart = Math.max(0, prevWords.length - 12);
  const maxNextStart = Math.min(4, nextWords.length - 1);
  for (let prevStart = minPrevStart; prevStart < prevWords.length; prevStart += 1) {
    for (let nextStart = 0; nextStart <= maxNextStart; nextStart += 1) {
      const count = commonWhisperPrefix(prevWords.concat(nextWords), prevStart, prevWords.length + nextStart);
      if (count < 2) {
        continue;
      }
      const reachesPrevEnd = prevStart + count >= prevWords.length - 1;
      if (!reachesPrevEnd) {
        continue;
      }
      if (!best || count > best.count || (count === best.count && nextStart < best.nextStart)) {
        best = { prevStart, nextStart, count };
      }
    }
  }
  return best;
}

function collapseWhisperRepeats(value) {
  let text = stripLikelyWhisperSubtitleCredits(String(value || "").replace(/\s+/g, " ").trim());
  if (!text) {
    return "";
  }

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const collapsed = collapseRepeatedWhisperPrefix(text);
    if (collapsed === text) {
      break;
    }
    text = collapsed;
  }
  return text;
}

function isLikelyWhisperSubtitleCredit(value) {
  const normalized = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 220) {
    return false;
  }

  return [
    /редактор(?:ы)?\s+субтитров/,
    /корректор\s+[а-яa-z.]+/,
    /субтитр(?:ы|ов).{0,24}(?:редактор|корректор|сделал|сделала|создал|создала)/,
    /(?:редакция|тайминг|перевод).{0,24}субтитр/,
    /subtitles?\s+(?:by|edited|editor|correction)/,
    /subtitle\s+(?:editor|correction|corrections)/
  ].some((pattern) => pattern.test(normalized));
}

function isLikelyWhisperSubtitleCredit(value) {
  const normalized = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 260) {
    return false;
  }

  return whisperSubtitleCreditPatterns().some((pattern) => pattern.test(normalized));
}

function stripLikelyWhisperSubtitleCredits(value) {
  return String(value || "")
    .replace(whisperSubtitleCreditInfixPattern(), " ")
    .replace(whisperSubtitleCreditSuffixPattern(), "")
    .replace(/\s+/g, " ")
    .trim();
}

function whisperSubtitleCreditPatterns() {
  return [
    /\u0441\u0443\u0431\u0442\u0438\u0442\u0440(?:\u044b|\u043e\u0432)\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432/u,
    /\u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440(?:\u044b)?\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432/u,
    /\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043e\u0440\s+[\u0430-\u044fa-z.]+/u,
    /\u0441\u0443\u0431\u0442\u0438\u0442\u0440(?:\u044b|\u043e\u0432).{0,32}(?:\u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440|\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043e\u0440|\u0441\u0434\u0435\u043b\u0430\u043b|\u0441\u0434\u0435\u043b\u0430\u043b\u0430|\u0441\u043e\u0437\u0434\u0430\u043b|\u0441\u043e\u0437\u0434\u0430\u043b\u0430)/u,
    /(?:\u0440\u0435\u0434\u0430\u043a\u0446\u0438\u044f|\u0442\u0430\u0439\u043c\u0438\u043d\u0433|\u043f\u0435\u0440\u0435\u0432\u043e\u0434).{0,32}\u0441\u0443\u0431\u0442\u0438\u0442\u0440/u,
    /subtitles?\s+(?:by|edited|editor|correction)/,
    /subtitle\s+(?:editor|correction|corrections)/
  ];
}

function whisperSubtitleCreditSuffixPattern() {
  return /\s*(?:\u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440(?:\u044b)?\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432[\s\S]*|\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043e\u0440\s+[\u0410-\u044f\u0401\u0451A-Za-z.\-\s]+|subtitles?\s+(?:by|edited|editor|correction)[\s\S]*|subtitle\s+(?:editor|correction|corrections)[\s\S]*)$/iu;
}

function whisperSubtitleCreditInfixPattern() {
  return /(?:\u0441\u0443\u0431\u0442\u0438\u0442\u0440(?:\u044b|\u043e\u0432)\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432\s+[\u0410-\u044f\u0401\u0451A-Za-z.]+|\u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440(?:\u044b)?\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432\s+[\u0410-\u044f\u0401\u0451A-Za-z.\-\s]{1,48}|\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043e\u0440\s+[\u0410-\u044f\u0401\u0451A-Za-z.]+|subtitles?\s+(?:by|edited|editor|correction)\s+[A-Za-z.\-\s]{1,48}|subtitle\s+(?:editor|correction|corrections)\s+[A-Za-z.\-\s]{1,48})/giu;
}

function isSilentWhisperStopError(value) {
  const normalized = String(value || "").toLowerCase();
  return normalized.includes("whisper returned an empty transcript")
    || normalized.includes("empty transcript")
    || isLikelyWhisperSubtitleCredit(normalized);
}

function collapseRepeatedWhisperPrefix(value) {
  const text = String(value || "").trim();
  const parts = text.split(/\s+/);
  if (parts.length < 6) {
    return text;
  }

  const words = parts.map(normalizeWhisperWord);
  const maxStart = Math.min(Math.floor(parts.length / 2), 14);
  for (let start = 3; start <= maxStart; start += 1) {
    const common = commonWhisperPrefix(words, 0, start);
    if (common < 3) {
      continue;
    }

    const coverage = common / start;
    if (coverage >= 0.62) {
      return parts.slice(start).join(" ").replace(/^[,.!?;:…-]+\s*/, "").trim();
    }
  }

  const sentenceMatch = /^(.{12,160}?[.!?…])\s+(.+)$/u.exec(text);
  if (sentenceMatch) {
    const firstWords = normalizeWhisperWords(sentenceMatch[1]);
    const restWords = normalizeWhisperWords(sentenceMatch[2]);
    const common = commonWhisperPrefix(firstWords.concat(restWords), 0, firstWords.length);
    if (firstWords.length >= 3 && common / firstWords.length >= 0.62) {
      return sentenceMatch[2].trim();
    }
  }

  return text;
}

function commonWhisperPrefix(words, leftStart, rightStart) {
  let count = 0;
  while (leftStart + count < words.length && rightStart + count < words.length) {
    if (!whisperWordsSimilar(words[leftStart + count], words[rightStart + count])) {
      break;
    }
    count += 1;
  }
  return count;
}

function whisperWordsSimilar(left, right) {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  if (left.length < 4 || right.length < 4) {
    return false;
  }
  return left.startsWith(right.slice(0, 4)) || right.startsWith(left.slice(0, 4));
}

function findSimilarWhisperChunk(chunks, chunk) {
  const start = Math.max(0, chunks.length - 4);
  for (let index = chunks.length - 1; index >= start; index -= 1) {
    if (whisperChunkSimilarity(chunks[index], chunk) >= 0.58) {
      return index;
    }
  }
  return -1;
}

function chooseBetterWhisperChunk(previous, next) {
  const prev = String(previous || "").trim();
  const candidate = String(next || "").trim();
  if (!prev) {
    return candidate;
  }
  if (!candidate) {
    return prev;
  }
  return candidate.length >= prev.length ? candidate : prev;
}

function whisperChunkSimilarity(left, right) {
  const leftWords = normalizeWhisperWords(left);
  const rightWords = normalizeWhisperWords(right);
  if (!leftWords.length || !rightWords.length) {
    return 0;
  }

  const leftSet = new Set(leftWords);
  const rightSet = new Set(rightWords);
  let overlap = 0;
  for (const word of leftSet) {
    if (rightSet.has(word)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftSet.size, rightSet.size);
}

function normalizeWhisperWords(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

function normalizeWhisperWord(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function sendPrompt(chatId) {
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  if (!chat || !card || chat.status === "running") {
    return;
  }

  const textarea = card.querySelector(".promptInput");
  const prompt = textarea.value.trim();
  const attachments = Array.isArray(chat.pendingAttachments) ? chat.pendingAttachments : [];
  if (!prompt && !attachments.length) {
    textarea.focus();
    return;
  }

  if (voiceChatId === chatId) {
    stopVoiceInput();
  }

  const messages = card.querySelector(".messages");
  if (messages && !isScrolledToBottom(messages)) {
    pauseChatAutoScroll(chatId, messages);
    rememberMessageScroll(chatId, messages, undefined, false);
  } else {
    resumeChatAutoScroll(chatId);
  }

  textarea.value = "";
  const now = Date.now();
  chat.status = "running";
  chat.draftPrompt = "";
  chat.pendingAttachments = [];
  chat.updatedAt = now;
  chat.runStartedAt = now;
  chat.runFinishedAt = 0;
  chat.isThinking = false;
  chat.messages.push({
    role: "user",
    text: userMessageText(prompt, attachments),
    at: now
  });

  const finalPrompt = promptWithAttachments(prompt, attachments);
  renderChatCard(chatId);
  persist();
  vscode.postMessage({
    type: "sendPrompt",
    chatId,
    prompt: finalPrompt,
    sessionId: chat.sessionId,
    settings: chat.settings,
    projectPath: chat.projectPath || currentWorkspacePath() || "",
    state
  });
}

function normalizeAttachment(item) {
  const attachment = item || {};
  return {
    id: String(attachment.id || newId()),
    name: String(attachment.name || "file"),
    path: String(attachment.path || ""),
    relativePath: String(attachment.relativePath || ""),
    size: Number(attachment.size || 0),
    isText: Boolean(attachment.isText),
    truncated: Boolean(attachment.truncated),
    content: String(attachment.content || "").slice(0, MAX_ATTACHMENT_BYTES)
  };
}

function userMessageText(prompt, attachments) {
  const files = attachmentListText(attachments);
  if (!files) {
    return prompt;
  }

  return (prompt || "Attached files") + "\n\n" + files;
}

function promptWithAttachments(prompt, attachments) {
  if (!attachments || !attachments.length) {
    return prompt;
  }

  let output = prompt || "Use the attached file(s) as context.";
  output += "\n\nAttached files:";

  for (const attachment of attachments) {
    const label = attachment.relativePath || attachment.path || attachment.name || "file";
    output += "\n\n--- " + label + (attachment.size ? " (" + formatBytes(attachment.size) + ")" : "") + " ---\n";

    if (attachment.content) {
      output += attachment.content;
      if (attachment.truncated) {
        output += "\n[Attachment truncated to " + formatBytes(MAX_ATTACHMENT_BYTES) + "]";
      }
    } else if (attachment.path) {
      output += "Path: " + attachment.path + "\n";
      output += attachment.isText ? "[No preview content available]" : "[Binary or unreadable file]";
    } else {
      output += "[No readable text content from dropped file]";
    }
  }

  return output;
}

function attachmentListText(attachments) {
  if (!attachments || !attachments.length) {
    return "";
  }

  return "Attached: " + attachments.map((attachment) => {
    const label = attachment.relativePath || attachment.name || "file";
    return label + (attachment.size ? " (" + formatBytes(attachment.size) + ")" : "");
  }).join(", ");
}

function chatInfoHtml(chat) {
  const stats = chatInfoStats(chat);
  const settings = normalizeSettings(chat.settings);
  const context = contextUsageInfo(chat, settings.model);
  const sandboxLabel = selectedLabel(settings.sandbox, [
    ["read-only", "Read access"],
    ["workspace-write", "Write access"],
    ["danger-full-access", "Full access"]
  ]);
  const reasoningLabel = selectedLabel(settings.reasoning, [
    ["minimal", "Minimal"],
    ["low", "Low"],
    ["medium", "Medium"],
    ["high", "High"],
    ["xhigh", "Extra High"]
  ]);
  const verbosityLabel = selectedLabel(settings.verbosity, [
    ["low", "Short"],
    ["medium", "Normal"],
    ["high", "Full"]
  ]);
  const webLabel = selectedLabel(settings.webSearch, [
    ["disabled", "Web off"],
    ["cached", "Web"],
    ["live", "Live web"]
  ]);
  const projectPath = normalizeProjectPath(chat.projectPath || currentWorkspacePath() || "");
  const projectLabel = projectPath || "No project selected";
  const workspacePath = currentWorkspacePath();

  return `
    <section class="chatInfoSummary">
      <p class="chatInfoTitle">${escapeHtml(chat.title || "Codex chat")}</p>
      <div class="chatInfoMeta">
        <span>${escapeHtml(statusLabel(chat.status))}</span>
        <span>${escapeHtml(stats.ageLabel)}</span>
        <span>${escapeHtml(formatTokenCount(context.used))} / ${escapeHtml(formatTokenCount(context.limit))} tokens</span>
      </div>
    </section>

    <section class="chatInfoSection">
      <h3>Project</h3>
      <div class="chatInfoGrid">
        ${chatInfoItem("Chat project", projectLabel, true)}
        ${chatInfoItem("Current workspace", workspacePath || "No workspace folder", true)}
      </div>
      <div class="chatInfoProjectActions">
        <button id="chooseChatProject" type="button">Choose project</button>
        <button id="chooseCurrentWorkspace" type="button">Choose current workspace</button>
        <button id="useWorkspaceProject" type="button" ${workspacePath ? "" : "disabled"}>Use current workspace</button>
      </div>
    </section>

    <section class="chatInfoSection">
      <h3>Timeline</h3>
      <div class="chatInfoGrid">
        ${chatInfoItem("Created", formatDateTime(stats.createdAt))}
        ${chatInfoItem("Updated", formatDateTime(stats.updatedAt))}
        ${chatInfoItem("Last opened", stats.lastOpenedAt ? formatDateTime(stats.lastOpenedAt) : "Never")}
        ${chatInfoItem("Thread", chat.sessionId || "Not started", true)}
      </div>
    </section>

    <section class="chatInfoSection">
      <h3>Messages</h3>
      <div class="chatInfoGrid">
        ${chatInfoItem("Total messages", stats.messageCount)}
        ${chatInfoItem("User messages", stats.userCount)}
        ${chatInfoItem("Assistant answers", stats.assistantCount)}
        ${chatInfoItem("System / activity", stats.systemCount + stats.activityCount)}
        ${chatInfoItem("Errors", stats.errorCount)}
        ${chatInfoItem("File change cards", stats.changeSummaryCount)}
      </div>
    </section>

    <section class="chatInfoSection">
      <h3>Tokens</h3>
      <div class="chatInfoGrid">
        ${chatInfoItem("Estimated total", formatTokenCount(stats.totalTokens))}
        ${chatInfoItem("Incoming", formatTokenCount(stats.incomingTokens))}
        ${chatInfoItem("Outgoing", formatTokenCount(stats.outgoingTokens))}
        ${chatInfoItem("Events / metadata", formatTokenCount(stats.eventTokens))}
        ${chatInfoItem("Context used", context.percent + "%")}
        ${chatInfoItem("Context window", formatTokenCount(context.limit))}
      </div>
    </section>

    <section class="chatInfoSection">
      <h3>Tools and Events</h3>
      <div class="chatInfoGrid">
        ${chatInfoItem("Tool / event calls", stats.eventCount)}
        ${chatInfoItem("Running events", stats.runningEventCount)}
        ${chatInfoItem("Finished events", stats.doneEventCount)}
        ${chatInfoItem("Failed events", stats.failedEventCount)}
      </div>
      ${stats.eventKindList ? '<ul class="chatInfoList">' + stats.eventKindList + '</ul>' : '<p class="modalHint">No tool or command events recorded yet.</p>'}
    </section>

    <section class="chatInfoSection">
      <h3>Settings</h3>
      <div class="chatInfoGrid">
        ${chatInfoItem("Model", modelDisplayLabel(settings.model))}
        ${chatInfoItem("Reasoning", reasoningLabel)}
        ${chatInfoItem("Verbosity", verbosityLabel)}
        ${chatInfoItem("Web", webLabel)}
        ${chatInfoItem("Filesystem", sandboxLabel)}
        ${chatInfoItem("Pending attachments", stats.attachmentLabel)}
      </div>
    </section>
  `;
}

function chatInfoItem(label, value, mono) {
  return `
    <div class="chatInfoItem">
      <span class="chatInfoLabel">${escapeHtml(label)}</span>
      <span class="chatInfoValue${mono ? " chatInfoMono" : ""}">${escapeHtml(value)}</span>
    </div>
  `;
}

function chatInfoStats(chat) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const attachments = Array.isArray(chat.pendingAttachments) ? chat.pendingAttachments : [];
  const messageTimes = messages.map((item) => Number(item.at || 0)).filter((value) => Number.isFinite(value) && value > 0);
  const now = Date.now();
  const firstMessageAt = messageTimes.length ? Math.min.apply(null, messageTimes) : now;
  const lastMessageAt = messageTimes.length ? Math.max.apply(null, messageTimes) : firstMessageAt;
  const createdAt = Number(chat.createdAt || firstMessageAt || now) || now;
  const updatedAt = Number(chat.updatedAt || chat.lastOpenedAt || lastMessageAt || createdAt) || createdAt;
  const roleCounts = {};
  const eventKinds = {};
  const eventStatuses = {};

  for (const message of messages) {
    const role = String(message.role || "assistant");
    roleCounts[role] = (roleCounts[role] || 0) + 1;
    if (role === "event") {
      const kind = String(message.kind || "event");
      const status = String(message.status || "info");
      eventKinds[kind] = (eventKinds[kind] || 0) + 1;
      eventStatuses[status] = (eventStatuses[status] || 0) + 1;
    }
  }

  const attachmentBytes = attachments.reduce((sum, item) => sum + Number(item.size || 0), 0);
  const attachmentLabel = attachments.length
    ? attachments.length + " / " + formatBytes(attachmentBytes)
    : "None";
  const eventKindList = Object.keys(eventKinds)
    .sort()
    .map((kind) => '<li>' + escapeHtml(eventBadge(kind, "") + " " + eventKinds[kind]) + '</li>')
    .join("");

  return {
    createdAt,
    updatedAt,
    lastOpenedAt: Number(chat.lastOpenedAt || 0),
    ageLabel: "Created " + formatDuration(now - createdAt) + " ago",
    messageCount: messages.length,
    userCount: roleCounts.user || 0,
    assistantCount: roleCounts.assistant || 0,
    systemCount: roleCounts.system || 0,
    activityCount: roleCounts.activity || 0,
    errorCount: roleCounts.error || 0,
    changeSummaryCount: roleCounts.changeSummary || 0,
    eventCount: roleCounts.event || 0,
    runningEventCount: eventStatuses.running || 0,
    doneEventCount: eventStatuses.done || 0,
    failedEventCount: eventStatuses.error || 0,
    eventKindList,
    attachmentLabel,
    totalTokens: estimateChatTokens(chat),
    incomingTokens: estimateTokensForRoles(chat, ["user", "system"]) + estimateAttachmentTokens(chat),
    outgoingTokens: estimateTokensForRoles(chat, ["assistant"]),
    eventTokens: estimateTokensForRoles(chat, ["activity", "event", "error", "changeSummary"])
  };
}

function estimateTokensForRoles(chat, roles) {
  const accepted = new Set(roles);
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  let chars = 0;
  let overhead = 0;

  for (const message of messages) {
    if (!accepted.has(String(message.role || ""))) {
      continue;
    }

    chars += String(message.text || "").length;
    chars += String(message.title || "").length;
    chars += String(message.detail || "").length;
    overhead += 12;
  }

  return Math.max(0, Math.ceil(chars / 4) + overhead);
}

function estimateAttachmentTokens(chat) {
  const attachments = Array.isArray(chat.pendingAttachments) ? chat.pendingAttachments : [];
  let chars = 0;
  let overhead = 0;

  for (const attachment of attachments) {
    chars += String(attachment.name || "").length;
    chars += String(attachment.path || "").length;
    chars += String(attachment.content || "").length;
    overhead += 12;
  }

  return Math.max(0, Math.ceil(chars / 4) + overhead);
}

function formatDateTime(value) {
  const date = new Date(Number(value || 0));
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString();
}

function formatMessageTime(value) {
  const date = new Date(Number(value || 0));
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  if (seconds < 60) {
    return seconds + "s";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return minutes + "m" + (rest ? " " + rest + "s" : "");
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return hours + "h" + (rest ? " " + rest + "m" : "");
  }
  return Math.floor(hours / 24) + "d";
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) {
    return bytes + " B";
  }

  if (bytes < 1024 * 1024) {
    return Math.round(bytes / 102.4) / 10 + " KB";
  }

  return Math.round(bytes / 1024 / 102.4) / 10 + " MB";
}

function option(value, label, selectedValue) {
  return '<option value="' + escapeAttr(value) + '"' + (value === selectedValue ? " selected" : "") + '>' + escapeHtml(label) + '</option>';
}

function renderContextIndicator(info) {
  const angle = Math.max(0, Math.min(360, Math.round(info.percent * 36) / 10));
  return '<button class="contextIndicator" type="button" data-action="context-info" style="--contextAngle: ' + angle + 'deg;" title="' + escapeAttr(info.tooltip + "\nClick for chat information") + '" aria-label="' + escapeAttr(info.tooltip + "\nOpen chat information") + '"></button>';
}

function renderWorkspaceSelector() {
  const workspace = activeWorkspaceProfile();
  const label = workspace ? workspace.name : "Workspace";
  const pathLabel = workspace && workspace.path ? workspace.path : "Codex Max workspace";
  return '<button id="workspaceSelector" class="workspaceSelector" type="button" title="' + escapeAttr(pathLabel) + '" aria-haspopup="listbox" aria-expanded="false"><span>' + escapeHtml(label) + '</span></button>';
}

function renderBoardUsage(info) {
  if (accountRateLimitsLoading) {
    return `
      <button class="boardUsage loading ${escapeAttr(info.statusClass)}" type="button" title="Refreshing account limits..." aria-label="Refreshing account limits">
        <span class="usageDot" aria-hidden="true"></span>
        <span>Refreshing limits...</span>
      </button>
    `;
  }

  return `
    <button class="boardUsage ${escapeAttr(info.statusClass)}" type="button" title="${escapeAttr(info.tooltip + "\nClick to refresh")}" aria-label="${escapeAttr(info.tooltip + "\nRefresh account limits")}">
      <span class="usageDot" aria-hidden="true"></span>
      <span>5h <strong>${escapeHtml(info.fiveHourLabel)}</strong></span>
      <span>Week <strong>${escapeHtml(info.weeklyLabel)}</strong></span>
      <span>Status <strong>${escapeHtml(info.statusLabel)}</strong></span>
      <span>Resets <strong>${escapeHtml(info.limitResetLabel)}</strong></span>
    </button>
  `;
}

function boardUsageInfo(chats, accountRateLimits) {
  const items = Array.isArray(chats) ? chats : [];
  let used = 0;
  let limit = 0;
  let running = 0;
  let errors = 0;
  let opened = 0;
  const accountUsage = accountUsageInfo(accountRateLimits);
  const resetCredits = extractLimitResetCredits(accountRateLimits);

  for (const chat of items) {
    const settings = normalizeSettings(chat && chat.settings);
    const context = contextUsageInfo(chat, settings.model);
    used += context.used;
    limit += context.limit;
    if (chat.status === "running") {
      running += 1;
    } else if (chat.status === "error") {
      errors += 1;
    } else if (chat.status === "opened") {
      opened += 1;
    }
  }

  const percent = limit ? Math.max(0, Math.min(100, Math.round((used / limit) * 100))) : 0;
  const statusClass = running ? "running" : errors ? "error" : opened ? "opened" : "idle";
  const statusLabelText = running ? "Running" : errors ? "Error" : opened ? "Open" : "Idle";
  const fiveHourLabel = accountUsage ? accountUsage.fiveHourLabel : percent + "%";
  const weeklyLabel = accountUsage ? accountUsage.weeklyLabel : "n/a";
  const limitResetLabel = resetCredits;
  const tooltip = [
    "Board usage/status",
    accountUsage ? accountUsage.tooltip : "Usage: " + percent + "% (" + formatTokenCount(used) + " / " + formatTokenCount(limit || 0) + " tokens)",
    "Status: " + statusLabelText + " (" + running + " running, " + errors + " error, " + opened + " open)",
    "Available manual limit resets: " + resetCredits
  ].join("\n");

  return {
    used,
    limit,
    percent,
    fiveHourLabel,
    weeklyLabel,
    statusClass,
    statusLabel: statusLabelText,
    limitResetLabel,
    tooltip
  };
}

function accountUsageInfo(value) {
  const limits = extractAccountLimits(value);
  if (!limits.length) {
    return null;
  }

  const fiveHour = limits.find((item) => item.kind === "5h") || limits[0];
  const weekly = limits.find((item) => item.kind === "weekly") || limits.find((item) => item !== fiveHour) || null;
  const tooltip = ["Account usage:"];

  for (const item of [fiveHour, weekly].filter(Boolean)) {
    const label = item.kind === "weekly" ? "Week" : item.kind === "5h" ? "5h" : item.label;
    tooltip.push(label + ": " + item.remainingPercent + "% remaining" + (item.resetLabel ? ", auto reset " + item.resetLabel : ""));
  }

  return {
    fiveHourLabel: fiveHour ? fiveHour.remainingPercent + "%" : "n/a",
    weeklyLabel: weekly ? weekly.remainingPercent + "%" : "n/a",
    tooltip: tooltip.join("\n")
  };
}

function extractLimitResetCredits(value) {
  if (!value || typeof value !== "object") {
    return "n/a";
  }

  const candidates = [];
  const queue = [{ value, path: [] }];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    const item = current.value;
    if (!item || typeof item !== "object" || seen.has(item)) {
      continue;
    }
    seen.add(item);

    for (const key of Object.keys(item)) {
      const child = item[key];
      const pathText = current.path.concat(key).join(" ");
      const normalizedPath = normalizeLimitKey(pathText);
      const looksLikeManualReset =
        /reset/i.test(pathText) &&
        /(available|remaining|left|count|credits|requests|manual)/i.test(pathText);

      if (looksLikeManualReset && Number.isFinite(Number(child))) {
        candidates.push({
          score: manualResetScore(normalizedPath),
          value: Number(child)
        });
      }

      if (typeof child === "string") {
        const match = child.match(/(?:available|remaining|left)\D*(\d+)\D*(?:reset|resets)/i)
          || child.match(/(?:reset|resets)\D*(\d+)/i);
        if (match) {
          candidates.push({
            score: manualResetScore(normalizedPath) + 1,
            value: Number(match[1])
          });
        }
      }

      if (child && typeof child === "object") {
        queue.push({ value: child, path: current.path.concat(key) });
      }
    }
  }

  if (!candidates.length) {
    return "n/a";
  }

  const useful = candidates.filter((item) => item.score > 0);
  if (!useful.length) {
    return "n/a";
  }

  useful.sort((a, b) => b.score - a.score);
  return String(useful[0].value);
}

function manualResetScore(normalizedPath) {
  let score = 0;
  if (/manual|credit|request|available|remaining/.test(normalizedPath)) {
    score += 4;
  }
  if (/limit/.test(normalizedPath)) {
    score += 2;
  }
  if (/reset/.test(normalizedPath)) {
    score += 2;
  }
  if (/resetat|resetsat|resetafter|renew|refresh|time|timestamp/.test(normalizedPath)) {
    score -= 8;
  }
  return score;
}

function extractAccountLimits(value) {
  if (!value || typeof value !== "object") {
    return [];
  }

  const candidates = [];
  const queue = [{ value, path: [] }];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    const item = current.value;
    if (!item || typeof item !== "object" || seen.has(item)) {
      continue;
    }
    seen.add(item);

    for (const key of Object.keys(item)) {
      const child = item[key];
      if (child && typeof child === "object") {
        queue.push({ value: child, path: current.path.concat(key) });
      }
    }

    const limit = parseLimitNode(item, current.path);
    if (limit) {
      candidates.push(limit);
    }
  }

  const unique = [];
  const seenKeys = new Set();
  for (const item of candidates) {
    const key = item.kind + ":" + item.remainingPercent + ":" + item.resetLabel;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      unique.push(item);
    }
  }

  return unique.sort((a, b) => {
    const order = { "5h": 0, weekly: 1, other: 2 };
    return (order[a.kind] || 2) - (order[b.kind] || 2);
  });
}

function parseLimitNode(item, pathParts) {
  const entries = Object.keys(item).map((key) => ({
    key,
    normalized: normalizeLimitKey(key),
    value: item[key]
  }));
  const remaining = findRemainingPercent(entries);
  if (remaining === null) {
    return null;
  }

  const resetLabel = findResetLabel(entries);
  const labelText = pathParts.concat(entries.map((entry) => {
    return typeof entry.value === "string" ? entry.value : "";
  })).join(" ").toLowerCase();
  const kind = classifyLimitWindow(entries, labelText);

  return {
    kind,
    label: kind === "other" ? "Limit" : kind,
    remainingPercent: remaining,
    resetLabel
  };
}

function findRemainingPercent(entries) {
  const direct = findNumericEntry(entries, /(remaining|available|left).*(percent|pct)|(percent|pct).*(remaining|available|left)/);
  if (direct !== null) {
    return normalizePercent(direct);
  }

  const used = findNumericEntry(entries, /(used|usage|consumed).*(percent|pct)|(percent|pct).*(used|usage|consumed)/);
  if (used !== null) {
    return Math.max(0, Math.min(100, 100 - normalizePercent(used)));
  }

  return null;
}

function findNumericEntry(entries, pattern) {
  for (const entry of entries) {
    if (pattern.test(entry.normalized) && Number.isFinite(Number(entry.value))) {
      return Number(entry.value);
    }
  }
  return null;
}

function normalizePercent(value) {
  const number = Number(value);
  const percent = number <= 1 ? number * 100 : number;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function findResetLabel(entries) {
  for (const entry of entries) {
    if (!/reset|renew|refresh/.test(entry.normalized)) {
      continue;
    }

    const value = entry.value;
    if (typeof value === "string" && value.trim()) {
      return formatResetValue(value.trim());
    }
    if (Number.isFinite(Number(value))) {
      return formatResetValue(Number(value));
    }
  }
  return "";
}

function formatResetValue(value) {
  if (typeof value === "number") {
    if (value > 100000000000) {
      return formatDateTime(value);
    }
    if (value > 1000000000) {
      return formatDateTime(value * 1000);
    }
    if (value >= 0 && value < 60 * 60 * 24 * 14) {
      return formatDuration(value * 1000);
    }
    return String(value);
  }

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return formatDateTime(date.getTime());
  }
  return value;
}

function classifyLimitWindow(entries, labelText) {
  const text = labelText + " " + entries.map((entry) => entry.normalized + " " + entry.value).join(" ");
  if (/week|weekly|7d|seven|10080|secondary|long/.test(text)) {
    return "weekly";
  }
  if (/5h|5hr|5hour|fivehour|five|300|primary|short|rolling/.test(text)) {
    return "5h";
  }
  return "other";
}

function normalizeLimitKey(value) {
  return String(value || "").replace(/[_\-\s]/g, "").toLowerCase();
}

function contextUsageInfo(chat, model) {
  const limit = contextWindowForModel(model);
  const used = estimateChatTokens(chat);
  const percent = limit ? Math.max(0, Math.min(100, (used / limit) * 100)) : 0;
  const displayPercent = Math.round(percent);
  const tooltip = [
    "Context window:",
    displayPercent + "% full",
    formatTokenCount(used) + " / " + formatTokenCount(limit) + " tokens used"
  ].join("\n");

  return {
    used,
    limit,
    percent,
    tooltip
  };
}

function contextWindowForModel(model) {
  const normalized = normalizeModelId(model);
  if (/^gpt-5\./.test(normalized)) {
    return 258000;
  }
  if (normalized === "o3") {
    return 200000;
  }
  if (normalized === "o4-mini") {
    return 128000;
  }

  return 128000;
}

function estimateChatTokens(chat) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const attachments = Array.isArray(chat.pendingAttachments) ? chat.pendingAttachments : [];
  let chars = 0;
  let overhead = messages.length * 8;

  for (const message of messages) {
    chars += String(message.text || "").length;
    chars += String(message.title || "").length;
    chars += String(message.detail || "").length;
    overhead += 4;
  }

  for (const attachment of attachments) {
    chars += String(attachment.name || "").length;
    chars += String(attachment.path || "").length;
    chars += String(attachment.content || "").length;
    overhead += 12;
  }

  return Math.max(0, Math.ceil(chars / 4) + overhead);
}

function formatTokenCount(value) {
  const tokens = Number(value || 0);
  if (tokens >= 1000000) {
    return Math.round(tokens / 100000) / 10 + "m";
  }
  if (tokens >= 1000) {
    return Math.round(tokens / 100) / 10 + "k";
  }
  return String(tokens);
}

function selectChip(setting, title, selectedValue, choices, disabled) {
  const label = selectedLabel(selectedValue, choices);
  const options = choices.map((item) => ({
    value: item[0],
    label: item[1]
  }));
  return `
    <button class="selectChip" type="button" data-select-setting="${escapeAttr(setting)}" data-select-value="${escapeAttr(selectedValue)}" data-select-options="${escapeAttr(JSON.stringify(options))}" title="${escapeAttr(title)}" ${disabled ? "disabled" : ""}>
      <span class="selectChipText">${escapeHtml(label)}</span>
    </button>
  `;
}

function selectedLabel(selectedValue, choices) {
  const found = choices.find((item) => item[0] === selectedValue);
  return found ? found[1] : String(selectedValue || "");
}

function modelSelectChip(selectedValue, disabled) {
  const selected = normalizeModelId(selectedValue) || "gpt-5.5";
  const choices = modelChoices(selected);
  return selectChip("model", "Model", selected, choices, disabled);
}

function modelOptions(selectedValue) {
  const selected = normalizeModelId(selectedValue) || "gpt-5.5";
  return modelChoices(selected).map((item) => option(item[0], item[1], selected)).join("");
}

function modelDisplayLabel(value) {
  const selected = normalizeModelId(value) || "gpt-5.5";
  const match = modelChoices(selected).find((item) => item[0] === selected);
  return match ? match[1] : selected;
}

function modelChoices(selected) {
  const models = [
    ["gpt-5.5", "5.5"],
    ["gpt-5.4", "5.4"],
    ["gpt-5.3", "5.3"],
    ["o3", "o3"],
    ["o4-mini", "o4-mini"]
  ];

  if (selected && !models.some((item) => item[0] === selected)) {
    models.push([selected, selected]);
  }

  return models;
}

function normalizeSettings(settings) {
  const next = Object.assign({}, DEFAULT_CHAT_SETTINGS, settings || {});
  const reasoning = ["minimal", "low", "medium", "high", "xhigh"].includes(next.reasoning) ? next.reasoning : DEFAULT_CHAT_SETTINGS.reasoning;
  const verbosity = ["low", "medium", "high"].includes(next.verbosity) ? next.verbosity : DEFAULT_CHAT_SETTINGS.verbosity;
  const sandbox = ["read-only", "workspace-write", "danger-full-access"].includes(next.sandbox) ? next.sandbox : DEFAULT_CHAT_SETTINGS.sandbox;
  const webSearch = ["disabled", "cached", "live"].includes(next.webSearch) ? next.webSearch : DEFAULT_CHAT_SETTINGS.webSearch;

  return {
    model: normalizeModelId(next.model) || DEFAULT_CHAT_SETTINGS.model,
    reasoning,
    verbosity,
    sandbox,
    webSearch
  };
}

function normalizeModelId(value) {
  const model = typeof value === "string" ? value.trim() : "";
  const aliases = {
    "5.5": "gpt-5.5",
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3"
  };

  return aliases[model] || model;
}

function normalizeVoiceShortcut(value) {
  const shortcut = String(value || "").trim().toLowerCase();
  return ["off", "alt-v", "ctrl-shift-v", "ctrl-m"].includes(shortcut) ? shortcut : "alt-v";
}

function normalizeSpeechToTextEngine(value) {
  const engine = String(value || "").trim().toLowerCase();
  return ["off", "browser", "local-whisper"].includes(engine) ? engine : "browser";
}

function normalizeLocalWhisperModel(value) {
  const modelId = String(value || "").trim();
  return LOCAL_WHISPER_MODELS.some((model) => model.id === modelId) ? modelId : "small-q5_1";
}

function normalizeLocalWhisperCaptureId(value) {
  const captureId = Number.parseInt(value, 10);
  return Number.isFinite(captureId) ? Math.max(-1, Math.min(32, captureId)) : -1;
}

function normalizeWhisperStopGraceMs(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_WHISPER_LIVE_STOP_GRACE_MS;
  }

  return clampInt(parsed, 100, 10000);
}

function normalizeBoardSettings(settings) {
  const fallback = Number(config.defaultChatsPerRow) || 3;
  const rowFallback = Number(config.defaultChatsPerColumn) || 2;
  const next = Object.assign({ chatsPerRow: fallback, chatsPerColumn: rowFallback, maxChatHeight: 0, chatBackground: DEFAULT_CHAT_BACKGROUND, sendWithCtrlEnter: false, autoScroll: true, voiceShortcut: "alt-v", speechToText: "browser", localWhisperModel: "small-q5_1", localWhisperCaptureId: -1, localWhisperStopGraceMs: DEFAULT_WHISPER_LIVE_STOP_GRACE_MS, currentWorkspacePath: "" }, settings || {});
  const chatBackground = String(next.chatBackground || "").toLowerCase() === "#212121"
    ? DEFAULT_CHAT_BACKGROUND
    : next.chatBackground;

  return {
    chatsPerRow: clampInt(next.chatsPerRow, 1, 12),
    chatsPerColumn: clampInt(next.chatsPerColumn, 1, 6),
    maxChatHeight: normalizeMaxChatHeight(next.maxChatHeight),
    chatBackground: normalizeHexColor(chatBackground, DEFAULT_CHAT_BACKGROUND),
    sendWithCtrlEnter: Boolean(next.sendWithCtrlEnter),
    autoScroll: next.autoScroll !== false,
    voiceShortcut: normalizeVoiceShortcut(next.voiceShortcut),
    speechToText: normalizeSpeechToTextEngine(next.speechToText),
    localWhisperModel: normalizeLocalWhisperModel(next.localWhisperModel),
    localWhisperCaptureId: normalizeLocalWhisperCaptureId(next.localWhisperCaptureId),
    localWhisperStopGraceMs: normalizeWhisperStopGraceMs(next.localWhisperStopGraceMs),
    currentWorkspacePath: normalizeProjectPath(next.currentWorkspacePath || "")
  };
}

function normalizeHexColor(value, fallback) {
  const text = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) {
    return text.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(text)) {
    return "#" + text.toLowerCase();
  }
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return "#" + text.slice(1).split("").map((char) => char + char).join("").toLowerCase();
  }
  return fallback;
}

function normalizeProjectPath(value) {
  return String(value || "").trim();
}

function currentWorkspacePathFromSettings(settings) {
  const board = normalizeBoardSettings(settings);
  return normalizeProjectPath(board.currentWorkspacePath || config.workspacePath || "");
}

function currentWorkspacePath() {
  return currentWorkspacePathFromSettings(state.boardSettings);
}

function projectFolderName(value) {
  const clean = normalizeProjectPath(value).replace(/[\\/]+$/, "");
  if (!clean) {
    return "";
  }

  return clean.split(/[\\/]/).pop() || clean;
}

function chatTitleBase(value) {
  return (String(value || "Codex chat").replace(/\s*\[[^\[\]]+\]\s*$/, "").trim() || "Codex chat");
}

function chatTitleWithProject(title, projectPath) {
  const base = chatTitleBase(title);
  const folder = projectFolderName(projectPath);
  return folder ? base + " [" + folder + "]" : base;
}

function normalizeRateLimits(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function normalizeMaxChatHeight(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return clampInt(parsed, 280, 2400);
}

function clampInt(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return min;
  }

  return Math.min(max, Math.max(min, parsed));
}

function addAssistantMessage(chatId, text) {
  if (!text) {
    return;
  }

  updateChat(chatId, (chat) => {
    const finishedAt = chat.runFinishedAt || Date.now();
    chat.runFinishedAt = finishedAt;
    chat.isThinking = false;
    chat.messages.push({
      role: "assistant",
      text,
      at: finishedAt,
      runStartedAt: Number(chat.runStartedAt || 0),
      runFinishedAt: finishedAt
    });
  });
}

function addMessage(chatId, role, text) {
  if (!text) {
    return;
  }

  updateChat(chatId, (chat) => {
    chat.messages.push({
      role,
      text,
      at: Date.now()
    });
  });
}

function addEventMessage(chatId, event) {
  if (!event) {
    return;
  }

  const renderOptions = { render: "event", eventId: "" };
  updateChat(chatId, (chat) => {
    const eventId = event.eventId ? String(event.eventId) : "";
    renderOptions.eventId = eventId;
    const existing = eventId
      ? chat.messages.find((message) => message.role === "event" && message.eventId === eventId && message.status === "running")
      : null;
    const next = {
      role: "event",
      eventId,
      kind: String(event.kind || "event"),
      status: String(event.status || "info"),
      title: String(event.title || "Codex event"),
      detail: String(event.detail || ""),
      text: String(event.title || "Codex event"),
      raw: event.raw ? String(event.raw) : "",
      changes: Array.isArray(event.changes) ? event.changes.map(normalizeChangeEntry) : [],
      at: Date.now()
    };

    if (existing) {
      existing.kind = next.kind;
      existing.status = next.status;
      existing.title = next.title;
      existing.detail = next.detail;
      existing.text = next.text;
      existing.raw = next.raw;
      existing.changes = next.changes;
      return;
    }

    chat.messages.push(next);
  }, renderOptions);
}

function updateChat(chatId, updater, options) {
  const updateOptions = options && typeof options === "object" ? options : {};
  const chat = state.chats.find((item) => item.id === chatId);
  if (!chat) {
    const workspace = workspaceList().find((item) => {
      return Array.isArray(item.chats) && item.chats.some((candidate) => candidate.id === chatId);
    });
    const hiddenChat = workspace && workspace.chats.find((item) => item.id === chatId);
    if (hiddenChat) {
      updater(hiddenChat);
      hiddenChat.updatedAt = Date.now();
      persist();
    }
    return;
  }

  updater(chat);
  chat.updatedAt = Date.now();
  if (updateOptions.render === "chrome") {
    renderChatChrome(chatId);
  } else if (updateOptions.render === "event" && updateOptions.eventId && renderEventMessage(chatId, updateOptions.eventId)) {
    // Updated a single existing event in place.
  } else {
    scheduleChatCardRender(chatId);
  }
  persist();
}

function persist() {
  syncActiveWorkspaceFromState();
  vscode.setState(state);
  vscode.postMessage({ type: "persist", state });
}

function syncActiveWorkspaceFromState() {
  const workspace = activeWorkspaceProfile();
  if (!workspace) {
    return;
  }

  const board = normalizeBoardSettings(state.boardSettings);
  const workspacePath = currentWorkspacePathFromSettings(board);
  workspace.name = workspace.name || projectFolderName(workspacePath) || "Workspace";
  workspace.path = workspacePath;
  workspace.selectedChatId = state.selectedChatId || null;
  workspace.boardSettings = board;
  workspace.chats = Array.isArray(state.chats) ? state.chats.map((chat) => cloneChat(chat, workspacePath)) : [];
}

function activeWorkspaceProfile() {
  if (!Array.isArray(state.workspaces)) {
    state.workspaces = [];
  }

  let workspace = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
  if (!workspace) {
    workspace = createWorkspaceProfile({
      id: state.activeWorkspaceId || newId(),
      name: projectFolderName(currentWorkspacePath()) || "Workspace",
      path: currentWorkspacePath(),
      selectedChatId: state.selectedChatId || null,
      boardSettings: state.boardSettings,
      chats: state.chats
    }, state.workspaces.length);
    state.activeWorkspaceId = workspace.id;
    state.workspaces.push(workspace);
  }

  return workspace;
}

function requestRateLimitsOnce() {
  if (rateLimitsRequestedOnce) {
    return;
  }

  rateLimitsRequestedOnce = true;
  vscode.postMessage({
    type: "refreshRateLimits",
    silent: true
  });
}

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "chat-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

vscode.postMessage({ type: "ready" });
