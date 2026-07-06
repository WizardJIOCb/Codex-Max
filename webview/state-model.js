// State model normalization and workspace data helpers. Loaded before main.js.
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
  const messages = Array.isArray(source.messages) ? source.messages.map((item) => normalizeChatMessage(item, now)) : [];
  const editingOriginalMessages = Array.isArray(source.editingOriginalMessages)
    ? source.editingOriginalMessages.map((item) => normalizeChatMessage(item, now))
    : [];
  repairFileChangeSummaries(messages);
  repairFileChangeSummaries(editingOriginalMessages);
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
    editingMessageAt: Number(source.editingMessageAt || 0),
    editingOriginalMessages,
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

function normalizeChatMessage(item, fallbackTime) {
  const source = item || {};
  return {
    role: String(source.role || "assistant"),
    text: String(source.text || ""),
    at: Number(source.at || fallbackTime || Date.now()),
    eventId: source.eventId ? String(source.eventId) : "",
    kind: source.kind ? String(source.kind) : "",
    status: source.status ? String(source.status) : "",
    title: source.title ? String(source.title) : "",
    detail: source.detail ? String(source.detail) : "",
    runStartedAt: Number(source.runStartedAt || 0),
    runFinishedAt: Number(source.runFinishedAt || 0),
    raw: source.raw ? String(source.raw) : "",
    changes: Array.isArray(source.changes) ? source.changes.map(normalizeChangeEntry) : []
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
    editingMessageAt: 0,
    editingOriginalMessages: [],
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

function normalizeSettings(settings) {
  const next = Object.assign({}, DEFAULT_CHAT_SETTINGS, settings || {});
  const reasoning = ["minimal", "low", "medium", "high", "xhigh"].includes(next.reasoning) ? next.reasoning : DEFAULT_CHAT_SETTINGS.reasoning;
  const verbosity = ["low", "medium", "high"].includes(next.verbosity) ? next.verbosity : DEFAULT_CHAT_SETTINGS.verbosity;
  const sandbox = ["read-only", "workspace-write", "danger-full-access"].includes(next.sandbox) ? next.sandbox : DEFAULT_CHAT_SETTINGS.sandbox;
  const webSearch = ["disabled", "cached", "live"].includes(next.webSearch) ? next.webSearch : DEFAULT_CHAT_SETTINGS.webSearch;
  const speedTier = ["standard", "fast"].includes(next.speedTier) ? next.speedTier : (next.fastMode ? "fast" : DEFAULT_CHAT_SETTINGS.speedTier);

  return {
    model: normalizeModelId(next.model) || DEFAULT_CHAT_SETTINGS.model,
    reasoning,
    verbosity,
    sandbox,
    webSearch,
    speedTier
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
  const next = Object.assign({ chatsPerRow: fallback, chatsPerColumn: rowFallback, maxChatHeight: 0, chatBackground: DEFAULT_CHAT_BACKGROUND, sendWithCtrlEnter: false, autoScroll: true, animateMessages: true, voiceShortcut: "alt-v", speechToText: "browser", localWhisperModel: "small-q5_1", localWhisperCaptureId: -1, localWhisperStopGraceMs: DEFAULT_WHISPER_LIVE_STOP_GRACE_MS, currentWorkspacePath: "" }, settings || {});
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
    animateMessages: next.animateMessages !== false,
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
