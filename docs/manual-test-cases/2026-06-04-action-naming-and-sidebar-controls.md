# Manual Test Plan: Action Naming and Sidebar Chat Controls

Use this after implementation in a VS Code Extension Development Host.

Source spec: [`../specs/2026-06-04-action-naming-and-sidebar-controls.md`](../specs/2026-06-04-action-naming-and-sidebar-controls.md)  
Automated coverage: [`../automated-test-cases/2026-06-04-action-naming-and-sidebar-controls.md`](../automated-test-cases/2026-06-04-action-naming-and-sidebar-controls.md)

## Preflight

- Open a workspace where `opencode` can start normally.
- Run the extension from this worktree.
- Open the opencode sidebar view.
- Keep Developer Tools available enough to notice obvious webview or extension-host errors.

## Cases

### 1. Command Palette names are clear and not duplicated

Given the Extension Development Host is running,  
when you open the Command Palette and search for `opencode`,  
then visible actions use clear surface-specific names.

Check expected entries:

| Expected command title | Notes |
| --- | --- |
| `opencode: Toggle Sidebar Chat` | Should be the sidebar-focused toggle. |
| `opencode: New Chat in Editor` | Opens an editor-tab chat. |
| `opencode: New Chat in Editor to the Side` | Opens an editor-tab chat beside the current editor. |
| `opencode: Add File to Chat` | File/current-editor context. |
| `opencode: Add Selection to Chat` | Selection-specific context. |
| `opencode: Restart Server` | Shared server/proxy restart. |
| `opencode: Show Output Channel` | Reveals diagnostics output. |

Also check:

- No two visible opencode entries have the same title.
- Any compatibility toggle command does not create a confusing duplicate palette entry.

### 2. Sidebar toolbar shows the new actions

Given the opencode sidebar view is visible,  
when you inspect the view title toolbar,  
then it includes actions for:

- `New Chat in Editor`
- `Close This Chat`

Check:

- Toolbar actions are scoped to the opencode sidebar view, not unrelated views.
- Tooltips are understandable in context.
- Icons are visually distinct enough to avoid accidental close/open confusion.

### 3. New Chat in Editor opens an editor-tab chat

Given the opencode sidebar view is visible,  
when you click `New Chat in Editor`,  
then a new opencode editor tab opens.

Check:

- The sidebar chat remains visible and usable.
- The new editor tab connects to the shared opencode server/proxy.
- Running the action again opens another editor-tab chat host.
- Existing add-to-chat routing still handles multiple hosts predictably.

### 4. Close This Chat unloads the sidebar iframe

Given the opencode sidebar view is rendering the chat iframe,  
when you click `Close This Chat`,  
then the sidebar chat iframe is closed/unloaded.

Check:

- The sidebar no longer displays the live opencode iframe.
- The sidebar shows either an empty/closed state or a lightweight reopen affordance, depending on implementation.
- No editor-tab chat is closed.
- The shared server/proxy is not restarted or stopped solely because the sidebar chat was closed.
- No obvious webview or extension-host errors appear.

### 5. Closed sidebar is not an add-to-chat target

Given the sidebar chat was closed with `Close This Chat`,  
when you run `opencode.addToChat` or `opencode.addSelectionToChat`,  
then the closed sidebar is not selected as a target.

Check both variants:

| Setup | Expected result |
| --- | --- |
| No editor-tab chat hosts are open | Notification appears and no insertion happens. |
| One editor-tab chat host is open | Text routes directly to that editor tab. |
| Multiple editor-tab chat hosts are open | Picker lists editor hosts only; closed sidebar is absent. |

### 6. Restart does not accidentally resurrect a closed sidebar chat

Given the sidebar chat was closed,  
when you run `opencode: Restart Server`,  
then restart state changes do not automatically recreate the sidebar iframe.

Check:

- Editor-tab hosts refresh/recover normally.
- The sidebar remains closed/lightweight until explicitly reopened.

### 7. Sidebar chat can be reopened after close

Given the sidebar chat was closed,  
when you explicitly open/toggle sidebar chat again,  
then a fresh sidebar iframe is rendered using the current shared connection.

Check:

- The sidebar becomes usable again.
- The sidebar becomes eligible for add-to-chat routing again.
- Reopen does not create duplicate sidebar host records or duplicate message handlers.

## Result Notes

Record:

- VS Code version and local/remote environment.
- Whether the compatibility toggle command was hidden or simply renamed.
- Which toolbar icons were used.
- Whether closing the sidebar iframe visibly released the embedded chat UI.
- Any webview console or extension-host errors.
