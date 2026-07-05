// Chat card and message rendering. Loaded before main.js.
function chatScrollSignature(chat) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const parts = [
    chat.status || "",
    chat.isThinking ? "thinking" : "",
    String(chat.runStartedAt || ""),
    String(chat.runFinishedAt || ""),
    String(messages.length)
  ];

  for (const message of messages) {
    const changes = Array.isArray(message.changes)
      ? message.changes.map((change) => [
          change.path || "",
          change.kind || "",
          change.additions == null ? "" : change.additions,
          change.deletions == null ? "" : change.deletions,
          String(change.diff || "").length
        ].join(":")).join(",")
      : "";
    parts.push([
      message.role || "",
      message.kind || "",
      message.status || "",
      message.eventId || "",
      String(message.at || ""),
      String(message.text || "").length,
      String(message.title || ""),
      String(message.detail || "").length,
      String(message.raw || "").length,
      changes
    ].join("|"));
  }

  return parts.join(";");
}

function renderChat(chat) {
  const isRunning = chat.status === "running";
  const messages = renderChatMessages(chat);
  const statusTitle = chat.sessionId ? "Thread: " + chat.sessionId : "New Codex thread";
  const settings = normalizeSettings(chat.settings);
  const board = normalizeBoardSettings(state.boardSettings);
  const sendShortcut = board.sendWithCtrlEnter ? "Ctrl+Enter" : "Enter";
  const sendButtonTitle = isRunning ? "Stop" : "Send";
  const sendButtonClass = isRunning ? "send iconButton stopSend" : "send iconButton";
  const sendButtonIcon = isRunning
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.6"></rect></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="m5 12 7-7 7 7"></path></svg>';
  const attachments = Array.isArray(chat.pendingAttachments) ? chat.pendingAttachments : [];
  const attachmentTray = attachments.length
    ? '<div class="attachmentTray">' + attachments.map(renderAttachmentChip).join("") + '</div>'
    : "";
  const contextInfo = contextUsageInfo(chat, settings.model);
  chat.settings = settings;

  return `
    <article class="chat" data-chat-id="${escapeAttr(chat.id)}">
      <header class="chatHeader">
        <input class="title" value="${escapeAttr(chat.title)}" title="${escapeAttr(statusTitle)}" />
        <div class="actions">
          <span class="status ${escapeAttr(chat.status)}" title="${escapeAttr(chat.status)}">${escapeHtml(statusLabel(chat.status))}</span>
          <button class="iconButton secondary" data-action="clear" title="Clear messages">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
              <path d="M6 7l1 14h10l1-14"></path>
              <path d="M9 7V4h6v3"></path>
            </svg>
          </button>
          <button class="iconButton secondary" data-action="info" title="Chat information">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 17v-6"></path>
              <path d="M12 7h.01"></path>
              <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"></path>
            </svg>
          </button>
          <button class="iconButton secondary" data-action="remove" title="Remove chat">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12"></path>
              <path d="M18 6L6 18"></path>
            </svg>
          </button>
        </div>
      </header>
      <section class="messages">${messages}</section>
      <footer class="composer">
        <div class="promptDock">
          ${attachmentTray}
          <textarea class="promptInput" rows="1" placeholder="Message Codex... ${sendShortcut} to send" ${isRunning ? "disabled" : ""}>${escapeHtml(chat.draftPrompt || "")}</textarea>
          <div class="composerBar">
            <div class="composerLeft">
              <button class="composerIcon" type="button" data-action="attach" title="Attach files" ${isRunning ? "disabled" : ""}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14"></path>
                  <path d="M5 12h14"></path>
                </svg>
              </button>
              <button class="composerIcon voiceInput${voiceChatId === chat.id ? nativeWhisperStopping ? " stopping" : " listening" : ""}" type="button" data-action="voice" title="${escapeAttr(voiceButtonTitle(chat.id))}" ${isRunning || board.speechToText === "off" ? "disabled" : ""}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"></path>
                  <path d="M19 10v1a7 7 0 0 1-14 0v-1"></path>
                  <path d="M12 18v3"></path>
                  <path d="M8 21h8"></path>
                </svg>
              </button>
              <div class="composerSettings" aria-label="Codex prompt settings">
                ${selectChip("sandbox", "Filesystem access", settings.sandbox, [
                  ["read-only", "Read access"],
                  ["workspace-write", "Write access"],
                  ["danger-full-access", "Full access"]
                ], isRunning)}
                ${selectChip("reasoning", "Reasoning effort", settings.reasoning, [
                  ["minimal", "Minimal"],
                  ["low", "Low"],
                  ["medium", "Medium"],
                  ["high", "High"],
                  ["xhigh", "Extra High"]
                ], isRunning)}
                ${selectChip("verbosity", "Response detail", settings.verbosity, [
                  ["low", "Short"],
                  ["medium", "Normal"],
                  ["high", "Full"]
                ], isRunning)}
                ${selectChip("webSearch", "Web search mode", settings.webSearch, [
                  ["disabled", "Web off"],
                  ["cached", "Web"],
                  ["live", "Live web"]
                ], isRunning)}
              </div>
            </div>
            <div class="composerRight">
              ${renderContextIndicator(contextInfo)}
              ${modelSelectChip(settings.model, isRunning)}
              <button class="${sendButtonClass}" title="${sendButtonTitle}" aria-label="${sendButtonTitle}">
                ${sendButtonIcon}
              </button>
            </div>
          </div>
        </div>
      </footer>
    </article>
  `;
}

