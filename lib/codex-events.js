const fs = require("fs");
const path = require("path");
const { MAX_ATTACHMENT_BYTES, normalizeIncomingFilePath, resolveWorkspaceFilePath } = require("./attachments");
const { stripQuotes } = require("./platform");

function handleJsonLine(line, chatId, board, markFinalMessageSeen, recordFileChange, captureSnapshotsFromItem) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    postChatEvent(board, chatId, {
      kind: "raw",
      status: "info",
      title: "Raw Codex event",
      detail: line
    });
    return;
  }

  if (event.type === "thread.started" && event.thread_id) {
    board.post({ type: "chatSession", chatId, sessionId: event.thread_id });
    return;
  }

  const eventType = String(event.type || event.kind || event.event || "");
  const normalizedEventType = eventType.replace(/[._/-]/g, "").toLowerCase();
  if (
    normalizedEventType === "accountratelimitsupdated" ||
    (/ratelimit/.test(normalizedEventType) && /account|usage|balance|limit/.test(normalizedEventType))
  ) {
    board.post({
      type: "accountRateLimits",
      rateLimits: rateLimitPayloadFromEvent(event)
    });
    return;
  }

  if (event.type === "turn.started") {
    board.post({ type: "chatThinking", chatId, thinking: true });
    return;
  }

  if (event.type === "turn.failed") {
    board.post({
      type: "chatError",
      chatId,
      error: event.error ? String(event.error) : "Codex turn failed."
    });
    return;
  }

  if (event.type === "error") {
    board.post({
      type: "chatError",
      chatId,
      error: event.message ? String(event.message) : "Codex reported an error."
    });
    return;
  }

  if (event.type === "item.started" && event.item) {
    board.post({ type: "chatThinking", chatId, thinking: false });
    if (typeof captureSnapshotsFromItem === "function") {
      captureSnapshotsFromItem(event.item);
    }
    if (event.item.type === "file_change") {
      const summary = fileChangeSummary(event.item);
      postChatEvent(board, chatId, {
        eventId: eventIdentity(event.item, "files", summary.title),
        kind: "files",
        status: "running",
        title: summary.title.replace(/^Edited\b/, "Editing"),
        detail: summary.detail,
        text: summary.title,
        changes: summary.changes,
        raw: summary.raw
      });
      return;
    }
    const itemEvent = codexEventFromItem(event.item, "started");
    if (itemEvent) {
      postChatEvent(board, chatId, itemEvent);
    }
    return;
  }

  if (event.type === "item.completed" && event.item) {
    if (event.item.type === "agent_message" && event.item.text) {
      markFinalMessageSeen();
      board.post({ type: "chatThinking", chatId, thinking: false });
      board.post({
        type: "assistantMessage",
        chatId,
        text: String(event.item.text)
      });
      return;
    }

    if (event.item.type === "file_change" && typeof recordFileChange === "function") {
      recordFileChange(event.item);
      return;
    }

    const itemEvent = codexEventFromItem(event.item, "completed");
    if (event.item.type === "file_change") {
      return;
    }
    if (itemEvent) {
      postChatEvent(board, chatId, itemEvent);
    }
  }
}

function postChatEvent(board, chatId, event) {
  board.post({
    type: "chatEvent",
    chatId,
    event
  });
}

function codexEventFromItem(item, phase) {
  if (item.type === "command_execution") {
    const command = normalizeCommandForDisplay(item.command || "command");
    return {
      eventId: eventIdentity(item, "command", command),
      kind: "command",
      status: phase === "started" ? "running" : "done",
      title: phase === "started" ? "Running command" : "Finished command",
      detail: commandDetail(item, command)
    };
  }

  if (item.type === "web_search") {
    return {
      kind: "web",
      status: phase === "started" ? "running" : "done",
      title: phase === "started" ? "Searching the web" : "Web search finished",
      detail: item.query || item.url || compactJson(item)
    };
  }

  if (item.type === "mcp_tool_call") {
    const name = item.name || "MCP tool";
    return {
      kind: "tool",
      status: phase === "started" ? "running" : "done",
      title: phase === "started" ? `Calling ${name}` : `${name} finished`,
      detail: compactJson(item)
    };
  }

  if (item.type === "file_change") {
    return {
      kind: "files",
      status: "done",
      title: "Codex updated files",
      detail: fileChangeDetail(item)
    };
  }

  if (item.type === "reasoning") {
    return {
      kind: "thinking",
      status: phase === "started" ? "running" : "done",
      title: phase === "started" ? "Reasoning started" : "Reasoning completed",
      detail: item.text || item.summary || ""
    };
  }

  return {
    kind: item.type || "event",
    status: phase === "started" ? "running" : "done",
    title: eventTitle(item.type || "Codex event", phase),
    detail: compactJson(item)
  };
}

