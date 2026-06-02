# Manual Test Plan: opencode Output Channel Diagnostics

Use this after implementation in a VS Code Extension Development Host.

## Preflight

- Open a workspace where `opencode` can start normally.
- Run the extension from this worktree.
- Keep the VS Code Output panel available.
- If possible, have a second test environment or temporary configuration where `opencode` cannot start, so failure output can be checked.

## Cases

### 1. Output channel exists on normal startup

Given the extension host is running,
when opencode starts normally,
then the VS Code Output panel has an `opencode` channel with startup diagnostics.

Check:

- Server/proxy lifecycle entries appear.
- Sanitized `opencode serve` stdout/stderr that helps diagnose startup appears when produced.
- The output identifies ready/error transitions clearly enough for bug reports.

### 2. Show-output command reveals diagnostics

Given the extension host is running,
when you run `opencode.showOutput`,
then VS Code reveals the `opencode` Output channel.

### 3. Restart appends lifecycle diagnostics

Given opencode is running,
when you run `opencode.restart`,
then the Output channel receives stop/start/ready or error entries.

### 4. Startup failure is visible

Given `opencode` cannot start or the binary is unavailable,
when the extension attempts startup,
then the Output channel shows the failure clearly enough to diagnose the missing binary or startup problem.

### 5. Output respects privacy boundaries

Given diagnostics have been produced,
when you inspect the `opencode` Output channel,
then it does not contain sensitive or user-content payloads.

Check that output does not include:

- full environment variables
- chat prompt text
- selected text payloads
- copied text payloads
- audio payloads
- full proxied request/response bodies

## Result Notes

Record:

- VS Code version and local/remote environment.
- Which commands passed or failed.
- Whether diagnostics were useful for startup, restart, and failure cases.
- Any extension-host errors that did not appear in the `opencode` Output channel.
