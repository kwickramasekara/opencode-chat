import * as vscode from "vscode";
import { ChildProcess, spawn } from "child_process";
import * as http from "http";
import * as path from "path";
import { startWebviewProxy } from "../proxy/WebviewProxy";
import type { WebviewRenderState } from "../webview/webviewRenderer";

export type ConnectionState = WebviewRenderState;

export interface ConnectionStateHost {
  renderState(state: ConnectionState): void;
}

export interface OpencodeLifecycleDiagnostics {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  appendProcessOutput(source: string, chunk: string | Buffer): void;
}

type ProxyServerLike = Pick<http.Server, "close">;

interface StartOptions {
  skipServerReuse?: boolean;
  skipProxyReuse?: boolean;
}

interface ServerManagerOptions {
  diagnostics?: OpencodeLifecycleDiagnostics;
  isServerAlive?: (url: string) => Promise<boolean>;
  startProxy?: (
    targetPort: number,
    proxyPort?: number,
    diagnostics?: Pick<OpencodeLifecycleDiagnostics, "info" | "warn" | "error">,
  ) => Promise<{ server?: ProxyServerLike; port: number }>;
  spawnProcess?: typeof spawn;
}

export class ServerManager {
  private serverProcess: ChildProcess | undefined;
  private proxyServer: ProxyServerLike | undefined;
  private readonly hosts = new Set<ConnectionStateHost>();
  private state: ConnectionState = { type: "loading" };
  private readonly diagnostics?: OpencodeLifecycleDiagnostics;
  private readonly checkServerAlive: (url: string) => Promise<boolean>;
  private readonly startProxy: NonNullable<ServerManagerOptions["startProxy"]>;
  private readonly spawnProcess: typeof spawn;
  private generation = 0;
  private readonly fallbackTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(options: ServerManagerOptions = {}) {
    this.diagnostics = options.diagnostics;
    this.checkServerAlive = options.isServerAlive ?? ((url) => this.isServerAlive(url));
    this.startProxy = options.startProxy ?? startWebviewProxy;
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  subscribe(host: ConnectionStateHost): vscode.Disposable {
    this.hosts.add(host);
    host.renderState(this.state);

    return new vscode.Disposable(() => {
      this.hosts.delete(host);
    });
  }

  async start(
    context: vscode.ExtensionContext,
    port: number,
    proxyPort: number,
    exposeToNetwork: boolean = false,
  ): Promise<void> {
    await this.startInternal(context, port, proxyPort, exposeToNetwork, {});
  }

  private async startInternal(
    context: vscode.ExtensionContext,
    port: number,
    proxyPort: number,
    exposeToNetwork: boolean,
    options: StartOptions,
  ): Promise<void> {
    const generation = ++this.generation;
    this.clearFallbackTimers();
    this.publishForGeneration(generation, { type: "loading" });

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const cwd = workspaceFolder?.uri.fsPath;

    if (!cwd) {
      this.diagnostics?.warn("No workspace folder open; opencode server not started.");
      this.publishForGeneration(generation, {
        type: "error",
        message: "No workspace folder open.",
        showInstallHint: false,
      });
      return;
    }

    this.diagnostics?.info(`Using workspace ${formatWorkspaceLabel(workspaceFolder.name, cwd)}.`);
    this.diagnostics?.info(
      `Using opencode server port ${port} and webview proxy port ${proxyPort}.`,
    );

    // Persist the port so we can reuse it next time (preserves iframe localStorage).
    await context.globalState.update("opencode.serverPort", port);
    await context.globalState.update("opencode.proxyPort", proxyPort);
    if (!this.isCurrentGeneration(generation)) return;

    const workspacePath = `/${Buffer.from(cwd).toString("base64url")}`;

    const setWebviewServerUrl = async (url: URL) => {
      if (!this.isCurrentGeneration(generation)) return;
      url.pathname = workspacePath;
      const externalUri = await vscode.env.asExternalUri(
        vscode.Uri.parse(url.toString()),
      );
      this.publishForGeneration(generation, { type: "ready", serverUrl: externalUri.toString() });
    };

    const serveViaProxy = async (serverUrl: string) => {
      try {
        if (!this.isCurrentGeneration(generation)) return;
        const parsed = new URL(serverUrl);
        const realPort = parseInt(parsed.port, 10);

        if (
          !options.skipProxyReuse &&
          proxyPort > 0 &&
          (await this.checkServerAlive(`http://localhost:${proxyPort}`))
        ) {
          if (!this.isCurrentGeneration(generation)) return;
          this.diagnostics?.info(`Reusing webview proxy on port ${proxyPort}.`);
          await setWebviewServerUrl(new URL(`http://localhost:${proxyPort}`));
          return;
        }

        this.diagnostics?.info(
          `Starting webview proxy on port ${proxyPort || 0} for opencode port ${realPort}.`,
        );
        const result = await this.startProxy(realPort, proxyPort, this.diagnostics);
        if (!this.isCurrentGeneration(generation)) {
          result.server?.close();
          return;
        }
        this.proxyServer = result.server;

        if (result.port !== proxyPort) {
          this.diagnostics?.warn(
            `Webview proxy requested port ${proxyPort} but is using port ${result.port}.`,
          );
          await context.globalState.update("opencode.proxyPort", result.port);
        }

        await setWebviewServerUrl(new URL(`http://localhost:${result.port}`));
      } catch (err) {
        if (!this.isCurrentGeneration(generation)) return;
        this.diagnostics?.warn(
          `Webview proxy unavailable; falling back to direct server URL. ${formatError(err)}`,
        );
        try {
          const u = new URL(serverUrl);
          if (u.hostname === "0.0.0.0" || u.hostname === "::") {
            u.hostname = "localhost";
          }
          await setWebviewServerUrl(u);
        } catch {
          this.publishForGeneration(generation, { type: "ready", serverUrl });
        }
      }
    };

    const existingUrl = `http://localhost:${port}`;
    if (!options.skipServerReuse && (await this.checkServerAlive(existingUrl))) {
      if (!this.isCurrentGeneration(generation)) return;
      this.diagnostics?.info(`Reusing opencode server at ${existingUrl}.`);
      await serveViaProxy(existingUrl);
      return;
    }

    try {
      const args = ["serve", "--port", port.toString()];
      if (exposeToNetwork) {
        args.push("--mdns");
      }

      this.diagnostics?.info(`Spawning opencode server: opencode ${args.join(" ")}.`);
      this.serverProcess = this.spawnProcess("opencode", args, {
        cwd,
        stdio: "pipe",
        env: {
          ...process.env,
          OPENCODE_CALLER: "vscode",
        },
      });

      let resolved = false;

      const onUrl = (url: string) => {
        if (!this.isCurrentGeneration(generation)) return;
        if (resolved) return;
        resolved = true;
        this.clearFallbackTimers();
        this.diagnostics?.info(`Detected opencode server URL ${url}.`);
        void serveViaProxy(url);
      };

      const handleOutput = (source: "stdout" | "stderr", data: Buffer) => {
        if (!this.isCurrentGeneration(generation)) return;
        this.diagnostics?.appendProcessOutput(source, data);
        const output = data.toString();
        const match = output.match(/https?:\/\/[^\s]+/);
        if (match) onUrl(match[0]);
      };

      this.serverProcess.stdout?.on("data", (data: Buffer) => handleOutput("stdout", data));
      this.serverProcess.stderr?.on("data", (data: Buffer) => handleOutput("stderr", data));

      this.serverProcess.on("error", (err) => {
        if (!this.isCurrentGeneration(generation)) return;
        if (resolved) return;
        resolved = true;
        this.clearFallbackTimers();
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          this.diagnostics?.error("Could not find the opencode CLI.");
          this.publishForGeneration(generation, {
            type: "error",
            message: "Could not find the opencode CLI.",
            showInstallHint: true,
          });
        } else {
          const message = `Failed to start server: ${err.message}`;
          this.diagnostics?.error(message);
          this.publishForGeneration(generation, { type: "error", message, showInstallHint: true });
        }
      });

      this.serverProcess.on("exit", (code) => {
        if (!this.isCurrentGeneration(generation)) return;
        if (code !== null && code !== 0) {
          this.diagnostics?.error(`OpenCode server exited with code ${code}.`);
          resolved = true;
          this.clearFallbackTimers();
          this.publishForGeneration(generation, {
            type: "error",
            message: `OpenCode server exited with code ${code}. Check that your opencode installation is working.`,
            showInstallHint: true,
          });
        }
      });

      const fallbackTimer = setTimeout(() => {
        this.fallbackTimers.delete(fallbackTimer);
        if (!this.isCurrentGeneration(generation)) return;
        if (!resolved) {
          this.diagnostics?.warn(`No server URL detected; trying expected URL ${existingUrl}.`);
          onUrl(existingUrl);
        }
      }, 5000);
      this.fallbackTimers.add(fallbackTimer);
    } catch (err) {
      if (!this.isCurrentGeneration(generation)) return;
      const message = `Failed to start the OpenCode server. ${formatError(err)}`;
      this.diagnostics?.error(message);
      this.publishForGeneration(generation, {
        type: "error",
        message: "Failed to start the OpenCode server.",
        showInstallHint: true,
      });
    }
  }