function commandDetail(item, command) {
  const parts = [`Command:\n${command}`];
  for (const key of ["cwd", "exit_code", "exitCode", "status"]) {
    if (item[key] !== undefined && item[key] !== null) {
      parts.push(`${key}: ${item[key]}`);
    }
  }

  for (const key of ["output", "stdout", "stderr", "text"]) {
    if (item[key]) {
      parts.push(`${key}:\n${String(item[key])}`);
    }
  }

  return parts.join("\n\n");
}

function eventIdentity(item, kind, fallback) {
  for (const key of ["id", "item_id", "itemId", "call_id", "callId", "command_id", "commandId"]) {
    if (item[key] !== undefined && item[key] !== null && String(item[key]).trim()) {
      return `${kind}:${String(item[key]).trim()}`;
    }
  }

  return `${kind}:${String(fallback || "").trim()}`;
}

function normalizeCommandForDisplay(command) {
  const text = Array.isArray(command) ? command.join(" ") : String(command || "");
  const compact = text.replace(/\s+/g, " ").trim();
  const commandIndex = compact.search(/\s-Command\s/i);
  if (commandIndex === -1 || !/powershell(?:\.exe)?/i.test(compact.slice(0, commandIndex))) {
    return compact || "command";
  }

  const afterFlag = compact.slice(commandIndex).replace(/^\s-Command\s+/i, "").trim();
  return stripQuotes(afterFlag) || compact || "command";
}

function fileChangeDetail(item) {
  if (item.path) {
    return `Path: ${item.path}`;
  }

  if (Array.isArray(item.changes)) {
    return item.changes.map((change) => {
      if (typeof change === "string") {
        return change;
      }
      const filePath = change.path || change.file || change.name || "file";
      const kind = change.kind || change.action || "changed";
      return `${kind}: ${filePath}`;
    }).join("\n");
  }

  if (Array.isArray(item.files)) {
    return item.files.map((file) => typeof file === "string" ? file : compactJson(file)).join("\n");
  }

  return compactJson(item);
}

function fileChangeSummary(item) {
  const filePath = item.path || item.file || item.name || firstChangedFile(item) || "files";
  const fileName = path.basename(String(filePath)) || String(filePath);
  const action = normalizedFileChangeAction(item);
  const changes = extractFileChangeEntries(item);
  const additionSum = sumChangeNumbers(changes, "additions");
  const deletionSum = sumChangeNumbers(changes, "deletions");
  const additions = additionSum !== null ? additionSum : firstFileChangeNumber(item, ["additions", "added", "added_lines", "addedLines", "insertions"]);
  const deletions = deletionSum !== null ? deletionSum : firstFileChangeNumber(item, ["deletions", "deleted", "deleted_lines", "deletedLines", "removals"]);
  const counts = additions !== null || deletions !== null
    ? `${additions !== null ? "+" + additions : ""}${additions !== null && deletions !== null ? " " : ""}${deletions !== null ? "-" + deletions : ""}`
    : action;

  return {
    title: `${capitalize(action)} ${fileName}`,
    detail: counts,
    changes,
    raw: compactJson(item)
  };
}

function sumChangeNumbers(changes, key) {
  if (!Array.isArray(changes) || !changes.length) {
    return null;
  }

  let total = 0;
  let found = false;
  for (const change of changes) {
    if (!Number.isFinite(Number(change[key]))) {
      continue;
    }
    total += Number(change[key]);
    found = true;
  }

  return found ? total : null;
}

function augmentFileChangeWithDiff(item, snapshots, cwd) {
  const entries = extractFileChangeEntries(item);
  const changes = entries.map((entry) => {
    const next = Object.assign({}, entry);
    const filePath = resolveWorkspaceFilePath(next.path, cwd);
    const after = filePath ? readTextSnapshot(filePath) : null;
    const before = filePath && snapshots instanceof Map ? snapshotForFilePath(snapshots, filePath) : null;

    if (!next.diff && before && after && before.content !== after.content) {
      const diff = createUnifiedDiff(next.path || filePath, before.content, after.content);
      next.diff = diff.text;
      next.additions = diff.additions;
      next.deletions = diff.deletions;
    } else if (!next.diff && before && !after) {
      const diff = createUnifiedDiff(next.path || filePath, before.content, "");
      next.diff = diff.text;
      next.additions = diff.additions;
      next.deletions = diff.deletions;
    } else if (!next.diff && !before && after) {
      const diff = createUnifiedDiff(next.path || filePath, "", after.content);
      next.diff = diff.text;
      next.additions = diff.additions;
      next.deletions = diff.deletions;
    }

    if (filePath && snapshots instanceof Map) {
      snapshots.set(filePath, after || { path: filePath, content: "" });
    }

    return next;
  });

  return Object.assign({}, item, { changes });
}

