//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

import { defineConfig } from "vitest/config";

// The build output is embedded into EmbeddedPanel.swift by script/embed-panel.
// manifest.json lives in public/ so it is copied alongside the build.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Stable names. The same input must embed to the same Swift source, so CI can
        // tell from a diff whether the committed EmbeddedPanel.swift is up to date.
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
  test: {
    // Vitest gives every stylesheet an empty body unless it is listed here, and the
    // token and font-scale tests read these as raw text.
    css: {
      include: [/src\/style\.css/, /@necto\/bridge\/theme\.css/, /@necto\/bridge\/components\.css/],
    },
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    // The view tests need a DOM; everything else runs in node.
    environmentMatchGlobs: [
      ["tests/{view,connect}.test.ts", "jsdom"],
      ["tests/traffic/view.test.ts", "jsdom"],
      ["tests/english.test.ts", "jsdom"],
      ["tests/mock.test.ts", "jsdom"],
    ],
  },
});
