// Board settings dialog. Loaded before main.js.
function renderBoardSettingsDialog(columns, rows, maxChatHeight, sendWithCtrlEnter, chatBackground, autoScroll, voiceShortcut, speechToText, localWhisperModel, localWhisperCaptureId, localWhisperStopGraceMs) {
  const isHeightAuto = !maxChatHeight;
  const heightValue = maxChatHeight || 720;
  return `
    <div class="modalBackdrop" id="boardSettingsModal" hidden>
      <section class="modal boardSettingsModal" role="dialog" aria-modal="true" aria-labelledby="boardSettingsTitle">
        <header class="modalHeader">
          <h2 id="boardSettingsTitle">Board settings${EXTENSION_VERSION ? ' <span class="settingsVersion">v' + escapeHtml(EXTENSION_VERSION) + '</span>' : ""}</h2>
          <button class="iconButton secondary" id="closeBoardSettings" title="Close">x</button>
        </header>
        <div class="modalBody">
          <div class="fieldRow">
            <label for="chatsPerRow">Chats per row</label>
            <input id="chatsPerRow" type="number" min="1" max="12" value="${columns}" />
          </div>
          <div class="stepper" aria-label="Chats per row presets">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((value) => '<button class="' + (value === columns ? "active" : "") + '" data-columns="' + value + '">' + value + '</button>').join("")}
          </div>
          <div class="fieldRow">
            <label for="chatsPerColumn">Chats per column</label>
            <input id="chatsPerColumn" type="number" min="1" max="6" value="${rows}" />
          </div>
          <div class="stepper" aria-label="Chats per column presets">
            ${[1, 2, 3, 4, 5, 6].map((value) => '<button class="' + (value === rows ? "active" : "") + '" data-rows="' + value + '">' + value + '</button>').join("")}
          </div>
          <div class="fieldRow heightRow">
            <label for="maxChatHeightMode">Max chat height</label>
            <div class="heightControls">
              <select id="maxChatHeightMode">
                <option value="auto"${isHeightAuto ? " selected" : ""}>Auto</option>
                <option value="pixels"${isHeightAuto ? "" : " selected"}>Pixels</option>
              </select>
              <input id="maxChatHeight" type="number" min="280" max="2400" step="20" value="${heightValue}" ${isHeightAuto ? "disabled" : ""} />
            </div>
          </div>
          <div class="fieldRow checkboxRow">
            <label for="sendWithCtrlEnter">Send with Ctrl+Enter</label>
            <input id="sendWithCtrlEnter" class="settingCheckbox" type="checkbox" ${sendWithCtrlEnter ? "checked" : ""} />
          </div>
          <div class="fieldRow checkboxRow">
            <label for="autoScrollMessages">Auto-scroll new messages</label>
            <input id="autoScrollMessages" class="settingCheckbox" type="checkbox" ${autoScroll ? "checked" : ""} />
          </div>
          <div id="codexStatusCard" class="codexStatusCard">
            ${renderCodexStatus()}
          </div>
          <div class="fieldRow">
            <label for="voiceShortcut">Voice shortcut</label>
            <select id="voiceShortcut">
              <option value="off"${voiceShortcut === "off" ? " selected" : ""}>Off</option>
              <option value="alt-v"${voiceShortcut === "alt-v" ? " selected" : ""}>Alt+V</option>
              <option value="ctrl-shift-v"${voiceShortcut === "ctrl-shift-v" ? " selected" : ""}>Ctrl+Shift+V</option>
              <option value="ctrl-m"${voiceShortcut === "ctrl-m" ? " selected" : ""}>Ctrl+M</option>
            </select>
          </div>
          <div class="fieldRow">
            <label for="speechToText">Speech-to-text engine</label>
            <select id="speechToText">
              <option value="browser"${speechToText === "browser" ? " selected" : ""}>Browser Web Speech</option>
              <option value="local-whisper"${speechToText === "local-whisper" ? " selected" : ""}>Local Whisper</option>
              <option value="off"${speechToText === "off" ? " selected" : ""}>Off</option>
            </select>
          </div>
          <div class="localWhisperSettings">
            <div class="fieldRow">
              <label for="localWhisperModel">Local Whisper model</label>
              <select id="localWhisperModel">
                ${LOCAL_WHISPER_MODELS.map((model) => '<option value="' + escapeAttr(model.id) + '"' + (model.id === localWhisperModel ? " selected" : "") + '>' + escapeHtml(model.label + " - " + model.size) + '</option>').join("")}
              </select>
            </div>
            <div class="fieldRow">
              <label for="localWhisperCaptureId">Microphone</label>
              <select id="localWhisperCaptureId" title="Microphone device used by Local Whisper live input">
                ${renderCaptureDeviceOptions(localWhisperCaptureId)}
              </select>
            </div>
            <div class="fieldRow">
              <label for="localWhisperStopGraceMs">Mic stop delay (ms)</label>
              <input id="localWhisperStopGraceMs" type="number" min="100" max="10000" step="100" value="${escapeAttr(localWhisperStopGraceMs)}" title="How long Local Whisper waits for final output after you stop listening" />
            </div>
            <div id="localWhisperStatus" class="whisperStatus">
              ${renderWhisperStatus(localWhisperModel)}
            </div>
            <div class="fieldRow actionRow">
              <label>Local runtime</label>
              <button id="downloadWhisperRuntime" type="button">Download whisper.cpp</button>
            </div>
            <div class="fieldRow actionRow">
              <label>Selected model</label>
              <button id="downloadWhisperModel" type="button">Download model</button>
            </div>
            <div class="fieldRow actionRow">
              <label>Microphone</label>
              <button id="requestMicrophoneAccess" type="button">Request access</button>
            </div>
            <div class="fieldRow actionRow">
              <label>System privacy</label>
              <button id="openMicrophoneSettings" type="button">Windows settings</button>
            </div>
          </div>
          <div class="fieldRow colorRow">
            <label for="chatBackground">Chat background</label>
            <div class="colorControls">
              <input id="chatBackgroundPicker" type="color" value="${escapeAttr(chatBackground)}" title="Chat background color" />
              <input id="chatBackground" type="text" value="${escapeAttr(chatBackground)}" placeholder="${DEFAULT_CHAT_BACKGROUND}" />
              <button id="resetChatBackground" type="button">Default</button>
            </div>
          </div>
          <div class="fieldRow actionRow">
            <label for="refreshRateLimits">Account limits</label>
            <button id="refreshRateLimits" type="button">Refresh limits</button>
          </div>
          <div class="fieldRow actionRow">
            <label>Workspace preset</label>
            <div class="dualActions">
              <button id="exportWorkspacePreset" type="button">Export</button>
              <button id="importWorkspacePreset" type="button">Import</button>
            </div>
          </div>
          <div id="renderStatsCard" class="renderStatsCard">
            ${renderRenderStats()}
          </div>
          <p class="modalHint">Rows control density. Enter sends by default; auto-scroll follows new replies only while you are already at the bottom.</p>
          <p class="modalHint">Browser voice input uses the browser Web Speech API. Local Whisper uses free multilingual ggml models and does not use the selected Codex model.</p>
        </div>
        <footer class="modalFooter">
          <button id="cancelBoardSettings" type="button">Cancel</button>
          <button id="applyBoardSettings" class="primary" type="button">Apply</button>
        </footer>
      </section>
    </div>
  `;
}

