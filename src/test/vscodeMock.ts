import { vi } from "vitest";

type DisposableLike = { dispose(): void };

export class Disposable implements DisposableLike {
  constructor(private readonly disposeCallback: () => void = () => {}) {}

  dispose(): void {
    this.disposeCallback();
  }

  static from(...disposables: DisposableLike[]): Disposable {
    return new Disposable(() => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    });
  }
}

export class Uri {
  private constructor(public readonly value: string) {}

  static parse(value: string): Uri {
    return new Uri(value);
  }

  static file(value: string): Uri {
    return new Uri(`file://${value}`);
  }

  static joinPath(base: Uri, ...pathSegments: string[]): Uri {
    return new Uri([base.toString().replace(/\/$/, ""), ...pathSegments].join("/"));
  }

  toString(): string {
    return this.value;
  }
}

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
  Three = 3,
}

export const outputChannels: ReturnType<typeof createOutputChannelMock>[] = [];
export const registeredCommands: Array<{ command: string; callback: (...args: unknown[]) => unknown }> = [];
export const registeredWebviewViewProviders: Array<{ viewType: string; provider: unknown; options?: unknown }> = [];

export function createOutputChannelMock(name = "opencode") {
  const lines: string[] = [];

  return {
    name,
    lines,
    append: vi.fn((value: string) => {
      const lastIndex = lines.length - 1;
      if (lastIndex >= 0) {
        lines[lastIndex] += value;
      } else {
        lines.push(value);
      }
    }),
    appendLine: vi.fn((value: string) => {
      lines.push(value);
    }),
    clear: vi.fn(() => {
      lines.length = 0;
    }),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  };
}

export function createWebviewMock() {
  return {
    html: "",
    options: {},
    cspSource: "vscode-webview:",
    asWebviewUri: vi.fn((uri: Uri) => uri),
    postMessage: vi.fn(async () => true),
    onDidReceiveMessage: vi.fn(() => new Disposable()),
  };
}

export function createWebviewViewMock() {
  return {
    visible: true,
    webview: createWebviewMock(),
    show: vi.fn(),
    onDidDispose: vi.fn(() => new Disposable()),
    onDidChangeVisibility: vi.fn(() => new Disposable()),
  };
}

export function createWebviewPanelMock() {
  return {
    active: true,
    visible: true,
    webview: createWebviewMock(),
    reveal: vi.fn(),
    dispose: vi.fn(),
    onDidDispose: vi.fn(() => new Disposable()),
    onDidChangeViewState: vi.fn(() => new Disposable()),
  };
}

export function createExtensionContextMock() {
  return {
    subscriptions: [] as DisposableLike[],
    extensionUri: Uri.file("/extension"),
    globalState: {
      get: vi.fn(),
      update: vi.fn(async () => undefined),
    },
  };
}

export const window = {
  createOutputChannel: vi.fn((name: string) => {
    const channel = createOutputChannelMock(name);
    outputChannels.push(channel);
    return channel;
  }),
  registerWebviewViewProvider: vi.fn((viewType: string, provider: unknown, options?: unknown) => {
    registeredWebviewViewProviders.push({ viewType, provider, options });
    return new Disposable();
  }),
  createWebviewPanel: vi.fn(() => createWebviewPanelMock()),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  activeTextEditor: undefined as unknown,
};

export const commands = {
  registerCommand: vi.fn((command: string, callback: (...args: unknown[]) => unknown) => {
    registeredCommands.push({ command, callback });
    return new Disposable();
  }),
  executeCommand: vi.fn(async () => undefined),
};

export const workspace = {
  workspaceFolders: [{ uri: Uri.file("/workspace"), name: "workspace", index: 0 }],
  getConfiguration: vi.fn(() => ({
    get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
    update: vi.fn(async () => undefined),
  })),
  asRelativePath: vi.fn((uri: Uri | string) => (typeof uri === "string" ? uri : uri.toString())),
  onDidChangeConfiguration: vi.fn(() => new Disposable()),
};

export const env = {
  asExternalUri: vi.fn(async (uri: Uri) => uri),
  clipboard: {
    readText: vi.fn(async () => ""),
    writeText: vi.fn(async () => undefined),
  },
};

export const EventEmitter = vi.fn(() => ({
  event: vi.fn(() => new Disposable()),
  fire: vi.fn(),
  dispose: vi.fn(),
}));

export function resetVscodeMocks(): void {
  outputChannels.length = 0;
  registeredCommands.length = 0;
  registeredWebviewViewProviders.length = 0;
  vi.clearAllMocks();
  window.activeTextEditor = undefined;
  workspace.workspaceFolders = [{ uri: Uri.file("/workspace"), name: "workspace", index: 0 }];
}
