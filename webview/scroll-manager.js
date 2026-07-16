// Chat and board scroll state manager. Loaded before main.js.
function captureSingleMessageScrollState(card) {
  const chatId = card && card.dataset ? card.dataset.chatId : "";
  const messages = card ? card.querySelector(".messages") : null;
  if (!chatId || !messages) {
    return null;
  }

  return {
    scrollTop: messages.scrollTop,
    scrollHeight: messages.scrollHeight,
    clientHeight: messages.clientHeight,
    atBottom: isScrolledToBottom(messages),
    signature: messages.dataset.scrollSignature || ""
  };
}

function captureBoardScrollState() {
  const board = document.querySelector(".board");
  if (!board) {
    return null;
  }

  return {
    scrollTop: board.scrollTop,
    scrollLeft: board.scrollLeft
  };
}

function restoreBoardScroll(previous) {
  if (!previous) {
    return;
  }

  const board = document.querySelector(".board");
  if (!board) {
    return;
  }

  const apply = () => {
    const maxTop = Math.max(0, board.scrollHeight - board.clientHeight);
    const maxLeft = Math.max(0, board.scrollWidth - board.clientWidth);
    board.scrollTop = Math.min(previous.scrollTop, maxTop);
    board.scrollLeft = Math.min(previous.scrollLeft, maxLeft);
  };

  apply();
  requestAnimationFrame(apply);
}

function captureMessageScrollState() {
  const snapshot = new Map(chatScrollState);
  for (const card of document.querySelectorAll("[data-chat-id]")) {
    const chatId = card.dataset.chatId;
    const messages = card.querySelector(".messages");
    if (!chatId || !messages) {
      continue;
    }

    snapshot.set(chatId, {
      scrollTop: messages.scrollTop,
      scrollHeight: messages.scrollHeight,
      clientHeight: messages.clientHeight,
      atBottom: isScrolledToBottom(messages),
      signature: messages.dataset.scrollSignature || ""
    });
  }

  return snapshot;
}

function restoreMessageScroll(chatId, messages, previous, autoScroll, signature) {
  if (!messages) {
    return;
  }

  if (autoScroll && previous && previous.atBottom && !chatAutoScrollPaused.has(chatId)) {
    startChatBottomLock(chatId, messages);
  }

  applyMessageScroll(chatId, messages, previous, autoScroll, signature);
  requestAnimationFrame(() => {
    if (chatBottomLocks.has(chatId) && !chatAutoScrollPaused.has(chatId)) {
      applyChatBottomLock(chatId);
    } else if (chatStickyScroll.has(chatId) && !chatAutoScrollPaused.has(chatId)) {
      setMessagesToBottom(chatId, messages, signature);
    } else if (chatAutoScrollPaused.has(chatId)) {
      restorePausedScrollTop(chatId, messages);
      rememberMessageScroll(chatId, messages, signature);
    }
  });
}

function bindMessageScrollControls(chatId, messages) {
  messages.addEventListener("wheel", (event) => {
    chatUserScrollIntent.add(chatId);
    if (event.deltaY < 0 || !isScrolledToBottom(messages)) {
      pauseChatAutoScroll(chatId, messages);
    }
  }, { passive: true });

  messages.addEventListener("touchmove", () => {
    chatUserScrollIntent.add(chatId);
    if (!isScrolledToBottom(messages)) {
      pauseChatAutoScroll(chatId, messages);
    }
  }, { passive: true });

  messages.addEventListener("pointerdown", () => {
    chatUserScrollIntent.add(chatId);
    if (!isScrolledToBottom(messages)) {
      pauseChatAutoScroll(chatId, messages);
    }
  }, { passive: true });

  messages.addEventListener("scroll", () => {
    const userInitiated = chatUserScrollIntent.has(chatId);
    rememberMessageScroll(chatId, messages, undefined, userInitiated);
    if (userInitiated) {
      requestAnimationFrame(() => chatUserScrollIntent.delete(chatId));
    }
  }, { passive: true });
}

