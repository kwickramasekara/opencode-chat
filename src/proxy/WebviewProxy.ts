import * as http from "http";
import * as net from "net";

// ─── Webview Proxy ──────────────────────────────────────────────────
// A lightweight local HTTP proxy that sits between the webview iframe
// and the OpenCode server.  It transparently forwards every request
// but, for HTML responses, injects a small script that patches
// cross-origin limitations: keyboard shortcuts (copy/paste/cut),
// clipboard access, and audio playback (Web Audio API fallback).

const WEBVIEW_SCRIPT = /*html*/ String.raw`
<script>
  (function () {
    // ── Web Audio API fallback for VS Code webview autoplay restrictions ──
    // Electron enforces strict autoplay: play() requires a user gesture.
    // Notification sounds are triggered by server events (no gesture), so
    // native Audio.play() fails with NotAllowedError.
    //
    // Some Electron builds (stock VS Code) also lack proprietary codecs
    // (AAC), causing NotSupportedError even for Audio elements and
    // decodeAudioData. When both fail, we relay the audio data to the
    // extension host which can play it via system audio commands.
    var _audioCtx = null;
    var _audioUnlocked = false;
    var _audioModeByMime = Object.create(null);
    var _canPlayProbe = document.createElement("audio");

    function getAudioCtx() {
      if (!_audioCtx) {
        try {
          _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) { /* no AudioContext support */ }
      }
      return _audioCtx;
    }

    function unlockAudio() {
      if (_audioUnlocked) return;
      var ctx = getAudioCtx();
      if (!ctx) return;
      if (ctx.state === "suspended") {
        ctx.resume().then(function () { _audioUnlocked = true; });
      } else {
        _audioUnlocked = true;
      }
    }
    document.addEventListener("click", unlockAudio, true);
    document.addEventListener("keydown", unlockAudio, true);
    document.addEventListener("touchstart", unlockAudio, true);

    function dataUriToArrayBuffer(dataUri) {
      var comma = dataUri.indexOf(",");
      if (comma === -1) return null;
      var meta = dataUri.substring(0, comma);
      var b64 = dataUri.substring(comma + 1);
      if (meta.indexOf(";base64") === -1) return null;
      var bin = atob(b64);
      var buf = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      return buf.buffer;
    }

    function decodeBase64Url(value) {
      if (!value) return null;
      var base64 = value.replace(/-/g, "+").replace(/_/g, "/");
      while (base64.length % 4) base64 += "=";

      try {
        var bin = atob(base64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder("utf-8").decode(bytes);
      } catch (e) {
        return null;
      }
    }

    function currentDirectoryFromPath() {
      var slug = location.pathname.replace(/^\/+/, "").split("/")[0];
      if (!slug) return null;

      var dir = decodeBase64Url(slug);
      if (!dir) return null;

      if (!/^[A-Za-z]:[\\/]/.test(dir) && !dir.startsWith("/") && !dir.startsWith("\\\\")) {
        return null;
      }

      return dir;
    }

    function normalizeWindowsPath(value) {
      if (!value) return value;
      if (/^[A-Za-z]:[\\/]/.test(value) || value.indexOf("\\\\") === 0) {
        return value.replace(/\//g, "\\");
      }
      return value;
    }

    function seedDeepLink() {
      var defaultServerUrl = __OPENCODE_DEFAULT_SERVER_URL__;
      if (defaultServerUrl) {
        try {
          var directUrl = defaultServerUrl.replace(/\/+$/, "");
          var proxyUrl = location.origin.replace(/\/+$/, "");
          localStorage.setItem("opencode.settings.dat:defaultServerUrl", defaultServerUrl);

          var serverKey = "opencode.global.dat:server";
          var state = JSON.parse(localStorage.getItem(serverKey) || "{}");
          var list = Array.isArray(state.list) ? state.list : [];
          var shouldDropServer = function (url) {
            if (!url) return false;
            var value = url.replace(/\/+$/, "");
            if (value === directUrl) return false;
            if (value === proxyUrl) return true;
            try {
              var parsed = new URL(value);
              return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
            } catch (e) {
              return false;
            }
          };
          list = list.filter(function (server) {
            var url = typeof server === "string" ? server : server && server.http && server.http.url;
            return !shouldDropServer(url);
          });
          if (!list.some(function (server) {
            var url = typeof server === "string" ? server : server && server.http && server.http.url;
            return url && url.replace(/\/+$/, "") === directUrl;
          })) {
            list.unshift({ type: "http", http: { url: directUrl } });
          }
          state.list = list;
          localStorage.setItem(serverKey, JSON.stringify(state));
        } catch (e) {}
      }

      var dir = normalizeWindowsPath(currentDirectoryFromPath());
      if (!dir) return;

      var openProjectLink = "opencode://open-project?directory=" + encodeURIComponent(dir);
      var newSessionLink = "opencode://new-session?directory=" + encodeURIComponent(dir);
      window.__OPENCODE__ = window.__OPENCODE__ || {};
      var pending = window.__OPENCODE__.deepLinks || [];
      if (pending.indexOf(openProjectLink) === -1) pending.push(openProjectLink);
      if (pending.indexOf(newSessionLink) === -1) pending.push(newSessionLink);
      window.__OPENCODE__.deepLinks = pending;
    }

    seedDeepLink();

    function getAudioBuffer(src) {
      if (src.indexOf("data:") === 0) {
        var ab = dataUriToArrayBuffer(src);
        if (ab) return Promise.resolve(ab);
      }
      return fetch(src).then(function (r) {
        if (!r.ok) throw new Error("Fetch failed: " + r.status);
        return r.arrayBuffer();
      });
    }

    function playViaWebAudio(src) {
      var ctx = getAudioCtx();
      if (!ctx) return Promise.reject(new Error("No AudioContext"));
      var p = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
      return p
        .then(function () { return getAudioBuffer(src); })
        .then(function (buf) { return ctx.decodeAudioData(buf); })
        .then(function (decoded) {
          var source = ctx.createBufferSource();
          source.buffer = decoded;
          source.connect(ctx.destination);
          source.start(0);
        });
    }

    function playViaExtensionHost(src) {
      window.parent.postMessage({ type: "play-audio", src: src }, "*");
    }

    function getMimeFromSrc(src) {
      if (!src || src.indexOf("data:") !== 0) return "";
      var comma = src.indexOf(",");
      if (comma === -1) return "";
      var meta = src.substring(5, comma);
      var semi = meta.indexOf(";");
      return (semi === -1 ? meta : meta.substring(0, semi)).toLowerCase();
    }

    function getModeForMime(mime) {
      if (!mime) return "auto";
      return _audioModeByMime[mime] || "auto";
    }

    function setModeForMime(mime, mode) {
      if (!mime) return;
      _audioModeByMime[mime] = mode;
    }

    function canElementPlayMime(mime) {
      if (!mime) return true;
      try {
        return _canPlayProbe.canPlayType(mime) !== "";
      } catch (e) {
        return true;
      }
    }

    function isCodecFailure(err) {
      if (!err) return false;
      return (
        err.name === "EncodingError" ||
        err.name === "NotSupportedError" ||
        /decode|codec|supported source/i.test(String(err.message || ""))
      );
    }

    function tryWebAudioOrExtension(src, mime, setWebAudioOnSuccess) {
      return playViaWebAudio(src)
        .then(function () {
          if (setWebAudioOnSuccess && mime) setModeForMime(mime, "webaudio");
        })
        .catch(function (err) {
          if (isCodecFailure(err)) {
            setModeForMime(mime, "extension-host");
            playViaExtensionHost(src);
            return;
          }
          throw err;
        });
    }

    var OrigAudio = window.Audio;
    window.Audio = function (src) {
      var a = new OrigAudio(src);
      var origPlay = a.play.bind(a);
      a.play = function () {
        var mime = getMimeFromSrc(src);
        var mode = getModeForMime(mime);

        if (mode === "extension-host") {
          playViaExtensionHost(src);
          return Promise.resolve();
        }

        if (mode === "webaudio") {
          return tryWebAudioOrExtension(src, mime, false).catch(function () {});
        }

        // Fast-path for known unsupported codecs in this runtime.
        if (mime && !canElementPlayMime(mime)) {
          setModeForMime(mime, "webaudio");
          return tryWebAudioOrExtension(src, mime, false);
        }

        return origPlay().catch(function (err) {
          if (
            (err.name === "NotAllowedError" || err.name === "NotSupportedError") &&
            src
          ) {
            return tryWebAudioOrExtension(src, mime, true);
          }
          throw err;
        });
      };
      return a;
    };
    window.Audio.prototype = OrigAudio.prototype;

    // Override navigator.clipboard.writeText to relay through parent
    // In some VS Code workspace configurations, navigator.clipboard may be
    // undefined (non-secure context). Create a polyfill so copy still works
    // by relaying through the extension host.
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: function () { return Promise.resolve(); },
          readText: function () { return Promise.resolve(""); },
        },
        writable: true,
        configurable: true,
      });
    }
    var origWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = function (text) {
      window.parent.postMessage({ type: "copy-request", text: text }, "*");
      return Promise.resolve();
    };

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
        case "z":
          e.preventDefault();
          if (e.shiftKey) {
            document.execCommand("redo");
          } else {
            document.execCommand("undo");
          }
          break;
      }
    });

    window.addEventListener("message", function (e) {
      if (!e.data || (e.data.type !== "paste-response" && e.data.type !== "insert-text")) return;

      if (e.data.type === "paste-response" && e.data.image) {
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
        var isInsert = e.data.type === "insert-text";
        var el = document.activeElement;

        // If inserting and no input is active, try to find and focus the main prompt input
        if (isInsert && (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA" && !el.isContentEditable && !(el.closest && el.closest("[contenteditable]"))))) {
          el = document.querySelector("div[data-component='prompt-input']");
          if (el) {
            el.focus();
          }
        }

        if (!el) return;

        var insertStr = isInsert ? " " + t + " " : t;

        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
          // Native setters so React registers the input
          var nativeTextAreaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
          var nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
          
          var s = el.selectionStart || 0;
          var end = el.selectionEnd || 0;
          
          if (nativeTextAreaSetter && nativeTextAreaSetter.set && el.tagName === "TEXTAREA") {
            var val = el.value || "";
            nativeTextAreaSetter.set.call(el, val.substring(0, s) + insertStr + val.substring(end));
            el.selectionStart = el.selectionEnd = s + insertStr.length;
          } else if (nativeInputSetter && nativeInputSetter.set && el.tagName === "INPUT") {
            var val = el.value || "";
            nativeInputSetter.set.call(el, val.substring(0, s) + insertStr + val.substring(end));
            el.selectionStart = el.selectionEnd = s + insertStr.length;
          } else {
            el.setRangeText(insertStr, s, end, "end");
          }
          
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } else if (
          el.isContentEditable ||
          (el.closest && el.closest("[contenteditable]"))
        ) {
          // If the element is not currently focused (the selection is not inside it), we must focus it first
          if (document.activeElement !== el) {
            el.focus();
          }
          document.execCommand("insertText", false, insertStr);
        }
      }
    });
  })();
</script>
`;

