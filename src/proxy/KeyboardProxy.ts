import * as http from "http";
import * as net from "net";

// ─── Keyboard Proxy ─────────────────────────────────────────────────
// A lightweight local HTTP proxy that sits between the webview iframe
// and the OpenCode server.  It transparently forwards every request
// but, for HTML responses, injects a small script that re-broadcasts
// keyboard events to the parent webview so copy/paste/cut/selectAll
// work even though the iframe is cross-origin to the webview.

const KEYBOARD_SCRIPT = /*html*/ `
<script>
  (function () {
    document.addEventListener("keydown", function (e) {
      var mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      switch (e.key.toLowerCase()) {
        case "c":
          document.execCommand("copy");
          break;
        case "x":
          document.execCommand("cut");
          break;
        case "a":
          e.preventDefault();
          document.execCommand("selectAll");
          break;
        case "v":
          e.preventDefault();
          window.parent.postMessage({ type: "paste-request" }, "*");
          break;
      }
    });

    window.addEventListener("message", function (e) {
      if (!e.data || e.data.type !== "paste-response") return;

      if (e.data.image) {
        fetch(e.data.image)
          .then(function (r) { return r.blob(); })
          .then(function (blob) {
            var file = new File([blob], "image.png", {
              type: e.data.mimeType || "image/png",
            });
            var dt = new DataTransfer();
            dt.items.add(file);
            var ev = new ClipboardEvent("paste", {
              clipboardData: dt,
              bubbles: true,
              cancelable: true,
            });
            (document.activeElement || document).dispatchEvent(ev);
          });
      } else if (typeof e.data.text === "string") {
        var t = e.data.text;
        var el = document.activeElement;
        if (!el) return;

        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
          var s = el.selectionStart || 0;
          var end = el.selectionEnd || 0;
          el.setRangeText(t, s, end, "end");
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } else if (
          el.isContentEditable ||
          (el.closest && el.closest("[contenteditable]"))
        ) {
          document.execCommand("insertText", false, t);
        }
      }
    });
  })();
</script>
`;

export function startKeyboardProxy(
  targetPort: number,
  proxyPort: number = 0,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Strip accept-encoding so we get an uncompressed body to inject into
      const headers: Record<string, string | string[] | undefined> = {
        ...req.headers,
      };
      delete headers["accept-encoding"];
      headers.host = `localhost:${targetPort}`;

      const proxyReq = http.request(
        {
          hostname: "localhost",
          port: targetPort,
          path: req.url,
          method: req.method,
          headers,
        },
        (proxyRes) => {
          const ct = proxyRes.headers["content-type"] || "";

          if (ct.includes("text/html")) {
            // Buffer the HTML so we can inject the keyboard script
            let body = "";
            proxyRes.on("data", (chunk: Buffer) => {
              body += chunk.toString();
            });
            proxyRes.on("end", () => {
              body = body.includes("</head>")
                ? body.replace("</head>", KEYBOARD_SCRIPT + "</head>")
                : body + KEYBOARD_SCRIPT;

              const outHeaders = { ...proxyRes.headers };
              outHeaders["content-length"] = Buffer.byteLength(body).toString();
              delete outHeaders["content-encoding"];
              // Remove upstream CSP so our injected script can run
              delete outHeaders["content-security-policy"];
              delete outHeaders["content-security-policy-report-only"];

              res.writeHead(proxyRes.statusCode || 200, outHeaders);
              res.end(body);
            });
          } else {
            // Non-HTML: pipe through untouched
            res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
            proxyRes.pipe(res);
          }
        },
      );

      proxyReq.on("error", () => {
        res.writeHead(502).end();
      });
      req.pipe(proxyReq);
    });

    // Transparent WebSocket proxy (for live-reload, etc.)
    server.on("upgrade", (req, clientSocket, head) => {
      const serverSocket = net.connect(targetPort, "localhost", () => {
        const reqLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
        const hdrs = Object.entries(req.headers)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
          .join("\r\n");
        serverSocket.write(reqLine + hdrs + "\r\n\r\n");
        if (head.length > 0) serverSocket.write(head);

        clientSocket.pipe(serverSocket);
        serverSocket.pipe(clientSocket);
      });
      serverSocket.on("error", () => clientSocket.destroy());
      clientSocket.on("error", () => serverSocket.destroy());
    });

    const tryListen = (port: number) => {
      server.listen(port, "localhost", () => {
        server.removeAllListeners("error");
        server.on("error", reject);
        resolve({ server, port: (server.address() as net.AddressInfo).port });
      });
    };

    server.on("error", (err: any) => {
      if (err.code === "EADDRINUSE" && proxyPort !== 0) {
        // Fallback to random port
        proxyPort = 0;
        tryListen(0);
      } else {
        reject(err);
      }
    });

    tryListen(proxyPort);
  });
}
