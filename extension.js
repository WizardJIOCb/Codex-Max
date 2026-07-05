const vscode = require("vscode");
const cp = require("child_process");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");

const VIEW_TYPE = "codexMax.chatBoard";
const STATE_KEY = "codexMax.chatBoardState";
const MAX_ATTACHMENT_BYTES = 256 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 8 * 1024 * 1024;
const DEFAULT_WHISPER_LIVE_STOP_GRACE_MS = 2600;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
const DEFAULT_CHAT_BACKGROUND = "#252526";
const DEFAULT_CHAT_SETTINGS = {
  model: "gpt-5.5",
  reasoning: "medium",
  verbosity: "medium",
  sandbox: "read-only",
  webSearch: "cached"
};
const DEFAULT_BOARD_SETTINGS = {
  chatsPerRow: 3,
  chatsPerColumn: 2,
  maxChatHeight: 0,
  chatBackground: DEFAULT_CHAT_BACKGROUND,
  sendWithCtrlEnter: false,
  autoScroll: true,
  voiceShortcut: "alt-v",
  speechToText: "browser",
  localWhisperModel: "small-q5_1",
  localWhisperCaptureId: -1,
  localWhisperStopGraceMs: DEFAULT_WHISPER_LIVE_STOP_GRACE_MS,
  currentWorkspacePath: ""
};

const WHISPER_RELEASE_TAG = "v1.9.1";
const WHISPER_RUNTIME_BASE_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE_TAG}`;
const WHISPER_RUNTIME_BY_PLATFORM = {
  "win32-x64": {
    id: "whisper.cpp-win32-x64",
    label: "whisper.cpp Windows x64",
    platform: "Windows x64",
    archiveName: "whisper-bin-x64.zip",
    archiveType: "zip",
    executable: ["runtime", "Release", "whisper-cli.exe"],
    streamExecutable: ["runtime", "Release", "whisper-stream.exe"],
    benchExecutable: ["runtime", "Release", "whisper-bench.exe"],
    cliNames: ["whisper-cli.exe"],
    streamNames: ["whisper-stream.exe"],
    benchNames: ["whisper-bench.exe"],
    supported: true
  },
  "win32-ia32": {
    id: "whisper.cpp-win32-ia32",
    label: "whisper.cpp Windows Win32",
    platform: "Windows Win32",
    archiveName: "whisper-bin-Win32.zip",
    archiveType: "zip",
    executable: ["runtime", "Release", "whisper-cli.exe"],
    streamExecutable: ["runtime", "Release", "whisper-stream.exe"],
    benchExecutable: ["runtime", "Release", "whisper-bench.exe"],
    cliNames: ["whisper-cli.exe"],
    streamNames: ["whisper-stream.exe"],
    benchNames: ["whisper-bench.exe"],
    supported: true
  },
  "linux-x64": {
    id: "whisper.cpp-linux-x64",
    label: "whisper.cpp Ubuntu x64",
    platform: "Linux x64",
    archiveName: "whisper-bin-ubuntu-x64.tar.gz",
    archiveType: "tar.gz",
    executable: ["runtime", "whisper-cli"],
    streamExecutable: ["runtime", "whisper-stream"],
    benchExecutable: ["runtime", "whisper-bench"],
    cliNames: ["whisper-cli"],
    streamNames: ["whisper-stream"],
    benchNames: ["whisper-bench"],
    supported: true
  },
  "linux-arm64": {
    id: "whisper.cpp-linux-arm64",
    label: "whisper.cpp Ubuntu arm64",
    platform: "Linux arm64",
    archiveName: "whisper-bin-ubuntu-arm64.tar.gz",
    archiveType: "tar.gz",
    executable: ["runtime", "whisper-cli"],
    streamExecutable: ["runtime", "whisper-stream"],
    benchExecutable: ["runtime", "whisper-bench"],
    cliNames: ["whisper-cli"],
    streamNames: ["whisper-stream"],
    benchNames: ["whisper-bench"],
    supported: true
  }
};

for (const runtime of Object.values(WHISPER_RUNTIME_BY_PLATFORM)) {
  runtime.url = `${WHISPER_RUNTIME_BASE_URL}/${runtime.archiveName}`;
}

const WHISPER_RUNTIME = getWhisperRuntimeDescriptor();

const LOCAL_WHISPER_MODELS = [
  {
    id: "tiny-q5_1",
    label: "Whisper tiny q5_1",
    size: "31 MB",
    description: "Very fast, rough quality, good for quick tests",
    file: "ggml-tiny-q5_1.bin"
  },
  {
    id: "base-q5_1",
    label: "Whisper base q5_1",
    size: "57 MB",
    description: "Fast, acceptable Russian quality",
    file: "ggml-base-q5_1.bin"
  },
  {
    id: "base-q8_0",
    label: "Whisper base q8_0",
    size: "78 MB",
    description: "Fast, a bit cleaner than base q5_1",
    file: "ggml-base-q8_0.bin"
  },
  {
    id: "small-q5_1",
    label: "Whisper small q5_1",
    size: "181 MB",
    description: "Recommended balance for Russian",
    file: "ggml-small-q5_1.bin"
  },
  {
    id: "small-q8_0",
    label: "Whisper small q8_0",
    size: "252 MB",
    description: "Better small model quality, still reasonably fast",
    file: "ggml-small-q8_0.bin"
  },
  {
    id: "medium-q5_0",
    label: "Whisper medium q5_0",
    size: "514 MB",
    description: "Better quality, slower",
    file: "ggml-medium-q5_0.bin"
  },
  {
    id: "large-v3-turbo-q5_0",
    label: "Whisper large-v3 turbo q5_0",
    size: "547 MB",
    description: "High quality, still reasonably fast",
    file: "ggml-large-v3-turbo-q5_0.bin"
  },
  {
    id: "large-v3-turbo-q8_0",
    label: "Whisper large-v3 turbo q8_0",
    size: "834 MB",
    description: "Higher quality turbo, heavier and slower to load",
    file: "ggml-large-v3-turbo-q8_0.bin"
  },
  {
    id: "large-v3-turbo-russian-q5_k",
    label: "Whisper large-v3 turbo Russian q5_k",
    size: "574 MB",
    description: "Russian fine-tune, better Russian recognition, slower",
    file: "ggml-large-v3-turbo-russian-q5_k.bin",
    url: "https://huggingface.co/MECHUK/whisper-large-v3-turbo-russian/resolve/main/ggml-large-v3-turbo-russian-q5_k.bin"
  }
].map((model) => Object.assign({}, model, {
  url: model.url || `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${model.file}`
}));

let boardPanel;

function activate(context) {
  const runner = new CodexRunner(context);
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
        retainContextWhenHidden: true
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
    this.whisperLiveProcesses = new Map();
    this.whisperWarmups = new Map();
    this.whisperPersistent = null;

    this.panel.webview.options = {
      enableScripts: true
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
        await this.handleMessage(message);
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
      await this.saveState(message.state);
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
      await this.saveState(message.state);
      this.runner.run(message.chatId, message.prompt, message.sessionId, message.settings, this, message.projectPath);
      return;
    }

    if (message.type === "pickFiles") {
      await this.pickFiles(message.chatId);
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
      await this.startWhisperLive(message.chatId, message.modelId, message.captureId);
      return;
    }

    if (message.type === "stopWhisperLive") {
      this.stopWhisperLive(message.chatId, false, false, message.stopGraceMs);
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

  async openFile(filePath) {
    const normalized = resolveWorkspaceFilePath(filePath);
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
      const attachment = await createAttachmentFromUri(uri);
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
    return resolveWhisperRuntimeExecutable(this.whisperRoot(), "cli");
  }

  whisperStreamPath() {
    return resolveWhisperRuntimeExecutable(this.whisperRoot(), "stream");
  }

  whisperBenchPath() {
    return resolveWhisperRuntimeExecutable(this.whisperRoot(), "bench");
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
      await this.ensurePersistentWhisper(model.id, captureId);
      setTimeout(() => {
        this.post({
          type: "whisperPrewarmFinished",
          modelId: model.id,
          error: this.whisperPersistent && this.whisperPersistent.modelId === model.id ? "" : "Local Whisper process is not running."
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

  async ensurePersistentWhisper(modelId, captureId) {
    const model = LOCAL_WHISPER_MODELS.find((item) => item.id === modelId) || LOCAL_WHISPER_MODELS.find((item) => item.id === DEFAULT_BOARD_SETTINGS.localWhisperModel) || LOCAL_WHISPER_MODELS[0];
    const executable = this.whisperStreamPath();
    const modelPath = model ? this.whisperModelPath(model) : "";
    const normalizedCaptureId = normalizeCaptureId(captureId);

    if (this.whisperPersistent && this.whisperPersistent.modelId === model.id && this.whisperPersistent.captureId === normalizedCaptureId && !this.whisperPersistent.exited) {
      return this.whisperPersistent;
    }

    this.killPersistentWhisper();

    if (!await fileExists(executable)) {
      const installHint = WHISPER_RUNTIME.supported
        ? "Click Update/Install for whisper.cpp runtime."
        : (WHISPER_RUNTIME.reason || "Automatic runtime install is not available on this platform.");
      throw new Error(`whisper-stream is not installed. ${installHint}`);
    }
    if (!modelPath || !await fileExists(modelPath)) {
      throw new Error("Selected Whisper model is not installed.");
    }

    const recordDir = path.join(this.whisperRoot(), "recordings", `persistent-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.promises.mkdir(recordDir, { recursive: true });
    const args = [
      "-m", modelPath,
      "-l", "ru",
      "--capture", String(normalizedCaptureId),
      "--step", "4500",
      "--length", "4500",
      "--keep", "0",
      "--max-tokens", "64",
      "--vad-thold", "0.70",
      "--no-fallback"
    ];
    const child = spawnExternalProcess(executable, args, {
      cwd: recordDir,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const session = {
      child,
      modelId: model.id,
      captureId: normalizedCaptureId,
      activeChatId: "",
      stopping: false,
      lastOutputAt: Date.now(),
      stopTimer: null,
      stopDeadlineTimer: null,
      stdoutBuffer: "",
      stderrBuffer: "",
      recordDir,
      exited: false,
      disposed: false
    };
    this.whisperPersistent = session;

    child.stdout.on("data", (chunk) => {
      session.lastOutputAt = Date.now();
      session.stdoutBuffer += chunk.toString();
      const lines = session.stdoutBuffer.split(/\r?\n|\r/);
      session.stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        if (session.activeChatId) {
          this.postWhisperLiveText(session.activeChatId, line);
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      session.stderrBuffer += chunk.toString();
    });
    child.on("error", (error) => {
      const chatId = session.activeChatId;
      session.exited = true;
      if (this.whisperPersistent === session) {
        this.whisperPersistent = null;
      }
      if (chatId) {
        this.post({
          type: "whisperLiveError",
          chatId,
          error: error.message || String(error)
        });
      }
    });
    child.on("close", (code) => {
      const chatId = session.activeChatId;
      session.exited = true;
      if (session.stopTimer) {
        clearTimeout(session.stopTimer);
        session.stopTimer = null;
      }
      if (session.stopDeadlineTimer) {
        clearTimeout(session.stopDeadlineTimer);
        session.stopDeadlineTimer = null;
      }
      if (this.whisperPersistent === session) {
        this.whisperPersistent = null;
      }
      fs.promises.rm(session.recordDir, { recursive: true, force: true }).catch(() => {});
      if (chatId) {
        this.post({
          type: "whisperLiveStopped",
          chatId,
          error: session.disposed || code === 0 ? "" : cleanWhisperRuntimeError(session.stderrBuffer) || `whisper-stream exited with code ${code}.`
        });
      }
    });

    return session;
  }

  async startWhisperLive(chatId, modelId, captureId) {
    chatId = String(chatId || "");
    if (!chatId) {
      return;
    }

    try {
      const session = await this.ensurePersistentWhisper(modelId, captureId);
      if (session.activeChatId && session.activeChatId !== chatId) {
        this.post({
          type: "whisperLiveStopped",
          chatId: session.activeChatId,
          error: ""
        });
      }
      if (session.stopTimer) {
        clearTimeout(session.stopTimer);
        session.stopTimer = null;
      }
      if (session.stopDeadlineTimer) {
        clearTimeout(session.stopDeadlineTimer);
        session.stopDeadlineTimer = null;
      }
      session.activeChatId = chatId;
      session.stopping = false;
      session.lastOutputAt = Date.now();
      session.stdoutBuffer = "";
      this.post({ type: "whisperLiveStarted", chatId });
    } catch (error) {
      this.post({
        type: "whisperLiveError",
        chatId,
        error: error.message || String(error)
      });
    }
  }

  postWhisperLiveText(chatId, rawLine) {
    const text = cleanWhisperLiveOutput(rawLine);
    if (!text) {
      return;
    }

    this.post({
      type: "whisperLiveText",
      chatId,
      text
    });
  }

  async finalizeWhisperLiveRecording(session) {
    if (!session || !session.recordDir || !session.cliExecutable || !session.modelPath) {
      return "";
    }

    const audioPath = await newestWavFile(session.recordDir);
    if (!audioPath) {
      return "";
    }

    await repairWavHeader(audioPath);
    try {
      return await runWhisperCli(session.cliExecutable, session.modelPath, audioPath);
    } finally {
      fs.promises.rm(session.recordDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  stopWhisperLive(chatId, silent, immediate, stopGraceMs) {
    const session = this.whisperPersistent;
    chatId = String(chatId || "");
    if (!session || session.activeChatId !== chatId) {
      return;
    }

    if (session.stopping && !immediate) {
      return;
    }

    session.stopping = true;
    if (!silent) {
      this.post({
        type: "whisperLiveStopping",
        chatId
      });
    }

    const killSession = () => {
      if (!session.activeChatId) {
        return;
      }
      session.stopTimer = null;
      if (session.stopDeadlineTimer) {
        clearTimeout(session.stopDeadlineTimer);
        session.stopDeadlineTimer = null;
      }
      const stoppedChatId = session.activeChatId;
      session.activeChatId = "";
      session.stopping = false;
      session.stdoutBuffer = "";
      this.post({
        type: "whisperLiveStopped",
        chatId: stoppedChatId,
        error: ""
      });
    };

    if (immediate) {
      killSession();
      return;
    }

    const graceMs = normalizeWhisperStopGraceMs(stopGraceMs);
    const quietMs = Math.min(1600, Math.max(650, Math.floor(graceMs / 3)));
    const deadlineAt = Date.now() + graceMs;
    const waitForQuietOutput = () => {
      if (!session.activeChatId) {
        return;
      }

      const now = Date.now();
      const quietFor = now - Number(session.lastOutputAt || 0);
      const remaining = deadlineAt - now;
      if (remaining <= 0 || quietFor >= quietMs) {
        killSession();
        return;
      }

      session.stopTimer = setTimeout(waitForQuietOutput, Math.min(quietMs - quietFor, remaining, 250));
    };

    session.stopTimer = setTimeout(waitForQuietOutput, quietMs);
    session.stopDeadlineTimer = setTimeout(killSession, graceMs);
  }

  stopAllWhisperLive() {
    for (const chatId of this.whisperLiveProcesses.keys()) {
      this.stopWhisperLive(chatId, true, true);
    }
    this.whisperLiveProcesses.clear();
    this.killPersistentWhisper();
  }

  killPersistentWhisper() {
    const session = this.whisperPersistent;
    if (!session) {
      return;
    }
    session.disposed = true;
    session.activeChatId = "";
    if (session.stopTimer) {
      clearTimeout(session.stopTimer);
      session.stopTimer = null;
    }
    if (session.stopDeadlineTimer) {
      clearTimeout(session.stopDeadlineTimer);
      session.stopDeadlineTimer = null;
    }
    try {
      session.child.kill();
    } catch {
      // Process may already be gone.
    }
    fs.promises.rm(session.recordDir, { recursive: true, force: true }).catch(() => {});
    this.whisperPersistent = null;
  }

  stopAllWhisperWarmups() {
    for (const child of this.whisperWarmups.values()) {
      try {
        child.kill();
      } catch {
        // Warmup process may already have exited.
      }
    }
    this.whisperWarmups.clear();
  }

  async previewImage(message) {
    const requestId = String(message.requestId || "");
    const filePath = resolveWorkspaceFilePath(message.path);
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

    const initialChat = createInitialChat();
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
    this.stopAllWhisperWarmups();
    this.runner.stopAll();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

class CodexRunner {
  constructor(context) {
    this.context = context;
    this.processes = new Map();
    this.stoppedChats = new Set();
  }

  run(chatId, prompt, sessionId, settings, board, projectPath) {
    if (!chatId || !prompt || this.processes.has(chatId)) {
      return;
    }
    this.stoppedChats.delete(chatId);

    const requestedCwd = normalizeProjectPath(projectPath);
    const cwd = requestedCwd || getWorkspacePath();
    if (!cwd) {
      board.post({
        type: "chatError",
        chatId,
        error: "Open a folder or workspace before sending prompts to Codex."
      });
      return;
    }
    if (requestedCwd && !isDirectory(requestedCwd)) {
      board.post({
        type: "chatError",
        chatId,
        error: `Project folder does not exist or is not a directory: ${requestedCwd}`
      });
      return;
    }

    const cfg = vscode.workspace.getConfiguration("codexMax");
    const executable = resolveCodexExecutable(cfg.get("codexExecutable", "codex") || "codex");
    const mergedSettings = normalizeSettings(Object.assign({}, DEFAULT_CHAT_SETTINGS, settings || {}));
    if (!mergedSettings.model) {
      mergedSettings.model = cfg.get("model", "");
    }
    if (!settings || !settings.sandbox) {
      mergedSettings.sandbox = cfg.get("defaultSandbox", "read-only");
    }
    const args = buildCodexArgs({
      sessionId,
      settings: mergedSettings,
      cwd
    });

    board.post({ type: "chatStatus", chatId, status: "running" });
    board.post({
      type: "chatEvent",
      chatId,
      event: {
        kind: "thread",
        status: "running",
        title: sessionId ? "Resuming Codex thread" : "Starting Codex thread",
        detail: sessionId ? `Thread: ${sessionId}` : "A new Codex CLI thread is being started for this chat card."
      }
    });

    const child = spawnExternalProcess(executable, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.processes.set(chatId, child);

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let finalMessageSeen = false;
    let failedToStart = false;
    const fileSnapshots = new Map();
    captureFileSnapshotsFromText(prompt, cwd, fileSnapshots);

    const recordFileChange = (item) => {
      const summary = fileChangeSummary(augmentFileChangeWithDiff(item, fileSnapshots));
      postChatEvent(board, chatId, {
        eventId: eventIdentity(item, "files", summary.title),
        kind: "files",
        status: "done",
        title: "Codex updated files",
        detail: summary.detail,
        text: summary.title,
        changes: summary.changes,
        raw: summary.raw
      });
    };

    const captureSnapshotsFromItem = (item) => {
      captureFileSnapshotsFromText(compactJson(item), cwd, fileSnapshots);
    };

    const markFinalAndPostChanges = () => {
      finalMessageSeen = true;
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          handleJsonLine(line, chatId, board, markFinalAndPostChanges, recordFileChange, captureSnapshotsFromItem);
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString("utf8");
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() || "";

      for (const line of lines) {
        const text = line.trim();
        if (text) {
          board.post({
            type: "chatEvent",
            chatId,
            event: {
              kind: "log",
              status: "info",
              title: "Codex log",
              detail: text
            }
          });
        }
      }
    });

    child.on("error", (error) => {
      failedToStart = true;
      this.processes.delete(chatId);
      board.post({ type: "chatStatus", chatId, status: "error" });
      board.post({
        type: "chatError",
        chatId,
        error: `Failed to start ${executable.command}: ${error.message}`
      });
    });

    child.on("close", (code) => {
      this.processes.delete(chatId);
      const refreshLimits = () => {
        if (board && typeof board.refreshRateLimits === "function") {
          board.refreshRateLimits(true);
        }
      };

      if (failedToStart) {
        return;
      }

      if (this.stoppedChats.delete(chatId)) {
        board.post({ type: "chatStatus", chatId, status: "idle" });
        refreshLimits();
        return;
      }

      if (stdoutBuffer.trim()) {
        handleJsonLine(stdoutBuffer.trim(), chatId, board, markFinalAndPostChanges, recordFileChange, captureSnapshotsFromItem);
      }

      if (code === 0) {
        if (!finalMessageSeen) {
          board.post({
            type: "chatEvent",
            chatId,
            event: {
              kind: "turn",
              status: "done",
              title: "Codex finished without a final assistant message",
              detail: ""
            }
          });
        }
        board.post({ type: "chatStatus", chatId, status: "idle" });
        refreshLimits();
        return;
      }

      board.post({ type: "chatStatus", chatId, status: "error" });
      board.post({
        type: "chatError",
        chatId,
        error: `Codex exited with code ${code}.`
      });
      refreshLimits();
    });

    child.stdin.end(prompt);
  }

  stop(chatId) {
    const child = this.processes.get(chatId);
    if (!child) {
      return;
    }

    this.stoppedChats.add(chatId);
    child.kill();
    this.processes.delete(chatId);
  }

  stopAll() {
    for (const chatId of this.processes.keys()) {
      this.stop(chatId);
    }
  }
}

function buildCodexArgs({ sessionId, settings, cwd }) {
  const args = ["exec"];
  const model = settings.model;

  if (sessionId) {
    args.push("resume", "--json", "--skip-git-repo-check");
    if (model) {
      args.push("--model", model);
    }
    pushConfigOverrides(args, settings, true);
    args.push(sessionId, "-");
    return args;
  }

  args.push("--json", "--skip-git-repo-check", "--cd", cwd);

  if (model) {
    args.push("--model", model);
  }

  if (settings.sandbox) {
    args.push("--sandbox", settings.sandbox);
  }

  pushConfigOverrides(args, settings, false);
  args.push("-");
  return args;
}

function pushConfigOverrides(args, settings, isResume) {
  if (settings.reasoning) {
    args.push("-c", `model_reasoning_effort=${tomlString(settings.reasoning)}`);
  }

  if (settings.verbosity) {
    args.push("-c", `model_verbosity=${tomlString(settings.verbosity)}`);
  }

  if (settings.webSearch) {
    args.push("-c", `web_search=${tomlString(settings.webSearch)}`);
  }

  if (isResume && settings.sandbox) {
    args.push("-c", `sandbox_mode=${tomlString(settings.sandbox)}`);
  }
}

function normalizeSettings(settings) {
  const next = Object.assign({}, DEFAULT_CHAT_SETTINGS, settings || {});
  const allowedReasoning = new Set(["minimal", "low", "medium", "high", "xhigh"]);
  const allowedVerbosity = new Set(["low", "medium", "high"]);
  const allowedSandbox = new Set(["read-only", "workspace-write", "danger-full-access"]);
  const allowedWebSearch = new Set(["disabled", "cached", "live"]);

  return {
    model: normalizeModelId(next.model) || DEFAULT_CHAT_SETTINGS.model,
    reasoning: allowedReasoning.has(next.reasoning) ? next.reasoning : DEFAULT_CHAT_SETTINGS.reasoning,
    verbosity: allowedVerbosity.has(next.verbosity) ? next.verbosity : DEFAULT_CHAT_SETTINGS.verbosity,
    sandbox: allowedSandbox.has(next.sandbox) ? next.sandbox : DEFAULT_CHAT_SETTINGS.sandbox,
    webSearch: allowedWebSearch.has(next.webSearch) ? next.webSearch : DEFAULT_CHAT_SETTINGS.webSearch
  };
}

function trimStateForStorage(state) {
  const workspaces = Array.isArray(state && state.workspaces)
    ? state.workspaces.map(trimWorkspaceForStorage).filter(Boolean)
    : [];
  const activeWorkspaceId = String(state && state.activeWorkspaceId || (workspaces[0] && workspaces[0].id) || "");
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) || workspaces[0] || null;
  const boardSettings = normalizeBoardSettings(state && state.boardSettings || activeWorkspace && activeWorkspace.boardSettings || {});
  const chats = Array.isArray(state && state.chats)
    ? state.chats.map(trimChatForStorage)
    : (activeWorkspace ? activeWorkspace.chats : []);

  return {
    chats,
    selectedChatId: state && state.selectedChatId ? String(state.selectedChatId) : (activeWorkspace && activeWorkspace.selectedChatId || null),
    activeWorkspaceId,
    workspaces,
    accountRateLimits: normalizeRateLimits(state && state.accountRateLimits),
    boardSettings
  };
}

function dateStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").replace(/T/, "_").replace(/Z$/, "Z");
}

function safeFileName(value) {
  return String(value || "preset").trim().replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-").replace(/\s+/g, "-").replace(/^-+|-+$/g, "") || "preset";
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

function normalizeModelId(value) {
  const model = typeof value === "string" ? value.trim() : "";
  const aliases = {
    "5.5": "gpt-5.5",
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3"
  };

  return aliases[model] || model;
}

function normalizeBoardSettings(settings) {
  const next = Object.assign({}, DEFAULT_BOARD_SETTINGS, settings || {});
  const chatBackground = String(next.chatBackground || "").toLowerCase() === "#212121"
    ? DEFAULT_BOARD_SETTINGS.chatBackground
    : next.chatBackground;
  const allowedVoiceShortcuts = new Set(["off", "alt-v", "ctrl-shift-v", "ctrl-m"]);
  const allowedSpeechToText = new Set(["off", "browser", "local-whisper"]);
  const allowedWhisperModels = new Set(LOCAL_WHISPER_MODELS.map((model) => model.id));
  const captureId = normalizeCaptureId(next.localWhisperCaptureId);

  return {
    chatsPerRow: clampInt(next.chatsPerRow, 1, 12),
    chatsPerColumn: clampInt(next.chatsPerColumn, 1, 6),
    maxChatHeight: normalizeMaxChatHeight(next.maxChatHeight),
    chatBackground: normalizeHexColor(chatBackground, DEFAULT_BOARD_SETTINGS.chatBackground),
    sendWithCtrlEnter: Boolean(next.sendWithCtrlEnter),
    autoScroll: next.autoScroll !== false,
    voiceShortcut: allowedVoiceShortcuts.has(next.voiceShortcut) ? next.voiceShortcut : DEFAULT_BOARD_SETTINGS.voiceShortcut,
    speechToText: allowedSpeechToText.has(next.speechToText) ? next.speechToText : DEFAULT_BOARD_SETTINGS.speechToText,
    localWhisperModel: allowedWhisperModels.has(next.localWhisperModel) ? next.localWhisperModel : DEFAULT_BOARD_SETTINGS.localWhisperModel,
    localWhisperCaptureId: Math.max(-1, Math.min(32, captureId)),
    localWhisperStopGraceMs: normalizeWhisperStopGraceMs(next.localWhisperStopGraceMs),
    currentWorkspacePath: normalizeProjectPath(next.currentWorkspacePath || "")
  };
}

function normalizeHexColor(value, fallback) {
  const text = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) {
    return text.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(text)) {
    return `#${text.toLowerCase()}`;
  }
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return "#" + text.slice(1).split("").map((char) => char + char).join("").toLowerCase();
  }

  return fallback;
}

function normalizeProjectPath(value) {
  const text = String(value || "").trim();
  return text ? path.resolve(text) : "";
}

function projectFolderLabel(value) {
  const normalized = normalizeProjectPath(value);
  return normalized ? path.basename(normalized) : "";
}

function titleWithProjectLabel(title, projectPath) {
  const baseTitle = String(title || "Codex chat").replace(/\s*\[[^\[\]]+\]\s*$/, "").trim() || "Codex chat";
  const label = projectFolderLabel(projectPath);
  return label ? `${baseTitle} [${label}]` : baseTitle;
}

function trimChatForStorage(chat) {
  const source = chat || {};
  return {
    id: String(source.id || ""),
    title: String(source.title || "Codex chat"),
    sessionId: source.sessionId ? String(source.sessionId) : null,
    status: source.status === "running" ? "idle" : String(source.status || "idle"),
    note: String(source.note || ""),
    projectPath: String(source.projectPath || ""),
    draftPrompt: String(source.draftPrompt || "").slice(0, MAX_ATTACHMENT_BYTES),
    lastOpenedAt: Number(source.lastOpenedAt || 0),
    createdAt: Number(source.createdAt || 0),
    updatedAt: Number(source.updatedAt || source.lastOpenedAt || 0),
    runStartedAt: Number(source.runStartedAt || 0),
    runFinishedAt: Number(source.runFinishedAt || 0),
    isThinking: Boolean(source.isThinking),
    settings: normalizeSettings(source.settings),
    pendingAttachments: Array.isArray(source.pendingAttachments)
      ? source.pendingAttachments.slice(-20).map((item) => ({
          id: String(item.id || ""),
          name: String(item.name || "file"),
          path: String(item.path || ""),
          relativePath: String(item.relativePath || ""),
          size: Number(item.size || 0),
          isText: Boolean(item.isText),
          truncated: Boolean(item.truncated),
          content: String(item.content || "").slice(0, MAX_ATTACHMENT_BYTES)
        }))
      : [],
    messages: Array.isArray(source.messages)
      ? source.messages.slice(-80).map((item) => ({
          role: String(item.role || "assistant"),
          text: String(item.text || ""),
          at: Number(item.at || Date.now()),
          eventId: item.eventId ? String(item.eventId) : "",
          kind: item.kind ? String(item.kind) : "",
          status: item.status ? String(item.status) : "",
          title: item.title ? String(item.title) : "",
          detail: item.detail ? String(item.detail) : "",
          runStartedAt: Number(item.runStartedAt || 0),
          runFinishedAt: Number(item.runFinishedAt || 0),
          raw: item.raw ? String(item.raw).slice(0, MAX_ATTACHMENT_BYTES) : "",
          changes: Array.isArray(item.changes) ? item.changes.slice(0, 20).map((change) => ({
            path: String(change.path || ""),
            kind: String(change.kind || ""),
            additions: Number.isFinite(Number(change.additions)) ? Number(change.additions) : null,
            deletions: Number.isFinite(Number(change.deletions)) ? Number(change.deletions) : null,
            diff: String(change.diff || "").slice(0, MAX_ATTACHMENT_BYTES)
          })) : []
        }))
      : []
  };
}

function trimWorkspaceForStorage(workspace) {
  if (!workspace || typeof workspace !== "object") {
    return null;
  }

  const boardSettings = normalizeBoardSettings(workspace.boardSettings || {});
  const pathValue = String(workspace.path || boardSettings.currentWorkspacePath || "");
  return {
    id: String(workspace.id || ""),
    name: String(workspace.name || projectFolderLabel(pathValue) || "Workspace"),
    path: pathValue,
    selectedChatId: workspace.selectedChatId ? String(workspace.selectedChatId) : null,
    boardSettings,
    chats: Array.isArray(workspace.chats) ? workspace.chats.map(trimChatForStorage) : []
  };
}

function isDirectory(value) {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function normalizeRateLimits(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function normalizeMaxChatHeight(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return clampInt(parsed, 280, 2400);
}

function normalizeWhisperStopGraceMs(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_WHISPER_LIVE_STOP_GRACE_MS;
  }

  return clampInt(parsed, 100, 10000);
}

function clampInt(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return min;
  }

  return Math.min(max, Math.max(min, parsed));
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function resolveCodexExecutable(configured) {
  const wantsAuto = !configured || configured === "codex";
  const configuredPath = wantsAuto ? "" : stripQuotes(configured);

  if (configuredPath) {
    return {
      command: configuredPath,
      shell: shouldUseShell(configuredPath)
    };
  }

  for (const candidate of getCodexCandidates()) {
    if (candidate && fs.existsSync(candidate)) {
      return {
        command: candidate,
        shell: shouldUseShell(candidate)
      };
    }
  }

  return {
    command: "codex",
    shell: process.platform === "win32"
  };
}

function getCodexCandidates() {
  const candidates = [];

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) {
      candidates.push(path.join(appData, "npm", "codex.cmd"));
      candidates.push(path.join(appData, "npm", "codex"));
    }

    candidates.push(...getBundledCodexCandidates());
  } else {
    const home = os.homedir();
    candidates.push(path.join(home, ".npm-global", "bin", "codex"));
    candidates.push("/usr/local/bin/codex");
    candidates.push("/opt/homebrew/bin/codex");
  }

  return candidates;
}

function getBundledCodexCandidates() {
  const extensionRoots = [];
  const home = os.homedir();

  if (home) {
    extensionRoots.push(path.join(home, ".vscode", "extensions"));
    extensionRoots.push(path.join(home, ".cursor", "extensions"));
    extensionRoots.push(path.join(home, ".windsurf", "extensions"));
  }

  const candidates = [];

  for (const root of extensionRoots) {
    if (!root || !fs.existsSync(root)) {
      continue;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("openai.chatgpt-")) {
        continue;
      }

      candidates.push(path.join(root, entry.name, "bin", "windows-x86_64", "codex.exe"));
    }
  }

  return candidates;
}

function getSpawnEnv() {
  const env = Object.assign({}, process.env);

  if (process.platform !== "win32") {
    return env;
  }

  const appData = env.APPDATA;
  if (!appData) {
    return env;
  }

  const npmBin = path.join(appData, "npm");
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "Path";
  const currentPath = env[pathKey] || "";

  if (!currentPath.toLowerCase().split(";").includes(npmBin.toLowerCase())) {
    env[pathKey] = `${npmBin};${currentPath}`;
  }

  return env;
}

function shouldUseShell(command) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

function currentPlatformKey() {
  return `${process.platform}-${process.arch}`;
}

function platformDisplayName() {
  if (process.platform === "win32") {
    return `Windows ${process.arch}`;
  }
  if (process.platform === "darwin") {
    return `macOS ${process.arch}`;
  }
  if (process.platform === "linux") {
    return `Linux ${process.arch}`;
  }
  return `${process.platform} ${process.arch}`;
}

function getWhisperRuntimeDescriptor() {
  const platformKey = currentPlatformKey();
  const runtime = WHISPER_RUNTIME_BY_PLATFORM[platformKey];
  if (runtime) {
    return Object.assign({}, runtime, {
      platformKey,
      supported: true
    });
  }

  const isMac = process.platform === "darwin";
  return {
    id: `whisper.cpp-${platformKey}`,
    label: `whisper.cpp ${platformDisplayName()}`,
    platform: platformDisplayName(),
    platformKey,
    archiveName: "",
    archiveType: "",
    url: "",
    executable: ["runtime", process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli"],
    streamExecutable: ["runtime", process.platform === "win32" ? "whisper-stream.exe" : "whisper-stream"],
    benchExecutable: ["runtime", process.platform === "win32" ? "whisper-bench.exe" : "whisper-bench"],
    cliNames: [process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli"],
    streamNames: [process.platform === "win32" ? "whisper-stream.exe" : "whisper-stream"],
    benchNames: [process.platform === "win32" ? "whisper-bench.exe" : "whisper-bench"],
    supported: false,
    reason: isMac
      ? "Automatic whisper.cpp CLI runtime install is not available for macOS yet; the upstream release provides an xcframework, not the CLI binaries Codex Max needs."
      : `Automatic whisper.cpp runtime install is not available for ${platformDisplayName()} yet.`
  };
}

function resolveWhisperRuntimeExecutable(root, kind) {
  const runtimeDir = path.join(root, "runtime");
  const fallbackKey = kind === "stream" ? "streamExecutable" : kind === "bench" ? "benchExecutable" : "executable";
  const namesKey = kind === "stream" ? "streamNames" : kind === "bench" ? "benchNames" : "cliNames";
  const fallback = path.join(root, ...(WHISPER_RUNTIME[fallbackKey] || WHISPER_RUNTIME.executable || []));
  const found = findFirstExistingFile(runtimeDir, WHISPER_RUNTIME[namesKey] || []);
  return found || fallback;
}

function findFirstExistingFile(root, names) {
  if (!root || !fs.existsSync(root) || !Array.isArray(names) || !names.length) {
    return "";
  }

  const wanted = new Set(names.map((name) => String(name).toLowerCase()));
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    if (!current || current.depth > 5) {
      continue;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isFile() && wanted.has(entry.name.toLowerCase())) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        queue.push({ dir: fullPath, depth: current.depth + 1 });
      }
    }
  }

  return "";
}

