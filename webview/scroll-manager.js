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

  applyMessageScroll(chatId, messages, previous, autoScroll, signature);
  requestAnimationFrame(() => {
    if (chatStickyScroll.has(chatId) && !chatAutoScrollPaused.has(chatId)) {
      messages.scrollTop = messages.scrollHeight;
      rememberMessageScroll(chatId, messages, signature);
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
  chatStickyScroll.add(chatId);
  if (messages) {
    messages.scrollTop = messages.scrollHeight;
    rememberMessageScroll(chatId, messages, undefined, false);
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
    chatStickyScroll.add(chatId);
    messages.scrollTop = messages.scrollHeight;
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
