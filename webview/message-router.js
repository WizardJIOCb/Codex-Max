// Webview message routing from the extension host. Loaded before main.js.
window.addEventListener("message", (event) => {
  const message = event.data;

  if (isBatchedIncomingChatMessage(message)) {
    enqueueIncomingChatMessage(message);
    return;
  }

  if (message.type === "hydrate") {
    try {
      config = Object.assign(config, message.config || {});
      state = normalizeState(message.state);
      state.boardSettings = normalizeBoardSettings(state.boardSettings);
      render();
      persist();
      requestRateLimitsOnce();
      requestCodexStatus();
      requestModelProviderStatus(state.boardSettings.modelProvider);
    } catch (error) {
      showFatal(error);
    }
    return;
  }

  if (message.type === "addChat") {
    addChat();
    return;
  }

  if (message.type === "chatStatus") {
    flushIncomingChatMessages();
    updateChat(message.chatId, (chat) => {
      if (message.status === "running") {
        chat.runStartedAt = chat.runStartedAt && chat.status === "running" ? chat.runStartedAt : Date.now();
        chat.runFinishedAt = 0;
      } else if (chat.status === "running") {
        chat.runFinishedAt = Date.now();
      }
      chat.status = message.status;
      if (message.status !== "running") {
        chat.isThinking = false;
      }
    }, { render: "chrome+messages" });
    return;
  }

  if (message.type === "chatThinking") {
    flushIncomingChatMessages();
    updateChat(message.chatId, (chat) => {
      chat.isThinking = Boolean(message.thinking) && chat.status === "running";
    }, { render: "messages" });
    return;
  }

  if (message.type === "chatSession") {
    flushIncomingChatMessages();
    updateChat(message.chatId, (chat) => {
      chat.sessionId = message.sessionId;
    }, { render: "chrome" });
    return;
  }

  if (message.type === "changeSummary") {
    return;
  }

  if (message.type === "filesAttached") {
    attachFiles(message.chatId, message.attachments);
    return;
  }

  if (message.type === "projectSelected") {
    updateChat(message.chatId, (chat) => {
      chat.projectPath = normalizeProjectPath(message.projectPath || currentWorkspacePath() || "");
      chat.title = chatTitleWithProject(chat.title, chat.projectPath);
    }, { render: "chrome" });
    activeChatInfoId = message.chatId;
    refreshChatInfoDialog(false);
    return;
  }

  if (message.type === "workspaceSelected") {
    const workspacePath = normalizeProjectPath(message.workspacePath || "");
    state.boardSettings = normalizeBoardSettings(Object.assign({}, state.boardSettings, {
      currentWorkspacePath: workspacePath
    }));
    const workspace = activeWorkspaceProfile();
    if (workspace) {
      workspace.path = workspacePath;
      workspace.name = projectFolderName(workspacePath) || workspace.name || "Workspace";
      workspace.boardSettings = cloneBoardSettings(state.boardSettings);
    }
    if (message.chatId) {
      updateChat(message.chatId, (chat) => {
        chat.projectPath = workspacePath;
        chat.title = chatTitleWithProject(chat.title, workspacePath);
      }, { render: "chrome" });
      activeChatInfoId = message.chatId;
      refreshToolbar();
      refreshChatInfoDialog(false);
    } else {
      refreshToolbar();
    }
    persist();
    return;
  }

  if (message.type === "workspaceImport") {
    applyWorkspaceImport(message.state, message.path || "");
    return;
  }

  if (message.type === "workspacePresetImport") {
    applyWorkspacePreset(message.preset, message.path || "");
    return;
  }

  if (message.type === "newWorkspaceSelected") {
    createWorkspaceProfileAndSwitch(normalizeProjectPath(message.workspacePath || ""));
    return;
  }

  if (message.type === "imagePreview") {
    applyImagePreview(message);
    return;
  }

  if (message.type === "chatError") {
    flushIncomingChatMessages();
    updateChat(message.chatId, (chat) => {
      if (chat.status === "running") {
        chat.runFinishedAt = Date.now();
      }
      chat.isThinking = false;
      chat.status = "error";
      chat.note = message.error;
      chat.messages.push({
        role: "error",
        text: message.error,
        title: "Error",
        detail: message.error,
        status: "error",
        kind: "error",
        at: Date.now()
      });
    }, { render: "chrome+messages" });
  }

  if (message.type === "accountRateLimits") {
    accountRateLimitsLoading = false;
    state.accountRateLimits = normalizeRateLimits(message.rateLimits);
    refreshBoardUsage();
    persist();
    return;
  }

  if (message.type === "accountRateLimitsRefreshFinished") {
    accountRateLimitsLoading = false;
    refreshBoardUsage();
    return;
  }

  if (message.type === "codexStatus") {
    codexStatusLoading = false;
    codexStatus = message.status || null;
    refreshBoardSettingsCodex();
    return;
  }

  if (message.type === "modelProviderStatus") {
    modelProviderStatusLoading = false;
    modelProviderStatus = message.status || null;
    refreshBoardSettingsModelProvider(modelProviderStatus && modelProviderStatus.provider);
    return;
  }

  if (message.type === "whisperStatus") {
    whisperStatus = message.status || null;
    whisperDownloadState = message.downloading ? {
      target: message.downloading,
      progress: message.progress || 0,
      message: message.message || "",
      active: true
    } : null;
    refreshBoardSettingsWhisper();
    return;
  }

  if (message.type === "whisperDownloadProgress") {
    whisperDownloadState = {
      target: message.target || "",
      progress: Number(message.progress || 0),
      message: "Downloading...",
      active: true
    };
    refreshBoardSettingsWhisper();
    return;
  }

  if (message.type === "whisperDownloadError") {
    whisperDownloadState = {
      target: message.target || "",
      progress: 0,
      message: message.error || "Download failed.",
      active: false
    };
    refreshBoardSettingsWhisper();
    return;
  }

  if (message.type === "whisperPrewarmStarted") {
    whisperPrewarmState = {
      modelId: message.modelId || "",
      active: true,
      error: ""
    };
    refreshBoardSettingsWhisper();
    return;
  }

  if (message.type === "whisperPrewarmFinished") {
    whisperPrewarmState = {
      modelId: message.modelId || "",
      active: false,
      error: message.error || ""
    };
    refreshBoardSettingsWhisper();
    return;
  }

  if (message.type === "voiceTranscription") {
    applyVoiceTranscription(message.chatId, message.text || "");
    return;
  }

  if (message.type === "voiceTranscriptionStatus") {
    addVoiceActivity(message.chatId, message.text || "Local Whisper is transcribing...");
    return;
  }

  if (message.type === "voiceTranscriptionError") {
    addVoiceActivity(message.chatId, "Local Whisper stopped: " + (message.error || "transcription failed") + ".");
    return;
  }

  if (message.type === "whisperLiveStarted") {
    nativeWhisperLive = true;
    nativeWhisperStopping = false;
    voiceChatId = message.chatId || voiceChatId;
    nativeWhisperStartedAt = Date.now();
    updateVoiceButtons();
    return;
  }

  if (message.type === "whisperLiveStopping") {
    if (voiceChatId === message.chatId) {
      nativeWhisperLive = false;
      nativeWhisperStopping = true;
      updateVoiceButtons();
    }
    return;
  }

  if (message.type === "whisperLiveText") {
    applyWhisperLiveText(message.chatId, message.text || "");
    return;
  }

  if (message.type === "whisperLiveFinalText") {
    applyWhisperLiveFinalText(message.chatId, message.text || "");
    return;
  }

  if (message.type === "whisperLiveStopped") {
    if (message.error && !isSilentWhisperStopError(message.error)) {
      addVoiceActivity(message.chatId, "Local Whisper live stopped: " + message.error);
    }
    nativeWhisperLive = false;
    nativeWhisperStopping = false;
    if (voiceChatId === message.chatId) {
      voiceChatId = "";
    }
    nativeWhisperChunks = [];
    nativeWhisperStartedAt = 0;
    updateVoiceButtons();
    return;
  }

  if (message.type === "whisperLiveError") {
    addVoiceActivity(message.chatId, "Local Whisper live failed: " + (message.error || "unknown error"));
    nativeWhisperLive = false;
    nativeWhisperStopping = false;
    if (voiceChatId === message.chatId) {
      voiceChatId = "";
    }
    nativeWhisperChunks = [];
    nativeWhisperStartedAt = 0;
    updateVoiceButtons();
    return;
  }

  if (message.type === "officialOpened") {
    flushIncomingChatMessages();
    updateChat(message.chatId, (chat) => {
      chat.status = "opened";
      chat.lastOpenedAt = Date.now();
    }, { render: "chrome" });
  }
});

