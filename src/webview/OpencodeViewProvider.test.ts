import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";
import { Uri, createWebviewViewMock } from "../test/vscodeMock";
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
});
