const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { getHtml: renderWebviewHtml } = require("./webview/html");
const {
  currentPlatformKey,
  platformDisplayName,
  resolveCodexExecutable,
  resolveWhisperRuntimeExecutable
} = require("./lib/platform");
const { downloadFile, extractRuntimeArchive, fileExists } = require("./lib/file-utils");
const { quoteShellArg, requestAppServer, runCodexCommand, stripAnsi } = require("./lib/codex-cli");
const { MAX_ATTACHMENT_BYTES, createAttachmentFromUri, imageMimeType, isImagePath, resolveWorkspaceFilePath } = require("./lib/attachments");
const { listCaptureDevices, runWhisperCli } = require("./lib/whisper-utils");
const { WhisperManager } = require("./lib/whisper-manager");
const { CodexRunner } = require("./lib/codex-runner");
const { DEFAULT_WHISPER_LIVE_STOP_GRACE_MS, LOCAL_WHISPER_MODELS, WHISPER_RUNTIME } = require("./lib/whisper-catalog");
const {
  DEFAULT_BOARD_SETTINGS,
  DEFAULT_CHAT_BACKGROUND,
  DEFAULT_CHAT_SETTINGS,
  clampInt,
  createInitialChat,
  dateStamp,
  normalizeBoardSettings,
  normalizeRateLimits,
  normalizeSettings,
  normalizeWhisperStopGraceMs,
  projectFolderLabel,
  safeFileName,
  trimChatForStorage,
  trimWorkspaceForStorage,
  trimStateForStorage
} = require("./lib/state-store");
const { version: EXTENSION_VERSION } = require("./package.json");

const VIEW_TYPE = "codexMax.chatBoard";
const STATE_KEY = "codexMax.chatBoardState";
const MAX_IMAGE_PREVIEW_BYTES = 8 * 1024 * 1024;

let boardPanel;

function activate(context) {
  const runner = new CodexRunner({
    getWorkspacePath,
    getConfig: () => vscode.workspace.getConfiguration("codexMax"),
    normalizeSettings,
    defaultChatSettings: DEFAULT_CHAT_SETTINGS
  });
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.text = "$(comment-discussion) Codex Max";
  statusItem.tooltip = "Open Codex Max Chat Board";
  statusItem.command = "codexMax.openChatBoard";
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      async deserializeWebviewPanel(panel) {
        boardPanel = new ChatBoardPanel(context, panel, runner);
      }
    }),
    vscode.commands.registerCommand("codexMax.openChatBoard", () => {
      boardPanel = ChatBoardPanel.createOrShow(context, runner);
    }),
    vscode.commands.registerCommand("codexMax.addChat", async () => {
      boardPanel = ChatBoardPanel.createOrShow(context, runner);
      boardPanel.post({ type: "addChat" });
    })
  );
}

function deactivate() {}