function pauseChatAutoScroll(chatId, messages) {
  chatAutoScrollPaused.add(chatId);
  chatStickyScroll.delete(chatId);
  stopChatBottomLock(chatId);
  if (messages) {
    chatPausedScrollTop.set(chatId, messages.scrollTop);
  }
}

function resumeChatAutoScroll(chatId) {
  chatAutoScrollPaused.delete(chatId);
  chatPausedScrollTop.delete(chatId);
}

function stickChatToBottom(chatId, messages) {
  resumeChatAutoScroll(chatId);
  startChatBottomLock(chatId, messages);
  if (messages) {
    setMessagesToBottom(chatId, messages, undefined);
  }
}

function restorePausedScrollTop(chatId, messages) {
  if (!messages || !chatPausedScrollTop.has(chatId)) {
    return;
  }

  const maxTop = Math.max(0, messages.scrollHeight - messages.clientHeight);
  messages.scrollTop = Math.min(chatPausedScrollTop.get(chatId), maxTop);
}

function applyMessageScroll(chatId, messages, previous, autoScroll, signature) {
  if (!messages) {
    return;
  }

  const currentSignature = signature || messages.dataset.scrollSignature || "";
  const contentChanged = !previous || previous.signature !== currentSignature;
  const paused = chatAutoScrollPaused.has(chatId);
  const alreadySticky = chatStickyScroll.has(chatId);
  const shouldStickToBottom = !paused && (alreadySticky || !previous || (autoScroll && previous.atBottom && contentChanged));
  messages.dataset.scrollSignature = currentSignature;
  if (shouldStickToBottom) {
    startChatBottomLock(chatId, messages);
    setMessagesToBottom(chatId, messages, currentSignature);
  } else if (paused) {
    chatStickyScroll.delete(chatId);
    restorePausedScrollTop(chatId, messages);
  } else {
    chatStickyScroll.delete(chatId);
    const maxTop = Math.max(0, messages.scrollHeight - messages.clientHeight);
    messages.scrollTop = Math.min(previous.scrollTop, maxTop);
  }

  rememberMessageScroll(chatId, messages, currentSignature);
}

function lockChatToBottomIfPinned(chatId) {
  const board = normalizeBoardSettings(state.boardSettings);
  if (!board.autoScroll || !chatId || chatAutoScrollPaused.has(chatId)) {
    return false;
  }

  const messages = chatMessagesElement(chatId);
  if (!messages) {
    return false;
  }

  if (!isScrolledToBottom(messages) && !chatStickyScroll.has(chatId)) {
    return false;
  }

  startChatBottomLock(chatId, messages);
  return true;
}

function lockChatsToBottomIfPinned(chatIds) {
  const locked = new Set();
  for (const chatId of chatIds || []) {
    if (lockChatToBottomIfPinned(chatId)) {
      locked.add(chatId);
    }
  }
  return locked;
}

function reinforceChatBottomLocks(chatIds) {
  for (const chatId of chatIds || []) {
    if (chatBottomLocks.has(chatId)) {
      scheduleChatBottomLock(chatId);
    }
  }
}

function startChatBottomLock(chatId, messages, durationMs) {
  if (!chatId || chatAutoScrollPaused.has(chatId)) {
    return;
  }

  const until = Date.now() + (Number(durationMs) || 1600);
  chatBottomLocks.set(chatId, Math.max(chatBottomLocks.get(chatId) || 0, until));
  chatStickyScroll.add(chatId);
  observeChatBottomLock(chatId, messages || chatMessagesElement(chatId));
  clearChatBottomLockTimers(chatId);
  scheduleChatBottomLock(chatId);
}

