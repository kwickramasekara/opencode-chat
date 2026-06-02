# Spec: Editor Tab Mode for opencode Chat

## Objective

Add a normal VS Code editor-tab mode for the opencode chat extension while preserving the existing sidebar/auxiliary-bar experience.

Users should be able to open multiple opencode chat tabs, move them between editor groups, open one beside another, and use them similarly to browser tabs or VS Code terminal tabs.

```text
VS Code editor area
  ├─ opencode tab A ─┐
  ├─ opencode tab B ─┼─ same extension-managed opencode server/proxy
  └─ opencode tab C ─┘
```

## Current Architecture

The extension currently contributes a single webview view in the activity/sidebar area.

```text
package.json
  └─ contributes.views[opencode-sidebar].opencode.chatView

src/main.ts
  ├─ registers WebviewViewProvider
  ├─ starts ServerManager singleton
  └─ routes add-to-chat commands to one provider

ServerManager
  ├─ starts/reuses `opencode serve --port <port>`
  ├─ starts/reuses WebviewProxy
  ├─ rewrites URL through vscode.env.asExternalUri(...)
  └─ calls provider.setServerUrl(...)

OpencodeViewProvider
  ├─ owns one WebviewView
  ├─ renders loading/error/iframe templates
  └─ bridges clipboard/audio/add-to-chat messages
```

Important current constraints:

| Constraint | Impact |
| --- | --- |
| Uses `WebviewViewProvider` | Host is tied to sidebar/panel placement, not editor tabs. |
| Provider stores one `_view` | Only one visible chat host is modeled. |
| `ServerManager` calls provider methods directly | Server lifecycle is coupled to one UI host. |
| Server/proxy ports are in `globalState` | Stable origin preserves opencode web UI localStorage across windows/reloads. |
| `iframe.html` has `max-width: 640px` | Sidebar-friendly layout is not ideal for full editor tabs. |

## Upstream opencode Model Assumptions

Based on source research, opencode has this client/server shape:

```text
opencode web/app UI
  ├─ stores UI/client preferences in client storage
  └─ talks to opencode server APIs

opencode server
  ├─ exposes project/session/message APIs
  ├─ persists history in user data storage/database
  └─ publishes live events to connected clients
```

Implications for editor tabs:

- Multiple webviews connected to the same server should share server-backed project/session/message history.
- Two tabs opened to the same chat should live-update similarly to two browser tabs.
- Different tabs can show different chats/routes while sharing the same backing server.
- UI settings and loaded/opened project state may depend on webview/client storage origin; preserving a stable proxy origin remains important.

## Decision

Implement editor-tab mode using `vscode.window.createWebviewPanel(...)`, with one `WebviewPanel` per opened opencode tab.

Keep one shared opencode server/proxy per extension workspace/window scope for the first implementation.

```text
Extension activation
  ├─ OpencodeConnectionManager
  │    ├─ owns opencode server process
  │    ├─ owns webview proxy
  │    ├─ tracks loading/error/ready connection state
  │    └─ notifies all registered UI hosts
  │
  ├─ OpencodeViewProvider
  │    └─ optional legacy sidebar host
  │
  └─ OpencodePanelManager
       ├─ creates WebviewPanel instances
       ├─ tracks active/recent panel
       ├─ renders each panel from connection state
       └─ routes add-to-chat messages
```

## Non-Goals for Phase 1

- Do not bundle opencode web/server assets into the extension.
- Do not start one opencode server per editor tab.
- Do not remove the existing sidebar/auxiliary-bar mode.
- Do not depend on the opencode web UI's server-switcher menu working inside VS Code webviews.
- Do not try to infer/update panel titles from opencode chat titles unless the UI exposes a simple reliable signal.

## Proposed Components

### `OpencodeConnectionManager`

Owns the shared server/proxy lifecycle and exposes connection state.

```ts
type ConnectionState =
  | { type: "loading" }
  | { type: "ready"; serverUrl: string }
  | { type: "error"; message: string; showInstallHint: boolean };
```

Responsibilities:

- choose and persist server/proxy ports
- spawn/reuse `opencode serve`
- start/reuse `WebviewProxy`
- apply `vscode.env.asExternalUri(...)`
- expose current `ConnectionState`
- notify subscribed webview hosts when state changes
- restart shared server/proxy and refresh all hosts

### Shared webview renderer/host helpers

Extract rendering and message-bridge logic from `OpencodeViewProvider` so both sidebar views and editor panels can use it.

Responsibilities:

- configure `webview.options`
- render loading/error/iframe templates
- handle `paste-request`, `copy-request`, and `play-audio`
- send `insert-text` into the iframe

### `OpencodePanelManager`

Owns editor-tab instances.