function renderChatMessages(chat) {
  const items = Array.isArray(chat.messages)
    ? chat.messages.filter((item) => !(item.role === "event" && item.kind === "thinking" && item.status === "running"))
    : [];
  const start = Number(chat.runStartedAt || 0);
  const end = Number(chat.runFinishedAt || 0);
  const insertAfter = turnDurationInsertIndex(items, start);
  let html = "";

  for (let index = 0; index < items.length; index += 1) {
    html += renderMessage(items[index], chat, index);
    if (index === insertAfter) {
      html += renderTurnDuration(start, end);
    }
  }

  if (insertAfter === -1 && chat.status === "running" && start && !end) {
    html += renderTurnDuration(start, 0);
  }

  if (chat.status === "running" && chat.isThinking) {
    html += renderThinkingLine();
  }

  return html;
}

function renderThinkingLine() {
  return `
    <div class="thinkingLine">
      <span>Thinking</span>
    </div>
  `;
}

function turnDurationInsertIndex(messages, startedAt) {
  const start = Number(startedAt || 0);
  if (!start) {
    return -2;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && Number(message.at || 0) <= start) {
      return index;
    }
  }

  return -1;
}

function renderAttachmentChip(attachment) {
  const label = attachment.relativePath || attachment.name || "file";
  const title = (attachment.path || label) + (attachment.size ? " - " + formatBytes(attachment.size) : "");
  return `
    <span class="attachmentChip" title="${escapeAttr(title)}">
      <span>${escapeHtml(label)}</span>
      <button class="attachmentRemove" type="button" data-remove-attachment="${escapeAttr(attachment.id)}" title="Remove attachment" aria-label="Remove attachment">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8"></path>
          <path d="M12 4l-8 8"></path>
        </svg>
      </button>
    </span>
  `;
}

