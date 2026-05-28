import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    resolve: {
      alias: {
        "@shared": path.resolve(__dirname, "src/shared"),
        "@main": path.resolve(__dirname, "src/main"),
      },
    },
  },
  preload: {
    resolve: {
      alias: {
        "@shared": path.resolve(__dirname, "src/shared"),
      },
    },
  },
  renderer: {
    // file:// 下必须用相对路径，否则 /icon.png 等根路径资源会 404
    base: "./",
    publicDir: path.resolve(__dirname, "public"),
    build: {
      rollupOptions: {
        input: path.resolve(__dirname, "src/renderer/index.html"),
      },
    },
    resolve: {
      alias: {
        "@shared": path.resolve(__dirname, "src/shared"),
        "@renderer": path.resolve(__dirname, "src/renderer"),
      },
    },
    plugins: [react()],
  },
});
