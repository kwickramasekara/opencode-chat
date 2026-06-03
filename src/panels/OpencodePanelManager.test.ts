import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { Disposable, Uri, ViewColumn, createdWebviewPanels, window } from "../test/vscodeMock";
import type { ConnectionStateHost } from "../server/ServerManager";
import { OpencodePanelManager } from "./OpencodePanelManager";

function createConnectionManagerMock() {
  const hosts: ConnectionStateHost[] = [];
  return {
    hosts,
    subscribe: vi.fn((host: ConnectionStateHost) => {
      hosts.push(host);
      host.renderState({ type: "loading" });
      return new Disposable(() => {
        const index = hosts.indexOf(host);
        if (index >= 0) hosts.splice(index, 1);
      });
    }),
  };
}

describe("OpencodePanelManager", () => {
  it("opens distinct editor chat panels in the requested columns", () => {
    /*
     * Scenario: opening editor chat creates independent panel hosts
     *   Given the panel manager is connected to the shared connection manager
     *   When the user opens chat twice normally and once beside
     *   Then VS Code receives active-column panels for normal opens
     *   And a beside-column panel for openChatBeside
     *   And each live host has a unique id and title
     */
    const connection = createConnectionManagerMock();
    const manager = new OpencodePanelManager(
      Uri.file("/extension") as unknown as vscode.Uri,
      connection,
    );

    const first = manager.openChat();
    const second = manager.openChat();
    const beside = manager.openChatBeside();

    expect(window.createWebviewPanel).toHaveBeenNthCalledWith(
      1,
      "opencode.chatPanel",
      "opencode Chat 1",
      ViewColumn.Active,
      expect.objectContaining({ retainContextWhenHidden: true }),
    );
    expect(window.createWebviewPanel).toHaveBeenNthCalledWith(
      3,
      "opencode.chatPanel",
      "opencode Chat 3",
      ViewColumn.Beside,
      expect.objectContaining({ retainContextWhenHidden: true }),
    );
    expect(new Set([first.id, second.id, beside.id]).size).toBe(3);
    expect(new Set([first.title, second.title, beside.title]).size).toBe(3);
    expect(manager.getLiveHosts()).toHaveLength(3);
  });

  it("subscribes panels to connection state and disposes one panel without stopping shared connection", () => {
    /*
     * Scenario: panel host lifecycle is isolated from the shared server
     *   Given two editor panels are open
     *   When the connection manager publishes loading, ready, and error states
     *   Then each panel renders those states with editor layout
     *   When one panel closes
     *   Then only that host unsubscribes and is removed from live routing
     */
    const connection = createConnectionManagerMock();
    const manager = new OpencodePanelManager(
      Uri.file("/extension") as unknown as vscode.Uri,
      connection,
    );

    manager.openChat();
    manager.openChat();
    const [firstPanel, secondPanel] = createdWebviewPanels;

    connection.hosts.forEach((host) =>
      host.renderState({ type: "ready", serverUrl: "http://localhost:4096" }),
    );
    expect(firstPanel.webview.html).toContain("http://localhost:4096");
    expect(firstPanel.webview.html).not.toContain("max-width: 640px");
    expect(secondPanel.webview.html).toContain("http://localhost:4096");

    connection.hosts.forEach((host) =>
      host.renderState({ type: "error", message: "boom", showInstallHint: false }),
    );
    expect(firstPanel.webview.html).toContain("boom");
    expect(secondPanel.webview.html).toContain("boom");

    firstPanel.fireDidDispose();

    expect(manager.getLiveHosts()).toHaveLength(1);
    expect(connection.hosts).toHaveLength(1);
    expect(secondPanel.dispose).not.toHaveBeenCalled();
  });

  it("updates recency when panels become active and receive routed insert text", async () => {
    /*
     * Scenario: panel recency follows user activity
     *   Given two editor panels are live
     *   When a panel becomes active
     *   Then its last-used timestamp advances
     *   When text is routed into a panel
     *   Then that panel also becomes the most recent host
     */
    vi.useFakeTimers();
    try {
      const connection = createConnectionManagerMock();
      const manager = new OpencodePanelManager(
        Uri.file("/extension") as unknown as vscode.Uri,
        connection,
      );
      const first = manager.openChat();
      const second = manager.openChat();
      const [firstPanel, secondPanel] = createdWebviewPanels;

      vi.setSystemTime(1_000);
      secondPanel.active = true;
      secondPanel.fireDidChangeViewState();
      expect(second.lastUsedAt).toBe(1_000);
      expect(second.isActiveHost).toBe(true);

      secondPanel.active = false;
      secondPanel.fireDidChangeViewState();
      expect(second.isActiveHost).toBe(false);

      vi.setSystemTime(2_000);
      await first.postInsertText("src/main.ts");
      expect(first.lastUsedAt).toBe(2_000);
      expect(firstPanel.webview.postMessage).toHaveBeenCalledWith({
        type: "insert-text",
        text: "src/main.ts",
      });
      expect(manager.getLiveHosts()[0]).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });
});
