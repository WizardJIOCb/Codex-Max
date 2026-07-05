// Shared webview helpers. Loaded before markdown.js and main.js.
function basenameForDisplay(value) {
  const clean = String(value || "").replace(/[?#].*$/, "");
  return clean.split(/[\\/]/).pop() || clean || "file";
}

function cssEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return String(value).replace(/"/g, '\\"');
}

function compactPreview(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }

  return text.length > 96 ? text.slice(0, 96) + "..." : text;
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

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "chat-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}
