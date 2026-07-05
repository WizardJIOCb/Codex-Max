const fs = require("fs");
const path = require("path");
const { fileExists } = require("./file-utils");
const { normalizeCaptureId, spawnExternalProcess } = require("./platform");
const { cleanWhisperLiveOutput, cleanWhisperRuntimeError } = require("./whisper-utils");

class WhisperManager {
  constructor(options) {
    const config = options || {};
    this.models = Array.isArray(config.models) ? config.models : [];
    this.runtime = config.runtime || {};
    this.defaultModelId = config.defaultModelId || "";
    this.paths = config.paths || {};
    this.post = typeof config.post === "function" ? config.post : () => {};
    this.normalizeStopGraceMs = typeof config.normalizeStopGraceMs === "function" ? config.normalizeStopGraceMs : ((value) => Number(value || 0) || 2600);
    this.persistent = null;
  }

  isPersistentModel(modelId) {
    return Boolean(this.persistent && this.persistent.modelId === modelId && !this.persistent.exited);
  }

  stopAll() {
    this.killPersistentWhisper();
  }

  async ensurePersistentWhisper(modelId, captureId) {
    const model = this.models.find((item) => item.id === modelId) || this.models.find((item) => item.id === this.defaultModelId) || this.models[0];
    const executable = this.paths.stream();
    const modelPath = model ? this.paths.model(model) : "";
    const normalizedCaptureId = normalizeCaptureId(captureId);

    if (this.persistent && this.persistent.modelId === model.id && this.persistent.captureId === normalizedCaptureId && !this.persistent.exited) {
      return this.persistent;
    }

    this.killPersistentWhisper();

    if (!await fileExists(executable)) {
      const installHint = this.runtime.supported
        ? "Click Update/Install for whisper.cpp runtime."
        : (this.runtime.reason || "Automatic runtime install is not available on this platform.");
      throw new Error(`whisper-stream is not installed. ${installHint}`);
    }
    if (!modelPath || !await fileExists(modelPath)) {
      throw new Error("Selected Whisper model is not installed.");
    }

    const recordDir = path.join(this.paths.root(), "recordings", `persistent-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
    this.persistent = session;

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
      if (this.persistent === session) {
        this.persistent = null;
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
      if (this.persistent === session) {
        this.persistent = null;
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

  stopWhisperLive(chatId, silent, immediate, stopGraceMs) {
    const session = this.persistent;
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

    const graceMs = this.normalizeStopGraceMs(stopGraceMs);
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

  killPersistentWhisper() {
    const session = this.persistent;
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
    this.persistent = null;
  }
}

module.exports = {
  WhisperManager
};
