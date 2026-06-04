# Spec: opencode Output Channel Diagnostics

## Objective

Add a classic VS Code extension Output channel for opencode diagnostics.

Today, when opencode startup, proxying, or webview integration breaks, users and developers have no dedicated output stream to inspect. Debugging depends on observed UI behavior, scattered extension-host logs, network inspection, or guessing from unrelated logs.

The extension should expose a normal Output panel entry named `opencode` so startup and runtime diagnostics are visible from VS Code itself.

```text
VS Code Output panel
  └─ opencode
      ├─ extension/server lifecycle events
      ├─ sanitized `opencode serve` stdout/stderr
      └─ WebviewProxy lifecycle events
```

## Relationship to Editor Tab Mode

This feature is planned as parallel work for the same branch as [`2026-06-02-editor-tab-mode.md`](./2026-06-02-editor-tab-mode.md), but it is not editor-tab-specific.

Diagnostics should work for:

- the existing sidebar/auxiliary-bar chat view
- new editor-tab chat panels
- startup failures before any chat webview renders

The shared connection-manager refactor from editor-tab mode is a natural integration point, but the Output channel should remain useful even if sidebar-only behavior is being tested.

## Current Architecture

```text
src/main.ts
  ├─ registers commands and WebviewViewProvider
  ├─ creates ServerManager
  └─ has no dedicated Output channel

ServerManager
  ├─ starts/reuses `opencode serve --port <port>`
  ├─ starts/reuses WebviewProxy
  ├─ rewrites URL through vscode.env.asExternalUri(...)
  ├─ reads stdout/stderr to discover the server URL
  └─ otherwise discards or hides useful child-process diagnostics

WebviewProxy
  └─ has lifecycle/failure behavior that is not visible in a dedicated VS Code output stream
```

Important current constraints:

| Constraint | Impact |
| --- | --- |
| No `vscode.window.createOutputChannel(...)` usage exists | Users have no obvious debug surface. |
| `ServerManager` already listens to stdout/stderr | There is an existing hook for useful process diagnostics. |
| Extension may run in local or remote workspace extension hosts | Logs must describe extension-side behavior without assuming local-only paths. |
| Chat/user content may flow through webview messages and proxy requests | Output logging needs explicit privacy boundaries. |

## Decision

Create one classic VS Code Output channel named `opencode` and reveal it with a command named `opencode.showOutput`.

Prefer a small wrapper instead of passing raw `vscode.OutputChannel` through every class.

```text
Extension activation / composition root
  ├─ OpencodeOutputChannel
  │    ├─ wraps vscode.OutputChannel
  │    ├─ appends timestamped diagnostics
  │    ├─ sanitizes process output before append
  │    └─ reveals channel on command
  │
  ├─ OpencodeConnectionManager or ServerManager
  │    ├─ logs port decisions and server lifecycle
  │    ├─ logs sanitized opencode stdout/stderr
  │    └─ logs ready/error/restart transitions
  │
  └─ WebviewProxy
       └─ logs start/stop/failure lifecycle events
```

## Non-Goals for Phase 1

- Do not add telemetry.
- Do not implement structured log export.
- Do not log full proxied HTTP request/response bodies.
- Do not log chat prompts, selected text payloads, copied text, or audio payloads.
- Do not dump full environment variables.
- Do not make Output diagnostics depend on editor-tab mode being open.

## Proposed Components

### `OpencodeOutputChannel`

Owns the Output channel lifecycle and presents a narrow diagnostics API.

Responsibilities:

- create one `vscode.window.createOutputChannel("opencode")` instance during activation or connection-manager construction
- register/dispose it through `context.subscriptions`
- expose intent-focused methods such as:
  - `info(message)`
  - `warn(message)`
  - `error(message)`
  - `appendProcessOutput(source, chunk)`
  - `show()`
- include timestamps or clear lifecycle prefixes so copied output is useful in bug reports
- apply privacy/safety filtering before appending child-process output

### Server/connection lifecycle logging

Server startup and restart should append high-level events:

- selected workspace/cwd label, without dumping environment variables
- server/proxy port selection and reuse decisions
- `opencode serve` spawn
- ready URL detection
- restart, stop, and failure events
- missing `opencode` binary or spawn failures
- transition to loading/ready/error connection states

`ServerManager` already captures `stdout` and `stderr` while looking for the server URL. Reuse that hook so useful opencode startup output is not discarded, but pass process output through the no-env/no-chat/no-selection/no-body logging boundary before appending.

### WebviewProxy lifecycle logging

Proxy logging should cover lifecycle only:

- proxy start and selected port
- proxy stop/restart
- proxy startup failures
- high-level request/proxy failures when useful, without request/response bodies

### Command registration

Add one command:

| Command | Behavior |
| --- | --- |
| `opencode.showOutput` | Reveal the `opencode` Output channel from the command palette. |

## Logging Boundaries

| Log | Expected behavior |
| --- | --- |
| Child-process stdout/stderr | Append sanitized lines because this is the most useful first debugging source. |
| Ports, process lifecycle, connection state | Append because these explain extension behavior. |
| Workspace/cwd label | Append only enough context to identify the workspace; avoid unrelated environment dumps. |
| Full environment variables | Never append; may contain secrets. |
| Chat prompts, selections, copied text, audio payloads | Never append; user content/privacy risk. |
| Full proxied HTTP request/response bodies | Never append in Phase 1. |

## Success Criteria

- A classic VS Code Output channel named `opencode` exists.
- Running opencode startup emits visible entries in the channel.
- Sanitized `opencode serve` stdout/stderr appears when it helps diagnose startup.
- Restart emits stop/start/ready or error entries.
- Startup failures and missing `opencode` binary errors are visible in the channel.
- WebviewProxy lifecycle and failure events are visible at a high level.
- `opencode.showOutput` reveals the channel without requiring a chat webview to be open.
- Output logging avoids secrets, full environment variables, chat content, selected text payloads, and proxied request/response bodies.

## Verification Plan

Automated checks:

- `npm run compile`

Manual checks in VS Code Extension Development Host:

1. Start the extension in a workspace where `opencode` can start normally.
2. Open the VS Code Output panel and select `opencode`.
3. Verify startup emits server/proxy lifecycle entries.
4. Verify sanitized `opencode serve` stdout/stderr appears when startup output is produced.
5. Run `opencode.restart` and verify stop/start/ready or error entries appear.
6. Run `opencode.showOutput` and verify it reveals the same channel.
7. Simulate or use an environment where `opencode` cannot start and verify the failure is visible in the channel.
8. Inspect output and verify it does not include full environment variables, chat prompt text, selected text payloads, or proxied request/response bodies.

## Open Questions

- What exact sanitization rules should be applied to child-process lines beyond the no-env/no-chat/no-selection/no-body boundary?
- Should output entries include local timestamps, extension-host-relative timestamps, or both?
