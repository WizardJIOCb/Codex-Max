// Chat command actions used by card controls. Loaded before main.js.
function removeChat(chatId) {
  vscode.postMessage({ type: "stopChat", chatId });
  state.chats = state.chats.filter((chat) => chat.id !== chatId);
  if (activeChatInfoId === chatId) {
    activeChatInfoId = null;
  }
  if (!state.chats.length) {
    state.chats.push(createChat(1));
  }
  refreshBoardGrid({ preserveBoardScroll: true });
  persist();
}

function clearChat(chatId) {
  updateChat(chatId, (chat) => {
    chat.status = "idle";
    chat.editingMessageAt = 0;
    chat.editingOriginalMessages = [];
    chat.draftPrompt = "";
    chat.messages = [{
      role: "system",
      text: "Chat cleared. The Codex thread id is preserved.",
      at: Date.now()
    }];
  });
}

function openOfficialCodex(chatId, target) {
  updateChat(chatId, (chat) => {
    chat.status = "running";
  }, { render: "chrome" });
  vscode.postMessage({
    type: "openOfficialCodex",
    chatId,
    target,
    state
  });
}

function stopChat(chatId) {
  if (voiceChatId === chatId) {
    stopVoiceInput();
  }
  vscode.postMessage({ type: "stopChat", chatId });
  updateChat(chatId, (chat) => {
    chat.runFinishedAt = Date.now();
    chat.isThinking = false;
    chat.status = "idle";
    chat.messages.push({
      role: "activity",
      text: "Stopped.",
      at: Date.now()
    });
  });
}

function beginEditUserMessage(chatId, messageIndex) {
  const chat = state.chats.find((item) => item.id === chatId);
  if (!chat || !Array.isArray(chat.messages)) {
    return;
  }

  const index = Number.parseInt(messageIndex, 10);
  const message = chat.messages[index];
  if (!message || message.role !== "user" || index !== latestUserMessageIndex(chat)) {
    return;
  }

  if (voiceChatId === chatId) {
    stopVoiceInput();
  }
  if (chat.status === "running") {
    vscode.postMessage({ type: "stopChat", chatId });
  }

  updateChat(chatId, (current) => {
    current.editingOriginalMessages = current.messages.slice(index).map(cloneMessageForEdit);
    current.status = "idle";
    current.isThinking = false;
    current.runStartedAt = 0;
    current.runFinishedAt = 0;
    current.draftPrompt = editablePromptFromUserMessage(message.text);
    current.editingMessageAt = Number(message.at || Date.now());
    current.messages = current.messages.slice(0, index);
  }, { render: "chrome+messages" });

  requestAnimationFrame(() => {
    const card = document.querySelector('[data-chat-id="' + chatId + '"]');
    const textarea = card ? card.querySelector(".promptInput") : null;
    if (textarea) {
      textarea.focus();
      textarea.selectionStart = textarea.value.length;
      textarea.selectionEnd = textarea.value.length;
      resizePromptInput(textarea);
    }
  });
}

function cancelEditUserMessage(chatId) {
  updateChat(chatId, (chat) => {
    if (Array.isArray(chat.editingOriginalMessages) && chat.editingOriginalMessages.length) {
      chat.messages = chat.messages.concat(chat.editingOriginalMessages.map(cloneMessageForEdit));
    }
    chat.editingMessageAt = 0;
    chat.editingOriginalMessages = [];
    chat.draftPrompt = "";
  }, { render: "chrome+messages" });
}

function cloneMessageForEdit(message) {
  return JSON.parse(JSON.stringify(message || {}));
}

function editablePromptFromUserMessage(text) {
  return String(text || "").replace(/\n\nAttached: .+$/s, "").trim();
}

function resizePromptInput(textarea) {
  if (!textarea) {
    return;
  }

  const minHeight = 34;
  const maxHeight = 132;
  textarea.style.height = minHeight + "px";
  const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
  textarea.style.height = nextHeight + "px";
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

function sendPrompt(chatId) {
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  if (!chat || !card || chat.status === "running") {
    return;
  }

  const textarea = card.querySelector(".promptInput");
  const prompt = textarea.value.trim();
  const attachments = Array.isArray(chat.pendingAttachments) ? chat.pendingAttachments : [];
  if (!prompt && !attachments.length) {
    textarea.focus();
    return;
  }

  if (voiceChatId === chatId) {
    stopVoiceInput();
  }

  const messages = card.querySelector(".messages");
  if (messages && !isScrolledToBottom(messages)) {
    pauseChatAutoScroll(chatId, messages);
    rememberMessageScroll(chatId, messages, undefined, false);
  } else {
    stickChatToBottom(chatId, messages);
  }

  textarea.value = "";
  const now = Date.now();
  const wasEditing = Boolean(chat.editingMessageAt);
  chat.status = "running";
  chat.draftPrompt = "";
  chat.pendingAttachments = [];
  chat.editingMessageAt = 0;
  chat.editingOriginalMessages = [];
  chat.updatedAt = now;
  chat.runStartedAt = now;
  chat.runFinishedAt = 0;
  chat.isThinking = false;
  chat.messages.push({
    role: "user",
    text: userMessageText(prompt, attachments),
    at: now
  });

  const finalPrompt = promptWithAttachments(prompt, attachments);
  const promptForCodex = wasEditing && chat.sessionId
    ? "I edited my previous message. Treat this as a replacement for that previous request and answer the revised request only:\n\n" + finalPrompt
    : finalPrompt;
  syncActiveWorkspaceChat(chatId);
  renderChatCard(chatId);
  persist({ skipFullSync: true });
  vscode.postMessage({
    type: "sendPrompt",
    chatId,
    prompt: promptForCodex,
    sessionId: chat.sessionId,
    settings: chat.settings,
    projectPath: chat.projectPath || currentWorkspacePath() || "",
    state
  });
}
