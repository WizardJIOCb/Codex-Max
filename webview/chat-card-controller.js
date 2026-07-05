// Chat card DOM updates, bindings, message controls, and duration labels. Loaded before main.js.
function bindChatCards(previousScrollState, autoScroll) {
  const scrollState = previousScrollState || new Map();
  for (const chat of state.chats) {
    const card = document.querySelector('[data-chat-id="' + chat.id + '"]');
    if (card) {
      bindChatCardControls(chat, card, scrollState.get(chat.id), autoScroll);
    }
  }
}

function scheduleChatCardRender(chatId) {
  if (!chatId) {
    return;
  }

  pendingChatRenderIds.add(chatId);
  if (pendingChatRenderFrame) {
    return;
  }

  pendingChatRenderFrame = requestAnimationFrame(flushChatCardRenders);
}

function clearPendingChatRenders() {
  if (pendingChatRenderFrame) {
    cancelAnimationFrame(pendingChatRenderFrame);
    pendingChatRenderFrame = 0;
  }
  pendingChatRenderIds.clear();
}

function flushChatCardRenders() {
  const ids = Array.from(pendingChatRenderIds);
  pendingChatRenderIds.clear();
  pendingChatRenderFrame = 0;
  if (!ids.length) {
    return;
  }

  for (const chatId of ids) {
    renderChatCard(chatId, { deferAfterRender: true });
  }
  refreshBoardUsage();
  updateVoiceButtons();
  syncDurationTimer();
}

function renderChatCard(chatId, options) {
  const renderOptions = options && typeof options === "object" ? options : {};
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  if (!chat || !card) {
    render();
    return;
  }

  const previous = captureSingleMessageScrollState(card);
  const board = normalizeBoardSettings(state.boardSettings);
  const template = document.createElement("template");
  template.innerHTML = renderChat(chat).trim();
  const nextCard = template.content.firstElementChild;
  if (!nextCard) {
    render();
    return;
  }

  card.replaceWith(nextCard);
  bindChatCardControls(chat, nextCard, previous, board.autoScroll);
  if (!renderOptions.deferAfterRender) {
    refreshBoardUsage();
    updateVoiceButtons();
    syncDurationTimer();
  }
}

function renderChatChrome(chatId) {
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  if (!chat || !card) {
    return false;
  }

  const template = document.createElement("template");
  template.innerHTML = renderChat(chat).trim();
  const nextCard = template.content.firstElementChild;
  const nextHeader = nextCard ? nextCard.querySelector(".chatHeader") : null;
  const nextComposer = nextCard ? nextCard.querySelector(".composer") : null;
  const currentHeader = card.querySelector(".chatHeader");
  const currentComposer = card.querySelector(".composer");
  if (!nextHeader || !nextComposer || !currentHeader || !currentComposer) {
    renderChatCard(chatId);
    return false;
  }

  currentHeader.replaceWith(nextHeader);
  currentComposer.replaceWith(nextComposer);
  bindChatChromeControls(chat, card);
  refreshBoardUsage();
  updateVoiceButtons();
  syncDurationTimer();
  return true;
}

function renderChatMessagesPanel(chatId, options) {
  const renderOptions = options && typeof options === "object" ? options : {};
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  if (!chat || !card) {
    render();
    return false;
  }

  const messages = card.querySelector(".messages");
  if (!messages) {
    renderChatCard(chatId, renderOptions);
    return false;
  }

  const previousScroll = captureSingleMessageScrollState(card);
  const expandedKeys = captureExpandedMessageKeys(messages);
  const existingByKey = new Map();
  for (const node of messages.querySelectorAll(":scope > [data-message-key]")) {
    existingByKey.set(node.dataset.messageKey, node);
  }

  const template = document.createElement("template");
  template.innerHTML = renderChatMessages(chat);
  const fragment = document.createDocumentFragment();
  for (const nextNode of Array.from(template.content.children)) {
    const key = nextNode.dataset ? nextNode.dataset.messageKey : "";
    const existing = key ? existingByKey.get(key) : null;
    const signature = nextNode.dataset ? nextNode.dataset.renderSignature : "";
    if (existing && existing.dataset.renderSignature === signature) {
      fragment.appendChild(existing);
      continue;
    }

    if (key && expandedKeys.has(key)) {
      restoreExpandedMessage(nextNode);
    }
    bindMessageContentControls(nextNode);
    fragment.appendChild(nextNode);
  }

  messages.replaceChildren(fragment);
  const board = normalizeBoardSettings(state.boardSettings);
  restoreMessageScroll(chatId, messages, previousScroll, board.autoScroll, chatScrollSignature(chat));
  if (!renderOptions.deferAfterRender) {
    refreshBoardUsage();
    updateVoiceButtons();
    syncDurationTimer();
  }
  return true;
}