function scheduleChatBottomLock(chatId) {
  if (!chatId || chatBottomLockFrames.has(chatId)) {
    return;
  }

  const frame = requestAnimationFrame(() => {
    chatBottomLockFrames.delete(chatId);
    applyChatBottomLock(chatId);
  });
  chatBottomLockFrames.set(chatId, frame);

  if (!chatBottomLockTimeouts.has(chatId)) {
    const delays = [32, 96, 180, 360, 720, 1280];
    chatBottomLockTimeouts.set(chatId, delays.map((delay) => {
      return setTimeout(() => applyChatBottomLock(chatId), delay);
    }));
  }
}

function applyChatBottomLock(chatId) {
  const until = chatBottomLocks.get(chatId) || 0;
  if (!until || chatAutoScrollPaused.has(chatId)) {
    stopChatBottomLock(chatId);
    return;
  }

  if (Date.now() > until) {
    stopChatBottomLock(chatId);
    return;
  }

  const messages = chatMessagesElement(chatId);
  if (!messages) {
    return;
  }

  observeChatBottomLock(chatId, messages);
  setMessagesToBottom(chatId, messages, messages.dataset.scrollSignature || "");
}

function observeChatBottomLock(chatId, messages) {
  if (!chatId || !messages) {
    return;
  }

  const existing = chatBottomLockObservers.get(chatId);
  if (existing && existing.messages === messages) {
    return;
  }
  disconnectChatBottomLockObserver(chatId);

  const mutationObserver = typeof MutationObserver === "function"
    ? new MutationObserver(() => scheduleChatBottomLock(chatId))
    : null;
  if (mutationObserver) {
    mutationObserver.observe(messages, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  const resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => scheduleChatBottomLock(chatId))
    : null;
  if (resizeObserver) {
    resizeObserver.observe(messages);
  }

  chatBottomLockObservers.set(chatId, {
    messages,
    mutationObserver,
    resizeObserver
  });
}

function stopChatBottomLock(chatId) {
  if (!chatId) {
    return;
  }

  chatBottomLocks.delete(chatId);
  chatStickyScroll.delete(chatId);
  disconnectChatBottomLockObserver(chatId);

  const frame = chatBottomLockFrames.get(chatId);
  if (frame) {
    cancelAnimationFrame(frame);
    chatBottomLockFrames.delete(chatId);
  }

  clearChatBottomLockTimers(chatId);
}

function clearChatBottomLockTimers(chatId) {
  const timeouts = chatBottomLockTimeouts.get(chatId);
  if (Array.isArray(timeouts)) {
    for (const timer of timeouts) {
      clearTimeout(timer);
    }
  }
  chatBottomLockTimeouts.delete(chatId);
}

function disconnectChatBottomLockObserver(chatId) {
  const observer = chatBottomLockObservers.get(chatId);
  if (!observer) {
    return;
  }

  if (observer.mutationObserver) {
    observer.mutationObserver.disconnect();
  }
  if (observer.resizeObserver) {
    observer.resizeObserver.disconnect();
  }
  chatBottomLockObservers.delete(chatId);
}

function chatMessagesElement(chatId) {
  const card = document.querySelector('[data-chat-id="' + chatId + '"]');
  return card ? card.querySelector(".messages") : null;
}

function setMessagesToBottom(chatId, messages, signature) {
  if (!messages) {
    return;
  }

  messages.scrollTop = messages.scrollHeight;
  rememberMessageScroll(chatId, messages, signature, false);
}

function rememberMessageScroll(chatId, messages, signature, userInitiated) {
  if (!chatId || !messages) {
    return;
  }

  const currentSignature = signature || messages.dataset.scrollSignature || "";
  const atBottom = isScrolledToBottom(messages);
  if (userInitiated) {
    if (atBottom) {
      resumeChatAutoScroll(chatId);
    } else {
      pauseChatAutoScroll(chatId, messages);
    }
  }

  chatScrollState.set(chatId, {
    scrollTop: messages.scrollTop,
    scrollHeight: messages.scrollHeight,
    clientHeight: messages.clientHeight,
    atBottom,
    signature: currentSignature
  });
}

function isScrolledToBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 24;
}