function renderCodexStatus() {
  const status = codexStatus || {};
  const overall = codexStatusLoading ? "checking" : (status.overall || "checking");
  const title = overall === "connected"
    ? "Codex connected"
    : overall === "needs-login"
      ? "Codex needs login"
      : overall === "missing"
        ? "Codex CLI not ready"
        : "Checking Codex...";
  const executable = status.executable ? status.executable : "codex";
  const version = status.version ? status.version : "";
  const login = status.loginStatus ? status.loginStatus : "";
  const issue = Array.isArray(status.issues) && status.issues.length ? status.issues[0] : "";
  const installButton = overall === "missing"
    ? '<button type="button" data-codex-action="install">Install CLI</button>'
    : "";
  const loginButton = overall === "needs-login"
    ? '<button type="button" data-codex-action="login">Login</button>'
    : "";
  const doctorButton = overall !== "checking"
    ? '<button type="button" data-codex-action="doctor">Doctor</button>'
    : "";
  const refreshText = codexStatusLoading ? "Checking..." : "Refresh";
  return `
    <div class="codexStatusHeader">
      <div class="codexStatusTitle">
        <span class="codexStatusDot" aria-hidden="true"></span>
        <span>${escapeHtml(title)}</span>
      </div>
      <button id="refreshCodexStatus" type="button" ${codexStatusLoading ? "disabled" : ""}>${escapeHtml(refreshText)}</button>
    </div>
    <div class="codexStatusText">
      <div><strong>Executable:</strong> ${escapeHtml(executable)}</div>
      ${version ? '<div><strong>Version:</strong> ' + escapeHtml(version) + '</div>' : ""}
      ${login ? '<div><strong>Auth:</strong> ' + escapeHtml(login) + '</div>' : ""}
      ${issue ? '<div>' + escapeHtml(issue) + '</div>' : ""}
    </div>
    <div class="codexStatusActions">
      ${installButton}
      ${loginButton}
      ${doctorButton}
      <button type="button" data-codex-action="version">Version</button>
    </div>
  `;
}

