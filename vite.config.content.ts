import { defineConfig } from "vite";
import { resolve } from "path";

// Content script build: single-file IIFE so it can be injected via chrome.scripting
// (content scripts are classic scripts and cannot contain ESM imports).
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: resolve(__dirname, "src/content_script.ts"),
      name: "RetseptPdfContentScript",
      formats: ["iife"],
      fileName: () => "content_script.js",
    },
  },
});


