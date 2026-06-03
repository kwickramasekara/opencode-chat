import { EventEmitter } from "events";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { createExtensionContextMock, env, Uri, workspace } from "../test/vscodeMock";
import { ServerManager, type ConnectionState } from "./ServerManager";

function createHost(id: string) {
  return {
    id,
    states: [] as ConnectionState[],
    renderState(state: ConnectionState) {
      this.states.push(state);
    },
  };
}

function createDiagnostics() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    appendProcessOutput: vi.fn(),
  };
}

function createChildProcessMock() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ServerManager connection fan-out", () => {
  it("publishes external ready state to every subscribed host and new hosts receive current state", async () => {
    /*
     * Scenario: connection state fans out to all chat hosts
     *   Given a previous opencode server and proxy are still alive on stored ports
     *   When the connection manager starts and a second host subscribes later
     *   Then the first host receives loading then ready
     *   And the late host immediately receives the ready state
     *   And the ready URL has been rewritten through VS Code asExternalUri
     */
    const context = createExtensionContextMock();
    const diagnostics = createDiagnostics();
    const manager = new ServerManager({
      diagnostics,
      isServerAlive: vi.fn(async () => true),
    });
    const hostA = createHost("a");
    const hostB = createHost("b");
    vi.mocked(env.asExternalUri).mockImplementation(async (uri) =>
      Uri.parse(`vscode-remote:${encodeURIComponent(uri.toString())}`),
    );

    manager.subscribe(hostA);
    await manager.start(context as unknown as vscode.ExtensionContext, 4100, 5100, false);
    manager.subscribe(hostB);

    expect(hostA.states).toEqual([
      { type: "loading" },
      { type: "loading" },
      {
        type: "ready",
        serverUrl: "vscode-remote:http%3A%2F%2Flocalhost%3A5100%2FL3dvcmtzcGFjZQ",
      },
    ]);
    expect(hostB.states).toEqual([
      {
        type: "ready",
        serverUrl: "vscode-remote:http%3A%2F%2Flocalhost%3A5100%2FL3dvcmtzcGFjZQ",
      },
    ]);
    expect(context.globalState.update).toHaveBeenCalledWith("opencode.serverPort", 4100);
    expect(context.globalState.update).toHaveBeenCalledWith("opencode.proxyPort", 5100);
    expect(diagnostics.info).toHaveBeenCalledWith(expect.stringContaining("Reusing opencode server"));
    expect(diagnostics.info).toHaveBeenCalledWith(expect.stringContaining("Reusing webview proxy"));
  });

  it("unsubscribe stops future updates and restart publishes loading plus error to remaining hosts", async () => {
    /*
     * Scenario: hosts can unsubscribe from connection lifecycle updates
     *   Given two chat hosts are subscribed
     *   When one host unsubscribes and restart runs without a workspace folder
     *   Then only the remaining host receives loading and the no-workspace error
     *   And the error does not show an install hint
     */
    const context = createExtensionContextMock();
    const manager = new ServerManager({ isServerAlive: vi.fn(async () => true) });
    const hostA = createHost("a");
    const hostB = createHost("b");
    const subscriptionA = manager.subscribe(hostA);
    manager.subscribe(hostB);

    await manager.start(context as unknown as vscode.ExtensionContext, 4100, 5100, false);
    subscriptionA.dispose();
    workspace.workspaceFolders = undefined;
    await manager.restart(context as unknown as vscode.ExtensionContext, 4100, 5100, false);

    expect(hostA.states.at(-1)?.type).toBe("ready");
    expect(hostB.states.slice(-2)).toEqual([
      { type: "loading" },
      { type: "error", message: "No workspace folder open.", showInstallHint: false },
    ]);
  });

  it("appends stdout and stderr chunks to diagnostics while still parsing the ready URL", async () => {
    /*
     * Scenario: process output is both diagnosable and functional
     *   Given no existing opencode server is alive
     *   When the spawned process emits stdout and stderr chunks containing a server URL
     *   Then raw process chunks are sent to diagnostics for safe line handling
     *   And URL parsing still drives the ready connection state through the proxy
     */
    const context = createExtensionContextMock();
    const diagnostics = createDiagnostics();
    const child = createChildProcessMock();
    const manager = new ServerManager({
      diagnostics,
      isServerAlive: vi.fn(async () => false),
      startProxy: vi.fn(async () => ({ server: undefined, port: 6200 })),
      spawnProcess: vi.fn(() => child) as never,
    });
    const host = createHost("host");
    manager.subscribe(host);

    await manager.start(context as unknown as vscode.ExtensionContext, 4100, 5100, false);
    child.stdout.emit("data", Buffer.from("TOKEN=secret\nListening at http://127.0.0.1:4100\n"));
    child.stderr.emit("data", Buffer.from("ready\n"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    expect(diagnostics.appendProcessOutput).toHaveBeenCalledWith(
      "stdout",
      Buffer.from("TOKEN=secret\nListening at http://127.0.0.1:4100\n"),
    );
    expect(diagnostics.appendProcessOutput).toHaveBeenCalledWith("stderr", Buffer.from("ready\n"));
    expect(host.states.at(-1)).toEqual({
      type: "ready",
      serverUrl: "http://localhost:6200/L3dvcmtzcGFjZQ",
    });
  });

  it("cancels stale fallback timers so restart loading is not overwritten by an old ready state", async () => {
    /*
     * Scenario: restart invalidates a previous startup fallback
     *   Given a spawned server from an old start has not emitted a URL yet
     *   When restart begins a new generation that fails before the old fallback fires
     *   Then the new loading/error state remains current
     *   And the stale fallback cannot publish ready for the previous port
     */
    vi.useFakeTimers();
    const context = createExtensionContextMock();
    const child = createChildProcessMock();
    const manager = new ServerManager({
      isServerAlive: vi.fn(async () => false),
      startProxy: vi.fn(async () => ({ server: undefined, port: 6200 })),
      spawnProcess: vi.fn(() => child) as never,
    });
    const host = createHost("host");
    manager.subscribe(host);

    await manager.start(context as unknown as vscode.ExtensionContext, 4100, 5100, false);
    workspace.workspaceFolders = undefined;
    await manager.restart(context as unknown as vscode.ExtensionContext, 4200, 5200, false);
    await vi.advanceTimersByTimeAsync(5000);

    expect(host.states.slice(-2)).toEqual([
      { type: "loading" },
      { type: "error", message: "No workspace folder open.", showInstallHint: false },
    ]);
    expect(host.states).not.toContainEqual(
      expect.objectContaining({ type: "ready", serverUrl: expect.stringContaining("4100") }),
    );
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("closes stale async proxy completion after dispose", async () => {
    /*
     * Scenario: dispose invalidates in-flight proxy setup
     *   Given an old start has detected a server URL and is awaiting proxy setup
     *   When the manager is disposed before the proxy resolves
     *   Then resolving the old proxy closes the stale proxy server
     *   And it cannot publish a stale ready state
     */
    const context = createExtensionContextMock();
    const child = createChildProcessMock();
    const proxyServer = { close: vi.fn() };
    let resolveProxy!: (value: { server: typeof proxyServer; port: number }) => void;
    const proxyStarted = new Promise<{ server: typeof proxyServer; port: number }>((resolve) => {
      resolveProxy = resolve;
    });
    const manager = new ServerManager({
      isServerAlive: vi.fn(async () => false),
      startProxy: vi.fn(() => proxyStarted),
      spawnProcess: vi.fn(() => child) as never,
    });
    const host = createHost("host");
    manager.subscribe(host);

    await manager.start(context as unknown as vscode.ExtensionContext, 4100, 5100, false);
    child.stdout.emit("data", Buffer.from("Listening at http://127.0.0.1:4100\n"));
    await Promise.resolve();
    manager.dispose();
    resolveProxy({ server: proxyServer, port: 6200 });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    expect(proxyServer.close).toHaveBeenCalledOnce();
    expect(host.states).toEqual([{ type: "loading" }, { type: "loading" }]);
    expect(context.globalState.update).not.toHaveBeenCalledWith("opencode.proxyPort", 6200);
  });

  it("resets current state for future subscribers after dispose without publishing", async () => {
    /*
     * Scenario: dispose clears cached ready state for future hosts
     *   Given a manager has published ready to an existing host
     *   When the manager is disposed
     *   Then existing hosts are not notified during dispose
     *   And a future subscriber immediately receives loading instead of stale ready
     */
    const context = createExtensionContextMock();
    const manager = new ServerManager({
      isServerAlive: vi.fn(async () => true),
    });
    const existingHost = createHost("existing");
    const futureHost = createHost("future");
    manager.subscribe(existingHost);

    await manager.start(context as unknown as vscode.ExtensionContext, 4100, 5100, false);
    expect(existingHost.states.at(-1)?.type).toBe("ready");

    manager.dispose();
    manager.subscribe(futureHost);

    expect(existingHost.states.at(-1)?.type).toBe("ready");
    expect(futureHost.states).toEqual([{ type: "loading" }]);
  });

  it("logs workspace labels without dumping the full workspace path", async () => {
    /*
     * Scenario: workspace diagnostics are useful without path-heavy logging
     *   Given the extension starts from a nested workspace path
     *   When the server manager logs startup diagnostics
     *   Then the log includes the workspace name and folder basename
     *   And it does not include the full filesystem path
     */
    const context = createExtensionContextMock();
    const diagnostics = createDiagnostics();
    workspace.workspaceFolders = [
      { uri: Uri.file("/home/alice/private/client/project-a"), name: "Project A", index: 0 },
    ];
    const manager = new ServerManager({
      diagnostics,
      isServerAlive: vi.fn(async () => true),
    });

    await manager.start(context as unknown as vscode.ExtensionContext, 4100, 5100, false);

    expect(diagnostics.info).toHaveBeenCalledWith(
      expect.stringContaining('Using workspace "Project A"'),
    );
    expect(diagnostics.info).toHaveBeenCalledWith(expect.stringContaining('folder "project-a"'));
    expect(diagnostics.info).not.toHaveBeenCalledWith(
      expect.stringContaining("/home/alice/private/client/project-a"),
    );
  });
});