function snapshotForFilePath(snapshots, filePath) {
  if (!(snapshots instanceof Map) || !filePath) {
    return null;
  }

  if (snapshots.has(filePath)) {
    return snapshots.get(filePath);
  }

  const normalized = path.normalize(filePath);
  if (snapshots.has(normalized)) {
    return snapshots.get(normalized);
  }

  const lower = normalized.toLowerCase();
  for (const [key, value] of snapshots.entries()) {
    if (path.normalize(key).toLowerCase() === lower) {
      return value;
    }
  }

  return null;
}

function captureFileSnapshotsFromText(text, cwd, snapshots) {
  if (!(snapshots instanceof Map)) {
    return;
  }

  for (const candidate of candidateFilePathsFromText(text, cwd)) {
    const snapshot = readTextSnapshot(candidate);
    if (snapshot && !snapshots.has(candidate)) {
      snapshots.set(candidate, snapshot);
    }
  }
}

function candidateFilePathsFromText(text, cwd) {
  const value = String(text || "");
  const candidates = new Set();
  const addCandidate = (raw) => {
    const clean = normalizeIncomingFilePath(stripPathPunctuation(raw));
    if (!clean) {
      return;
    }

    const filePath = path.isAbsolute(clean)
      ? path.normalize(clean)
      : path.normalize(path.join(cwd || getWorkspacePath() || "", clean));
    if (filePath) {
      candidates.add(filePath);
    }
  };

  const quotedWindowsPath = /["'`]([A-Za-z]:\\[^"'`\r\n]+)["'`]/g;
  const bareWindowsPath = /[A-Za-z]:\\[^\s"'`<>|]+/g;
  const workspaceRelativeFile = /(?:^|[\s"'`])((?:\.\\|\.\/)?[\w .-]+(?:\\|\/)[\w .\\\/-]+\.[A-Za-z0-9]{1,12})(?=$|[\s"'`,;:)\]}])/g;

  for (const pattern of [quotedWindowsPath, bareWindowsPath, workspaceRelativeFile]) {
    let match;
    while ((match = pattern.exec(value))) {
      addCandidate(match[1] || match[0]);
    }
  }

  return Array.from(candidates);
}

function stripPathPunctuation(value) {
  return String(value || "")
    .trim()
    .replace(/^["'`(<\[]+/, "")
    .replace(/["'`),.;:\]>]+$/, "");
}

function readTextSnapshot(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_ATTACHMENT_BYTES) {
      return null;
    }

    const buffer = fs.readFileSync(filePath);
    if (buffer.includes(0)) {
      return null;
    }

    return {
      path: filePath,
      content: buffer.toString("utf8")
    };
  } catch {
    return null;
  }
}

function createUnifiedDiff(filePath, before, after) {
  const beforeLines = splitDiffLines(before);
  const afterLines = splitDiffLines(after);
  const changes = lineDiff(beforeLines, afterLines);
  const additions = changes.filter((item) => item.type === "add").length;
  const deletions = changes.filter((item) => item.type === "delete").length;
  const oldCount = Math.max(1, beforeLines.length);
  const newCount = Math.max(1, afterLines.length);
  const label = normalizeIncomingFilePath(filePath) || filePath || "file";
  const lines = [
    `--- a/${label}`,
    `+++ b/${label}`,
    `@@ -1,${oldCount} +1,${newCount} @@`
  ];

  for (const item of changes) {
    const prefix = item.type === "add" ? "+" : item.type === "delete" ? "-" : " ";
    lines.push(prefix + item.line);
  }

  return {
    text: lines.join("\n").slice(0, MAX_ATTACHMENT_BYTES),
    additions,
    deletions
  };
}

function splitDiffLines(value) {
  const normalized = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  if (lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

function lineDiff(beforeLines, afterLines) {
  if (beforeLines.length * afterLines.length > 250000) {
    return beforeLines.map((line) => ({ type: "delete", line }))
      .concat(afterLines.map((line) => ({ type: "add", line })));
  }

  const rows = beforeLines.length + 1;
  const cols = afterLines.length + 1;
  const table = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
    for (let j = afterLines.length - 1; j >= 0; j -= 1) {
      table[i][j] = beforeLines[i] === afterLines[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const result = [];
  let i = 0;
  let j = 0;
  while (i < beforeLines.length && j < afterLines.length) {
    if (beforeLines[i] === afterLines[j]) {
      result.push({ type: "context", line: beforeLines[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push({ type: "delete", line: beforeLines[i] });
      i += 1;
    } else {
      result.push({ type: "add", line: afterLines[j] });
      j += 1;
    }
  }

  while (i < beforeLines.length) {
    result.push({ type: "delete", line: beforeLines[i] });
    i += 1;
  }
  while (j < afterLines.length) {
    result.push({ type: "add", line: afterLines[j] });
    j += 1;
  }

  return result;
}

function extractFileChangeEntries(item) {
  const entries = [];
  const addEntry = (entry) => {
    if (!entry) {
      return;
    }

    if (typeof entry === "string") {
      entries.push({
        path: entry,
        kind: normalizedFileChangeAction({ kind: "edited" }),
        additions: null,
        deletions: null,
        diff: ""
      });
      return;
    }

    const filePath = entry.path || entry.file || entry.name || "";
    if (!filePath) {
      return;
    }
    const diff = String(entry.diff || entry.patch || entry.unified_diff || entry.unifiedDiff || "");
    const diffCounts = diffLineCounts(diff);

    entries.push({
      path: String(filePath),
      kind: normalizedFileChangeAction(entry),
      additions: diffCounts.additions !== null ? diffCounts.additions : firstNumber(entry, ["additions", "added", "added_lines", "addedLines", "insertions"]),
      deletions: diffCounts.deletions !== null ? diffCounts.deletions : firstNumber(entry, ["deletions", "deleted", "deleted_lines", "deletedLines", "removals"]),
      diff
    });
  };

  if (Array.isArray(item.changes)) {
    item.changes.forEach(addEntry);
  }
  if (Array.isArray(item.files)) {
    item.files.forEach(addEntry);
  }
  if (!entries.length && (item.path || item.file || item.name)) {
    addEntry(item);
  }

  const itemDiff = String(item.diff || item.patch || item.unified_diff || item.unifiedDiff || "");
  if (itemDiff && entries.length === 1 && !entries[0].diff) {
    entries[0].diff = itemDiff;
  }

  return entries;
}

function diffLineCounts(diff) {
  const text = String(diff || "");
  if (!text) {
    return { additions: null, deletions: null };
  }

  let additions = 0;
  let deletions = 0;
  for (const line of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if (/^\+(?!\+\+)/.test(line)) {
      additions += 1;
    } else if (/^-(?!--)/.test(line)) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

function firstChangedFile(item) {
  const direct = firstChangedFileFromList(item.changes) || firstChangedFileFromList(item.files);
  if (direct) {
    return direct;
  }

  return "";
}

function firstChangedFileFromList(list) {
  if (!Array.isArray(list) || !list.length) {
    return "";
  }

  const file = list[0];
  if (typeof file === "string") {
    return file;
  }

  return file.path || file.file || file.name || "";
}

function normalizedFileChangeAction(item) {
  const raw = String(item.action || item.kind || firstFileChangeValue(item, ["action", "kind"]) || item.status || "edited").toLowerCase();
  if (["update", "updated", "edit", "edited", "done", "completed", "in_progress"].includes(raw)) {
    return "edited";
  }
  if (["create", "created", "add", "added"].includes(raw)) {
    return "created";
  }
  if (["delete", "deleted", "remove", "removed"].includes(raw)) {
    return "deleted";
  }
  if (["rename", "renamed", "move", "moved"].includes(raw)) {
    return "renamed";
  }

  return raw || "edited";
}

function firstFileChangeNumber(item, keys) {
  const direct = firstNumber(item, keys);
  if (direct !== null) {
    return direct;
  }

  const fromChanges = firstNumberFromList(item.changes, keys);
  if (fromChanges !== null) {
    return fromChanges;
  }

  return firstNumberFromList(item.files, keys);
}

function firstNumberFromList(list, keys) {
  if (!Array.isArray(list)) {
    return null;
  }

  for (const entry of list) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const value = firstNumber(entry, keys);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function firstFileChangeValue(item, keys) {
  for (const list of [item.changes, item.files]) {
    if (!Array.isArray(list)) {
      continue;
    }
    for (const entry of list) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      for (const key of keys) {
        if (entry[key] !== undefined && entry[key] !== null) {
          return entry[key];
        }
      }
    }
  }

  return "";
}

function firstNumber(item, keys) {
  for (const key of keys) {
    const value = Number(item[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function capitalize(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function eventTitle(type, phase) {
  const label = String(type).replace(/_/g, " ");
  return phase === "started" ? `${label} started` : `${label} completed`;
}

function compactJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function rateLimitPayloadFromEvent(event) {
  if (!event || typeof event !== "object") {
    return event;
  }

  return event.rateLimits
    || event.rate_limits
    || event.rate_limits_updated
    || event.rateLimit
    || event.rate_limit
    || event.limits
    || event.usage
    || event.balance
    || event.account
    || event;
}

module.exports = {
  augmentFileChangeWithDiff,
  captureFileSnapshotsFromText,
  compactJson,
  eventIdentity,
  fileChangeSummary,
  handleJsonLine,
  postChatEvent
};
