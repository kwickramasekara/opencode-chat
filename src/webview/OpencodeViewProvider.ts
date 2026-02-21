import * as vscode from "vscode";

export class OpencodeViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _serverUrl?: string;
  private _error?: { message: string; showInstallHint: boolean };

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    // Handle paste requests relayed from the iframe through the webview script
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "paste-request") {
        const text = await vscode.env.clipboard.readText();
        webviewView.webview.postMessage({ type: "paste-response", text });
      }
    });

    this._renderCurrentState();
  }

  setServerUrl(url: string) {
    this._serverUrl = url;
    this._error = undefined;
    this._renderCurrentState();
  }

  setError(message: string, showInstallHint = true) {
    this._error = { message, showInstallHint };
    this._serverUrl = undefined;
    this._renderCurrentState();
  }

  private _renderCurrentState() {
    if (!this._view) return;

    if (this._error) {
      this._view.webview.html = this._getErrorHtml(
        this._error.message,
        this._error.showInstallHint,
      );
      return;
    }

    if (this._serverUrl) {
      this._view.webview.html = this._getIframeHtml(this._serverUrl);
      return;
    }

    this._setLoadingHtml();
  }

  private _setLoadingHtml() {
    if (!this._view) return;
    this._view.webview.html = /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            margin: 0;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background: transparent;
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
          }
          .container {
            text-align: center;
            padding: 20px;
          }
          .spinner {
            width: 32px;
            height: 32px;
            border: 3px solid var(--vscode-foreground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin: 0 auto 16px;
            opacity: 0.5;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          p {
            margin: 0;
            opacity: 0.7;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="spinner"></div>
          <p>Starting OpenCode server...</p>
        </div>
      </body>
      </html>
    `;
  }

  private _getIframeHtml(serverUrl: string): string {
    return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy"
              content="default-src 'none'; frame-src ${serverUrl}; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
        <style>
          body {
            margin: 0 auto;
            padding: 0;
            overflow: hidden;
            height: 100vh;
            width: 100vw;
            max-width: 640px;
          }
          iframe {
            width: 100%;
            height: 100%;
            border: none;
          }
        </style>
      </head>
      <body>
        <iframe src="${serverUrl}" allow="clipboard-read; clipboard-write"></iframe>
        <script>
          (function() {
            var vscode = acquireVsCodeApi();
            var iframe = document.querySelector('iframe');

            // Relay paste-request from iframe — try clipboard.read() for images first
            window.addEventListener('message', function(e) {
              if (!e.data || e.data.type !== 'paste-request') return;

              if (navigator.clipboard && navigator.clipboard.read) {
                navigator.clipboard.read().then(function(items) {
                  var imageFound = false;
                  for (var i = 0; i < items.length; i++) {
                    var types = items[i].types;
                    for (var j = 0; j < types.length; j++) {
                      if (types[j].startsWith('image/')) {
                        imageFound = true;
                        (function(mime) {
                          items[i].getType(mime).then(function(blob) {
                            var reader = new FileReader();
                            reader.onload = function() {
                              iframe.contentWindow.postMessage({
                                type: 'paste-response',
                                image: reader.result,
                                mimeType: mime
                              }, '*');
                            };
                            reader.readAsDataURL(blob);
                          });
                        })(types[j]);
                        break;
                      }
                    }
                    if (imageFound) break;
                  }
                  if (!imageFound) {
                    vscode.postMessage({ type: 'paste-request' });
                  }
                }).catch(function() {
                  vscode.postMessage({ type: 'paste-request' });
                });
              } else {
                vscode.postMessage({ type: 'paste-request' });
              }
            });

            // Relay paste-response from extension back into the iframe
            window.addEventListener('message', function(e) {
              if (e.data && e.data.type === 'paste-response') {
                iframe.contentWindow.postMessage(e.data, '*');
              }
            });
          })();
        </script>
      </body>
      </html>
    `;
  }

  private _getErrorHtml(message: string, showInstallHint: boolean): string {
    return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            margin: 0;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background: transparent;
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
          }
          .container {
            text-align: center;
            padding: 20px;
          }
          .icon {
            font-size: 32px;
            margin-bottom: 12px;
            opacity: 0.5;
          }
          p {
            margin: 0 0 8px;
            opacity: 0.7;
          }
          code {
            font-family: var(--vscode-editor-font-family);
            background: var(--vscode-textBlockQuote-background);
            padding: 2px 6px;
            border-radius: 3px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">⚠</div>
          <p>${message}</p>
          ${showInstallHint ? "<p>Make sure <code>opencode</code> is installed and available in your PATH.</p>" : ""}
        </div>
      </body>
      </html>
    `;
  }
}
