const vscode = require("vscode");
const cp = require("child_process");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const { getHtml: renderWebviewHtml } = require("./webview/html");
const { version: EXTENSION_VERSION } = require("./package.json");

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
    this.whisperLiveProcesses = new Map();
    this.whisperWarmups = new Map();
    this.whisperPersistent = null;

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
