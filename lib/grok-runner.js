const fs = require("fs");
const path = require("path");
const { resolveGrokExecutable, spawnExternalProcess } = require("./platform");
const { createGroupedLogBuffer } = require("./codex-runner");

class GrokRunner {
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
            title: "Grok is already running",
            detail: "This chat already has an active Grok Build process. Stop it before sending another prompt."
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
        error: "Open a folder or workspace before sending prompts to Grok."
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
    const executable = resolveGrokExecutable(cfg.get("grokExecutable", "grok") || "grok");
    const mergedSettings = this.normalizeSettings(Object.assign({}, this.defaultChatSettings, settings || {}));
    const grokSessionId = normalizeGrokSessionId(sessionId, chatId);
    const args = buildGrokArgs({
      sessionId: grokSessionId,
      settings: mergedSettings,
      prompt,
      cwd
    });

    board.post({ type: "chatStatus", chatId, status: "running" });
    board.post({ type: "chatSession", chatId, sessionId: grokSessionId });
    board.post({
      type: "chatEvent",
      chatId,
      event: {
        kind: "thread",
        status: "running",
        title: sessionId && isGrokSessionId(sessionId) ? "Resuming Grok thread" : "Starting Grok thread",
        detail: `Thread: ${grokSessionId}`
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
          title: "Grok log",
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

      const eventText = textFromGrokEvent(event);
      if (eventText) {
        assistantText += eventText;
        board.post({ type: "chatThinking", chatId, thinking: false });
        return;
      }

      const eventTitle = grokEventTitle(event);
      if (eventTitle) {
        board.post({
          type: "chatEvent",
          chatId,
          event: {
            kind: "tool",
            status: grokEventStatus(event),
            title: eventTitle,
            detail: grokEventDetail(event)
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
              title: "Grok finished without a final assistant message",
              detail: ""
            }
          });
        }
        board.post({ type: "chatStatus", chatId, status: "idle" });
        return;
      }

      board.post({ type: "chatThinking", chatId, thinking: false });
      board.post({ type: "chatStatus", chatId, status: "error" });
      board.post({
        type: "chatError",
        chatId,
        error: `Grok exited with code ${code}.`
      });
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

function buildGrokArgs({ sessionId, settings, prompt, cwd }) {
  const args = [
    "--no-auto-update",
    "--no-alt-screen",
    "--cwd",
    cwd,
    "--output-format",
    "streaming-json",
    "--always-approve"
  ];
  const model = normalizeGrokModel(settings && settings.model);
  if (model) {
    args.push("-m", model);
  }
  if (sessionId) {
    args.push("--session-id", sessionId);
  }
  args.push("-p", prompt);
  return args;
}

function normalizeGrokModel(value) {
  const text = String(value || "").trim();
  if (/^grok-/i.test(text)) {
    return text;
  }
  return "grok-build";
}

function normalizeGrokSessionId(sessionId, chatId) {
  const existing = String(sessionId || "").trim();
  if (isGrokSessionId(existing)) {
    return existing;
  }
  const cleanChatId = String(chatId || "chat").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "chat";
  return `grok-${cleanChatId}`;
}

function isGrokSessionId(value) {
  return /^grok-[a-z0-9_-]+$/i.test(String(value || "").trim());
}

function textFromGrokEvent(event) {
  const candidates = [
    event && event.delta,
    event && event.text,
    event && event.output_text,
    event && event.content && event.content.text,
    event && event.message && event.message.text,
    event && event.message && event.message.content,
    event && event.result && event.result.text
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }

  const update = event && event.params && event.params.update;
  if (update && update.sessionUpdate === "agent_message_chunk" && update.content && update.content.text) {
    return String(update.content.text);
  }

  return "";
}

function grokEventTitle(event) {
  const type = String(event && (event.type || event.kind || event.event || event.method) || "");
  if (!type || /message|text|chunk|delta/i.test(type)) {
    return "";
  }
  if (/tool|command|shell|exec/i.test(type)) {
    return /finish|complete|done/i.test(type) ? "Grok tool finished" : "Grok tool";
  }
  if (/thinking|reason/i.test(type)) {
    return "Grok is thinking";
  }
  return "";
}

function grokEventStatus(event) {
  const type = String(event && (event.type || event.kind || event.event || event.method) || "");
  return /start|progress|running/i.test(type) ? "running" : "done";
}

function grokEventDetail(event) {
  const value = event && (event.command || event.name || event.title || event.detail || event.summary);
  return value ? String(value) : compactJson(event);
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
  GrokRunner,
  buildGrokArgs,
  isGrokSessionId
};
