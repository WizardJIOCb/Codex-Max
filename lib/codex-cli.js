const { runExternalCommand, spawnExternalProcess } = require("./platform");

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

module.exports = {
  quoteShellArg,
  requestAppServer,
  runCodexCommand,
  stripAnsi
};
