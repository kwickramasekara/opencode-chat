import * as vscode from "vscode";
import { ChildProcess, spawn } from "child_process";
import * as http from "http";
import { OpencodeViewProvider } from "../webview/OpencodeViewProvider";
import { startKeyboardProxy } from "../proxy/KeyboardProxy";

export class ServerManager {
  private serverProcess: ChildProcess | undefined;
  private proxyServer: http.Server | undefined;

  async start(
    provider: OpencodeViewProvider,
    context: vscode.ExtensionContext,
    port: number,
  ): Promise<void> {
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
        const result = await startKeyboardProxy(realPort);
        this.proxyServer = result.server;
        parsed.port = result.port.toString();
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
    if (await this.isServerAlive(existingUrl)) {
      await serveViaProxy(existingUrl);
      return;
    }

    try {
      this.serverProcess = spawn(
        "opencode",
        ["serve", "--port", port.toString()],
        {
          cwd,
          stdio: "pipe",
          env: {
            ...process.env,
            OPENCODE_CALLER: "vscode",
          },
        },
      );

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

      this.serverProcess.stdout?.on("data", handleOutput);
      this.serverProcess.stderr?.on("data", handleOutput);

      this.serverProcess.on("error", (err) => {
        if (resolved) return;
        resolved = true;
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          provider.setError("Could not find the <code>opencode</code> CLI.");
        } else {
          provider.setError(`Failed to start server: ${err.message}`);
        }
      });

      this.serverProcess.on("exit", (code) => {
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

  dispose(): void {
    if (this.proxyServer) {
      this.proxyServer.close();
      this.proxyServer = undefined;
    }
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = undefined;
    }
  }

  // Quick health check to see if a server from a previous session is still alive.
  private async isServerAlive(url: string): Promise<boolean> {
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
}
