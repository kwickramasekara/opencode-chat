import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { Uri, window, workspace } from "../test/vscodeMock";
import type { OpencodeWebviewHost } from "../webview/webviewHost";
import {
  formatFileReference,
  formatSelectionReference,
  routeTextToChat,
} from "./addToChat";

function host(id: string, title: string, lastUsedAt: number): OpencodeWebviewHost {
  return {
    id,
    title,
    type: id.startsWith("sidebar") ? "sidebar" : "editor",
    isLiveHost: true,
    lastUsedAt,
    disposed: false,
    renderState: vi.fn(),
    postInsertText: vi.fn(async () => true),
    reveal: vi.fn(),
  };
}

function selection(startLine: number, startCharacter: number, endLine = startLine, endCharacter = startCharacter) {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
    isEmpty: startLine === endLine && startCharacter === endCharacter,
  };
}

describe("add-to-chat routing", () => {
  it("shows a notification and does not throw when no live chat hosts exist", async () => {
    /*
     * Scenario: add-to-chat with no chat target
     *   Given neither the sidebar nor editor panels are live
     *   When add-to-chat routes text
     *   Then the user is told to start chat first
     *   And no quick pick is shown
     */
    await routeTextToChat("src/main.ts", []);

    expect(window.showInformationMessage).toHaveBeenCalledWith("Start opencode chat first.");
    expect(window.showQuickPick).not.toHaveBeenCalled();
  });

  it("sends directly to one host without showing a quick pick", async () => {
    const only = host("sidebar", "Chat", 100);

    await routeTextToChat("src/main.ts", [only]);

    expect(window.showQuickPick).not.toHaveBeenCalled();
    expect(only.postInsertText).toHaveBeenCalledWith("src/main.ts");
  });

  it("offers last-used default plus concrete hosts sorted by recency", async () => {
    /*
     * Scenario: multiple chat targets require an explicit route
     *   Given several live hosts exist
     *   When text is routed to chat
     *   Then the quick pick contains a default last-used target
     *   And concrete hosts are sorted by last-used descending
     */
    const older = host("panel-1", "opencode Chat 1", 10);
    const newest = host("panel-2", "opencode Chat 2", 30);
    const middle = host("sidebar", "Chat", 20);
    window.showQuickPick.mockResolvedValueOnce({ host: newest });

    await routeTextToChat("src/main.ts", [older, newest, middle]);

    const items = window.showQuickPick.mock.calls[0][0] as Array<{ label: string; host: OpencodeWebviewHost }>;
    expect(items.map((item) => item.label)).toEqual([
      "last used (opencode Chat 2)",
      "opencode Chat 2",
      "Chat",
      "opencode Chat 1",
    ]);
    expect(newest.postInsertText).toHaveBeenCalledWith("src/main.ts");
    expect(older.postInsertText).not.toHaveBeenCalled();
  });

  it("keeps file and selection reference formatting stable", () => {
    workspace.asRelativePath.mockReturnValue("src/main.ts");

    expect(formatFileReference(Uri.file("/workspace/src/main.ts") as unknown as vscode.Uri)).toBe(
      "src/main.ts",
    );
    expect(
      formatSelectionReference({
        document: { uri: Uri.file("/workspace/src/main.ts") },
        selection: selection(4, 0),
      } as unknown as vscode.TextEditor),
    ).toBe("src/main.ts:5");
    expect(
      formatSelectionReference({
        document: { uri: Uri.file("/workspace/src/main.ts") },
        selection: selection(4, 2, 4, 8),
      } as unknown as vscode.TextEditor),
    ).toBe("src/main.ts:5:3-9");
    expect(
      formatSelectionReference({
        document: { uri: Uri.file("/workspace/src/main.ts") },
        selection: selection(4, 2, 6, 8),
      } as unknown as vscode.TextEditor),
    ).toBe("src/main.ts:5:3-7:9");
  });
});
