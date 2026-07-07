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
  countRenderStat("chatCard");
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
  countRenderStat("chatChrome");
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
  refreshChatContextIndicator(chatId);
  refreshBoardUsage();
  updateVoiceButtons();
  syncDurationTimer();
  return true;
}

function refreshChatContextIndicator(chatId) {
  const chat = state.chats.find((item) => item.id === chatId);
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  const indicator = card ? card.querySelector(".contextIndicator") : null;
  if (!chat || !indicator) {
    return;
  }

  const settings = normalizeSettings(chat.settings);
  const info = contextUsageInfo(chat, settings.model);
  const progress = contextIndicatorProgress(info);
  const label = info.tooltip + "\nClick for chat information";
  const progressRing = indicator.querySelector(".contextRingProgress");
  if (progressRing) {
    progressRing.style.strokeDasharray = progress + " 100";
  }
  indicator.setAttribute("title", label);
  indicator.setAttribute("aria-label", label);
}

function refreshAllChatContextIndicators() {
  const chats = Array.isArray(state.chats) ? state.chats : [];
  for (const chat of chats) {
    refreshChatContextIndicator(chat.id);
  }
}

function renderChatMessagesPanel(chatId, options) {
  countRenderStat("chatMessages");
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
  const existingChildren = Array.from(messages.children);
  const entries = renderChatMessageEntries(chat);
  const tailStart = unchangedMessagePrefixLength(existingChildren, entries);
  const canPatchTail = tailStart > 0 || !existingChildren.length;
  const board = normalizeBoardSettings(state.boardSettings);
  const animateNewMessages = Boolean(board.animateMessages && existingChildren.length);

  let reused = 0;
  let created = 0;
  const animationQueue = [];

  if (canPatchTail) {
    reused = tailStart;
    removeMessageChildrenFrom(messages, tailStart);
    const fragment = document.createDocumentFragment();
    for (let index = tailStart; index < entries.length; index += 1) {
      const nextNode = createMessageNodeFromEntry(entries[index], expandedKeys, animateNewMessages, animationQueue);
      if (nextNode) {
        created += 1;
        fragment.appendChild(nextNode);
      }
    }
    messages.appendChild(fragment);
    countRenderStat("messageTailPatches");
  } else {
    const existingByKey = new Map();
    for (const node of existingChildren) {
      if (node.dataset && node.dataset.messageKey) {
        existingByKey.set(node.dataset.messageKey, node);
      }
    }

    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const existing = entry.key ? existingByKey.get(entry.key) : null;
      if (existing && existing.dataset.renderSignature === entry.signature) {
        fragment.appendChild(existing);
        reused += 1;
        continue;
      }

      const nextNode = createMessageNodeFromEntry(entry, expandedKeys, animateNewMessages, animationQueue);
      if (nextNode) {
        created += 1;
        fragment.appendChild(nextNode);
      }
    }
    messages.replaceChildren(fragment);
    countRenderStat("messageFullRebuilds");
  }

  countRenderStat("messageNodesReused", reused);
  countRenderStat("messageNodesCreated", created);
  restoreMessageScroll(chatId, messages, previousScroll, board.autoScroll, chatScrollSignature(chat));
  startQueuedMessageAnimations(animationQueue, chatId, messages);
  refreshChatContextIndicator(chatId);
  if (!renderOptions.deferAfterRender) {
    refreshBoardUsage();
    updateVoiceButtons();
    syncDurationTimer();
  }
  return true;
}

function unchangedMessagePrefixLength(existingChildren, entries) {
  const limit = Math.min(existingChildren.length, entries.length);
  let index = 0;
  while (index < limit) {
    const node = existingChildren[index];
    const entry = entries[index];
    const dataset = node && node.dataset ? node.dataset : {};
    if (String(dataset.messageKey || "") !== entry.key || String(dataset.renderSignature || "") !== entry.signature) {
      break;
    }
    index += 1;
  }
  return index;
}

function removeMessageChildrenFrom(messages, startIndex) {
  while (messages.children.length > startIndex) {
    messages.removeChild(messages.lastElementChild);
  }
}

function createMessageNodeFromEntry(entry, expandedKeys, animate, animationQueue) {
  if (!entry) {
    return null;
  }

  const template = document.createElement("template");
  template.innerHTML = entry.html;
  const nextNode = template.content.firstElementChild;
  if (!nextNode) {
    return null;
  }

  if (entry.key && expandedKeys.has(entry.key)) {
    restoreExpandedMessage(nextNode);
  }
  restoreExpandedDescendants(nextNode, expandedKeys);
  if (shouldAnimateMessageEntry(entry, animate)) {
    rememberAnimatedMessageKey(entry.key);
    nextNode.classList.add("newMessage");
    const typewriter = prepareTypewriterMessage(nextNode);
    if (typewriter && Array.isArray(animationQueue)) {
      animationQueue.push(typewriter);
    }
  }
  bindMessageContentControls(nextNode);
  return nextNode;
}

