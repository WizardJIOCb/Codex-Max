const vscode = require("vscode");

function getHtml(webview, extensionUri, bootstrap) {
  const nonce = getNonce();
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "styles.css"));
  const bootstrapUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "webview", "bootstrap.js"));
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
