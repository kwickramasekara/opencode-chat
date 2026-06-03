import * as http from "http";
import * as net from "net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startWebviewProxy } from "./WebviewProxy";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  servers.length = 0;
});

function listen(server: http.Server, port: number) {
  return new Promise<number>((resolve) => {
    server.listen(port, "localhost", () => {
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}

describe("startWebviewProxy diagnostics", () => {
  it("logs high-level start and fallback lifecycle without request bodies", async () => {
    /*
     * Scenario: proxy diagnostics stay lifecycle-only
     *   Given the preferred proxy port is already in use
     *   When the webview proxy starts
     *   Then diagnostics mention listen/start/fallback lifecycle events
     *   And no request or response body details are logged
     */
    const occupied = http.createServer();
    servers.push(occupied);
    const occupiedPort = await listen(occupied, 0);
    const diagnostics = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const result = await startWebviewProxy(4100, occupiedPort, diagnostics);
    servers.push(result.server);

    expect(result.port).not.toBe(occupiedPort);
    expect(diagnostics.info).toHaveBeenCalledWith(
      expect.stringContaining("Webview proxy listening attempt"),
    );
    expect(diagnostics.warn).toHaveBeenCalledWith(
      expect.stringContaining("falling back to a random port"),
    );
    expect(diagnostics.info).toHaveBeenCalledWith(
      expect.stringContaining("Webview proxy started"),
    );
    expect(
      [...diagnostics.info.mock.calls, ...diagnostics.warn.mock.calls, ...diagnostics.error.mock.calls]
        .flat()
        .join("\n"),
    ).not.toMatch(/request body|response body|TOKEN=|Bearer /i);
  });
});
