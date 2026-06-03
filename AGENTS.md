# Agent Notes

## Fork Branch Map

This fork keeps upstream sync, local integration, and PR work separated.

```text
kwickramasekara/opencode-chat:main
        │
        ▼
origin/upstream                 mirror of upstream/main
        │
        ▼
origin/main                     fork integration branch with accepted/local features
        ├── origin/fix/remote-vscode-mode   PR branch for one upstream PR
        └── origin/<type>/<short-topic>      future per-PR branches
```

| Branch | Purpose |
| --- | --- |
| `upstream` | Exact mirror of upstream `main`; do not add fork changes here. |
| `main` | Integration branch for this fork; may contain multiple local/PR-ready features. |
| `<type>/<short-topic>` | One upstream PR branch per focused change. |

When creating upstream PRs, branch from the fork's current intended base, push the per-PR branch, and open the PR from that branch — not from `main`.

## Implementation Notes

### Test Commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run Vitest unit tests once. |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run compile` | Type-check extension source and copy webview templates. |
| `npm run check` | Run compile and tests together. |

Vitest tests use `vitest.config.ts` to alias the VS Code API to `src/test/vscodeMock.ts`. Keep production `import * as vscode from "vscode"` imports; extend the mock when new VS Code APIs are needed in tests.

### opencode Chat Architecture

```text
activate()
  ├─ OpencodeOutputChannel        classic VS Code Output channel: "opencode"
  ├─ ServerManager                shared opencode server/proxy + connection state fan-out
  ├─ OpencodeViewProvider         existing sidebar webview host
  └─ OpencodePanelManager         editor-tab webview hosts
```

- `ServerManager.subscribe(host)` fans out `loading`, `ready`, and `error` states to sidebar and editor hosts.
- `OpencodeViewProvider` and `OpencodePanelManager` both use shared webview renderer/bridge helpers under `src/webview/`.
- Add-to-chat routing lives in `src/commands/addToChat.ts`; it targets live hosts only and must not log file references or selected text.
- Output diagnostics should stay lifecycle-focused: server/proxy events and sanitized process output only. Do not log chat prompts, selections, clipboard text, audio payloads, request/response bodies, or full environment dumps.
- Editor panel serialization is intentionally not implemented in the first editor-tab MVP.