function captureExpandedMessageKeys(messages) {
  const keys = new Set();
  if (!messages) {
    return keys;
  }

  for (const item of messages.querySelectorAll(":scope > .message.expanded[data-message-key]")) {
    keys.add(item.dataset.messageKey);
  }
  return keys;
}

function restoreExpandedMessage(item) {
  if (!item) {
    return;
  }

  item.classList.add("expanded");
  const eventSummary = item.querySelector(".eventSummary");
  const changeSummary = item.querySelector(".changeCard");
  const toggle = item.querySelector(".eventToggle, .changeAction");
  if (eventSummary) {
    eventSummary.setAttribute("aria-expanded", "true");
  }
  if (changeSummary) {
    changeSummary.setAttribute("aria-expanded", "true");
  }
  if (toggle) {
    const title = item.classList.contains("changeSummary") ? "Collapse changes" : "Collapse details";
    toggle.setAttribute("title", title);
    toggle.setAttribute("aria-label", title);
  }
}

function renderEventMessage(chatId, eventId) {
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  if (!chat || !card || !eventId) {
    return false;
  }

  const messages = card.querySelector(".messages");
  const existingNode = messages
    ? Array.from(messages.querySelectorAll("[data-message-id]")).find((node) => node.dataset.messageId === eventId)
    : null;
  const messageIndex = Array.isArray(chat.messages)
    ? chat.messages.findIndex((message) => message.role === "event" && message.eventId === eventId)
    : -1;
  const message = messageIndex >= 0 ? chat.messages[messageIndex] : null;
  if (!messages || !existingNode || !message) {
    return false;
  }

  const wasExpanded = existingNode.classList.contains("expanded");
  const previousScroll = captureSingleMessageScrollState(card);
  const template = document.createElement("template");
  template.innerHTML = renderMessage(message, chat, messageIndex).trim();
  const nextNode = template.content.firstElementChild;
  if (!nextNode) {
    return false;
  }

  if (wasExpanded) {
    nextNode.classList.add("expanded");
    const summary = nextNode.querySelector(".eventSummary, .changeCard");
    const toggle = nextNode.querySelector(".eventToggle, .changeAction");
    if (summary) {
      summary.setAttribute("aria-expanded", "true");
    }
    if (toggle) {
      const title = nextNode.classList.contains("changeSummary") ? "Collapse changes" : "Collapse details";
      toggle.setAttribute("title", title);
      toggle.setAttribute("aria-label", title);
    }
  }

  existingNode.replaceWith(nextNode);
  bindMessageContentControls(nextNode);
  const board = normalizeBoardSettings(state.boardSettings);
  restoreMessageScroll(chatId, messages, previousScroll, board.autoScroll, chatScrollSignature(chat));
  refreshBoardUsage();
  updateVoiceButtons();
  syncDurationTimer();
  return true;
}