export function startWebviewProxy(
  targetPort: number,
  proxyPort: number = 0,
  defaultServerUrl?: string,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const webviewScript = WEBVIEW_SCRIPT.replace(
      "__OPENCODE_DEFAULT_SERVER_URL__",
      JSON.stringify(defaultServerUrl ?? ""),
    );
    const patchedServerUrl = JSON.stringify(defaultServerUrl ?? "");

    const patchScriptBody = (body: string) => {
      if (!defaultServerUrl) return body;
      return body.replace(
        /location\.hostname\.includes\("opencode\.ai"\)\?"http:\/\/localhost:\d+":location\.origin/g,
        patchedServerUrl,
      );
    };

    const sendBuffered = (
      res: http.ServerResponse,
      proxyRes: http.IncomingMessage,
      body: string,
      removeCsp = false,
    ) => {
      const headers: http.OutgoingHttpHeaders = { ...proxyRes.headers };
      headers["content-length"] = Buffer.byteLength(body).toString();
      delete headers["content-encoding"];

      if (removeCsp) {
        delete headers["content-security-policy"];
        delete headers["content-security-policy-report-only"];
      }

      res.writeHead(proxyRes.statusCode || 200, headers);
      res.end(body);
    };

    const bufferResponse = (
      proxyRes: http.IncomingMessage,
      res: http.ServerResponse,
      transform: (body: string) => string,
      removeCsp = false,
    ) => {
      let body = "";
      proxyRes.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      proxyRes.on("end", () => sendBuffered(res, proxyRes, transform(body), removeCsp));
    };

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
          const ct = String(proxyRes.headers["content-type"] || "");

          if (ct.includes("text/html")) {
            bufferResponse(
              proxyRes,
              res,
              (body) => body.includes("</head>")
                ? body.replace("</head>", webviewScript + "</head>")
                : body + webviewScript,
              true,
            );
          } else if (ct.includes("javascript")) {
            bufferResponse(proxyRes, res, patchScriptBody);
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
