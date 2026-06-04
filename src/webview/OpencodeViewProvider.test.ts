import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { Disposable, Uri, createWebviewViewMock } from "../test/vscodeMock";
import { OpencodeViewProvider } from "./OpencodeViewProvider";

function extensionUri(): vscode.Uri {
  return Uri.file("/extension") as unknown as vscode.Uri;
}

describe("OpencodeViewProvider sidebar host adapter", () => {
  it("is not a live host until VS Code resolves the webview view", () => {
    /*
     * Scenario: sidebar host only becomes live after VS Code creates its view
     *   Given the sidebar provider has been constructed during activation
     *   When VS Code has not resolved the webview view yet
     *   Then the provider does not report a live host
     *   And posting insert text has no webview side effect
     *   And failed insert attempts do not advance host recency
     */
    const provider = new OpencodeViewProvider(extensionUri());
    const lastUsedAt = provider.lastUsedAt;

    expect(provider.isLiveHost).toBe(false);
    expect(provider.postInsertText("src/main.ts")).toBeUndefined();
    expect(provider.lastUsedAt).toBe(lastUsedAt);
  });

  it("uses the shared bridge and sidebar renderer after resolve", async () => {
    /*
     * Scenario: resolved sidebar host uses shared webview seams
     *   Given VS Code resolves the sidebar webview view
     *   When the provider renders ready state and posts insert text
     *   Then scripts are configured through the bridge
     *   And ready HTML keeps the sidebar max-width cap
     *   And insert text uses the shared iframe protocol
     */
    const provider = new OpencodeViewProvider(extensionUri());
    const view = createWebviewViewMock();

    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    provider.renderState({ type: "ready", serverUrl: "http://localhost:4096" });
    await provider.postInsertText("src/main.ts");

    expect(provider.isLiveHost).toBe(true);
    expect(view.webview.options).toEqual({ enableScripts: true });
    expect(view.webview.onDidReceiveMessage).toHaveBeenCalledOnce();
    expect(view.webview.html).toContain("max-width: 640px");
    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: "insert-text",
      text: "src/main.ts",
    });
  });

  it("closes the sidebar iframe and bridge without disposing the resolved view", () => {
    /*
     * Scenario: closing the sidebar chat unloads only the embedded chat host
     *   Given VS Code has resolved the sidebar webview view and the server is ready
     *   When the provider closes the sidebar chat
     *   Then the webview stays resolved but is no longer a live chat host
     *   And the iframe HTML and message bridge are removed
     */
    const provider = new OpencodeViewProvider(extensionUri());
    const view = createWebviewViewMock();
    const disposeBridgeSubscription = vi.fn();
    view.webview.onDidReceiveMessage.mockReturnValue(
      new Disposable(disposeBridgeSubscription),
    );

    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    provider.renderState({ type: "ready", serverUrl: "http://localhost:4096" });

    provider.closeChat();

    expect(provider.isLiveHost).toBe(false);
    expect(provider.disposed).toBe(false);
    expect(view.webview.html).toContain("Sidebar chat is closed");
    expect(view.webview.html).not.toContain("<iframe");
    expect(view.webview.html).not.toContain("http://localhost:4096");
    expect(disposeBridgeSubscription).toHaveBeenCalledOnce();
    expect(provider.postInsertText("src/main.ts")).toBeUndefined();
  });

  it("keeps connection updates closed until explicit reopen renders the latest state", () => {
    /*
     * Scenario: connection fan-out does not resurrect a closed sidebar chat
     *   Given the sidebar chat is closed while the server is loading
     *   When later connection states arrive
     *   Then the sidebar remains closed and non-live
     *   When the provider explicitly reopens the chat
     *   Then it renders the most recent saved connection state
     */
    const provider = new OpencodeViewProvider(extensionUri());
    const view = createWebviewViewMock();

    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    provider.setLoading();
    provider.closeChat();

    provider.setServerUrl("http://localhost:4096");

    expect(provider.isLiveHost).toBe(false);
    expect(view.webview.html).toContain("Sidebar chat is closed");
    expect(view.webview.html).not.toContain("http://localhost:4096");

    provider.reopenChat();

    expect(provider.isLiveHost).toBe(true);
    expect(view.webview.html).toContain("http://localhost:4096");
    expect(view.webview.html).toContain("<iframe");

    provider.closeChat();
    provider.setError("opencode failed", false);
    expect(view.webview.html).toContain("Sidebar chat is closed");
    expect(view.webview.html).not.toContain("opencode failed");

    provider.reopenChat();

    expect(provider.isLiveHost).toBe(true);
    expect(view.webview.html).toContain("opencode failed");
    expect(view.webview.html).not.toContain("<iframe");
  });
});
