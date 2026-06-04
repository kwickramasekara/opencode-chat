# Automated Test Cases: opencode Output Channel Diagnostics

Source spec: [`../specs/2026-06-02-output-channel-diagnostics.md`](../specs/2026-06-02-output-channel-diagnostics.md)  
Manual coverage: [`../manual-test-cases/2026-06-02-output-channel-diagnostics.md`](../manual-test-cases/2026-06-02-output-channel-diagnostics.md)

## Scope

Automate deterministic diagnostics behavior around the Output channel wrapper,
sanitization, lifecycle logging calls, and command wiring.

Prefer unit tests with mocked VS Code APIs, mocked child processes, and mocked
proxy lifecycle over tests that require a real VS Code Output panel or real
`opencode` binary.

## Target: `OpencodeOutputChannel`

### Scenario: Creates one named output channel

Given extension activation constructs diagnostics  
When the output wrapper is created  
Then `vscode.window.createOutputChannel` is called once with `opencode`

### Scenario: Disposes through extension subscriptions

Given the output wrapper is created during activation  
When activation finishes  
Then the output channel or wrapper disposable is registered in `context.subscriptions`

### Scenario: Appends timestamped info message

Given an output wrapper exists  
When `info("server starting")` is called  
Then the underlying channel receives one appended line  
And the line includes a timestamp or clear lifecycle prefix  
And the line includes `server starting`

### Scenario: Appends warning message

Given an output wrapper exists  
When `warn("proxy fallback")` is called  
Then the underlying channel receives one appended line  
And the line is distinguishable as a warning

### Scenario: Appends error message

Given an output wrapper exists  
When `error("spawn failed")` is called  
Then the underlying channel receives one appended line  
And the line is distinguishable as an error

### Scenario: Show reveals the output channel

Given an output wrapper exists  
When `show()` is called  
Then the underlying channel `show` method is called

## Target: Process-Output Sanitization

### Scenario: Keeps useful server URL line

Given process output contains `Listening on http://localhost:12345`  
When `appendProcessOutput("server", chunk)` runs  
Then the output channel receives a sanitized line containing the local URL

### Scenario: Removes environment variable dumps

Given process output contains lines like `TOKEN=secret` or `PATH=/usr/bin`  
When process output is appended  
Then full environment-variable dump lines are removed or redacted

### Scenario: Redacts likely secrets

Given process output contains likely secret keys, tokens, or authorization values  
When process output is appended  
Then secret values are redacted before reaching the output channel

### Scenario: Does not append chat payloads

Given logging is emitted from add-to-chat or webview message handling  
When diagnostics are appended  
Then selected text, copied text, pasted text, prompt text, and inserted chat payloads are not appended

### Scenario: Handles chunked multiline output

Given a process output chunk contains multiple newline-separated lines  
When it is appended  
Then each line is sanitized consistently  
And empty or whitespace-only spam lines are omitted unless intentionally preserved

## Target: Server and Connection Lifecycle Logging

### Scenario: Logs no-workspace startup failure

Given no workspace folder is open  
When server startup runs  
Then diagnostics include a no-workspace failure entry

### Scenario: Logs port decisions

Given server and proxy ports are selected  
When startup runs  
Then diagnostics include selected or reused port numbers

### Scenario: Logs existing server reuse

Given a previous server responds on the stored port  
When startup runs  
Then diagnostics include that an existing server is being reused  
And no new-process spawn success is logged

### Scenario: Logs opencode spawn

Given no existing server is alive  
When startup spawns `opencode serve --port <port>`  
Then diagnostics include a server spawn lifecycle entry  
And do not dump the full environment

### Scenario: Logs ready URL detection

Given stdout or stderr contains the server URL  
When startup detects it  
Then diagnostics include a ready/detected URL lifecycle entry

### Scenario: Logs missing binary

Given child process emits an `ENOENT` error  
When startup handles the error  
Then diagnostics include a missing `opencode` binary entry

### Scenario: Logs non-zero exit before ready

Given the server process exits with non-zero code before a URL is resolved  
When the exit handler runs  
Then diagnostics include the exit code and failure state

### Scenario: Logs restart lifecycle

Given opencode is running  
When restart is requested  
Then diagnostics include stop/dispose  
And diagnostics include subsequent start and ready/error transition

## Target: Proxy Lifecycle Logging

### Scenario: Logs proxy start

Given a proxy starts for target port `A` and proxy port `B`  
When startup succeeds  
Then diagnostics include a proxy start entry with high-level port information

### Scenario: Logs proxy port fallback

Given the requested proxy port is already in use  
When proxy falls back to a random port  
Then diagnostics include the fallback decision

### Scenario: Logs proxy failure

Given proxy startup fails with an error other than handled port fallback  
When startup rejects  
Then diagnostics include a proxy failure entry

### Scenario: Avoids request and response bodies

Given the proxy handles HTTP or WebSocket traffic  
When diagnostics are emitted  
Then full request bodies, response bodies, chat content, and headers with secrets are not appended

## Target: Command Wiring

### Scenario: Show-output command is contributed and registered

Given extension activation runs  
When commands are registered  
Then `opencode.showOutput` is registered  
And invoking it calls the output wrapper `show()`

### Scenario: Diagnostics do not require webview creation

Given activation runs but no sidebar or editor panel has been resolved  
When server startup emits diagnostics  
Then output entries are still appended

## Should Stay Manual

Do not automate these in the initial test suite:

- Visual confirmation that the VS Code Output panel contains an `opencode` entry.
- Real command-palette behavior for `opencode.showOutput`.
- End-to-end diagnostics from a real `opencode` CLI installation.
- Real startup failure using a modified `PATH` or missing binary.
- Human privacy review of representative output from real sessions.
- Remote VS Code Output panel behavior.
