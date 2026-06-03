import * as fs from "fs";
import * as path from "path";
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

  it("contributes and registers every opencode command required by Phase 4", () => {
    /*
     * Scenario: manifest commands match activation registrations
     *   Given Phase 4 adds editor panel commands and a sidebar-toggle alias
     *   When the extension activates
     *   Then every contributed opencode command has a registered callback
     */
    workspace.workspaceFolders = undefined;
    const context = createExtensionContextMock();
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
    ) as { contributes: { commands: Array<{ command: string }> } };
    const contributedCommands = packageJson.contributes.commands.map(
      (contribution) => contribution.command,
    );

    activate(context as never);

    expect(contributedCommands).toEqual(
      expect.arrayContaining([
        "opencode.addToChat",
        "opencode.addSelectionToChat",
        "opencode.toggleChatView",
        "opencode.toggleChatViewInPanelOrSidebar",
        "opencode.openChat",
        "opencode.openChatBeside",
        "opencode.restart",
        "opencode.showOutput",
      ]),
    );
    expect(registeredCommands.map((registered) => registered.command)).toEqual(
      expect.arrayContaining(contributedCommands),
    );

    deactivate();
  });
});