function isBatchedIncomingChatMessage(message) {
  return message && (
    message.type === "chatActivity" ||
    message.type === "assistantMessage" ||
    message.type === "chatEvent"
  );
}

function enqueueIncomingChatMessage(message) {
  pendingIncomingChatMessages.push(message);
  if (pendingIncomingChatFrame) {
    return;
  }

  pendingIncomingChatFrame = requestAnimationFrame(flushIncomingChatMessages);
}

function flushIncomingChatMessages() {
  if (pendingIncomingChatFrame) {
    cancelAnimationFrame(pendingIncomingChatFrame);
    pendingIncomingChatFrame = 0;
  }

  if (!pendingIncomingChatMessages.length) {
    return;
  }

  const messages = pendingIncomingChatMessages;
  pendingIncomingChatMessages = [];
  countRenderStat("incomingBatches");
  countRenderStat("incomingMessages", messages.length);
  withBatchedChatUpdates(() => {
    for (const message of messages) {
      applyIncomingChatMessage(message);
    }
  });
}

function applyIncomingChatMessage(message) {
  if (message.type === "chatActivity") {
    addMessage(message.chatId, "activity", message.text);
    return;
  }

  if (message.type === "assistantMessage") {
    addAssistantMessage(message.chatId, message.text);
    return;
  }

  if (message.type === "chatEvent") {
    addEventMessage(message.chatId, message.event);
  }
}
