import type { WebviewRenderState } from "./webviewRenderer";

export type WebviewHostType = "sidebar" | "editor";

export interface OpencodeWebviewHost {
  readonly id: string;
  readonly title: string;
  readonly type: WebviewHostType;
  readonly isLiveHost: boolean;
  readonly isActiveHost: boolean;
  readonly lastUsedAt: number;
  readonly disposed: boolean;
  renderState(state: WebviewRenderState): void;
  postInsertText(text: string): Thenable<boolean> | undefined;
  reveal(): Thenable<void> | void;
}
