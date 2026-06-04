# Automated Test Cases: Action Naming and Sidebar Chat Controls

Source spec: [`../specs/2026-06-04-action-naming-and-sidebar-controls.md`](../specs/2026-06-04-action-naming-and-sidebar-controls.md)  
Manual coverage: [`../manual-test-cases/2026-06-04-action-naming-and-sidebar-controls.md`](../manual-test-cases/2026-06-04-action-naming-and-sidebar-controls.md)

## Scope

Automate deterministic extension behavior that can be proven without a real VS Code window or real opencode server.

```text
package/action contribution checks
        │
        ├─ command registration and naming tests
        ├─ sidebar close-state tests
        └─ add-to-chat host routing tests

manual VS Code proof remains required for real toolbar rendering
```

## Target: Command Contributions and Naming

### Scenario: Commands use surface-explicit titles

Given the extension command contributions are loaded  
When opencode command titles are inspected  
Then editor-tab commands mention `Editor`  
And sidebar commands mention `Sidebar Chat`  
And server/output commands mention their concrete target

Expected titles:

| Command ID | Expected title |
| --- | --- |
| `opencode.addToChat` | `opencode: Add File to Chat` |
| `opencode.addSelectionToChat` | `opencode: Add Selection to Chat` |
| `opencode.toggleChatView` | `opencode: Toggle Sidebar Chat` |
| `opencode.openChat` | `opencode: New Chat in Editor` |
| `opencode.openChatBeside` | `opencode: New Chat in Editor to the Side` |
| `opencode.restart` | `opencode: Restart Server` |
| `opencode.showOutput` | `opencode: Show Output Channel` |

### Scenario: Visible command palette titles are not duplicated

Given opencode command contributions are loaded  
When visible Command Palette entries are derived  
Then no visible opencode command title appears more than once  
And no duplicate sidebar toggle alias is contributed

### Scenario: Sidebar view-title actions are contributed

Given package contributions are loaded  
When `contributes.menus["view/title"]` is inspected  
Then one entry invokes `opencode.openChat`  
And one entry invokes `opencode.closeSidebarChat`  
And both entries are scoped with `view == opencode.chatView`

## Target: Command Registration

### Scenario: Close sidebar chat command is registered

Given extension activation runs  
When commands are registered  
Then `opencode.closeSidebarChat` is registered  
And existing open, toggle, restart, add-file, and add-selection commands remain registered

### Scenario: New Chat in Editor keeps existing editor-tab behavior

Given the extension is active  
When `opencode.openChat` runs from the sidebar toolbar  
Then a new opencode editor-tab panel is created  
And the sidebar chat host remains unchanged

## Target: Sidebar Close State

### Scenario: Closing sidebar chat unloads iframe

Given the sidebar chat view is resolved  
And connection state is `ready`  
And the sidebar is rendering an iframe  
When `opencode.closeSidebarChat` runs  
Then the sidebar webview HTML no longer contains the opencode iframe  
And the sidebar is rendered in a closed/lightweight state

### Scenario: Closing sidebar chat removes it from live host routing

Given the sidebar chat view is the only live opencode host  
When `opencode.closeSidebarChat` runs  
And `opencode.addToChat` runs  
Then add-to-chat behaves as if no live host exists  
And no `insert-text` message is posted to the sidebar webview

### Scenario: Closing sidebar chat does not stop shared connection

Given the sidebar chat view is live  
And the shared server/proxy connection is `ready`  
When `opencode.closeSidebarChat` runs  
Then the shared connection manager is not stopped or restarted  
And existing editor-tab hosts remain subscribed

### Scenario: Connection state update does not resurrect closed sidebar iframe

Given the sidebar chat view was closed with `opencode.closeSidebarChat`  
When the shared connection manager publishes `loading` and then `ready`  
Then the sidebar remains in the closed/lightweight state  
And no iframe is rendered until sidebar chat is explicitly reopened

### Scenario: Reopening sidebar chat renders fresh iframe

Given the sidebar chat view was closed  
And the shared connection state is `ready`  
When the sidebar chat is explicitly opened or toggled back on  
Then the sidebar webview renders a fresh iframe using the current server URL  
And the sidebar becomes a live add-to-chat target again

## Target: Add-to-Chat Routing After Sidebar Close

### Scenario: Closed sidebar plus one editor host routes to editor host

Given the sidebar chat view is closed  
And exactly one editor-tab chat host is live  
When `opencode.addToChat` runs  
Then no quick-pick is shown  
And the editor-tab host receives the `insert-text` message

### Scenario: Closed sidebar is omitted from multiple-host picker

Given the sidebar chat view is closed  
And two editor-tab chat hosts are live  
When `opencode.addToChat` runs  
Then the quick-pick contains editor-tab hosts only  
And the closed sidebar is not listed as a selectable target

## Should Stay Manual

Do not automate these in the initial test suite:

- Visual confirmation of actual sidebar toolbar icon placement.
- Real VS Code behavior when the Activity Bar/sidebar container is hidden or revealed.
- Real iframe process/resource teardown in Chromium DevTools.
- End-to-end behavior through a real opencode server after closing and reopening sidebar chat.
- Human-readable Command Palette screenshots or visual polish checks.