function renderRenderStats() {
  const stats = renderStats || createRenderStats();
  const elapsed = Math.max(0, Date.now() - Number(stats.startedAt || Date.now()));
  return `
    <div class="renderStatsHeader">
      <div>
        <strong>Render stats</strong>
        <span>${escapeHtml(formatDuration(elapsed))}</span>
      </div>
      <button id="resetRenderStats" type="button">Reset</button>
    </div>
    <div class="renderStatsGrid">
      ${renderRenderStat("Board", stats.board)}
      ${renderRenderStat("Grid", stats.boardGrid)}
      ${renderRenderStat("Cards", stats.chatCard)}
      ${renderRenderStat("Chrome", stats.chatChrome)}
      ${renderRenderStat("Messages", stats.chatMessages)}
      ${renderRenderStat("Reused", stats.messageNodesReused)}
      ${renderRenderStat("Created", stats.messageNodesCreated)}
      ${renderRenderStat("Usage", stats.usage)}
      ${renderRenderStat("Batches", stats.incomingBatches)}
      ${renderRenderStat("Events", stats.incomingMessages)}
      ${renderRenderStat("Persists", stats.persistFlushes)}
    </div>
  `;
}

function renderRenderStat(label, value) {
  return '<div><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(Number(value || 0))) + '</strong></div>';
}

function refreshRenderStatsPanel() {
  const card = document.getElementById("renderStatsCard");
  if (card) {
    card.innerHTML = renderRenderStats();
  }
}

