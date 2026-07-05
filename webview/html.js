const vscode = require("vscode");

function getHtml(webview, extensionUri, bootstrap) {
  const nonce = getNonce();
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "styles.css"));
  const bootstrapUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "bootstrap.js"));
  const utilsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "utils.js"));
  const stateModelUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "state-model.js"));
  const workspaceControllerUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "workspace-controller.js"));
  const chatStoreUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "chat-store.js"));
  const attachmentsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "attachments.js"));
  const boardMetricsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "board-metrics.js"));
  const formControlsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "form-controls.js"));
  const markdownUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "markdown.js"));
  const imagePreviewUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "image-preview.js"));
  const scrollManagerUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "scroll-manager.js"));
  const voiceUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "voice.js"));
  const chatRenderUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "chat-render.js"));
  const chatInfoUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "chat-info.js"));
  const boardSettingsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "board-settings.js"));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "main.js"));
  const bootstrapJson = JSON.stringify(bootstrap || {}).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <title>Codex Max</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">window.CODEX_MAX_BOOTSTRAP = ${bootstrapJson};</script>
  <script nonce="${nonce}" src="${bootstrapUri}"></script>
  <script nonce="${nonce}" src="${utilsUri}"></script>
  <script nonce="${nonce}" src="${stateModelUri}"></script>
  <script nonce="${nonce}" src="${workspaceControllerUri}"></script>
  <script nonce="${nonce}" src="${chatStoreUri}"></script>
  <script nonce="${nonce}" src="${attachmentsUri}"></script>
  <script nonce="${nonce}" src="${boardMetricsUri}"></script>
  <script nonce="${nonce}" src="${formControlsUri}"></script>
  <script nonce="${nonce}" src="${markdownUri}"></script>
  <script nonce="${nonce}" src="${imagePreviewUri}"></script>
  <script nonce="${nonce}" src="${scrollManagerUri}"></script>
  <script nonce="${nonce}" src="${voiceUri}"></script>
  <script nonce="${nonce}" src="${chatRenderUri}"></script>
  <script nonce="${nonce}" src="${chatInfoUri}"></script>
  <script nonce="${nonce}" src="${boardSettingsUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

module.exports = {
  getHtml
};
