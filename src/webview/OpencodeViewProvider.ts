import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

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

  public addToChat(filePath: string) {
    if (this._view) {
      this._view.webview.postMessage({ type: "insert-text", text: filePath });
    }
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

  private _readTemplate(name: string): string {
    const templatePath = path.join(__dirname, "templates", name);
    return fs.readFileSync(templatePath, "utf-8");
  }

  private _setLoadingHtml() {
    if (!this._view) return;
    this._view.webview.html = this._readTemplate("loading.html");
  }

  private _getIframeHtml(serverUrl: string): string {
    return this._readTemplate("iframe.html").replaceAll(
      "{{SERVER_URL}}",
      serverUrl,
    );
  }

  private _getErrorHtml(message: string, showInstallHint: boolean): string {
    const installHint = showInstallHint
      ? "<p>Make sure <code>opencode</code> is installed and available in your PATH.</p>"
      : "";

    return this._readTemplate("error.html")
      .replaceAll("{{ERROR_MESSAGE}}", message)
      .replaceAll("{{INSTALL_HINT}}", installHint);
  }
}