function bindBoardSettingsDialog() {
  const modal = document.getElementById("boardSettingsModal");
  const closeButton = document.getElementById("closeBoardSettings");
  const cancelButton = document.getElementById("cancelBoardSettings");
  const applyButton = document.getElementById("applyBoardSettings");
  const input = document.getElementById("chatsPerRow");
  const rowInput = document.getElementById("chatsPerColumn");
  const heightMode = document.getElementById("maxChatHeightMode");
  const heightInput = document.getElementById("maxChatHeight");
  const sendWithCtrlEnter = document.getElementById("sendWithCtrlEnter");
  const autoScrollMessages = document.getElementById("autoScrollMessages");
  const voiceShortcut = document.getElementById("voiceShortcut");
  const speechToText = document.getElementById("speechToText");
  const localWhisperModel = document.getElementById("localWhisperModel");
  const localWhisperCaptureId = document.getElementById("localWhisperCaptureId");
  const localWhisperStopGraceMs = document.getElementById("localWhisperStopGraceMs");
  const downloadWhisperRuntime = document.getElementById("downloadWhisperRuntime");
  const downloadWhisperModel = document.getElementById("downloadWhisperModel");
  const requestMicrophoneAccess = document.getElementById("requestMicrophoneAccess");
  const openMicrophoneSettings = document.getElementById("openMicrophoneSettings");
  const chatBackground = document.getElementById("chatBackground");
  const chatBackgroundPicker = document.getElementById("chatBackgroundPicker");
  const resetChatBackground = document.getElementById("resetChatBackground");
  const refreshRateLimits = document.getElementById("refreshRateLimits");
  const exportWorkspacePreset = document.getElementById("exportWorkspacePreset");
  const importWorkspacePreset = document.getElementById("importWorkspacePreset");
  const codexStatusCard = document.getElementById("codexStatusCard");
  const renderStatsCard = document.getElementById("renderStatsCard");

  if (!modal || !closeButton || !cancelButton || !applyButton || !input || !rowInput || !heightMode || !heightInput || !sendWithCtrlEnter || !autoScrollMessages || !voiceShortcut || !speechToText || !localWhisperModel || !localWhisperCaptureId || !localWhisperStopGraceMs || !downloadWhisperRuntime || !downloadWhisperModel || !requestMicrophoneAccess || !openMicrophoneSettings || !chatBackground || !chatBackgroundPicker || !resetChatBackground || !refreshRateLimits || !exportWorkspacePreset || !importWorkspacePreset || !codexStatusCard || !renderStatsCard) {
    return;
  }

  const draft = normalizeBoardSettings(state.boardSettings);
  const updateModalControls = () => {
    input.value = draft.chatsPerRow;
    rowInput.value = draft.chatsPerColumn;
    heightMode.value = draft.maxChatHeight ? "pixels" : "auto";
    heightInput.disabled = !draft.maxChatHeight;
    heightInput.value = draft.maxChatHeight || heightInput.value || 720;
    sendWithCtrlEnter.checked = draft.sendWithCtrlEnter;
    autoScrollMessages.checked = draft.autoScroll;
    voiceShortcut.value = draft.voiceShortcut;
    speechToText.value = draft.speechToText;
    localWhisperModel.value = draft.localWhisperModel;
    localWhisperCaptureId.value = draft.localWhisperCaptureId;
    localWhisperStopGraceMs.value = draft.localWhisperStopGraceMs;
    refreshBoardSettingsWhisper();
    chatBackground.value = draft.chatBackground;
    chatBackgroundPicker.value = draft.chatBackground;

    for (const button of modal.querySelectorAll("[data-columns]")) {
      button.classList.toggle("active", Number(button.dataset.columns) === draft.chatsPerRow);
    }
    for (const button of modal.querySelectorAll("[data-rows]")) {
      button.classList.toggle("active", Number(button.dataset.rows) === draft.chatsPerColumn);
    }
  };

  closeButton.addEventListener("click", closeBoardSettings);
  cancelButton.addEventListener("click", closeBoardSettings);
  applyButton.addEventListener("click", applyBoardSettingsDraft);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeBoardSettings();
    }
  });

  input.addEventListener("change", (event) => {
    draft.chatsPerRow = clampInt(event.target.value, 1, 12);
    updateModalControls();
  });

  rowInput.addEventListener("change", (event) => {
    draft.chatsPerColumn = clampInt(event.target.value, 1, 6);
    updateModalControls();
  });

  heightMode.addEventListener("change", (event) => {
    if (event.target.value === "auto") {
      draft.maxChatHeight = 0;
      updateModalControls();
      return;
    }

    draft.maxChatHeight = normalizeMaxChatHeight(heightInput.value || 720);
    updateModalControls();
  });

  heightInput.addEventListener("change", (event) => {
    draft.maxChatHeight = normalizeMaxChatHeight(event.target.value);
    if (!draft.maxChatHeight) {
      draft.maxChatHeight = 280;
    }
    updateModalControls();
  });

  sendWithCtrlEnter.addEventListener("change", (event) => {
    draft.sendWithCtrlEnter = event.target.checked;
    updateModalControls();
  });

  autoScrollMessages.addEventListener("change", (event) => {
    draft.autoScroll = event.target.checked;
    updateModalControls();
  });

  voiceShortcut.addEventListener("change", (event) => {
    draft.voiceShortcut = normalizeVoiceShortcut(event.target.value);
    updateModalControls();
  });

  speechToText.addEventListener("change", (event) => {
    draft.speechToText = normalizeSpeechToTextEngine(event.target.value);
    updateModalControls();
  });

  localWhisperModel.addEventListener("change", (event) => {
    draft.localWhisperModel = normalizeLocalWhisperModel(event.target.value);
    updateModalControls();
  });

  localWhisperCaptureId.addEventListener("change", (event) => {
    draft.localWhisperCaptureId = normalizeLocalWhisperCaptureId(event.target.value);
    updateModalControls();
  });

  localWhisperStopGraceMs.addEventListener("change", (event) => {
    draft.localWhisperStopGraceMs = normalizeWhisperStopGraceMs(event.target.value);
    updateModalControls();
  });

  downloadWhisperRuntime.addEventListener("click", () => {
    downloadWhisperRuntime.disabled = true;
    vscode.postMessage({ type: "downloadWhisperRuntime" });
  });

  downloadWhisperModel.addEventListener("click", () => {
    downloadWhisperModel.disabled = true;
    vscode.postMessage({ type: "downloadWhisperModel", modelId: draft.localWhisperModel });
  });

  requestMicrophoneAccess.addEventListener("click", () => {
    requestMicrophoneAccess.disabled = true;
    requestMicrophoneAccess.textContent = "Requesting...";
    requestMicrophonePermission().finally(() => {
      requestMicrophoneAccess.disabled = false;
      requestMicrophoneAccess.textContent = "Request access";
      refreshBoardSettingsWhisper();
    });
  });

  openMicrophoneSettings.addEventListener("click", () => {
    vscode.postMessage({ type: "openMicrophoneSettings" });
  });

  chatBackground.addEventListener("change", (event) => {
    draft.chatBackground = normalizeHexColor(event.target.value, draft.chatBackground);
    updateModalControls();
  });

  chatBackgroundPicker.addEventListener("input", (event) => {
    draft.chatBackground = normalizeHexColor(event.target.value, draft.chatBackground);
    updateModalControls();
  });

  resetChatBackground.addEventListener("click", () => {
    draft.chatBackground = DEFAULT_CHAT_BACKGROUND;
    updateModalControls();
  });

  refreshRateLimits.addEventListener("click", () => {
    refreshRateLimits.disabled = true;
    refreshRateLimits.textContent = "Refreshing...";
    vscode.postMessage({ type: "refreshRateLimits" });
    setTimeout(() => {
      refreshRateLimits.disabled = false;
      refreshRateLimits.textContent = "Refresh limits";
    }, 5000);
  });

  exportWorkspacePreset.addEventListener("click", () => {
    const preset = currentWorkspacePreset();
    preset.boardSettings = normalizeBoardSettings(draft);
    vscode.postMessage({ type: "exportWorkspacePreset", preset });
  });

  importWorkspacePreset.addEventListener("click", () => {
    vscode.postMessage({ type: "importWorkspacePreset" });
  });

  renderStatsCard.addEventListener("click", (event) => {
    const resetButton = event.target.closest("#resetRenderStats");
    if (resetButton) {
      resetRenderStats();
    }
  });

  codexStatusCard.addEventListener("click", (event) => {
    const refreshButton = event.target.closest("#refreshCodexStatus");
    if (refreshButton) {
      requestCodexStatus();
      return;
    }

    const actionButton = event.target.closest("[data-codex-action]");
    if (actionButton) {
      vscode.postMessage({
        type: "openCodexActionTerminal",
        action: actionButton.dataset.codexAction || ""
      });
    }
  });

  for (const button of modal.querySelectorAll("[data-columns]")) {
    button.addEventListener("click", (event) => {
      draft.chatsPerRow = clampInt(event.currentTarget.dataset.columns, 1, 12);
      updateModalControls();
    });
  }

  for (const button of modal.querySelectorAll("[data-rows]")) {
    button.addEventListener("click", (event) => {
      draft.chatsPerColumn = clampInt(event.currentTarget.dataset.rows, 1, 6);
      updateModalControls();
    });
  }

  function applyBoardSettingsDraft() {
    draft.chatsPerRow = clampInt(input.value, 1, 12);
    draft.chatsPerColumn = clampInt(rowInput.value, 1, 6);
    draft.maxChatHeight = heightMode.value === "auto" ? 0 : normalizeMaxChatHeight(heightInput.value || 720);
    draft.chatBackground = normalizeHexColor(chatBackground.value, DEFAULT_CHAT_BACKGROUND);
    draft.sendWithCtrlEnter = sendWithCtrlEnter.checked;
    draft.autoScroll = autoScrollMessages.checked;
    draft.voiceShortcut = normalizeVoiceShortcut(voiceShortcut.value);
    draft.speechToText = normalizeSpeechToTextEngine(speechToText.value);
    draft.localWhisperModel = normalizeLocalWhisperModel(localWhisperModel.value);
    draft.localWhisperCaptureId = normalizeLocalWhisperCaptureId(localWhisperCaptureId.value);
    draft.localWhisperStopGraceMs = normalizeWhisperStopGraceMs(localWhisperStopGraceMs.value);
    state.boardSettings = normalizeBoardSettings(draft);
    if (state.boardSettings.speechToText === "off") {
      stopVoiceInput();
    } else if (state.boardSettings.speechToText === "local-whisper") {
      vscode.postMessage({
        type: "prewarmWhisperModel",
        modelId: state.boardSettings.localWhisperModel,
        captureId: state.boardSettings.localWhisperCaptureId
      });
    }
    closeBoardSettings();
    refreshBoardAfterSettingsChange();
    persist();
  }

  updateModalControls();
}