class ChatBoardPanel {
  static createOrShow(context, runner) {
    if (boardPanel) {
      boardPanel.refresh();
      boardPanel.panel.reveal(vscode.ViewColumn.Active);
      return boardPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      "Codex Max",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "webview")
        ]
      }
    );

    boardPanel = new ChatBoardPanel(context, panel, runner);
    return boardPanel;
  }

  constructor(context, panel, runner) {
    this.context = context;
    this.panel = panel;
    this.runner = runner;
    this.disposables = [];
    this.rateLimitsRefreshInFlight = null;
    this.whisper = new WhisperManager({
      models: LOCAL_WHISPER_MODELS,
      runtime: WHISPER_RUNTIME,
      defaultModelId: DEFAULT_BOARD_SETTINGS.localWhisperModel,
      paths: {
        root: () => this.whisperRoot(),
        cli: () => this.whisperRuntimePath(),
        stream: () => this.whisperStreamPath(),
        model: (model) => this.whisperModelPath(model)
      },
      post: (message) => this.post(message),
      normalizeStopGraceMs: normalizeWhisperStopGraceMs
    });

    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, "webview")
      ]
    };

    this.panel.onDidDispose(
      () => {
        this.dispose();
      },
      null,
      this.disposables
    );

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        try {
          await this.handleMessage(message);
        } catch (error) {
          this.handleMessageError(message, error);
        }
      },
      null,
      this.disposables
    );

    this.panel.webview.html = getHtml(this.panel.webview, context.extensionUri);
  }

  post(message) {
    this.panel.webview.postMessage(message);
  }

  refresh() {
    this.panel.webview.html = getHtml(this.panel.webview, this.context.extensionUri);
  }

  async handleMessage(message) {
    if (!message || typeof message.type !== "string") {
      return;
    }

    if (message.type === "ready") {
      this.post({
        type: "hydrate",
        state: this.getSavedState(),
        config: this.getClientConfig()
      });
      return;
    }

    if (message.type === "persist") {
      this.saveState(message.state).catch((error) => {
        console.warn("Codex Max could not persist state:", error);
      });
      return;
    }

    if (message.type === "exportWorkspaces") {
      await this.exportWorkspaces(message.state);
      return;
    }

    if (message.type === "importWorkspaces") {
      await this.importWorkspaces();
      return;
    }

    if (message.type === "exportWorkspacePreset") {
      await this.exportWorkspacePreset(message.preset);
      return;
    }

    if (message.type === "importWorkspacePreset") {
      await this.importWorkspacePreset();
      return;
    }

    if (message.type === "sendPrompt") {
      this.runner.run(message.chatId, message.prompt, message.sessionId, message.settings, this, message.projectPath);
      this.saveState(message.state).catch((error) => {
        this.post({
          type: "chatEvent",
          chatId: message.chatId,
          event: {
            kind: "state",
            status: "error",
            title: "Could not save chat state",
            detail: String(error && error.message || error || "")
          }
        });
      });
      return;
    }

    if (message.type === "pickFiles") {
      await this.pickFiles(message.chatId);
      return;
    }

    if (message.type === "pasteImages") {
      await this.attachPastedImages(message.chatId, message.images);
      return;
    }

    if (message.type === "pickProject") {
      await this.pickProject(message.chatId);
      return;
    }

    if (message.type === "pickWorkspaceProject") {
      await this.pickWorkspaceProject(message.chatId);
      return;
    }

    if (message.type === "pickNewWorkspace") {
      await this.pickNewWorkspace();
      return;
    }

    if (message.type === "refreshRateLimits") {
      await this.refreshRateLimits(Boolean(message.silent));
      return;
    }

    if (message.type === "requestCodexStatus") {
      await this.postCodexStatus();
      return;
    }

    if (message.type === "openCodexActionTerminal") {
      this.openCodexActionTerminal(message.action);
      return;
    }

    if (message.type === "requestWhisperStatus") {
      await this.postWhisperStatus();
      return;
    }

    if (message.type === "prewarmWhisperModel") {
      await this.prewarmWhisperModel(message.modelId, message.captureId);
      return;
    }

    if (message.type === "downloadWhisperRuntime") {
      await this.downloadWhisperRuntime();
      return;
    }

    if (message.type === "downloadWhisperModel") {
      await this.downloadWhisperModel(message.modelId);
      return;
    }

    if (message.type === "transcribeWhisperAudio") {
      await this.transcribeWhisperAudio(message);
      return;
    }

    if (message.type === "pickWhisperAudioFile") {
      await this.pickWhisperAudioFile(message.chatId, message.modelId);
      return;
    }

    if (message.type === "startWhisperLive") {
      await this.whisper.startWhisperLive(message.chatId, message.modelId, message.captureId);
      return;
    }

    if (message.type === "stopWhisperLive") {
      this.whisper.stopWhisperLive(message.chatId, false, false, message.stopGraceMs);
      return;
    }

    if (message.type === "openMicrophoneSettings") {
      await this.openMicrophoneSettings();
      return;
    }

    if (message.type === "openOfficialCodex") {
      await this.saveState(message.state);
      await this.openOfficialCodex(message.chatId, message.target);
      return;
    }

    if (message.type === "stopChat") {
      this.runner.stop(message.chatId);
      return;
    }

    if (message.type === "openFile") {
      await this.openFile(message.path);
      return;
    }

    if (message.type === "imagePreview") {
      await this.previewImage(message);
      return;
    }

    if (message.type === "openExternal") {
      await this.openExternal(message.url);
      return;
    }
  }

  handleMessageError(message, error) {
    const detail = String(error && error.message || error || "Unknown error");
    if (message && message.chatId) {
      this.post({
        type: "chatError",
        chatId: message.chatId,
        error: detail
      });
      return;
    }

    vscode.window.showWarningMessage(`Codex Max message failed: ${detail}`);
  }

  async openFile(filePath) {
    const normalized = resolveWorkspaceFilePath(filePath, getWorkspacePath());
    if (!normalized) {
      return;
    }

    try {
      if (isImagePath(normalized)) {
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(normalized), {
          preview: false
        });
        return;
      }

      await vscode.window.showTextDocument(vscode.Uri.file(normalized), {
        preview: false
      });
    } catch (error) {
      vscode.window.showWarningMessage(`Codex Max could not open ${normalized}: ${error.message || error}`);
    }
  }

  async openMicrophoneSettings() {
    try {
      if (process.platform === "win32") {
        await vscode.env.openExternal(vscode.Uri.parse("ms-settings:privacy-microphone"));
        return;
      }

      vscode.window.showInformationMessage("Open your system privacy settings and allow microphone access for VS Code.");
    } catch (error) {
      vscode.window.showWarningMessage(`Codex Max could not open microphone settings: ${error.message || error}`);
    }
  }

  async pickFiles(chatId) {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      openLabel: "Attach"
    });

    if (!uris || !uris.length) {
      return;
    }

    const attachments = [];
    for (const uri of uris) {
      const attachment = await createAttachmentFromUri(uri, getWorkspacePath());
      if (attachment) {
        attachments.push(attachment);
      }
    }

    if (attachments.length) {
      this.post({
        type: "filesAttached",
        chatId,
        attachments
      });
    }
  }

  async attachPastedImages(chatId, images) {
    const clean = Array.isArray(images) ? images.filter(Boolean).slice(0, 10) : [];
    if (!clean.length) {
      return;
    }

    const targetDir = await this.clipboardAttachmentDirectory();
    const attachments = [];

    for (let index = 0; index < clean.length; index += 1) {
      const image = clean[index];
      const parsed = parseImageDataUrl(image.dataUrl, image.mime);
      if (!parsed) {
        continue;
      }

      if (parsed.buffer.length > MAX_IMAGE_PREVIEW_BYTES) {
        vscode.window.showWarningMessage(`Codex Max skipped ${image.name || "pasted image"} because it is larger than ${formatBytesForHost(MAX_IMAGE_PREVIEW_BYTES)}.`);
        continue;
      }

      const fileName = await uniqueFileName(targetDir, image.name, parsed.mime, index);
      const filePath = path.join(targetDir, fileName);
      await fs.promises.writeFile(filePath, parsed.buffer);

      const attachment = await createAttachmentFromUri(vscode.Uri.file(filePath), getWorkspacePath());
      if (attachment) {
        attachments.push(attachment);
      }
    }

    if (attachments.length) {
      this.post({
        type: "filesAttached",
        chatId,
        attachments
      });
    }
  }

  async clipboardAttachmentDirectory() {
    const workspacePath = getWorkspacePath();
    const targetDir = workspacePath
      ? path.join(workspacePath, ".codex-max", "attachments")
      : path.join(this.context.globalStorageUri.fsPath, "clipboard-images");
    await fs.promises.mkdir(targetDir, { recursive: true });
    return targetDir;
  }

  async pickProject(chatId) {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Use project"
    });

    if (!uris || !uris.length) {
      return;
    }

    this.post({
      type: "projectSelected",
      chatId,
      projectPath: uris[0].fsPath
    });
  }

  async pickWorkspaceProject(chatId) {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Use as current workspace"
    });

    if (!uris || !uris.length) {
      return;
    }

    this.post({
      type: "workspaceSelected",
      chatId,
      workspacePath: uris[0].fsPath
    });
  }

  async pickNewWorkspace() {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Create workspace"
    });

    if (!uris || !uris.length) {
      return;
    }

    this.post({
      type: "newWorkspaceSelected",
      workspacePath: uris[0].fsPath
    });
  }

  async refreshRateLimits(silent) {
    if (this.rateLimitsRefreshInFlight) {
      return this.rateLimitsRefreshInFlight;
    }

    this.rateLimitsRefreshInFlight = this.refreshRateLimitsNow(Boolean(silent))
      .finally(() => {
        this.rateLimitsRefreshInFlight = null;
      });
    return this.rateLimitsRefreshInFlight;
  }

  async refreshRateLimitsNow(silent) {
    const cfg = vscode.workspace.getConfiguration("codexMax");
    const executable = resolveCodexExecutable(cfg.get("codexExecutable", "codex") || "codex");

    try {
      const result = await requestAppServer(executable, "account/rateLimits/read", {});
      this.post({
        type: "accountRateLimits",
        rateLimits: result
      });
    } catch (error) {
      if (!silent) {
        vscode.window.showWarningMessage(`Codex Max could not refresh account limits: ${error.message || error}`);
      }
    } finally {
      this.post({
        type: "accountRateLimitsRefreshFinished"
      });
    }
  }

  async postCodexStatus() {
    const cfg = vscode.workspace.getConfiguration("codexMax");
    const configured = cfg.get("codexExecutable", "codex") || "codex";
    const executable = resolveCodexExecutable(configured);
    const status = {
      executable: executable.command,
      configured,
      cliFound: false,
      cliOk: false,
      version: "",
      loginOk: false,
      loginStatus: "",
      overall: "checking",
      issues: [],
      checkedAt: Date.now()
    };

    try {
      const versionResult = await runCodexCommand(executable, ["--version"], 5000);
      status.cliFound = true;
      status.cliOk = versionResult.code === 0;
      status.version = stripAnsi(versionResult.stdout || versionResult.stderr).trim();
      if (!status.cliOk) {
        status.issues.push(versionResult.stderr || versionResult.stdout || "Codex CLI did not return a successful version response.");
      }
    } catch (error) {
      status.issues.push(error.message || String(error));
    }

    if (status.cliOk) {
      try {
        const loginResult = await runCodexCommand(executable, ["login", "status"], 5000);
        const loginOutput = stripAnsi([loginResult.stdout, loginResult.stderr].filter(Boolean).join("\n")).trim();
        status.loginStatus = loginOutput;
        status.loginOk = loginResult.code === 0 && /logged in|authenticated|using/i.test(loginOutput);
        if (!status.loginOk) {
          status.issues.push(loginOutput || "Codex CLI is installed, but login status is not connected.");
        }
      } catch (error) {
        status.issues.push(error.message || String(error));
      }
    }

    status.overall = status.cliOk && status.loginOk ? "connected" : (status.cliOk ? "needs-login" : "missing");
    this.post({
      type: "codexStatus",
      status
    });
  }

  openCodexActionTerminal(action) {
    const cfg = vscode.workspace.getConfiguration("codexMax");
    const executable = resolveCodexExecutable(cfg.get("codexExecutable", "codex") || "codex");
    const terminal = vscode.window.createTerminal({ name: "Codex Max setup" });
    terminal.show();

    if (action === "install") {
      terminal.sendText("npm install -g @openai/codex");
      return;
    }
    if (action === "login") {
      terminal.sendText(`${quoteShellArg(executable.command)} login`);
      return;
    }
    if (action === "doctor") {
      terminal.sendText(`${quoteShellArg(executable.command)} doctor --summary`);
      return;
    }
    if (action === "version") {
      terminal.sendText(`${quoteShellArg(executable.command)} --version`);
    }
  }

  whisperRoot() {
    return path.join(this.context.globalStorageUri.fsPath, "whisper");
  }

  whisperRuntimePath() {
    return resolveWhisperRuntimeExecutable(this.whisperRoot(), "cli", WHISPER_RUNTIME);
  }

  whisperStreamPath() {
    return resolveWhisperRuntimeExecutable(this.whisperRoot(), "stream", WHISPER_RUNTIME);
  }

  whisperBenchPath() {
    return resolveWhisperRuntimeExecutable(this.whisperRoot(), "bench", WHISPER_RUNTIME);
  }

  whisperModelPath(model) {
    return path.join(this.whisperRoot(), "models", model.file);
  }

  async whisperStatus() {
    const runtimePath = this.whisperRuntimePath();
    const runtimeInstalled = WHISPER_RUNTIME.supported && await fileExists(runtimePath);
    const captureDevices = await listCaptureDevices();
    const models = [];
    for (const model of LOCAL_WHISPER_MODELS) {
      const modelPath = this.whisperModelPath(model);
      models.push(Object.assign({}, model, {
        installed: await fileExists(modelPath),
        path: modelPath
      }));
    }

    return {
      runtime: Object.assign({}, WHISPER_RUNTIME, {
        installed: runtimeInstalled,
        path: runtimePath,
        platformKey: currentPlatformKey()
      }),
      captureDevices,
      models
    };
  }

  async postWhisperStatus(extra) {
    this.post(Object.assign({
      type: "whisperStatus",
      status: await this.whisperStatus()
    }, extra || {}));
  }

  async prewarmWhisperModel(modelId, captureId) {
    const model = LOCAL_WHISPER_MODELS.find((item) => item.id === modelId) || LOCAL_WHISPER_MODELS.find((item) => item.id === DEFAULT_BOARD_SETTINGS.localWhisperModel) || LOCAL_WHISPER_MODELS[0];
    if (!model) {
      return;
    }

    try {
      this.post({ type: "whisperPrewarmStarted", modelId: model.id });
      await this.whisper.ensurePersistentWhisper(model.id, captureId);
      setTimeout(() => {
        this.post({
          type: "whisperPrewarmFinished",
          modelId: model.id,
          error: this.whisper.isPersistentModel(model.id) ? "" : "Local Whisper process is not running."
        });
      }, 1200);
    } catch (error) {
      this.post({
        type: "whisperPrewarmFinished",
        modelId: model.id,
        error: error.message || String(error)
      });
    }
  }

  async downloadWhisperRuntime() {
    if (!WHISPER_RUNTIME.supported || !WHISPER_RUNTIME.url) {
      const message = WHISPER_RUNTIME.reason || `Automatic whisper.cpp runtime install is not available for ${platformDisplayName()}.`;
      await this.postWhisperStatus({ message });
      this.post({
        type: "whisperDownloadError",
        target: "runtime",
        error: message
      });
      return;
    }

    const root = this.whisperRoot();
    const downloadPath = path.join(root, "downloads", WHISPER_RUNTIME.archiveName);
    const runtimeDir = path.join(root, "runtime");
    try {
      await fs.promises.mkdir(path.dirname(downloadPath), { recursive: true });
      await fs.promises.mkdir(runtimeDir, { recursive: true });
      await this.postWhisperStatus({ downloading: "runtime", progress: 0, message: `Downloading ${WHISPER_RUNTIME.label}...` });
      await downloadFile(WHISPER_RUNTIME.url, downloadPath, (progress) => {
        this.post({ type: "whisperDownloadProgress", target: "runtime", progress });
      });
      await extractRuntimeArchive(downloadPath, runtimeDir, WHISPER_RUNTIME);
      await this.postWhisperStatus({ message: `${WHISPER_RUNTIME.label} installed.` });
    } catch (error) {
      this.post({
        type: "whisperDownloadError",
        target: "runtime",
        error: error.message || String(error)
      });
    }
  }

  async downloadWhisperModel(modelId) {
    const model = LOCAL_WHISPER_MODELS.find((item) => item.id === modelId) || LOCAL_WHISPER_MODELS.find((item) => item.id === DEFAULT_BOARD_SETTINGS.localWhisperModel) || LOCAL_WHISPER_MODELS[0];
    if (!model) {
      return;
    }

    const modelPath = this.whisperModelPath(model);
    try {
      await fs.promises.mkdir(path.dirname(modelPath), { recursive: true });
      await this.postWhisperStatus({ downloading: model.id, progress: 0, message: `Downloading ${model.label}...` });
      await downloadFile(model.url, modelPath, (progress) => {
        this.post({ type: "whisperDownloadProgress", target: model.id, progress });
      });
      await this.postWhisperStatus({ message: `${model.label} installed.` });
    } catch (error) {
      this.post({
        type: "whisperDownloadError",
        target: model.id,
        error: error.message || String(error)
      });
    }
  }

  async transcribeWhisperAudio(message) {
    const chatId = String(message.chatId || "");
    const model = LOCAL_WHISPER_MODELS.find((item) => item.id === message.modelId) || LOCAL_WHISPER_MODELS.find((item) => item.id === DEFAULT_BOARD_SETTINGS.localWhisperModel) || LOCAL_WHISPER_MODELS[0];
    const executable = this.whisperRuntimePath();
    const modelPath = model ? this.whisperModelPath(model) : "";

    try {
      if (!chatId) {
        return;
      }
      if (!await fileExists(executable)) {
        throw new Error("whisper.cpp runtime is not installed.");
      }
      if (!modelPath || !await fileExists(modelPath)) {
        throw new Error("Selected Whisper model is not installed.");
      }

      const dataUri = String(message.dataUri || "");
      const match = /^data:audio\/wav;base64,(.+)$/i.exec(dataUri);
      if (!match) {
        throw new Error("Unsupported audio payload.");
      }

      const audioDir = path.join(this.whisperRoot(), "recordings");
      await fs.promises.mkdir(audioDir, { recursive: true });
      const audioPath = path.join(audioDir, `voice-${Date.now()}.wav`);
      await fs.promises.writeFile(audioPath, Buffer.from(match[1], "base64"));
      const transcript = await runWhisperCli(executable, modelPath, audioPath);
      this.post({
        type: "voiceTranscription",
        chatId,
        text: transcript
      });
    } catch (error) {
      this.post({
        type: "voiceTranscriptionError",
        chatId,
        error: error.message || String(error)
      });
    }
  }

  async pickWhisperAudioFile(chatId, modelId) {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: "Transcribe audio",
      filters: {
        Audio: ["wav", "mp3", "m4a", "ogg", "flac", "webm", "mp4"]
      }
    });

    if (!uris || !uris.length) {
      return;
    }

    await this.transcribeWhisperAudioFile(String(chatId || ""), String(modelId || ""), uris[0].fsPath);
  }

  async transcribeWhisperAudioFile(chatId, modelId, audioPath) {
    const model = LOCAL_WHISPER_MODELS.find((item) => item.id === modelId) || LOCAL_WHISPER_MODELS.find((item) => item.id === DEFAULT_BOARD_SETTINGS.localWhisperModel) || LOCAL_WHISPER_MODELS[0];
    const executable = this.whisperRuntimePath();
    const modelPath = model ? this.whisperModelPath(model) : "";

    try {
      if (!chatId) {
        return;
      }
      if (!await fileExists(executable)) {
        throw new Error("whisper.cpp runtime is not installed.");
      }
      if (!modelPath || !await fileExists(modelPath)) {
        throw new Error("Selected Whisper model is not installed.");
      }
      if (!audioPath || !await fileExists(audioPath)) {
        throw new Error("Audio file was not found.");
      }

      this.post({
        type: "voiceTranscriptionStatus",
        chatId,
        text: "Local Whisper is transcribing audio file..."
      });
      const transcript = await runWhisperCli(executable, modelPath, audioPath);
      this.post({
        type: "voiceTranscription",
        chatId,
        text: transcript
      });
    } catch (error) {
      this.post({
        type: "voiceTranscriptionError",
        chatId,
        error: error.message || String(error)
      });
    }
  }

  stopAllWhisperLive() {
    this.whisper.stopAll();
  }

  async previewImage(message) {
    const requestId = String(message.requestId || "");
    const filePath = resolveWorkspaceFilePath(message.path, getWorkspacePath());
    if (!requestId || !filePath || !isImagePath(filePath)) {
      this.post({
        type: "imagePreview",
        requestId,
        path: String(message.path || ""),
        error: "Unsupported image path."
      });
      return;
    }

    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        throw new Error("Path is not a file.");
      }
      if (stat.size > MAX_IMAGE_PREVIEW_BYTES) {
        throw new Error(`Image is larger than ${Math.round(MAX_IMAGE_PREVIEW_BYTES / 1024 / 102.4) / 10} MB.`);
      }

      const buffer = await fs.promises.readFile(filePath);
      this.post({
        type: "imagePreview",
        requestId,
        path: filePath,
        dataUri: `data:${imageMimeType(filePath)};base64,${buffer.toString("base64")}`
      });
    } catch (error) {
      this.post({
        type: "imagePreview",
        requestId,
        path: filePath,
        error: error.message || String(error)
      });
    }
  }

  async openExternal(url) {
    if (!/^https?:\/\//i.test(String(url || ""))) {
      return;
    }

    try {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      vscode.window.showWarningMessage(`Codex Max could not open ${url}: ${error.message || error}`);
    }
  }

  async openOfficialCodex(chatId, target) {
    const commands = {
      panel: "chatgpt.newCodexPanel",
      chat: "chatgpt.newChat",
      sidebar: "chatgpt.openSidebar"
    };
    const command = commands[target] || commands.panel;

    try {
      await vscode.commands.executeCommand(command);
      this.post({
        type: "officialOpened",
        chatId,
        target
      });
    } catch (error) {
      this.post({
        type: "chatError",
        chatId,
        error: `Could not run ${command}. Check that the official Codex extension is installed and enabled. ${error.message || error}`
      });
    }
  }

  getSavedState() {
    const saved = this.context.workspaceState.get(STATE_KEY);
    if (saved && Array.isArray(saved.chats)) {
      return saved;
    }

    const initialChat = createInitialChat(getWorkspacePath() || "");
    const initialBoardSettings = Object.assign({}, DEFAULT_BOARD_SETTINGS, {
      currentWorkspacePath: getWorkspacePath() || ""
    });
    const initialWorkspace = {
      id: `workspace-${Date.now()}`,
      name: projectFolderLabel(initialBoardSettings.currentWorkspacePath) || "Workspace",
      path: initialBoardSettings.currentWorkspacePath,
      selectedChatId: null,
      boardSettings: initialBoardSettings,
      chats: [initialChat]
    };

    return {
      chats: [initialChat],
      selectedChatId: null,
      activeWorkspaceId: initialWorkspace.id,
      workspaces: [initialWorkspace],
      accountRateLimits: null,
      boardSettings: initialBoardSettings
    };
  }

  async saveState(state) {
    if (!state) {
      return;
    }

    const workspaces = Array.isArray(state.workspaces)
      ? state.workspaces.map(trimWorkspaceForStorage).filter(Boolean)
      : [];
    const activeWorkspaceId = String(state.activeWorkspaceId || (workspaces[0] && workspaces[0].id) || "");
    const chats = Array.isArray(state.chats)
      ? state.chats.map(trimChatForStorage)
      : (workspaces[0] ? workspaces[0].chats : []);
    const boardSettings = normalizeBoardSettings(state.boardSettings || (workspaces[0] && workspaces[0].boardSettings) || {});

    const trimmed = {
      selectedChatId: state.selectedChatId || null,
      accountRateLimits: normalizeRateLimits(state.accountRateLimits),
      boardSettings,
      chats,
      activeWorkspaceId,
      workspaces: workspaces.length ? workspaces : [{
        id: activeWorkspaceId || "workspace-default",
        name: projectFolderLabel(boardSettings.currentWorkspacePath || getWorkspacePath() || "") || "Workspace",
        path: boardSettings.currentWorkspacePath || getWorkspacePath() || "",
        selectedChatId: state.selectedChatId || null,
        boardSettings,
        chats
      }]
    };

    await this.context.workspaceState.update(STATE_KEY, trimmed);
  }

  async exportWorkspaces(state) {
    if (!state) {
      return;
    }

    const payload = {
      format: "codex-max.workspaces",
      version: 1,
      exportedAt: new Date().toISOString(),
      state: trimStateForStorage(state)
    };
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(getWorkspacePath() || os.homedir(), `codex-max-workspaces-${dateStamp()}.json`)),
      filters: {
        "Codex Max workspace export": ["json"]
      },
      saveLabel: "Export workspaces"
    });
    if (!uri) {
      return;
    }

    await fs.promises.writeFile(uri.fsPath, JSON.stringify(payload, null, 2), "utf8");
    vscode.window.showInformationMessage(`Codex Max workspaces exported to ${uri.fsPath}.`);
  }

  async importWorkspaces() {
    const uri = await pickJsonFile("Import workspaces");
    if (!uri) {
      return;
    }

    try {
      const payload = JSON.parse(await fs.promises.readFile(uri.fsPath, "utf8"));
      const importedState = payload && payload.format === "codex-max.workspaces" ? payload.state : payload;
      if (!importedState || typeof importedState !== "object") {
        throw new Error("Selected file does not contain Codex Max workspace state.");
      }

      const confirmed = await vscode.window.showWarningMessage(
        "Importing Codex Max workspaces will replace the current board state in this VS Code workspace.",
        { modal: true },
        "Import"
      );
      if (confirmed !== "Import") {
        return;
      }

      this.post({
        type: "workspaceImport",
        state: importedState,
        path: uri.fsPath
      });
    } catch (error) {
      vscode.window.showWarningMessage(`Codex Max could not import workspaces: ${error.message || error}`);
    }
  }

  async exportWorkspacePreset(preset) {
    if (!preset || typeof preset !== "object") {
      return;
    }

    const payload = {
      format: "codex-max.workspace-preset",
      version: 1,
      exportedAt: new Date().toISOString(),
      preset
    };
    const name = safeFileName(preset.name || "workspace-preset");
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(getWorkspacePath() || os.homedir(), `codex-max-preset-${name}-${dateStamp()}.json`)),
      filters: {
        "Codex Max workspace preset": ["json"]
      },
      saveLabel: "Export preset"
    });
    if (!uri) {
      return;
    }

    await fs.promises.writeFile(uri.fsPath, JSON.stringify(payload, null, 2), "utf8");
    vscode.window.showInformationMessage(`Codex Max preset exported to ${uri.fsPath}.`);
  }

  async importWorkspacePreset() {
    const uri = await pickJsonFile("Import preset");
    if (!uri) {
      return;
    }

    try {
      const payload = JSON.parse(await fs.promises.readFile(uri.fsPath, "utf8"));
      const preset = payload && payload.format === "codex-max.workspace-preset" ? payload.preset : payload;
      if (!preset || typeof preset !== "object") {
        throw new Error("Selected file does not contain a Codex Max workspace preset.");
      }

      this.post({
        type: "workspacePresetImport",
        preset,
        path: uri.fsPath
      });
    } catch (error) {
      vscode.window.showWarningMessage(`Codex Max could not import preset: ${error.message || error}`);
    }
  }

  getClientConfig() {
    const cfg = vscode.workspace.getConfiguration("codexMax");
    return {
      maxVisibleChats: cfg.get("maxVisibleChats", 12),
      defaultChatsPerRow: clampInt(cfg.get("chatsPerRow", DEFAULT_BOARD_SETTINGS.chatsPerRow), 1, 12),
      defaultChatsPerColumn: clampInt(cfg.get("chatsPerColumn", DEFAULT_BOARD_SETTINGS.chatsPerColumn), 1, 6),
      workspaceName: getWorkspaceLabel(),
      workspacePath: getWorkspacePath() || ""
    };
  }

  dispose() {
    boardPanel = undefined;
    this.stopAllWhisperLive();
    this.runner.stopAll();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

async function pickJsonFile(openLabel) {
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      "JSON files": ["json"]
    },
    openLabel
  });

  return uris && uris.length ? uris[0] : null;
}

