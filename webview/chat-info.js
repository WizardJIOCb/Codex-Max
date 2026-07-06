// Chat information dialog. Loaded before main.js.
function renderChatInfoDialog() {
  const chat = state.chats.find((item) => item.id === activeChatInfoId);
  const body = chat ? chatInfoHtml(chat) : "";
  const hidden = chat ? "" : " hidden";

  return `
    <div class="modalBackdrop" id="chatInfoModal"${hidden}>
      <section class="modal chatInfoModal" role="dialog" aria-modal="true" aria-labelledby="chatInfoTitle">
        <header class="modalHeader">
          <h2 id="chatInfoTitle">Chat information</h2>
          <button class="iconButton secondary" id="closeChatInfo" title="Close">x</button>
        </header>
        <div class="modalBody chatInfoBody" id="chatInfoBody">${body}</div>
        <footer class="modalFooter">
          <button id="closeChatInfoFooter" class="primary" type="button">Close</button>
        </footer>
      </section>
    </div>
  `;
}

function bindChatInfoDialog() {
  const modal = document.getElementById("chatInfoModal");
  const closeButton = document.getElementById("closeChatInfo");
  const footerButton = document.getElementById("closeChatInfoFooter");
  if (!modal || !closeButton || !footerButton) {
    return;
  }

  closeButton.addEventListener("click", closeChatInfo);
  footerButton.addEventListener("click", closeChatInfo);
  const chooseProject = document.getElementById("chooseChatProject");
  const chooseWorkspace = document.getElementById("chooseCurrentWorkspace");
  const useWorkspace = document.getElementById("useWorkspaceProject");
  if (chooseProject) {
    chooseProject.addEventListener("click", chooseProjectForActiveChat);
  }
  if (chooseWorkspace) {
    chooseWorkspace.addEventListener("click", chooseWorkspaceForActiveChat);
  }
  if (useWorkspace) {
    useWorkspace.addEventListener("click", useWorkspaceForActiveChat);
  }
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeChatInfo();
    }
  });
}

function openChatInfo(chatId) {
  activeChatInfoId = chatId;
  refreshChatInfoDialog(true);
}

function refreshChatInfoDialog(focusClose) {
  const existing = document.getElementById("chatInfoModal");
  if (!existing) {
    render();
    return;
  }

  const template = document.createElement("template");
  template.innerHTML = renderChatInfoDialog().trim();
  const next = template.content.firstElementChild;
  if (!next) {
    return;
  }

  existing.replaceWith(next);
  bindChatInfoDialog();
  const closeButton = document.getElementById("closeChatInfo");
  if (focusClose && closeButton) {
    closeButton.focus();
  }
}

function closeChatInfo() {
  activeChatInfoId = null;
  const modal = document.getElementById("chatInfoModal");
  if (modal) {
    modal.hidden = true;
  }
}

function chooseProjectForActiveChat() {
  if (!activeChatInfoId) {
    return;
  }

  vscode.postMessage({
    type: "pickProject",
    chatId: activeChatInfoId
  });
}

function chooseWorkspaceForActiveChat() {
  if (!activeChatInfoId) {
    return;
  }

  vscode.postMessage({
    type: "pickWorkspaceProject",
    chatId: activeChatInfoId
  });
}

function useWorkspaceForActiveChat() {
  if (!activeChatInfoId) {
    return;
  }

  const workspacePath = currentWorkspacePath();
  updateChat(activeChatInfoId, (chat) => {
    chat.projectPath = workspacePath;
    chat.title = chatTitleWithProject(chat.title, chat.projectPath);
  }, { render: "chrome" });
  refreshChatInfoDialog(false);
}