function requestCodexStatus() {
  codexStatusLoading = true;
  refreshBoardSettingsCodex();
  vscode.postMessage({ type: "requestCodexStatus" });
}

function refreshBoardSettingsCodex() {
  const card = document.getElementById("codexStatusCard");
  if (!card) {
    return;
  }

  const status = codexStatus || {};
  const overall = codexStatusLoading ? "checking" : (status.overall || "checking");
  card.classList.toggle("connected", overall === "connected");
  card.classList.toggle("warning", overall === "needs-login" || overall === "checking");
  card.classList.toggle("missing", overall === "missing");
  card.classList.toggle("checking", overall === "checking");
  card.innerHTML = renderCodexStatus();
}

function refreshBoardSettingsWhisper() {
  const statusNode = document.getElementById("localWhisperStatus");
  const modelSelect = document.getElementById("localWhisperModel");
  const captureSelect = document.getElementById("localWhisperCaptureId");
  const runtimeButton = document.getElementById("downloadWhisperRuntime");
  const modelButton = document.getElementById("downloadWhisperModel");
  if (!statusNode || !modelSelect || !runtimeButton || !modelButton) {
    return;
  }

  const modelId = normalizeLocalWhisperModel(modelSelect.value || state.boardSettings.localWhisperModel);
  const runtimeInstalled = Boolean(whisperStatus && whisperStatus.runtime && whisperStatus.runtime.installed);
  const runtimeSupported = !whisperStatus || !whisperStatus.runtime || whisperStatus.runtime.supported !== false;
  const selectedModel = whisperStatus && Array.isArray(whisperStatus.models)
    ? whisperStatus.models.find((model) => model.id === modelId)
    : null;
  const modelInstalled = Boolean(selectedModel && selectedModel.installed);
  const downloadingTarget = whisperDownloadState && whisperDownloadState.active ? whisperDownloadState.target : "";
  statusNode.innerHTML = renderWhisperStatus(modelId);
  if (captureSelect) {
    const captureId = normalizeLocalWhisperCaptureId(captureSelect.value || state.boardSettings.localWhisperCaptureId);
    captureSelect.innerHTML = renderCaptureDeviceOptions(captureId);
    captureSelect.value = String(captureId);
  }
  runtimeButton.disabled = downloadingTarget === "runtime" || !runtimeSupported;
  modelButton.disabled = Boolean(downloadingTarget && downloadingTarget !== "runtime") || !modelId;
  runtimeButton.textContent = downloadingTarget === "runtime"
    ? "Downloading..."
    : (!runtimeSupported ? "Unavailable" : (runtimeInstalled ? "Update" : "Install"));
  modelButton.textContent = downloadingTarget === modelId
    ? "Downloading..."
    : (modelInstalled ? "Update" : "Install");
}

