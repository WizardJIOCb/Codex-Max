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