function bindChatChromeControls(chat, card) {
  if (!chat || !card) {
    return;
  }

  const title = card.querySelector(".title");
  if (title) {
    title.addEventListener("input", (event) => {
      chat.title = event.target.value;
      chat.updatedAt = Date.now();
      persist();
    });
  }

  const removeButton = card.querySelector("[data-action='remove']");
  const clearButton = card.querySelector("[data-action='clear']");
  const infoButton = card.querySelector("[data-action='info']");
  if (removeButton) {
    removeButton.addEventListener("click", () => removeChat(chat.id));
  }
  if (clearButton) {
    clearButton.addEventListener("click", () => clearChat(chat.id));
  }
  if (infoButton) {
    infoButton.addEventListener("click", () => openChatInfo(chat.id));
  }
  const contextInfoButton = card.querySelector("[data-action='context-info']");
  if (contextInfoButton) {
    contextInfoButton.addEventListener("click", () => openChatInfo(chat.id));
  }
  const attachButton = card.querySelector("[data-action='attach']");
  if (attachButton) {
    attachButton.addEventListener("click", () => {
      vscode.postMessage({ type: "pickFiles", chatId: chat.id });
    });
  }
  const voiceButton = card.querySelector("[data-action='voice']");
  if (voiceButton) {
    voiceButton.addEventListener("click", () => toggleVoiceInput(chat.id));
  }
  const voiceFileButton = card.querySelector("[data-action='voice-file']");
  if (voiceFileButton) {
    voiceFileButton.addEventListener("click", () => pickLocalWhisperAudioFile(chat.id));
  }
  const sendButton = card.querySelector(".send");
  if (sendButton) {
    sendButton.addEventListener("click", () => {
      if (chat.status === "running") {
        stopChat(chat.id);
      } else {
        sendPrompt(chat.id);
      }
    });
  }

  for (const control of card.querySelectorAll("[data-setting]")) {
    control.addEventListener("change", (event) => {
      chat.settings[event.target.dataset.setting] = event.target.value;
      chat.updatedAt = Date.now();
      renderChatChrome(chat.id);
      persist();
    });
    control.addEventListener("input", (event) => {
      chat.settings[event.target.dataset.setting] = event.target.value;
      chat.updatedAt = Date.now();
      persist();
    });
  }

  for (const chip of card.querySelectorAll("[data-select-setting]")) {
    chip.addEventListener("click", (event) => {
      event.stopPropagation();
      openSelectMenu(chat.id, event.currentTarget);
    });
    chip.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      openSelectMenu(chat.id, event.currentTarget);
    });
  }

  for (const remove of card.querySelectorAll("[data-remove-attachment]")) {
    remove.addEventListener("click", (event) => {
      removeAttachment(chat.id, event.currentTarget.dataset.removeAttachment);
    });
  }

  const promptInput = card.querySelector(".promptInput");
  if (!promptInput) {
    return;
  }
  promptInput.addEventListener("input", () => {
    chat.draftPrompt = promptInput.value;
    chat.updatedAt = Date.now();
    resizePromptInput(promptInput);
    persist();
  });
  promptInput.addEventListener("keydown", (event) => {
    if (shouldToggleVoiceFromKey(event)) {
      event.preventDefault();
      toggleVoiceInput(chat.id);
      return;
    }

    if (!shouldSendFromKey(event)) {
      return;
    }

    event.preventDefault();
    sendPrompt(chat.id);
  });
  resizePromptInput(promptInput);
  bindFileDrop(card, chat.id, chat.status === "running");
}

function bindChatCardControls(chat, card, previousScroll, autoScroll) {
  if (!chat || !card) {
    return;
  }

  bindChatChromeControls(chat, card);

  const messages = card.querySelector(".messages");
  restoreMessageScroll(chat.id, messages, previousScroll, autoScroll, chatScrollSignature(chat));
  if (messages) {
    bindMessageScrollControls(chat.id, messages);
  }

  bindMessageContentControls(card);
}

function bindMessageContentControls(root) {
  if (!root) {
    return;
  }

  for (const summary of root.querySelectorAll(".eventSummary")) {
    summary.addEventListener("click", (event) => {
      const item = event.currentTarget.closest(".message.event");
      if (item) {
        toggleEventDetails(item);
      }
    });
    summary.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      const item = event.currentTarget.closest(".message.event");
      if (item) {
        toggleEventDetails(item);
      }
    });
  }

  for (const summary of root.querySelectorAll(".changeCard")) {
    summary.addEventListener("click", (event) => {
      const item = event.currentTarget.closest(".message.changeSummary");
      if (item) {
        toggleChangeDetails(item);
      }
    });
    summary.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      const item = event.currentTarget.closest(".message.changeSummary");
      if (item) {
        toggleChangeDetails(item);
      }
    });
  }

  for (const link of root.querySelectorAll("[data-open-file]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      vscode.postMessage({
        type: "openFile",
        path: event.currentTarget.dataset.openFile
      });
    });
  }

  for (const link of root.querySelectorAll("[data-open-url]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      vscode.postMessage({
        type: "openExternal",
        url: event.currentTarget.dataset.openUrl
      });
    });
  }

  for (const preview of root.querySelectorAll("[data-image-path]")) {
    requestImagePreview(preview);
  }

  for (const preview of root.querySelectorAll("[data-image-open]")) {
    preview.addEventListener("click", (event) => {
      event.preventDefault();
      openImageViewer(event.currentTarget);
    });
  }

  for (const button of root.querySelectorAll("[data-copy-chat]")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      copyMessageText(event.currentTarget);
    });
  }
}

