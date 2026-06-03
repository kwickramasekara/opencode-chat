import * as vscode from "vscode";
import type { ConnectionStateHost, ServerManager } from "../server/ServerManager";
import { setupWebviewBridge, type WebviewBridge } from "../webview/webviewBridge";
import { renderWebviewState, type WebviewRenderState } from "../webview/webviewRenderer";
import type { OpencodeWebviewHost } from "../webview/webviewHost";

type ConnectionSubscriber = Pick<ServerManager, "subscribe">;

const PANEL_VIEW_TYPE = "opencode.chatPanel";

export class OpencodePanelManager {
  private nextPanelNumber = 1;
  private readonly hosts = new Map<string, OpencodePanelHost>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionManager: ConnectionSubscriber,
  ) {}

  openChat(): OpencodeWebviewHost {
    return this.createPanel(vscode.ViewColumn.Active);
  }

  openChatBeside(): OpencodeWebviewHost {
    return this.createPanel(vscode.ViewColumn.Beside);
  }

  getLiveHosts(): OpencodeWebviewHost[] {
    return [...this.hosts.values()]
      .filter((host) => host.isLiveHost)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  dispose(): void {
    for (const host of [...this.hosts.values()]) {
      host.dispose(true);
    }
    this.hosts.clear();
  }

  private createPanel(column: vscode.ViewColumn): OpencodeWebviewHost {
    const panelNumber = this.nextPanelNumber++;
    const id = `opencode.chatPanel.${panelNumber}`;
    const title = `opencode Chat ${panelNumber}`;
    const panel = vscode.window.createWebviewPanel(PANEL_VIEW_TYPE, title, column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.extensionUri],
    });
    const host = new OpencodePanelHost(id, title, panel, () => {
      this.hosts.delete(id);
    });

    this.hosts.set(id, host);
    host.attachConnection(this.connectionManager.subscribe(host));
    return host;
  }
}

class OpencodePanelHost implements OpencodeWebviewHost, ConnectionStateHost {
  readonly type = "editor";

  private bridge: WebviewBridge | undefined;
  private state: WebviewRenderState = { type: "loading" };
  private connectionSubscription: vscode.Disposable | undefined;
  private disposables: vscode.Disposable[] = [];
  private lastUsed = Date.now();
  private isDisposed = false;

  constructor(
    readonly id: string,
    readonly title: string,
    private readonly panel: vscode.WebviewPanel,
    private readonly onDisposed: () => void,
  ) {
    this.bridge = setupWebviewBridge({ webview: panel.webview });
    this.disposables.push(
      panel.onDidChangeViewState(() => {
        if (panel.active) this.touch();
      }),
      panel.onDidDispose(() => this.dispose(false)),
    );
    this.renderCurrentState();
  }

  get isLiveHost(): boolean {
    return !this.isDisposed;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  get lastUsedAt(): number {
    return this.lastUsed;
  }

  attachConnection(subscription: vscode.Disposable): void {
    this.connectionSubscription = subscription;
  }

  renderState(state: WebviewRenderState): void {
    this.state = state;
    this.renderCurrentState();
  }

  postInsertText(text: string): Thenable<boolean> | undefined {
    if (!this.isLiveHost || !this.bridge) return undefined;

    return this.bridge.postInsertText(text).then((posted) => {
      if (posted) this.touch();
      return posted;
    });
  }

  reveal(): void {
    this.touch();
    this.panel.reveal();
  }

  dispose(disposePanel = false): void {
    if (this.isDisposed) return;

    this.isDisposed = true;
    if (disposePanel) this.panel.dispose();
    this.connectionSubscription?.dispose();
    this.connectionSubscription = undefined;
    this.bridge?.dispose();
    this.bridge = undefined;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    this.onDisposed();
  }

  private renderCurrentState(): void {
    if (this.isDisposed) return;
    this.panel.webview.html = renderWebviewState(this.state, "editor");
  }

  private touch(): void {
    this.lastUsed = Date.now();
  }
}
