import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

type CommandContribution = {
  command: string;
  title: string;
  icon?: string;
};

type MenuContribution = {
  command: string;
  when?: string;
  group?: string;
};

type PackageJson = {
  contributes: {
    commands: CommandContribution[];
    menus?: Record<string, MenuContribution[]>;
  };
};

function loadPackageJson(): PackageJson {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
  ) as PackageJson;
}

function commandMap(packageJson: PackageJson): Map<string, CommandContribution> {
  return new Map(
    packageJson.contributes.commands.map((command) => [command.command, command]),
  );
}

function commandPaletteHiddenCommands(packageJson: PackageJson): Set<string> {
  return new Set(
    (packageJson.contributes.menus?.commandPalette ?? [])
      .filter((entry) => entry.when === "false")
      .map((entry) => entry.command),
  );
}

describe("package command contributions", () => {
  it("uses surface-explicit opencode command titles", () => {
    /*
     * Scenario: Commands use surface-explicit titles
     *   Given the extension command contributions are loaded
     *   When opencode command titles are inspected
     *   Then editor-tab commands mention Editor
     *   And sidebar commands mention Sidebar Chat
     *   And server/output commands mention their concrete target
     */
    const commands = commandMap(loadPackageJson());

    expect(Object.fromEntries(commands)).toMatchObject({
      "opencode.addToChat": { title: "opencode: Add File to Chat" },
      "opencode.addSelectionToChat": { title: "opencode: Add Selection to Chat" },
      "opencode.toggleChatView": { title: "opencode: Toggle Sidebar Chat" },
      "opencode.toggleChatViewInPanelOrSidebar": {
        title: "opencode: Toggle Sidebar Chat",
      },
      "opencode.openChat": { title: "opencode: New Chat in Editor" },
      "opencode.openChatBeside": {
        title: "opencode: New Chat in Editor to the Side",
      },
      "opencode.restart": { title: "opencode: Restart Server" },
      "opencode.showOutput": { title: "opencode: Show Output Channel" },
    });
  });

  it("contributes close sidebar chat with a close icon", () => {
    /*
     * Scenario: Close sidebar chat command is contributed
     *   Given package command contributions are loaded
     *   When opencode.closeSidebarChat is inspected
     *   Then it has the Command Palette title from the spec
     *   And it uses VS Code's close icon for toolbar display
     */
    const commands = commandMap(loadPackageJson());

    expect(commands.get("opencode.closeSidebarChat")).toMatchObject({
      command: "opencode.closeSidebarChat",
      title: "opencode: Close Sidebar Chat",
      icon: "$(close)",
    });
  });

  it("contributes sidebar view-title actions scoped to the opencode chat view", () => {
    /*
     * Scenario: Sidebar view-title actions are contributed
     *   Given package contributions are loaded
     *   When contributes.menus["view/title"] is inspected
     *   Then one entry invokes opencode.openChat
     *   And one entry invokes opencode.closeSidebarChat
     *   And both entries are scoped with view == opencode.chatView
     */
    const packageJson = loadPackageJson();
    const viewTitleEntries = packageJson.contributes.menus?.["view/title"] ?? [];

    expect(viewTitleEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "opencode.openChat",
          when: "view == opencode.chatView",
        }),
        expect.objectContaining({
          command: "opencode.closeSidebarChat",
          when: "view == opencode.chatView",
        }),
      ]),
    );
  });

  it("does not expose duplicate visible opencode Command Palette titles", () => {
    /*
     * Scenario: Visible command palette titles are not duplicated
     *   Given opencode command contributions are loaded
     *   When visible Command Palette entries are derived
     *   Then no visible opencode command title appears more than once
     *   And the compatibility toggle alias is hidden from the palette
     */
    const packageJson = loadPackageJson();
    const hiddenCommands = commandPaletteHiddenCommands(packageJson);
    const visibleOpencodeTitles = packageJson.contributes.commands
      .filter((command) => command.command.startsWith("opencode."))
      .filter((command) => !hiddenCommands.has(command.command))
      .map((command) => command.title);
    const duplicateTitles = visibleOpencodeTitles.filter(
      (title, index) => visibleOpencodeTitles.indexOf(title) !== index,
    );

    expect(hiddenCommands).toContain("opencode.toggleChatViewInPanelOrSidebar");
    expect(duplicateTitles).toEqual([]);
  });
});
