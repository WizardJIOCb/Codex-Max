const path = require("path");
const { MAX_ATTACHMENT_BYTES } = require("./attachments");
const { normalizeCaptureId } = require("./platform");
const { DEFAULT_WHISPER_LIVE_STOP_GRACE_MS, LOCAL_WHISPER_MODELS } = require("./whisper-catalog");

const DEFAULT_CHAT_BACKGROUND = "#252526";
const DEFAULT_CHAT_SETTINGS = {
  model: "gpt-5.5",
  reasoning: "medium",
  verbosity: "medium",
  sandbox: "read-only",
  webSearch: "cached"
};

const DEFAULT_BOARD_SETTINGS = {
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
};

function normalizeSettings(settings) {
  const next = Object.assign({}, DEFAULT_CHAT_SETTINGS, settings || {});
  const allowedReasoning = new Set(["minimal", "low", "medium", "high", "xhigh"]);
  const allowedVerbosity = new Set(["low", "medium", "high"]);
  const allowedSandbox = new Set(["read-only", "workspace-write", "danger-full-access"]);
  const allowedWebSearch = new Set(["disabled", "cached", "live"]);

  return {
    model: normalizeModelId(next.model) || DEFAULT_CHAT_SETTINGS.model,
    reasoning: allowedReasoning.has(next.reasoning) ? next.reasoning : DEFAULT_CHAT_SETTINGS.reasoning,
    verbosity: allowedVerbosity.has(next.verbosity) ? next.verbosity : DEFAULT_CHAT_SETTINGS.verbosity,
    sandbox: allowedSandbox.has(next.sandbox) ? next.sandbox : DEFAULT_CHAT_SETTINGS.sandbox,
    webSearch: allowedWebSearch.has(next.webSearch) ? next.webSearch : DEFAULT_CHAT_SETTINGS.webSearch
  };
}

function trimStateForStorage(state) {
  const workspaces = Array.isArray(state && state.workspaces)
    ? state.workspaces.map(trimWorkspaceForStorage).filter(Boolean)
    : [];
  const activeWorkspaceId = String(state && state.activeWorkspaceId || (workspaces[0] && workspaces[0].id) || "");
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) || workspaces[0] || null;
  const boardSettings = normalizeBoardSettings(state && state.boardSettings || activeWorkspace && activeWorkspace.boardSettings || {});
  const chats = Array.isArray(state && state.chats)
    ? state.chats.map(trimChatForStorage)
    : (activeWorkspace ? activeWorkspace.chats : []);

  return {
    chats,
    selectedChatId: state && state.selectedChatId ? String(state.selectedChatId) : (activeWorkspace && activeWorkspace.selectedChatId || null),
    activeWorkspaceId,
    workspaces,
    accountRateLimits: normalizeRateLimits(state && state.accountRateLimits),
    boardSettings
  };
}

function dateStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").replace(/T/, "_").replace(/Z$/, "Z");
}

function safeFileName(value) {
  return String(value || "preset").trim().replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-").replace(/\s+/g, "-").replace(/^-+|-+$/g, "") || "preset";
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

function normalizeBoardSettings(settings) {
  const next = Object.assign({}, DEFAULT_BOARD_SETTINGS, settings || {});
  const chatBackground = String(next.chatBackground || "").toLowerCase() === "#212121"
    ? DEFAULT_BOARD_SETTINGS.chatBackground
    : next.chatBackground;
  const allowedVoiceShortcuts = new Set(["off", "alt-v", "ctrl-shift-v", "ctrl-m"]);
  const allowedSpeechToText = new Set(["off", "browser", "local-whisper"]);
  const allowedWhisperModels = new Set(LOCAL_WHISPER_MODELS.map((model) => model.id));
  const captureId = normalizeCaptureId(next.localWhisperCaptureId);

  return {
    chatsPerRow: clampInt(next.chatsPerRow, 1, 12),
    chatsPerColumn: clampInt(next.chatsPerColumn, 1, 6),
    maxChatHeight: normalizeMaxChatHeight(next.maxChatHeight),
    chatBackground: normalizeHexColor(chatBackground, DEFAULT_BOARD_SETTINGS.chatBackground),
    sendWithCtrlEnter: Boolean(next.sendWithCtrlEnter),
    autoScroll: next.autoScroll !== false,
    voiceShortcut: allowedVoiceShortcuts.has(next.voiceShortcut) ? next.voiceShortcut : DEFAULT_BOARD_SETTINGS.voiceShortcut,
    speechToText: allowedSpeechToText.has(next.speechToText) ? next.speechToText : DEFAULT_BOARD_SETTINGS.speechToText,
    localWhisperModel: allowedWhisperModels.has(next.localWhisperModel) ? next.localWhisperModel : DEFAULT_BOARD_SETTINGS.localWhisperModel,
    localWhisperCaptureId: Math.max(-1, Math.min(32, captureId)),
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
    return `#${text.toLowerCase()}`;
  }
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return "#" + text.slice(1).split("").map((char) => char + char).join("").toLowerCase();
  }

  return fallback;
}

function normalizeProjectPath(value) {
  const text = String(value || "").trim();
  return text ? path.resolve(text) : "";
}

