// Board shell rendering, full-grid refresh, fatal state, and toast helpers. Loaded before main.js.
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
