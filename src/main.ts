import * as vscode from "vscode";
import { OpencodeViewProvider } from "./webview/OpencodeViewProvider";
import { ServerManager } from "./server/ServerManager";

let serverManager: ServerManager | undefined;

const SIDEBAR_CMDS = {
  primary: "workbench.action.toggleSidebarVisibility",
  auxiliary: "workbench.action.toggleAuxiliaryBar",
} as const;

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

  // Restore cached sidebar type from workspace state
  const cachedSidebarType = context.workspaceState.get<"primary" | "auxiliary">(
    "opencode.sidebarType",
  );
  if (cachedSidebarType) {
    provider.sidebarType = cachedSidebarType;
  }

  // Register the toggle command for showing/hiding the sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode.toggleChatView", async () => {
      if (!provider.isViewVisible) {
        await vscode.commands.executeCommand("opencode.chatView.focus");
        return;
      }

      // Use cached sidebar type, default to auxiliary (secondary sidebar)
      const tryFirst = provider.sidebarType ?? "auxiliary";
      await vscode.commands.executeCommand(SIDEBAR_CMDS[tryFirst]);

      if (!provider.isViewVisible) {
        provider.sidebarType = tryFirst;
        context.workspaceState.update("opencode.sidebarType", tryFirst);
        return;
      }

      // Wrong sidebar — undo and try the other
      await vscode.commands.executeCommand(SIDEBAR_CMDS[tryFirst]);
      const other = tryFirst === "auxiliary" ? "primary" : "auxiliary";
      await vscode.commands.executeCommand(SIDEBAR_CMDS[other]);
      provider.sidebarType = other;
      context.workspaceState.update("opencode.sidebarType", other);
    }),
  );
}

export function deactivate() {
  serverManager?.dispose();
  serverManager = undefined;
}
