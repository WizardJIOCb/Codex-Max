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
    stickChatToBottom(chatId, messages);
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

vscode.postMessage({ type: "ready" });
