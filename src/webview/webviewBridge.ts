import * as vscode from "vscode";

type WebviewMessage =
  | { type: "paste-request" }
  | { type: "copy-request"; text?: unknown }
  | { type: "play-audio"; src?: unknown };

export interface WebviewBridgeOptions {
  webview: vscode.Webview;
  playAudio?: (src: string) => void | Promise<void>;
}

export interface WebviewBridge {
  postInsertText(text: string): Thenable<boolean>;
  postPasteResponse(text: string): Thenable<boolean>;
  dispose(): void;
}

export function setupWebviewBridge({
  webview,
  playAudio,
}: WebviewBridgeOptions): WebviewBridge {
  webview.options = {
    ...webview.options,
    enableScripts: true,
  };

  const messageSubscription = webview.onDidReceiveMessage(
    async (message: WebviewMessage) => {
      if (message?.type === "paste-request") {
        const text = await vscode.env.clipboard.readText();
        await postPasteResponse(webview, text);
        return;
      }

      if (message?.type === "copy-request" && typeof message.text === "string") {
        await vscode.env.clipboard.writeText(message.text);
        return;
      }

      if (message?.type === "play-audio" && typeof message.src === "string") {
        await playAudio?.(message.src);
      }
    },
  );

  return {
    postInsertText(text: string) {
      return webview.postMessage({ type: "insert-text", text });
    },
    postPasteResponse(text: string) {
      return postPasteResponse(webview, text);
    },
    dispose() {
      messageSubscription.dispose();
    },
  };
}

function postPasteResponse(
  webview: vscode.Webview,
  text: string,
): Thenable<boolean> {
  return webview.postMessage({ type: "paste-response", text });
}