function chatInfoHtml(chat) {
  const stats = chatInfoStats(chat);
  const settings = normalizeSettings(chat.settings);
  const context = contextUsageInfo(chat, settings.model);
  const contextPercent = formatContextPercent(context.percent);
  const sandboxLabel = selectedLabel(settings.sandbox, [
    ["read-only", "Read access"],
    ["workspace-write", "Write access"],
    ["danger-full-access", "Full access"]
  ]);
  const reasoningLabel = selectedLabel(settings.reasoning, [
    ["minimal", "Minimal"],
    ["low", "Low"],
    ["medium", "Medium"],
    ["high", "High"],
    ["xhigh", "Extra High"]
  ]);
  const verbosityLabel = selectedLabel(settings.verbosity, [
    ["low", "Short"],
    ["medium", "Normal"],
    ["high", "Full"]
  ]);
  const webLabel = selectedLabel(settings.webSearch, [
    ["disabled", "Web off"],
    ["cached", "Web"],
    ["live", "Live web"]
  ]);
  const speedLabel = selectedLabel(settings.speedTier, [
    ["standard", "Standard"],
    ["fast", "Fast"]
  ]);
  const projectPath = normalizeProjectPath(chat.projectPath || currentWorkspacePath() || "");
  const projectLabel = projectPath || "No project selected";
  const workspacePath = currentWorkspacePath();

  return `
    <section class="chatInfoSummary">
      <p class="chatInfoTitle">${escapeHtml(chat.title || "Codex chat")}</p>
      <div class="chatInfoMeta">
        <span>${escapeHtml(statusLabel(chat.status))}</span>
        <span>${escapeHtml(stats.ageLabel)}</span>
        <span>${escapeHtml(formatExactTokenCount(context.used))} / ${escapeHtml(formatExactTokenCount(context.limit))} tokens</span>
      </div>
    </section>

    <section class="chatInfoSection">
      <h3>Project</h3>
      <div class="chatInfoGrid">
        ${chatInfoItem("Chat project", projectLabel, true)}
        ${chatInfoItem("Current workspace", workspacePath || "No workspace folder", true)}
      </div>
      <div class="chatInfoProjectActions">
        <button id="chooseChatProject" type="button">Choose project</button>
        <button id="chooseCurrentWorkspace" type="button">Choose current workspace</button>
        <button id="useWorkspaceProject" type="button" ${workspacePath ? "" : "disabled"}>Use current workspace</button>
      </div>
    </section>

    <section class="chatInfoSection">
      <h3>Timeline</h3>
      <div class="chatInfoGrid">
        ${chatInfoItem("Created", formatDateTime(stats.createdAt))}
        ${chatInfoItem("Updated", formatDateTime(stats.updatedAt))}
        ${chatInfoItem("Last opened", stats.lastOpenedAt ? formatDateTime(stats.lastOpenedAt) : "Never")}
        ${chatInfoItem("Thread", chat.sessionId || "Not started", true)}
      </div>
    </section>

    <section class="chatInfoSection">
      <h3>Messages</h3>
      <div class="chatInfoGrid">
        ${chatInfoItem("Total messages", stats.messageCount)}
        ${chatInfoItem("User messages", stats.userCount)}
        ${chatInfoItem("Assistant answers", stats.assistantCount)}
        ${chatInfoItem("System / activity", stats.systemCount + stats.activityCount)}
        ${chatInfoItem("Errors", stats.errorCount)}
        ${chatInfoItem("File change cards", stats.changeSummaryCount)}
      </div>
    </section>

    <section class="chatInfoSection">
      <h3>Tokens</h3>
      <div class="chatInfoGrid">
        ${chatInfoItem("Estimated total", formatExactTokenCount(stats.totalTokens))}
        ${chatInfoItem("Incoming", formatExactTokenCount(stats.incomingTokens))}
        ${chatInfoItem("Outgoing", formatExactTokenCount(stats.outgoingTokens))}
        ${chatInfoItem("Events / metadata", formatExactTokenCount(stats.eventTokens))}
        ${chatInfoItem("Context used", formatExactTokenCount(context.used) + " / " + formatExactTokenCount(context.limit) + " (" + contextPercent + "%)")}
        ${chatInfoItem("Context window", formatExactTokenCount(context.limit))}
      </div>
    </section>

    <section class="chatInfoSection">
      <h3>Tools and Events</h3>
      <div class="chatInfoGrid">
        ${chatInfoItem("Tool / event calls", stats.eventCount)}
        ${chatInfoItem("Running events", stats.runningEventCount)}
        ${chatInfoItem("Finished events", stats.doneEventCount)}
        ${chatInfoItem("Failed events", stats.failedEventCount)}
      </div>
      ${stats.eventKindList ? '<ul class="chatInfoList">' + stats.eventKindList + '</ul>' : '<p class="modalHint">No tool or command events recorded yet.</p>'}
    </section>

    <section class="chatInfoSection">
      <h3>Settings</h3>
      <div class="chatInfoGrid">
        ${chatInfoItem("Model", modelDisplayLabel(settings.model))}
        ${chatInfoItem("Reasoning", reasoningLabel)}
        ${chatInfoItem("Verbosity", verbosityLabel)}
        ${chatInfoItem("Web", webLabel)}
        ${chatInfoItem("Speed", speedLabel)}
        ${chatInfoItem("Filesystem", sandboxLabel)}
        ${chatInfoItem("Pending attachments", stats.attachmentLabel)}
      </div>
    </section>
  `;
}

