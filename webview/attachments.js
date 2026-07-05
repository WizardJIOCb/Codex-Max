// Attachment handling, drag/drop, and prompt attachment formatting. Loaded before main.js.
function bindFileDrop(card, chatId, isRunning) {
  if (!card || isRunning) {
    return;
  }
  if (card.dataset.dropBound === "true") {
    return;
  }

  card.dataset.dropBound = "true";

  card.addEventListener("dragover", (event) => {
    const current = state.chats.find((chat) => chat.id === chatId);
    if (current && current.status === "running") {
      return;
    }
    if (!hasDraggedFiles(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    card.classList.add("dragOver");
  });

  card.addEventListener("dragleave", (event) => {
    if (!event.relatedTarget || !card.contains(event.relatedTarget)) {
      card.classList.remove("dragOver");
    }
  });

  card.addEventListener("drop", (event) => {
    const current = state.chats.find((chat) => chat.id === chatId);
    if (current && current.status === "running") {
      return;
    }
    if (!hasDraggedFiles(event)) {
      return;
    }

    event.preventDefault();
    card.classList.remove("dragOver");
    handleDroppedFiles(chatId, event.dataTransfer.files);
  });
}

function hasDraggedFiles(event) {
  const transfer = event && event.dataTransfer;
  const types = transfer && transfer.types ? Array.prototype.slice.call(transfer.types) : [];
  return types.includes("Files");
}

function handleDroppedFiles(chatId, fileList) {
  const files = Array.from(fileList || []).filter((file) => file && file.name);
  if (!files.length) {
    return;
  }

  Promise.all(files.map(readDroppedFile)).then((attachments) => {
    attachFiles(chatId, attachments.filter(Boolean));
  }).catch((error) => {
    addMessage(chatId, "error", "Could not attach dropped file: " + (error.message || error));
  });
}

function readDroppedFile(file) {
  return new Promise((resolve) => {
    const size = Number(file.size || 0);
    const truncated = size > MAX_ATTACHMENT_BYTES;
    const reader = new FileReader();
    const blob = truncated ? file.slice(0, MAX_ATTACHMENT_BYTES) : file;

    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      resolve(normalizeAttachment({
        id: newId(),
        name: file.name,
        path: "",
        relativePath: "",
        size,
        isText: true,
        truncated,
        content
      }));
    };

    reader.onerror = () => {
      resolve(normalizeAttachment({
        id: newId(),
        name: file.name,
        path: "",
        relativePath: "",
        size,
        isText: false,
        truncated,
        content: ""
      }));
    };

    reader.readAsText(blob);
  });
}

function attachFiles(chatId, attachments) {
  const clean = Array.isArray(attachments) ? attachments.map(normalizeAttachment).filter((item) => item.name) : [];
  if (!clean.length) {
    return;
  }

  updateChat(chatId, (chat) => {
    const existing = Array.isArray(chat.pendingAttachments) ? chat.pendingAttachments : [];
    chat.pendingAttachments = existing.concat(clean).slice(-20);
  }, { render: "chrome" });
}

function removeAttachment(chatId, attachmentId) {
  updateChat(chatId, (chat) => {
    chat.pendingAttachments = (chat.pendingAttachments || []).filter((item) => item.id !== attachmentId);
  }, { render: "chrome" });
}

function userMessageText(prompt, attachments) {
  const files = attachmentListText(attachments);
  if (!files) {
    return prompt;
  }

  return (prompt || "Attached files") + "\n\n" + files;
}

function promptWithAttachments(prompt, attachments) {
  if (!attachments || !attachments.length) {
    return prompt;
  }

  let output = prompt || "Use the attached file(s) as context.";
  output += "\n\nAttached files:";

  for (const attachment of attachments) {
    const label = attachment.relativePath || attachment.path || attachment.name || "file";
    output += "\n\n--- " + label + (attachment.size ? " (" + formatBytes(attachment.size) + ")" : "") + " ---\n";

    if (attachment.content) {
      output += attachment.content;
      if (attachment.truncated) {
        output += "\n[Attachment truncated to " + formatBytes(MAX_ATTACHMENT_BYTES) + "]";
      }
    } else if (attachment.path) {
      output += "Path: " + attachment.path + "\n";
      output += attachment.isText ? "[No preview content available]" : "[Binary or unreadable file]";
    } else {
      output += "[No readable text content from dropped file]";
    }
  }

  return output;
}

function attachmentListText(attachments) {
  if (!attachments || !attachments.length) {
    return "";
  }

  return "Attached: " + attachments.map((attachment) => {
    const label = attachment.relativePath || attachment.name || "file";
    return label + (attachment.size ? " (" + formatBytes(attachment.size) + ")" : "");
  }).join(", ");
}
