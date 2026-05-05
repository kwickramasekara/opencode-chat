import * as vscode from "vscode";

let _channel: vscode.OutputChannel | undefined;

export function getLogger(): vscode.OutputChannel {
  if (!_channel) {
    _channel = vscode.window.createOutputChannel("opencode", { log: true });
  }
  return _channel;
}

export function log(message: string): void {
  const ts = new Date().toISOString().split("T")[1].replace("Z", "");
  getLogger().appendLine(`[${ts}] ${message}`);
}

export function logError(message: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : String(err ?? "");
  const ts = new Date().toISOString().split("T")[1].replace("Z", "");
  getLogger().appendLine(`[${ts}] ERROR: ${message}${detail ? " — " + detail : ""}`);
}
