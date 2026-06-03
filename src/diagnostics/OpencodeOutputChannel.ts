import * as vscode from "vscode";

type OutputLevel = "info" | "warn" | "error";

type OutputChannelLike = Pick<vscode.OutputChannel, "appendLine" | "show" | "dispose">;

export interface OpencodeOutputChannelOptions {
  createOutputChannel?: (name: string) => OutputChannelLike;
  now?: () => Date;
}

export class OpencodeOutputChannel implements vscode.Disposable {
  private readonly channel: OutputChannelLike;
  private readonly now: () => Date;
  private readonly processLineBuffers = new Map<string, string>();
  private disposed = false;

  constructor(options: OpencodeOutputChannelOptions = {}) {
    const createOutputChannel =
      options.createOutputChannel ?? vscode.window.createOutputChannel;

    this.channel = createOutputChannel("opencode");
    this.now = options.now ?? (() => new Date());
  }

  info(message: string): void {
    this.appendDiagnostic("info", message);
  }

  warn(message: string): void {
    this.appendDiagnostic("warn", message);
  }

  error(message: string): void {
    this.appendDiagnostic("error", message);
  }

  appendProcessOutput(source: string, chunk: string | Buffer): void {
    if (this.disposed) return;

    const bufferedChunk = `${this.processLineBuffers.get(source) ?? ""}${normalizeLineEndings(
      chunk.toString(),
    )}`;
    const lines = bufferedChunk.split("\n");
    const hasTrailingLineBreak = bufferedChunk.endsWith("\n");
    const completeLines = hasTrailingLineBreak ? lines : lines.slice(0, -1);

    this.processLineBuffers.set(source, hasTrailingLineBreak ? "" : lines[lines.length - 1]);

    for (const line of completeLines) {
      this.appendProcessLine(source, line);
    }
  }

  show(): void {
    if (this.disposed) return;

    this.channel.show();
  }

  dispose(): void {
    if (this.disposed) return;

    this.flushProcessLineBuffers();
    this.disposed = true;
    this.channel.dispose();
  }

  private appendDiagnostic(level: OutputLevel, message: string): void {
    this.appendLine(`[${this.formatTimestamp()}] [${level}] ${message}`);
  }

  private appendLine(line: string): void {
    if (this.disposed) return;

    this.channel.appendLine(line);
  }

  private appendProcessLine(source: string, line: string): void {
    const trimmedLine = line.trimEnd();
    if (trimmedLine.length === 0) return;
    if (isStandaloneEnvAssignment(trimmedLine)) return;

    const safeSource = source.replace(/[^a-zA-Z0-9_.:-]/g, "-");
    this.appendLine(
      `[${this.formatTimestamp()}] [process:${safeSource}] ${redactSecrets(trimmedLine)}`,
    );
  }

  private flushProcessLineBuffers(): void {
    for (const [source, line] of this.processLineBuffers) {
      this.appendProcessLine(source, line);
    }

    this.processLineBuffers.clear();
  }

  private formatTimestamp(): string {
    const date = this.now();
    const year = date.getUTCFullYear();
    const month = pad(date.getUTCMonth() + 1);
    const day = pad(date.getUTCDate());
    const hours = pad(date.getUTCHours());
    const minutes = pad(date.getUTCMinutes());
    const seconds = pad(date.getUTCSeconds());

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
}

function normalizeLineEndings(chunk: string): string {
  return chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function redactSecrets(line: string): string {
  return line
    .replace(
      /(^|\s)([A-Z_][A-Z0-9_]{1,})\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/g,
      "$1$2=[REDACTED]",
    )
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|AUTH)[A-Z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(/\bBearer\s+([A-Za-z0-9._~+/=-]+)/gi, "Bearer [REDACTED]");
}

function isStandaloneEnvAssignment(line: string): boolean {
  return /^\s*[a-z_][a-z0-9_]*\s*=.+$/i.test(line);
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
