import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Main build: popup + options HTML pages (ESM) and MV3 service worker (module).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        options: resolve(__dirname, "options.html"),
        offscreen: resolve(__dirname, "offscreen.html"),
        service_worker: resolve(__dirname, "src/service_worker.ts"),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "service_worker") return "service_worker.js";
          return "[name].js";
        },
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});


