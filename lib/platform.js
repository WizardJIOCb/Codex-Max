const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

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

function resolveGrokExecutable(configured) {
  const wantsAuto = !configured || configured === "grok";
  const configuredPath = wantsAuto ? "" : stripQuotes(configured);

  if (configuredPath) {
    return {
      command: configuredPath,
      shell: shouldUseShell(configuredPath)
    };
  }

  for (const candidate of getGrokCandidates()) {
    if (candidate && fs.existsSync(candidate)) {
      return {
        command: candidate,
        shell: shouldUseShell(candidate)
      };
    }
  }

  return {
    command: "grok",
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

function getGrokCandidates() {
  const candidates = [];

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) {
      candidates.push(path.join(appData, "npm", "grok.cmd"));
      candidates.push(path.join(appData, "npm", "grok"));
      candidates.push(path.join(appData, "npm", "grok.exe"));
    }
  } else {
    const home = os.homedir();
    candidates.push(path.join(home, ".npm-global", "bin", "grok"));
    candidates.push("/usr/local/bin/grok");
    candidates.push("/opt/homebrew/bin/grok");
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

function getWhisperRuntimeDescriptor(runtimeByPlatform) {
  const platformKey = currentPlatformKey();
  const runtimes = runtimeByPlatform || {};
  const runtime = runtimes[platformKey];
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

function resolveWhisperRuntimeExecutable(root, kind, runtime) {
  const descriptor = runtime || {};
  const runtimeDir = path.join(root, "runtime");
  const fallbackKey = kind === "stream" ? "streamExecutable" : kind === "bench" ? "benchExecutable" : "executable";
  const namesKey = kind === "stream" ? "streamNames" : kind === "bench" ? "benchNames" : "cliNames";
  const fallback = path.join(root, ...(descriptor[fallbackKey] || descriptor.executable || []));
  const found = findFirstExistingFile(runtimeDir, descriptor[namesKey] || []);
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
  const usesShell = typeof spawnOptions.shell === "boolean" ? spawnOptions.shell : normalized.shell;
  const commandArgs = usesShell && process.platform === "win32"
    ? prepareWindowsShellArgs(args)
    : (Array.isArray(args) ? args : []);

  return cp.spawn(normalized.command, commandArgs, {
    cwd: spawnOptions.cwd,
    shell: usesShell,
    windowsHide: true,
    stdio: spawnOptions.stdio || ["ignore", "pipe", "pipe"],
    env
  });
}

function prepareWindowsShellArgs(args) {
  return (Array.isArray(args) ? args : []).map(quoteWindowsShellArg);
}

function quoteWindowsShellArg(value) {
  const text = String(value);
  if (!text) {
    return "\"\"";
  }
  if (!/[\s"]/u.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, "\"\"")}"`;
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

module.exports = {
  currentPlatformKey,
  getSpawnEnv,
  getWhisperRuntimeDescriptor,
  normalizeCaptureId,
  normalizeExecutable,
  platformDisplayName,
  prepareWindowsShellArgs,
  quoteWindowsShellArg,
  resolveCodexExecutable,
  resolveGrokExecutable,
  resolveWhisperRuntimeExecutable,
  runExternalCommand,
  shouldUseShell,
  spawnExternalProcess,
  stripQuotes
};