Responsibilities:

- create new `WebviewPanel` instances
- open panels in active column or beside current editor
- track active/recent opencode panel
- dispose panel registrations when tabs close
- re-render panels when connection state changes
- optionally serialize/revive panels after VS Code reload

## Commands

Add editor-mode commands while keeping existing commands.

| Command | Behavior |
| --- | --- |
| `opencode.openChat` | Open a new opencode editor tab in the active editor group. |
| `opencode.openChatBeside` | Open a new opencode editor tab beside the current editor. |
| `opencode.toggleChatView` | Keep existing sidebar/auxiliary toggle behavior. |
| `opencode.restart` | Restart the shared server/proxy and refresh every sidebar/panel host. |
| `opencode.addToChat` | Send file reference to active/recent opencode host; open a panel if none exists. |
| `opencode.addSelectionToChat` | Same target behavior as `opencode.addToChat`, with selection reference text. |

Targeting priority for add-to-chat:

```text
active opencode editor panel
  else visible sidebar view
  else most recently active opencode editor panel
  else create new editor panel and send after ready
```

## State and Persistence

### Shared extension state

Keep these intentionally shared:

- selected/persisted server port
- selected/persisted proxy port
- sidebar type preference
- current shared connection state

### Per-panel state

Each editor tab should have a unique panel id for extension-host bookkeeping.

Use `acquireVsCodeApi().getState()/setState()` only for lightweight wrapper state if needed. The embedded opencode app should continue to own its own route/UI storage.

### Serialization

Register `vscode.window.registerWebviewPanelSerializer(...)` for the panel view type after the MVP works.

Serializer should restore:

- panel HTML
- message handlers
- panel manager bookkeeping
- last known wrapper state

## Webview Layout

The existing iframe template caps the body to `max-width: 640px`, which is useful for sidebars but poor for editor tabs.

Introduce a layout mode:

```ts
type WebviewLayoutMode = "sidebar" | "editor";
```

Expected behavior:

| Mode | Layout |
| --- | --- |
| `sidebar` | Preserve current narrow/sidebar-friendly behavior. |
| `editor` | Use full width/height with no `max-width: 640px` cap. |

## Alternatives Considered

### One server per editor tab

Rejected for Phase 1.

Pros:

- stronger per-tab isolation

Cons:

- heavier process/port management
- localStorage origins fragment by tab
- multiple server processes may share persisted DB but not live event buses
- closing tabs creates ambiguous server lifecycle behavior

### CustomEditorProvider

Rejected for Phase 1.

Pros:

- good for URI/document-backed editor experiences
- supports multiple editors per document

Cons:

- opencode chat is not naturally a file/document editor
- dirty/save/revert semantics are not useful here
- adds unnecessary document-model complexity

### Bundled desktop-like web UI plus headless server

Deferred.

Pros:

- potentially more reliable than serving the full web UI through `opencode serve`
- closer to opencode desktop's split between bundled renderer and sidecar server

Cons:

- much larger architecture change
- bundling/versioning opencode assets is non-trivial
- remote VS Code extension hosts still need a server near the workspace
- CORS/SSE/auth/proxy behavior needs a separate prototype

## Success Criteria

- Running the new open command creates a normal editor tab.
- Running it repeatedly creates multiple independent editor tabs.
- Opening beside places a new opencode tab in another editor group.
- Existing sidebar mode still works.
- All opencode hosts share one server/proxy by default.
- Closing one editor tab does not stop the shared server.
- Restart shows loading/error/ready state across all open hosts.
- Add-to-chat targets the active/recent opencode host predictably.
- Editor layout uses available editor width instead of the sidebar width cap.

## Verification Plan

Automated checks:

- `npm run compile`

Manual checks in VS Code Extension Development Host:

1. Open opencode in editor tab.
2. Open a second opencode tab.
3. Open an opencode tab beside the current editor.
4. Move/split editor groups using VS Code UI.
5. Open different chats in different tabs and verify they remain visually independent.
6. Open the same chat in two tabs and verify live message updates appear in both.
7. Use add-file/add-selection commands and verify text is inserted into the expected host.
8. Restart opencode and verify every open host recovers or shows the same error.
9. Reload the VS Code window and verify persisted settings/history behavior is acceptable.

## Open Questions

- Do multiple VS Code `WebviewPanel` instances share iframe localStorage when they iframe the same stable proxy origin?
- Should editor tabs become the default command, or should sidebar toggle remain primary?
- Should tab revival via `WebviewPanelSerializer` ship in the first implementation or as a follow-up?
- Should add-to-chat prefer the active opencode panel over sidebar even when the sidebar is visible?
- Is global port persistence still correct across remote windows/profiles, or should it become workspace-scoped?
