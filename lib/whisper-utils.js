const fs = require("fs");
const path = require("path");
const { normalizeCaptureId, spawnExternalProcess } = require("./platform");
const { stripAnsi } = require("./codex-cli");

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

module.exports = {
  cleanWhisperLiveOutput,
  cleanWhisperOutput,
  cleanWhisperRuntimeError,
  defaultCaptureDevices,
  listCaptureDevices,
  newestWavFile,
  repairWavHeader,
  runWhisperCli
};