  async restart(
    context: vscode.ExtensionContext,
    port: number,
    proxyPort: number,
    exposeToNetwork: boolean = false,
  ): Promise<void> {
    this.diagnostics?.info("Restarting opencode server.");
    const stopped = await this.stopOwnedResources(true);
    await this.startInternal(context, port, proxyPort, exposeToNetwork, {
      skipServerReuse: stopped.serverProcess,
      skipProxyReuse: stopped.proxyServer,
    });
  }

  dispose(): void {
    void this.stopOwnedResources(false);
  }

  private async stopOwnedResources(awaitShutdown: boolean): Promise<{
    serverProcess: boolean;
    proxyServer: boolean;
  }> {
    this.generation++;
    this.state = { type: "loading" };
    this.clearFallbackTimers();

    const proxyServer = this.proxyServer;
    const serverProcess = this.serverProcess;

    if (proxyServer) {
      this.diagnostics?.info("Stopping webview proxy.");
      this.proxyServer = undefined;
    }
    if (serverProcess) {
      this.diagnostics?.info("Stopping opencode server process.");
      this.serverProcess = undefined;
    }

    const shutdowns: Array<Promise<void>> = [];
    if (proxyServer) shutdowns.push(closeProxyServer(proxyServer, awaitShutdown));
    if (serverProcess) shutdowns.push(killServerProcess(serverProcess, awaitShutdown));

    if (awaitShutdown) await Promise.all(shutdowns);

    return { serverProcess: !!serverProcess, proxyServer: !!proxyServer };
  }