function renderWhisperStatus(modelId) {
  const selected = LOCAL_WHISPER_MODELS.find((model) => model.id === normalizeLocalWhisperModel(modelId)) || LOCAL_WHISPER_MODELS[0];
  const runtime = whisperStatus && whisperStatus.runtime ? whisperStatus.runtime : null;
  const modelStatus = whisperStatus && Array.isArray(whisperStatus.models)
    ? whisperStatus.models.find((model) => model.id === selected.id)
    : null;
  const runtimeSupported = !runtime || runtime.supported !== false;
  const runtimeText = runtime && runtime.installed
    ? "Runtime installed"
    : (runtimeSupported ? "Runtime not installed" : "Runtime unavailable");
  const modelText = modelStatus && modelStatus.installed ? "Model installed" : "Model not installed";
  const runtimePlatform = runtime && runtime.platform ? runtime.platform : "";
  const runtimeReason = runtime && runtime.reason
    ? '<div class="whisperNotice">' + escapeHtml(runtime.reason) + '</div>'
    : "";
  const progressPercent = Math.max(0, Math.min(100, Math.round(Number(whisperDownloadState && whisperDownloadState.progress || 0))));
  const progress = whisperDownloadState
    ? '<div class="whisperProgress" style="--progress: ' + progressPercent + '%"><span>' + escapeHtml(whisperDownloadState.message || "Downloading...") + '</span><strong>' + progressPercent + '%</strong></div>'
    : "";
  const micNotice = microphonePermissionNotice
    ? '<div class="whisperNotice">' + escapeHtml(microphonePermissionNotice) + '</div>'
    : "";
  const prewarmNotice = whisperPrewarmState && whisperPrewarmState.modelId === selected.id
    ? whisperPrewarmState.active
      ? '<div class="whisperNotice">Warming up selected model...</div>'
      : whisperPrewarmState.error
        ? '<div class="whisperNotice">Warmup failed: ' + escapeHtml(whisperPrewarmState.error) + '</div>'
        : '<div class="whisperNotice">Selected model is warmed up.</div>'
    : "";
  return `
    <div><strong>${escapeHtml(selected.label)}</strong> <span>${escapeHtml(selected.size)}</span></div>
    <div>${escapeHtml(selected.description)}. Multilingual model, supports Russian.</div>
    ${runtimePlatform ? '<div>Runtime platform: ' + escapeHtml(runtimePlatform) + '</div>' : ''}
    <div>${escapeHtml(runtimeText)} · ${escapeHtml(modelText)}</div>
    <div>${runtimeSupported ? 'Default microphone uses the current system recording device. Pick a named input if the default is wrong.' : 'Local Whisper can still download models, but live transcription needs a supported local runtime.'}</div>
    ${runtimeReason}
    ${progress}
    ${micNotice}
    ${prewarmNotice}
  `;
}

