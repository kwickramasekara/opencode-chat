import * as fs from "fs";
import * as path from "path";
import { describe, expect, it, vi } from "vitest";
import { activate, deactivate } from "./main";
import {
  commands,
  createdWebviewPanels,
  createExtensionContextMock,
  createWebviewViewMock,
  outputChannels,
  registeredCommands,
  registeredWebviewViewProviders,
  workspace,
} from "./test/vscodeMock";
import type { OpencodeViewProvider } from "./webview/OpencodeViewProvider";

function registeredCommand(command: string) {
  const registration = registeredCommands.find(
    (registered) => registered.command === command,
  );
  expect(registration).toBeDefined();
  return registration!;
}

function registeredSidebarProvider(): OpencodeViewProvider {
  const registration = registeredWebviewViewProviders.find(
    (registered) => registered.viewType === "opencode.chatView",
  );
  expect(registration).toBeDefined();
  return registration!.provider as OpencodeViewProvider;
}

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
        "opencode.closeSidebarChat",
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

  it("closes only the sidebar chat when the close command runs", async () => {
    /*
     * Scenario: close sidebar chat is sidebar-host local
     *   Given the extension has registered the sidebar provider
     *   When opencode.closeSidebarChat runs
     *   Then only the provider close behavior is invoked
     *   And the shared restart command is not executed as a side effect
     */
    workspace.workspaceFolders = undefined;
    const context = createExtensionContextMock();

    activate(context as never);
    const provider = registeredSidebarProvider();
    const closeChat = vi.spyOn(provider, "closeChat");

    await registeredCommand("opencode.closeSidebarChat").callback();

    expect(closeChat).toHaveBeenCalledOnce();
    expect(commands.executeCommand).not.toHaveBeenCalledWith("opencode.restart");
    expect(commands.executeCommand).not.toHaveBeenCalledWith("opencode.toggleChatView");

    deactivate();
  });

  it("explicitly reopens a closed sidebar before focusing it", async () => {
    /*
     * Scenario: closed sidebar chat is reopened by the sidebar toggle command
     *   Given the sidebar chat has been closed while its view is not visible
     *   When opencode.toggleChatView runs
     *   Then the provider is explicitly reopened
     *   And the sidebar view is focused using the current provider state
     */
    workspace.workspaceFolders = undefined;
    const context = createExtensionContextMock();

    activate(context as never);
    const provider = registeredSidebarProvider();
    const reopenChat = vi.spyOn(provider, "reopenChat");
    provider.closeChat();

    await registeredCommand("opencode.toggleChatView").callback();

    expect(reopenChat).toHaveBeenCalledOnce();
    expect(commands.executeCommand).toHaveBeenCalledWith("opencode.chatView.focus");

    deactivate();
  });

  it("reopens a visible closed sidebar without toggling the sidebar container away", async () => {
    /*
     * Scenario: closed sidebar view is already visible
     *   Given the resolved sidebar view is visible but its chat iframe is closed
     *   When opencode.toggleChatView runs
     *   Then the provider reopens the chat and focuses the sidebar view
     *   And it does not hide the sidebar container instead
     */
    workspace.workspaceFolders = undefined;
    const context = createExtensionContextMock();

    activate(context as never);
    const provider = registeredSidebarProvider();
    provider.resolveWebviewView(createWebviewViewMock() as never);
    const reopenChat = vi.spyOn(provider, "reopenChat");
    provider.closeChat();

    await registeredCommand("opencode.toggleChatView").callback();

    expect(reopenChat).toHaveBeenCalledOnce();
    expect(commands.executeCommand).toHaveBeenCalledWith("opencode.chatView.focus");
    expect(commands.executeCommand).not.toHaveBeenCalledWith("workbench.action.toggleSidebarVisibility");
    expect(commands.executeCommand).not.toHaveBeenCalledWith("workbench.action.toggleAuxiliaryBar");

    deactivate();
  });

  it("opens a new editor chat without mutating sidebar state", async () => {
    /*
     * Scenario: New Chat in Editor is independent from sidebar state
     *   Given the sidebar provider exists
     *   When opencode.openChat runs
     *   Then a new editor-tab webview panel is created
     *   And sidebar close/reopen state is not changed by that command
     */
    workspace.workspaceFolders = undefined;
    const context = createExtensionContextMock();

    activate(context as never);
    const provider = registeredSidebarProvider();
    const closeChat = vi.spyOn(provider, "closeChat");
    const reopenChat = vi.spyOn(provider, "reopenChat");

    await registeredCommand("opencode.openChat").callback();

    expect(createdWebviewPanels).toHaveLength(1);
    expect(closeChat).not.toHaveBeenCalled();
    expect(reopenChat).not.toHaveBeenCalled();

    deactivate();
  });
});
