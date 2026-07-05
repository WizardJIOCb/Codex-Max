// Chat message updates and persisted workspace state. Loaded before main.js.
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
