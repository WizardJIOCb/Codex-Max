const fs = require("fs");
const path = require("path");
const { resolveKiloExecutable, spawnExternalProcess } = require("./platform");
const { createGroupedLogBuffer } = require("./codex-runner");

const DEFAULT_KILO_MODEL = "kilo/kilo-auto/free";

class KiloRunner {
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
            title: "Kilo is already running",
            detail: "This chat already has an active Kilo Code process. Stop it before sending another prompt."
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
        error: "Open a folder or workspace before sending prompts to Kilo."
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
    const executable = resolveKiloExecutable(cfg.get("kiloExecutable", "kilo") || "kilo");
    const mergedSettings = this.normalizeSettings(Object.assign({}, this.defaultChatSettings, settings || {}));
    const args = buildKiloArgs({
      sessionId: isKiloSessionId(sessionId) ? sessionId : "",
      settings: mergedSettings,
      prompt,
      cwd
    });

    board.post({ type: "chatStatus", chatId, status: "running" });
    board.post({
      type: "chatEvent",
      chatId,
      event: {
        kind: "thread",
        status: "running",
        title: isKiloSessionId(sessionId) ? "Resuming Kilo thread" : "Starting Kilo thread",
        detail: isKiloSessionId(sessionId) ? `Thread: ${sessionId}` : "A Kilo Code CLI thread is being started for this chat card."
      }
    });

    const child = spawnExternalProcess(executable, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    this.processes.set(chatId, child);

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let plainOutput = "";
    let assistantText = "";
    let failedToStart = false;
    const groupedLogs = createGroupedLogBuffer((detail) => {
      board.post({
        type: "chatEvent",
        chatId,
        event: {
          kind: "log",
          status: "info",
          title: "Kilo log",
          detail
        }
      });
    });

    const handleLine = (line) => {
      const text = String(line || "").trim();
      if (!text) {
        return;
      }

      let event = null;
      try {
        event = JSON.parse(text);
      } catch {
        plainOutput += (plainOutput ? "\n" : "") + text;
        return;
      }

      if (event.sessionID && isKiloSessionId(event.sessionID)) {
        board.post({ type: "chatSession", chatId, sessionId: event.sessionID });
      }

      if (event.type === "error") {
        const message = kiloErrorText(event);
        board.post({
          type: "chatError",
          chatId,
          error: message || "Kilo reported an error."
        });
        return;
      }

      const eventText = textFromKiloEvent(event);
      if (eventText) {
        assistantText += eventText;
        board.post({ type: "chatThinking", chatId, thinking: false });
        return;
      }

      const eventTitle = kiloEventTitle(event);
      if (eventTitle) {
        board.post({
          type: "chatEvent",
          chatId,
          event: {
            kind: kiloEventKind(event),
            status: kiloEventStatus(event),
            title: eventTitle,
            detail: kiloEventDetail(event)
          }
        });
        return;
      }

      groupedLogs.push(compactJson(event));
    };

    board.post({ type: "chatThinking", chatId, thinking: true });

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

      if (failedToStart) {
        return;
      }

      if (stdoutBuffer.trim()) {
        handleLine(stdoutBuffer.trim());
      }
      if (stderrBuffer.trim()) {
        groupedLogs.push(stderrBuffer.trim());
        stderrBuffer = "";
      }
      groupedLogs.flush();

      if (this.stoppedProcesses.has(child)) {
        if (isCurrentProcess || !this.processes.has(chatId)) {
          board.post({ type: "chatThinking", chatId, thinking: false });
          board.post({ type: "chatStatus", chatId, status: "idle" });
        }
        return;
      }

      if (!isCurrentProcess && this.processes.has(chatId)) {
        return;
      }

      const finalText = (assistantText || plainOutput).trim();
      if (code === 0) {
        board.post({ type: "chatThinking", chatId, thinking: false });
        if (finalText) {
          board.post({
            type: "assistantMessage",
            chatId,
            text: finalText
          });
        } else {
          board.post({
            type: "chatEvent",
            chatId,
            event: {
              kind: "turn",
              status: "done",
              title: "Kilo finished without a final assistant message",
              detail: ""
            }
          });
        }
        board.post({ type: "chatStatus", chatId, status: "idle" });
        return;
      }

      board.post({ type: "chatThinking", chatId, thinking: false });
      if (code !== 0) {
        board.post({ type: "chatStatus", chatId, status: "error" });
        board.post({
          type: "chatError",
          chatId,
          error: `Kilo exited with code ${code}.`
        });
      }
    });
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

function buildKiloArgs({ sessionId, settings, prompt, cwd }) {
  const args = [
    "run",
    "--format",
    "json",
    "--auto",
    "--dir",
    cwd
  ];
  const model = normalizeKiloModel(settings && settings.model);
  if (model) {
    args.push("--model", model);
  }
  if (settings && settings.reasoning) {
    args.push("--variant", String(settings.reasoning));
  }
  if (sessionId) {
    args.push("--session", sessionId);
  }
  args.push(prompt);
  return args;
}

function normalizeKiloModel(value) {
  const text = String(value || "").trim();
  return /^kilo\//i.test(text) ? text : DEFAULT_KILO_MODEL;
}

function isKiloSessionId(value) {
  return /^ses_[a-z0-9]+$/i.test(String(value || "").trim());
}

function textFromKiloEvent(event) {
  const candidates = [
    event && event.text,
    event && event.delta,
    event && event.content,
    event && event.message && event.message.text,
    event && event.message && event.message.content,
    event && event.part && event.part.text,
    event && event.part && event.part.content,
    event && event.output,
    event && event.result
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }
  return "";
}

function kiloEventTitle(event) {
  const type = String(event && event.type || "");
  if (!type || /message|text|delta|part/i.test(type)) {
    return "";
  }
  if (type === "step_start") {
    return "Kilo is thinking";
  }
  if (type === "step_finish" || type === "step_end") {
    return "Kilo step finished";
  }
  if (/tool|command|shell|bash/i.test(type)) {
    return /finish|complete|done|end/i.test(type) ? "Kilo tool finished" : "Kilo tool";
  }
  if (/session/i.test(type)) {
    return "Kilo session";
  }
  return "";
}

function kiloEventKind(event) {
  const type = String(event && event.type || "");
  if (/command|shell|bash/i.test(type)) {
    return "command";
  }
  if (/tool/i.test(type)) {
    return "tool";
  }
  if (/step|think/i.test(type)) {
    return "thinking";
  }
  return "event";
}

function kiloEventStatus(event) {
  const type = String(event && event.type || "");
  return /start|running|progress/i.test(type) ? "running" : "done";
}

function kiloEventDetail(event) {
  const value = event && (event.command || event.name || event.title || event.detail || event.summary);
  return value ? String(value) : compactJson(event);
}

function kiloErrorText(event) {
  const error = event && event.error;
  if (!error) {
    return "";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error.data && error.data.message) {
    return String(error.data.message);
  }
  if (error.message) {
    return String(error.message);
  }
  return compactJson(error);
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

function compactJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value || "");
  }
}

module.exports = {
  DEFAULT_KILO_MODEL,
  KiloRunner,
  buildKiloArgs,
  isKiloSessionId
};
