// Image preview thumbnails and modal. Loaded before main.js.
function requestImagePreview(element) {
  if (!element || element.dataset.imageRequest) {
    return;
  }

  const requestId = newId();
  element.dataset.imageRequest = requestId;
  vscode.postMessage({
    type: "imagePreview",
    requestId,
    path: element.dataset.imagePath || ""
  });
}

function applyImagePreview(message) {
  const requestId = String(message.requestId || "");
  if (!requestId) {
    return;
  }

  const element = document.querySelector('[data-image-request="' + cssEscape(requestId) + '"]');
  if (!element) {
    return;
  }

  const img = element.querySelector("img");
  const placeholder = element.querySelector(".imagePreviewPlaceholder");
  if (message.dataUri && img) {
    img.onload = () => {
      restoreImagePreviewScroll(element);
      if (element.dataset.openAfterLoad === "true") {
        delete element.dataset.openAfterLoad;
        openImageViewer(element);
      }
    };
    img.src = message.dataUri;
    img.hidden = false;
    element.classList.add("loaded");
    restoreImagePreviewScroll(element);
    if (element.dataset.openAfterLoad === "true" && img.complete) {
      delete element.dataset.openAfterLoad;
      openImageViewer(element);
    }
    return;
  }

  if (placeholder) {
    placeholder.textContent = message.error || "Preview unavailable";
  }
}

function restoreImagePreviewScroll(element) {
  const card = element && typeof element.closest === "function" ? element.closest("[data-chat-id]") : null;
  const chatId = card && card.dataset ? card.dataset.chatId : "";
  const messages = card ? card.querySelector(".messages") : null;
  if (!chatId || !messages || typeof stickChatToBottom !== "function") {
    return;
  }

  if (!chatStickyScroll.has(chatId) || chatAutoScrollPaused.has(chatId)) {
    return;
  }

  const keepBottom = () => stickChatToBottom(chatId, messages);
  keepBottom();
  requestAnimationFrame(keepBottom);
}

function renderImageViewerDialog() {
  return `
    <div class="modalBackdrop" id="imageViewerModal" hidden>
      <section class="modal imageViewerModal" role="dialog" aria-modal="true" aria-labelledby="imageViewerTitle">
        <header class="modalHeader">
          <h2 id="imageViewerTitle">Image preview</h2>
          <button class="iconButton secondary" id="closeImageViewer" title="Close">x</button>
        </header>
        <div class="modalBody imageViewerBody">
          <div class="imageViewerViewport">
            <img id="imageViewerImage" alt="">
          </div>
          <p class="imageViewerCaption" id="imageViewerCaption"></p>
        </div>
        <footer class="modalFooter">
          <div class="imageViewerControls" aria-label="Image zoom controls">
            <button id="zoomImageOut" type="button" title="Zoom out">-</button>
            <span class="imageViewerZoomLabel" id="imageViewerZoomLabel">100%</span>
            <button id="zoomImageIn" type="button" title="Zoom in">+</button>
            <button id="resetImageZoom" type="button" title="Reset zoom">Reset</button>
          </div>
          <button id="openImageViewerFile" type="button">Open file</button>
          <button id="closeImageViewerFooter" class="primary" type="button">Close</button>
        </footer>
      </section>
    </div>
  `;
}

function bindImageViewerDialog() {
  const modal = document.getElementById("imageViewerModal");
  const closeButton = document.getElementById("closeImageViewer");
  const footerButton = document.getElementById("closeImageViewerFooter");
  const openFileButton = document.getElementById("openImageViewerFile");
  const zoomOut = document.getElementById("zoomImageOut");
  const zoomIn = document.getElementById("zoomImageIn");
  const resetZoom = document.getElementById("resetImageZoom");
  const viewport = modal ? modal.querySelector(".imageViewerViewport") : null;
  if (!modal || !closeButton || !footerButton || !openFileButton || !zoomOut || !zoomIn || !resetZoom || !viewport) {
    return;
  }

  closeButton.addEventListener("click", closeImageViewer);
  footerButton.addEventListener("click", closeImageViewer);
  zoomOut.addEventListener("click", () => setImageViewerZoom(imageViewerZoom - 0.25));
  zoomIn.addEventListener("click", () => setImageViewerZoom(imageViewerZoom + 0.25));
  resetZoom.addEventListener("click", () => setImageViewerZoom(1));
  viewport.addEventListener("wheel", handleImageViewerWheel, { passive: false });
  openFileButton.addEventListener("click", () => {
    const path = openFileButton.dataset.openFile || "";
    if (path) {
      vscode.postMessage({ type: "openFile", path });
    }
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeImageViewer();
    }
  });
}

function openImageViewer(preview) {
  const modal = document.getElementById("imageViewerModal");
  const image = document.getElementById("imageViewerImage");
  const caption = document.getElementById("imageViewerCaption");
  const openFileButton = document.getElementById("openImageViewerFile");
  if (!modal || !image || !caption || !openFileButton) {
    return;
  }

  const img = preview.querySelector("img");
  const path = preview.dataset.imagePath || "";
  const label = preview.dataset.imageCaption || path || "image";
  if (!img || !img.src || img.hidden) {
    const placeholder = preview.querySelector(".imagePreviewPlaceholder");
    if (placeholder) {
      placeholder.textContent = "Image is still loading...";
    }
    preview.dataset.openAfterLoad = "true";
    requestImagePreview(preview);
    return;
  }

  image.src = img.src;
  image.alt = label;
  caption.textContent = label + (path && path !== label ? " - " + path : "");
  openFileButton.dataset.openFile = path;
  openFileButton.hidden = !path;
  setImageViewerZoom(1);
  modal.hidden = false;
  const closeButton = document.getElementById("closeImageViewer");
  if (closeButton) {
    closeButton.focus();
  }
}

function closeImageViewer() {
  const modal = document.getElementById("imageViewerModal");
  const image = document.getElementById("imageViewerImage");
  if (modal) {
    modal.hidden = true;
  }
  if (image) {
    image.removeAttribute("src");
  }
}

function handleImageViewerWheel(event) {
  const modal = document.getElementById("imageViewerModal");
  if (!modal || modal.hidden) {
    return;
  }

  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  const step = event.ctrlKey || event.metaKey ? 0.15 : 0.25;
  setImageViewerZoom(imageViewerZoom + direction * step);
}

function setImageViewerZoom(value) {
  imageViewerZoom = Math.max(0.25, Math.min(4, Number(value) || 1));
  const image = document.getElementById("imageViewerImage");
  const label = document.getElementById("imageViewerZoomLabel");
  if (image) {
    image.style.width = Math.round(imageViewerZoom * 100) + "%";
  }
  if (label) {
    label.textContent = Math.round(imageViewerZoom * 100) + "%";
  }
}
