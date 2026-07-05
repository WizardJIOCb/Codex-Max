// Keyboard shortcuts and focused chat input helpers. Loaded before main.js.
window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) {
    return;
  }

  if (event.key === "Escape") {
    closeSelectMenu();
    closeWorkspaceMenu();
    closeBoardSettings();
    closeChatInfo();
    closeImageViewer();
    return;
  }

  if (shouldToggleVoiceFromKey(event)) {
    const chatId = focusedPromptChatId();
    if (chatId) {
      event.preventDefault();
      toggleVoiceInput(chatId);
    }
  }
});

function focusedPromptChatId() {
  const active = document.activeElement;
  if (!active || !active.classList || !active.classList.contains("promptInput")) {
    return "";
  }

  const card = typeof active.closest === "function" ? active.closest("[data-chat-id]") : null;
  if (card && card.dataset.chatId) {
    return card.dataset.chatId;
  }

  return "";
}
