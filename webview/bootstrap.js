var vscode = acquireVsCodeApi();
var bootstrap = window.CODEX_MAX_BOOTSTRAP || {};
var EXTENSION_VERSION = String(bootstrap.extensionVersion || "");
var DEFAULT_CHAT_BACKGROUND = String(bootstrap.defaultChatBackground || "#252526");
var DEFAULT_WHISPER_LIVE_STOP_GRACE_MS = Number(bootstrap.defaultWhisperLiveStopGraceMs || 2600);
var MAX_ATTACHMENT_BYTES = Number(bootstrap.maxAttachmentBytes || 262144);
var LOCAL_WHISPER_MODELS = Array.isArray(bootstrap.localWhisperModels) ? bootstrap.localWhisperModels : [];
