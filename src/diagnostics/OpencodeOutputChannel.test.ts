import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { OpencodeOutputChannel } from "./OpencodeOutputChannel";
import { outputChannels } from "../test/vscodeMock";

const fixedDate = new Date("2026-06-03T08:09:10.000Z");

function createDiagnostics() {
  return new OpencodeOutputChannel({ now: () => fixedDate });
}

describe("OpencodeOutputChannel", () => {
  it("creates one opencode output channel and delegates show/dispose", () => {
    /*
     * Scenario: output diagnostics has one VS Code channel
     *   Given the diagnostics wrapper is created
     *   When callers show and dispose the wrapper
     *   Then exactly one output channel named "opencode" is created
     *   And lifecycle methods delegate to that channel
     */
    const diagnostics = createDiagnostics();

    diagnostics.show();
    diagnostics.dispose();

    expect(vscode.window.createOutputChannel).toHaveBeenCalledOnce();
    expect(vscode.window.createOutputChannel).toHaveBeenCalledWith("opencode");
    expect(outputChannels).toHaveLength(1);
    expect(outputChannels[0].show).toHaveBeenCalledOnce();
    expect(outputChannels[0].dispose).toHaveBeenCalledOnce();
  });

  it("appends info, warning, and error diagnostics with stable prefixes", () => {
    /*
     * Scenario: human diagnostics are timestamped and leveled
     *   Given the diagnostics wrapper has a deterministic clock
     *   When info, warn, and error messages are appended
     *   Then every line uses [YYYY-MM-DD HH:mm:ss] [level] message format
     */
    const diagnostics = createDiagnostics();

    diagnostics.info("server starting");
    diagnostics.warn("port already in use");
    diagnostics.error("server exited");

    expect(outputChannels[0].lines).toEqual([
      "[2026-06-03 08:09:10] [info] server starting",
      "[2026-06-03 08:09:10] [warn] port already in use",
      "[2026-06-03 08:09:10] [error] server exited",
    ]);
  });

  it("splits process chunks into safe sanitized lines", () => {
    /*
     * Scenario: process output keeps lifecycle clues but removes secrets
     *   Given stdout contains URLs, lifecycle text, and likely secrets
     *   When a process chunk is appended
     *   Then useful lines remain readable
     *   And TOKEN/KEY/SECRET/PASSWORD/AUTH env values plus bearer tokens are redacted
     */
    const diagnostics = createDiagnostics();

    diagnostics.appendProcessOutput(
      "stdout",
      [
        "Listening on http://127.0.0.1:4096",
        "TOKEN=abc123 API_KEY=key-value SECRET='hidden' PASSWORD=pass AUTH=basic",
        "Authorization: Bearer very.secret.token",
        "ready at https://opencode.local:1234/path",
        "",
      ].join("\n"),
    );

    expect(outputChannels[0].lines).toEqual([
      "[2026-06-03 08:09:10] [process:stdout] Listening on http://127.0.0.1:4096",
      "[2026-06-03 08:09:10] [process:stdout] TOKEN=[REDACTED] API_KEY=[REDACTED] SECRET=[REDACTED] PASSWORD=[REDACTED] AUTH=[REDACTED]",
      "[2026-06-03 08:09:10] [process:stdout] Authorization: Bearer [REDACTED]",
      "[2026-06-03 08:09:10] [process:stdout] ready at https://opencode.local:1234/path",
    ]);
  });

  it("buffers incomplete process lines so split secrets are redacted before logging", () => {
    /*
     * Scenario: process output chunks split secret values and key names
     *   Given stdout data events split a secret value across chunks
     *   And stderr data events split a secret key name across chunks
     *   When chunks are appended before and after newline-delimited completion
     *   Then no incomplete line is logged early
     *   And complete reconstructed lines are redacted before logging
     */
    const diagnostics = createDiagnostics();

    diagnostics.appendProcessOutput("stdout", "TOKEN=abc");
    diagnostics.appendProcessOutput("stderr", "API_");

    expect(outputChannels[0].lines).toEqual([]);

    diagnostics.appendProcessOutput("stdout", "123\nready\nPARTIAL_SECRET=value");
    diagnostics.appendProcessOutput("stderr", "KEY=split-value\n");

    expect(outputChannels[0].lines).toEqual([
      "[2026-06-03 08:09:10] [process:stdout] TOKEN=[REDACTED]",
      "[2026-06-03 08:09:10] [process:stdout] ready",
      "[2026-06-03 08:09:10] [process:stderr] API_KEY=[REDACTED]",
    ]);
  });

  it("flushes buffered process output through redaction on dispose", () => {
    /*
     * Scenario: process output ends without a trailing newline
     *   Given a process emits a partial secret-bearing line
     *   When diagnostics are disposed
     *   Then the remaining buffered content is emitted once
     *   And it uses the same process prefix and redaction path
     */
    const diagnostics = createDiagnostics();

    diagnostics.appendProcessOutput("stdout", "PASSWORD=final-secret");
    diagnostics.dispose();

    expect(outputChannels[0].lines).toEqual([
      "[2026-06-03 08:09:10] [process:stdout] PASSWORD=[REDACTED]",
    ]);
    expect(outputChannels[0].dispose).toHaveBeenCalledOnce();
  });

  it("supports an injected output channel factory", () => {
    /*
     * Scenario: diagnostics can be unit-tested without VS Code globals
     *   Given a caller injects an output channel factory
     *   When the wrapper is created and logs a message
     *   Then the injected factory is used exactly once
     */
    const channel = {
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    };
    const createOutputChannel = vi.fn(() => channel);
    const diagnostics = new OpencodeOutputChannel({
      createOutputChannel,
      now: () => fixedDate,
    });

    diagnostics.info("using injected factory");

    expect(createOutputChannel).toHaveBeenCalledOnce();
    expect(createOutputChannel).toHaveBeenCalledWith("opencode");
    expect(vscode.window.createOutputChannel).not.toHaveBeenCalled();
    expect(channel.appendLine).toHaveBeenCalledWith(
      "[2026-06-03 08:09:10] [info] using injected factory",
    );
  });
});
