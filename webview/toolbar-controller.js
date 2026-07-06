// Toolbar rendering and board usage refresh controls. Loaded before main.js.
function renderToolbar() {
  countRenderStat("toolbar");
  const chatCount = state.chats.length;
  const overLimit = chatCount > config.maxVisibleChats;
  const usage = boardUsageInfo(state.chats, state.accountRateLimits);
  const workspacePath = currentWorkspacePath();
  const workspaceName = projectFolderName(workspacePath) || config.workspaceName;

  return `
    <header class="toolbar">
      <div class="brand">
        <strong>Codex Max</strong>
        <span title="${escapeAttr(workspacePath)}">${escapeHtml(workspaceName)}</span>
      </div>
      ${renderWorkspaceSelector()}
      ${renderBoardUsage(usage)}
      ${overLimit ? '<span class="hint">Board is getting dense</span>' : ''}
      <button id="openBoardSettings" class="secondary" title="Board settings">
        <svg viewBox="0 0 24 24" aria-hidden="true" class="smallIcon">
          <path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8 8 0 0 0-2.6-1.5L14 2.5h-4L9.6 5a8 8 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5A8.6 8.6 0 0 0 4.5 12c0 .5 0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a8 8 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"></path>
        </svg>
      </button>
      <button id="addChat" title="Add chat">+</button>
    </header>
  `;
}

function bindToolbarControls() {
  const addChatButton = document.getElementById("addChat");
  const settingsButton = document.getElementById("openBoardSettings");
  if (addChatButton) {
    addChatButton.addEventListener("click", addChat);
  }
  if (settingsButton) {
    settingsButton.addEventListener("click", openBoardSettings);
  }
  bindBoardUsageRefresh();

  const workspaceSelector = document.getElementById("workspaceSelector");
  if (!workspaceSelector) {
    return;
  }

  workspaceSelector.addEventListener("click", (event) => {
    event.stopPropagation();
    openWorkspaceMenu(workspaceSelector);
  });
  workspaceSelector.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    openWorkspaceMenu(workspaceSelector);
  });
}

function refreshToolbar() {
  const toolbar = document.querySelector(".toolbar");
  if (!toolbar) {
    return;
  }

  const template = document.createElement("template");
  template.innerHTML = renderToolbar().trim();
  const nextToolbar = template.content.firstElementChild;
  if (!nextToolbar) {
    return;
  }

  toolbar.replaceWith(nextToolbar);
  bindToolbarControls();
}

function refreshBoardUsage() {
  if (pendingBoardUsageFrame) {
    return;
  }

  pendingBoardUsageFrame = requestAnimationFrame(() => {
    pendingBoardUsageFrame = 0;
    refreshBoardUsageNow();
  });
}

function refreshBoardUsageNow() {
  countRenderStat("usage");
  const usageNode = document.querySelector(".boardUsage");
  if (!usageNode) {
    return;
  }

  const template = document.createElement("template");
  template.innerHTML = renderBoardUsage(boardUsageInfo(state.chats, state.accountRateLimits)).trim();
  const nextUsage = template.content.firstElementChild;
  if (nextUsage) {
    usageNode.replaceWith(nextUsage);
    bindBoardUsageRefresh();
  }
}

function bindBoardUsageRefresh() {
  const usageNode = document.querySelector(".boardUsage");
  if (!usageNode || usageNode.dataset.boundRefresh === "true") {
    return;
  }

  usageNode.dataset.boundRefresh = "true";
  usageNode.addEventListener("click", refreshAccountLimitsFromPill);
  usageNode.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    refreshAccountLimitsFromPill();
  });
}

function refreshAccountLimitsFromPill() {
  if (accountRateLimitsLoading) {
    return;
  }

  accountRateLimitsLoading = true;
  refreshBoardUsageNow();
  vscode.postMessage({
    type: "refreshRateLimits"
  });
}

function requestRateLimitsOnce() {
  if (rateLimitsRequestedOnce) {
    return;
  }

  rateLimitsRequestedOnce = true;
  vscode.postMessage({
    type: "refreshRateLimits",
    silent: true
  });
}
