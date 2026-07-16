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
  }, { render: "messages" });
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
  }, { render: "messages" });
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
      persist({ skipFullSync: true });
    }
    return;
  }

  const bottomLocked = lockChatToBottomIfPinned(chatId);
  updater(chat);
  chat.updatedAt = Date.now();
  syncActiveWorkspaceChat(chatId);
  if (chatUpdateBatchDepth > 0) {
    recordBatchedChatRender(chatId, updateOptions);
    batchedPersistNeeded = true;
    return;
  }

  if (updateOptions.render === "chrome") {
    renderChatChrome(chatId);
  } else if (updateOptions.render === "messages") {
    renderChatMessagesPanel(chatId);
  } else if (updateOptions.render === "chrome+messages") {
    renderChatChrome(chatId);
    renderChatMessagesPanel(chatId);
  } else if (updateOptions.render === "event" && updateOptions.eventId && renderEventMessage(chatId, updateOptions.eventId)) {
    // Updated a single existing event in place.
  } else if (updateOptions.render === "event") {
    renderChatMessagesPanel(chatId);
  } else {
    scheduleChatCardRender(chatId);
  }
  if (bottomLocked) {
    reinforceChatBottomLocks([chatId]);
  }
  persist({ skipFullSync: true });
}

function withBatchedChatUpdates(callback) {
  chatUpdateBatchDepth += 1;
  try {
    callback();
  } finally {
    chatUpdateBatchDepth -= 1;
    if (chatUpdateBatchDepth === 0) {
      flushBatchedChatUpdates();
    }
  }
}

function recordBatchedChatRender(chatId, options) {
  const current = batchedChatRenderModes.get(chatId) || "";
  const next = batchedRenderMode(options);
  batchedChatRenderModes.set(chatId, strongestRenderMode(current, next));
}

function batchedRenderMode(options) {
  if (!options || !options.render) {
    return "card";
  }
  if (options.render === "chrome+messages") {
    return "chrome+messages";
  }
  if (options.render === "chrome") {
    return "chrome";
  }
  if (options.render === "messages" || options.render === "event") {
    return "messages";
  }
  return "card";
}

function strongestRenderMode(a, b) {
  const order = {
    "": 0,
    messages: 1,
    chrome: 2,
    "chrome+messages": 3,
    card: 4
  };
  return (order[b] || 0) > (order[a] || 0) ? b : a;
}

function flushBatchedChatUpdates() {
  const renderModes = batchedChatRenderModes;
  const shouldPersist = batchedPersistNeeded;
  batchedChatRenderModes = new Map();
  batchedPersistNeeded = false;

  for (const [chatId, mode] of renderModes) {
    if (mode === "card") {
      renderChatCard(chatId, { deferAfterRender: true });
    } else if (mode === "chrome+messages") {
      renderChatChrome(chatId);
      renderChatMessagesPanel(chatId, { deferAfterRender: true });
    } else if (mode === "chrome") {
      renderChatChrome(chatId);
    } else {
      renderChatMessagesPanel(chatId, { deferAfterRender: true });
    }
  }

  if (renderModes.size) {
    reinforceChatBottomLocks(renderModes.keys());
    refreshBoardUsage();
    updateVoiceButtons();
    syncDurationTimer();
  }
  if (shouldPersist) {
    persist({ skipFullSync: true });
  }
}

function persist(options) {
  const persistOptions = options && typeof options === "object" ? options : {};
  if (!persistOptions.skipFullSync) {
    pendingPersistNeedsFullSync = true;
  }

  if (pendingPersistTimer) {
    clearTimeout(pendingPersistTimer);
  }

  pendingPersistTimer = setTimeout(() => {
    pendingPersistTimer = 0;
    persistNow();
  }, 120);
}

function persistNow() {
  countRenderStat("persistFlushes");
  if (pendingPersistTimer) {
    clearTimeout(pendingPersistTimer);
    pendingPersistTimer = 0;
  }

  if (pendingPersistNeedsFullSync) {
    countRenderStat("persistFullSyncs");
    syncActiveWorkspaceFromState();
  }
  pendingPersistNeedsFullSync = false;
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

function syncActiveWorkspaceChat(chatId) {
  const workspace = activeWorkspaceProfile();
  if (!workspace || !chatId) {
    return;
  }

  syncActiveWorkspaceMetaFromState(workspace);
  const workspacePath = workspace.path || currentWorkspacePath();
  const chat = Array.isArray(state.chats) ? state.chats.find((item) => item.id === chatId) : null;
  if (!chat) {
    workspace.chats = Array.isArray(workspace.chats)
      ? workspace.chats.filter((item) => item.id !== chatId)
      : [];
    return;
  }

  const storedChat = cloneChat(chat, workspacePath);
  if (!Array.isArray(workspace.chats)) {
    workspace.chats = [];
  }

  const index = workspace.chats.findIndex((item) => item.id === chatId);
  if (index >= 0) {
    workspace.chats[index] = storedChat;
  } else {
    workspace.chats.push(storedChat);
  }
}

function syncActiveWorkspaceMetaFromState(workspace) {
  const target = workspace || activeWorkspaceProfile();
  if (!target) {
    return;
  }

  const board = normalizeBoardSettings(state.boardSettings);
  const workspacePath = currentWorkspacePathFromSettings(board);
  target.name = target.name || projectFolderName(workspacePath) || "Workspace";
  target.path = workspacePath;
  target.selectedChatId = state.selectedChatId || null;
  target.boardSettings = board;
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