function parseImageDataUrl(dataUrl, fallbackMime) {
  const value = String(dataUrl || "");
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) {
    return null;
  }

  const mime = String(match[1] || fallbackMime || "image/png").toLowerCase();
  if (!mime.startsWith("image/")) {
    return null;
  }

  const base64 = String(match[2] || "").replace(/\s+/g, "");
  if (!base64) {
    return null;
  }

  return {
    mime,
    buffer: Buffer.from(base64, "base64")
  };
}

async function uniqueFileName(targetDir, preferredName, mime, index) {
  const ext = extensionForImageMime(mime);
  const fallbackName = `clipboard-image-${dateStamp()}-${index + 1}${ext}`;
  const original = safeFileName(preferredName || fallbackName);
  const baseName = path.extname(original) ? original : `${original}${ext}`;
  const parsed = path.parse(baseName);
  let candidate = baseName;
  let suffix = 1;

  while (await fileExists(path.join(targetDir, candidate))) {
    candidate = `${parsed.name}-${suffix}${parsed.ext || ext}`;
    suffix += 1;
  }

  return candidate;
}

function extensionForImageMime(mime) {
  const normalized = String(mime || "").toLowerCase();
  if (normalized === "image/jpeg") {
    return ".jpg";
  }
  if (normalized === "image/webp") {
    return ".webp";
  }
  if (normalized === "image/gif") {
    return ".gif";
  }
  if (normalized === "image/bmp") {
    return ".bmp";
  }
  if (normalized === "image/svg+xml") {
    return ".svg";
  }

  return ".png";
}

function formatBytesForHost(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${bytes} B`;
}

function getWorkspacePath() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }

  return folders[0].uri.fsPath;
}

function getWorkspaceLabel() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return "No workspace";
  }

  if (folders.length === 1) {
    return folders[0].name;
  }

  return `${folders[0].name} + ${folders.length - 1}`;
}

function getHtml(webview, extensionUri) {
  return renderWebviewHtml(webview, extensionUri, {
    extensionVersion: EXTENSION_VERSION,
    defaultChatBackground: DEFAULT_CHAT_BACKGROUND,
    defaultWhisperLiveStopGraceMs: DEFAULT_WHISPER_LIVE_STOP_GRACE_MS,
    maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
    localWhisperModels: LOCAL_WHISPER_MODELS
  });
}

module.exports = {
  activate,
  deactivate
};