  private publish(state: ConnectionState): void {
    this.state = state;
    for (const host of this.hosts) {
      host.renderState(state);
    }
  }

  private publishForGeneration(generation: number, state: ConnectionState): void {
    if (!this.isCurrentGeneration(generation)) return;
    this.publish(state);
  }

  private isCurrentGeneration(generation: number): boolean {
    return generation === this.generation;
  }

  private clearFallbackTimers(): void {
    for (const timer of this.fallbackTimers) {
      clearTimeout(timer);
    }
    this.fallbackTimers.clear();
  }

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

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "");
}

function formatWorkspaceLabel(name: string | undefined, cwd: string): string {
  const folderName = path.basename(cwd) || "workspace";
  const parentName = path.basename(path.dirname(cwd));
  const workspaceName = name || folderName;
  const parentLabel = parentName && parentName !== "." ? `, parent ".../${parentName}"` : "";

  return `"${workspaceName}" (folder "${folderName}"${parentLabel})`;
}

function closeProxyServer(server: ProxyServerLike, awaitShutdown: boolean): Promise<void> {
  if (!awaitShutdown) {
    server.close();
    return Promise.resolve();
  }

  return withTimeout(
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
    100,
  );
}

function killServerProcess(process: ChildProcess, awaitShutdown: boolean): Promise<void> {
  if (!awaitShutdown) {
    process.kill();
    return Promise.resolve();
  }

  return withTimeout(
    new Promise<void>((resolve) => {
      process.once("exit", () => resolve());
      process.once("close", () => resolve());
      process.kill();
    }),
    100,
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(), timeoutMs);
    promise.then((value) => {
      clearTimeout(timeout);
      resolve(value);
    });
  });
}
