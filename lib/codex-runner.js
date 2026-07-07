const fs = require("fs");
const path = require("path");
const { resolveCodexExecutable, spawnExternalProcess } = require("./platform");
const { augmentFileChangeWithDiff, captureFileSnapshotsFromText, compactJson, eventIdentity, fileChangeSummary, handleJsonLine, postChatEvent } = require("./codex-events");

class CodexRunner {
  constructor(options) {
    const config = options || {};
    this.getWorkspacePath = typeof config.getWorkspacePath === "function" ? config.getWorkspacePath : () => "";
    this.getConfig = typeof config.getConfig === "function" ? config.getConfig : () => ({ get: (_key, fallback) => fallback });
    this.normalizeSettings = typeof config.normalizeSettings === "function" ? config.normalizeSettings : (settings) => settings || {};
    this.defaultChatSettings = config.defaultChatSettings || {};
    this.processes = new Map();
    this.stoppedProcesses = new WeakSet();
  }

  run(chatId, prompt, sessionId, settings, board, projectPath) {
    if (!chatId || !prompt) {
      return;
    }

    const existingProcess = this.processes.get(chatId);
    if (existingProcess) {
      if (existingProcess.killed || existingProcess.exitCode !== null || existingProcess.signalCode !== null) {
        this.processes.delete(chatId);
      } else {
        board.post({ type: "chatStatus", chatId, status: "running" });
        board.post({
          type: "chatEvent",
          chatId,
          event: {
            kind: "run",
            status: "running",
            title: "Codex is already running",
            detail: "This chat already has an active Codex process. Stop it before sending another prompt."
          }
        });
        return;
      }
    }

    const requestedCwd = normalizeProjectPath(projectPath);
    const cwd = requestedCwd || this.getWorkspacePath();
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

    const cfg = this.getConfig();
    const executable = resolveCodexExecutable(cfg.get("codexExecutable", "codex") || "codex");
    const mergedSettings = this.normalizeSettings(Object.assign({}, this.defaultChatSettings, settings || {}));
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
    const groupedLogs = createGroupedLogBuffer((detail) => {
      board.post({
        type: "chatEvent",
        chatId,
        event: {
          kind: "log",
          status: "info",
          title: "Codex log",
          detail
        }
      });
    });
    let finalMessageSeen = false;
    let failedToStart = false;
    const fileSnapshots = new Map();
    captureFileSnapshotsFromText(prompt, cwd, fileSnapshots);

    const recordFileChange = (item) => {
      const summary = fileChangeSummary(augmentFileChangeWithDiff(item, fileSnapshots, cwd));
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
          groupedLogs.push(text);
        }
      }
    });

    child.on("error", (error) => {
      groupedLogs.flush();
      failedToStart = true;
      if (this.processes.get(chatId) === child) {
        this.processes.delete(chatId);
        board.post({ type: "chatStatus", chatId, status: "error" });
        board.post({
          type: "chatError",
          chatId,
          error: `Failed to start ${executable.command}: ${error.message}`
        });
      }
    });

    child.on("close", (code) => {
      const isCurrentProcess = this.processes.get(chatId) === child;
      if (isCurrentProcess) {
        this.processes.delete(chatId);
      }
      const refreshLimits = () => {
        if (board && typeof board.scheduleRateLimitsRefresh === "function") {
          board.scheduleRateLimitsRefresh(true, 1800);
          return;
        }
        if (board && typeof board.refreshRateLimits === "function") {
          board.refreshRateLimits(true);
        }
      };

      if (failedToStart) {
        return;
      }

      if (this.stoppedProcesses.has(child)) {
        if (stderrBuffer.trim()) {
          groupedLogs.push(stderrBuffer.trim());
          stderrBuffer = "";
        }
        groupedLogs.flush();
        if (isCurrentProcess || !this.processes.has(chatId)) {
          board.post({ type: "chatStatus", chatId, status: "idle" });
        }
        refreshLimits();
        return;
      }

      if (!isCurrentProcess && this.processes.has(chatId)) {
        groupedLogs.flush();
        return;
      }

      if (stdoutBuffer.trim()) {
        handleJsonLine(stdoutBuffer.trim(), chatId, board, markFinalAndPostChanges, recordFileChange, captureSnapshotsFromItem);
      }
      if (stderrBuffer.trim()) {
        groupedLogs.push(stderrBuffer.trim());
        stderrBuffer = "";
      }
      groupedLogs.flush();

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

    this.stoppedProcesses.add(child);
    child.kill();
    if (this.processes.get(chatId) === child) {
      this.processes.delete(chatId);
    }
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

  if (settings.speedTier === "fast") {
    args.push("-c", `model_service_tier=${tomlString("priority")}`);
  }

  if (isResume && settings.sandbox) {
    args.push("-c", `sandbox_mode=${tomlString(settings.sandbox)}`);
  }
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function normalizeProjectPath(value) {
  const input = String(value || "").trim();
  return input ? path.resolve(input) : "";
}

function isDirectory(value) {
  try {
    return Boolean(value) && fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function createGroupedLogBuffer(onFlush, delayMs) {
  const delay = Number.isFinite(Number(delayMs)) ? Number(delayMs) : 120;
  let lines = [];
  let timer = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!lines.length) {
      return;
    }

    const detail = lines.join("\n");
    lines = [];
    onFlush(detail);
  };

  const push = (text) => {
    const clean = String(text || "").trim();
    if (!clean) {
      return;
    }
    lines.push(clean);
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(flush, delay);
  };

  return {
    push,
    flush
  };
}

module.exports = {
  CodexRunner,
  buildCodexArgs,
  createGroupedLogBuffer
};
