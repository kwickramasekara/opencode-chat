import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { createWebviewMock } from "../test/vscodeMock";
import { setupWebviewBridge } from "./webviewBridge";

function getMessageHandler(webview: ReturnType<typeof createWebviewMock>) {
  const handler = (webview.onDidReceiveMessage as unknown as { mock: { calls: unknown[][] } }).mock
    .calls[0]?.[0];
  if (!handler) throw new Error("missing webview message handler");
  return handler as (message: unknown) => Promise<void>;
}

describe("webviewBridge", () => {
  it("configures the webview and registers one message handler", () => {
    /*
     * Scenario: webview bridge setup is centralized
     *   Given a sidebar or editor host has a VS Code webview
     *   When the bridge is set up
     *   Then scripts are enabled
     *   And exactly one receive-message handler is registered
     */
    const webview = createWebviewMock();

    setupWebviewBridge({ webview });

    expect(webview.options).toEqual({ enableScripts: true });
    expect(webview.onDidReceiveMessage).toHaveBeenCalledOnce();
  });

  it("reads clipboard text for paste requests and posts a paste response", async () => {
    /*
     * Scenario: iframe paste requests fall back to VS Code clipboard text
     *   Given the iframe asks the extension host for pasted text
     *   When the bridge receives a paste-request message
     *   Then it reads VS Code clipboard text
     *   And posts a paste-response message back to the webview shell
     */
    const webview = createWebviewMock();
    vi.mocked(vscode.env.clipboard.readText).mockResolvedValue("clipboard text");
    setupWebviewBridge({ webview });

    await getMessageHandler(webview)({ type: "paste-request", text: "ignored" });

    expect(vscode.env.clipboard.readText).toHaveBeenCalledOnce();
    expect(webview.postMessage).toHaveBeenCalledWith({
      type: "paste-response",
      text: "clipboard text",
    });
  });

  it("writes clipboard text for copy requests", async () => {
    /*
     * Scenario: iframe copy requests write text through VS Code
     *   Given the iframe asks to copy text
     *   When the bridge receives a copy-request message
     *   Then the text is written to VS Code clipboard
     */
    const webview = createWebviewMock();
    setupWebviewBridge({ webview });

    await getMessageHandler(webview)({ type: "copy-request", text: "copy me" });

    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith("copy me");
  });

  it("delegates audio playback without logging message payloads", async () => {
    /*
     * Scenario: audio messages stay private at the bridge boundary
     *   Given the iframe sends a play-audio message with a data URI payload
     *   When the bridge receives the message
     *   Then audio playback is delegated
     *   And the bridge does not log the message payload
     */
    const webview = createWebviewMock();
    const playAudio = vi.fn(async () => undefined);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    setupWebviewBridge({ webview, playAudio });

    try {
      await getMessageHandler(webview)({
        type: "play-audio",
        src: "data:audio/wav;base64,PRIVATE_AUDIO_PAYLOAD",
      });

      expect(playAudio).toHaveBeenCalledWith(
        "data:audio/wav;base64,PRIVATE_AUDIO_PAYLOAD",
      );
      expect(consoleLog).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleLog.mockRestore();
      consoleWarn.mockRestore();
      consoleError.mockRestore();
    }
  });

  it("posts insert-text and paste-response messages safely through returned helpers", async () => {
    /*
     * Scenario: hosts send text back into the iframe through bridge helpers
     *   Given a webview bridge is set up for a host
     *   When the host posts insert-text and paste-response messages
     *   Then messages use the expected public iframe protocol shapes
     */
    const webview = createWebviewMock();
    const bridge = setupWebviewBridge({ webview });

    await bridge.postInsertText("src/main.ts");
    await bridge.postPasteResponse("clipboard text");

    expect(webview.postMessage).toHaveBeenCalledWith({
      type: "insert-text",
      text: "src/main.ts",
    });
    expect(webview.postMessage).toHaveBeenCalledWith({
      type: "paste-response",
      text: "clipboard text",
    });
  });
});