function normalizeExecutable(value) {
  if (value && typeof value === "object") {
    return {
      command: String(value.command || ""),
      shell: typeof value.shell === "boolean" ? value.shell : shouldUseShell(value.command || "")
    };
  }

  const command = String(value || "");
  return {
    command,
    shell: shouldUseShell(command)
  };
}

function spawnExternalProcess(executable, args, options) {
  const normalized = normalizeExecutable(executable);
  const spawnOptions = options || {};
  const env = Object.assign({}, getSpawnEnv(), spawnOptions.env || {});
  return cp.spawn(normalized.command, Array.isArray(args) ? args : [], {
    cwd: spawnOptions.cwd,
    shell: typeof spawnOptions.shell === "boolean" ? spawnOptions.shell : normalized.shell,
    windowsHide: true,
    stdio: spawnOptions.stdio || ["ignore", "pipe", "pipe"],
    env
  });
}

function runExternalCommand(executable, args, options) {
  const runOptions = options || {};
  const normalized = normalizeExecutable(executable);
  const commandArgs = Array.isArray(args) ? args : [];
  const timeoutMs = Number.isFinite(Number(runOptions.timeoutMs)) ? Number(runOptions.timeoutMs) : 5000;

  return new Promise((resolve, reject) => {
    const child = spawnExternalProcess(normalized, commandArgs, {
      cwd: runOptions.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      finish(new Error(`Timed out running ${normalized.command} ${commandArgs.join(" ")}.`));
    }, timeoutMs);

    const finish = (error, result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        try {
          child.kill();
        } catch {
          // Process may have already exited.
        }
        reject(error);
        return;
      }
      resolve(result);
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      finish(error);
    });
    child.on("close", (code, signal) => {
      finish(null, { code, signal, stdout, stderr, timedOut });
    });
  });
}

function stripQuotes(value) {
  return String(value).replace(/^["']|["']$/g, "");
}

function normalizeCaptureId(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : -1;
}

async function fileExists(filePath) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function downloadFile(url, destination, onProgress, redirectCount) {
  const redirects = Number(redirectCount || 0);
  if (redirects > 5) {
    return Promise.reject(new Error("Too many redirects while downloading."));
  }

  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        "User-Agent": "Codex-Max"
      }
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, url).toString();
        downloadFile(nextUrl, destination, onProgress, redirects + 1).then(resolve, reject);
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${status}.`));
        return;
      }

      const total = Number(response.headers["content-length"] || 0);
      let received = 0;
      const file = fs.createWriteStream(destination);
      response.on("data", (chunk) => {
        received += chunk.length;
        if (total && typeof onProgress === "function") {
          onProgress(Math.max(0, Math.min(100, Math.round((received / total) * 100))));
        }
      });
      response.pipe(file);
      file.on("finish", () => {
        file.close(() => {
          if (typeof onProgress === "function") {
            onProgress(100);
          }
          resolve();
        });
      });
      file.on("error", reject);
    });

    request.on("error", reject);
  });
}

function extractRuntimeArchive(archivePath, destination, runtime) {
  if (!runtime || !runtime.supported) {
    return Promise.reject(new Error(runtime && runtime.reason ? runtime.reason : "This whisper.cpp runtime is not supported on the current platform."));
  }
  if (runtime.archiveType === "zip") {
    return extractZipArchive(archivePath, destination);
  }
  if (runtime.archiveType === "tar.gz") {
    return extractTarGzArchive(archivePath, destination);
  }
  return Promise.reject(new Error(`Unsupported whisper.cpp archive type: ${runtime.archiveType || "unknown"}.`));
}

function extractZipArchive(zipPath, destination) {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      reject(new Error("Zip extraction for whisper.cpp runtime is currently implemented through Windows PowerShell."));
      return;
    }

    const script = `Expand-Archive -LiteralPath ${powershellSingleQuote(zipPath)} -DestinationPath ${powershellSingleQuote(destination)} -Force`;
    const child = spawnExternalProcess("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `Expand-Archive failed with exit code ${code}.`));
      }
    });
  });
}

function extractTarGzArchive(archivePath, destination) {
  return runExternalCommand("tar", ["-xzf", archivePath, "-C", destination], {
    timeoutMs: 120000
  }).then((result) => {
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `tar exited with code ${result.code}.`);
    }
  });
}

function powershellSingleQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function listCaptureDevices() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve(defaultCaptureDevices());
      return;
    }

    const script = [
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
      "$OutputEncoding=[System.Text.Encoding]::UTF8",
      "$devices = Get-PnpDevice -Class AudioEndpoint -Status OK -ErrorAction SilentlyContinue |",
      "  Where-Object { $_.InstanceId -like 'SWD\\MMDEVAPI\\{0.0.1*' } |",
      "  Select-Object -ExpandProperty FriendlyName",
      "if (-not $devices) {",
      "  $devices = Get-CimInstance Win32_SoundDevice -ErrorAction SilentlyContinue |",
      "    Where-Object { $_.Status -eq 'OK' -and ($_.Name -match 'microphone|микрофон|audio') } |",
      "    Select-Object -ExpandProperty Name",
      "}",
      "$index = 0",
      "$items = foreach ($name in $devices) {",
      "  [pscustomobject]@{ id = $index; label = $name }",
      "  $index += 1",
      "}",
      "$items | ConvertTo-Json -Compress"
    ].join("; ");

    const child = spawnExternalProcess("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", () => {
      resolve(defaultCaptureDevices());
    });
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout.trim() || "[]");
        const items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
        const devices = items
          .map((item) => ({
            id: normalizeCaptureId(item.id),
            label: String(item.label || "").trim()
          }))
          .filter((item) => item.id >= 0 && item.label);
        resolve(defaultCaptureDevices().concat(devices));
      } catch {
        const fallback = parseCaptureDevicesFromText(stdout + "\n" + stderr);
        resolve(defaultCaptureDevices().concat(fallback));
      }
    });
  });
}

function parseCaptureDevicesFromText(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && /microphone|микрофон/i.test(line))
    .map((label, index) => ({ id: index, label }));
}

function defaultCaptureDevices() {
  return [{
    id: -1,
    label: process.platform === "win32" ? "Default Windows microphone" : "Default microphone",
    isDefault: true
  }];
}

function runWhisperCli(executable, modelPath, audioPath) {
  return new Promise((resolve, reject) => {
    const child = spawnExternalProcess(executable, ["-m", modelPath, "-f", audioPath, "-l", "ru", "-nt", "-nf"], {
      cwd: path.dirname(executable),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `whisper-cli exited with code ${code}.`));
        return;
      }

      const text = cleanWhisperOutput(stdout);
      if (!text) {
        reject(new Error("Whisper returned an empty transcript."));
        return;
      }
      resolve(text);
    });
  });
}

async function newestWavFile(dirPath) {
  let entries = [];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return "";
  }

  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.wav$/i.test(entry.name)) {
      continue;
    }
    const filePath = path.join(dirPath, entry.name);
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > 44) {
        files.push({ filePath, mtimeMs: stat.mtimeMs, size: stat.size });
      }
    } catch {
      // Ignore files that disappeared while scanning.
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs || b.size - a.size);
  return files.length ? files[0].filePath : "";
}

async function repairWavHeader(filePath) {
  const handle = await fs.promises.open(filePath, "r+");
  try {
    const stat = await handle.stat();
    if (stat.size < 44) {
      return;
    }

    const header = Buffer.alloc(44);
    await handle.read(header, 0, 44, 0);
    if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE") {
      return;
    }

    header.writeUInt32LE(Math.max(0, stat.size - 8), 4);
    const dataOffset = findWavDataSizeOffset(header);
    if (dataOffset >= 0) {
      header.writeUInt32LE(Math.max(0, stat.size - dataOffset - 4), dataOffset);
    }
    await handle.write(header, 0, 44, 0);
  } finally {
    await handle.close();
  }
}

function findWavDataSizeOffset(header) {
  for (let index = 12; index <= 36; index += 1) {
    if (header.toString("ascii", index, index + 4) === "data") {
      return index + 4;
    }
  }
  return 40;
}

function cleanWhisperOutput(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/, "").trim())
    .map(stripWhisperSubtitleCredits)
    .filter((line) => line && !/^whisper_/i.test(line) && !/^system_info:/i.test(line) && !isWhisperSubtitleCredit(line))
    .join(" ")
    .replace(whisperSubtitleCreditSuffixPattern(), "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanWhisperLiveOutput(value) {
  const text = stripWhisperSubtitleCredits(stripAnsi(String(value || ""))
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/^\s*\[[^\]]+\]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim());
  if (!text) {
    return "";
  }
  if (/^(whisper_|main:|init:|system_info:|load_backend:|ggml_|warning:|usage:)/i.test(text)) {
    return "";
  }
  if (/^### Transcription/i.test(text)) {
    return "";
  }
  if (isWhisperSubtitleCredit(text)) {
    return "";
  }
  return text;
}

function isWhisperSubtitleCredit(value) {
  const text = String(value || "").toLowerCase();
  if (!text) {
    return false;
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  const creditPatterns = [
    /редактор(?:ы)?\s+субтитров/,
    /корректор\s+[а-яa-z.]+/,
    /субтитр(?:ы|ов).{0,24}(?:редактор|корректор|сделал|сделала|создал|создала)/,
    /(?:редакция|тайминг|перевод).{0,24}субтитр/,
    /subtitles?\s+(?:by|edited|editor|correction)/,
    /subtitle\s+(?:editor|correction|corrections)/
  ];
  const matches = creditPatterns.filter((pattern) => pattern.test(normalized)).length;
  return matches > 0 && normalized.length < 220;
}

function isWhisperSubtitleCredit(value) {
  const normalized = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }

  return whisperSubtitleCreditPatterns().some((pattern) => pattern.test(normalized)) && normalized.length < 260;
}

function stripWhisperSubtitleCredits(value) {
  return String(value || "")
    .replace(whisperSubtitleCreditInfixPattern(), " ")
    .replace(whisperSubtitleCreditSuffixPattern(), "")
    .replace(/\s+/g, " ")
    .trim();
}

function whisperSubtitleCreditPatterns() {
  return [
    /\u0441\u0443\u0431\u0442\u0438\u0442\u0440(?:\u044b|\u043e\u0432)\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432/u,
    /\u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440(?:\u044b)?\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432/u,
    /\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043e\u0440\s+[\u0430-\u044fa-z.]+/u,
    /\u0441\u0443\u0431\u0442\u0438\u0442\u0440(?:\u044b|\u043e\u0432).{0,32}(?:\u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440|\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043e\u0440|\u0441\u0434\u0435\u043b\u0430\u043b|\u0441\u0434\u0435\u043b\u0430\u043b\u0430|\u0441\u043e\u0437\u0434\u0430\u043b|\u0441\u043e\u0437\u0434\u0430\u043b\u0430)/u,
    /(?:\u0440\u0435\u0434\u0430\u043a\u0446\u0438\u044f|\u0442\u0430\u0439\u043c\u0438\u043d\u0433|\u043f\u0435\u0440\u0435\u0432\u043e\u0434).{0,32}\u0441\u0443\u0431\u0442\u0438\u0442\u0440/u,
    /subtitles?\s+(?:by|edited|editor|correction)/,
    /subtitle\s+(?:editor|correction|corrections)/
  ];
}

function whisperSubtitleCreditSuffixPattern() {
  return /\s*(?:\u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440(?:\u044b)?\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432[\s\S]*|\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043e\u0440\s+[\u0410-\u044f\u0401\u0451A-Za-z.\-\s]+|subtitles?\s+(?:by|edited|editor|correction)[\s\S]*|subtitle\s+(?:editor|correction|corrections)[\s\S]*)$/iu;
}

function whisperSubtitleCreditInfixPattern() {
  return /(?:\u0441\u0443\u0431\u0442\u0438\u0442\u0440(?:\u044b|\u043e\u0432)\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432\s+[\u0410-\u044f\u0401\u0451A-Za-z.]+|\u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440(?:\u044b)?\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432\s+[\u0410-\u044f\u0401\u0451A-Za-z.\-\s]{1,48}|\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043e\u0440\s+[\u0410-\u044f\u0401\u0451A-Za-z.]+|subtitles?\s+(?:by|edited|editor|correction)\s+[A-Za-z.\-\s]{1,48}|subtitle\s+(?:editor|correction|corrections)\s+[A-Za-z.\-\s]{1,48})/giu;
}

function cleanWhisperRuntimeError(value) {
  return stripAnsi(String(value || ""))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^load_backend:/i.test(line) && !/^ggml_/i.test(line))
    .slice(-4)
    .join(" ");
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function requestAppServer(executable, method, params) {
  return new Promise((resolve, reject) => {
    const child = spawnExternalProcess(executable, ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;
    let initialized = false;
    const timeout = setTimeout(() => {
      finish(new Error(`Timed out waiting for ${method}.`));
    }, 10000);

    const finish = (error, result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.kill();
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    };

    const send = (id, requestMethod, requestParams) => {
      child.stdin.write(JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: requestMethod,
        params: requestParams || {}
      }) + "\n");
    };

    const handleLine = (line) => {
      if (!line.trim()) {
        return;
      }

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }

      if (message.id === 1 && message.result && !initialized) {
        initialized = true;
        send(2, method, params);
        return;
      }

      if (message.id === 2) {
        if (message.error) {
          finish(new Error(message.error.message || JSON.stringify(message.error)));
          return;
        }
        finish(null, message.result);
      }
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        handleLine(line);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      finish(error);
    });

    child.on("close", () => {
      if (!settled) {
        finish(new Error(stderrBuffer.trim() || `${method} did not return a response.`));
      }
    });

    send(1, "initialize", {
      clientInfo: {
        name: "codex-max",
        version: "local"
      },
      capabilities: {}
    });
  });
}

function runCodexCommand(executable, args, timeoutMs) {
  return runExternalCommand(executable, args, {
    timeoutMs: timeoutMs || 5000
  });
}

function quoteShellArg(value) {
  const text = String(value || "");
  if (!text) {
    return "\"\"";
  }
  if (/^[A-Za-z0-9_./:-]+$/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '\\"')}"`;
}

function normalizeIncomingFilePath(value) {
  let filePath = String(value || "").trim();
  if (!filePath) {
    return "";
  }

  filePath = filePath.replace(/^<|>$/g, "");
  filePath = decodeURIComponent(filePath);
  filePath = filePath.replace(/\\"/g, '"').replace(/\\'/g, "'");
  if (/^[A-Za-z]:\\\\/.test(filePath)) {
    filePath = filePath.replace(/\\\\/g, "\\");
  }

  if (/^\/[A-Za-z]:/.test(filePath)) {
    filePath = filePath.slice(1);
  }

  return filePath;
}

