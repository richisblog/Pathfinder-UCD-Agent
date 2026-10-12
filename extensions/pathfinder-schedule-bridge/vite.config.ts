import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { defineConfig, type Plugin } from "vite";

const root = import.meta.dirname;

function copyManifest(): Plugin {
  return {
    name: "copy-extension-manifest",
    async closeBundle() {
      await mkdir(resolve(root, "dist"), { recursive: true });
      await copyFile(resolve(root, "manifest.json"), resolve(root, "dist/manifest.json"));
    },
  };
}

export default defineConfig({
  plugins: [copyManifest()],
  build: {
    target: "chrome116",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(root, "src/background/index.ts"),
        popup: resolve(root, "popup.html"),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
