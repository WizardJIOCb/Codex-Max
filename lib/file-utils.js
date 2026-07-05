const fs = require("fs");
const https = require("https");
const { runExternalCommand, spawnExternalProcess } = require("./platform");

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

module.exports = {
  downloadFile,
  extractRuntimeArchive,
  fileExists
};
