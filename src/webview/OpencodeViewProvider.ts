import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { setupWebviewBridge, type WebviewBridge } from "./webviewBridge";
import {
  renderWebviewState,
  type WebviewRenderState,
} from "./webviewRenderer";
import type { OpencodeWebviewHost } from "./webviewHost";

export class OpencodeViewProvider
  implements vscode.WebviewViewProvider, OpencodeWebviewHost
{
  readonly id = "opencode.chatView";
  readonly title = "Chat";
  readonly type = "sidebar";

  private _view?: vscode.WebviewView;
  private _bridge?: WebviewBridge;
  private _state: WebviewRenderState = { type: "loading" };
  private _sidebarType: "primary" | "auxiliary" | null = null;
  private _lastUsedAt = 0;
  private _disposed = false;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  get isViewVisible(): boolean {
    return !!this._view?.visible;
  }

  get lastUsedAt(): number {
    return this._lastUsedAt;
  }

  get disposed(): boolean {
    return this._disposed;
  }

  get isLiveHost(): boolean {
    return !!this._view && !!this._bridge && !this._disposed;
  }

  get isActiveHost(): boolean {
    return this.isLiveHost && this.isViewVisible;
  }

  get sidebarType(): "primary" | "auxiliary" | null {
    return this._sidebarType;
  }

  set sidebarType(type: "primary" | "auxiliary" | null) {
    this._sidebarType = type;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    this._disposed = false;
    this._lastUsedAt = Date.now();

    this._bridge?.dispose();
    this._bridge = setupWebviewBridge({
      webview: webviewView.webview,
      playAudio: (src) => this._playAudioDataUri(src),
    });
    webviewView.onDidDispose(() => {
      this._bridge?.dispose();
      this._bridge = undefined;
      this._view = undefined;
      this._disposed = true;
    });

    this._renderCurrentState();
  }

  setServerUrl(url: string) {
    this._state = { type: "ready", serverUrl: url };
    this._renderCurrentState();
  }

  public addToChat(filePath: string) {
    this.postInsertText(filePath);
  }

  setError(message: string, showInstallHint = true) {
    this._state = { type: "error", message, showInstallHint };
    this._renderCurrentState();
  }

  setLoading() {
    this._state = { type: "loading" };
    this._renderCurrentState();
  }

  renderState(state: WebviewRenderState): void {
    this._state = state;
    this._renderCurrentState();
  }

  postInsertText(text: string): Thenable<boolean> | undefined {
    if (!this.isLiveHost || !this._bridge) return undefined;

    return this._bridge.postInsertText(text).then((posted) => {
      if (posted) this._lastUsedAt = Date.now();
      return posted;
    });
  }

  reveal(): Thenable<void> {
    this._lastUsedAt = Date.now();
    return vscode.commands.executeCommand("opencode.chatView.focus");
  }

  private _renderCurrentState() {
    if (!this._view) return;

    this._view.webview.html = renderWebviewState(this._state, "sidebar");
  }

  // ── System-level audio playback for environments without codec support ──
  // When the webview cannot play audio (e.g. stock VS Code lacks AAC codecs),
  // we decode the data URI, write a temp file, and play via system commands.
  private async _playAudioDataUri(dataUri: string) {
    try {
      const match = dataUri.match(
        /^data:audio\/([a-zA-Z0-9.+-]+);base64,(.+)$/,
      );
      if (!match) return;

      const ext = match[1];
      const base64 = match[2];
      const buffer = Buffer.from(base64, "base64");

      const tmpFile = path.join(
        os.tmpdir(),
        `opencode-audio-${Date.now()}.${ext}`,
      );
      await fs.promises.writeFile(tmpFile, buffer);

      const cleanup = async () => {
        try {
          await fs.promises.unlink(tmpFile);
        } catch {}
      };

      let cmd: string;
      switch (process.platform) {
        case "darwin":
          cmd = `afplay "${tmpFile}"`;
          break;
        case "linux":
          // Try paplay (PulseAudio) first, fall back to aplay (ALSA)
          cmd = `paplay "${tmpFile}" 2>/dev/null || aplay "${tmpFile}"`;
          break;
        case "win32":
          // PowerShell MediaPlayer can handle most audio formats
          cmd = `powershell -c "(New-Object Media.SoundPlayer '${tmpFile}').PlaySync()"`;
          break;
        default:
          await cleanup();
          return;
      }

      exec(cmd, { timeout: 10_000 }, (err) => {
        void cleanup();
        if (err) {
          console.error("[OpenCode] System audio playback failed:", err.message);
        }
      });
    } catch (err) {
      console.error("[OpenCode] Failed to play audio data URI:", err);
    }
  }
}
