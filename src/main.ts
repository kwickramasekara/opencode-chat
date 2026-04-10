import * as vscode from "vscode";
import { OpencodeViewProvider } from "./webview/OpencodeViewProvider";
import { ServerManager } from "./server/ServerManager";

let serverManager: ServerManager | undefined;

const SIDEBAR_CMDS = {
  primary: "workbench.action.toggleSidebarVisibility",
  auxiliary: "workbench.action.toggleAuxiliaryBar",
} as const;

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("opencode");

  // If the user specified a port in settings, use it. Otherwise reuse the
  // port from the last session so the iframe origin stays the same across
  // restarts, preserving localStorage (theme, settings, etc.).
  // Use globalState so every workspace shares the same origin and settings.
  const userPort = config.get<number>("port", 0);
  const storedPort = context.globalState.get<number>("opencode.serverPort");
  const port =
    userPort > 0
      ? userPort
      : (storedPort ?? Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384);

  const storedProxyPort =
    context.globalState.get<number>("opencode.proxyPort");
  const proxyPort =
    storedProxyPort ?? Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384;

  const exposeToNetwork = config.get<boolean>("exposeToNetwork", false);

  // Register the webview panel provider
  const provider = new OpencodeViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("opencode.chatView", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Start the opencode server
  serverManager = new ServerManager();
  serverManager.start(provider, context, port, proxyPort, exposeToNetwork);

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

  // Restore cached sidebar type from global state
  const cachedSidebarType = context.globalState.get<"primary" | "auxiliary">(
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
        context.globalState.update("opencode.sidebarType", tryFirst);
        return;
      }

      // Wrong sidebar — undo and try the other
      await vscode.commands.executeCommand(SIDEBAR_CMDS[tryFirst]);
      const other = tryFirst === "auxiliary" ? "primary" : "auxiliary";
      await vscode.commands.executeCommand(SIDEBAR_CMDS[other]);
      provider.sidebarType = other;
      context.globalState.update("opencode.sidebarType", other);
    }),
  );

  // Register the restart command to kill the server and start fresh
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode.restart", () => {
      const restartConfig = vscode.workspace.getConfiguration("opencode");
      const restartUserPort = restartConfig.get<number>("port", 0);
      const restartPort =
        restartUserPort > 0
          ? restartUserPort
          : (context.globalState.get<number>("opencode.serverPort") ?? port);
      const restartProxyPort =
        context.globalState.get<number>("opencode.proxyPort") ?? proxyPort;
      const restartExposeToNetwork = restartConfig.get<boolean>(
        "exposeToNetwork",
        false,
      );

      serverManager?.dispose();
      provider.setLoading();
      serverManager = new ServerManager();
      serverManager.start(
        provider,
        context,
        restartPort,
        restartProxyPort,
        restartExposeToNetwork,
      );
    }),
  );

  // Prompt the user to restart when relevant settings change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("opencode.port") ||
        e.affectsConfiguration("opencode.exposeToNetwork")
      ) {
        vscode.window
          .showInformationMessage(
            "opencode settings changed. Restart to apply?",
            "Restart",
          )
          .then((choice) => {
            if (choice === "Restart") {
              vscode.commands.executeCommand("opencode.restart");
            }
          });
      }
    }),
  );
}

export function deactivate() {
  serverManager?.dispose();
  serverManager = undefined;
}
