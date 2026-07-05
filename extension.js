const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { getHtml: renderWebviewHtml } = require("./webview/html");
const {
  currentPlatformKey,
  getWhisperRuntimeDescriptor,
  normalizeCaptureId,
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
const { version: EXTENSION_VERSION } = require("./package.json");

const VIEW_TYPE = "codexMax.chatBoard";
const STATE_KEY = "codexMax.chatBoardState";
const MAX_IMAGE_PREVIEW_BYTES = 8 * 1024 * 1024;
const DEFAULT_WHISPER_LIVE_STOP_GRACE_MS = 2600;
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

const WHISPER_RUNTIME = getWhisperRuntimeDescriptor(WHISPER_RUNTIME_BY_PLATFORM);

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
    this.runner.stopAll();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
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
