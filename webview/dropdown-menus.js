// Select chip and workspace dropdown menus. Loaded before main.js.
function openSelectMenu(chatId, chip) {
  if (!chip || chip.disabled) {
    return;
  }

  if (activeSelectMenu && activeSelectMenu.chip === chip) {
    closeSelectMenu();
    return;
  }

  closeSelectMenu();
  const chat = state.chats.find((item) => item.id === chatId);
  if (!chat) {
    return;
  }

  const setting = chip.dataset.selectSetting;
  const selectedValue = chip.dataset.selectValue || "";
  const options = parseSelectOptions(chip.dataset.selectOptions);
  if (!setting || !options.length) {
    return;
  }

  chip.classList.add("open");
  const menu = document.createElement("div");
  menu.className = "selectMenu";
  menu.setAttribute("role", "listbox");

  for (const item of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    button.dataset.value = item.value;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", item.value === selectedValue ? "true" : "false");
    if (item.value === selectedValue) {
      button.classList.add("active");
    }

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      chat.settings[setting] = item.value;
      chat.updatedAt = Date.now();
      closeSelectMenu();
      syncActiveWorkspaceChat(chatId);
      renderChatChrome(chatId);
      persist({ skipFullSync: true });
    });
    menu.appendChild(button);
  }

  document.body.appendChild(menu);
  positionSelectMenu(menu, chip);

  const closeOnOutside = (event) => {
    if (!menu.contains(event.target) && event.target !== chip && !chip.contains(event.target)) {
      closeSelectMenu();
    }
  };
  setTimeout(() => document.addEventListener("click", closeOnOutside, { once: true }), 0);

  activeSelectMenu = {
    menu,
    chip,
    closeOnOutside
  };
}

function openWorkspaceMenu(button) {
  if (!button) {
    return;
  }

  if (activeWorkspaceMenu && activeWorkspaceMenu.button === button) {
    closeWorkspaceMenu();
    return;
  }

  closeSelectMenu();
  closeWorkspaceMenu();
  button.classList.add("open");
  button.setAttribute("aria-expanded", "true");

  const menu = document.createElement("div");
  menu.className = "selectMenu workspaceMenu";
  menu.setAttribute("role", "listbox");

  const newButton = document.createElement("button");
  newButton.type = "button";
  newButton.textContent = "New workspace";
  newButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closeWorkspaceMenu();
    vscode.postMessage({ type: "pickNewWorkspace" });
  });
  menu.appendChild(newButton);

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.textContent = "Export workspaces";
  exportButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closeWorkspaceMenu();
    syncActiveWorkspaceFromState();
    vscode.postMessage({ type: "exportWorkspaces", state });
  });
  menu.appendChild(exportButton);

  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.textContent = "Import workspaces";
  importButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closeWorkspaceMenu();
    vscode.postMessage({ type: "importWorkspaces" });
  });
  menu.appendChild(importButton);

  const divider = document.createElement("div");
  divider.className = "workspaceMenuDivider";
  menu.appendChild(divider);

  for (const workspace of workspaceList()) {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = workspaceDisplayName(workspace);
    item.title = workspaceTitle(workspace);
    item.dataset.workspaceId = workspace.id;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", workspace.id === state.activeWorkspaceId ? "true" : "false");
    if (workspace.id === state.activeWorkspaceId) {
      item.classList.add("active");
    }
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      closeWorkspaceMenu();
      switchWorkspace(workspace.id);
    });
    menu.appendChild(item);
  }

  document.body.appendChild(menu);
  positionSelectMenu(menu, button);

  const closeOnOutside = (event) => {
    if (!menu.contains(event.target) && event.target !== button && !button.contains(event.target)) {
      closeWorkspaceMenu();
    }
  };
  setTimeout(() => document.addEventListener("click", closeOnOutside, { once: true }), 0);

  activeWorkspaceMenu = {
    menu,
    button,
    closeOnOutside
  };
}

function closeSelectMenu() {
  if (!activeSelectMenu) {
    return;
  }

  document.removeEventListener("click", activeSelectMenu.closeOnOutside);
  activeSelectMenu.chip.classList.remove("open");
  activeSelectMenu.menu.remove();
  activeSelectMenu = null;
}

function closeWorkspaceMenu() {
  if (!activeWorkspaceMenu) {
    return;
  }

  document.removeEventListener("click", activeWorkspaceMenu.closeOnOutside);
  activeWorkspaceMenu.button.classList.remove("open");
  activeWorkspaceMenu.button.setAttribute("aria-expanded", "false");
  activeWorkspaceMenu.menu.remove();
  activeWorkspaceMenu = null;
}

function positionSelectMenu(menu, chip) {
  const rect = chip.getBoundingClientRect();
  menu.style.left = rect.left + "px";
  menu.style.top = rect.bottom + 6 + "px";
  menu.style.minWidth = Math.max(86, Math.ceil(rect.width) + 18) + "px";

  const menuRect = menu.getBoundingClientRect();
  const overflowRight = menuRect.right - window.innerWidth + 8;
  if (overflowRight > 0) {
    menu.style.left = Math.max(8, rect.left - overflowRight) + "px";
  }

  const overflowBottom = menuRect.bottom - window.innerHeight + 8;
  if (overflowBottom > 0) {
    menu.style.top = Math.max(8, rect.top - menuRect.height - 6) + "px";
  }
}

function parseSelectOptions(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.value === "string") : [];
  } catch {
    return [];
  }
}
