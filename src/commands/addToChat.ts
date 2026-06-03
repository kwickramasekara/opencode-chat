import * as vscode from "vscode";
import type { OpencodeWebviewHost } from "../webview/webviewHost";

interface ChatTargetPickItem extends vscode.QuickPickItem {
  host: OpencodeWebviewHost;
}

export function getLiveChatHosts(hostGroups: Array<OpencodeWebviewHost | OpencodeWebviewHost[]>): OpencodeWebviewHost[] {
  return hostGroups
    .flat()
    .filter((host) => host.isLiveHost && !host.disposed)
    .sort(compareHostsByDefaultPriority);
}

export async function routeTextToChat(
  text: string,
  liveHosts: OpencodeWebviewHost[],
): Promise<void> {
  const hosts = liveHosts
    .filter((host) => host.isLiveHost && !host.disposed)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);

  if (hosts.length === 0) {
    await vscode.window.showInformationMessage("Start opencode chat first.");
    return;
  }

  if (hosts.length === 1) {
    await hosts[0].postInsertText(text);
    return;
  }

  const [lastUsed] = [...hosts].sort(compareHostsByDefaultPriority);
  const items: ChatTargetPickItem[] = [
    { label: `last used (${lastUsed.title})`, host: lastUsed },
    ...hosts.map((host) => ({ label: host.title, description: host.type, host })),
  ];
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select opencode chat target",
  });

  if (!selected) return;
  await selected.host.postInsertText(text);
}

function compareHostsByDefaultPriority(a: OpencodeWebviewHost, b: OpencodeWebviewHost): number {
  const activePriorityDelta = getActiveHostPriority(b) - getActiveHostPriority(a);
  if (activePriorityDelta !== 0) return activePriorityDelta;
  return b.lastUsedAt - a.lastUsedAt;
}

function getActiveHostPriority(host: OpencodeWebviewHost): number {
  if (!host.isActiveHost) return 0;
  return host.type === "editor" ? 2 : 1;
}

export function formatFileReference(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri);
}

export function formatSelectionReference(editor: vscode.TextEditor): string {
  const sel = editor.selection;
  const relativePath = vscode.workspace.asRelativePath(editor.document.uri);

  if (sel.isEmpty) {
    return `${relativePath}:${sel.start.line + 1}`;
  }

  if (sel.start.line === sel.end.line) {
    return `${relativePath}:${sel.start.line + 1}:${sel.start.character + 1}-${sel.end.character + 1}`;
  }

  return `${relativePath}:${sel.start.line + 1}:${sel.start.character + 1}-${sel.end.line + 1}:${sel.end.character + 1}`;
}