function resolveWorkspaceFilePath(value) {
  const normalized = normalizeIncomingFilePath(value).replace(/[?#].*$/, "");
  if (!normalized) {
    return "";
  }

  if (path.isAbsolute(normalized)) {
    return normalized;
  }

  const workspacePath = getWorkspacePath();
  return workspacePath ? path.join(workspacePath, normalized) : normalized;
}

function isImagePath(value) {
  return IMAGE_EXTENSIONS.has(path.extname(String(value || "")).toLowerCase());
}

function imageMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".svg") {
    return "image/svg+xml";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  if (ext === ".gif") {
    return "image/gif";
  }
  if (ext === ".bmp") {
    return "image/bmp";
  }

  return "image/png";
}

async function createAttachmentFromUri(uri) {
  if (!uri || uri.scheme !== "file") {
    return null;
  }

  const filePath = uri.fsPath;
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return null;
  }

  if (!stat.isFile()) {
    return null;
  }

  const preview = await readFilePreview(filePath, stat.size);
  const workspacePath = getWorkspacePath();
  const relativePath = workspacePath ? path.relative(workspacePath, filePath) : "";
  const insideWorkspace = relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);

  return {
    id: `file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    name: path.basename(filePath),
    path: filePath,
    relativePath: insideWorkspace ? relativePath.replace(/\\/g, "/") : "",
    size: stat.size,
    isText: preview.isText,
    truncated: preview.truncated,
    content: preview.content
  };
}

async function readFilePreview(filePath, size) {
  const limit = MAX_ATTACHMENT_BYTES;
  const bytesToRead = Math.min(Number(size || 0), limit + 1);

  if (bytesToRead <= 0) {
    return {
      isText: true,
      truncated: false,
      content: ""
    };
  }

  let handle;
  try {
    handle = await fs.promises.open(filePath, "r");
    const buffer = Buffer.alloc(bytesToRead);
    const result = await handle.read(buffer, 0, bytesToRead, 0);
    const chunk = buffer.subarray(0, Math.min(result.bytesRead, limit));

    if (chunk.includes(0)) {
      return {
        isText: false,
        truncated: result.bytesRead > limit || size > limit,
        content: ""
      };
    }

    const content = chunk.toString("utf8");
    const replacementCount = (content.match(/\uFFFD/g) || []).length;
    const looksBinary = replacementCount > Math.max(3, content.length * 0.01);

    return {
      isText: !looksBinary,
      truncated: result.bytesRead > limit || size > limit,
      content: looksBinary ? "" : content
    };
  } catch {
    return {
      isText: false,
      truncated: false,
      content: ""
    };
  } finally {
    if (handle) {
      await handle.close();
    }
  }
}

function handleJsonLine(line, chatId, board, markFinalMessageSeen, recordFileChange, captureSnapshotsFromItem) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    postChatEvent(board, chatId, {
      kind: "raw",
      status: "info",
      title: "Raw Codex event",
      detail: line
    });
    return;
  }

  if (event.type === "thread.started" && event.thread_id) {
    board.post({ type: "chatSession", chatId, sessionId: event.thread_id });
    return;
  }

  const eventType = String(event.type || event.kind || event.event || "");
  const normalizedEventType = eventType.replace(/[._/-]/g, "").toLowerCase();
  if (
    normalizedEventType === "accountratelimitsupdated" ||
    (/ratelimit/.test(normalizedEventType) && /account|usage|balance|limit/.test(normalizedEventType))
  ) {
    board.post({
      type: "accountRateLimits",
      rateLimits: rateLimitPayloadFromEvent(event)
    });
    return;
  }

  if (event.type === "turn.started") {
    board.post({ type: "chatThinking", chatId, thinking: true });
    return;
  }

  if (event.type === "turn.failed") {
    board.post({
      type: "chatError",
      chatId,
      error: event.error ? String(event.error) : "Codex turn failed."
    });
    return;
  }

  if (event.type === "error") {
    board.post({
      type: "chatError",
      chatId,
      error: event.message ? String(event.message) : "Codex reported an error."
    });
    return;
  }

  if (event.type === "item.started" && event.item) {
    board.post({ type: "chatThinking", chatId, thinking: false });
    if (typeof captureSnapshotsFromItem === "function") {
      captureSnapshotsFromItem(event.item);
    }
    if (event.item.type === "file_change") {
      const summary = fileChangeSummary(event.item);
      postChatEvent(board, chatId, {
        eventId: eventIdentity(event.item, "files", summary.title),
        kind: "files",
        status: "running",
        title: summary.title.replace(/^Edited\b/, "Editing"),
        detail: summary.detail,
        text: summary.title,
        changes: summary.changes,
        raw: summary.raw
      });
      return;
    }
    const itemEvent = codexEventFromItem(event.item, "started");
    if (itemEvent) {
      postChatEvent(board, chatId, itemEvent);
    }
    return;
  }

  if (event.type === "item.completed" && event.item) {
    if (event.item.type === "agent_message" && event.item.text) {
      markFinalMessageSeen();
      board.post({ type: "chatThinking", chatId, thinking: false });
      board.post({
        type: "assistantMessage",
        chatId,
        text: String(event.item.text)
      });
      return;
    }

    if (event.item.type === "file_change" && typeof recordFileChange === "function") {
      recordFileChange(event.item);
      return;
    }

    const itemEvent = codexEventFromItem(event.item, "completed");
    if (event.item.type === "file_change") {
      return;
    }
    if (itemEvent) {
      postChatEvent(board, chatId, itemEvent);
    }
  }
}

function postChatEvent(board, chatId, event) {
  board.post({
    type: "chatEvent",
    chatId,
    event
  });
}

function codexEventFromItem(item, phase) {
  if (item.type === "command_execution") {
    const command = normalizeCommandForDisplay(item.command || "command");
    return {
      eventId: eventIdentity(item, "command", command),
      kind: "command",
      status: phase === "started" ? "running" : "done",
      title: phase === "started" ? "Running command" : "Finished command",
      detail: commandDetail(item, command)
    };
  }

  if (item.type === "web_search") {
    return {
      kind: "web",
      status: phase === "started" ? "running" : "done",
      title: phase === "started" ? "Searching the web" : "Web search finished",
      detail: item.query || item.url || compactJson(item)
    };
  }

  if (item.type === "mcp_tool_call") {
    const name = item.name || "MCP tool";
    return {
      kind: "tool",
      status: phase === "started" ? "running" : "done",
      title: phase === "started" ? `Calling ${name}` : `${name} finished`,
      detail: compactJson(item)
    };
  }

  if (item.type === "file_change") {
    return {
      kind: "files",
      status: "done",
      title: "Codex updated files",
      detail: fileChangeDetail(item)
    };
  }

  if (item.type === "reasoning") {
    return {
      kind: "thinking",
      status: phase === "started" ? "running" : "done",
      title: phase === "started" ? "Reasoning started" : "Reasoning completed",
      detail: item.text || item.summary || ""
    };
  }

  return {
    kind: item.type || "event",
    status: phase === "started" ? "running" : "done",
    title: eventTitle(item.type || "Codex event", phase),
    detail: compactJson(item)
  };
}

function commandDetail(item, command) {
  const parts = [`Command:\n${command}`];
  for (const key of ["cwd", "exit_code", "exitCode", "status"]) {
    if (item[key] !== undefined && item[key] !== null) {
      parts.push(`${key}: ${item[key]}`);
    }
  }

  for (const key of ["output", "stdout", "stderr", "text"]) {
    if (item[key]) {
      parts.push(`${key}:\n${String(item[key])}`);
    }
  }

  return parts.join("\n\n");
}

function eventIdentity(item, kind, fallback) {
  for (const key of ["id", "item_id", "itemId", "call_id", "callId", "command_id", "commandId"]) {
    if (item[key] !== undefined && item[key] !== null && String(item[key]).trim()) {
      return `${kind}:${String(item[key]).trim()}`;
    }
  }

  return `${kind}:${String(fallback || "").trim()}`;
}

function normalizeCommandForDisplay(command) {
  const text = Array.isArray(command) ? command.join(" ") : String(command || "");
  const compact = text.replace(/\s+/g, " ").trim();
  const commandIndex = compact.search(/\s-Command\s/i);
  if (commandIndex === -1 || !/powershell(?:\.exe)?/i.test(compact.slice(0, commandIndex))) {
    return compact || "command";
  }

  const afterFlag = compact.slice(commandIndex).replace(/^\s-Command\s+/i, "").trim();
  return stripQuotes(afterFlag) || compact || "command";
}

function fileChangeDetail(item) {
  if (item.path) {
    return `Path: ${item.path}`;
  }

  if (Array.isArray(item.changes)) {
    return item.changes.map((change) => {
      if (typeof change === "string") {
        return change;
      }
      const filePath = change.path || change.file || change.name || "file";
      const kind = change.kind || change.action || "changed";
      return `${kind}: ${filePath}`;
    }).join("\n");
  }

  if (Array.isArray(item.files)) {
    return item.files.map((file) => typeof file === "string" ? file : compactJson(file)).join("\n");
  }

  return compactJson(item);
}

function fileChangeSummary(item) {
  const filePath = item.path || item.file || item.name || firstChangedFile(item) || "files";
  const fileName = path.basename(String(filePath)) || String(filePath);
  const action = normalizedFileChangeAction(item);
  const changes = extractFileChangeEntries(item);
  const additionSum = sumChangeNumbers(changes, "additions");
  const deletionSum = sumChangeNumbers(changes, "deletions");
  const additions = additionSum !== null ? additionSum : firstFileChangeNumber(item, ["additions", "added", "added_lines", "addedLines", "insertions"]);
  const deletions = deletionSum !== null ? deletionSum : firstFileChangeNumber(item, ["deletions", "deleted", "deleted_lines", "deletedLines", "removals"]);
  const counts = additions !== null || deletions !== null
    ? `${additions !== null ? "+" + additions : ""}${additions !== null && deletions !== null ? " " : ""}${deletions !== null ? "-" + deletions : ""}`
    : action;

  return {
    title: `${capitalize(action)} ${fileName}`,
    detail: counts,
    changes,
    raw: compactJson(item)
  };
}

function sumChangeNumbers(changes, key) {
  if (!Array.isArray(changes) || !changes.length) {
    return null;
  }

  let total = 0;
  let found = false;
  for (const change of changes) {
    if (!Number.isFinite(Number(change[key]))) {
      continue;
    }
    total += Number(change[key]);
    found = true;
  }

  return found ? total : null;
}

function augmentFileChangeWithDiff(item, snapshots) {
  const entries = extractFileChangeEntries(item);
  const changes = entries.map((entry) => {
    const next = Object.assign({}, entry);
    const filePath = resolveWorkspaceFilePath(next.path);
    const after = filePath ? readTextSnapshot(filePath) : null;
    const before = filePath && snapshots instanceof Map ? snapshotForFilePath(snapshots, filePath) : null;

    if (!next.diff && before && after && before.content !== after.content) {
      const diff = createUnifiedDiff(next.path || filePath, before.content, after.content);
      next.diff = diff.text;
      next.additions = diff.additions;
      next.deletions = diff.deletions;
    } else if (!next.diff && before && !after) {
      const diff = createUnifiedDiff(next.path || filePath, before.content, "");
      next.diff = diff.text;
      next.additions = diff.additions;
      next.deletions = diff.deletions;
    } else if (!next.diff && !before && after) {
      const diff = createUnifiedDiff(next.path || filePath, "", after.content);
      next.diff = diff.text;
      next.additions = diff.additions;
      next.deletions = diff.deletions;
    }

    if (filePath && snapshots instanceof Map) {
      snapshots.set(filePath, after || { path: filePath, content: "" });
    }

    return next;
  });

  return Object.assign({}, item, { changes });
}

function snapshotForFilePath(snapshots, filePath) {
  if (!(snapshots instanceof Map) || !filePath) {
    return null;
  }

  if (snapshots.has(filePath)) {
    return snapshots.get(filePath);
  }

  const normalized = path.normalize(filePath);
  if (snapshots.has(normalized)) {
    return snapshots.get(normalized);
  }

  const lower = normalized.toLowerCase();
  for (const [key, value] of snapshots.entries()) {
    if (path.normalize(key).toLowerCase() === lower) {
      return value;
    }
  }

  return null;
}

function captureFileSnapshotsFromText(text, cwd, snapshots) {
  if (!(snapshots instanceof Map)) {
    return;
  }

  for (const candidate of candidateFilePathsFromText(text, cwd)) {
    const snapshot = readTextSnapshot(candidate);
    if (snapshot && !snapshots.has(candidate)) {
      snapshots.set(candidate, snapshot);
    }
  }
}

function candidateFilePathsFromText(text, cwd) {
  const value = String(text || "");
  const candidates = new Set();
  const addCandidate = (raw) => {
    const clean = normalizeIncomingFilePath(stripPathPunctuation(raw));
    if (!clean) {
      return;
    }

    const filePath = path.isAbsolute(clean)
      ? path.normalize(clean)
      : path.normalize(path.join(cwd || getWorkspacePath() || "", clean));
    if (filePath) {
      candidates.add(filePath);
    }
  };

  const quotedWindowsPath = /["'`]([A-Za-z]:\\[^"'`\r\n]+)["'`]/g;
  const bareWindowsPath = /[A-Za-z]:\\[^\s"'`<>|]+/g;
  const workspaceRelativeFile = /(?:^|[\s"'`])((?:\.\\|\.\/)?[\w .-]+(?:\\|\/)[\w .\\\/-]+\.[A-Za-z0-9]{1,12})(?=$|[\s"'`,;:)\]}])/g;

  for (const pattern of [quotedWindowsPath, bareWindowsPath, workspaceRelativeFile]) {
    let match;
    while ((match = pattern.exec(value))) {
      addCandidate(match[1] || match[0]);
    }
  }

  return Array.from(candidates);
}

function stripPathPunctuation(value) {
  return String(value || "")
    .trim()
    .replace(/^["'`(<\[]+/, "")
    .replace(/["'`),.;:\]>]+$/, "");
}

function readTextSnapshot(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_ATTACHMENT_BYTES) {
      return null;
    }

    const buffer = fs.readFileSync(filePath);
    if (buffer.includes(0)) {
      return null;
    }

    return {
      path: filePath,
      content: buffer.toString("utf8")
    };
  } catch {
    return null;
  }
}

function createUnifiedDiff(filePath, before, after) {
  const beforeLines = splitDiffLines(before);
  const afterLines = splitDiffLines(after);
  const changes = lineDiff(beforeLines, afterLines);
  const additions = changes.filter((item) => item.type === "add").length;
  const deletions = changes.filter((item) => item.type === "delete").length;
  const oldCount = Math.max(1, beforeLines.length);
  const newCount = Math.max(1, afterLines.length);
  const label = normalizeIncomingFilePath(filePath) || filePath || "file";
  const lines = [
    `--- a/${label}`,
    `+++ b/${label}`,
    `@@ -1,${oldCount} +1,${newCount} @@`
  ];

  for (const item of changes) {
    const prefix = item.type === "add" ? "+" : item.type === "delete" ? "-" : " ";
    lines.push(prefix + item.line);
  }

  return {
    text: lines.join("\n").slice(0, MAX_ATTACHMENT_BYTES),
    additions,
    deletions
  };
}

function splitDiffLines(value) {
  const normalized = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  if (lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

function lineDiff(beforeLines, afterLines) {
  if (beforeLines.length * afterLines.length > 250000) {
    return beforeLines.map((line) => ({ type: "delete", line }))
      .concat(afterLines.map((line) => ({ type: "add", line })));
  }

  const rows = beforeLines.length + 1;
  const cols = afterLines.length + 1;
  const table = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
    for (let j = afterLines.length - 1; j >= 0; j -= 1) {
      table[i][j] = beforeLines[i] === afterLines[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const result = [];
  let i = 0;
  let j = 0;
  while (i < beforeLines.length && j < afterLines.length) {
    if (beforeLines[i] === afterLines[j]) {
      result.push({ type: "context", line: beforeLines[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push({ type: "delete", line: beforeLines[i] });
      i += 1;
    } else {
      result.push({ type: "add", line: afterLines[j] });
      j += 1;
    }
  }

  while (i < beforeLines.length) {
    result.push({ type: "delete", line: beforeLines[i] });
    i += 1;
  }
  while (j < afterLines.length) {
    result.push({ type: "add", line: afterLines[j] });
    j += 1;
  }

  return result;
}

function extractFileChangeEntries(item) {
  const entries = [];
  const addEntry = (entry) => {
    if (!entry) {
      return;
    }

    if (typeof entry === "string") {
      entries.push({
        path: entry,
        kind: normalizedFileChangeAction({ kind: "edited" }),
        additions: null,
        deletions: null,
        diff: ""
      });
      return;
    }

    const filePath = entry.path || entry.file || entry.name || "";
    if (!filePath) {
      return;
    }
    const diff = String(entry.diff || entry.patch || entry.unified_diff || entry.unifiedDiff || "");
    const diffCounts = diffLineCounts(diff);

    entries.push({
      path: String(filePath),
      kind: normalizedFileChangeAction(entry),
      additions: diffCounts.additions !== null ? diffCounts.additions : firstNumber(entry, ["additions", "added", "added_lines", "addedLines", "insertions"]),
      deletions: diffCounts.deletions !== null ? diffCounts.deletions : firstNumber(entry, ["deletions", "deleted", "deleted_lines", "deletedLines", "removals"]),
      diff
    });
  };

  if (Array.isArray(item.changes)) {
    item.changes.forEach(addEntry);
  }
  if (Array.isArray(item.files)) {
    item.files.forEach(addEntry);
  }
  if (!entries.length && (item.path || item.file || item.name)) {
    addEntry(item);
  }

  const itemDiff = String(item.diff || item.patch || item.unified_diff || item.unifiedDiff || "");
  if (itemDiff && entries.length === 1 && !entries[0].diff) {
    entries[0].diff = itemDiff;
  }

  return entries;
}

function diffLineCounts(diff) {
  const text = String(diff || "");
  if (!text) {
    return { additions: null, deletions: null };
  }

  let additions = 0;
  let deletions = 0;
  for (const line of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if (/^\+(?!\+\+)/.test(line)) {
      additions += 1;
    } else if (/^-(?!--)/.test(line)) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

function firstChangedFile(item) {
  const direct = firstChangedFileFromList(item.changes) || firstChangedFileFromList(item.files);
  if (direct) {
    return direct;
  }

  return "";
}

function firstChangedFileFromList(list) {
  if (!Array.isArray(list) || !list.length) {
    return "";
  }

  const file = list[0];
  if (typeof file === "string") {
    return file;
  }

  return file.path || file.file || file.name || "";
}

function normalizedFileChangeAction(item) {
  const raw = String(item.action || item.kind || firstFileChangeValue(item, ["action", "kind"]) || item.status || "edited").toLowerCase();
  if (["update", "updated", "edit", "edited", "done", "completed", "in_progress"].includes(raw)) {
    return "edited";
  }
  if (["create", "created", "add", "added"].includes(raw)) {
    return "created";
  }
  if (["delete", "deleted", "remove", "removed"].includes(raw)) {
    return "deleted";
  }
  if (["rename", "renamed", "move", "moved"].includes(raw)) {
    return "renamed";
  }

  return raw || "edited";
}

function firstFileChangeNumber(item, keys) {
  const direct = firstNumber(item, keys);
  if (direct !== null) {
    return direct;
  }

  const fromChanges = firstNumberFromList(item.changes, keys);
  if (fromChanges !== null) {
    return fromChanges;
  }

  return firstNumberFromList(item.files, keys);
}

function firstNumberFromList(list, keys) {
  if (!Array.isArray(list)) {
    return null;
  }

  for (const entry of list) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const value = firstNumber(entry, keys);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function firstFileChangeValue(item, keys) {
  for (const list of [item.changes, item.files]) {
    if (!Array.isArray(list)) {
      continue;
    }
    for (const entry of list) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      for (const key of keys) {
        if (entry[key] !== undefined && entry[key] !== null) {
          return entry[key];
        }
      }
    }
  }

  return "";
}

function firstNumber(item, keys) {
  for (const key of keys) {
    const value = Number(item[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function capitalize(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function eventTitle(type, phase) {
  const label = String(type).replace(/_/g, " ");
  return phase === "started" ? `${label} started` : `${label} completed`;
}

function compactJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function rateLimitPayloadFromEvent(event) {
  if (!event || typeof event !== "object") {
    return event;
  }

  return event.rateLimits
    || event.rate_limits
    || event.rate_limits_updated
    || event.rateLimit
    || event.rate_limit
    || event.limits
    || event.usage
    || event.balance
    || event.account
    || event;
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

function createInitialChat() {
  const now = Date.now();
  const projectPath = getWorkspacePath() || "";
  return {
    id: `chat-${now}`,
    title: titleWithProjectLabel("Codex chat 1", projectPath),
    sessionId: null,
    status: "idle",
    projectPath,
    draftPrompt: "",
    createdAt: now,
    updatedAt: now,
    runStartedAt: 0,
    runFinishedAt: 0,
    isThinking: false,
    settings: Object.assign({}, DEFAULT_CHAT_SETTINGS),
    messages: [
      {
        role: "system",
        text: "Ask Codex anything about this workspace.",
        at: now
      }
    ]
  };
}

function getHtml(webview) {
  const nonce = getNonce();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>Codex Max</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: dark light;
      --bg: #212121;
      --fg: #d7d7d7;
      --messageText: #c8c8c8;
      --messageStrong: #d0d0d0;
      --muted: #9a9a9a;
      --border: #343434;
      --card: #212121;
      --input: #303030;
      --chatSurface: ${DEFAULT_CHAT_BACKGROUND};
      --assistantSurface: transparent;
      --userSurface: #2f2f2f;
      --composerSurface: #303030;
      --chipText: #d7b800;
      --button: #3a3a3a;
      --buttonFg: #d7d7d7;
      --buttonHover: #444444;
      --danger: var(--vscode-errorForeground);
      --focus: #5f5f5f;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body,
    #app {
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: var(--bg);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
    }

    button,
    textarea,
    input,
    select {
      font: inherit;
    }

    .shell {
      display: grid;
      grid-template-rows: auto 1fr;
      height: 100%;
      min-width: 0;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 44px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      background: var(--chatSurface);
    }

    .brand {
      display: flex;
      flex-direction: column;
      min-width: 160px;
      margin-right: auto;
      line-height: 1.2;
    }

    .brand strong {
      font-size: 13px;
      font-weight: 650;
    }

    .brand span,
    .counter,
    .hint {
      color: var(--muted);
      font-size: 12px;
    }

    .counter {
      white-space: nowrap;
    }

    .workspaceSelector {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      max-width: 220px;
      height: 28px;
      padding: 0 9px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: color-mix(in srgb, var(--input), transparent 22%);
      color: var(--fg);
      font-size: 12px;
      white-space: nowrap;
    }

    .workspaceSelector span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .workspaceSelector::after {
      content: "";
      width: 7px;
      height: 7px;
      border-right: 1.7px solid currentColor;
      border-bottom: 1.7px solid currentColor;
      transform: translateY(-2px) rotate(45deg);
      opacity: 0.85;
    }

    .workspaceSelector.open,
    .workspaceSelector:hover {
      background: var(--buttonHover);
      color: var(--fg);
    }

    .workspaceMenuDivider {
      height: 1px;
      margin: 4px;
      background: var(--border);
    }

    .boardUsage {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      height: 28px;
      padding: 0 9px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--muted);
      background: color-mix(in srgb, var(--input), transparent 22%);
      font-size: 12px;
      white-space: nowrap;
      cursor: pointer;
    }

    .boardUsage strong {
      color: var(--fg);
      font-weight: 600;
    }

    .usageDot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--muted);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--muted), transparent 75%);
    }

    .boardUsage.running .usageDot {
      background: var(--vscode-testing-iconQueued);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-testing-iconQueued), transparent 72%);
    }

    .boardUsage.error .usageDot {
      background: var(--danger);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--danger), transparent 72%);
    }

    .boardUsage.opened .usageDot {
      background: var(--vscode-testing-iconPassed);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-testing-iconPassed), transparent 72%);
    }

    .boardUsage.loading .usageDot {
      border: 1px solid color-mix(in srgb, var(--fg), transparent 35%);
      border-top-color: transparent;
      background: transparent;
      box-shadow: none;
      animation: spin 0.8s linear infinite;
    }

    .boardUsage:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--chipText), transparent 35%);
      outline-offset: 2px;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .toolbar button,
    .iconButton {
      display: inline-grid;
      place-items: center;
      min-width: 30px;
      height: 30px;
      padding: 0 8px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: var(--button);
      color: var(--buttonFg);
      cursor: pointer;
    }

    .toolbar button:hover,
    .iconButton:hover {
      background: var(--buttonHover);
    }

    .smallIcon {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }

    .iconButton svg {
      width: 15px;
      height: 15px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .toolbar button.secondary,
    .iconButton.secondary {
      background: transparent;
      color: var(--fg);
      border-color: var(--border);
    }

    .toolbar .workspaceSelector {
      display: inline-flex;
      justify-content: flex-start;
      border-color: var(--border);
      border-radius: 999px;
      background: color-mix(in srgb, var(--input), transparent 22%);
      color: var(--fg);
    }

    .toolbar .workspaceSelector:hover,
    .toolbar .workspaceSelector.open {
      background: var(--buttonHover);
    }

    .toolbar .boardUsage {
      display: inline-flex;
      justify-content: flex-start;
      border-color: var(--border);
      border-radius: 999px;
      background: color-mix(in srgb, var(--input), transparent 22%);
      color: var(--muted);
    }

    .toolbar .boardUsage:hover {
      background: var(--buttonHover);
      color: var(--fg);
    }

    .board {
      min-height: 0;
      overflow: auto;
      padding: 10px;
      background: var(--chatSurface);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      grid-auto-rows: minmax(280px, 1fr);
      gap: 10px;
      min-height: 100%;
    }

    .grid.height-capped {
      align-items: start;
      min-height: 0;
    }

    .grid.height-capped .chat {
      height: var(--chatMaxHeight);
      max-height: var(--chatMaxHeight);
      min-height: 0;
    }

    .chat {
      display: grid;
      grid-template-rows: auto 1fr auto;
      min-width: 0;
      min-height: 280px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--chatSurface);
      overflow: hidden;
    }

    .chatHeader {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: center;
      min-height: 42px;
      padding: 8px;
      border-bottom: 1px solid #333333;
      background: var(--chatSurface);
    }

    .title {
      min-width: 0;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: var(--fg);
      font-weight: 650;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .title:focus {
      border-color: var(--focus);
      outline: none;
      background: var(--input);
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .messages {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 0;
      padding: 16px 14px 12px;
      overflow: auto;
      overflow-anchor: none;
      background: var(--chatSurface);
    }

    .message {
      flex: 0 0 auto;
      max-width: 100%;
      padding: 0;
      border: 1px solid transparent;
      border-radius: 18px;
      background: transparent;
      overflow-wrap: anywhere;
      color: var(--messageText);
      line-height: 1.5;
    }

    .message strong {
      color: var(--messageStrong);
      font-weight: 650;
    }

    .message p {
      margin: 0 0 8px;
    }

    .message p:last-child,
    .message ul:last-child,
    .message ol:last-child,
    .message blockquote:last-child,
    .message pre:last-child,
    .message table:last-child {
      margin-bottom: 0;
    }

    .message ul,
    .message ol {
      margin: 0 0 8px;
      padding-left: 18px;
    }

    .message li + li {
      margin-top: 3px;
    }

    .message blockquote {
      margin: 0 0 8px;
      padding: 0 0 0 10px;
      border-left: 3px solid color-mix(in srgb, var(--focus), transparent 35%);
      color: var(--muted);
    }

    .message hr {
      height: 1px;
      margin: 10px 0;
      border: 0;
      background: var(--border);
    }

    .message table {
      width: 100%;
      margin: 0 0 8px;
      border-collapse: collapse;
      font-size: 12px;
    }

    .message th,
    .message td {
      padding: 5px 7px;
      border: 1px solid var(--border);
      text-align: left;
      vertical-align: top;
    }

    .message th {
      background: color-mix(in srgb, var(--input), var(--bg) 18%);
      font-weight: 650;
    }

    .taskList {
      list-style: none;
      padding-left: 0;
    }

    .taskList li {
      display: grid;
      grid-template-columns: 16px minmax(0, 1fr);
      align-items: start;
      gap: 6px;
    }

    .taskBox {
      display: inline-grid;
      place-items: center;
      width: 13px;
      height: 13px;
      margin-top: 4px;
      border: 1px solid #777777;
      border-radius: 3px;
      background: #242424;
      color: #202020;
    }

    .taskBox.checked {
      border-color: #b8b8b8;
      background: #b8b8b8;
    }

    .taskBox svg {
      width: 10px;
      height: 10px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .message h3,
    .message h4,
    .message h5,
    .message h6 {
      margin: 0 0 8px;
      color: var(--messageStrong);
      font-size: 14px;
      font-weight: 650;
    }

    .message code {
      padding: 1px 4px;
      border-radius: 5px;
      background: #333333;
      color: #d0d0d0;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
    }

    .message kbd {
      padding: 1px 5px;
      border: 1px solid #4a4a4a;
      border-bottom-color: #333333;
      border-radius: 5px;
      background: #2c2c2c;
      color: var(--messageStrong);
      font-family: var(--vscode-editor-font-family);
      font-size: 0.88em;
    }

    .message mark {
      border-radius: 4px;
      padding: 0 3px;
      background: #4b4524;
      color: var(--messageStrong);
    }

    .message details {
      margin: 0 0 8px;
      padding: 8px 10px;
      border: 1px solid #3a3a3a;
      border-radius: 8px;
      background: #222222;
    }

    .message summary {
      cursor: pointer;
      color: var(--messageStrong);
      font-weight: 650;
    }

    .message dl {
      margin: 0 0 8px;
    }

    .message dt {
      color: var(--messageStrong);
      font-weight: 650;
    }

    .message dd {
      margin: 2px 0 8px 14px;
      color: var(--messageText);
    }

    .mathInline,
    .mathBlock {
      font-family: var(--vscode-editor-font-family);
      color: #d8d8d8;
    }

    .mathInline {
      padding: 1px 5px;
      border-radius: 5px;
      background: #303030;
    }

    .mathBlock {
      margin: 0 0 8px;
      padding: 8px;
      border: 1px solid #3a3a3a;
      border-radius: 8px;
      overflow: auto;
      background: #1f1f1f;
      white-space: pre;
    }

    .imageReference {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: 100%;
      color: var(--muted);
    }

    .imageReference strong {
      color: var(--fg);
      font-weight: 500;
    }

    .imagePreviewFrame {
      display: block;
      max-width: min(380px, 100%);
      margin: 8px 0 10px;
    }

    .imagePreviewButton {
      display: grid;
      gap: 6px;
      width: 100%;
      padding: 7px;
      border: 1px solid #3a3a3a;
      border-radius: 8px;
      background: #242424;
      color: var(--messageText);
      cursor: pointer;
      font: inherit;
      text-align: left;
    }

    .imagePreviewButton:hover {
      border-color: #505050;
      background: #292929;
    }

    .imagePreviewButton img {
      display: block;
      max-width: 100%;
      max-height: 220px;
      border-radius: 6px;
      object-fit: contain;
      background: #1f1f1f;
    }

    .imagePreviewButton img[hidden] {
      display: none;
    }

    .imagePreviewPlaceholder {
      display: grid;
      place-items: center;
      min-width: 160px;
      min-height: 88px;
      border: 1px dashed #454545;
      border-radius: 6px;
      color: var(--muted);
      background: #202020;
      font-size: 12px;
    }

    .imagePreviewButton.loaded .imagePreviewPlaceholder {
      display: none;
    }

    .imagePreviewCaption {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--muted);
      font-size: 12px;
    }

    .imageViewerBody {
      display: grid;
      gap: 10px;
      max-height: calc(94vh - 136px);
      overflow: auto;
      background: #1d1d1d;
    }

    .imageViewerViewport {
      max-height: 78vh;
      overflow: auto;
      border-radius: 8px;
      background: #171717;
      cursor: zoom-in;
    }

    .imageViewerBody img {
      display: block;
      width: 100%;
      max-width: none;
      max-height: none;
      margin: 0 auto;
      border-radius: 8px;
      object-fit: initial;
      background: #171717;
    }

    .imageViewerCaption {
      margin: 0;
      color: var(--muted);
      overflow-wrap: anywhere;
    }

    .imageViewerControls {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-right: auto;
    }

    .imageViewerControls button {
      min-width: 34px;
      padding: 0 10px;
    }

    .imageViewerZoomLabel {
      min-width: 48px;
      color: var(--muted);
      font-size: 12px;
      text-align: center;
    }

    .inlineLink {
      display: inline;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--vscode-textLink-foreground);
      text-decoration: underline;
      cursor: pointer;
      font: inherit;
    }

    .inlineLink:hover {
      color: var(--vscode-textLink-activeForeground);
    }

    .inlineEmail {
      color: var(--vscode-textLink-foreground);
    }

    .message pre {
      margin: 0 0 8px;
      padding: 8px;
      border: 1px solid #3a3a3a;
      border-radius: 8px;
      overflow: auto;
      background: #1f1f1f;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.35;
      white-space: pre;
    }

    .message pre code {
      display: block;
      padding: 0;
      background: transparent;
      white-space: pre;
    }

    .message.user {
      align-self: flex-end;
      max-width: min(78%, 520px);
      padding: 10px 14px;
      border-color: transparent;
      border-radius: 18px;
      background: var(--userSurface);
      color: var(--fg);
    }

    .userMeta {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1;
    }

    .copyMessage {
      display: inline-grid;
      place-items: center;
      width: 18px;
      height: 18px;
      border: 0;
      border-radius: 5px;
      padding: 0;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
    }

    .copyMessage:hover {
      background: #3a3a3a;
      color: var(--fg);
    }

    .copyMessage.copied {
      color: #7ccf85;
    }

    .copyMessage svg {
      width: 13px;
      height: 13px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .message.assistant {
      align-self: flex-start;
      max-width: 100%;
      padding: 0 8px;
      border-color: transparent;
      background: var(--assistantSurface);
    }

    .turnDuration {
      align-self: stretch;
      display: flex;
      align-items: center;
      gap: 5px;
      margin: 2px 0 0;
      padding-bottom: 9px;
      border-bottom: 1px solid #2f2f2f;
      color: var(--muted);
      font-size: 12px;
    }

    .turnDuration svg {
      width: 12px;
      height: 12px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .thinkingLine {
      align-self: stretch;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }

    .thinkingLine span::after {
      content: "...";
      display: inline-block;
      width: 0;
      margin-left: 2px;
      overflow: hidden;
      vertical-align: bottom;
      animation: statusDots 1.2s steps(4, end) infinite;
    }

    .message.system,
    .message.activity {
      color: var(--muted);
      font-size: 12px;
    }

    .message.error {
      color: var(--danger);
      border-color: color-mix(in srgb, var(--danger), transparent 50%);
      background: color-mix(in srgb, var(--danger), var(--bg) 92%);
    }

    .message.event {
      align-self: stretch;
      padding: 0;
      border-color: #3a3a3a;
      background: #252525;
      color: var(--muted);
      font-size: 12px;
      overflow: hidden;
    }

    .message.changeSummary {
      align-self: stretch;
      padding: 0;
      border: 1px solid #3c3c3c;
      border-radius: 10px;
      background: #2b2b2b;
      overflow: hidden;
    }

    .changeCard {
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      min-height: 58px;
      padding: 10px 12px;
      cursor: pointer;
      user-select: none;
    }

    .changeCard:focus-visible {
      outline: 1px solid var(--focus);
      outline-offset: -2px;
    }

    .changeIcon {
      display: inline-grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: #242424;
      color: var(--muted);
    }

    .changeIcon svg {
      width: 18px;
      height: 18px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .changeTitle {
      min-width: 0;
      color: var(--fg);
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .changeMeta {
      margin-top: 2px;
      color: #68b36b;
      font-size: 12px;
    }

    .changeAction {
      display: inline-grid;
      place-items: center;
      min-width: 30px;
      height: 30px;
      border: 1px solid #454545;
      border-radius: 999px;
      color: var(--fg);
      font-size: 12px;
    }

    .changeAction svg {
      width: 15px;
      height: 15px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .changeAction .changeToggleVertical {
      transition: opacity 120ms ease;
    }

    .message.changeSummary.expanded .changeAction .changeToggleVertical {
      opacity: 0;
    }

    .changeDetail {
      display: none;
      border-top: 1px solid #3c3c3c;
      background: #242424;
    }

    .message.changeSummary.expanded .changeDetail {
      display: block;
    }

    .changeFileRow {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      min-height: 28px;
      padding: 5px 10px;
      border-bottom: 1px solid #333333;
      color: var(--fg);
      font-size: 12px;
      background: #272727;
    }

    .changeFilePath {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--vscode-editor-font-family);
    }

    .changeCounts {
      color: var(--muted);
      white-space: nowrap;
    }

    .changeAdd {
      color: #7ccf85;
    }

    .changeDelete {
      color: #ff7b72;
    }

    .changeDetail pre {
      max-height: 360px;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      overflow: auto;
      background: #1d1d1d;
      color: var(--fg);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.4;
      white-space: pre;
    }

    .changeDetail pre.changeDiff {
      padding: 0;
    }

    .diffLine {
      display: block;
      min-height: 1.4em;
      padding: 0 10px;
    }

    .diffFile {
      color: var(--muted);
    }

    .diffHunk {
      color: #79c0ff;
      background: rgba(56, 139, 253, 0.16);
    }

    .diffAdd {
      color: #b7f5bd;
      background: rgba(46, 160, 67, 0.22);
      border-left: 2px solid #56d364;
      padding-left: 8px;
    }

    .diffDelete {
      color: #ffd1d1;
      background: rgba(248, 81, 73, 0.18);
      border-left: 2px solid #ff7b72;
      padding-left: 8px;
    }

    .diffContext {
      color: var(--fg);
    }

    .changeEmpty {
      padding: 9px 10px;
      color: var(--muted);
      font-size: 12px;
    }

    .eventSummary {
      display: grid;
      grid-template-columns: auto minmax(74px, auto) minmax(0, 1fr) auto;
      align-items: center;
      gap: 7px;
      min-height: 28px;
      padding: 5px 8px;
      cursor: pointer;
      user-select: none;
    }

    .eventSummary:focus-visible {
      outline: 1px solid var(--focus);
      outline-offset: -2px;
    }

    .eventBadge {
      display: inline-grid;
      place-items: center;
      min-width: 42px;
      height: 18px;
      padding: 0 5px;
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0;
    }

    .eventTitle {
      min-width: 0;
      color: var(--fg);
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .eventPreview {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .message.event.thinking.running .eventTitle::after,
    .message.event.files.running .eventTitle::after {
      content: "...";
      display: inline-block;
      width: 0;
      margin-left: 2px;
      overflow: hidden;
      vertical-align: bottom;
      animation: statusDots 1.2s steps(4, end) infinite;
    }

    .message.event.files.running .eventPreview,
    .message.event.files.running .eventBadge {
      animation: editingPulse 1.15s ease-in-out infinite;
    }

    @keyframes statusDots {
      0% {
        width: 0;
      }
      100% {
        width: 1.4em;
      }
    }

    @keyframes editingPulse {
      0%,
      100% {
        opacity: 0.62;
      }
      50% {
        opacity: 1;
      }
    }

    .eventToggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: transparent;
      color: var(--muted);
      font-weight: 700;
      line-height: 1;
      cursor: pointer;
    }

    .message.event.expanded .eventToggle {
      color: var(--fg);
    }

    .eventToggle svg {
      width: 12px;
      height: 12px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .eventToggle .eventToggleVertical {
      transition: opacity 120ms ease;
    }

    .message.event.expanded .eventToggle .eventToggleVertical {
      opacity: 0;
    }

    .message.event.running .eventBadge {
      border-color: color-mix(in srgb, var(--vscode-testing-iconQueued), transparent 25%);
      color: var(--vscode-testing-iconQueued);
    }

    .message.event.done .eventBadge {
      border-color: color-mix(in srgb, var(--vscode-testing-iconPassed), transparent 25%);
      color: var(--vscode-testing-iconPassed);
    }

    .message.event.error .eventBadge {
      border-color: color-mix(in srgb, var(--danger), transparent 20%);
      color: var(--danger);
    }

    .eventDetail {
      display: none;
      border-top: 1px solid var(--border);
    }

    .message.event.expanded .eventDetail {
      display: block;
    }

    .message.event .eventDetail pre {
      max-height: 260px;
      margin: 0;
      padding: 6px 8px 8px;
      border: 0;
      border-radius: 0;
      overflow: auto;
      color: var(--fg);
      background: color-mix(in srgb, var(--bg), black 8%);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.35;
      white-space: pre-wrap;
    }

    .message.event .eventDetail pre.changeDiff {
      white-space: pre;
    }

    .eventEmpty {
      padding: 6px 8px;
      border-top: 1px solid var(--border);
      color: var(--muted);
    }

    .settings {
      display: grid;
      grid-template-columns: minmax(70px, 1.25fr) repeat(4, minmax(42px, 0.7fr));
      gap: 5px;
      padding: 7px 8px;
      border-bottom: 1px solid var(--border);
      background: color-mix(in srgb, var(--card), var(--bg) 30%);
    }

    .control {
      display: grid;
      gap: 3px;
      min-width: 0;
    }

    .control label {
      color: var(--muted);
      font-size: 10px;
      line-height: 1;
      text-transform: uppercase;
    }

    .control input,
    .control select {
      width: 100%;
      min-width: 0;
      height: 26px;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0 6px;
      background: var(--input);
      color: var(--fg);
      font-size: 12px;
    }

    select {
      appearance: none;
      -webkit-appearance: none;
      padding-right: 26px !important;
      background-color: var(--input);
      background-image:
        linear-gradient(45deg, transparent 50%, var(--muted) 50%),
        linear-gradient(135deg, var(--muted) 50%, transparent 50%);
      background-position:
        calc(100% - 13px) 50%,
        calc(100% - 8px) 50%;
      background-size: 5px 5px, 5px 5px;
      background-repeat: no-repeat;
    }

    select:hover,
    select:focus {
      background-image:
        linear-gradient(45deg, transparent 50%, var(--fg) 50%),
        linear-gradient(135deg, var(--fg) 50%, transparent 50%);
    }

    .control input:focus,
    .control select:focus {
      border-color: var(--focus);
      outline: none;
    }

    .launchBody {
      display: grid;
      grid-template-rows: auto auto 1fr;
      gap: 10px;
      min-height: 0;
      padding: 10px;
    }

    .launchCopy {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .launchActions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 7px;
    }

    .launchActions button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-width: 0;
      height: 32px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: transparent;
      color: var(--fg);
      cursor: pointer;
      white-space: nowrap;
    }

    .launchActions button:hover {
      background: var(--buttonHover);
      color: var(--buttonFg);
    }

    .launchActions .primaryLaunch {
      grid-column: 1 / -1;
      border-color: color-mix(in srgb, var(--button), white 20%);
      background: linear-gradient(135deg, var(--button), color-mix(in srgb, var(--button), var(--focus) 35%));
      color: var(--buttonFg);
      font-weight: 650;
    }

    .launchIcon {
      width: 15px;
      height: 15px;
      fill: currentColor;
      flex: 0 0 auto;
    }

    .noteArea {
      width: 100%;
      min-width: 0;
      min-height: 84px;
      height: 100%;
      resize: none;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px;
      background: var(--input);
      color: var(--fg);
      line-height: 1.35;
    }

    .noteArea:focus {
      border-color: var(--focus);
      outline: none;
    }

    textarea {
      width: 100%;
      min-width: 0;
      height: 48px;
      max-height: 130px;
      resize: vertical;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 6px 7px;
      background: var(--input);
      color: var(--fg);
    }

    textarea:focus {
      border-color: var(--focus);
      outline: none;
    }

    .composer {
      padding: 8px 10px 10px;
      border-top: 1px solid #333333;
      background: var(--chatSurface);
    }

    .promptDock {
      display: grid;
      grid-template-rows: auto auto;
      gap: 8px;
      width: 100%;
      min-height: 86px;
      padding: 10px 8px 8px;
      border: 1px solid #464646;
      border-radius: 18px;
      background: var(--composerSurface);
      box-shadow: none;
    }

    .promptDock:focus-within {
      border-color: #595959;
      box-shadow: 0 0 0 1px #3b3b3b;
    }

    .chat.dragOver .promptDock,
    .promptDock.dragOver {
      border-color: var(--focus);
      box-shadow: 0 0 0 1px var(--focus);
    }

    .attachmentTray {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
    }

    .attachmentChip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: 100%;
      height: 24px;
      padding: 0 6px 0 8px;
      border: 1px solid #474747;
      border-radius: 999px;
      background: #373737;
      color: var(--fg);
      font-size: 12px;
      line-height: 1;
    }

    .attachmentChip span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .attachmentRemove {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
    }

    .attachmentRemove:hover {
      background: #4a4a4a;
      color: var(--fg);
    }

    .attachmentRemove svg {
      width: 12px;
      height: 12px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .promptInput {
      height: 42px;
      min-height: 42px;
      max-height: 146px;
      resize: none;
      overflow-y: hidden;
      border: 0 !important;
      border-radius: 10px;
      padding: 0 4px;
      background: transparent !important;
      color: var(--fg);
      font-size: 14px;
      line-height: 1.45;
    }

    .promptInput:focus {
      border-color: transparent;
      outline: none;
    }

    .composerBar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      min-height: 32px;
    }

    .composerLeft,
    .composerRight,
    .composerSettings {
      display: flex;
      align-items: center;
      min-width: 0;
    }

    .composerLeft {
      gap: 8px;
    }

    .composerRight {
      gap: 8px;
      justify-content: flex-end;
    }

    .contextIndicator {
      appearance: none;
      -webkit-appearance: none;
      display: inline-grid;
      place-items: center;
      flex: 0 0 auto;
      width: 18px;
      height: 18px;
      border: 1px solid color-mix(in srgb, var(--muted), transparent 55%);
      border-radius: 999px;
      padding: 0;
      background:
        conic-gradient(#c7c7c7 var(--contextAngle), #555555 0);
      color: var(--muted);
      cursor: pointer;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.22);
    }

    .contextIndicator::after {
      content: "";
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--composerSurface);
    }

    .contextIndicator:hover {
      border-color: color-mix(in srgb, #c7c7c7, transparent 20%);
      background:
        conic-gradient(#e0e0e0 var(--contextAngle), #606060 0);
    }

    .contextIndicator:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--chipText), transparent 35%);
      outline-offset: 2px;
    }

    .composerSettings {
      gap: 10px;
      flex: 1 1 auto;
      min-width: 0;
      overflow-x: auto;
      scrollbar-width: none;
    }

    .composerSettings::-webkit-scrollbar {
      display: none;
    }

    .composerIcon,
    .composerSettings input {
      flex: 0 0 auto;
      min-width: 0;
      height: 26px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--muted);
      font-size: 12px;
    }

    .selectChip {
      position: relative;
      display: inline-flex;
      align-items: center;
      flex: 0 0 auto;
      width: max-content;
      max-width: 100%;
      height: 26px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--chipText);
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
    }

    .selectChip:disabled {
      cursor: default;
      opacity: 0.55;
    }

    .selectChipText {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      max-width: none;
      overflow: visible;
      white-space: nowrap;
      padding-right: 4px;
      color: var(--chipText);
      pointer-events: none;
    }

    .selectChipText::after {
      content: "";
      width: 7px;
      height: 7px;
      margin-left: 4px;
      border-right: 1.8px solid currentColor;
      border-bottom: 1.8px solid currentColor;
      transform: translateY(-2px) rotate(45deg);
      opacity: 0.9;
    }

    .selectChip:focus-visible .selectChipText,
    .selectChip.open .selectChipText {
      color: var(--fg);
    }

    .composerIcon {
      display: inline-grid;
      place-items: center;
      width: 26px;
      height: 26px;
      padding: 0;
      border: 1px solid transparent;
      border-radius: 999px;
      color: var(--muted);
      cursor: pointer;
    }

    .composerIcon:disabled {
      cursor: default;
      opacity: 0.55;
    }

    .composerIcon:not(:disabled):hover {
      color: var(--fg);
    }

    .composerIcon.listening {
      color: var(--chipText);
      border-color: rgba(255, 214, 10, 0.55);
      background: rgba(255, 214, 10, 0.08);
      box-shadow: 0 0 0 1px rgba(255, 214, 10, 0.08), 0 0 14px rgba(255, 214, 10, 0.12);
    }

    .composerIcon.listening svg {
      animation: voicePulse 1.2s ease-in-out infinite;
    }

    .composerIcon.stopping {
      color: var(--chipText);
      border-color: rgba(255, 214, 10, 0.35);
      background: rgba(255, 214, 10, 0.05);
    }

    .composerIcon.stopping svg {
      animation: voicePulse 1.9s ease-in-out infinite;
      opacity: 0.75;
    }

    .composerIcon.unavailable {
      color: #777777;
      cursor: not-allowed;
    }

    .composerIcon.audioFileInput {
      width: 24px;
    }

    .localWhisperSettings {
      display: grid;
      gap: 8px;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--input), transparent 30%);
    }

    .localWhisperSettings .actionRow {
      grid-template-columns: minmax(120px, 1fr) minmax(88px, 112px);
    }

    .localWhisperSettings .actionRow button {
      min-width: 0;
      width: 100%;
      overflow-wrap: anywhere;
      white-space: normal;
      line-height: 1.2;
    }

    .whisperStatus {
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .whisperStatus strong {
      color: var(--fg);
    }

    .codexStatusCard {
      display: grid;
      gap: 9px;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--input), transparent 30%);
    }

    .codexStatusHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .codexStatusTitle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      color: var(--fg);
      font-weight: 700;
    }

    .codexStatusDot {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: #8a8a8a;
      box-shadow: 0 0 0 3px rgba(138, 138, 138, 0.12);
    }

    .codexStatusCard.connected .codexStatusDot {
      background: #68d391;
      box-shadow: 0 0 0 3px rgba(104, 211, 145, 0.15);
    }

    .codexStatusCard.warning .codexStatusDot,
    .codexStatusCard.checking .codexStatusDot {
      background: #d4b200;
      box-shadow: 0 0 0 3px rgba(212, 178, 0, 0.14);
    }

    .codexStatusCard.missing .codexStatusDot {
      background: #ff6b5f;
      box-shadow: 0 0 0 3px rgba(255, 107, 95, 0.14);
    }

    .codexStatusText {
      display: grid;
      gap: 4px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .codexStatusText strong {
      color: var(--fg);
    }

    .codexStatusActions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .codexStatusActions button,
    .codexStatusHeader button {
      height: 28px;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0 9px;
      background: var(--button);
      color: var(--buttonFg);
      cursor: pointer;
    }

    .codexStatusActions button:hover,
    .codexStatusHeader button:hover {
      background: var(--buttonHover);
    }

    .whisperProgress {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 6px 8px;
      border: 1px solid #3a3a3a;
      border-radius: 6px;
      background: #222222;
      color: var(--fg);
      overflow: hidden;
    }

    .whisperProgress::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: var(--progress, 0%);
      background: linear-gradient(90deg, rgba(255, 214, 10, 0.28), rgba(255, 214, 10, 0.12));
      transition: width 180ms ease;
    }

    .whisperProgress span,
    .whisperProgress strong {
      position: relative;
      z-index: 1;
    }

    .whisperNotice {
      padding: 6px 8px;
      border: 1px solid #3a3a3a;
      border-radius: 6px;
      background: #202020;
      color: var(--fg);
    }

    @keyframes voicePulse {
      0%, 100% {
        transform: scale(1);
        opacity: 0.72;
      }
      50% {
        transform: scale(1.12);
        opacity: 1;
      }
    }

    .composerIcon svg {
      width: 17px;
      height: 17px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .selectMenu {
      position: fixed;
      z-index: 20;
      min-width: 116px;
      max-width: min(220px, calc(100vw - 16px));
      padding: 4px;
      border: 1px solid #4a4a4a;
      border-radius: 8px;
      background: #2c2c2c;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
    }

    .selectMenu button {
      display: block;
      width: 100%;
      min-height: 26px;
      padding: 5px 9px;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: var(--messageText);
      font: inherit;
      font-size: 12px;
      text-align: left;
      cursor: pointer;
      white-space: nowrap;
    }

    .selectMenu button:hover,
    .selectMenu button:focus-visible {
      outline: none;
      background: #3a3a3a;
      color: var(--fg);
    }

    .selectMenu button.active {
      background: #454545;
      color: var(--chipText);
    }

    .send {
      width: 30px;
      min-width: 30px;
      height: 30px;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: #b8b8b8;
      color: #202020;
      box-shadow: none;
    }

    .send:hover {
      background: #d0d0d0;
    }

    .send svg {
      width: 17px;
      height: 17px;
      fill: none;
      stroke-width: 2;
    }

    .send.stopSend svg rect {
      fill: currentColor;
      stroke: none;
    }

    .send:disabled {
      opacity: 0.55;
      cursor: default;
      box-shadow: none;
    }

    .status {
      display: inline-grid;
      place-items: center;
      min-width: 42px;
      height: 22px;
      padding: 0 7px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 650;
      line-height: 1;
      text-transform: capitalize;
    }

    .status.running {
      border-color: color-mix(in srgb, var(--vscode-testing-iconQueued), transparent 35%);
      color: var(--vscode-testing-iconQueued);
    }

    .status.error {
      border-color: color-mix(in srgb, var(--danger), transparent 35%);
      color: var(--danger);
    }

    .status.opened {
      border-color: color-mix(in srgb, var(--vscode-testing-iconPassed), transparent 35%);
      color: var(--vscode-testing-iconPassed);
    }

    .empty {
      display: grid;
      place-items: center;
      min-height: 240px;
      border: 1px dashed var(--border);
      color: var(--muted);
    }

    .fatal {
      display: grid;
      align-content: center;
      justify-items: start;
      gap: 10px;
      min-height: 100%;
      padding: 24px;
      color: var(--fg);
      background: var(--bg);
    }

    .fatal h2 {
      margin: 0;
      font-size: 16px;
    }

    .fatal pre {
      max-width: 100%;
      margin: 0;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: auto;
      color: var(--muted);
      background: #1b1b1b;
      white-space: pre-wrap;
    }

    .fatal button {
      height: 30px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0 12px;
      background: var(--button);
      color: var(--buttonFg);
      cursor: pointer;
    }

    .toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      max-width: min(420px, calc(100vw - 36px));
      z-index: 8;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 9px 12px;
      background: var(--card);
      color: var(--fg);
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
      font-size: 12px;
      line-height: 1.35;
    }

    .modalBackdrop {
      position: fixed;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 18px;
      background: color-mix(in srgb, var(--bg), transparent 18%);
      z-index: 5;
    }

    .modalBackdrop[hidden] {
      display: none;
    }

    .modal {
      width: min(420px, 100%);
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--card);
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35);
      overflow: hidden;
    }

    .modal.chatInfoModal {
      width: min(560px, 100%);
    }

    .modal.imageViewerModal {
      width: min(1400px, 90vw);
      max-height: 94vh;
    }

    .modal.boardSettingsModal {
      display: flex;
      flex-direction: column;
      max-height: min(92vh, 900px);
    }

    .modalHeader {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
    }

    .modalHeader h2 {
      flex: 1;
      margin: 0;
      font-size: 14px;
      font-weight: 650;
    }

    .modalBody {
      display: grid;
      gap: 12px;
      padding: 12px;
    }

    .boardSettingsModal .modalBody {
      min-height: 0;
      overflow: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
    }

    .boardSettingsModal .modalHeader,
    .boardSettingsModal .modalFooter {
      flex: 0 0 auto;
    }

    .chatInfoBody {
      max-height: min(70vh, 640px);
      overflow: auto;
    }

    .chatInfoSummary {
      display: grid;
      gap: 5px;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--chatSurface), var(--card) 35%);
    }

    .chatInfoTitle {
      margin: 0;
      color: var(--fg);
      font-size: 14px;
      font-weight: 650;
    }

    .chatInfoMeta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
    }

    .chatInfoSection {
      display: grid;
      gap: 7px;
    }

    .chatInfoSection h3 {
      margin: 0;
      color: var(--fg);
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
    }

    .chatInfoGrid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px;
    }

    .chatInfoItem {
      display: grid;
      gap: 3px;
      min-width: 0;
      padding: 8px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: color-mix(in srgb, var(--input), transparent 18%);
    }

    .chatInfoLabel {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.2;
    }

    .chatInfoValue {
      min-width: 0;
      color: var(--fg);
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .chatInfoMono {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }

    .chatInfoProjectActions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .chatInfoProjectActions button {
      height: 30px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0 11px;
      background: var(--button);
      color: var(--buttonFg);
      cursor: pointer;
    }

    .chatInfoProjectActions button:hover {
      background: var(--buttonHover);
    }

    .chatInfoList {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .chatInfoList li {
      padding: 3px 7px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--muted);
      background: color-mix(in srgb, var(--input), transparent 20%);
      font-size: 12px;
    }

    .fieldRow {
      display: grid;
      grid-template-columns: 1fr 88px;
      gap: 12px;
      align-items: center;
    }

    .fieldRow.heightRow {
      grid-template-columns: 1fr auto;
    }

    .fieldRow.checkboxRow {
      grid-template-columns: 1fr auto;
    }

    .fieldRow.colorRow {
      grid-template-columns: 1fr minmax(180px, 260px);
    }

    .fieldRow.actionRow {
      grid-template-columns: 1fr minmax(140px, 180px);
    }

    .fieldRow label {
      color: var(--fg);
      font-weight: 600;
    }

    .fieldRow input,
    .fieldRow select {
      width: 100%;
      height: 30px;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0 7px;
      background-color: var(--input);
      color: var(--fg);
    }

    .heightControls {
      display: grid;
      grid-template-columns: 86px 88px;
      gap: 6px;
      justify-content: end;
    }

    .colorControls {
      display: grid;
      grid-template-columns: 34px minmax(76px, 1fr) auto;
      gap: 6px;
      align-items: center;
    }

    .colorControls input[type="color"] {
      width: 34px;
      padding: 2px;
      cursor: pointer;
    }

    .colorControls button {
      height: 30px;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0 8px;
      background: transparent;
      color: var(--fg);
      cursor: pointer;
    }

    .colorControls button:hover {
      background: #3a3a3a;
    }

    .actionRow button {
      height: 30px;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0 10px;
      background: var(--button);
      color: var(--buttonFg);
      cursor: pointer;
    }

    .actionRow button:hover {
      background: var(--buttonHover);
    }

    .actionRow button:disabled {
      opacity: 0.65;
      cursor: default;
    }

    .dualActions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }

    .heightControls input:disabled {
      opacity: 0.55;
    }

    .settingCheckbox {
      appearance: none;
      -webkit-appearance: none;
      position: relative;
      display: inline-block;
      flex: 0 0 18px;
      width: 18px;
      min-width: 18px;
      max-width: 18px;
      height: 18px;
      min-height: 18px;
      max-height: 18px;
      margin: 0;
      border: 1px solid var(--focus);
      border-radius: 5px;
      background: var(--input);
      accent-color: var(--chipText);
      cursor: pointer;
    }

    .settingCheckbox:checked {
      border-color: var(--chipText);
      background: color-mix(in srgb, var(--chipText), var(--input) 72%);
    }

    .settingCheckbox:checked::after {
      content: "";
      position: absolute;
      left: 50%;
      top: 50%;
      width: 11px;
      height: 9px;
      background: var(--chipText);
      clip-path: polygon(14% 44%, 0 60%, 39% 100%, 100% 18%, 84% 0, 36% 62%);
      transform: translate(-50%, -50%);
    }

    .settingCheckbox:focus {
      outline: 2px solid color-mix(in srgb, var(--chipText), transparent 45%);
      outline-offset: 2px;
    }

    .stepper {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 6px;
    }

    .stepper button {
      height: 30px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: transparent;
      color: var(--fg);
      cursor: pointer;
    }

    .stepper button.active {
      border-color: var(--button);
      background: var(--button);
      color: var(--buttonFg);
    }

    .modalHint {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .modalFooter {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 12px;
      border-top: 1px solid var(--border);
    }

    .modalFooter button {
      height: 30px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0 12px;
      background: transparent;
      color: var(--fg);
      cursor: pointer;
    }

    .modalFooter .primary {
      border-color: var(--button);
      background: var(--button);
      color: var(--buttonFg);
    }

    @media (min-width: 1450px) {
      .grid {
        grid-template-columns: repeat(4, minmax(250px, 1fr));
      }
    }

    @media (min-width: 980px) and (max-width: 1449px) {
      .grid {
        grid-template-columns: repeat(3, minmax(250px, 1fr));
      }
    }

    @media (max-width: 640px) {
      .toolbar {
        flex-wrap: wrap;
      }

      .chatInfoGrid {
        grid-template-columns: 1fr;
      }

      .grid {
        grid-template-columns: 1fr;
      }

      .settings {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    .grid.cols-1 {
      grid-template-columns: repeat(1, minmax(240px, 1fr));
    }

    .grid.cols-2 {
      grid-template-columns: repeat(2, minmax(240px, 1fr));
    }

    .grid.cols-3 {
      grid-template-columns: repeat(3, minmax(240px, 1fr));
    }

    .grid.cols-4 {
      grid-template-columns: repeat(4, minmax(240px, 1fr));
    }

    .grid.cols-5 {
      grid-template-columns: repeat(5, minmax(240px, 1fr));
    }

    .grid.cols-6 {
      grid-template-columns: repeat(6, minmax(240px, 1fr));
    }

    .grid.cols-7 {
      grid-template-columns: repeat(7, minmax(240px, 1fr));
    }

    .grid.cols-8 {
      grid-template-columns: repeat(8, minmax(240px, 1fr));
    }

    .grid.cols-9 {
      grid-template-columns: repeat(9, minmax(240px, 1fr));
    }

    .grid.cols-10 {
      grid-template-columns: repeat(10, minmax(240px, 1fr));
    }

    .grid.cols-11 {
      grid-template-columns: repeat(11, minmax(240px, 1fr));
    }

    .grid.cols-12 {
      grid-template-columns: repeat(12, minmax(240px, 1fr));
    }

    .grid.rows-1 {
      grid-auto-rows: minmax(280px, calc((100vh - 68px) / 1));
    }

    .grid.rows-2 {
      grid-auto-rows: minmax(280px, calc((100vh - 78px) / 2));
    }

    .grid.rows-3 {
      grid-auto-rows: minmax(260px, calc((100vh - 88px) / 3));
    }

    .grid.rows-4 {
      grid-auto-rows: minmax(240px, calc((100vh - 98px) / 4));
    }

    .grid.rows-5 {
      grid-auto-rows: minmax(220px, calc((100vh - 108px) / 5));
    }

    .grid.rows-6 {
      grid-auto-rows: minmax(200px, calc((100vh - 118px) / 6));
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const app = document.getElementById("app");

    let state = {
      chats: [],
      selectedChatId: null,
      activeWorkspaceId: null,
      workspaces: [],
      accountRateLimits: null,
      boardSettings: {
        chatsPerRow: 3,
        chatsPerColumn: 2,
        maxChatHeight: 0,
        chatBackground: "${DEFAULT_CHAT_BACKGROUND}",
        sendWithCtrlEnter: false,
        autoScroll: true,
        voiceShortcut: "alt-v",
        speechToText: "browser",
        localWhisperModel: "small-q5_1",
        localWhisperCaptureId: -1,
        localWhisperStopGraceMs: ${DEFAULT_WHISPER_LIVE_STOP_GRACE_MS},
        currentWorkspacePath: ""
      }
    };
    let config = {
      maxVisibleChats: 12,
      defaultChatsPerRow: 3,
      defaultChatsPerColumn: 2,
      workspaceName: "Workspace",
      workspacePath: ""
    };
    const DEFAULT_CHAT_SETTINGS = {
      model: "gpt-5.5",
      reasoning: "medium",
      verbosity: "medium",
      sandbox: "read-only",
      webSearch: "cached"
    };
    const MAX_ATTACHMENT_BYTES = ${MAX_ATTACHMENT_BYTES};
    const LOCAL_WHISPER_MODELS = ${JSON.stringify(LOCAL_WHISPER_MODELS)};
    let activeSelectMenu = null;
    let activeWorkspaceMenu = null;
    let activeChatInfoId = null;
    let imageViewerZoom = 1;
    let accountRateLimitsLoading = false;
    let durationTimer = null;
    let chatScrollState = new Map();
    let chatAutoScrollPaused = new Set();
    let chatPausedScrollTop = new Map();
    let chatStickyScroll = new Set();
    let chatUserScrollIntent = new Set();
    let pendingChatRenderIds = new Set();
    let pendingChatRenderFrame = 0;
    let rateLimitsRequestedOnce = false;
    let voiceRecognition = null;
    let voiceChatId = "";
    let voiceBaseText = "";
    let localVoiceSession = null;
    let nativeWhisperLive = false;
    let nativeWhisperStopping = false;
    let nativeWhisperChunks = [];
    let nativeWhisperStartedAt = 0;
    let whisperStatus = null;
    let whisperDownloadState = null;
    let whisperPrewarmState = null;
    let codexStatus = null;
    let codexStatusLoading = false;
    let microphonePermissionNotice = "";

    window.addEventListener("error", (event) => {
      showFatal(event.error || event.message || "Unknown webview error");
    });

    window.addEventListener("unhandledrejection", (event) => {
      showFatal(event.reason || "Unhandled webview promise rejection");
    });

    window.addEventListener("message", (event) => {
      const message = event.data;

      if (message.type === "hydrate") {
        try {
          config = Object.assign(config, message.config || {});
          state = normalizeState(message.state);
          state.boardSettings = normalizeBoardSettings(state.boardSettings);
          render();
          persist();
          requestRateLimitsOnce();
          requestCodexStatus();
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
        });
        return;
      }

      if (message.type === "chatThinking") {
        updateChat(message.chatId, (chat) => {
          chat.isThinking = Boolean(message.thinking) && chat.status === "running";
        });
        return;
      }

      if (message.type === "chatSession") {
        updateChat(message.chatId, (chat) => {
          chat.sessionId = message.sessionId;
        }, { render: "chrome" });
        return;
      }

      if (message.type === "chatActivity") {
        addMessage(message.chatId, "activity", message.text);
        return;
      }

      if (message.type === "assistantMessage") {
        addAssistantMessage(message.chatId, message.text);
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
        });
      }

      if (message.type === "chatEvent") {
        addEventMessage(message.chatId, message.event);
        return;
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
        updateChat(message.chatId, (chat) => {
          chat.status = "opened";
          chat.lastOpenedAt = Date.now();
        }, { render: "chrome" });
      }
    });

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

    function normalizeState(nextState) {
      const savedWorkspaces = Array.isArray(nextState && nextState.workspaces) ? nextState.workspaces : [];
      const legacyBoardSettings = normalizeBoardSettings(nextState && nextState.boardSettings);
      const legacyWorkspacePath = currentWorkspacePathFromSettings(legacyBoardSettings);
      const legacyChats = Array.isArray(nextState && nextState.chats) ? nextState.chats : [];
      let workspaces = savedWorkspaces
        .map((workspace, index) => normalizeWorkspaceProfile(workspace, index))
        .filter(Boolean);

      if (!workspaces.length) {
        workspaces = [createWorkspaceProfile({
          id: nextState && nextState.activeWorkspaceId ? String(nextState.activeWorkspaceId) : newId(),
          name: projectFolderName(legacyWorkspacePath) || config.workspaceName || "Workspace",
          path: legacyWorkspacePath,
          selectedChatId: nextState && nextState.selectedChatId ? nextState.selectedChatId : null,
          boardSettings: legacyBoardSettings,
          chats: legacyChats
        }, 0)];
      }

      const activeWorkspaceId = String(nextState && nextState.activeWorkspaceId || "");
      let active = workspaces.find((workspace) => workspace.id === activeWorkspaceId) || workspaces[0];
      if (!active) {
        active = createWorkspaceProfile({}, 0);
        workspaces = [active];
      }

      return {
        selectedChatId: active.selectedChatId || null,
        activeWorkspaceId: active.id,
        workspaces,
        accountRateLimits: normalizeRateLimits(nextState && nextState.accountRateLimits),
        boardSettings: cloneBoardSettings(active.boardSettings),
        chats: active.chats.length ? active.chats.map((chat) => cloneChat(chat, active.path)) : [createChatForWorkspace(1, active.path)]
      };
    }

    function createWorkspaceProfile(source, index) {
      const base = source || {};
      const boardSettings = normalizeBoardSettings(base.boardSettings || {});
      const workspacePath = normalizeProjectPath(base.path || boardSettings.currentWorkspacePath || config.workspacePath || "");
      boardSettings.currentWorkspacePath = workspacePath;
      const chats = Array.isArray(base.chats)
        ? base.chats.map((chat, chatIndex) => normalizeChat(chat, chatIndex, workspacePath))
        : [];
      return {
        id: String(base.id || newId()),
        name: String(base.name || projectFolderName(workspacePath) || "Workspace " + (index + 1)),
        path: workspacePath,
        selectedChatId: base.selectedChatId ? String(base.selectedChatId) : null,
        boardSettings,
        chats: chats.length ? chats : [createChatForWorkspace(1, workspacePath)]
      };
    }

    function normalizeWorkspaceProfile(workspace, index) {
      if (!workspace || typeof workspace !== "object") {
        return null;
      }

      return createWorkspaceProfile(workspace, index);
    }

    function normalizeChat(chat, index, fallbackWorkspacePath) {
      const source = chat || {};
      const now = Date.now();
      const messages = Array.isArray(source.messages) ? source.messages.map((item) => ({
        role: String(item.role || "assistant"),
        text: String(item.text || ""),
        at: Number(item.at || now),
        eventId: item.eventId ? String(item.eventId) : "",
        kind: item.kind ? String(item.kind) : "",
        status: item.status ? String(item.status) : "",
        title: item.title ? String(item.title) : "",
        detail: item.detail ? String(item.detail) : "",
        runStartedAt: Number(item.runStartedAt || 0),
        runFinishedAt: Number(item.runFinishedAt || 0),
        raw: item.raw ? String(item.raw) : "",
        changes: Array.isArray(item.changes) ? item.changes.map(normalizeChangeEntry) : []
      })) : [];
      repairFileChangeSummaries(messages);
      const messageTimes = messages.map((item) => item.at).filter((value) => Number.isFinite(value) && value > 0);
      const firstMessageAt = messageTimes.length ? Math.min.apply(null, messageTimes) : now;
      const lastMessageAt = messageTimes.length ? Math.max.apply(null, messageTimes) : firstMessageAt;
      const createdAt = Number(source.createdAt || firstMessageAt || now) || now;
        const updatedAt = Number(source.updatedAt || source.lastOpenedAt || lastMessageAt || createdAt) || createdAt;
      const status = source.status === "running" ? "idle" : String(source.status || "idle");
      const runStartedAt = Number(source.runStartedAt || 0);
      const runFinishedAt = Number(source.runFinishedAt || 0);
      const projectPath = normalizeProjectPath(source.projectPath || fallbackWorkspacePath || currentWorkspacePath());
      const fallbackTitle = "Codex chat " + (index + 1);

      return {
        id: String(source.id || newId()),
        title: chatTitleWithProject(String(source.title || fallbackTitle), projectPath),
        sessionId: source.sessionId || null,
        status,
        note: String(source.note || ""),
        projectPath,
        draftPrompt: String(source.draftPrompt || ""),
        lastOpenedAt: Number(source.lastOpenedAt || 0),
        createdAt,
        updatedAt,
        runStartedAt,
        runFinishedAt: status === "running" ? 0 : runFinishedAt,
        isThinking: status === "running" && Boolean(source.isThinking),
        settings: normalizeSettings(source.settings),
        pendingAttachments: Array.isArray(source.pendingAttachments) ? source.pendingAttachments.map(normalizeAttachment) : [],
        messages
      };
    }

    function repairFileChangeSummaries(messages) {
      for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (message.role !== "changeSummary" || !/^completed files$/i.test(message.title || message.text || "")) {
          continue;
        }

        const fileEvent = previousFileChangeEvent(messages, index);
        const filePath = fileEvent ? filePathFromFileChangeDetail(fileEvent.detail) : "";
        if (!filePath) {
          continue;
        }

        message.title = "Edited " + basenameForDisplay(filePath);
        message.text = message.title;
        message.detail = "edited";
        message.changes = [{
          path: filePath,
          kind: "edited",
          additions: null,
          deletions: null,
          diff: ""
        }];
        if (fileEvent && fileEvent.detail) {
          message.raw = fileEvent.detail;
        }
      }
    }

    function normalizeChangeEntry(entry) {
      const value = entry || {};
      return {
        path: String(value.path || value.file || value.name || ""),
        kind: normalizeChangeKind(value.kind || value.action || "edited"),
        additions: Number.isFinite(Number(value.additions)) ? Number(value.additions) : null,
        deletions: Number.isFinite(Number(value.deletions)) ? Number(value.deletions) : null,
        diff: String(value.diff || value.patch || value.unified_diff || value.unifiedDiff || "")
      };
    }

    function normalizeChangeKind(value) {
      const text = String(value || "edited").toLowerCase();
      if (["update", "updated", "edit", "edited", "done", "completed", "in_progress"].includes(text)) {
        return "edited";
      }
      if (["create", "created", "add", "added"].includes(text)) {
        return "created";
      }
      if (["delete", "deleted", "remove", "removed"].includes(text)) {
        return "deleted";
      }
      if (["rename", "renamed", "move", "moved"].includes(text)) {
        return "renamed";
      }
      return text || "edited";
    }

    function previousFileChangeEvent(messages, fromIndex) {
      for (let index = fromIndex - 1; index >= 0; index -= 1) {
        const item = messages[index];
        if (item.role === "event" && item.kind === "files") {
          return item;
        }
      }

      return null;
    }

    function filePathFromFileChangeDetail(detail) {
      const text = String(detail || "").trim();
      if (!text) {
        return "";
      }

      try {
        const parsed = JSON.parse(text);
        if (parsed.path) {
          return String(parsed.path);
        }
        if (Array.isArray(parsed.changes) && parsed.changes.length) {
          const first = parsed.changes[0];
          return typeof first === "string" ? first : String(first.path || first.file || first.name || "");
        }
        if (Array.isArray(parsed.files) && parsed.files.length) {
          const first = parsed.files[0];
          return typeof first === "string" ? first : String(first.path || first.file || first.name || "");
        }
      } catch {
        const line = text.split(/\\r?\\n/).find((item) => /:\\s*[A-Za-z]:\\\\|:\\s*\\//.test(item));
        if (line) {
          return line.replace(/^\\w+:\\s*/, "").trim();
        }
      }

      return "";
    }

    function basenameForDisplay(value) {
      const clean = String(value || "").replace(/[?#].*$/, "");
      return clean.split(/[\\\\/]/).pop() || clean || "file";
    }

    function createChat(index) {
      return createChatForWorkspace(index, currentWorkspacePath());
    }

    function createChatForWorkspace(index, workspacePath) {
      const now = Date.now();
      const projectPath = normalizeProjectPath(workspacePath || "");
      return {
        id: newId(),
        title: chatTitleWithProject("Codex chat " + index, projectPath),
        sessionId: null,
        status: "idle",
        note: "",
        projectPath,
        draftPrompt: "",
        lastOpenedAt: 0,
        createdAt: now,
        updatedAt: now,
        runStartedAt: 0,
        runFinishedAt: 0,
        isThinking: false,
        settings: Object.assign({}, DEFAULT_CHAT_SETTINGS),
        pendingAttachments: [],
        messages: [{
          role: "system",
          text: "Ask Codex anything about this workspace.",
          at: now
        }]
      };
    }

    function cloneBoardSettings(settings) {
      return normalizeBoardSettings(JSON.parse(JSON.stringify(settings || {})));
    }

    function cloneChat(chat, workspacePath) {
      return normalizeChat(JSON.parse(JSON.stringify(chat || {})), 0, workspacePath || currentWorkspacePath());
    }

    function applyChatSurface(value) {
      const chatBackground = normalizeHexColor(value, "${DEFAULT_CHAT_BACKGROUND}");
      document.documentElement.style.setProperty("--chatSurface", chatBackground);
      app.style.setProperty("--chatSurface", chatBackground);
      app.style.background = chatBackground;
      const shell = app.querySelector(".shell");
      if (shell) {
        shell.style.setProperty("--chatSurface", chatBackground);
        shell.style.background = chatBackground;
      }
      return chatBackground;
    }

    function render(options) {
      const renderOptions = options && typeof options === "object" ? options : {};
      clearPendingChatRenders();
      closeSelectMenu();
      closeWorkspaceMenu();
      const previousBoardScroll = renderOptions.preserveBoardScroll ? captureBoardScrollState() : null;
      const previousScrollState = captureMessageScrollState();
      const board = normalizeBoardSettings(state.boardSettings);
      const configuredColumns = board.chatsPerRow;
      const configuredRows = board.chatsPerColumn;
      const maxChatHeight = board.maxChatHeight;
      const sendWithCtrlEnter = board.sendWithCtrlEnter;
      const chatBackground = board.chatBackground;
      const autoScroll = board.autoScroll;
      const voiceShortcut = board.voiceShortcut;
      const speechToText = board.speechToText;
      const localWhisperModel = board.localWhisperModel;
      const localWhisperCaptureId = board.localWhisperCaptureId;
      const localWhisperStopGraceMs = board.localWhisperStopGraceMs;

      applyChatSurface(chatBackground);

      app.innerHTML = \`
        <div class="shell" style="--chatSurface: \${escapeAttr(chatBackground)}; background: \${escapeAttr(chatBackground)};">
          \${renderToolbar()}
          <main class="board">
            \${renderBoardGrid(board)}
          </main>
          \${renderBoardSettingsDialog(configuredColumns, configuredRows, maxChatHeight, sendWithCtrlEnter, chatBackground, autoScroll, voiceShortcut, speechToText, localWhisperModel, localWhisperCaptureId, localWhisperStopGraceMs)}
          \${renderChatInfoDialog()}
          \${renderImageViewerDialog()}
        </div>
      \`;

      bindToolbarControls();
      bindBoardSettingsDialog();
      bindChatInfoDialog();
      bindImageViewerDialog();

      bindChatCards(previousScrollState, autoScroll);

      restoreBoardScroll(previousBoardScroll);
      updateVoiceButtons();
      syncDurationTimer();
    }

    function renderBoardGrid(boardSettings) {
      const board = normalizeBoardSettings(boardSettings || state.boardSettings);
      const chatCount = state.chats.length;
      if (!chatCount) {
        return '<section class="empty">No chats yet</section>';
      }

      const configuredColumns = board.chatsPerRow;
      const configuredRows = board.chatsPerColumn;
      const maxChatHeight = board.maxChatHeight;
      const columns = chatCount === 1 ? 1 : Math.max(1, Math.min(configuredColumns, chatCount));
      const rows = Math.max(1, Math.min(configuredRows, Math.ceil(chatCount / columns)));
      const gridClass = 'grid cols-' + columns + ' rows-' + rows + (maxChatHeight ? ' height-capped' : '');
      const gridStyle = maxChatHeight ? ' style="--chatMaxHeight: ' + maxChatHeight + 'px; grid-auto-rows: ' + maxChatHeight + 'px; min-height: 0;"' : '';
      return '<section class="' + gridClass + '"' + gridStyle + '>' + state.chats.map(renderChat).join("") + '</section>';
    }

    function refreshBoardGrid(options) {
      const refreshOptions = options && typeof options === "object" ? options : {};
      clearPendingChatRenders();
      const boardNode = document.querySelector(".board");
      if (!boardNode) {
        render(refreshOptions);
        return;
      }

      const previousBoardScroll = refreshOptions.preserveBoardScroll ? captureBoardScrollState() : null;
      const previousScrollState = captureMessageScrollState();
      const board = normalizeBoardSettings(state.boardSettings);
      boardNode.innerHTML = renderBoardGrid(board);
      bindChatCards(previousScrollState, board.autoScroll);
      refreshToolbar();
      restoreBoardScroll(previousBoardScroll);
      updateVoiceButtons();
      syncDurationTimer();
    }

    function refreshBoardAfterSettingsChange() {
      applyChatSurface(state.boardSettings.chatBackground);
      refreshBoardGrid({ preserveBoardScroll: true });
      if (activeChatInfoId) {
        refreshChatInfoDialog(false);
      }
    }

    function bindChatCards(previousScrollState, autoScroll) {
      const scrollState = previousScrollState || new Map();
      for (const chat of state.chats) {
        const card = document.querySelector('[data-chat-id="' + chat.id + '"]');
        if (card) {
          bindChatCardControls(chat, card, scrollState.get(chat.id), autoScroll);
        }
      }
    }

    function renderToolbar() {
      const chatCount = state.chats.length;
      const overLimit = chatCount > config.maxVisibleChats;
      const usage = boardUsageInfo(state.chats, state.accountRateLimits);
      const workspacePath = currentWorkspacePath();
      const workspaceName = projectFolderName(workspacePath) || config.workspaceName;

      return \`
        <header class="toolbar">
          <div class="brand">
            <strong>Codex Max</strong>
            <span title="\${escapeAttr(workspacePath)}">\${escapeHtml(workspaceName)}</span>
          </div>
          <span class="counter">\${chatCount}/\${config.maxVisibleChats} visible target</span>
          \${renderWorkspaceSelector()}
          \${renderBoardUsage(usage)}
          \${overLimit ? '<span class="hint">Board is getting dense</span>' : ''}
          <button id="openBoardSettings" class="secondary" title="Board settings">
            <svg viewBox="0 0 24 24" aria-hidden="true" class="smallIcon">
              <path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8 8 0 0 0-2.6-1.5L14 2.5h-4L9.6 5a8 8 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5A8.6 8.6 0 0 0 4.5 12c0 .5 0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a8 8 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"></path>
            </svg>
          </button>
          <button id="addChat" title="Add chat">+</button>
        </header>
      \`;
    }

    function bindToolbarControls() {
      const addChatButton = document.getElementById("addChat");
      const settingsButton = document.getElementById("openBoardSettings");
      if (addChatButton) {
        addChatButton.addEventListener("click", addChat);
      }
      if (settingsButton) {
        settingsButton.addEventListener("click", openBoardSettings);
      }
      bindBoardUsageRefresh();

      const workspaceSelector = document.getElementById("workspaceSelector");
      if (!workspaceSelector) {
        return;
      }

      workspaceSelector.addEventListener("click", (event) => {
        event.stopPropagation();
        openWorkspaceMenu(workspaceSelector);
      });
      workspaceSelector.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        openWorkspaceMenu(workspaceSelector);
      });
    }

    function refreshToolbar() {
      const toolbar = document.querySelector(".toolbar");
      if (!toolbar) {
        return;
      }

      const template = document.createElement("template");
      template.innerHTML = renderToolbar().trim();
      const nextToolbar = template.content.firstElementChild;
      if (!nextToolbar) {
        return;
      }

      toolbar.replaceWith(nextToolbar);
      bindToolbarControls();
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

    function refreshBoardUsage() {
      const usageNode = document.querySelector(".boardUsage");
      if (!usageNode) {
        return;
      }

      const template = document.createElement("template");
      template.innerHTML = renderBoardUsage(boardUsageInfo(state.chats, state.accountRateLimits)).trim();
      const nextUsage = template.content.firstElementChild;
      if (nextUsage) {
        usageNode.replaceWith(nextUsage);
        bindBoardUsageRefresh();
      }
    }

    function bindBoardUsageRefresh() {
      const usageNode = document.querySelector(".boardUsage");
      if (!usageNode || usageNode.dataset.boundRefresh === "true") {
        return;
      }

      usageNode.dataset.boundRefresh = "true";
      usageNode.addEventListener("click", refreshAccountLimitsFromPill);
      usageNode.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        refreshAccountLimitsFromPill();
      });
    }

    function refreshAccountLimitsFromPill() {
      if (accountRateLimitsLoading) {
        return;
      }

      accountRateLimitsLoading = true;
      refreshBoardUsage();
      vscode.postMessage({
        type: "refreshRateLimits"
      });
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

      for (const summary of card.querySelectorAll(".eventSummary")) {
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

      for (const summary of card.querySelectorAll(".changeCard")) {
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

      for (const link of card.querySelectorAll("[data-open-file]")) {
        link.addEventListener("click", (event) => {
          event.preventDefault();
          vscode.postMessage({
            type: "openFile",
            path: event.currentTarget.dataset.openFile
          });
        });
      }

      for (const link of card.querySelectorAll("[data-open-url]")) {
        link.addEventListener("click", (event) => {
          event.preventDefault();
          vscode.postMessage({
            type: "openExternal",
            url: event.currentTarget.dataset.openUrl
          });
        });
      }

      for (const preview of card.querySelectorAll("[data-image-path]")) {
        requestImagePreview(preview);
      }

      for (const preview of card.querySelectorAll("[data-image-open]")) {
        preview.addEventListener("click", (event) => {
          event.preventDefault();
          openImageViewer(event.currentTarget);
        });
      }

      for (const button of card.querySelectorAll("[data-copy-chat]")) {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          copyMessageText(event.currentTarget);
        });
      }
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
      const shouldStickToBottom = !paused && (!previous || (autoScroll && previous.atBottom && contentChanged));
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
      return element.scrollHeight - element.scrollTop - element.clientHeight <= 4;
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

    function requestImagePreview(element) {
      if (!element || element.dataset.imageRequest) {
        return;
      }

      const requestId = newId();
      element.dataset.imageRequest = requestId;
      vscode.postMessage({
        type: "imagePreview",
        requestId,
        path: element.dataset.imagePath || ""
      });
    }

    function applyImagePreview(message) {
      const requestId = String(message.requestId || "");
      if (!requestId) {
        return;
      }

      const element = document.querySelector('[data-image-request="' + cssEscape(requestId) + '"]');
      if (!element) {
        return;
      }

      const img = element.querySelector("img");
      const placeholder = element.querySelector(".imagePreviewPlaceholder");
      if (message.dataUri && img) {
        img.src = message.dataUri;
        img.hidden = false;
        element.classList.add("loaded");
        return;
      }

      if (placeholder) {
        placeholder.textContent = message.error || "Preview unavailable";
      }
    }

    function cssEscape(value) {
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
      }

      return String(value).replace(/"/g, '\\\\"');
    }

    function openSelectMenu(chatId, chip) {
      if (!chip || chip.disabled) {
        return;
      }

      if (activeSelectMenu && activeSelectMenu.chip === chip) {
        closeSelectMenu();
        return;
      }

      closeSelectMenu();
      const chat = state.chats.find((item) => item.id === chatId);
      if (!chat) {
        return;
      }

      const setting = chip.dataset.selectSetting;
      const selectedValue = chip.dataset.selectValue || "";
      const options = parseSelectOptions(chip.dataset.selectOptions);
      if (!setting || !options.length) {
        return;
      }

      chip.classList.add("open");
      const menu = document.createElement("div");
      menu.className = "selectMenu";
      menu.setAttribute("role", "listbox");

      for (const item of options) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = item.label;
        button.dataset.value = item.value;
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", item.value === selectedValue ? "true" : "false");
        if (item.value === selectedValue) {
          button.classList.add("active");
        }

        button.addEventListener("click", (event) => {
          event.stopPropagation();
          chat.settings[setting] = item.value;
          chat.updatedAt = Date.now();
          closeSelectMenu();
          renderChatChrome(chatId);
          persist();
        });
        menu.appendChild(button);
      }

      document.body.appendChild(menu);
      positionSelectMenu(menu, chip);

      const closeOnOutside = (event) => {
        if (!menu.contains(event.target) && event.target !== chip && !chip.contains(event.target)) {
          closeSelectMenu();
        }
      };
      setTimeout(() => document.addEventListener("click", closeOnOutside, { once: true }), 0);

      activeSelectMenu = {
        menu,
        chip,
        closeOnOutside
      };
    }

    function openWorkspaceMenu(button) {
      if (!button) {
        return;
      }

      if (activeWorkspaceMenu && activeWorkspaceMenu.button === button) {
        closeWorkspaceMenu();
        return;
      }

      closeSelectMenu();
      closeWorkspaceMenu();
      button.classList.add("open");
      button.setAttribute("aria-expanded", "true");

      const menu = document.createElement("div");
      menu.className = "selectMenu workspaceMenu";
      menu.setAttribute("role", "listbox");

      const newButton = document.createElement("button");
      newButton.type = "button";
      newButton.textContent = "New workspace";
      newButton.addEventListener("click", (event) => {
        event.stopPropagation();
        closeWorkspaceMenu();
        vscode.postMessage({ type: "pickNewWorkspace" });
      });
      menu.appendChild(newButton);

      const exportButton = document.createElement("button");
      exportButton.type = "button";
      exportButton.textContent = "Export workspaces";
      exportButton.addEventListener("click", (event) => {
        event.stopPropagation();
        closeWorkspaceMenu();
        syncActiveWorkspaceFromState();
        vscode.postMessage({ type: "exportWorkspaces", state });
      });
      menu.appendChild(exportButton);

      const importButton = document.createElement("button");
      importButton.type = "button";
      importButton.textContent = "Import workspaces";
      importButton.addEventListener("click", (event) => {
        event.stopPropagation();
        closeWorkspaceMenu();
        vscode.postMessage({ type: "importWorkspaces" });
      });
      menu.appendChild(importButton);

      const divider = document.createElement("div");
      divider.className = "workspaceMenuDivider";
      menu.appendChild(divider);

      for (const workspace of workspaceList()) {
        const item = document.createElement("button");
        item.type = "button";
        item.textContent = workspace.name;
        item.title = workspace.path || workspace.name;
        item.dataset.workspaceId = workspace.id;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", workspace.id === state.activeWorkspaceId ? "true" : "false");
        if (workspace.id === state.activeWorkspaceId) {
          item.classList.add("active");
        }
        item.addEventListener("click", (event) => {
          event.stopPropagation();
          closeWorkspaceMenu();
          switchWorkspace(workspace.id);
        });
        menu.appendChild(item);
      }

      document.body.appendChild(menu);
      positionSelectMenu(menu, button);

      const closeOnOutside = (event) => {
        if (!menu.contains(event.target) && event.target !== button && !button.contains(event.target)) {
          closeWorkspaceMenu();
        }
      };
      setTimeout(() => document.addEventListener("click", closeOnOutside, { once: true }), 0);

      activeWorkspaceMenu = {
        menu,
        button,
        closeOnOutside
      };
    }

    function closeSelectMenu() {
      if (!activeSelectMenu) {
        return;
      }

      document.removeEventListener("click", activeSelectMenu.closeOnOutside);
      activeSelectMenu.chip.classList.remove("open");
      activeSelectMenu.menu.remove();
      activeSelectMenu = null;
    }

    function closeWorkspaceMenu() {
      if (!activeWorkspaceMenu) {
        return;
      }

      document.removeEventListener("click", activeWorkspaceMenu.closeOnOutside);
      activeWorkspaceMenu.button.classList.remove("open");
      activeWorkspaceMenu.button.setAttribute("aria-expanded", "false");
      activeWorkspaceMenu.menu.remove();
      activeWorkspaceMenu = null;
    }

    function positionSelectMenu(menu, chip) {
      const rect = chip.getBoundingClientRect();
      menu.style.left = rect.left + "px";
      menu.style.top = rect.bottom + 6 + "px";
      menu.style.minWidth = Math.max(86, Math.ceil(rect.width) + 18) + "px";

      const menuRect = menu.getBoundingClientRect();
      const overflowRight = menuRect.right - window.innerWidth + 8;
      if (overflowRight > 0) {
        menu.style.left = Math.max(8, rect.left - overflowRight) + "px";
      }

      const overflowBottom = menuRect.bottom - window.innerHeight + 8;
      if (overflowBottom > 0) {
        menu.style.top = Math.max(8, rect.top - menuRect.height - 6) + "px";
      }
    }

    function parseSelectOptions(value) {
      try {
        const parsed = JSON.parse(value || "[]");
        return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.value === "string") : [];
      } catch {
        return [];
      }
    }

    function showFatal(error) {
      const message = error && error.stack ? error.stack : String(error || "Unknown error");
      app.innerHTML = \`
        <div class="fatal">
          <h2>Codex Max could not render the chat board</h2>
          <pre>\${escapeHtml(message)}</pre>
          <button id="resetBrokenState" type="button">Reset chat board state</button>
        </div>
      \`;

      const reset = document.getElementById("resetBrokenState");
      if (reset) {
        reset.addEventListener("click", () => {
          const workspacePath = normalizeProjectPath(config.workspacePath || "");
          const workspace = createWorkspaceProfile({
            id: newId(),
            name: projectFolderName(workspacePath) || "Workspace",
            path: workspacePath,
            boardSettings: normalizeBoardSettings({ currentWorkspacePath: workspacePath }),
            chats: []
          }, 0);
          state = {
            chats: workspace.chats.map((chat) => cloneChat(chat, workspace.path)),
            selectedChatId: null,
            activeWorkspaceId: workspace.id,
            workspaces: [workspace],
            accountRateLimits: state.accountRateLimits,
            boardSettings: cloneBoardSettings(workspace.boardSettings)
          };
          render();
          persist();
        });
      }
    }

    function showToast(message) {
      const existing = document.querySelector(".toast");
      if (existing) {
        existing.remove();
      }

      const toast = document.createElement("div");
      toast.className = "toast";
      toast.textContent = String(message || "");
      document.body.appendChild(toast);
      setTimeout(() => {
        toast.remove();
      }, 4200);
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

    function renderBoardSettingsDialog(columns, rows, maxChatHeight, sendWithCtrlEnter, chatBackground, autoScroll, voiceShortcut, speechToText, localWhisperModel, localWhisperCaptureId, localWhisperStopGraceMs) {
      const isHeightAuto = !maxChatHeight;
      const heightValue = maxChatHeight || 720;
      return \`
        <div class="modalBackdrop" id="boardSettingsModal" hidden>
          <section class="modal boardSettingsModal" role="dialog" aria-modal="true" aria-labelledby="boardSettingsTitle">
            <header class="modalHeader">
              <h2 id="boardSettingsTitle">Board settings</h2>
              <button class="iconButton secondary" id="closeBoardSettings" title="Close">x</button>
            </header>
            <div class="modalBody">
              <div class="fieldRow">
                <label for="chatsPerRow">Chats per row</label>
                <input id="chatsPerRow" type="number" min="1" max="12" value="\${columns}" />
              </div>
              <div class="stepper" aria-label="Chats per row presets">
                \${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((value) => '<button class="' + (value === columns ? "active" : "") + '" data-columns="' + value + '">' + value + '</button>').join("")}
              </div>
              <div class="fieldRow">
                <label for="chatsPerColumn">Chats per column</label>
                <input id="chatsPerColumn" type="number" min="1" max="6" value="\${rows}" />
              </div>
              <div class="stepper" aria-label="Chats per column presets">
                \${[1, 2, 3, 4, 5, 6].map((value) => '<button class="' + (value === rows ? "active" : "") + '" data-rows="' + value + '">' + value + '</button>').join("")}
              </div>
              <div class="fieldRow heightRow">
                <label for="maxChatHeightMode">Max chat height</label>
                <div class="heightControls">
                  <select id="maxChatHeightMode">
                    <option value="auto"\${isHeightAuto ? " selected" : ""}>Auto</option>
                    <option value="pixels"\${isHeightAuto ? "" : " selected"}>Pixels</option>
                  </select>
                  <input id="maxChatHeight" type="number" min="280" max="2400" step="20" value="\${heightValue}" \${isHeightAuto ? "disabled" : ""} />
                </div>
              </div>
              <div class="fieldRow checkboxRow">
                <label for="sendWithCtrlEnter">Send with Ctrl+Enter</label>
                <input id="sendWithCtrlEnter" class="settingCheckbox" type="checkbox" \${sendWithCtrlEnter ? "checked" : ""} />
              </div>
              <div class="fieldRow checkboxRow">
                <label for="autoScrollMessages">Auto-scroll new messages</label>
                <input id="autoScrollMessages" class="settingCheckbox" type="checkbox" \${autoScroll ? "checked" : ""} />
              </div>
              <div id="codexStatusCard" class="codexStatusCard">
                \${renderCodexStatus()}
              </div>
              <div class="fieldRow">
                <label for="voiceShortcut">Voice shortcut</label>
                <select id="voiceShortcut">
                  <option value="off"\${voiceShortcut === "off" ? " selected" : ""}>Off</option>
                  <option value="alt-v"\${voiceShortcut === "alt-v" ? " selected" : ""}>Alt+V</option>
                  <option value="ctrl-shift-v"\${voiceShortcut === "ctrl-shift-v" ? " selected" : ""}>Ctrl+Shift+V</option>
                  <option value="ctrl-m"\${voiceShortcut === "ctrl-m" ? " selected" : ""}>Ctrl+M</option>
                </select>
              </div>
              <div class="fieldRow">
                <label for="speechToText">Speech-to-text engine</label>
                <select id="speechToText">
                  <option value="browser"\${speechToText === "browser" ? " selected" : ""}>Browser Web Speech</option>
                  <option value="local-whisper"\${speechToText === "local-whisper" ? " selected" : ""}>Local Whisper</option>
                  <option value="off"\${speechToText === "off" ? " selected" : ""}>Off</option>
                </select>
              </div>
              <div class="localWhisperSettings">
                <div class="fieldRow">
                  <label for="localWhisperModel">Local Whisper model</label>
                  <select id="localWhisperModel">
                    \${LOCAL_WHISPER_MODELS.map((model) => '<option value="' + escapeAttr(model.id) + '"' + (model.id === localWhisperModel ? " selected" : "") + '>' + escapeHtml(model.label + " - " + model.size) + '</option>').join("")}
                  </select>
                </div>
                <div class="fieldRow">
                  <label for="localWhisperCaptureId">Microphone</label>
                  <select id="localWhisperCaptureId" title="Microphone device used by Local Whisper live input">
                    \${renderCaptureDeviceOptions(localWhisperCaptureId)}
                  </select>
                </div>
                <div class="fieldRow">
                  <label for="localWhisperStopGraceMs">Mic stop delay (ms)</label>
                  <input id="localWhisperStopGraceMs" type="number" min="100" max="10000" step="100" value="\${escapeAttr(localWhisperStopGraceMs)}" title="How long Local Whisper waits for final output after you stop listening" />
                </div>
                <div id="localWhisperStatus" class="whisperStatus">
                  \${renderWhisperStatus(localWhisperModel)}
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
                  <input id="chatBackgroundPicker" type="color" value="\${escapeAttr(chatBackground)}" title="Chat background color" />
                  <input id="chatBackground" type="text" value="\${escapeAttr(chatBackground)}" placeholder="${DEFAULT_CHAT_BACKGROUND}" />
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
              <p class="modalHint">Rows control density. Enter sends by default; auto-scroll follows new replies only while you are already at the bottom.</p>
              <p class="modalHint">Browser voice input uses the browser Web Speech API. Local Whisper uses free multilingual ggml models and does not use the selected Codex model.</p>
            </div>
            <footer class="modalFooter">
              <button id="cancelBoardSettings" type="button">Cancel</button>
              <button id="applyBoardSettings" class="primary" type="button">Apply</button>
            </footer>
          </section>
        </div>
      \`;
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
      return \`
        <div class="codexStatusHeader">
          <div class="codexStatusTitle">
            <span class="codexStatusDot" aria-hidden="true"></span>
            <span>\${escapeHtml(title)}</span>
          </div>
          <button id="refreshCodexStatus" type="button" \${codexStatusLoading ? "disabled" : ""}>\${escapeHtml(refreshText)}</button>
        </div>
        <div class="codexStatusText">
          <div><strong>Executable:</strong> \${escapeHtml(executable)}</div>
          \${version ? '<div><strong>Version:</strong> ' + escapeHtml(version) + '</div>' : ""}
          \${login ? '<div><strong>Auth:</strong> ' + escapeHtml(login) + '</div>' : ""}
          \${issue ? '<div>' + escapeHtml(issue) + '</div>' : ""}
        </div>
        <div class="codexStatusActions">
          \${installButton}
          \${loginButton}
          \${doctorButton}
          <button type="button" data-codex-action="version">Version</button>
        </div>
      \`;
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

      if (!modal || !closeButton || !cancelButton || !applyButton || !input || !rowInput || !heightMode || !heightInput || !sendWithCtrlEnter || !autoScrollMessages || !voiceShortcut || !speechToText || !localWhisperModel || !localWhisperCaptureId || !localWhisperStopGraceMs || !downloadWhisperRuntime || !downloadWhisperModel || !requestMicrophoneAccess || !openMicrophoneSettings || !chatBackground || !chatBackgroundPicker || !resetChatBackground || !refreshRateLimits || !exportWorkspacePreset || !importWorkspacePreset || !codexStatusCard) {
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
        draft.chatBackground = "${DEFAULT_CHAT_BACKGROUND}";
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
        draft.chatBackground = normalizeHexColor(chatBackground.value, "${DEFAULT_CHAT_BACKGROUND}");
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
      return \`
        <div><strong>\${escapeHtml(selected.label)}</strong> <span>\${escapeHtml(selected.size)}</span></div>
        <div>\${escapeHtml(selected.description)}. Multilingual model, supports Russian.</div>
        \${runtimePlatform ? '<div>Runtime platform: ' + escapeHtml(runtimePlatform) + '</div>' : ''}
        <div>\${escapeHtml(runtimeText)} · \${escapeHtml(modelText)}</div>
        <div>\${runtimeSupported ? 'Default microphone uses the current system recording device. Pick a named input if the default is wrong.' : 'Local Whisper can still download models, but live transcription needs a supported local runtime.'}</div>
        \${runtimeReason}
        \${progress}
        \${micNotice}
        \${prewarmNotice}
      \`;
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

    function renderChatInfoDialog() {
      const chat = state.chats.find((item) => item.id === activeChatInfoId);
      const body = chat ? chatInfoHtml(chat) : "";
      const hidden = chat ? "" : " hidden";

      return \`
        <div class="modalBackdrop" id="chatInfoModal"\${hidden}>
          <section class="modal chatInfoModal" role="dialog" aria-modal="true" aria-labelledby="chatInfoTitle">
            <header class="modalHeader">
              <h2 id="chatInfoTitle">Chat information</h2>
              <button class="iconButton secondary" id="closeChatInfo" title="Close">x</button>
            </header>
            <div class="modalBody chatInfoBody" id="chatInfoBody">\${body}</div>
            <footer class="modalFooter">
              <button id="closeChatInfoFooter" class="primary" type="button">Close</button>
            </footer>
          </section>
        </div>
      \`;
    }

    function bindChatInfoDialog() {
      const modal = document.getElementById("chatInfoModal");
      const closeButton = document.getElementById("closeChatInfo");
      const footerButton = document.getElementById("closeChatInfoFooter");
      if (!modal || !closeButton || !footerButton) {
        return;
      }

      closeButton.addEventListener("click", closeChatInfo);
      footerButton.addEventListener("click", closeChatInfo);
      const chooseProject = document.getElementById("chooseChatProject");
      const chooseWorkspace = document.getElementById("chooseCurrentWorkspace");
      const useWorkspace = document.getElementById("useWorkspaceProject");
      if (chooseProject) {
        chooseProject.addEventListener("click", chooseProjectForActiveChat);
      }
      if (chooseWorkspace) {
        chooseWorkspace.addEventListener("click", chooseWorkspaceForActiveChat);
      }
      if (useWorkspace) {
        useWorkspace.addEventListener("click", useWorkspaceForActiveChat);
      }
      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          closeChatInfo();
        }
      });
    }

    function openChatInfo(chatId) {
      activeChatInfoId = chatId;
      refreshChatInfoDialog(true);
    }

    function refreshChatInfoDialog(focusClose) {
      const existing = document.getElementById("chatInfoModal");
      if (!existing) {
        render();
        return;
      }

      const template = document.createElement("template");
      template.innerHTML = renderChatInfoDialog().trim();
      const next = template.content.firstElementChild;
      if (!next) {
        return;
      }

      existing.replaceWith(next);
      bindChatInfoDialog();
      const closeButton = document.getElementById("closeChatInfo");
      if (focusClose && closeButton) {
        closeButton.focus();
      }
    }

    function closeChatInfo() {
      activeChatInfoId = null;
      const modal = document.getElementById("chatInfoModal");
      if (modal) {
        modal.hidden = true;
      }
    }

    function chooseProjectForActiveChat() {
      if (!activeChatInfoId) {
        return;
      }

      vscode.postMessage({
        type: "pickProject",
        chatId: activeChatInfoId
      });
    }

    function chooseWorkspaceForActiveChat() {
      if (!activeChatInfoId) {
        return;
      }

      vscode.postMessage({
        type: "pickWorkspaceProject",
        chatId: activeChatInfoId
      });
    }

    function useWorkspaceForActiveChat() {
      if (!activeChatInfoId) {
        return;
      }

      const workspacePath = currentWorkspacePath();
      updateChat(activeChatInfoId, (chat) => {
        chat.projectPath = workspacePath;
        chat.title = chatTitleWithProject(chat.title, chat.projectPath);
      }, { render: "chrome" });
      refreshChatInfoDialog(false);
    }

    function renderImageViewerDialog() {
      return \`
        <div class="modalBackdrop" id="imageViewerModal" hidden>
          <section class="modal imageViewerModal" role="dialog" aria-modal="true" aria-labelledby="imageViewerTitle">
            <header class="modalHeader">
              <h2 id="imageViewerTitle">Image preview</h2>
              <button class="iconButton secondary" id="closeImageViewer" title="Close">x</button>
            </header>
            <div class="modalBody imageViewerBody">
              <div class="imageViewerViewport">
                <img id="imageViewerImage" alt="">
              </div>
              <p class="imageViewerCaption" id="imageViewerCaption"></p>
            </div>
            <footer class="modalFooter">
              <div class="imageViewerControls" aria-label="Image zoom controls">
                <button id="zoomImageOut" type="button" title="Zoom out">-</button>
                <span class="imageViewerZoomLabel" id="imageViewerZoomLabel">100%</span>
                <button id="zoomImageIn" type="button" title="Zoom in">+</button>
                <button id="resetImageZoom" type="button" title="Reset zoom">Reset</button>
              </div>
              <button id="openImageViewerFile" type="button">Open file</button>
              <button id="closeImageViewerFooter" class="primary" type="button">Close</button>
            </footer>
          </section>
        </div>
      \`;
    }

    function bindImageViewerDialog() {
      const modal = document.getElementById("imageViewerModal");
      const closeButton = document.getElementById("closeImageViewer");
      const footerButton = document.getElementById("closeImageViewerFooter");
      const openFileButton = document.getElementById("openImageViewerFile");
      const zoomOut = document.getElementById("zoomImageOut");
      const zoomIn = document.getElementById("zoomImageIn");
      const resetZoom = document.getElementById("resetImageZoom");
      const viewport = modal ? modal.querySelector(".imageViewerViewport") : null;
      if (!modal || !closeButton || !footerButton || !openFileButton || !zoomOut || !zoomIn || !resetZoom || !viewport) {
        return;
      }

      closeButton.addEventListener("click", closeImageViewer);
      footerButton.addEventListener("click", closeImageViewer);
      zoomOut.addEventListener("click", () => setImageViewerZoom(imageViewerZoom - 0.25));
      zoomIn.addEventListener("click", () => setImageViewerZoom(imageViewerZoom + 0.25));
      resetZoom.addEventListener("click", () => setImageViewerZoom(1));
      viewport.addEventListener("wheel", handleImageViewerWheel, { passive: false });
      openFileButton.addEventListener("click", () => {
        const path = openFileButton.dataset.openFile || "";
        if (path) {
          vscode.postMessage({ type: "openFile", path });
        }
      });
      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          closeImageViewer();
        }
      });
    }

    function openImageViewer(preview) {
      const modal = document.getElementById("imageViewerModal");
      const image = document.getElementById("imageViewerImage");
      const caption = document.getElementById("imageViewerCaption");
      const openFileButton = document.getElementById("openImageViewerFile");
      if (!modal || !image || !caption || !openFileButton) {
        return;
      }

      const img = preview.querySelector("img");
      const path = preview.dataset.imagePath || "";
      const label = preview.dataset.imageCaption || path || "image";
      if (!img || !img.src || img.hidden) {
        const placeholder = preview.querySelector(".imagePreviewPlaceholder");
        if (placeholder) {
          placeholder.textContent = "Image is still loading...";
        }
        requestImagePreview(preview);
        return;
      }

      image.src = img.src;
      image.alt = label;
      caption.textContent = label + (path && path !== label ? " - " + path : "");
      openFileButton.dataset.openFile = path;
      openFileButton.hidden = !path;
      setImageViewerZoom(1);
      modal.hidden = false;
      const closeButton = document.getElementById("closeImageViewer");
      if (closeButton) {
        closeButton.focus();
      }
    }

    function closeImageViewer() {
      const modal = document.getElementById("imageViewerModal");
      const image = document.getElementById("imageViewerImage");
      if (modal) {
        modal.hidden = true;
      }
      if (image) {
        image.removeAttribute("src");
      }
    }

    function handleImageViewerWheel(event) {
      const modal = document.getElementById("imageViewerModal");
      if (!modal || modal.hidden) {
        return;
      }

      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      const step = event.ctrlKey || event.metaKey ? 0.15 : 0.25;
      setImageViewerZoom(imageViewerZoom + direction * step);
    }

    function setImageViewerZoom(value) {
      imageViewerZoom = Math.max(0.25, Math.min(4, Number(value) || 1));
      const image = document.getElementById("imageViewerImage");
      const label = document.getElementById("imageViewerZoomLabel");
      if (image) {
        image.style.width = Math.round(imageViewerZoom * 100) + "%";
      }
      if (label) {
        label.textContent = Math.round(imageViewerZoom * 100) + "%";
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

    function chatScrollSignature(chat) {
      const messages = Array.isArray(chat.messages) ? chat.messages : [];
      const parts = [
        chat.status || "",
        chat.isThinking ? "thinking" : "",
        String(chat.runStartedAt || ""),
        String(chat.runFinishedAt || ""),
        String(messages.length)
      ];

      for (const message of messages) {
        const changes = Array.isArray(message.changes)
          ? message.changes.map((change) => [
              change.path || "",
              change.kind || "",
              change.additions == null ? "" : change.additions,
              change.deletions == null ? "" : change.deletions,
              String(change.diff || "").length
            ].join(":")).join(",")
          : "";
        parts.push([
          message.role || "",
          message.kind || "",
          message.status || "",
          message.eventId || "",
          String(message.at || ""),
          String(message.text || "").length,
          String(message.title || ""),
          String(message.detail || "").length,
          String(message.raw || "").length,
          changes
        ].join("|"));
      }

      return parts.join(";");
    }

    function renderChat(chat) {
      const isRunning = chat.status === "running";
      const messages = renderChatMessages(chat);
      const statusTitle = chat.sessionId ? "Thread: " + chat.sessionId : "New Codex thread";
      const settings = normalizeSettings(chat.settings);
      const board = normalizeBoardSettings(state.boardSettings);
      const sendShortcut = board.sendWithCtrlEnter ? "Ctrl+Enter" : "Enter";
      const sendButtonTitle = isRunning ? "Stop" : "Send";
      const sendButtonClass = isRunning ? "send iconButton stopSend" : "send iconButton";
      const sendButtonIcon = isRunning
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.6"></rect></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="m5 12 7-7 7 7"></path></svg>';
      const attachments = Array.isArray(chat.pendingAttachments) ? chat.pendingAttachments : [];
      const attachmentTray = attachments.length
        ? '<div class="attachmentTray">' + attachments.map(renderAttachmentChip).join("") + '</div>'
        : "";
      const contextInfo = contextUsageInfo(chat, settings.model);
      chat.settings = settings;

      return \`
        <article class="chat" data-chat-id="\${escapeAttr(chat.id)}">
          <header class="chatHeader">
            <input class="title" value="\${escapeAttr(chat.title)}" title="\${escapeAttr(statusTitle)}" />
            <div class="actions">
              <span class="status \${escapeAttr(chat.status)}" title="\${escapeAttr(chat.status)}">\${escapeHtml(statusLabel(chat.status))}</span>
              <button class="iconButton secondary" data-action="clear" title="Clear messages">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7h16"></path>
                  <path d="M10 11v6"></path>
                  <path d="M14 11v6"></path>
                  <path d="M6 7l1 14h10l1-14"></path>
                  <path d="M9 7V4h6v3"></path>
                </svg>
              </button>
              <button class="iconButton secondary" data-action="info" title="Chat information">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 17v-6"></path>
                  <path d="M12 7h.01"></path>
                  <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"></path>
                </svg>
              </button>
              <button class="iconButton secondary" data-action="remove" title="Remove chat">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12"></path>
                  <path d="M18 6L6 18"></path>
                </svg>
              </button>
            </div>
          </header>
          <section class="messages">\${messages}</section>
          <footer class="composer">
            <div class="promptDock">
              \${attachmentTray}
              <textarea class="promptInput" rows="1" placeholder="Message Codex... \${sendShortcut} to send" \${isRunning ? "disabled" : ""}>\${escapeHtml(chat.draftPrompt || "")}</textarea>
              <div class="composerBar">
                <div class="composerLeft">
                  <button class="composerIcon" type="button" data-action="attach" title="Attach files" \${isRunning ? "disabled" : ""}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 5v14"></path>
                      <path d="M5 12h14"></path>
                    </svg>
                  </button>
                  <button class="composerIcon voiceInput\${voiceChatId === chat.id ? nativeWhisperStopping ? " stopping" : " listening" : ""}" type="button" data-action="voice" title="\${escapeAttr(voiceButtonTitle(chat.id))}" \${isRunning || board.speechToText === "off" ? "disabled" : ""}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"></path>
                      <path d="M19 10v1a7 7 0 0 1-14 0v-1"></path>
                      <path d="M12 18v3"></path>
                      <path d="M8 21h8"></path>
                    </svg>
                  </button>
                  <div class="composerSettings" aria-label="Codex prompt settings">
                    \${selectChip("sandbox", "Filesystem access", settings.sandbox, [
                      ["read-only", "Read access"],
                      ["workspace-write", "Write access"],
                      ["danger-full-access", "Full access"]
                    ], isRunning)}
                    \${selectChip("reasoning", "Reasoning effort", settings.reasoning, [
                      ["minimal", "Minimal"],
                      ["low", "Low"],
                      ["medium", "Medium"],
                      ["high", "High"],
                      ["xhigh", "Extra High"]
                    ], isRunning)}
                    \${selectChip("verbosity", "Response detail", settings.verbosity, [
                      ["low", "Short"],
                      ["medium", "Normal"],
                      ["high", "Full"]
                    ], isRunning)}
                    \${selectChip("webSearch", "Web search mode", settings.webSearch, [
                      ["disabled", "Web off"],
                      ["cached", "Web"],
                      ["live", "Live web"]
                    ], isRunning)}
                  </div>
                </div>
                <div class="composerRight">
                  \${renderContextIndicator(contextInfo)}
                  \${modelSelectChip(settings.model, isRunning)}
                  <button class="\${sendButtonClass}" title="\${sendButtonTitle}" aria-label="\${sendButtonTitle}">
                    \${sendButtonIcon}
                  </button>
                </div>
              </div>
            </div>
          </footer>
        </article>
      \`;
    }

    function renderChatMessages(chat) {
      const items = Array.isArray(chat.messages)
        ? chat.messages.filter((item) => !(item.role === "event" && item.kind === "thinking" && item.status === "running"))
        : [];
      const start = Number(chat.runStartedAt || 0);
      const end = Number(chat.runFinishedAt || 0);
      const insertAfter = turnDurationInsertIndex(items, start);
      let html = "";

      for (let index = 0; index < items.length; index += 1) {
        html += renderMessage(items[index], chat, index);
        if (index === insertAfter) {
          html += renderTurnDuration(start, end);
        }
      }

      if (insertAfter === -1 && chat.status === "running" && start && !end) {
        html += renderTurnDuration(start, 0);
      }

      if (chat.status === "running" && chat.isThinking) {
        html += renderThinkingLine();
      }

      return html;
    }

    function renderThinkingLine() {
      return \`
        <div class="thinkingLine">
          <span>Thinking</span>
        </div>
      \`;
    }

    function turnDurationInsertIndex(messages, startedAt) {
      const start = Number(startedAt || 0);
      if (!start) {
        return -2;
      }

      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role === "user" && Number(message.at || 0) <= start) {
          return index;
        }
      }

      return -1;
    }

    function renderAttachmentChip(attachment) {
      const label = attachment.relativePath || attachment.name || "file";
      const title = (attachment.path || label) + (attachment.size ? " - " + formatBytes(attachment.size) : "");
      return \`
        <span class="attachmentChip" title="\${escapeAttr(title)}">
          <span>\${escapeHtml(label)}</span>
          <button class="attachmentRemove" type="button" data-remove-attachment="\${escapeAttr(attachment.id)}" title="Remove attachment" aria-label="Remove attachment">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8"></path>
              <path d="M12 4l-8 8"></path>
            </svg>
          </button>
        </span>
      \`;
    }

    function renderMessage(item, chat, index) {
      if (item.role === "changeSummary") {
        const title = item.title || item.text || "Edited files";
        const detail = item.detail || "Updated";
        return \`
          <div class="message changeSummary">
            <div class="changeCard" role="button" tabindex="0" aria-expanded="false" title="Toggle changed files">
              <span class="changeIcon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14"></path>
                  <path d="M5 12h14"></path>
                </svg>
              </span>
              <div>
                <div class="changeTitle">\${escapeHtml(title)}</div>
                <div class="changeMeta">\${escapeHtml(detail)}</div>
              </div>
              <span class="changeAction" title="Expand changes" aria-label="Expand changes">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path class="changeToggleVertical" d="M8 3.5v9"></path>
                  <path d="M3.5 8h9"></path>
                </svg>
              </span>
            </div>
            <div class="changeDetail">
              \${renderChangeDetails(item)}
            </div>
          </div>
        \`;
      }

      if (item.role === "event") {
        const title = item.title || item.text || "Codex event";
        const detail = item.detail || item.text || "";
        const preview = compactPreview(detail);
        const eventDetail = item.kind === "files"
          ? renderChangeDetails(item)
          : (detail ? '<pre>' + escapeHtml(detail) + '</pre>' : '<div class="eventEmpty">No additional details</div>');
        return \`
          <div class="message event \${escapeAttr(item.kind || "event")} \${escapeAttr(item.status || "info")}">
            <div class="eventSummary" role="button" tabindex="0" aria-expanded="false" title="Toggle details">
              <span class="eventBadge">\${escapeHtml(eventBadge(item.kind, item.status))}</span>
              <span class="eventTitle">\${escapeHtml(title)}</span>
              \${preview ? '<span class="eventPreview">' + escapeHtml(preview) + '</span>' : ''}
              <button class="eventToggle" type="button" tabindex="-1" title="Expand details" aria-label="Expand details">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path class="eventToggleVertical" d="M8 3.5v9"></path>
                  <path d="M3.5 8h9"></path>
                </svg>
              </button>
            </div>
            <div class="eventDetail">
              \${eventDetail}
            </div>
          </div>
        \`;
      }

      if (item.role === "user") {
        return \`
          <div class="message user">
            \${renderPlainText(item.text)}
            <div class="userMeta">
              <span title="\${escapeAttr(formatDateTime(item.at))}">\${escapeHtml(formatMessageTime(item.at))}</span>
              <button class="copyMessage" type="button" data-copy-chat="\${escapeAttr(chat.id)}" data-copy-index="\${escapeAttr(index)}" title="Copy message" aria-label="Copy message">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="8" y="8" width="10" height="10" rx="2"></rect>
                  <path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
          </div>
        \`;
      }

      const html = item.role === "assistant" ? renderMarkdown(item.text) : renderPlainText(item.text);
      return \`<div class="message \${escapeAttr(item.role)}">\${html}</div>\`;
    }

    function renderTurnDuration(startedAt, finishedAt) {
      const start = Number(startedAt || 0);
      const end = Number(finishedAt || 0);
      if (!start) {
        return "";
      }

      const label = end ? "Worked for " : "Working for ";
      const duration = formatDuration((end || Date.now()) - start);
      return \`
        <div class="turnDuration" data-duration-start="\${escapeAttr(start)}" data-duration-end="\${escapeAttr(end)}">
          <span data-duration-label="true">\${escapeHtml(label + duration)}</span>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 3.5 10.5 8 6 12.5"></path>
          </svg>
        </div>
      \`;
    }

    function statusLabel(status) {
      if (status === "running") {
        return "Run";
      }
      if (status === "error") {
        return "Error";
      }
      if (status === "opened") {
        return "Open";
      }
      return "Idle";
    }

    function eventBadge(kind, status) {
      if (kind === "files" && status === "running") {
        return "EDIT";
      }
      if (kind === "thinking" && status === "running") {
        return "THINK";
      }
      if (status === "running") {
        return "RUN";
      }
      if (status === "error") {
        return "ERR";
      }
      if (kind === "command") {
        return "CMD";
      }
      if (kind === "files") {
        return "FILE";
      }
      if (kind === "web") {
        return "WEB";
      }
      if (kind === "tool") {
        return "TOOL";
      }
      if (kind === "thinking") {
        return "THINK";
      }
      return "INFO";
    }

    function compactPreview(value) {
      const text = String(value || "").replace(/\\s+/g, " ").trim();
      if (!text) {
        return "";
      }

      return text.length > 96 ? text.slice(0, 96) + "..." : text;
    }

    function renderPlainText(value) {
      return '<p>' + escapeHtml(value).replace(/\\n/g, "<br>") + '</p>';
    }

    function renderMarkdown(value) {
      const text = String(value || "");
      const parts = [];
      const ticks = String.fromCharCode(96, 96, 96);
      const tick = String.fromCharCode(96);
      const fence = new RegExp(ticks + "([^\\\\n" + tick + "]*)\\\\n?([\\\\s\\\\S]*?)" + ticks, "g");
      let lastIndex = 0;
      let match;

      while ((match = fence.exec(text)) !== null) {
        if (match.index > lastIndex) {
          parts.push(renderMarkdownText(text.slice(lastIndex, match.index)));
        }

        const lang = String(match[1] || "").trim();
        const code = match[2] || "";
        parts.push('<pre><code' + (lang ? ' data-lang="' + escapeAttr(lang) + '"' : '') + '>' + escapeHtml(code.trim()) + '</code></pre>');
        lastIndex = fence.lastIndex;
      }

      if (lastIndex < text.length) {
        parts.push(renderMarkdownText(text.slice(lastIndex)));
      }

      return parts.join("");
    }

    function renderMarkdownText(value) {
      const blocks = String(value || "").replace(/^\\n+|\\n+$/g, "").split(/\\n{2,}/);
      if (!blocks.length || (blocks.length === 1 && !blocks[0])) {
        return "";
      }

      return blocks.map((block) => {
        const lines = block.split(/\\n/).filter((line) => line.trim().length);
        if (!lines.length) {
          return "";
        }

        if (lines.every((line) => /^\\s*[-*_]{3,}\\s*$/.test(line))) {
          return "<hr>";
        }

        if (lines.every((line) => /^    /.test(line))) {
          return '<pre><code>' + escapeHtml(lines.map((line) => line.replace(/^    /, "")).join("\\n")) + '</code></pre>';
        }

        if (lines[0].trim() === "\\\\[" && lines[lines.length - 1].trim() === "\\\\]") {
          return '<div class="mathBlock">' + escapeHtml(lines.slice(1, -1).join("\\n")) + '</div>';
        }

        if (isMarkdownTable(lines)) {
          return renderMarkdownTable(lines);
        }

        if (isHtmlDetailsBlock(lines)) {
          return renderHtmlDetailsBlock(lines);
        }

        if (isDefinitionList(lines)) {
          return renderDefinitionList(lines);
        }

        if (lines.every((line) => /^\\s*>\\s?/.test(line))) {
          return '<blockquote>' + renderMarkdownText(lines.map((line) => line.replace(/^\\s*>\\s?/, "")).join("\\n")) + '</blockquote>';
        }

        if (lines.every((line) => parseMarkdownListItem(line))) {
          return renderMarkdownList(lines);
        }

        if (/^#{1,4}\\s+/.test(lines[0]) && lines.length === 1) {
          const level = Math.min(4, lines[0].match(/^#+/)[0].length + 2);
          return '<h' + level + '>' + renderInlineMarkdown(lines[0].replace(/^#{1,4}\\s+/, "")) + '</h' + level + '>';
        }

        return renderMixedMarkdownLines(lines);
      }).join("");
    }

    function renderMixedMarkdownLines(lines) {
      let html = "";
      let paragraph = [];
      let index = 0;

      const flushParagraph = () => {
        if (!paragraph.length) {
          return;
        }

        html += '<p>' + paragraph.map(renderInlineMarkdown).join("<br>") + '</p>';
        paragraph = [];
      };

      while (index < lines.length) {
        if (parseMarkdownListItem(lines[index])) {
          flushParagraph();
          const listLines = [];
          while (index < lines.length && parseMarkdownListItem(lines[index])) {
            listLines.push(lines[index]);
            index += 1;
          }
          html += renderMarkdownList(listLines);
          continue;
        }

        paragraph.push(lines[index]);
        index += 1;
      }

      flushParagraph();
      return html;
    }

    function isMarkdownTable(lines) {
      if (lines.length < 2 || !lines[0].includes("|")) {
        return false;
      }

      const separator = splitMarkdownTableRow(lines[1]);
      return separator.length > 1 && separator.every((cell) => /^:?-{3,}:?$/.test(cell));
    }

    function renderMarkdownTable(lines) {
      const headers = splitMarkdownTableRow(lines[0]);
      const rows = lines.slice(2).map(splitMarkdownTableRow).filter((row) => row.length);
      const head = '<thead><tr>' + headers.map((cell) => '<th>' + renderInlineMarkdown(cell) + '</th>').join("") + '</tr></thead>';
      const body = rows.length ? '<tbody>' + rows.map((row) => {
        const cells = headers.map((_, index) => row[index] || "");
        return '<tr>' + cells.map((cell) => '<td>' + renderInlineMarkdown(cell) + '</td>').join("") + '</tr>';
      }).join("") + '</tbody>' : "";

      return '<table>' + head + body + '</table>';
    }

    function splitMarkdownTableRow(line) {
      return String(line || "")
        .trim()
        .replace(/^\\|/, "")
        .replace(/\\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
    }

    function parseMarkdownListItem(line) {
      const source = String(line || "");
      let match = source.match(/^(\\s*)[-*]\\s+\\[([ xX])\\]\\s+(.+)$/);
      if (match) {
        return {
          indent: match[1].replace(/\\t/g, "    ").length,
          type: "task",
          checked: /x/i.test(match[2]),
          text: match[3]
        };
      }

      match = source.match(/^(\\s*)[-*]\\s+(.+)$/);
      if (match) {
        return {
          indent: match[1].replace(/\\t/g, "    ").length,
          type: "ul",
          checked: false,
          text: match[2]
        };
      }

      match = source.match(/^(\\s*)\\d+[.)]\\s+(.+)$/);
      if (match) {
        return {
          indent: match[1].replace(/\\t/g, "    ").length,
          type: "ol",
          checked: false,
          text: match[2]
        };
      }

      return null;
    }

    function renderMarkdownList(lines) {
      const items = lines.map(parseMarkdownListItem).filter(Boolean);
      let html = "";
      let index = 0;

      while (index < items.length) {
        const result = renderMarkdownListLevel(items, index, items[index].indent, items[index].type);
        html += result.html;
        index = result.next;
      }

      return html;
    }

    function renderMarkdownListLevel(items, start, indent, type) {
      const tag = type === "ol" ? "ol" : "ul";
      const className = type === "task" ? ' class="taskList"' : "";
      let html = "<" + tag + className + ">";
      let index = start;

      while (index < items.length) {
        const item = items[index];
        if (item.indent < indent || (item.indent === indent && item.type !== type)) {
          break;
        }
        if (item.indent > indent) {
          break;
        }

        let content = renderMarkdownListItemContent(item);
        index += 1;

        while (index < items.length && items[index].indent > indent) {
          const child = renderMarkdownListLevel(items, index, items[index].indent, items[index].type);
          content += child.html;
          index = child.next;
        }

        html += "<li>" + content + "</li>";
      }

      html += "</" + tag + ">";
      return { html, next: index };
    }

    function renderMarkdownListItemContent(item) {
      if (item.type !== "task") {
        return renderInlineMarkdown(item.text);
      }

      const checkedClass = item.checked ? " checked" : "";
      const check = item.checked ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"></path></svg>' : "";
      return '<span class="taskBox' + checkedClass + '" aria-hidden="true">' + check + '</span><span>' + renderInlineMarkdown(item.text) + '</span>';
    }

    function isDefinitionList(lines) {
      if (lines.length < 2 || lines.length % 2 !== 0) {
        return false;
      }

      for (let index = 1; index < lines.length; index += 2) {
        if (!/^\\s*:\\s+/.test(lines[index])) {
          return false;
        }
      }

      return true;
    }

    function renderDefinitionList(lines) {
      let html = "<dl>";
      for (let index = 0; index < lines.length; index += 2) {
        html += "<dt>" + renderInlineMarkdown(lines[index].trim()) + "</dt>";
        html += "<dd>" + renderInlineMarkdown(lines[index + 1].replace(/^\\s*:\\s+/, "")) + "</dd>";
      }
      return html + "</dl>";
    }

    function isHtmlDetailsBlock(lines) {
      return /^\\s*<details>\\s*$/i.test(lines[0]) && /^\\s*<\\/details>\\s*$/i.test(lines[lines.length - 1]);
    }

    function renderHtmlDetailsBlock(lines) {
      const inner = lines.slice(1, -1);
      let summary = "Details";
      const body = [];

      for (const line of inner) {
        const match = line.match(/^\\s*<summary>([\\s\\S]*)<\\/summary>\\s*$/i);
        if (match) {
          summary = match[1];
        } else {
          body.push(line);
        }
      }

      return '<details><summary>' + renderInlineMarkdown(summary) + '</summary>' + renderMarkdownText(body.join("\\n")) + '</details>';
    }

    function renderInlineMarkdown(value) {
      const tick = String.fromCharCode(96);
      const inlineCode = new RegExp(tick + "([^" + tick + "]+)" + tick, "g");
      const link = /(!?)\\[([^\\]]+)\\]\\((<[^>]+>|[^)]+)\\)/g;
      const source = String(value || "");
      let output = "";
      let lastIndex = 0;
      let match;

      while ((match = link.exec(source)) !== null) {
        if (match.index > lastIndex) {
          output += renderBasicInline(source.slice(lastIndex, match.index), inlineCode);
        }

        const isImage = match[1] === "!";
        const label = match[2] || match[3] || "file";
        const target = normalizeMarkdownLinkTarget(match[3]);

        if (isImage) {
          output += isPreviewableImageTarget(target)
            ? renderImagePreview(target, label, inlineCode)
            : '<span class="imageReference" title="' + escapeAttr(target) + '">Image: <strong>' + renderBasicInline(label, inlineCode) + '</strong></span>';
        } else if (/^https?:\\/\\//i.test(target)) {
          output += '<button class="inlineLink" data-open-url="' + escapeAttr(target) + '" title="' + escapeAttr(target) + '">' + renderBasicInline(label, inlineCode) + '</button>';
        } else {
          output += '<button class="inlineLink" data-open-file="' + escapeAttr(target) + '" title="' + escapeAttr(target) + '">' + renderBasicInline(label, inlineCode) + '</button>';
        }
        lastIndex = link.lastIndex;
      }

      if (lastIndex < source.length) {
        output += renderBasicInline(source.slice(lastIndex), inlineCode);
      }

      return output;
    }

    function renderBasicInline(value, inlineCode) {
      const source = String(value || "");
      let output = "";
      let lastIndex = 0;
      let match;

      inlineCode.lastIndex = 0;
      while ((match = inlineCode.exec(source)) !== null) {
        if (match.index > lastIndex) {
          output += renderInlineDecorations(escapeHtml(source.slice(lastIndex, match.index)));
        }

        output += isPreviewableImageTarget(match[1])
          ? renderImagePreview(match[1], imageLabel(match[1]), inlineCode)
          : "<code>" + escapeHtml(match[1]) + "</code>";
        lastIndex = inlineCode.lastIndex;
      }

      if (lastIndex < source.length) {
        output += renderInlineDecorations(escapeHtml(source.slice(lastIndex)));
      }

      return output;
    }

    function isPreviewableImageTarget(value) {
      const target = String(value || "").trim();
      if (!target || /^https?:\\/\\//i.test(target)) {
        return false;
      }

      return /\\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i.test(target);
    }

    function renderImagePreview(target, label, inlineCode) {
      const caption = label || imageLabel(target);
      return '<span class="imagePreviewFrame">' +
        '<button class="imagePreviewButton" type="button" data-image-open="true" data-image-path="' + escapeAttr(target) + '" data-image-caption="' + escapeAttr(caption) + '" title="Open image preview: ' + escapeAttr(target) + '">' +
        '<span class="imagePreviewPlaceholder">Loading image...</span>' +
        '<img hidden alt="' + escapeAttr(caption) + '">' +
        '<span class="imagePreviewCaption">' + renderInlineDecorations(escapeHtml(caption)) + '</span>' +
        '</button>' +
        '</span>';
    }

    function renderChangeDetails(item) {
      const changes = Array.isArray(item.changes) ? item.changes.filter((change) => change.path) : [];
      const rows = changes.length
        ? changes.map(renderChangeFileRow).join("")
        : "";
      const diff = changes.map((change) => change.diff).filter(Boolean).join("\\n\\n");
      const body = diff
        ? renderDiffBlock(diff)
        : '<div class="changeEmpty">No textual diff was available for this file change.</div>';

      return rows + body;
    }

    function renderDiffBlock(value) {
      const lines = String(value || "")
        .replace(/\\r\\n/g, "\\n")
        .replace(/\\r/g, "\\n")
        .split("\\n")
        .filter((line) => !/^(---|\\+\\+\\+)\\s/.test(line))
        .map(renderDiffLine)
        .join("");
      return '<pre class="changeDiff">' + lines + '</pre>';
    }

    function renderDiffLine(line) {
      let cls = "diffContext";
      if (/^@@/.test(line)) {
        cls = "diffHunk";
      } else if (/^\\+/.test(line)) {
        cls = "diffAdd";
      } else if (/^-/.test(line)) {
        cls = "diffDelete";
      }

      return '<span class="diffLine ' + cls + '">' + escapeHtml(line || " ") + '</span>';
    }

    function renderChangeFileRow(change) {
      const counts = changeCountsHtml(change);
      return \`
        <div class="changeFileRow">
          <span class="changeFilePath" title="\${escapeAttr(change.path)}">\${escapeHtml(change.path)}</span>
          <span class="changeCounts">\${counts || escapeHtml(change.kind || "edited")}</span>
        </div>
      \`;
    }

    function changeCountsHtml(change) {
      const parts = [];
      if (change.additions !== null && change.additions !== undefined) {
        parts.push('<span class="changeAdd">+' + escapeHtml(change.additions) + '</span>');
      }
      if (change.deletions !== null && change.deletions !== undefined) {
        parts.push('<span class="changeDelete">-' + escapeHtml(change.deletions) + '</span>');
      }
      return parts.join(" ");
    }

    function imageLabel(value) {
      const clean = String(value || "").replace(/[?#].*$/, "");
      return clean.split(/[\\\\/]/).pop() || clean || "image";
    }

    function renderInlineDecorations(value) {
      return renderAutolinks(renderAllowedInlineHtml(renderBold(renderInlineMath(value))));
    }

    function renderInlineMath(value) {
      return String(value).replace(/\\\\\\(([^\\n]+?)\\\\\\)/g, '<span class="mathInline">$1</span>');
    }

    function renderBold(value) {
      return String(value)
        .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>")
        .replace(/~~([^~]+)~~/g, "<s>$1</s>")
        .replace(/(^|[^*])\\*([^*\\n]+)\\*/g, "$1<em>$2</em>");
    }

    function renderAllowedInlineHtml(value) {
      return String(value)
        .replace(/&lt;(kbd|sub|sup|mark)&gt;([\\s\\S]*?)&lt;\\/\\1&gt;/gi, "<$1>$2</$1>")
        .replace(/&lt;br\\s*\\/?&gt;/gi, "<br>");
    }

    function renderAutolinks(value) {
      return String(value)
        .replace(/(^|[\\s(])((?:https?:\\/\\/)[^\\s<]+)/g, (match, prefix, url) => {
          const clean = url.replace(/[.,;:!?)]$/, "");
          const suffix = url.slice(clean.length);
          return prefix + '<button class="inlineLink" data-open-url="' + escapeAttr(clean) + '" title="' + escapeAttr(clean) + '">' + escapeHtml(clean) + '</button>' + suffix;
        })
        .replace(/(^|[\\s(])([A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,})/gi, '$1<span class="inlineEmail">$2</span>');
    }


    function normalizeMarkdownLinkTarget(value) {
      let target = String(value || "").trim();
      target = target.replace(/^<|>$/g, "");
      target = target.replace(/&lt;|&gt;/g, "");
      if (/^\\/[A-Za-z]:/.test(target)) {
        target = target.slice(1);
      }

      return target;
    }

    function addChat() {
      state.chats.push(createChat(state.chats.length + 1));
      refreshBoardGrid({ preserveBoardScroll: true });
      persist();
    }

    function workspaceList() {
      if (!Array.isArray(state.workspaces)) {
        state.workspaces = [];
      }
      if (!state.workspaces.length) {
        const workspace = activeWorkspaceProfile();
        if (workspace && !state.workspaces.some((item) => item.id === workspace.id)) {
          state.workspaces.push(workspace);
        }
      }
      return state.workspaces;
    }

    function createWorkspaceProfileAndSwitch(selectedPath) {
      syncActiveWorkspaceFromState();
      const workspacePath = normalizeProjectPath(selectedPath || config.workspacePath || "");
      const baseName = projectFolderName(workspacePath) || "Workspace";
      const boardSettings = normalizeBoardSettings({
        chatsPerRow: 2,
        chatsPerColumn: 2,
        currentWorkspacePath: workspacePath
      });
      const workspace = createWorkspaceProfile({
        id: newId(),
        name: uniqueWorkspaceName(baseName),
        path: workspacePath,
        boardSettings,
        chats: [
          createChatForWorkspace(1, workspacePath),
          createChatForWorkspace(2, workspacePath),
          createChatForWorkspace(3, workspacePath),
          createChatForWorkspace(4, workspacePath)
        ]
      }, workspaceList().length);
      workspaceList().push(workspace);
      switchWorkspace(workspace.id);
    }

    function uniqueWorkspaceName(baseName) {
      const base = String(baseName || "Workspace").trim() || "Workspace";
      const used = new Set(workspaceList().map((workspace) => String(workspace.name || "")));
      if (!used.has(base)) {
        return base;
      }

      let index = 2;
      while (used.has(base + " " + index)) {
        index += 1;
      }
      return base + " " + index;
    }

    function switchWorkspace(workspaceId) {
      if (!workspaceId || workspaceId === state.activeWorkspaceId) {
        return;
      }

      syncActiveWorkspaceFromState();
      const workspace = workspaceList().find((item) => item.id === workspaceId);
      if (!workspace) {
        return;
      }

      state.activeWorkspaceId = workspace.id;
      state.selectedChatId = workspace.selectedChatId || null;
      state.boardSettings = cloneBoardSettings(workspace.boardSettings);
      state.chats = workspace.chats.length
        ? workspace.chats.map((chat) => cloneChat(chat, workspace.path))
        : [createChatForWorkspace(1, workspace.path)];
      activeChatInfoId = null;
      chatScrollState = new Map();
      chatAutoScrollPaused = new Set();
      chatPausedScrollTop = new Map();
      chatStickyScroll = new Set();
      render();
      persist();
    }

    function applyWorkspaceImport(importedState, sourcePath) {
      state = normalizeState(importedState || {});
      syncActiveWorkspaceFromState();
      activeChatInfoId = null;
      chatScrollState = new Map();
      chatAutoScrollPaused = new Set();
      chatPausedScrollTop = new Map();
      chatStickyScroll = new Set();
      render();
      persist();
      showToast("Imported Codex Max workspaces" + (sourcePath ? " from " + sourcePath : "") + ".");
    }

    function applyWorkspacePreset(preset, sourcePath) {
      const normalized = normalizeWorkspacePreset(preset || {});
      state.boardSettings = cloneBoardSettings(normalized.boardSettings);
      const workspace = activeWorkspaceProfile();
      if (workspace) {
        workspace.name = normalized.name || workspace.name;
        workspace.path = currentWorkspacePathFromSettings(normalized.boardSettings);
        workspace.boardSettings = cloneBoardSettings(normalized.boardSettings);
      }
      refreshBoardAfterSettingsChange();
      persist();
      showToast("Applied workspace preset" + (sourcePath ? " from " + sourcePath : "") + ".");
    }

    function currentWorkspacePreset() {
      const workspace = activeWorkspaceProfile();
      return {
        name: workspace && workspace.name ? workspace.name : "Workspace preset",
        projectName: projectFolderName(currentWorkspacePath()) || "",
        boardSettings: cloneBoardSettings(state.boardSettings)
      };
    }

    function normalizeWorkspacePreset(preset) {
      const boardSettings = normalizeBoardSettings(preset && preset.boardSettings || preset || {});
      return {
        name: String(preset && preset.name || "Workspace preset"),
        projectName: String(preset && preset.projectName || ""),
        boardSettings
      };
    }

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

    function bindFileDrop(card, chatId, isRunning) {
      if (!card || isRunning) {
        return;
      }
      if (card.dataset.dropBound === "true") {
        return;
      }

      card.dataset.dropBound = "true";

      card.addEventListener("dragover", (event) => {
        const current = state.chats.find((chat) => chat.id === chatId);
        if (current && current.status === "running") {
          return;
        }
        if (!hasDraggedFiles(event)) {
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        card.classList.add("dragOver");
      });

      card.addEventListener("dragleave", (event) => {
        if (!event.relatedTarget || !card.contains(event.relatedTarget)) {
          card.classList.remove("dragOver");
        }
      });

      card.addEventListener("drop", (event) => {
        const current = state.chats.find((chat) => chat.id === chatId);
        if (current && current.status === "running") {
          return;
        }
        if (!hasDraggedFiles(event)) {
          return;
        }

        event.preventDefault();
        card.classList.remove("dragOver");
        handleDroppedFiles(chatId, event.dataTransfer.files);
      });
    }

    function hasDraggedFiles(event) {
      const transfer = event && event.dataTransfer;
      const types = transfer && transfer.types ? Array.prototype.slice.call(transfer.types) : [];
      return types.includes("Files");
    }

    function handleDroppedFiles(chatId, fileList) {
      const files = Array.from(fileList || []).filter((file) => file && file.name);
      if (!files.length) {
        return;
      }

      Promise.all(files.map(readDroppedFile)).then((attachments) => {
        attachFiles(chatId, attachments.filter(Boolean));
      }).catch((error) => {
        addMessage(chatId, "error", "Could not attach dropped file: " + (error.message || error));
      });
    }

    function readDroppedFile(file) {
      return new Promise((resolve) => {
        const size = Number(file.size || 0);
        const truncated = size > MAX_ATTACHMENT_BYTES;
        const reader = new FileReader();
        const blob = truncated ? file.slice(0, MAX_ATTACHMENT_BYTES) : file;

        reader.onload = () => {
          const content = typeof reader.result === "string" ? reader.result : "";
          resolve(normalizeAttachment({
            id: newId(),
            name: file.name,
            path: "",
            relativePath: "",
            size,
            isText: true,
            truncated,
            content
          }));
        };

        reader.onerror = () => {
          resolve(normalizeAttachment({
            id: newId(),
            name: file.name,
            path: "",
            relativePath: "",
            size,
            isText: false,
            truncated,
            content: ""
          }));
        };

        reader.readAsText(blob);
      });
    }

    function attachFiles(chatId, attachments) {
      const clean = Array.isArray(attachments) ? attachments.map(normalizeAttachment).filter((item) => item.name) : [];
      if (!clean.length) {
        return;
      }

      updateChat(chatId, (chat) => {
        const existing = Array.isArray(chat.pendingAttachments) ? chat.pendingAttachments : [];
        chat.pendingAttachments = existing.concat(clean).slice(-20);
      }, { render: "chrome" });
    }

    function removeAttachment(chatId, attachmentId) {
      updateChat(chatId, (chat) => {
        chat.pendingAttachments = (chat.pendingAttachments || []).filter((item) => item.id !== attachmentId);
      }, { render: "chrome" });
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

    function speechRecognitionConstructor() {
      return window.SpeechRecognition || window.webkitSpeechRecognition || null;
    }

    function voiceShortcutLabel(value) {
      const shortcut = normalizeVoiceShortcut(value);
      if (shortcut === "alt-v") {
        return "Alt+V";
      }
      if (shortcut === "ctrl-shift-v") {
        return "Ctrl+Shift+V";
      }
      if (shortcut === "ctrl-m") {
        return "Ctrl+M";
      }
      return "Off";
    }

    function voiceButtonTitle(chatId) {
      const board = normalizeBoardSettings(state.boardSettings);
      const shortcut = voiceShortcutLabel(board.voiceShortcut);
      if (board.speechToText === "off") {
        return "Voice input is disabled in workspace settings";
      }
      if (board.speechToText === "browser" && !speechRecognitionConstructor()) {
        return "Voice input unavailable in this VS Code webview";
      }
      if (voiceChatId === chatId) {
        if (nativeWhisperStopping) {
          return "Finishing Local Whisper transcription...";
        }
        return (board.speechToText === "local-whisper" ? "Stop Local Whisper live input" : "Stop voice input") + (shortcut === "Off" ? "" : " (" + shortcut + ")");
      }
      const engine = board.speechToText === "local-whisper" ? "Local Whisper" : "Voice input";
      return engine + (shortcut === "Off" ? "" : " (" + shortcut + ")");
    }

    function toggleVoiceInput(chatId) {
      if ((voiceRecognition || localVoiceSession || nativeWhisperLive || nativeWhisperStopping) && voiceChatId === chatId) {
        stopVoiceInput();
        return;
      }

      startVoiceInput(chatId);
    }

    function startVoiceInput(chatId) {
      if (nativeWhisperStopping) {
        return;
      }
      stopVoiceInput();
      const board = normalizeBoardSettings(state.boardSettings);
      const Recognition = speechRecognitionConstructor();
      const chat = state.chats.find((item) => item.id === chatId);
      const card = document.querySelector('[data-chat-id="' + chatId + '"]');
      const textarea = card ? card.querySelector(".promptInput") : null;
      if (board.speechToText === "off") {
        addVoiceActivity(chatId, "Voice input is disabled in workspace settings.");
        return;
      }
      if (board.speechToText === "local-whisper") {
        startLocalWhisperInput(chatId, chat, textarea, board);
        return;
      }
      if (!Recognition || !chat || !textarea || chat.status === "running") {
        if (!Recognition) {
          addVoiceActivity(chatId, "Voice input is not available in this VS Code webview. Current engine: Browser Web Speech.");
        }
        return;
      }

      const recognition = new Recognition();
      voiceRecognition = recognition;
      voiceChatId = chatId;
      voiceBaseText = textarea.value.trim();

      recognition.lang = navigator.language || "ru-RU";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event) => {
        let transcript = "";
        for (let index = 0; index < event.results.length; index += 1) {
          transcript += event.results[index][0] && event.results[index][0].transcript
            ? event.results[index][0].transcript
            : "";
        }

        const nextText = [voiceBaseText, transcript.trim()].filter(Boolean).join(" ");
        textarea.value = nextText;
        chat.draftPrompt = nextText;
        chat.updatedAt = Date.now();
        resizePromptInput(textarea);
        persist();
      };

      recognition.onerror = (event) => {
        const reason = event && event.error ? String(event.error) : "recognition error";
        addVoiceActivity(chatId, "Voice input stopped: " + reason + ".");
        stopVoiceInput(false);
      };

      recognition.onend = () => {
        if (voiceRecognition === recognition) {
          stopVoiceInput(false);
        }
      };

      updateVoiceButtons();
      try {
        recognition.start();
        textarea.focus();
      } catch {
        addVoiceActivity(chatId, "Voice input could not be started in this VS Code webview.");
        stopVoiceInput(false);
      }
    }

    function startLocalWhisperInput(chatId, chat, textarea, board) {
      if (!chat || !textarea || chat.status === "running") {
        return;
      }

      voiceChatId = chatId;
      voiceBaseText = textarea.value.trim();
      nativeWhisperLive = true;
      nativeWhisperStopping = false;
      nativeWhisperChunks = [];
      updateVoiceButtons();
      textarea.focus();
      vscode.postMessage({
        type: "startWhisperLive",
        chatId,
        modelId: board.localWhisperModel,
        captureId: board.localWhisperCaptureId
      });
    }

    function finishLocalWhisperInput(session, shouldTranscribe) {
      try {
        session.processor.disconnect();
      } catch {}
      try {
        session.source.disconnect();
      } catch {}
      try {
        session.stream.getTracks().forEach((track) => track.stop());
      } catch {}
      try {
        session.audioContext.close();
      } catch {}

      if (!shouldTranscribe) {
        return;
      }

      const samples = mergeAudioChunks(session.chunks);
      if (!samples.length) {
        addVoiceActivity(session.chatId, "Local Whisper did not capture any audio.");
        return;
      }

      addVoiceActivity(session.chatId, "Local Whisper is transcribing...");
      const wav = encodeWav(samples, session.sampleRate);
      vscode.postMessage({
        type: "transcribeWhisperAudio",
        chatId: session.chatId,
        modelId: session.modelId,
        dataUri: "data:audio/wav;base64," + arrayBufferToBase64(wav)
      });
    }

    function mergeAudioChunks(chunks) {
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const output = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
      return output;
    }

    function encodeWav(samples, sampleRate) {
      const buffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(buffer);
      writeAscii(view, 0, "RIFF");
      view.setUint32(4, 36 + samples.length * 2, true);
      writeAscii(view, 8, "WAVE");
      writeAscii(view, 12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeAscii(view, 36, "data");
      view.setUint32(40, samples.length * 2, true);
      let offset = 44;
      for (let index = 0; index < samples.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, samples[index]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
      return buffer;
    }

    function writeAscii(view, offset, value) {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    }

    function arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const chunkSize = 0x8000;
      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
      }
      return btoa(binary);
    }

    function stopVoiceInput(callStop) {
      const recognition = voiceRecognition;
      const localSession = localVoiceSession;
      const nativeChatId = nativeWhisperLive || nativeWhisperStopping ? voiceChatId : "";
      voiceRecognition = null;
      localVoiceSession = null;
      if (nativeChatId && callStop !== false) {
        nativeWhisperLive = false;
        nativeWhisperStopping = true;
      } else {
        nativeWhisperLive = false;
        nativeWhisperStopping = false;
        voiceChatId = "";
        voiceBaseText = "";
        nativeWhisperChunks = [];
      }
      if (recognition && callStop !== false) {
        try {
          recognition.stop();
        } catch {
          // The browser speech engine may already be stopped.
        }
      }
      if (localSession) {
        finishLocalWhisperInput(localSession, callStop !== false);
      }
      if (nativeChatId && callStop !== false) {
        const board = normalizeBoardSettings(state.boardSettings);
        vscode.postMessage({
          type: "stopWhisperLive",
          chatId: nativeChatId,
          stopGraceMs: board.localWhisperStopGraceMs
        });
      }
      updateVoiceButtons();
    }

    function updateVoiceButtons() {
      const Recognition = speechRecognitionConstructor();
      const board = normalizeBoardSettings(state.boardSettings);
      for (const button of document.querySelectorAll("[data-action='voice']")) {
        const card = button.closest("[data-chat-id]");
        const active = card && card.dataset.chatId === voiceChatId;
        const unavailable = board.speechToText === "browser" && !Recognition;
        button.classList.toggle("listening", Boolean(active && !nativeWhisperStopping));
        button.classList.toggle("stopping", Boolean(active && nativeWhisperStopping));
        button.classList.toggle("unavailable", Boolean(unavailable));
        button.title = card ? voiceButtonTitle(card.dataset.chatId) : voiceButtonTitle("");
      }
    }

    function pickLocalWhisperAudioFile(chatId) {
      const board = normalizeBoardSettings(state.boardSettings);
      if (board.speechToText !== "local-whisper") {
        addVoiceActivity(chatId, "Select Local Whisper in Board settings before transcribing audio files.");
        return;
      }

      vscode.postMessage({
        type: "pickWhisperAudioFile",
        chatId,
        modelId: board.localWhisperModel
      });
    }

    function addVoiceActivity(chatId, text) {
      const chat = state.chats.find((item) => item.id === chatId);
      if (!chat) {
        return;
      }

      chat.messages.push({
        role: "activity",
        text,
        at: Date.now()
      });
      chat.updatedAt = Date.now();
      scheduleChatCardRender(chatId);
      persist();
    }

    function applyVoiceTranscription(chatId, text) {
      const chat = state.chats.find((item) => item.id === chatId);
      const card = document.querySelector('[data-chat-id="' + chatId + '"]');
      const textarea = card ? card.querySelector(".promptInput") : null;
      const transcript = String(text || "").trim();
      if (!chat || !textarea || !transcript) {
        addVoiceActivity(chatId, "Local Whisper returned an empty transcript.");
        return;
      }

      const base = textarea.value.trim() || voiceBaseText;
      const nextText = [base, transcript].filter(Boolean).join(" ");
      textarea.value = nextText;
      chat.draftPrompt = nextText;
      chat.updatedAt = Date.now();
      resizePromptInput(textarea);
      textarea.focus();
      persist();
    }

    function applyWhisperLiveText(chatId, text) {
      const chat = state.chats.find((item) => item.id === chatId);
      const card = document.querySelector('[data-chat-id="' + chatId + '"]');
      const textarea = card ? card.querySelector(".promptInput") : null;
      const chunk = collapseWhisperRepeats(String(text || "").trim());
      if (!chat || !textarea || !chunk) {
        return;
      }

      const lastChunk = nativeWhisperChunks[nativeWhisperChunks.length - 1] || "";
      if (lastChunk === chunk) {
        return;
      }

      const mergedWithLast = lastChunk ? mergeWhisperChunks(lastChunk, chunk) : "";
      if (mergedWithLast) {
        nativeWhisperChunks[nativeWhisperChunks.length - 1] = mergedWithLast;
      } else {
        const duplicateIndex = findSimilarWhisperChunk(nativeWhisperChunks, chunk);
        if (duplicateIndex >= 0) {
          const previous = nativeWhisperChunks[duplicateIndex];
          nativeWhisperChunks[duplicateIndex] = collapseWhisperRepeats(chooseBetterWhisperChunk(previous, chunk));
        } else if (lastChunk && (chunk.startsWith(lastChunk) || lastChunk.startsWith(chunk) || whisperChunksOverlap(lastChunk, chunk))) {
          nativeWhisperChunks[nativeWhisperChunks.length - 1] = collapseWhisperRepeats(chooseBetterWhisperChunk(lastChunk, chunk));
        } else {
          nativeWhisperChunks.push(chunk);
        }
      }
      if (nativeWhisperChunks.length > 80) {
        nativeWhisperChunks = nativeWhisperChunks.slice(-80);
      }

      const base = voiceBaseText || "";
      const nextText = collapseWhisperRepeats([base, nativeWhisperChunks.join(" ")].filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
      textarea.value = nextText;
      chat.draftPrompt = nextText;
      chat.updatedAt = Date.now();
      resizePromptInput(textarea);
      persist();
    }

    function applyWhisperLiveFinalText(chatId, text) {
      const chat = state.chats.find((item) => item.id === chatId);
      const card = document.querySelector('[data-chat-id="' + chatId + '"]');
      const textarea = card ? card.querySelector(".promptInput") : null;
      const transcript = collapseWhisperRepeats(String(text || "").trim());
      if (isLikelyWhisperSubtitleCredit(transcript)) {
        return;
      }
      if (!chat || !textarea || !transcript) {
        return;
      }

      const finalTranscript = preserveLiveLeadingPrefix(nativeWhisperChunks.join(" "), transcript);
      nativeWhisperChunks = [finalTranscript];
      const base = voiceBaseText || "";
      const nextText = collapseWhisperRepeats([base, finalTranscript].filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
      textarea.value = nextText;
      chat.draftPrompt = nextText;
      chat.updatedAt = Date.now();
      resizePromptInput(textarea);
      persist();
    }

    function whisperChunksOverlap(previous, next) {
      const prevWords = String(previous || "").toLowerCase().split(/\s+/).filter(Boolean);
      const nextWords = String(next || "").toLowerCase().split(/\s+/).filter(Boolean);
      if (!prevWords.length || !nextWords.length) {
        return false;
      }

      const max = Math.min(5, prevWords.length, nextWords.length);
      for (let count = max; count >= 2; count -= 1) {
        if (prevWords.slice(-count).join(" ") === nextWords.slice(0, count).join(" ")) {
          return true;
        }
      }
      return false;
    }

    function preserveLiveLeadingPrefix(liveText, finalText) {
      const liveParts = String(liveText || "").trim().split(/\s+/).filter(Boolean);
      const finalParts = String(finalText || "").trim().split(/\s+/).filter(Boolean);
      if (liveParts.length < 2 || finalParts.length < 2) {
        return String(finalText || "").trim();
      }

      const liveWords = liveParts.map(normalizeWhisperWord);
      const finalWords = finalParts.map(normalizeWhisperWord);
      const maxSkip = Math.min(3, liveWords.length - 1);
      for (let skip = 1; skip <= maxSkip; skip += 1) {
        const prefix = liveParts.slice(0, skip);
        if (!isShortWhisperPrefix(prefix)) {
          continue;
        }

        const common = commonWhisperPrefix(liveWords.concat(finalWords), skip, liveWords.length);
        if (common >= Math.min(4, finalWords.length, liveWords.length - skip)) {
          return collapseWhisperRepeats(prefix.concat(finalParts).join(" "));
        }
      }

      return String(finalText || "").trim();
    }

    function isShortWhisperPrefix(parts) {
      const text = parts.join(" ").toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, "").trim();
      if (!text) {
        return false;
      }
      if (text.length <= 8) {
        return true;
      }
      return /^(ну|а|и|так|да|вот|ладно|короче)(\s|$)/i.test(text);
    }

    function mergeWhisperChunks(previous, next) {
      const prevParts = String(previous || "").trim().split(/\s+/).filter(Boolean);
      const nextParts = String(next || "").trim().split(/\s+/).filter(Boolean);
      if (prevParts.length < 3 || nextParts.length < 3) {
        return "";
      }

      const prevWords = prevParts.map(normalizeWhisperWord);
      const nextWords = nextParts.map(normalizeWhisperWord);
      const prefix = commonWhisperPrefix(prevWords.concat(nextWords), 0, prevWords.length);
      if (prefix >= 3 && prefix >= Math.min(prevWords.length, nextWords.length) * 0.55) {
        return collapseWhisperRepeats((nextParts.length >= prevParts.length ? nextParts : prevParts).join(" "));
      }

      const best = bestWhisperOverlap(prevWords, nextWords);
      if (!best || best.count < 3) {
        return "";
      }

      const prevCoverage = best.count / Math.max(1, prevWords.length - best.prevStart);
      const nextCoverage = best.count / Math.max(1, Math.min(nextWords.length, best.nextStart + best.count) - best.nextStart);
      if (prevCoverage < 0.55 || nextCoverage < 0.55) {
        return "";
      }

      if (best.nextStart === 0) {
        return collapseWhisperRepeats(prevParts.slice(0, best.prevStart).concat(nextParts).join(" "));
      }

      return collapseWhisperRepeats(prevParts.slice(0, best.prevStart + best.count).concat(nextParts.slice(best.nextStart + best.count)).join(" "));
    }

    function bestWhisperOverlap(prevWords, nextWords) {
      let best = null;
      const minPrevStart = Math.max(0, prevWords.length - 12);
      const maxNextStart = Math.min(4, nextWords.length - 1);
      for (let prevStart = minPrevStart; prevStart < prevWords.length; prevStart += 1) {
        for (let nextStart = 0; nextStart <= maxNextStart; nextStart += 1) {
          const count = commonWhisperPrefix(prevWords.concat(nextWords), prevStart, prevWords.length + nextStart);
          if (count < 2) {
            continue;
          }
          const reachesPrevEnd = prevStart + count >= prevWords.length - 1;
          if (!reachesPrevEnd) {
            continue;
          }
          if (!best || count > best.count || (count === best.count && nextStart < best.nextStart)) {
            best = { prevStart, nextStart, count };
          }
        }
      }
      return best;
    }

    function collapseWhisperRepeats(value) {
      let text = stripLikelyWhisperSubtitleCredits(String(value || "").replace(/\s+/g, " ").trim());
      if (!text) {
        return "";
      }

      for (let iteration = 0; iteration < 3; iteration += 1) {
        const collapsed = collapseRepeatedWhisperPrefix(text);
        if (collapsed === text) {
          break;
        }
        text = collapsed;
      }
      return text;
    }

    function isLikelyWhisperSubtitleCredit(value) {
      const normalized = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!normalized || normalized.length > 220) {
        return false;
      }

      return [
        /редактор(?:ы)?\s+субтитров/,
        /корректор\s+[а-яa-z.]+/,
        /субтитр(?:ы|ов).{0,24}(?:редактор|корректор|сделал|сделала|создал|создала)/,
        /(?:редакция|тайминг|перевод).{0,24}субтитр/,
        /subtitles?\s+(?:by|edited|editor|correction)/,
        /subtitle\s+(?:editor|correction|corrections)/
      ].some((pattern) => pattern.test(normalized));
    }

    function isLikelyWhisperSubtitleCredit(value) {
      const normalized = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!normalized || normalized.length > 260) {
        return false;
      }

      return whisperSubtitleCreditPatterns().some((pattern) => pattern.test(normalized));
    }

    function stripLikelyWhisperSubtitleCredits(value) {
      return String(value || "")
        .replace(whisperSubtitleCreditInfixPattern(), " ")
        .replace(whisperSubtitleCreditSuffixPattern(), "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function whisperSubtitleCreditPatterns() {
      return [
        /\u0441\u0443\u0431\u0442\u0438\u0442\u0440(?:\u044b|\u043e\u0432)\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432/u,
        /\u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440(?:\u044b)?\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432/u,
        /\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043e\u0440\s+[\u0430-\u044fa-z.]+/u,
        /\u0441\u0443\u0431\u0442\u0438\u0442\u0440(?:\u044b|\u043e\u0432).{0,32}(?:\u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440|\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043e\u0440|\u0441\u0434\u0435\u043b\u0430\u043b|\u0441\u0434\u0435\u043b\u0430\u043b\u0430|\u0441\u043e\u0437\u0434\u0430\u043b|\u0441\u043e\u0437\u0434\u0430\u043b\u0430)/u,
        /(?:\u0440\u0435\u0434\u0430\u043a\u0446\u0438\u044f|\u0442\u0430\u0439\u043c\u0438\u043d\u0433|\u043f\u0435\u0440\u0435\u0432\u043e\u0434).{0,32}\u0441\u0443\u0431\u0442\u0438\u0442\u0440/u,
        /subtitles?\s+(?:by|edited|editor|correction)/,
        /subtitle\s+(?:editor|correction|corrections)/
      ];
    }

    function whisperSubtitleCreditSuffixPattern() {
      return /\s*(?:\u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440(?:\u044b)?\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432[\s\S]*|\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043e\u0440\s+[\u0410-\u044f\u0401\u0451A-Za-z.\-\s]+|subtitles?\s+(?:by|edited|editor|correction)[\s\S]*|subtitle\s+(?:editor|correction|corrections)[\s\S]*)$/iu;
    }

    function whisperSubtitleCreditInfixPattern() {
      return /(?:\u0441\u0443\u0431\u0442\u0438\u0442\u0440(?:\u044b|\u043e\u0432)\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432\s+[\u0410-\u044f\u0401\u0451A-Za-z.]+|\u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440(?:\u044b)?\s+\u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432\s+[\u0410-\u044f\u0401\u0451A-Za-z.\-\s]{1,48}|\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043e\u0440\s+[\u0410-\u044f\u0401\u0451A-Za-z.]+|subtitles?\s+(?:by|edited|editor|correction)\s+[A-Za-z.\-\s]{1,48}|subtitle\s+(?:editor|correction|corrections)\s+[A-Za-z.\-\s]{1,48})/giu;
    }

    function isSilentWhisperStopError(value) {
      const normalized = String(value || "").toLowerCase();
      return normalized.includes("whisper returned an empty transcript")
        || normalized.includes("empty transcript")
        || isLikelyWhisperSubtitleCredit(normalized);
    }

    function collapseRepeatedWhisperPrefix(value) {
      const text = String(value || "").trim();
      const parts = text.split(/\s+/);
      if (parts.length < 6) {
        return text;
      }

      const words = parts.map(normalizeWhisperWord);
      const maxStart = Math.min(Math.floor(parts.length / 2), 14);
      for (let start = 3; start <= maxStart; start += 1) {
        const common = commonWhisperPrefix(words, 0, start);
        if (common < 3) {
          continue;
        }

        const coverage = common / start;
        if (coverage >= 0.62) {
          return parts.slice(start).join(" ").replace(/^[,.!?;:…-]+\s*/, "").trim();
        }
      }

      const sentenceMatch = /^(.{12,160}?[.!?…])\s+(.+)$/u.exec(text);
      if (sentenceMatch) {
        const firstWords = normalizeWhisperWords(sentenceMatch[1]);
        const restWords = normalizeWhisperWords(sentenceMatch[2]);
        const common = commonWhisperPrefix(firstWords.concat(restWords), 0, firstWords.length);
        if (firstWords.length >= 3 && common / firstWords.length >= 0.62) {
          return sentenceMatch[2].trim();
        }
      }

      return text;
    }

    function commonWhisperPrefix(words, leftStart, rightStart) {
      let count = 0;
      while (leftStart + count < words.length && rightStart + count < words.length) {
        if (!whisperWordsSimilar(words[leftStart + count], words[rightStart + count])) {
          break;
        }
        count += 1;
      }
      return count;
    }

    function whisperWordsSimilar(left, right) {
      if (!left || !right) {
        return false;
      }
      if (left === right) {
        return true;
      }
      if (left.length < 4 || right.length < 4) {
        return false;
      }
      return left.startsWith(right.slice(0, 4)) || right.startsWith(left.slice(0, 4));
    }

    function findSimilarWhisperChunk(chunks, chunk) {
      const start = Math.max(0, chunks.length - 4);
      for (let index = chunks.length - 1; index >= start; index -= 1) {
        if (whisperChunkSimilarity(chunks[index], chunk) >= 0.58) {
          return index;
        }
      }
      return -1;
    }

    function chooseBetterWhisperChunk(previous, next) {
      const prev = String(previous || "").trim();
      const candidate = String(next || "").trim();
      if (!prev) {
        return candidate;
      }
      if (!candidate) {
        return prev;
      }
      return candidate.length >= prev.length ? candidate : prev;
    }

    function whisperChunkSimilarity(left, right) {
      const leftWords = normalizeWhisperWords(left);
      const rightWords = normalizeWhisperWords(right);
      if (!leftWords.length || !rightWords.length) {
        return 0;
      }

      const leftSet = new Set(leftWords);
      const rightSet = new Set(rightWords);
      let overlap = 0;
      for (const word of leftSet) {
        if (rightSet.has(word)) {
          overlap += 1;
        }
      }
      return overlap / Math.max(leftSet.size, rightSet.size);
    }

    function normalizeWhisperWords(value) {
      return String(value || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, " ")
        .split(/\s+/)
        .filter((word) => word.length > 1);
    }

    function normalizeWhisperWord(value) {
      return String(value || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "");
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
        resumeChatAutoScroll(chatId);
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

    function normalizeAttachment(item) {
      const attachment = item || {};
      return {
        id: String(attachment.id || newId()),
        name: String(attachment.name || "file"),
        path: String(attachment.path || ""),
        relativePath: String(attachment.relativePath || ""),
        size: Number(attachment.size || 0),
        isText: Boolean(attachment.isText),
        truncated: Boolean(attachment.truncated),
        content: String(attachment.content || "").slice(0, MAX_ATTACHMENT_BYTES)
      };
    }

    function userMessageText(prompt, attachments) {
      const files = attachmentListText(attachments);
      if (!files) {
        return prompt;
      }

      return (prompt || "Attached files") + "\\n\\n" + files;
    }

    function promptWithAttachments(prompt, attachments) {
      if (!attachments || !attachments.length) {
        return prompt;
      }

      let output = prompt || "Use the attached file(s) as context.";
      output += "\\n\\nAttached files:";

      for (const attachment of attachments) {
        const label = attachment.relativePath || attachment.path || attachment.name || "file";
        output += "\\n\\n--- " + label + (attachment.size ? " (" + formatBytes(attachment.size) + ")" : "") + " ---\\n";

        if (attachment.content) {
          output += attachment.content;
          if (attachment.truncated) {
            output += "\\n[Attachment truncated to " + formatBytes(MAX_ATTACHMENT_BYTES) + "]";
          }
        } else if (attachment.path) {
          output += "Path: " + attachment.path + "\\n";
          output += attachment.isText ? "[No preview content available]" : "[Binary or unreadable file]";
        } else {
          output += "[No readable text content from dropped file]";
        }
      }

      return output;
    }

    function attachmentListText(attachments) {
      if (!attachments || !attachments.length) {
        return "";
      }

      return "Attached: " + attachments.map((attachment) => {
        const label = attachment.relativePath || attachment.name || "file";
        return label + (attachment.size ? " (" + formatBytes(attachment.size) + ")" : "");
      }).join(", ");
    }

    function chatInfoHtml(chat) {
      const stats = chatInfoStats(chat);
      const settings = normalizeSettings(chat.settings);
      const context = contextUsageInfo(chat, settings.model);
      const sandboxLabel = selectedLabel(settings.sandbox, [
        ["read-only", "Read access"],
        ["workspace-write", "Write access"],
        ["danger-full-access", "Full access"]
      ]);
      const reasoningLabel = selectedLabel(settings.reasoning, [
        ["minimal", "Minimal"],
        ["low", "Low"],
        ["medium", "Medium"],
        ["high", "High"],
        ["xhigh", "Extra High"]
      ]);
      const verbosityLabel = selectedLabel(settings.verbosity, [
        ["low", "Short"],
        ["medium", "Normal"],
        ["high", "Full"]
      ]);
      const webLabel = selectedLabel(settings.webSearch, [
        ["disabled", "Web off"],
        ["cached", "Web"],
        ["live", "Live web"]
      ]);
      const projectPath = normalizeProjectPath(chat.projectPath || currentWorkspacePath() || "");
      const projectLabel = projectPath || "No project selected";
      const workspacePath = currentWorkspacePath();

      return \`
        <section class="chatInfoSummary">
          <p class="chatInfoTitle">\${escapeHtml(chat.title || "Codex chat")}</p>
          <div class="chatInfoMeta">
            <span>\${escapeHtml(statusLabel(chat.status))}</span>
            <span>\${escapeHtml(stats.ageLabel)}</span>
            <span>\${escapeHtml(formatTokenCount(context.used))} / \${escapeHtml(formatTokenCount(context.limit))} tokens</span>
          </div>
        </section>

        <section class="chatInfoSection">
          <h3>Project</h3>
          <div class="chatInfoGrid">
            \${chatInfoItem("Chat project", projectLabel, true)}
            \${chatInfoItem("Current workspace", workspacePath || "No workspace folder", true)}
          </div>
          <div class="chatInfoProjectActions">
            <button id="chooseChatProject" type="button">Choose project</button>
            <button id="chooseCurrentWorkspace" type="button">Choose current workspace</button>
            <button id="useWorkspaceProject" type="button" \${workspacePath ? "" : "disabled"}>Use current workspace</button>
          </div>
        </section>

        <section class="chatInfoSection">
          <h3>Timeline</h3>
          <div class="chatInfoGrid">
            \${chatInfoItem("Created", formatDateTime(stats.createdAt))}
            \${chatInfoItem("Updated", formatDateTime(stats.updatedAt))}
            \${chatInfoItem("Last opened", stats.lastOpenedAt ? formatDateTime(stats.lastOpenedAt) : "Never")}
            \${chatInfoItem("Thread", chat.sessionId || "Not started", true)}
          </div>
        </section>

        <section class="chatInfoSection">
          <h3>Messages</h3>
          <div class="chatInfoGrid">
            \${chatInfoItem("Total messages", stats.messageCount)}
            \${chatInfoItem("User messages", stats.userCount)}
            \${chatInfoItem("Assistant answers", stats.assistantCount)}
            \${chatInfoItem("System / activity", stats.systemCount + stats.activityCount)}
            \${chatInfoItem("Errors", stats.errorCount)}
            \${chatInfoItem("File change cards", stats.changeSummaryCount)}
          </div>
        </section>

        <section class="chatInfoSection">
          <h3>Tokens</h3>
          <div class="chatInfoGrid">
            \${chatInfoItem("Estimated total", formatTokenCount(stats.totalTokens))}
            \${chatInfoItem("Incoming", formatTokenCount(stats.incomingTokens))}
            \${chatInfoItem("Outgoing", formatTokenCount(stats.outgoingTokens))}
            \${chatInfoItem("Events / metadata", formatTokenCount(stats.eventTokens))}
            \${chatInfoItem("Context used", context.percent + "%")}
            \${chatInfoItem("Context window", formatTokenCount(context.limit))}
          </div>
        </section>

        <section class="chatInfoSection">
          <h3>Tools and Events</h3>
          <div class="chatInfoGrid">
            \${chatInfoItem("Tool / event calls", stats.eventCount)}
            \${chatInfoItem("Running events", stats.runningEventCount)}
            \${chatInfoItem("Finished events", stats.doneEventCount)}
            \${chatInfoItem("Failed events", stats.failedEventCount)}
          </div>
          \${stats.eventKindList ? '<ul class="chatInfoList">' + stats.eventKindList + '</ul>' : '<p class="modalHint">No tool or command events recorded yet.</p>'}
        </section>

        <section class="chatInfoSection">
          <h3>Settings</h3>
          <div class="chatInfoGrid">
            \${chatInfoItem("Model", modelDisplayLabel(settings.model))}
            \${chatInfoItem("Reasoning", reasoningLabel)}
            \${chatInfoItem("Verbosity", verbosityLabel)}
            \${chatInfoItem("Web", webLabel)}
            \${chatInfoItem("Filesystem", sandboxLabel)}
            \${chatInfoItem("Pending attachments", stats.attachmentLabel)}
          </div>
        </section>
      \`;
    }

    function chatInfoItem(label, value, mono) {
      return \`
        <div class="chatInfoItem">
          <span class="chatInfoLabel">\${escapeHtml(label)}</span>
          <span class="chatInfoValue\${mono ? " chatInfoMono" : ""}">\${escapeHtml(value)}</span>
        </div>
      \`;
    }

    function chatInfoStats(chat) {
      const messages = Array.isArray(chat.messages) ? chat.messages : [];
      const attachments = Array.isArray(chat.pendingAttachments) ? chat.pendingAttachments : [];
      const messageTimes = messages.map((item) => Number(item.at || 0)).filter((value) => Number.isFinite(value) && value > 0);
      const now = Date.now();
      const firstMessageAt = messageTimes.length ? Math.min.apply(null, messageTimes) : now;
      const lastMessageAt = messageTimes.length ? Math.max.apply(null, messageTimes) : firstMessageAt;
      const createdAt = Number(chat.createdAt || firstMessageAt || now) || now;
      const updatedAt = Number(chat.updatedAt || chat.lastOpenedAt || lastMessageAt || createdAt) || createdAt;
      const roleCounts = {};
      const eventKinds = {};
      const eventStatuses = {};

      for (const message of messages) {
        const role = String(message.role || "assistant");
        roleCounts[role] = (roleCounts[role] || 0) + 1;
        if (role === "event") {
          const kind = String(message.kind || "event");
          const status = String(message.status || "info");
          eventKinds[kind] = (eventKinds[kind] || 0) + 1;
          eventStatuses[status] = (eventStatuses[status] || 0) + 1;
        }
      }

      const attachmentBytes = attachments.reduce((sum, item) => sum + Number(item.size || 0), 0);
      const attachmentLabel = attachments.length
        ? attachments.length + " / " + formatBytes(attachmentBytes)
        : "None";
      const eventKindList = Object.keys(eventKinds)
        .sort()
        .map((kind) => '<li>' + escapeHtml(eventBadge(kind, "") + " " + eventKinds[kind]) + '</li>')
        .join("");

      return {
        createdAt,
        updatedAt,
        lastOpenedAt: Number(chat.lastOpenedAt || 0),
        ageLabel: "Created " + formatDuration(now - createdAt) + " ago",
        messageCount: messages.length,
        userCount: roleCounts.user || 0,
        assistantCount: roleCounts.assistant || 0,
        systemCount: roleCounts.system || 0,
        activityCount: roleCounts.activity || 0,
        errorCount: roleCounts.error || 0,
        changeSummaryCount: roleCounts.changeSummary || 0,
        eventCount: roleCounts.event || 0,
        runningEventCount: eventStatuses.running || 0,
        doneEventCount: eventStatuses.done || 0,
        failedEventCount: eventStatuses.error || 0,
        eventKindList,
        attachmentLabel,
        totalTokens: estimateChatTokens(chat),
        incomingTokens: estimateTokensForRoles(chat, ["user", "system"]) + estimateAttachmentTokens(chat),
        outgoingTokens: estimateTokensForRoles(chat, ["assistant"]),
        eventTokens: estimateTokensForRoles(chat, ["activity", "event", "error", "changeSummary"])
      };
    }

    function estimateTokensForRoles(chat, roles) {
      const accepted = new Set(roles);
      const messages = Array.isArray(chat.messages) ? chat.messages : [];
      let chars = 0;
      let overhead = 0;

      for (const message of messages) {
        if (!accepted.has(String(message.role || ""))) {
          continue;
        }

        chars += String(message.text || "").length;
        chars += String(message.title || "").length;
        chars += String(message.detail || "").length;
        overhead += 12;
      }

      return Math.max(0, Math.ceil(chars / 4) + overhead);
    }

    function estimateAttachmentTokens(chat) {
      const attachments = Array.isArray(chat.pendingAttachments) ? chat.pendingAttachments : [];
      let chars = 0;
      let overhead = 0;

      for (const attachment of attachments) {
        chars += String(attachment.name || "").length;
        chars += String(attachment.path || "").length;
        chars += String(attachment.content || "").length;
        overhead += 12;
      }

      return Math.max(0, Math.ceil(chars / 4) + overhead);
    }

    function formatDateTime(value) {
      const date = new Date(Number(value || 0));
      if (Number.isNaN(date.getTime())) {
        return "Unknown";
      }

      return date.toLocaleString();
    }

    function formatMessageTime(value) {
      const date = new Date(Number(value || 0));
      if (Number.isNaN(date.getTime())) {
        return "";
      }

      return date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
      });
    }

    function formatDuration(ms) {
      const seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
      if (seconds < 60) {
        return seconds + "s";
      }
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) {
        const rest = seconds % 60;
        return minutes + "m" + (rest ? " " + rest + "s" : "");
      }
      const hours = Math.floor(minutes / 60);
      if (hours < 48) {
        const rest = minutes % 60;
        return hours + "h" + (rest ? " " + rest + "m" : "");
      }
      return Math.floor(hours / 24) + "d";
    }

    function formatBytes(value) {
      const bytes = Number(value || 0);
      if (bytes < 1024) {
        return bytes + " B";
      }

      if (bytes < 1024 * 1024) {
        return Math.round(bytes / 102.4) / 10 + " KB";
      }

      return Math.round(bytes / 1024 / 102.4) / 10 + " MB";
    }

    function option(value, label, selectedValue) {
      return '<option value="' + escapeAttr(value) + '"' + (value === selectedValue ? " selected" : "") + '>' + escapeHtml(label) + '</option>';
    }

    function renderContextIndicator(info) {
      const angle = Math.max(0, Math.min(360, Math.round(info.percent * 36) / 10));
      return '<button class="contextIndicator" type="button" data-action="context-info" style="--contextAngle: ' + angle + 'deg;" title="' + escapeAttr(info.tooltip + "\\nClick for chat information") + '" aria-label="' + escapeAttr(info.tooltip + "\\nOpen chat information") + '"></button>';
    }

    function renderWorkspaceSelector() {
      const workspace = activeWorkspaceProfile();
      const label = workspace ? workspace.name : "Workspace";
      const pathLabel = workspace && workspace.path ? workspace.path : "Codex Max workspace";
      return '<button id="workspaceSelector" class="workspaceSelector" type="button" title="' + escapeAttr(pathLabel) + '" aria-haspopup="listbox" aria-expanded="false"><span>' + escapeHtml(label) + '</span></button>';
    }

    function renderBoardUsage(info) {
      if (accountRateLimitsLoading) {
        return \`
          <button class="boardUsage loading \${escapeAttr(info.statusClass)}" type="button" title="Refreshing account limits..." aria-label="Refreshing account limits">
            <span class="usageDot" aria-hidden="true"></span>
            <span>Refreshing limits...</span>
          </button>
        \`;
      }

      return \`
        <button class="boardUsage \${escapeAttr(info.statusClass)}" type="button" title="\${escapeAttr(info.tooltip + "\\nClick to refresh")}" aria-label="\${escapeAttr(info.tooltip + "\\nRefresh account limits")}">
          <span class="usageDot" aria-hidden="true"></span>
          <span>5h <strong>\${escapeHtml(info.fiveHourLabel)}</strong></span>
          <span>Week <strong>\${escapeHtml(info.weeklyLabel)}</strong></span>
          <span>Status <strong>\${escapeHtml(info.statusLabel)}</strong></span>
          <span>Resets <strong>\${escapeHtml(info.limitResetLabel)}</strong></span>
        </button>
      \`;
    }

    function boardUsageInfo(chats, accountRateLimits) {
      const items = Array.isArray(chats) ? chats : [];
      let used = 0;
      let limit = 0;
      let running = 0;
      let errors = 0;
      let opened = 0;
      const accountUsage = accountUsageInfo(accountRateLimits);
      const resetCredits = extractLimitResetCredits(accountRateLimits);

      for (const chat of items) {
        const settings = normalizeSettings(chat && chat.settings);
        const context = contextUsageInfo(chat, settings.model);
        used += context.used;
        limit += context.limit;
        if (chat.status === "running") {
          running += 1;
        } else if (chat.status === "error") {
          errors += 1;
        } else if (chat.status === "opened") {
          opened += 1;
        }
      }

      const percent = limit ? Math.max(0, Math.min(100, Math.round((used / limit) * 100))) : 0;
      const statusClass = running ? "running" : errors ? "error" : opened ? "opened" : "idle";
      const statusLabelText = running ? "Running" : errors ? "Error" : opened ? "Open" : "Idle";
      const fiveHourLabel = accountUsage ? accountUsage.fiveHourLabel : percent + "%";
      const weeklyLabel = accountUsage ? accountUsage.weeklyLabel : "n/a";
      const limitResetLabel = resetCredits;
      const tooltip = [
        "Board usage/status",
        accountUsage ? accountUsage.tooltip : "Usage: " + percent + "% (" + formatTokenCount(used) + " / " + formatTokenCount(limit || 0) + " tokens)",
        "Status: " + statusLabelText + " (" + running + " running, " + errors + " error, " + opened + " open)",
        "Available manual limit resets: " + resetCredits
      ].join("\\n");

      return {
        used,
        limit,
        percent,
        fiveHourLabel,
        weeklyLabel,
        statusClass,
        statusLabel: statusLabelText,
        limitResetLabel,
        tooltip
      };
    }

    function accountUsageInfo(value) {
      const limits = extractAccountLimits(value);
      if (!limits.length) {
        return null;
      }

      const fiveHour = limits.find((item) => item.kind === "5h") || limits[0];
      const weekly = limits.find((item) => item.kind === "weekly") || limits.find((item) => item !== fiveHour) || null;
      const tooltip = ["Account usage:"];

      for (const item of [fiveHour, weekly].filter(Boolean)) {
        const label = item.kind === "weekly" ? "Week" : item.kind === "5h" ? "5h" : item.label;
        tooltip.push(label + ": " + item.remainingPercent + "% remaining" + (item.resetLabel ? ", auto reset " + item.resetLabel : ""));
      }

      return {
        fiveHourLabel: fiveHour ? fiveHour.remainingPercent + "%" : "n/a",
        weeklyLabel: weekly ? weekly.remainingPercent + "%" : "n/a",
        tooltip: tooltip.join("\\n")
      };
    }

    function extractLimitResetCredits(value) {
      if (!value || typeof value !== "object") {
        return "n/a";
      }

      const candidates = [];
      const queue = [{ value, path: [] }];
      const seen = new Set();
      while (queue.length) {
        const current = queue.shift();
        const item = current.value;
        if (!item || typeof item !== "object" || seen.has(item)) {
          continue;
        }
        seen.add(item);

        for (const key of Object.keys(item)) {
          const child = item[key];
          const pathText = current.path.concat(key).join(" ");
          const normalizedPath = normalizeLimitKey(pathText);
          const looksLikeManualReset =
            /reset/i.test(pathText) &&
            /(available|remaining|left|count|credits|requests|manual)/i.test(pathText);

          if (looksLikeManualReset && Number.isFinite(Number(child))) {
            candidates.push({
              score: manualResetScore(normalizedPath),
              value: Number(child)
            });
          }

          if (typeof child === "string") {
            const match = child.match(/(?:available|remaining|left)\\D*(\\d+)\\D*(?:reset|resets)/i)
              || child.match(/(?:reset|resets)\\D*(\\d+)/i);
            if (match) {
              candidates.push({
                score: manualResetScore(normalizedPath) + 1,
                value: Number(match[1])
              });
            }
          }

          if (child && typeof child === "object") {
            queue.push({ value: child, path: current.path.concat(key) });
          }
        }
      }

      if (!candidates.length) {
        return "n/a";
      }

      const useful = candidates.filter((item) => item.score > 0);
      if (!useful.length) {
        return "n/a";
      }

      useful.sort((a, b) => b.score - a.score);
      return String(useful[0].value);
    }

    function manualResetScore(normalizedPath) {
      let score = 0;
      if (/manual|credit|request|available|remaining/.test(normalizedPath)) {
        score += 4;
      }
      if (/limit/.test(normalizedPath)) {
        score += 2;
      }
      if (/reset/.test(normalizedPath)) {
        score += 2;
      }
      if (/resetat|resetsat|resetafter|renew|refresh|time|timestamp/.test(normalizedPath)) {
        score -= 8;
      }
      return score;
    }

    function extractAccountLimits(value) {
      if (!value || typeof value !== "object") {
        return [];
      }

      const candidates = [];
      const queue = [{ value, path: [] }];
      const seen = new Set();
      while (queue.length) {
        const current = queue.shift();
        const item = current.value;
        if (!item || typeof item !== "object" || seen.has(item)) {
          continue;
        }
        seen.add(item);

        for (const key of Object.keys(item)) {
          const child = item[key];
          if (child && typeof child === "object") {
            queue.push({ value: child, path: current.path.concat(key) });
          }
        }

        const limit = parseLimitNode(item, current.path);
        if (limit) {
          candidates.push(limit);
        }
      }

      const unique = [];
      const seenKeys = new Set();
      for (const item of candidates) {
        const key = item.kind + ":" + item.remainingPercent + ":" + item.resetLabel;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          unique.push(item);
        }
      }

      return unique.sort((a, b) => {
        const order = { "5h": 0, weekly: 1, other: 2 };
        return (order[a.kind] || 2) - (order[b.kind] || 2);
      });
    }

    function parseLimitNode(item, pathParts) {
      const entries = Object.keys(item).map((key) => ({
        key,
        normalized: normalizeLimitKey(key),
        value: item[key]
      }));
      const remaining = findRemainingPercent(entries);
      if (remaining === null) {
        return null;
      }

      const resetLabel = findResetLabel(entries);
      const labelText = pathParts.concat(entries.map((entry) => {
        return typeof entry.value === "string" ? entry.value : "";
      })).join(" ").toLowerCase();
      const kind = classifyLimitWindow(entries, labelText);

      return {
        kind,
        label: kind === "other" ? "Limit" : kind,
        remainingPercent: remaining,
        resetLabel
      };
    }

    function findRemainingPercent(entries) {
      const direct = findNumericEntry(entries, /(remaining|available|left).*(percent|pct)|(percent|pct).*(remaining|available|left)/);
      if (direct !== null) {
        return normalizePercent(direct);
      }

      const used = findNumericEntry(entries, /(used|usage|consumed).*(percent|pct)|(percent|pct).*(used|usage|consumed)/);
      if (used !== null) {
        return Math.max(0, Math.min(100, 100 - normalizePercent(used)));
      }

      return null;
    }

    function findNumericEntry(entries, pattern) {
      for (const entry of entries) {
        if (pattern.test(entry.normalized) && Number.isFinite(Number(entry.value))) {
          return Number(entry.value);
        }
      }
      return null;
    }

    function normalizePercent(value) {
      const number = Number(value);
      const percent = number <= 1 ? number * 100 : number;
      return Math.max(0, Math.min(100, Math.round(percent)));
    }

    function findResetLabel(entries) {
      for (const entry of entries) {
        if (!/reset|renew|refresh/.test(entry.normalized)) {
          continue;
        }

        const value = entry.value;
        if (typeof value === "string" && value.trim()) {
          return formatResetValue(value.trim());
        }
        if (Number.isFinite(Number(value))) {
          return formatResetValue(Number(value));
        }
      }
      return "";
    }

    function formatResetValue(value) {
      if (typeof value === "number") {
        if (value > 100000000000) {
          return formatDateTime(value);
        }
        if (value > 1000000000) {
          return formatDateTime(value * 1000);
        }
        if (value >= 0 && value < 60 * 60 * 24 * 14) {
          return formatDuration(value * 1000);
        }
        return String(value);
      }

      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return formatDateTime(date.getTime());
      }
      return value;
    }

    function classifyLimitWindow(entries, labelText) {
      const text = labelText + " " + entries.map((entry) => entry.normalized + " " + entry.value).join(" ");
      if (/week|weekly|7d|seven|10080|secondary|long/.test(text)) {
        return "weekly";
      }
      if (/5h|5hr|5hour|fivehour|five|300|primary|short|rolling/.test(text)) {
        return "5h";
      }
      return "other";
    }

    function normalizeLimitKey(value) {
      return String(value || "").replace(/[_\\-\\s]/g, "").toLowerCase();
    }

    function contextUsageInfo(chat, model) {
      const limit = contextWindowForModel(model);
      const used = estimateChatTokens(chat);
      const percent = limit ? Math.max(0, Math.min(100, (used / limit) * 100)) : 0;
      const displayPercent = Math.round(percent);
      const tooltip = [
        "Context window:",
        displayPercent + "% full",
        formatTokenCount(used) + " / " + formatTokenCount(limit) + " tokens used"
      ].join("\\n");

      return {
        used,
        limit,
        percent,
        tooltip
      };
    }

    function contextWindowForModel(model) {
      const normalized = normalizeModelId(model);
      if (/^gpt-5\\./.test(normalized)) {
        return 258000;
      }
      if (normalized === "o3") {
        return 200000;
      }
      if (normalized === "o4-mini") {
        return 128000;
      }

      return 128000;
    }

    function estimateChatTokens(chat) {
      const messages = Array.isArray(chat.messages) ? chat.messages : [];
      const attachments = Array.isArray(chat.pendingAttachments) ? chat.pendingAttachments : [];
      let chars = 0;
      let overhead = messages.length * 8;

      for (const message of messages) {
        chars += String(message.text || "").length;
        chars += String(message.title || "").length;
        chars += String(message.detail || "").length;
        overhead += 4;
      }

      for (const attachment of attachments) {
        chars += String(attachment.name || "").length;
        chars += String(attachment.path || "").length;
        chars += String(attachment.content || "").length;
        overhead += 12;
      }

      return Math.max(0, Math.ceil(chars / 4) + overhead);
    }

    function formatTokenCount(value) {
      const tokens = Number(value || 0);
      if (tokens >= 1000000) {
        return Math.round(tokens / 100000) / 10 + "m";
      }
      if (tokens >= 1000) {
        return Math.round(tokens / 100) / 10 + "k";
      }
      return String(tokens);
    }

    function selectChip(setting, title, selectedValue, choices, disabled) {
      const label = selectedLabel(selectedValue, choices);
      const options = choices.map((item) => ({
        value: item[0],
        label: item[1]
      }));
      return \`
        <button class="selectChip" type="button" data-select-setting="\${escapeAttr(setting)}" data-select-value="\${escapeAttr(selectedValue)}" data-select-options="\${escapeAttr(JSON.stringify(options))}" title="\${escapeAttr(title)}" \${disabled ? "disabled" : ""}>
          <span class="selectChipText">\${escapeHtml(label)}</span>
        </button>
      \`;
    }

    function selectedLabel(selectedValue, choices) {
      const found = choices.find((item) => item[0] === selectedValue);
      return found ? found[1] : String(selectedValue || "");
    }

    function modelSelectChip(selectedValue, disabled) {
      const selected = normalizeModelId(selectedValue) || "gpt-5.5";
      const choices = modelChoices(selected);
      return selectChip("model", "Model", selected, choices, disabled);
    }

    function modelOptions(selectedValue) {
      const selected = normalizeModelId(selectedValue) || "gpt-5.5";
      return modelChoices(selected).map((item) => option(item[0], item[1], selected)).join("");
    }

    function modelDisplayLabel(value) {
      const selected = normalizeModelId(value) || "gpt-5.5";
      const match = modelChoices(selected).find((item) => item[0] === selected);
      return match ? match[1] : selected;
    }

    function modelChoices(selected) {
      const models = [
        ["gpt-5.5", "5.5"],
        ["gpt-5.4", "5.4"],
        ["gpt-5.3", "5.3"],
        ["o3", "o3"],
        ["o4-mini", "o4-mini"]
      ];

      if (selected && !models.some((item) => item[0] === selected)) {
        models.push([selected, selected]);
      }

      return models;
    }

    function normalizeSettings(settings) {
      const next = Object.assign({}, DEFAULT_CHAT_SETTINGS, settings || {});
      const reasoning = ["minimal", "low", "medium", "high", "xhigh"].includes(next.reasoning) ? next.reasoning : DEFAULT_CHAT_SETTINGS.reasoning;
      const verbosity = ["low", "medium", "high"].includes(next.verbosity) ? next.verbosity : DEFAULT_CHAT_SETTINGS.verbosity;
      const sandbox = ["read-only", "workspace-write", "danger-full-access"].includes(next.sandbox) ? next.sandbox : DEFAULT_CHAT_SETTINGS.sandbox;
      const webSearch = ["disabled", "cached", "live"].includes(next.webSearch) ? next.webSearch : DEFAULT_CHAT_SETTINGS.webSearch;

      return {
        model: normalizeModelId(next.model) || DEFAULT_CHAT_SETTINGS.model,
        reasoning,
        verbosity,
        sandbox,
        webSearch
      };
    }

    function normalizeModelId(value) {
      const model = typeof value === "string" ? value.trim() : "";
      const aliases = {
        "5.5": "gpt-5.5",
        "5.4": "gpt-5.4",
        "5.3": "gpt-5.3"
      };

      return aliases[model] || model;
    }

    function normalizeVoiceShortcut(value) {
      const shortcut = String(value || "").trim().toLowerCase();
      return ["off", "alt-v", "ctrl-shift-v", "ctrl-m"].includes(shortcut) ? shortcut : "alt-v";
    }

    function normalizeSpeechToTextEngine(value) {
      const engine = String(value || "").trim().toLowerCase();
      return ["off", "browser", "local-whisper"].includes(engine) ? engine : "browser";
    }

    function normalizeLocalWhisperModel(value) {
      const modelId = String(value || "").trim();
      return LOCAL_WHISPER_MODELS.some((model) => model.id === modelId) ? modelId : "small-q5_1";
    }

    function normalizeLocalWhisperCaptureId(value) {
      const captureId = Number.parseInt(value, 10);
      return Number.isFinite(captureId) ? Math.max(-1, Math.min(32, captureId)) : -1;
    }

    function normalizeWhisperStopGraceMs(value) {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) {
        return ${DEFAULT_WHISPER_LIVE_STOP_GRACE_MS};
      }

      return clampInt(parsed, 100, 10000);
    }

    function normalizeBoardSettings(settings) {
      const fallback = Number(config.defaultChatsPerRow) || 3;
      const rowFallback = Number(config.defaultChatsPerColumn) || 2;
      const next = Object.assign({ chatsPerRow: fallback, chatsPerColumn: rowFallback, maxChatHeight: 0, chatBackground: "${DEFAULT_CHAT_BACKGROUND}", sendWithCtrlEnter: false, autoScroll: true, voiceShortcut: "alt-v", speechToText: "browser", localWhisperModel: "small-q5_1", localWhisperCaptureId: -1, localWhisperStopGraceMs: ${DEFAULT_WHISPER_LIVE_STOP_GRACE_MS}, currentWorkspacePath: "" }, settings || {});
      const chatBackground = String(next.chatBackground || "").toLowerCase() === "#212121"
        ? "${DEFAULT_CHAT_BACKGROUND}"
        : next.chatBackground;

      return {
        chatsPerRow: clampInt(next.chatsPerRow, 1, 12),
        chatsPerColumn: clampInt(next.chatsPerColumn, 1, 6),
        maxChatHeight: normalizeMaxChatHeight(next.maxChatHeight),
        chatBackground: normalizeHexColor(chatBackground, "${DEFAULT_CHAT_BACKGROUND}"),
        sendWithCtrlEnter: Boolean(next.sendWithCtrlEnter),
        autoScroll: next.autoScroll !== false,
        voiceShortcut: normalizeVoiceShortcut(next.voiceShortcut),
        speechToText: normalizeSpeechToTextEngine(next.speechToText),
        localWhisperModel: normalizeLocalWhisperModel(next.localWhisperModel),
        localWhisperCaptureId: normalizeLocalWhisperCaptureId(next.localWhisperCaptureId),
        localWhisperStopGraceMs: normalizeWhisperStopGraceMs(next.localWhisperStopGraceMs),
        currentWorkspacePath: normalizeProjectPath(next.currentWorkspacePath || "")
      };
    }

    function normalizeHexColor(value, fallback) {
      const text = String(value || "").trim();
      if (/^#[0-9a-f]{6}$/i.test(text)) {
        return text.toLowerCase();
      }
      if (/^[0-9a-f]{6}$/i.test(text)) {
        return "#" + text.toLowerCase();
      }
      if (/^#[0-9a-f]{3}$/i.test(text)) {
        return "#" + text.slice(1).split("").map((char) => char + char).join("").toLowerCase();
      }
      return fallback;
    }

    function normalizeProjectPath(value) {
      return String(value || "").trim();
    }

    function currentWorkspacePathFromSettings(settings) {
      const board = normalizeBoardSettings(settings);
      return normalizeProjectPath(board.currentWorkspacePath || config.workspacePath || "");
    }

    function currentWorkspacePath() {
      return currentWorkspacePathFromSettings(state.boardSettings);
    }

    function projectFolderName(value) {
      const clean = normalizeProjectPath(value).replace(/[\\\\/]+$/, "");
      if (!clean) {
        return "";
      }

      return clean.split(/[\\\\/]/).pop() || clean;
    }

    function chatTitleBase(value) {
      return (String(value || "Codex chat").replace(/\\s*\\[[^\\[\\]]+\\]\\s*$/, "").trim() || "Codex chat");
    }

    function chatTitleWithProject(title, projectPath) {
      const base = chatTitleBase(title);
      const folder = projectFolderName(projectPath);
      return folder ? base + " [" + folder + "]" : base;
    }

    function normalizeRateLimits(value) {
      if (!value || typeof value !== "object") {
        return null;
      }

      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return null;
      }
    }

    function normalizeMaxChatHeight(value) {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
      }

      return clampInt(parsed, 280, 2400);
    }

    function clampInt(value, min, max) {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) {
        return min;
      }

      return Math.min(max, Math.max(min, parsed));
    }

    function addAssistantMessage(chatId, text) {
      if (!text) {
        return;
      }

      updateChat(chatId, (chat) => {
        const finishedAt = chat.runFinishedAt || Date.now();
        chat.runFinishedAt = finishedAt;
        chat.isThinking = false;
        chat.messages.push({
          role: "assistant",
          text,
          at: finishedAt,
          runStartedAt: Number(chat.runStartedAt || 0),
          runFinishedAt: finishedAt
        });
      });
    }

    function addMessage(chatId, role, text) {
      if (!text) {
        return;
      }

      updateChat(chatId, (chat) => {
        chat.messages.push({
          role,
          text,
          at: Date.now()
        });
      });
    }

    function addEventMessage(chatId, event) {
      if (!event) {
        return;
      }

      updateChat(chatId, (chat) => {
        const eventId = event.eventId ? String(event.eventId) : "";
        const existing = eventId
          ? chat.messages.find((message) => message.role === "event" && message.eventId === eventId && message.status === "running")
          : null;
        const next = {
          role: "event",
          eventId,
          kind: String(event.kind || "event"),
          status: String(event.status || "info"),
          title: String(event.title || "Codex event"),
          detail: String(event.detail || ""),
          text: String(event.title || "Codex event"),
          raw: event.raw ? String(event.raw) : "",
          changes: Array.isArray(event.changes) ? event.changes.map(normalizeChangeEntry) : [],
          at: Date.now()
        };

        if (existing) {
          existing.kind = next.kind;
          existing.status = next.status;
          existing.title = next.title;
          existing.detail = next.detail;
          existing.text = next.text;
          existing.raw = next.raw;
          existing.changes = next.changes;
          return;
        }

        chat.messages.push(next);
      });
    }

    function updateChat(chatId, updater, options) {
      const updateOptions = options && typeof options === "object" ? options : {};
      const chat = state.chats.find((item) => item.id === chatId);
      if (!chat) {
        const workspace = workspaceList().find((item) => {
          return Array.isArray(item.chats) && item.chats.some((candidate) => candidate.id === chatId);
        });
        const hiddenChat = workspace && workspace.chats.find((item) => item.id === chatId);
        if (hiddenChat) {
          updater(hiddenChat);
          hiddenChat.updatedAt = Date.now();
          persist();
        }
        return;
      }

      updater(chat);
      chat.updatedAt = Date.now();
      if (updateOptions.render === "chrome") {
        renderChatChrome(chatId);
      } else {
        scheduleChatCardRender(chatId);
      }
      persist();
    }

    function persist() {
      syncActiveWorkspaceFromState();
      vscode.setState(state);
      vscode.postMessage({ type: "persist", state });
    }

    function syncActiveWorkspaceFromState() {
      const workspace = activeWorkspaceProfile();
      if (!workspace) {
        return;
      }

      const board = normalizeBoardSettings(state.boardSettings);
      const workspacePath = currentWorkspacePathFromSettings(board);
      workspace.name = workspace.name || projectFolderName(workspacePath) || "Workspace";
      workspace.path = workspacePath;
      workspace.selectedChatId = state.selectedChatId || null;
      workspace.boardSettings = board;
      workspace.chats = Array.isArray(state.chats) ? state.chats.map((chat) => cloneChat(chat, workspacePath)) : [];
    }

    function activeWorkspaceProfile() {
      if (!Array.isArray(state.workspaces)) {
        state.workspaces = [];
      }

      let workspace = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
      if (!workspace) {
        workspace = createWorkspaceProfile({
          id: state.activeWorkspaceId || newId(),
          name: projectFolderName(currentWorkspacePath()) || "Workspace",
          path: currentWorkspacePath(),
          selectedChatId: state.selectedChatId || null,
          boardSettings: state.boardSettings,
          chats: state.chats
        }, state.workspaces.length);
        state.activeWorkspaceId = workspace.id;
        state.workspaces.push(workspace);
      }

      return workspace;
    }

    function requestRateLimitsOnce() {
      if (rateLimitsRequestedOnce) {
        return;
      }

      rateLimitsRequestedOnce = true;
      vscode.postMessage({
        type: "refreshRateLimits",
        silent: true
      });
    }

    function newId() {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }

      return "chat-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function escapeAttr(value) {
      return escapeHtml(value);
    }

    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
}

function getNonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

module.exports = {
  activate,
  deactivate
};
