import * as vscode from "vscode";
import { OpencodeViewProvider } from "./webview/OpencodeViewProvider";
import { ServerManager } from "./server/ServerManager";

let serverManager: ServerManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Reuse the port from the last session so the iframe origin stays the same
  // across restarts, preserving localStorage (theme, settings, etc.).
  // If no stored port, pick a random one and save it.
  const storedPort = context.workspaceState.get<number>("opencode.serverPort");
  const port =
    storedPort ?? Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384;

  const storedProxyPort =
    context.workspaceState.get<number>("opencode.proxyPort");
  const proxyPort =
    storedProxyPort ?? Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384;

  // Register the webview panel provider
  const provider = new OpencodeViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("opencode.chatView", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Start the opencode server
  serverManager = new ServerManager();
  serverManager.start(provider, context, port, proxyPort);

  // Register the opencode.addToChat command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "opencode.addToChat",
      (uri?: vscode.Uri) => {
        const fileUri = uri || vscode.window.activeTextEditor?.document.uri;
        if (fileUri) {
          const relativePath = vscode.workspace.asRelativePath(fileUri);
          provider.addToChat(relativePath);
        }
      },
    ),
  );
}

export function deactivate() {
  serverManager?.dispose();
  serverManager = undefined;
}
