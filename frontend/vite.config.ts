import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // MediaPipe WASM requires cross-origin isolation headers
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    proxy: {
      "/api": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
    },
    // Suppress "Failed to load source map" warnings from @mediapipe/tasks-vision.
    // The package ships without its .map file — this is a known upstream issue.
    sourcemapIgnoreList: (sourcePath) => sourcePath.includes("node_modules"),
  },
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === "SOURCEMAP_ERROR") return;
        warn(warning);
      },
    },
  },
  optimizeDeps: {
    exclude: ["@mediapipe/tasks-vision"],
  },
});