function shouldToggleVoiceFromKey(event) {
  const board = normalizeBoardSettings(state.boardSettings);
  const shortcut = board.voiceShortcut;
  const key = String(event.key || "").toLowerCase();
  if (board.speechToText === "off" || shortcut === "off" || event.isComposing) {
    return false;
  }
  if (shortcut === "alt-v") {
    return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === "v";
  }
  if (shortcut === "ctrl-shift-v") {
    return (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && key === "v";
  }
  if (shortcut === "ctrl-m") {
    return (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && key === "m";
  }
  return false;
}

function shouldSendFromKey(event) {
  if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing) {
    return false;
  }

  const board = normalizeBoardSettings(state.boardSettings);
  const hasModifier = event.ctrlKey || event.metaKey;
  return board.sendWithCtrlEnter ? hasModifier : !hasModifier;
}

function copyMessageText(button) {
  const chat = state.chats.find((item) => item.id === button.dataset.copyChat);
  const index = Number.parseInt(button.dataset.copyIndex, 10);
  const message = chat && Array.isArray(chat.messages) ? chat.messages[index] : null;
  const text = message ? String(message.text || "") : "";
  if (!text) {
    return;
  }

  const copied = () => {
    button.classList.add("copied");
    button.title = "Copied";
    setTimeout(() => {
      button.classList.remove("copied");
      button.title = "Copy message";
    }, 1200);
  };

  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    navigator.clipboard.writeText(text).then(copied).catch(() => fallbackCopyText(text, copied));
    return;
  }

  fallbackCopyText(text, copied);
}

function fallbackCopyText(text, onCopied) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
    onCopied();
  } catch {
    // Clipboard can be unavailable in some webview contexts.
  } finally {
    textarea.remove();
  }
}

function syncDurationTimer() {
  const hasRunningDuration = Boolean(document.querySelector('[data-duration-end="0"]'));
  if (hasRunningDuration && !durationTimer) {
    durationTimer = setInterval(updateDurationLabels, 1000);
  } else if (!hasRunningDuration && durationTimer) {
    clearInterval(durationTimer);
    durationTimer = null;
  }
  updateDurationLabels();
}

function updateDurationLabels() {
  for (const item of document.querySelectorAll("[data-duration-start]")) {
    const start = Number(item.dataset.durationStart || 0);
    const end = Number(item.dataset.durationEnd || 0);
    const label = item.querySelector("[data-duration-label]");
    if (!start || !label) {
      continue;
    }

    label.textContent = (end ? "Worked for " : "Working for ") + formatDuration((end || Date.now()) - start);
  }
}

function toggleEventDetails(item) {
  const expanded = !item.classList.contains("expanded");
  item.classList.toggle("expanded", expanded);
  const summary = item.querySelector(".eventSummary");
  const toggle = item.querySelector(".eventToggle");
  if (summary) {
    summary.setAttribute("aria-expanded", expanded ? "true" : "false");
  }
  if (toggle) {
    const title = expanded ? "Collapse details" : "Expand details";
    toggle.setAttribute("title", title);
    toggle.setAttribute("aria-label", title);
  }
}

function toggleChangeDetails(item) {
  const expanded = !item.classList.contains("expanded");
  item.classList.toggle("expanded", expanded);
  const summary = item.querySelector(".changeCard");
  const toggle = item.querySelector(".changeAction");
  if (summary) {
    summary.setAttribute("aria-expanded", expanded ? "true" : "false");
  }
  if (toggle) {
    const title = expanded ? "Collapse changes" : "Expand changes";
    toggle.setAttribute("title", title);
    toggle.setAttribute("aria-label", title);
  }
}
