const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "src", "webview", "templates");
const outDir = path.join(root, "out", "webview", "templates");

fs.mkdirSync(outDir, { recursive: true });

for (const file of fs.readdirSync(srcDir)) {
  fs.copyFileSync(path.join(srcDir, file), path.join(outDir, file));
}
