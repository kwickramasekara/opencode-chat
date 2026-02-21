# opencode chat

Unofficial opencode chat extension that integrates the webview of opencode chat into your IDE.

![Preview](https://raw.githubusercontent.com/kwickramasekara/opencode-chat/refs/heads/main/preview.png)

## Features

- **Sidebar Integration**: Access the OpenCode chat interface directly from your VS Code activity bar.
- **Add to Chat Commands**: Easily add files to the chat context by right-clicking in the explorer or using the editor title bar context menu.
- **Seamless Clipboard Support**: Overcomes typical webview iframe limitations to provide full copy, cut, and paste functionality (including image pasting) within the chat.
- **Persistent Sessions**: Saves your session, port, and user preferences across VS Code restarts.

Note: requires opencode CLI to be installed. See https://opencode.ai/

## Development

1. Run `npm install`
2. Run `npm run watch` (or `npm run compile`)
3. Open the repository in VS Code and press `F5` to open a new VS Code window with the extension loaded.