function projectFolderLabel(value) {
  const normalized = normalizeProjectPath(value);
  return normalized ? path.basename(normalized) : "";
}

function titleWithProjectLabel(title, projectPath) {
  const baseTitle = String(title || "Codex chat").replace(/\s*\[[^\[\]]+\]\s*$/, "").trim() || "Codex chat";
  const label = projectFolderLabel(projectPath);
  return label ? `${baseTitle} [${label}]` : baseTitle;
}

function trimChatForStorage(chat) {
  const source = chat || {};
  return {
    id: String(source.id || ""),
    title: String(source.title || "Codex chat"),
    sessionId: source.sessionId ? String(source.sessionId) : null,
    status: source.status === "running" ? "idle" : String(source.status || "idle"),
    note: String(source.note || ""),
    projectPath: String(source.projectPath || ""),
    draftPrompt: String(source.draftPrompt || "").slice(0, MAX_ATTACHMENT_BYTES),
    lastOpenedAt: Number(source.lastOpenedAt || 0),
    createdAt: Number(source.createdAt || 0),
    updatedAt: Number(source.updatedAt || source.lastOpenedAt || 0),
    runStartedAt: Number(source.runStartedAt || 0),
    runFinishedAt: Number(source.runFinishedAt || 0),
    isThinking: Boolean(source.isThinking),
    settings: normalizeSettings(source.settings),
    pendingAttachments: Array.isArray(source.pendingAttachments)
      ? source.pendingAttachments.slice(-20).map((item) => ({
          id: String(item.id || ""),
          name: String(item.name || "file"),
          path: String(item.path || ""),
          relativePath: String(item.relativePath || ""),
          size: Number(item.size || 0),
          isText: Boolean(item.isText),
          truncated: Boolean(item.truncated),
          content: String(item.content || "").slice(0, MAX_ATTACHMENT_BYTES)
        }))
      : [],
    messages: Array.isArray(source.messages)
      ? source.messages.slice(-80).map((item) => ({
          role: String(item.role || "assistant"),
          text: String(item.text || ""),
          at: Number(item.at || Date.now()),
          eventId: item.eventId ? String(item.eventId) : "",
          kind: item.kind ? String(item.kind) : "",
          status: item.status ? String(item.status) : "",
          title: item.title ? String(item.title) : "",
          detail: item.detail ? String(item.detail) : "",
          runStartedAt: Number(item.runStartedAt || 0),
          runFinishedAt: Number(item.runFinishedAt || 0),
          raw: item.raw ? String(item.raw).slice(0, MAX_ATTACHMENT_BYTES) : "",
          changes: Array.isArray(item.changes) ? item.changes.slice(0, 20).map((change) => ({
            path: String(change.path || ""),
            kind: String(change.kind || ""),
            additions: Number.isFinite(Number(change.additions)) ? Number(change.additions) : null,
            deletions: Number.isFinite(Number(change.deletions)) ? Number(change.deletions) : null,
            diff: String(change.diff || "").slice(0, MAX_ATTACHMENT_BYTES)
          })) : []
        }))
      : []
  };
}

function trimWorkspaceForStorage(workspace) {
  if (!workspace || typeof workspace !== "object") {
    return null;
  }

  const boardSettings = normalizeBoardSettings(workspace.boardSettings || {});
  const pathValue = String(workspace.path || boardSettings.currentWorkspacePath || "");
  return {
    id: String(workspace.id || ""),
    name: String(workspace.name || projectFolderLabel(pathValue) || "Workspace"),
    path: pathValue,
    selectedChatId: workspace.selectedChatId ? String(workspace.selectedChatId) : null,
    boardSettings,
    chats: Array.isArray(workspace.chats) ? workspace.chats.map(trimChatForStorage) : []
  };
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

function normalizeWhisperStopGraceMs(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_WHISPER_LIVE_STOP_GRACE_MS;
  }

  return clampInt(parsed, 100, 10000);
}

function clampInt(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return min;
  }

  return Math.min(max, Math.max(min, parsed));
}

function createInitialChat(projectPath) {
  const now = Date.now();
  const normalizedProjectPath = normalizeProjectPath(projectPath || "");
  return {
    id: `chat-${now}`,
    title: titleWithProjectLabel("Codex chat 1", normalizedProjectPath),
    sessionId: null,
    status: "idle",
    projectPath: normalizedProjectPath,
    draftPrompt: "",
    createdAt: now,
    updatedAt: now,
    runStartedAt: 0,
    runFinishedAt: 0,
    isThinking: false,
    settings: Object.assign({}, DEFAULT_CHAT_SETTINGS),
    messages: [
      {
        role: "system",
        text: "Ask Codex anything about this workspace.",
        at: now
      }
    ]
  };
}

module.exports = {
  DEFAULT_BOARD_SETTINGS,
  DEFAULT_CHAT_BACKGROUND,
  DEFAULT_CHAT_SETTINGS,
  clampInt,
  createInitialChat,
  dateStamp,
  normalizeBoardSettings,
  normalizeProjectPath,
  normalizeRateLimits,
  normalizeSettings,
  normalizeWhisperStopGraceMs,
  projectFolderLabel,
  safeFileName,
  titleWithProjectLabel,
  trimChatForStorage,
  trimStateForStorage,
  trimWorkspaceForStorage
};