function renderMessage(item, chat, index) {
  if (item.role === "changeSummary") {
    const title = item.title || item.text || "Edited files";
    const detail = item.detail || "Updated";
    const messageId = item.eventId ? ' data-message-id="' + escapeAttr(item.eventId) + '"' : "";
    return `
      <div class="message changeSummary"${messageId}>
        <div class="changeCard" role="button" tabindex="0" aria-expanded="false" title="Toggle changed files">
          <span class="changeIcon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14"></path>
              <path d="M5 12h14"></path>
            </svg>
          </span>
          <div>
            <div class="changeTitle">${escapeHtml(title)}</div>
            <div class="changeMeta">${escapeHtml(detail)}</div>
          </div>
          <span class="changeAction" title="Expand changes" aria-label="Expand changes">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path class="changeToggleVertical" d="M8 3.5v9"></path>
              <path d="M3.5 8h9"></path>
            </svg>
          </span>
        </div>
        <div class="changeDetail">
          ${renderChangeDetails(item)}
        </div>
      </div>
    `;
  }

  if (item.role === "event") {
    const title = item.title || item.text || "Codex event";
    const detail = item.detail || item.text || "";
    const preview = compactPreview(detail);
    const messageId = item.eventId ? ' data-message-id="' + escapeAttr(item.eventId) + '"' : "";
    const eventDetail = item.kind === "files"
      ? renderChangeDetails(item)
      : (detail ? '<pre>' + escapeHtml(detail) + '</pre>' : '<div class="eventEmpty">No additional details</div>');
    return `
      <div class="message event ${escapeAttr(item.kind || "event")} ${escapeAttr(item.status || "info")}"${messageId}>
        <div class="eventSummary" role="button" tabindex="0" aria-expanded="false" title="Toggle details">
          <span class="eventBadge">${escapeHtml(eventBadge(item.kind, item.status))}</span>
          <span class="eventTitle">${escapeHtml(title)}</span>
          ${preview ? '<span class="eventPreview">' + escapeHtml(preview) + '</span>' : ''}
          <button class="eventToggle" type="button" tabindex="-1" title="Expand details" aria-label="Expand details">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path class="eventToggleVertical" d="M8 3.5v9"></path>
              <path d="M3.5 8h9"></path>
            </svg>
          </button>
        </div>
        <div class="eventDetail">
          ${eventDetail}
        </div>
      </div>
    `;
  }

  if (item.role === "user") {
    return `
      <div class="message user">
        ${renderPlainText(item.text)}
        <div class="userMeta">
          <span title="${escapeAttr(formatDateTime(item.at))}">${escapeHtml(formatMessageTime(item.at))}</span>
          <button class="copyMessage" type="button" data-copy-chat="${escapeAttr(chat.id)}" data-copy-index="${escapeAttr(index)}" title="Copy message" aria-label="Copy message">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="8" y="8" width="10" height="10" rx="2"></rect>
              <path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  const html = item.role === "assistant" ? renderMarkdown(item.text) : renderPlainText(item.text);
  return `<div class="message ${escapeAttr(item.role)}">${html}</div>`;
}

function renderTurnDuration(startedAt, finishedAt) {
  const start = Number(startedAt || 0);
  const end = Number(finishedAt || 0);
  if (!start) {
    return "";
  }

  const label = end ? "Worked for " : "Working for ";
  const duration = formatDuration((end || Date.now()) - start);
  return `
    <div class="turnDuration" data-duration-start="${escapeAttr(start)}" data-duration-end="${escapeAttr(end)}">
      <span data-duration-label="true">${escapeHtml(label + duration)}</span>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6 3.5 10.5 8 6 12.5"></path>
      </svg>
    </div>
  `;
}

function statusLabel(status) {
  if (status === "running") {
    return "Run";
  }
  if (status === "error") {
    return "Error";
  }
  if (status === "opened") {
    return "Open";
  }
  return "Idle";
}

function eventBadge(kind, status) {
  if (kind === "files" && status === "running") {
    return "EDIT";
  }
  if (kind === "thinking" && status === "running") {
    return "THINK";
  }
  if (status === "running") {
    return "RUN";
  }
  if (status === "error") {
    return "ERR";
  }
  if (kind === "command") {
    return "CMD";
  }
  if (kind === "files") {
    return "FILE";
  }
  if (kind === "web") {
    return "WEB";
  }
  if (kind === "tool") {
    return "TOOL";
  }
  if (kind === "thinking") {
    return "THINK";
  }
  return "INFO";
}
