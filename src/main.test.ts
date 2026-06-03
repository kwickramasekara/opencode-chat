import { describe, expect, it } from "vitest";
import { activate, deactivate } from "./main";
import {
  commands,
  createExtensionContextMock,
  outputChannels,
  registeredCommands,
  workspace,
} from "./test/vscodeMock";

describe("extension activation diagnostics", () => {
  it("registers one output wrapper and showOutput reveals it without opening chat", async () => {
    /*
     * Scenario: diagnostics output can be opened independently of chat hosts
     *   Given the extension activates without any resolved webview host
     *   When opencode.showOutput runs
     *   Then one opencode output channel has been registered for disposal
     *   And the output channel is revealed without focusing the chat view
     */
    workspace.workspaceFolders = undefined;
    const context = createExtensionContextMock();

    activate(context as never);
    const showOutput = registeredCommands.find(
      (registered) => registered.command === "opencode.showOutput",
    );
    await showOutput?.callback();

    expect(outputChannels).toHaveLength(1);
    expect(context.subscriptions).toContainEqual(expect.objectContaining({}));
    expect(outputChannels[0].show).toHaveBeenCalledOnce();
    expect(commands.executeCommand).not.toHaveBeenCalledWith("opencode.chatView.focus");
    expect(commands.executeCommand).not.toHaveBeenCalledWith("opencode.toggleChatView");

    deactivate();
  });
});
