# Spec: Automated Test Bootstrap

## Objective

Add a minimal automated test foundation so editor-tab mode and Output channel
diagnostics can be checked without relying only on manual Extension Development
Host testing.

The first layer should be fast, local, and focused on pure TypeScript or lightly
mocked VS Code-extension logic.

## Current State

```text
package.json
  ├─ scripts.compile = tsc -p ./ && npm run copy-templates
  └─ no test script

src/
  ├─ main.ts
  ├─ server/ServerManager.ts
  ├─ proxy/WebviewProxy.ts
  └─ webview/OpencodeViewProvider.ts
```

The extension depends on VS Code APIs that are unavailable in plain Node.js
tests unless mocked, including `vscode.window`, `vscode.commands`,
`vscode.workspace`, `vscode.env.asExternalUri`, `WebviewView`, `WebviewPanel`,
and `ExtensionContext`.

## Decision

Use **Vitest** as the minimal unit-level test runner.

Recommended scripts:

| Script | Purpose |
| --- | --- |
| `test` | Run Vitest once. |
| `test:watch` | Run Vitest in watch mode. |
| `check` | Run `npm run compile && npm test`. |

Recommended dev dependency:

- `vitest`

## File Layout

```text
src/
  test/
    vscodeMock.ts
    fixtures/

  diagnostics/
    OpencodeOutputChannel.ts
    OpencodeOutputChannel.test.ts

  webview/
    webviewRenderer.ts
    webviewRenderer.test.ts

  server/
    ServerManager.ts
    ServerManager.test.ts

  panels/
    OpencodePanelManager.ts
    OpencodePanelManager.test.ts

vitest.config.ts
```

Guidelines:

- Prefer colocated `*.test.ts` files near the implementation.
- Put reusable VS Code mocks under `src/test/`.
- Keep tests behavior-focused; avoid private-method and snapshot-heavy tests.
- Use dependency injection for process spawning, URI rewriting, quick-picks,
  notifications, output channels, and proxy startup where practical.

## First Test Targets

1. **Output channel wrapper**
   - creates one `opencode` channel
   - appends info/warn/error lines
   - sanitizes child-process output
   - reveals the channel

2. **Shared webview renderer**
   - loading HTML
   - error HTML with and without install hint
   - iframe HTML with server URL and origin
   - sidebar vs editor layout mode

3. **Connection lifecycle**
   - no-workspace error
   - existing server reuse
   - missing binary error
   - URL detection from stdout/stderr
   - restart state fan-out

4. **Panel and add-to-chat routing**
   - panel creation and disposal cleanup
   - active/recent host tracking
   - no-host notification
   - one-host direct routing
   - multiple-host quick-pick routing

## Non-Goals

Do not include these in the bootstrap phase:

- Full VS Code integration harness with `@vscode/test-electron`.
- Playwright/browser automation for the embedded opencode UI.
- Real `opencode serve` startup in CI.
- Testing VS Code's own editor tab movement/splitting behavior.
- Remote SSH/container extension-host testing.
- Large coverage-driven refactors before the feature seams are clear.

## Success Criteria

- `npm test` runs Vitest successfully.
- `npm run compile` still passes.
- Tests can mock the `vscode` module without launching VS Code.
- At least one Output channel unit test exists.
- At least one webview-rendering or connection-state unit test exists.
- Manual test plans remain the required proof for real VS Code UI, webview,
  remote, and real `opencode` behavior.

## Rollout

1. Add Vitest config, dependency, and scripts.
2. Add a minimal `vscode` mock.
3. Add output-channel wrapper tests.
4. Extract and test webview rendering helpers.
5. Add connection-manager and panel-manager tests as those components are implemented.
