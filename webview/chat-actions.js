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
  chat.status = "running";
  chat.draftPrompt = "";
  chat.pendingAttachments = [];
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
  renderChatCard(chatId);
  persist();
  vscode.postMessage({
    type: "sendPrompt",
    chatId,
    prompt: finalPrompt,
    sessionId: chat.sessionId,
    settings: chat.settings,
    projectPath: chat.projectPath || currentWorkspacePath() || "",
    state
  });
}
