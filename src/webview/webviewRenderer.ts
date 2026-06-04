import * as fs from "fs";
import * as path from "path";

export type WebviewLayoutMode = "sidebar" | "editor";

export type WebviewRenderState =
  | { type: "loading" }
  | { type: "ready"; serverUrl: string }
  | { type: "error"; message: string; showInstallHint: boolean };

export function renderWebviewState(
  state: WebviewRenderState,
  layoutMode: WebviewLayoutMode,
): string {
  switch (state.type) {
    case "loading":
      return renderLoadingHtml();
    case "error":
      return renderErrorHtml(state.message, state.showInstallHint);
    case "ready":
      return renderIframeHtml(state.serverUrl, layoutMode);
  }
}

export function renderLoadingHtml(): string {
  return readTemplate("loading.html");
}

export function renderErrorHtml(
  message: string,
  showInstallHint: boolean,
): string {
  const installHint = showInstallHint
    ? "<p>Make sure <code>opencode</code> is installed and available in your PATH.</p>"
    : "";

  return readTemplate("error.html")
    .replaceAll("{{ERROR_MESSAGE}}", escapeHtml(normalizeErrorMessage(message)))
    .replaceAll("{{INSTALL_HINT}}", installHint);
}

export function renderIframeHtml(
  serverUrl: string,
  layoutMode: WebviewLayoutMode,
): string {
  return readTemplate("iframe.html")
    .replaceAll("{{SERVER_URL}}", serverUrl)
    .replaceAll("{{SERVER_ORIGIN}}", extractServerOrigin(serverUrl))
    .replaceAll("{{BODY_LAYOUT_CSS}}", getBodyLayoutCss(layoutMode));
}

export function renderClosedWebviewHtml(): string {
  return readTemplate("closed.html");
}

export function extractServerOrigin(serverUrl: string): string {
  try {
    return new URL(serverUrl).origin;
  } catch {
    return serverUrl;
  }
}

function getBodyLayoutCss(layoutMode: WebviewLayoutMode): string {
  if (layoutMode === "sidebar") {
    return [
      "margin: 0 auto;",
      "padding: 0;",
      "overflow: hidden;",
      "height: 100vh;",
      "width: 100vw;",
      "max-width: 640px;",
    ].join("\n        ");
  }

  return [
    "margin: 0;",
    "padding: 0;",
    "overflow: hidden;",
    "height: 100vh;",
    "width: 100vw;",
  ].join("\n        ");
}

function readTemplate(name: string): string {
  const templatePath = path.join(__dirname, "templates", name);
  return fs.readFileSync(templatePath, "utf-8");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeErrorMessage(message: string): string {
  return message.replace(/<\/?code>/gi, "");
}
