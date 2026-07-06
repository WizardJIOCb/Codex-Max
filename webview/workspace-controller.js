// Workspace and chat collection actions. Loaded before main.js.
function addChat() {
  state.chats.push(createChat(state.chats.length + 1));
  refreshBoardGrid({ preserveBoardScroll: true });
  persist();
}

function workspaceList() {
  if (!Array.isArray(state.workspaces)) {
    state.workspaces = [];
  }
  if (!state.workspaces.length) {
    const workspace = activeWorkspaceProfile();
    if (workspace && !state.workspaces.some((item) => item.id === workspace.id)) {
      state.workspaces.push(workspace);
    }
  }
  return state.workspaces;
}

function workspaceChatCount(workspace) {
  if (workspace && workspace.id === state.activeWorkspaceId) {
    return Array.isArray(state.chats) ? state.chats.length : 0;
  }
  return Array.isArray(workspace && workspace.chats) ? workspace.chats.length : 0;
}

function workspaceDisplayName(workspace) {
  const name = String(workspace && workspace.name || "Workspace").trim() || "Workspace";
  return name + " [" + workspaceChatCount(workspace) + "]";
}

function workspaceTitle(workspace) {
  const path = String(workspace && workspace.path || "").trim();
  const label = workspaceDisplayName(workspace);
  return path ? label + " - " + path : label;
}

function createWorkspaceProfileAndSwitch(selectedPath) {
  syncActiveWorkspaceFromState();
  const workspacePath = normalizeProjectPath(selectedPath || config.workspacePath || "");
  const baseName = projectFolderName(workspacePath) || "Workspace";
  const boardSettings = normalizeBoardSettings({
    chatsPerRow: 2,
    chatsPerColumn: 2,
    currentWorkspacePath: workspacePath
  });
  const workspace = createWorkspaceProfile({
    id: newId(),
    name: uniqueWorkspaceName(baseName),
    path: workspacePath,
    boardSettings,
    chats: [
      createChatForWorkspace(1, workspacePath),
      createChatForWorkspace(2, workspacePath),
      createChatForWorkspace(3, workspacePath),
      createChatForWorkspace(4, workspacePath)
    ]
  }, workspaceList().length);
  workspaceList().push(workspace);
  switchWorkspace(workspace.id);
}

function uniqueWorkspaceName(baseName) {
  const base = String(baseName || "Workspace").trim() || "Workspace";
  const used = new Set(workspaceList().map((workspace) => String(workspace.name || "")));
  if (!used.has(base)) {
    return base;
  }

  let index = 2;
  while (used.has(base + " " + index)) {
    index += 1;
  }
  return base + " " + index;
}

function switchWorkspace(workspaceId) {
  if (!workspaceId || workspaceId === state.activeWorkspaceId) {
    return;
  }

  syncActiveWorkspaceFromState();
  const workspace = workspaceList().find((item) => item.id === workspaceId);
  if (!workspace) {
    return;
  }

  state.activeWorkspaceId = workspace.id;
  state.selectedChatId = workspace.selectedChatId || null;
  state.boardSettings = cloneBoardSettings(workspace.boardSettings);
  state.chats = workspace.chats.length
    ? workspace.chats.map((chat) => cloneChat(chat, workspace.path))
    : [createChatForWorkspace(1, workspace.path)];
  activeChatInfoId = null;
  chatScrollState = new Map();
  chatAutoScrollPaused = new Set();
  chatPausedScrollTop = new Map();
  chatStickyScroll = new Set();
  render();
  persist();
}

function applyWorkspaceImport(importedState, sourcePath) {
  state = normalizeState(importedState || {});
  syncActiveWorkspaceFromState();
  activeChatInfoId = null;
  chatScrollState = new Map();
  chatAutoScrollPaused = new Set();
  chatPausedScrollTop = new Map();
  chatStickyScroll = new Set();
  render();
  persist();
  showToast("Imported Codex Max workspaces" + (sourcePath ? " from " + sourcePath : "") + ".");
}

function applyWorkspacePreset(preset, sourcePath) {
  const normalized = normalizeWorkspacePreset(preset || {});
  state.boardSettings = cloneBoardSettings(normalized.boardSettings);
  const workspace = activeWorkspaceProfile();
  if (workspace) {
    workspace.name = normalized.name || workspace.name;
    workspace.path = currentWorkspacePathFromSettings(normalized.boardSettings);
    workspace.boardSettings = cloneBoardSettings(normalized.boardSettings);
  }
  refreshBoardAfterSettingsChange();
  persist();
  showToast("Applied workspace preset" + (sourcePath ? " from " + sourcePath : "") + ".");
}

function currentWorkspacePreset() {
  const workspace = activeWorkspaceProfile();
  return {
    name: workspace && workspace.name ? workspace.name : "Workspace preset",
    projectName: projectFolderName(currentWorkspacePath()) || "",
    boardSettings: cloneBoardSettings(state.boardSettings)
  };
}

function normalizeWorkspacePreset(preset) {
  const boardSettings = normalizeBoardSettings(preset && preset.boardSettings || preset || {});
  return {
    name: String(preset && preset.name || "Workspace preset"),
    projectName: String(preset && preset.projectName || ""),
    boardSettings
  };
}