function renderCaptureDeviceOptions(selectedValue) {
  const selected = normalizeLocalWhisperCaptureId(selectedValue);
  const devices = whisperStatus && Array.isArray(whisperStatus.captureDevices) && whisperStatus.captureDevices.length
    ? whisperStatus.captureDevices
    : [{ id: -1, label: "Default microphone", isDefault: true }];
  const seen = new Set();
  const options = [];

  for (const device of devices) {
    const id = normalizeLocalWhisperCaptureId(device.id);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const prefix = id >= 0 ? id + ": " : "";
    const label = String(device.label || (id === -1 ? "Default microphone" : "Microphone " + id)).trim();
    options.push('<option value="' + escapeAttr(id) + '"' + (id === selected ? " selected" : "") + '>' + escapeHtml(prefix + label) + '</option>');
  }

  if (!seen.has(selected)) {
    options.push('<option value="' + escapeAttr(selected) + '" selected>' + escapeHtml(selected + ": Custom capture device") + '</option>');
  }

  return options.join("");
}

async function requestMicrophonePermission() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    microphonePermissionNotice = "Microphone API is not available in this VS Code webview.";
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    microphonePermissionNotice = "Microphone access granted for this webview.";
  } catch (error) {
    const reason = error && error.name ? error.name : "NotAllowedError";
    microphonePermissionNotice = "Microphone access failed: " + reason + ". Enable microphone access for VS Code in Windows privacy settings; if it still fails, this VS Code webview is blocking media capture.";
  }
}

function openBoardSettings() {
  const modal = document.getElementById("boardSettingsModal");
  if (!modal) {
    return;
  }

  modal.hidden = false;
  vscode.postMessage({ type: "requestWhisperStatus" });
  requestCodexStatus();
  const input = document.getElementById("chatsPerRow");
  if (input) {
    input.focus();
    input.select();
  }
}

function closeBoardSettings() {
  const modal = document.getElementById("boardSettingsModal");
  if (modal) {
    modal.hidden = true;
  }
}

function setChatsPerRow(value) {
  state.boardSettings = normalizeBoardSettings(Object.assign({}, state.boardSettings, {
    chatsPerRow: value
  }));
  refreshBoardAfterSettingsChange();
  persist();
  openBoardSettings();
}

function setChatsPerColumn(value) {
  state.boardSettings = normalizeBoardSettings(Object.assign({}, state.boardSettings, {
    chatsPerColumn: value
  }));
  refreshBoardAfterSettingsChange();
  persist();
  openBoardSettings();
}

function setMaxChatHeight(value) {
  state.boardSettings = normalizeBoardSettings(Object.assign({}, state.boardSettings, {
    maxChatHeight: value
  }));
  refreshBoardAfterSettingsChange();
  persist();
  openBoardSettings();
}