function restoreExpandedDescendants(root, expandedKeys) {
  if (!root || !expandedKeys || !expandedKeys.size) {
    return;
  }

  for (const item of root.querySelectorAll(".message[data-message-key]")) {
    if (item === root || !expandedKeys.has(item.dataset.messageKey)) {
      continue;
    }
    restoreExpandedMessage(item);
  }
}

function shouldAnimateMessageEntry(entry, animate) {
  if (!animate || prefersReducedMotion()) {
    return false;
  }
  const key = String(entry && entry.key || "");
  return Boolean(key && !animatedMessageKeys.has(key));
}

function rememberAnimatedMessageKey(key) {
  if (!key) {
    return;
  }
  animatedMessageKeys.add(key);
  if (animatedMessageKeys.size <= 3000) {
    return;
  }

  const recent = Array.from(animatedMessageKeys).slice(-1800);
  animatedMessageKeys = new Set(recent);
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function prepareTypewriterMessage(node) {
  if (!node || !node.classList || !node.classList.contains("assistant")) {
    return null;
  }

  const segments = [];
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
    acceptNode(textNode) {
      if (!textNode.nodeValue || !textNode.nodeValue.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let current = walker.nextNode();
  while (current) {
    const chars = Array.from(current.nodeValue);
    const container = typewriterSegmentContainer(current, node);
    if (container) {
      container.classList.add("typingSegmentHidden");
    }
    segments.push({
      node: current,
      container,
      chars,
      length: chars.length
    });
    current.nodeValue = "";
    current = walker.nextNode();
  }

  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (!total) {
    return null;
  }

  const caret = document.createElement("span");
  caret.className = "typingCaret";
  caret.setAttribute("aria-hidden", "true");
  node.classList.add("typingMessage");
  return {
    node,
    caret,
    segments,
    total
  };
}

function startQueuedMessageAnimations(queue, chatId, messages) {
  if (!Array.isArray(queue) || !queue.length) {
    return;
  }

  requestAnimationFrame(() => {
    for (const animation of queue) {
      startTypewriterMessage(animation, chatId, messages);
    }
  });
}

function startTypewriterMessage(animation, chatId, messages) {
  if (!animation || !animation.node || !animation.segments || !animation.total) {
    return;
  }

  const duration = Math.max(520, Math.min(4200, animation.total * 16));
  const startedAt = performance.now();
  let previousCount = -1;

  const renderFrame = (now) => {
    if (!animation.node.isConnected) {
      return;
    }

    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 2.1);
    const visibleCount = Math.min(animation.total, Math.max(1, Math.floor(animation.total * eased)));
    if (visibleCount !== previousCount) {
      revealTypewriterCharacters(animation.segments, visibleCount, animation);
      previousCount = visibleCount;
      keepTypingMessageInView(chatId, messages);
    }

    if (progress < 1) {
      requestAnimationFrame(renderFrame);
      return;
    }

    revealTypewriterCharacters(animation.segments, animation.total, animation);
    removeTypewriterCaret(animation);
    cleanupTypewriterSegments(animation.segments);
    animation.node.classList.remove("typingMessage");
    keepTypingMessageInView(chatId, messages);
  };

  requestAnimationFrame(renderFrame);
}

function revealTypewriterCharacters(segments, visibleCount, animation) {
  let remaining = visibleCount;
  let lastVisibleNode = null;
  for (const segment of segments) {
    let shown = 0;
    if (remaining <= 0) {
      segment.node.nodeValue = "";
    } else if (remaining >= segment.length) {
      segment.node.nodeValue = segment.chars.join("");
      shown = segment.length;
    } else {
      segment.node.nodeValue = segment.chars.slice(0, remaining).join("");
      shown = remaining;
    }

    if (shown > 0 && segment.container) {
      segment.container.classList.remove("typingSegmentHidden");
    }
    if (shown > 0) {
      lastVisibleNode = segment.node;
    }
    remaining -= segment.length;
  }

  if (animation && lastVisibleNode) {
    moveTypewriterCaret(animation, lastVisibleNode);
  }
}

function moveTypewriterCaret(animation, textNode) {
  if (!animation || !animation.caret || !textNode || !textNode.parentNode) {
    return;
  }
  textNode.parentNode.insertBefore(animation.caret, textNode.nextSibling);
}

function removeTypewriterCaret(animation) {
  if (animation && animation.caret && animation.caret.parentNode) {
    animation.caret.remove();
  }
}

function cleanupTypewriterSegments(segments) {
  for (const segment of segments) {
    if (segment.container) {
      segment.container.classList.remove("typingSegmentHidden");
    }
  }
}

function typewriterSegmentContainer(textNode, root) {
  const parent = textNode && textNode.parentElement;
  if (!parent || !root) {
    return null;
  }

  const container = parent.closest("pre, table, blockquote, li, p, h1, h2, h3, h4, h5, h6, dt, dd");
  if (!container || container === root || !root.contains(container)) {
    return null;
  }
  return container;
}

function keepTypingMessageInView(chatId, messages) {
  if (!messages || !chatId || chatAutoScrollPaused.has(chatId)) {
    return;
  }
  if (chatStickyScroll.has(chatId) || isScrolledToBottom(messages)) {
    messages.scrollTop = messages.scrollHeight;
    rememberMessageScroll(chatId, messages, undefined, false);
  }
}

function captureExpandedMessageKeys(messages) {
  const keys = new Set();
  if (!messages) {
    return keys;
  }

  for (const item of messages.querySelectorAll(".message.expanded[data-message-key]")) {
    if (item.classList && item.classList.contains("message") && item.classList.contains("expanded") && item.dataset && item.dataset.messageKey) {
      keys.add(item.dataset.messageKey);
    }
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
  refreshChatContextIndicator(chatId);
  refreshBoardUsage();
  updateVoiceButtons();
  syncDurationTimer();
  return true;
}

function bindChatReorderControls(chat, card) {
  const header = card ? card.querySelector(".chatHeader") : null;
  if (!chat || !card || !header) {
    return;
  }
  if (header.dataset.reorderBound === "true") {
    return;
  }

  header.dataset.reorderBound = "true";
  header.draggable = true;
  header.setAttribute("aria-grabbed", "false");

  header.addEventListener("dragstart", (event) => {
    if (event.target && event.target.closest && event.target.closest(".actions")) {
      event.preventDefault();
      return;
    }

    draggedChatId = chat.id;
    header.setAttribute("aria-grabbed", "true");
    card.classList.add("chatDragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-codex-max-chat", chat.id);
      event.dataTransfer.setData("text/plain", chat.title || "Codex chat");
    }
  });

  header.addEventListener("dragend", () => {
    draggedChatId = "";
    header.setAttribute("aria-grabbed", "false");
    clearChatReorderMarkers();
  });

  if (card.dataset.reorderDropBound === "true") {
    return;
  }
  card.dataset.reorderDropBound = "true";

  card.addEventListener("dragover", (event) => {
    if (!isChatReorderDrag(event) || draggedChatId === chat.id) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    markChatReorderTarget(card, shouldDropAfterCard(event, card));
  });

  card.addEventListener("dragleave", (event) => {
    if (!isChatReorderDrag(event)) {
      return;
    }
    if (!event.relatedTarget || !card.contains(event.relatedTarget)) {
      card.classList.remove("reorderBefore", "reorderAfter");
    }
  });

  card.addEventListener("drop", (event) => {
    if (!isChatReorderDrag(event) || draggedChatId === chat.id) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const sourceId = draggedChatId || (event.dataTransfer ? event.dataTransfer.getData("application/x-codex-max-chat") : "");
    reorderChat(sourceId, chat.id, shouldDropAfterCard(event, card));
  });
}

function isChatReorderDrag(event) {
  const transfer = event && event.dataTransfer;
  const types = transfer && transfer.types ? Array.prototype.slice.call(transfer.types) : [];
  return Boolean(draggedChatId) || types.includes("application/x-codex-max-chat");
}

function shouldDropAfterCard(event, card) {
  const rect = card.getBoundingClientRect();
  const verticalBias = event.clientY > rect.top + rect.height / 2;
  const horizontalBias = event.clientX > rect.left + rect.width / 2;
  return verticalBias || horizontalBias;
}

function markChatReorderTarget(card, after) {
  for (const item of document.querySelectorAll(".chat.reorderBefore, .chat.reorderAfter")) {
    if (item !== card) {
      item.classList.remove("reorderBefore", "reorderAfter");
    }
  }
  card.classList.toggle("reorderBefore", !after);
  card.classList.toggle("reorderAfter", after);
}

function clearChatReorderMarkers() {
  for (const item of document.querySelectorAll(".chatDragging, .reorderBefore, .reorderAfter")) {
    item.classList.remove("chatDragging", "reorderBefore", "reorderAfter");
  }
}

function reorderChat(sourceId, targetId, afterTarget) {
  if (!sourceId || !targetId || sourceId === targetId) {
    clearChatReorderMarkers();
    return;
  }

  const sourceIndex = state.chats.findIndex((item) => item.id === sourceId);
  const targetIndex = state.chats.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) {
    clearChatReorderMarkers();
    return;
  }

  const nextChats = state.chats.slice();
  const moved = nextChats.splice(sourceIndex, 1)[0];
  let insertIndex = nextChats.findIndex((item) => item.id === targetId);
  if (insertIndex < 0) {
    insertIndex = nextChats.length;
  }
  if (afterTarget) {
    insertIndex += 1;
  }
  nextChats.splice(insertIndex, 0, moved);
  state.chats = nextChats;
  draggedChatId = "";
  clearChatReorderMarkers();
  syncActiveWorkspaceFromState();
  refreshBoardGrid({ preserveBoardScroll: true });
  persist({ skipFullSync: true });
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
      syncActiveWorkspaceChat(chat.id);
      persist({ skipFullSync: true });
    });
  }

  bindChatReorderControls(chat, card);

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
  const speedTierButton = card.querySelector("[data-action='speed-tier']");
  if (speedTierButton) {
    speedTierButton.addEventListener("click", () => {
      const promptInput = card.querySelector(".promptInput");
      updateChat(chat.id, (current) => {
        current.draftPrompt = promptInput ? promptInput.value : current.draftPrompt;
        current.settings = normalizeSettings(current.settings);
        current.settings.speedTier = current.settings.speedTier === "fast" ? "standard" : "fast";
        current.updatedAt = Date.now();
      }, { render: "chrome" });
      persist({ skipFullSync: true });
    });
  }
  const cancelEditButton = card.querySelector("[data-action='cancel-edit']");
  if (cancelEditButton) {
    cancelEditButton.addEventListener("click", () => cancelEditUserMessage(chat.id));
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
      syncActiveWorkspaceChat(chat.id);
      renderChatChrome(chat.id);
      persist({ skipFullSync: true });
    });
    control.addEventListener("input", (event) => {
      chat.settings[event.target.dataset.setting] = event.target.value;
      chat.updatedAt = Date.now();
      syncActiveWorkspaceChat(chat.id);
      persist({ skipFullSync: true });
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
      event.preventDefault();
      event.stopPropagation();
      removeAttachment(chat.id, event.currentTarget.dataset.removeAttachment);
    });
  }

  for (const preview of card.querySelectorAll(".attachmentTray [data-image-path]")) {
    requestImagePreview(preview);
  }

  for (const preview of card.querySelectorAll(".attachmentTray [data-image-open]")) {
    preview.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openImageViewer(event.currentTarget);
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
    syncActiveWorkspaceChat(chat.id);
    persist({ skipFullSync: true });
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
  bindClipboardImagePaste(promptInput, chat.id, chat.status === "running");
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

  for (const button of root.querySelectorAll("[data-diff-nav]")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigateDiffChange(event.currentTarget);
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

  for (const button of root.querySelectorAll("[data-edit-chat]")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      beginEditUserMessage(event.currentTarget.dataset.editChat, event.currentTarget.dataset.editIndex);
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
  if (expanded && item.classList.contains("files")) {
    scrollToFirstDiffChange(item);
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
  if (expanded) {
    scrollToFirstDiffChange(item);
  }
}

function navigateDiffChange(button) {
  const item = button ? button.closest(".message.event, .message.changeSummary") : null;
  if (!item) {
    return;
  }

  if (!item.classList.contains("expanded")) {
    item.classList.add("expanded");
    const summary = item.querySelector(".eventSummary, .changeCard");
    const toggle = item.querySelector(".eventToggle, .changeAction");
    if (summary) {
      summary.setAttribute("aria-expanded", "true");
    }
    if (toggle) {
      toggle.setAttribute("title", "Collapse details");
      toggle.setAttribute("aria-label", "Collapse details");
    }
  }

  const direction = button.dataset.diffNav === "prev" ? -1 : 1;
  scrollToDiffChange(item, direction);
}

function scrollToFirstDiffChange(item) {
  const target = firstDiffChange(item);
  if (target) {
    scrollDiffChangeIntoView(target);
  }
}

function scrollToDiffChange(item, direction) {
  const changes = Array.from(item.querySelectorAll("[data-diff-change]"));
  if (!changes.length) {
    return;
  }

  const current = item.querySelector(".diffLine.currentDiffChange");
  let index = current ? changes.indexOf(current) : -1;
  if (index < 0) {
    index = direction > 0 ? -1 : 0;
  }
  const nextIndex = (index + direction + changes.length) % changes.length;
  scrollDiffChangeIntoView(changes[nextIndex]);
}

function firstDiffChange(item) {
  return item ? item.querySelector("[data-diff-change]") : null;
}

function scrollDiffChangeIntoView(target) {
  if (!target) {
    return;
  }

  const item = target.closest(".message.event, .message.changeSummary");
  if (item) {
    for (const current of item.querySelectorAll(".currentDiffChange")) {
      current.classList.remove("currentDiffChange");
    }
  }
  target.classList.add("currentDiffChange");
  target.scrollIntoView({
    block: "center",
    inline: "nearest"
  });
}
