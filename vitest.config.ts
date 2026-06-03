import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    restoreMocks: false,
  },
  resolve: {
    alias: {
      vscode: resolve(__dirname, "src/test/vscodeMock.ts"),
    },
  },
});
