# Automated Test Cases: Editor Tab Mode

Source spec: [`../specs/2026-06-02-editor-tab-mode.md`](../specs/2026-06-02-editor-tab-mode.md)  
Manual coverage: [`../manual-test-cases/2026-06-02-editor-tab-mode.md`](../manual-test-cases/2026-06-02-editor-tab-mode.md)

## Scope

Automate deterministic extension logic that can be tested without a real VS Code
window, real webview rendering, or a real `opencode` server.

```text
manual VS Code proof remains required
        ▲
        │
unit tests protect extracted routing/rendering/state logic
```

## Target: Connection State Coordination

### Scenario: Publishes loading state before startup work

Given the shared connection manager starts  
When startup begins  
Then subscribed hosts receive `loading` before `ready` or `error`

### Scenario: Publishes ready state with external URI

Given server startup discovers `http://localhost:<port>`  
And `vscode.env.asExternalUri` returns a rewritten URI  
When startup completes  
Then subscribers receive `ready` with the rewritten server URL

### Scenario: Publishes no-workspace error

Given no workspace folder is open  
When startup runs  
Then subscribers receive `error`  
And `showInstallHint` is false

### Scenario: Publishes missing-binary error

Given spawning `opencode` fails with `ENOENT`  
When startup runs  
Then subscribers receive `error` identifying the missing CLI  
And `showInstallHint` is true

### Scenario: Restart fans out state updates

Given multiple hosts are subscribed  
When restart is requested  
Then every host receives `loading`  
And later every host receives the same `ready` or `error` state

## Target: Shared Webview Rendering

### Scenario: Renders loading template

Given connection state is `loading`  
When a webview host is rendered  
Then loading HTML is assigned to the webview

### Scenario: Renders error template with install hint

Given connection state is `error` with `showInstallHint: true`  
When a webview host is rendered  
Then the error HTML includes the message and install hint

### Scenario: Renders error template without install hint

Given connection state is `error` with `showInstallHint: false`  
When a webview host is rendered  
Then the error HTML includes the message  
And omits the install hint

### Scenario: Renders iframe in sidebar layout

Given connection state is `ready`  
And layout mode is `sidebar`  
When a webview host is rendered  
Then iframe HTML includes the server URL and origin  
And preserves sidebar-friendly max-width behavior

### Scenario: Renders iframe in editor layout

Given connection state is `ready`  
And layout mode is `editor`  
When a webview host is rendered  
Then iframe HTML includes the server URL and origin  
And does not apply the sidebar `max-width: 640px` cap

### Scenario: Configures webview options once

Given a webview host is initialized  
When shared webview setup runs  
Then scripts are enabled  
And message handlers are registered once for that host

## Target: Panel Manager

### Scenario: Opens a new editor tab

Given the extension is active  
When `opencode.openChat` runs  
Then `vscode.window.createWebviewPanel` is called with the opencode panel view type  
And the panel is tracked as a live host  
And current connection state is rendered into the panel

### Scenario: Opens editor tab beside the current editor

Given the extension is active  
When `opencode.openChatBeside` runs  
Then `createWebviewPanel` is called with a beside editor column  
And the panel is tracked as a live host

### Scenario: Repeated open commands create independent panels

Given no editor panels exist  
When `opencode.openChat` runs twice  
Then two distinct panel records exist  
And each panel has a unique host id

### Scenario: Disposing a panel removes it as a host

Given a panel is tracked  
When its dispose callback fires  
Then the panel is removed from live hosts  
And future connection changes are not rendered to it

### Scenario: Closing one panel does not stop shared connection

Given two panels are tracked  
When one panel is disposed  
Then the shared connection is not disposed  
And the remaining panel stays tracked

### Scenario: Active panel updates last-used host

Given two panels are tracked  
When panel B becomes active  
Then panel B becomes the active/recent target for add-to-chat routing

## Target: Add-to-Chat Target Selection

### Scenario: No host shows notification and noops

Given no sidebar view or editor panel is live  
When `opencode.addToChat` runs  
Then an information notification is shown  
And no webview receives an `insert-text` message

### Scenario: One host routes directly

Given exactly one live host exists  
When `opencode.addToChat` runs  
Then no quick-pick is shown  
And that host receives the `insert-text` message

### Scenario: Multiple hosts show picker

Given two or more live hosts exist  
When `opencode.addToChat` runs  
Then a quick-pick is shown  
And the first item is the last-used default option  
And concrete host entries are sorted by last-used descending

### Scenario: Default picker item routes to active host

Given multiple live hosts exist  
And one opencode host is active  
When the user accepts the default quick-pick item  
Then the active host receives the `insert-text` message

### Scenario: Default picker item falls back to most recent host

Given multiple live hosts exist  
And no opencode host is active  
When the user accepts the default quick-pick item  
Then the most recently used host receives the `insert-text` message

### Scenario: Explicit picker item routes to selected host

Given multiple live hosts exist  
When the user selects a concrete non-default host item  
Then only that selected host receives the `insert-text` message

### Scenario: Selection reference formatting remains stable

Given an active text editor has a cursor or selection  
When `opencode.addSelectionToChat` computes the reference  
Then it produces the expected file/line/range reference format

## Target: Command Wiring

### Scenario: Editor-tab commands are contributed and registered

Given extension activation runs  
When commands are registered  
Then `opencode.openChat` is registered  
And `opencode.openChatBeside` is registered  
And existing sidebar, restart, add-file, and add-selection commands remain registered

### Scenario: Sidebar toggle keeps legacy behavior

Given sidebar mode is still supported  
When the sidebar toggle command runs  
Then it focuses or toggles the existing `opencode.chatView` path without requiring editor panels

## Should Stay Manual

Do not automate these in the initial test suite:

- Real VS Code tab dragging, splitting, and editor-group placement.
- Visual confirmation that editor layout feels correct at multiple sizes.
- Embedded opencode app behavior across different chats and tabs.
- Live updates between tabs through a real opencode server.
- Reload/window persistence with real `WebviewPanelSerializer`.
- Remote VS Code behavior through real tunnels or remote extension hosts.
- Actual clipboard/audio behavior inside the real iframe.
