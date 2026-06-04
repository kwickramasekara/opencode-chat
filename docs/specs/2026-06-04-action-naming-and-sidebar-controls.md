# Spec: Action Naming and Sidebar Chat Controls

## Objective

Before opening the editor-tab PR, make opencode's user-facing actions simpler and more consistent, and add two small controls to the default sidebar chat view:

```text
opencode sidebar view title
  ├─ New Chat in Editor
  └─ Close This Chat
```

The goal is clarity, not new chat-state transfer behavior. In particular, the sidebar action must **not** claim to move the current chat to an editor tab because the extension cannot reliably read or transfer the embedded iframe's current opencode route, selected session, draft input, or transient UI state.

## Current Action Inventory

### Commands

| Command ID | Current title | Current meaning |
| --- | --- | --- |
| `opencode.addToChat` | `opencode: Add to Chat` | Add current file/editor context to a live opencode host. |
| `opencode.addSelectionToChat` | `opencode: Add Selection to Chat` | Add current editor selection to a live opencode host. |
| `opencode.toggleChatView` | `opencode: Toggle Chat View` | Toggle/focus the sidebar chat view. |
| `opencode.toggleChatViewInPanelOrSidebar` | `opencode: Toggle Chat View` | Compatibility command that currently duplicates the same user-facing title. |
| `opencode.openChat` | `opencode: Open Chat` | Open a new opencode editor-tab chat host. |
| `opencode.openChatBeside` | `opencode: Open Chat Beside` | Open a new opencode editor-tab chat host beside the current editor. |
| `opencode.restart` | `opencode: Restart` | Restart shared opencode server/proxy. |
| `opencode.showOutput` | `opencode: Show Output` | Reveal the `opencode` output channel. |

### Other visible labels

| Surface | Current label |
| --- | --- |
| Activity bar container | `opencode` |
| Sidebar webview view | `Chat` |
| Editor tab title | `opencode Chat N` |
| Add-to-chat target picker | `Select opencode chat target` |
| No-host notification | `Start opencode chat first.` |

## Naming Problems

| Problem | Impact |
| --- | --- |
| `opencode.toggleChatView` and `opencode.toggleChatViewInPanelOrSidebar` share the same title | Command Palette can show indistinguishable entries. |
| `Open Chat` does not say editor tab | Users cannot tell whether it opens sidebar chat or editor-tab chat. |
| `Toggle Chat View` is vague | It means sidebar chat, but “view” is broad. |
| `Open Chat Beside` is slightly non-standard | VS Code users are more likely to recognize “to the Side”. |
| `Add to Chat` is vague in file/editor-title menus | It adds file/current-editor context, while selected text has a separate command. |

## Decision

Use surface-explicit command titles and sidebar controls.

### Command title cleanup

Keep command IDs stable for compatibility, but update titles to be clearer:

| Command ID | New title |
| --- | --- |
| `opencode.addToChat` | `opencode: Add File to Chat` |
| `opencode.addSelectionToChat` | `opencode: Add Selection to Chat` |
| `opencode.toggleChatView` | `opencode: Toggle Sidebar Chat` |
| `opencode.toggleChatViewInPanelOrSidebar` | Hide from Command Palette if practical, otherwise `opencode: Toggle Sidebar Chat` |
| `opencode.openChat` | `opencode: New Chat in Editor` |
| `opencode.openChatBeside` | `opencode: New Chat in Editor to the Side` |
| `opencode.restart` | `opencode: Restart Server` |
| `opencode.showOutput` | `opencode: Show Output Channel` |

Notes:

- “Editor” means a normal VS Code editor tab, not a bottom panel.
- “Sidebar Chat” means the contributed `opencode.chatView` webview view.
- The compatibility toggle command may remain registered, but it should not create a second confusing palette entry if it can be hidden.

### Sidebar view-title actions

Add native VS Code `view/title` menu actions scoped to the opencode sidebar view:

```jsonc
{
  "when": "view == opencode.chatView"
}
```

| Toolbar action | Backing command | Behavior |
| --- | --- | --- |
| `New Chat in Editor` | existing `opencode.openChat` | Opens a new opencode editor-tab chat host in the active editor group. |
| `Close This Chat` | new `opencode.closeSidebarChat` | Closes/ends the sidebar chat iframe without promising state transfer. |

For Command Palette clarity, the close command can use the context-free title:

```text
opencode: Close Sidebar Chat
```

The sidebar toolbar tooltip or in-view label may say:

```text
Close This Chat
```

## Sidebar Close Semantics

`Close This Chat` should close the sidebar-hosted chat, not the whole opencode service.

```text
Before close
  sidebar host ── iframe ── shared opencode server/proxy

After close
  sidebar host ── closed/lightweight state, no iframe
  editor hosts ── still connected to shared opencode server/proxy
```

Required behavior:

- Remove or unload the sidebar iframe so the embedded opencode UI is no longer running in that sidebar webview.
- Mark the sidebar chat host as not live for add-to-chat routing.
- Keep editor-tab hosts running.
- Do not stop the shared opencode server/proxy just because the sidebar chat was closed.
- Do not resurrect the sidebar iframe on connection state updates until the user explicitly opens/reopens sidebar chat.
- If the sidebar is opened again, render a fresh sidebar iframe using the current shared connection state.

The exact implementation can be either:

| Approach | Description | Recommendation |
| --- | --- | --- |
| Closed-state render | Keep the `WebviewView` object but render a lightweight closed template with no iframe. | Preferred; fits VS Code webview-view lifecycle. |
| Hide/focus manipulation only | Try to close the VS Code view container. | Avoid; VS Code does not treat contributed views like disposable editor tabs. |

## Non-Goals

- Do not move or duplicate the exact current sidebar chat/session into an editor tab.
- Do not inspect iframe route/state by relying on same-origin hacks.
- Do not stop the shared server/proxy when only the sidebar chat iframe is closed.
- Do not remove editor-tab mode or existing sidebar mode.
- Do not introduce one opencode server per tab/sidebar host.

## Likely Implementation Areas

| Need | Likely file |
| --- | --- |
| Rename command titles and add view-title menu actions | `package.json` |
| Register close command and wire existing open command | `src/main.ts` |
| Add sidebar close/reopen state | `src/webview/OpencodeViewProvider.ts` |
| Ensure add-to-chat ignores closed sidebar host | `src/commands/addToChat.ts` and/or host registry helpers |
| Render no-iframe closed state, if centralized | `src/webview/webviewRenderer.ts` and templates under `src/webview/templates/` |
| Tests | existing Vitest files around activation, panel manager, view provider, add-to-chat routing |

## Success Criteria

- Command Palette and menus use consistent, surface-explicit titles.
- No two visible Command Palette entries have the same opencode title unless one is intentionally hidden/compat-only.
- The opencode sidebar view title exposes `New Chat in Editor` and `Close This Chat` actions.
- `New Chat in Editor` opens a new editor-tab chat host.
- `Close This Chat` unloads the sidebar iframe and removes the sidebar from live add-to-chat targets.
- Closing sidebar chat does not close editor-tab chats or stop the shared server/proxy.
- Reopening sidebar chat creates/renders a fresh sidebar iframe from current connection state.

## Open Questions

- Which icon should be used for `New Chat in Editor`? Candidate: `$(new-file)` or `$(open-preview)`.
- Which icon should be used for `Close This Chat`? Candidate: `$(close)`.
- Should `opencode.toggleChatViewInPanelOrSidebar` be hidden from Command Palette, or simply share the clearer `Toggle Sidebar Chat` title as a compatibility command?
