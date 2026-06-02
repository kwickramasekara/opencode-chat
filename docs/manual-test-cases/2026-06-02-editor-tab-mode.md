# Manual Test Plan: Editor Tab Mode

Use this after implementation in a VS Code Extension Development Host.

## Preflight

- Open a workspace where `opencode` can start normally.
- Run the extension from this worktree.
- Keep Developer Tools open enough to notice obvious webview/extension errors.

## Cases

### 1. Editor tabs open and behave like normal tabs

Given the extension host is running,
when you run `opencode.openChat` twice and `opencode.openChatBeside` once,
then multiple opencode editor tabs exist and one can be placed beside another editor group.

Check:

- Tabs can be moved/split with VS Code editor UI.
- Closing one tab does not close the others or stop the shared server.
- Editor-tab layout uses full editor width, not the narrow sidebar max width.

### 2. Sidebar behavior still works

Given no editor-tab assumptions,
when you run `opencode.toggleChatViewInPanelOrSidebar`,
then the existing sidebar/auxiliary chat view opens/toggles as before.

### 3. Add-to-chat with one host routes directly

Given exactly one running opencode host,
when you run `opencode.addToChat` or `opencode.addSelectionToChat`,
then no picker appears and the text is inserted into that host.

### 4. Add-to-chat with multiple hosts prompts predictably

Given two or more running opencode hosts,
when you run `opencode.addToChat` or `opencode.addSelectionToChat`,
then a quick-pick appears.

Check:

- The top/default selected option is `last used (%id-or-name%)`.
- Choosing the default routes to the active opencode host, or otherwise the most recently used host.
- Concrete host entries below it are sorted by last-used recency.
- Selecting a non-default host inserts text into that chosen host.

### 5. Add-to-chat with no host shows notification

Given no opencode sidebar view or editor panel is running,
when you run `opencode.addToChat` or `opencode.addSelectionToChat`,
then the notification appears and nothing else happens.

### 6. Restart refreshes all hosts

Given multiple opencode hosts are open,
when you run `opencode.restart`,
then all hosts show loading/error/ready consistently and recover to the shared server when ready.

## Result Notes

Record:

- VS Code version and local/remote environment.
- Which commands passed or failed.
- Any webview console or extension-host errors.
- Whether reload/window persistence behavior is acceptable for Phase 1.
