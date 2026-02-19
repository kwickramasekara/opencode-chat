import * as vscode from "vscode";
import { ChildProcess, spawn } from "child_process";

const TERMINAL_NAME = "opencode";

let serverProcess: ChildProcess | undefined;
let serverPort: number | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Reuse the port from the last session so the iframe origin stays the same
  // across restarts, preserving localStorage (theme, settings, etc.).
  // If no stored port, pick a random one and save it.
  const storedPort = context.workspaceState.get<number>("opencode.serverPort");
  serverPort =
    storedPort ?? Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384;

  // Register the webview panel provider
  const provider = new OpencodeViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("opencode.chatView", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Focus chat command
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode.focusChat", () => {
      vscode.commands.executeCommand("opencode.chatView.focus");
    }),
  );

  // Start the opencode server
  startServer(provider, context);

  // ─── Legacy terminal commands ─────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode.openNewTerminal", async () => {
      await openTerminal(context);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode.openTerminal", async () => {
      const existingTerminal = vscode.window.terminals.find(
        (t) => t.name === TERMINAL_NAME,
      );
      if (existingTerminal) {
        existingTerminal.show();
        return;
      }
      await openTerminal(context);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "opencode.addFilepathToTerminal",
      async () => {
        const fileRef = getActiveFile();
        if (!fileRef) return;

        const terminal = vscode.window.activeTerminal;
        if (!terminal) return;

        if (terminal.name === TERMINAL_NAME) {
          const opts = terminal.creationOptions as vscode.TerminalOptions;
          const port = opts.env?.["_EXTENSION_OPENCODE_PORT"];
          port
            ? await appendPrompt(parseInt(port), fileRef)
            : terminal.sendText(fileRef, false);
          terminal.show();
        }
      },
    ),
  );
}

export function deactivate() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = undefined;
  }
}

// ─── Webview View Provider ───────────────────────────────────────────

class OpencodeViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _serverUrl?: string;
  private _error?: { message: string; showInstallHint: boolean };

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

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
              content="default-src 'none'; frame-src ${serverUrl}; style-src 'unsafe-inline';">
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

// ─── Server Lifecycle ───────────────────────────────────────────────

async function startServer(
  provider: OpencodeViewProvider,
  context: vscode.ExtensionContext,
) {
  const port = serverPort!;
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!cwd) {
    provider.setError("No workspace folder open.", false);
    return;
  }

  // Persist the port so we can reuse it next time (preserves iframe localStorage)
  context.workspaceState.update("opencode.serverPort", port);

  // Check if a server from the previous session is still running on this port.
  // If so, just reuse it instead of spawning a new one.
  const existingUrl = `http://localhost:${port}`;
  if (await isServerAlive(existingUrl)) {
    try {
      const serverUrl = new URL(existingUrl);
      serverUrl.pathname = `/${Buffer.from(cwd).toString("base64url")}`;
      provider.setServerUrl(serverUrl.toString());
    } catch {
      provider.setServerUrl(existingUrl);
    }
    return;
  }

  try {
    serverProcess = spawn("opencode", ["serve", "--port", port.toString()], {
      cwd,
      stdio: "pipe",
      env: {
        ...process.env,
        OPENCODE_CALLER: "vscode",
      },
    });

    let resolved = false;

    const onUrl = (url: string) => {
      if (resolved) return;
      resolved = true;

      try {
        const serverUrl = new URL(url);
        serverUrl.pathname = `/${Buffer.from(cwd).toString("base64url")}`;
        provider.setServerUrl(serverUrl.toString());
      } catch {
        provider.setServerUrl(url);
      }
    };

    // Parse stdout/stderr for the server URL
    const handleOutput = (data: Buffer) => {
      const output = data.toString();
      const match = output.match(/https?:\/\/[^\s]+/);
      if (match) onUrl(match[0]);
    };

    serverProcess.stdout?.on("data", handleOutput);
    serverProcess.stderr?.on("data", handleOutput);

    serverProcess.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        provider.setError("Could not find the <code>opencode</code> CLI.");
      } else {
        provider.setError(`Failed to start server: ${err.message}`);
      }
    });

    serverProcess.on("exit", (code) => {
      if (code !== null && code !== 0) {
        if (!resolved) {
          resolved = true;
          provider.setError(
            `OpenCode server exited with code ${code}. Check that your opencode installation is working.`,
          );
        }
      }
    });

    // Fallback: if we don't see a URL in stdout after 5s, just try the expected URL
    setTimeout(() => {
      onUrl(`http://localhost:${port}`);
    }, 5000);
  } catch {
    provider.setError("Failed to start the OpenCode server.");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Quick health check to see if a server from a previous session is still alive.
async function isServerAlive(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Legacy Terminal Helpers ────────────────────────────────────────

async function openTerminal(context: vscode.ExtensionContext) {
  const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384;
  const terminal = vscode.window.createTerminal({
    name: TERMINAL_NAME,
    iconPath: {
      light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
      dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
    },
    location: {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: false,
    },
    env: {
      _EXTENSION_OPENCODE_PORT: port.toString(),
      OPENCODE_CALLER: "vscode",
    },
  });

  terminal.show();
  terminal.sendText(`opencode --port ${port}`);

  const fileRef = getActiveFile();
  if (!fileRef) return;

  let tries = 10;
  let connected = false;
  do {
    await sleep(200);
    try {
      await fetch(`http://localhost:${port}/app`);
      connected = true;
      break;
    } catch {}
    tries--;
  } while (tries > 0);

  if (connected) {
    await appendPrompt(port, `In ${fileRef}`);
    terminal.show();
  }
}

async function appendPrompt(port: number, text: string) {
  await fetch(`http://localhost:${port}/tui/append-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

function getActiveFile(): string | undefined {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) return;

  const document = activeEditor.document;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) return;

  const relativePath = vscode.workspace.asRelativePath(document.uri);
  let filepathWithAt = `@${relativePath}`;

  const selection = activeEditor.selection;
  if (!selection.isEmpty) {
    const startLine = selection.start.line + 1;
    const endLine = selection.end.line + 1;
    if (startLine === endLine) {
      filepathWithAt += `#L${startLine}`;
    } else {
      filepathWithAt += `#L${startLine}-${endLine}`;
    }
  }

  return filepathWithAt;
}
