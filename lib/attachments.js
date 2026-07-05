const fs = require("fs");
const path = require("path");

const MAX_ATTACHMENT_BYTES = 256 * 1024;
const DEFAULT_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);

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

function resolveWorkspaceFilePath(value, workspacePath) {
  const normalized = normalizeIncomingFilePath(value).replace(/[?#].*$/, "");
  if (!normalized) {
    return "";
  }

  if (path.isAbsolute(normalized)) {
    return normalized;
  }

  return workspacePath ? path.join(workspacePath, normalized) : normalized;
}

function isImagePath(value) {
  return DEFAULT_IMAGE_EXTENSIONS.has(path.extname(String(value || "")).toLowerCase());
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

async function createAttachmentFromUri(uri, workspacePath) {
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

module.exports = {
  MAX_ATTACHMENT_BYTES,
  createAttachmentFromUri,
  imageMimeType,
  isImagePath,
  normalizeIncomingFilePath,
  readFilePreview,
  resolveWorkspaceFilePath
};
