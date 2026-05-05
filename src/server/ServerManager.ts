import * as vscode from "vscode";
import { ChildProcess, spawn } from "child_process";
import * as http from "http";
import { log, logError } from "../logger";
import { startWebviewProxy } from "../proxy/WebviewProxy";
import { OpencodeViewProvider } from "../webview/OpencodeViewProvider";

type StartOptions = {
  provider: OpencodeViewProvider;
  context: vscode.ExtensionContext;
  cwd: string;
  port: number;
  proxyPort: number;
  exposeToNetwork: boolean;
  fixedPort: boolean;
};

export class ServerManager {
  private serverProcess: ChildProcess | undefined;
  private proxyServer: http.Server | undefined;

  async start(options: StartOptions): Promise<void> {
    const serverUrl = `http://localhost:${options.port}`;
    log(`ServerManager.start: cwd="${options.cwd}"`);

    if (await this.isServerAlive(serverUrl)) {
      log(`Using OpenCode server: ${serverUrl}`);
      await this.openInWebview(options, serverUrl);
      return;
    }

    await this.spawnServer(options, serverUrl);
  }

  dispose(): void {
    log("ServerManager.dispose()");

    if (this.proxyServer) {
      this.proxyServer.close();
      this.proxyServer = undefined;
    }

    if (this.serverProcess) {
      log(`Killing OpenCode process (PID=${this.serverProcess.pid})`);
      this.serverProcess.kill();
      this.serverProcess = undefined;
    }
  }

  private async spawnServer(options: StartOptions, expectedUrl: string): Promise<void> {
    const args = ["serve", "--port", options.port.toString()];
    if (options.exposeToNetwork) args.push("--mdns");

    log(`Spawning: opencode ${args.join(" ")} (cwd=${options.cwd})`);

    try {
      this.serverProcess = spawn("opencode", args, {
        cwd: options.cwd,
        stdio: "pipe",
        env: { ...process.env, OPENCODE_CALLER: "vscode" },
      });
    } catch (err) {
      logError("Failed to spawn OpenCode", err);
      options.provider.setError("Failed to start the OpenCode server.");
      return;
    }

    log(`OpenCode process spawned, PID=${this.serverProcess.pid}`);
    let resolved = false;

    const resolveServer = async (url: string) => {
      if (resolved) return;
      resolved = true;

      if (options.fixedPort && new URL(url).port !== String(options.port)) {
        log(`Ignoring unexpected OpenCode port from child process: ${url}`);
        if (await this.waitUntilAlive(expectedUrl)) {
          this.serverProcess?.kill();
          this.serverProcess = undefined;
          await this.openInWebview(options, expectedUrl);
          return;
        }

        this.serverProcess?.kill();
        this.serverProcess = undefined;
        options.provider.setError(`OpenCode did not start on the configured port ${options.port}.`, false);
        return;
      }

      await this.openInWebview(options, options.fixedPort ? expectedUrl : url);
    };

    const handleOutput = (data: Buffer) => {
      const match = data.toString().match(/https?:\/\/[^\s]+/);
      if (match) void resolveServer(match[0]);
    };

    this.serverProcess.stdout?.on("data", handleOutput);
    this.serverProcess.stderr?.on("data", handleOutput);

    this.serverProcess.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      logError("OpenCode process error", err);

      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        options.provider.setError("Could not find the <code>opencode</code> CLI.");
      } else {
        options.provider.setError(`Failed to start server: ${err.message}`);
      }
    });

    this.serverProcess.on("exit", async (code) => {
      log(`OpenCode process exited with code ${code}`);
      if (resolved || code === null || code === 0) return;

      if (options.fixedPort && (await this.waitUntilAlive(expectedUrl))) {
        resolved = true;
        await this.openInWebview(options, expectedUrl);
        return;
      }

      resolved = true;
      options.provider.setError(
        `OpenCode server exited with code ${code}. Check that your opencode installation is working.`,
      );
    });

    setTimeout(() => void resolveServer(expectedUrl), 5000);
  }

  private async openInWebview(options: StartOptions, serverUrl: string): Promise<void> {
    const workspacePath = `/${Buffer.from(options.cwd).toString("base64url")}`;
    const directServerUrl = `http://localhost:${options.port}`;

    try {
      const parsed = new URL(serverUrl);
      const targetPort = Number(parsed.port);

      log("Starting VS Code webview bridge");
      const proxy = await startWebviewProxy(targetPort, options.proxyPort, directServerUrl);
      this.proxyServer = proxy.server;

      if (proxy.port !== options.proxyPort) {
        options.context.globalState.update("opencode.proxyPort", proxy.port);
      }

      parsed.port = proxy.port.toString();
      parsed.pathname = workspacePath;
      options.provider.setServerUrl(parsed.toString());
    } catch (err) {
      logError("VS Code webview bridge failed", err);
      const fallback = new URL(serverUrl);
      fallback.pathname = workspacePath;
      options.provider.setServerUrl(fallback.toString());
    }
  }

  private async waitUntilAlive(url: string): Promise<boolean> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await this.isServerAlive(url, false)) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }

  private async isServerAlive(url: string, logResult = true): Promise<boolean> {
    const healthUrl = new URL("/global/health", url).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(healthUrl, { signal: controller.signal });
      if (logResult) log(`isServerAlive(${healthUrl}) = ${res.ok} (status=${res.status})`);
      return res.ok;
    } catch (err) {
      if (logResult) {
        log(`isServerAlive(${healthUrl}) = false (${err instanceof Error ? err.message : String(err)})`);
      }
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
