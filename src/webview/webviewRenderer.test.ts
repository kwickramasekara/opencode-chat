import { describe, expect, it } from "vitest";
import { renderWebviewState } from "./webviewRenderer";

describe("webviewRenderer", () => {
  it("renders loading html from the loading template", () => {
    /*
     * Scenario: loading state is shared by webview hosts
     *   Given a webview host has no server URL and no error
     *   When the renderer renders the loading state
     *   Then it returns the loading template content
     */
    const html = renderWebviewState({ type: "loading" }, "sidebar");

    expect(html).toContain("Starting opencode server...");
  });

  it("renders error html with or without the install hint", () => {
    /*
     * Scenario: errors can opt into the opencode install hint
     *   Given one startup error is likely caused by a missing binary
     *   And another startup error is not
     *   When the renderer renders both error states
     *   Then only the first includes the opencode install hint
     */
    const withHint = renderWebviewState(
      { type: "error", message: "opencode failed", showInstallHint: true },
      "sidebar",
    );
    const withoutHint = renderWebviewState(
      { type: "error", message: "proxy failed", showInstallHint: false },
      "sidebar",
    );

    expect(withHint).toContain("opencode failed");
    expect(withHint).toContain("available in your PATH");
    expect(withoutHint).toContain("proxy failed");
    expect(withoutHint).not.toContain("available in your PATH");
  });

  it("renders legacy inline code tags in error messages as readable plain text", () => {
    /*
     * Scenario: legacy callers pass inline code markup in an error message
     *   Given an error message contains a <code> tag around the opencode command
     *   When the renderer renders the error state
     *   Then the message remains safe HTML
     *   And users see readable text instead of literal markup tags
     */
    const html = renderWebviewState(
      {
        type: "error",
        message: "Could not find the <code>opencode</code> CLI.",
        showInstallHint: false,
      },
      "sidebar",
    );

    expect(html).toContain("Could not find the opencode CLI.");
    expect(html).not.toContain("&lt;code&gt;");
    expect(html).not.toContain("<code>opencode</code>");
  });

  it("preserves the sidebar iframe max-width cap", () => {
    /*
     * Scenario: sidebar chat keeps its existing narrow layout
     *   Given the server is ready
     *   When the renderer renders iframe HTML for sidebar layout
     *   Then the iframe template keeps the 640px body max-width cap
     */
    const html = renderWebviewState(
      { type: "ready", serverUrl: "http://127.0.0.1:4096/path" },
      "sidebar",
    );

    expect(html).toContain("max-width: 640px");
    expect(html).toContain("http://127.0.0.1:4096/path");
    expect(html).toContain("frame-src http://127.0.0.1:4096");
  });

  it("uses full width and height without the sidebar max-width cap for editor layout", () => {
    /*
     * Scenario: editor tab chat uses all available panel space
     *   Given the server is ready
     *   When the renderer renders iframe HTML for editor layout
     *   Then the HTML has full viewport sizing
     *   And it does not include the sidebar max-width cap
     */
    const html = renderWebviewState(
      { type: "ready", serverUrl: "http://localhost:4096" },
      "editor",
    );

    expect(html).toContain("height: 100vh");
    expect(html).toContain("width: 100vw");
    expect(html).not.toContain("max-width: 640px");
  });

  it("falls back to the raw server URL as CSP origin when URL parsing fails", () => {
    /*
     * Scenario: malformed server URL does not crash rendering
     *   Given a malformed server URL reaches the renderer
     *   When iframe HTML is rendered
     *   Then rendering completes
     *   And CSP frame-src falls back to the raw URL string
     */
    const html = renderWebviewState(
      { type: "ready", serverUrl: "not a url" },
      "sidebar",
    );

    expect(html).toContain("src=\"not a url\"");
    expect(html).toContain("frame-src not a url");
  });
});
