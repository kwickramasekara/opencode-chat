import * as vscode from "vscode";
import { ChildProcess, spawn } from "child_process";
import * as http from "http";
import * as net from "net";

let serverProcess: ChildProcess | undefined;
let serverPort: number | undefined;
let proxyServer: http.Server | undefined;

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

  // Start the opencode server
  startServer(provider, context);
}

export function deactivate() {
  if (proxyServer) {
    proxyServer.close();
    proxyServer = undefined;
  }
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

// ─── Keyboard Proxy ─────────────────────────────────────────────────
// A lightweight local HTTP proxy that sits between the webview iframe
// and the OpenCode server.  It transparently forwards every request
// but, for HTML responses, injects a small script that re-broadcasts
// keyboard events to the parent webview so copy/paste/cut/selectAll
// work even though the iframe is cross-origin to the webview.

const KEYBOARD_SCRIPT = /*html*/ `<script>(function(){
  document.addEventListener("keydown",function(e){
    var mod=e.metaKey||e.ctrlKey;if(!mod)return;
    switch(e.key.toLowerCase()){
      case"c":document.execCommand("copy");break;
      case"x":document.execCommand("cut");break;
      case"a":e.preventDefault();document.execCommand("selectAll");break;
      case"v":
        e.preventDefault();
        window.parent.postMessage({type:"paste-request"},"*");
        break;
    }
  });
  window.addEventListener("message",function(e){
    if(!e.data||e.data.type!=="paste-response")return;
    if(e.data.image){
      fetch(e.data.image).then(function(r){return r.blob();}).then(function(blob){
        var file=new File([blob],"image.png",{type:e.data.mimeType||"image/png"});
        var dt=new DataTransfer();
        dt.items.add(file);
        var ev=new ClipboardEvent("paste",{clipboardData:dt,bubbles:true,cancelable:true});
        (document.activeElement||document).dispatchEvent(ev);
      });
    }else if(typeof e.data.text==="string"){
      var t=e.data.text,el=document.activeElement;if(!el)return;
      if(el.tagName==="INPUT"||el.tagName==="TEXTAREA"){
        var s=el.selectionStart||0,end=el.selectionEnd||0;
        el.setRangeText(t,s,end,"end");
        el.dispatchEvent(new Event("input",{bubbles:true}));
      }else if(el.isContentEditable||(el.closest&&el.closest("[contenteditable]"))){
        document.execCommand("insertText",false,t);
      }
    }
  });
})();</script>`;

function startKeyboardProxy(targetPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Strip accept-encoding so we get an uncompressed body to inject into
      const headers: Record<string, string | string[] | undefined> = {
        ...req.headers,
      };
      delete headers["accept-encoding"];
      headers.host = `localhost:${targetPort}`;

      const proxyReq = http.request(
        {
          hostname: "localhost",
          port: targetPort,
          path: req.url,
          method: req.method,
          headers,
        },
        (proxyRes) => {
          const ct = proxyRes.headers["content-type"] || "";

          if (ct.includes("text/html")) {
            // Buffer the HTML so we can inject the keyboard script
            let body = "";
            proxyRes.on("data", (chunk: Buffer) => {
              body += chunk.toString();
            });
            proxyRes.on("end", () => {
              body = body.includes("</head>")
                ? body.replace("</head>", KEYBOARD_SCRIPT + "</head>")
                : body + KEYBOARD_SCRIPT;

              const outHeaders = { ...proxyRes.headers };
              outHeaders["content-length"] = Buffer.byteLength(body).toString();
              delete outHeaders["content-encoding"];
              // Remove upstream CSP so our injected script can run
              delete outHeaders["content-security-policy"];
              delete outHeaders["content-security-policy-report-only"];

              res.writeHead(proxyRes.statusCode || 200, outHeaders);
              res.end(body);
            });
          } else {
            // Non-HTML: pipe through untouched
            res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
            proxyRes.pipe(res);
          }
        },
      );

      proxyReq.on("error", () => {
        res.writeHead(502).end();
      });
      req.pipe(proxyReq);
    });

    // Transparent WebSocket proxy (for live-reload, etc.)
    server.on("upgrade", (req, clientSocket, head) => {
      const serverSocket = net.connect(targetPort, "localhost", () => {
        const reqLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
        const hdrs = Object.entries(req.headers)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
          .join("\r\n");
        serverSocket.write(reqLine + hdrs + "\r\n\r\n");
        if (head.length > 0) serverSocket.write(head);

        clientSocket.pipe(serverSocket);
        serverSocket.pipe(clientSocket);
      });
      serverSocket.on("error", () => clientSocket.destroy());
      clientSocket.on("error", () => serverSocket.destroy());
    });

    proxyServer = server;

    server.listen(0, "localhost", () => {
      resolve((server.address() as net.AddressInfo).port);
    });
    server.on("error", reject);
  });
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

  // Helper: start the keyboard proxy and hand the proxied URL to the provider
  const serveViaProxy = async (serverUrl: string) => {
    try {
      const parsed = new URL(serverUrl);
      const realPort = parseInt(parsed.port, 10);
      const pp = await startKeyboardProxy(realPort);
      parsed.port = pp.toString();
      parsed.pathname = `/${Buffer.from(cwd).toString("base64url")}`;
      provider.setServerUrl(parsed.toString());
    } catch {
      // Fallback: serve without proxy
      try {
        const u = new URL(serverUrl);
        u.pathname = `/${Buffer.from(cwd).toString("base64url")}`;
        provider.setServerUrl(u.toString());
      } catch {
        provider.setServerUrl(serverUrl);
      }
    }
  };

  // Check if a server from the previous session is still running on this port.
  // If so, just reuse it instead of spawning a new one.
  const existingUrl = `http://localhost:${port}`;
  if (await isServerAlive(existingUrl)) {
    await serveViaProxy(existingUrl);
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
      serveViaProxy(url);
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