function formatContextPercent(value) {
  const percent = Number(value || 0);
  if (percent > 0 && percent < 1) {
    return String(Math.round(percent * 100) / 100);
  }
  return String(Math.round(percent * 10) / 10).replace(/\.0$/, "");
}

function chatInfoItem(label, value, mono) {
  return `
    <div class="chatInfoItem">
      <span class="chatInfoLabel">${escapeHtml(label)}</span>
      <span class="chatInfoValue${mono ? " chatInfoMono" : ""}">${escapeHtml(value)}</span>
    </div>
  `;
}

function chatInfoStats(chat) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const attachments = Array.isArray(chat.pendingAttachments) ? chat.pendingAttachments : [];
  const messageTimes = messages.map((item) => Number(item.at || 0)).filter((value) => Number.isFinite(value) && value > 0);
  const now = Date.now();
  const firstMessageAt = messageTimes.length ? Math.min.apply(null, messageTimes) : now;
  const lastMessageAt = messageTimes.length ? Math.max.apply(null, messageTimes) : firstMessageAt;
  const createdAt = Number(chat.createdAt || firstMessageAt || now) || now;
  const updatedAt = Number(chat.updatedAt || chat.lastOpenedAt || lastMessageAt || createdAt) || createdAt;
  const roleCounts = {};
  const eventKinds = {};
  const eventStatuses = {};

  for (const message of messages) {
    const role = String(message.role || "assistant");
    roleCounts[role] = (roleCounts[role] || 0) + 1;
    if (role === "event") {
      const kind = String(message.kind || "event");
      const status = String(message.status || "info");
      eventKinds[kind] = (eventKinds[kind] || 0) + 1;
      eventStatuses[status] = (eventStatuses[status] || 0) + 1;
    }
  }

  const attachmentBytes = attachments.reduce((sum, item) => sum + Number(item.size || 0), 0);
  const attachmentLabel = attachments.length
    ? attachments.length + " / " + formatBytes(attachmentBytes)
    : "None";
  const eventKindList = Object.keys(eventKinds)
    .sort()
    .map((kind) => '<li>' + escapeHtml(eventBadge(kind, "") + " " + eventKinds[kind]) + '</li>')
    .join("");

  return {
    createdAt,
    updatedAt,
    lastOpenedAt: Number(chat.lastOpenedAt || 0),
    ageLabel: "Created " + formatDuration(now - createdAt) + " ago",
    messageCount: messages.length,
    userCount: roleCounts.user || 0,
    assistantCount: roleCounts.assistant || 0,
    systemCount: roleCounts.system || 0,
    activityCount: roleCounts.activity || 0,
    errorCount: roleCounts.error || 0,
    changeSummaryCount: roleCounts.changeSummary || 0,
    eventCount: roleCounts.event || 0,
    runningEventCount: eventStatuses.running || 0,
    doneEventCount: eventStatuses.done || 0,
    failedEventCount: eventStatuses.error || 0,
    eventKindList,
    attachmentLabel,
    totalTokens: estimateChatTokens(chat),
    incomingTokens: estimateTokensForRoles(chat, ["user", "system"]) + estimateAttachmentTokens(chat),
    outgoingTokens: estimateTokensForRoles(chat, ["assistant"]),
    eventTokens: estimateTokensForRoles(chat, ["activity", "event", "error", "changeSummary"])
  };
}
