import * as path from "path";
import * as vscode from "vscode";
import { ServerManager } from "./server/ServerManager";
import { OpencodeViewProvider } from "./webview/OpencodeViewProvider";
import { log } from "./logger";

type ServerConfig = {
  port: number;
  proxyPort: number;
  exposeToNetwork: boolean;
  fixedPort: boolean;
};

let provider: OpencodeViewProvider | undefined;
let serverManager: ServerManager | undefined;
let starting = false;

const SIDEBAR_CMDS = {
  primary: "workbench.action.toggleSidebarVisibility",
  auxiliary: "workbench.action.toggleAuxiliaryBar",
} as const;

function randomPort(): number {
  return Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384;
}

function workspacePath(): string | undefined {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return cwd ? path.normalize(cwd) : undefined;
}

function serverConfig(context: vscode.ExtensionContext): ServerConfig {
  const config = vscode.workspace.getConfiguration("opencode");
  const configuredPort = config.get<number>("port", 4096);
  const fixedPort = configuredPort > 0;
  const port = fixedPort ? configuredPort : randomPort();
  const proxyPort = context.globalState.get<number>("opencode.proxyPort") ?? randomPort();
  const exposeToNetwork = config.get<boolean>("exposeToNetwork", false);

  log(`Config: port=${port}, proxyPort=${proxyPort}, exposeToNetwork=${exposeToNetwork}`);
  return { port, proxyPort, exposeToNetwork, fixedPort };
}

async function startServer(context: vscode.ExtensionContext): Promise<void> {
  if (starting) {
    log("startServer: already starting");
    return;
  }

  const cwd = workspacePath();
  if (!cwd) {
    log("No workspace folder");
    provider?.setLoading();
    return;
  }

  starting = true;
  try {
    serverManager?.dispose();
    serverManager = new ServerManager();

    const config = serverConfig(context);
    log(`Starting OpenCode for workspace: ${cwd}`);
    await serverManager.start({
      provider: provider!,
      context,
      cwd,
      ...config,
    });
  } finally {
    starting = false;
  }
}

function selectionReference(editor: vscode.TextEditor): string {
  const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
  const sel = editor.selection;

  if (sel.isEmpty) return `${relativePath}:${sel.start.line + 1}`;
  if (sel.start.line === sel.end.line) {
    return `${relativePath}:${sel.start.line + 1}:${sel.start.character + 1}-${sel.end.character + 1}`;
  }
  return `${relativePath}:${sel.start.line + 1}:${sel.start.character + 1}-${sel.end.line + 1}:${sel.end.character + 1}`;
}

function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode.addToChat", (uri?: vscode.Uri) => {
      const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (fileUri) provider?.addToChat(vscode.workspace.asRelativePath(fileUri));
    }),

    vscode.commands.registerCommand("opencode.addSelectionToChat", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) provider?.addToChat(selectionReference(editor));
    }),

    vscode.commands.registerCommand("opencode.restart", () => {
      log("Restart command invoked");
      serverManager?.dispose();
      provider?.setLoading();
      void startServer(context);
    }),

    vscode.commands.registerCommand("opencode.toggleChatView", async () => {
      if (!provider?.isViewVisible) {
        await vscode.commands.executeCommand("opencode.chatView.focus");
        return;
      }

      const first = provider.sidebarType ?? "auxiliary";
      await vscode.commands.executeCommand(SIDEBAR_CMDS[first]);

      if (!provider.isViewVisible) {
        provider.sidebarType = first;
        context.globalState.update("opencode.sidebarType", first);
        return;
      }

      await vscode.commands.executeCommand(SIDEBAR_CMDS[first]);
      const other = first === "auxiliary" ? "primary" : "auxiliary";
      await vscode.commands.executeCommand(SIDEBAR_CMDS[other]);
      provider.sidebarType = other;
      context.globalState.update("opencode.sidebarType", other);
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("opencode.port") && !e.affectsConfiguration("opencode.exposeToNetwork")) {
        return;
      }

      log("OpenCode configuration changed");
      vscode.window
        .showInformationMessage("opencode settings changed. Restart to apply?", "Restart")
        .then((choice) => {
          if (choice === "Restart") void vscode.commands.executeCommand("opencode.restart");
        });
    }),
  );
}

export function activate(context: vscode.ExtensionContext): void {
  log("=== activate() called ===");
  log(`Platform: ${process.platform}, VS Code: ${vscode.version}`);

  provider = new OpencodeViewProvider();
  provider.sidebarType = context.globalState.get<"primary" | "auxiliary">("opencode.sidebarType") ?? null;

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("opencode.chatView", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void startServer(context)),
  );

  registerCommands(context);
  void startServer(context);

  log("=== activate() complete ===");
}

export function deactivate(): void {
  log("=== deactivate() called ===");
  serverManager?.dispose();
  serverManager = undefined;
}
