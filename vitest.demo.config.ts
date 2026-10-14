import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { demoPatches } from "./vite.demo.config";

const root = import.meta.dirname;
export default defineConfig({
  plugins: [demoPatches(), react()],
  resolve: { alias: { "@": path.resolve(root, "client", "src"), "@shared": path.resolve(root, "shared"), "@assets": path.resolve(root, "attached_assets") } },
  define: { "import.meta.env.VITE_FRONTEND_FORGE_API_KEY": JSON.stringify(""), "import.meta.env.VITE_FRONTEND_FORGE_API_URL": JSON.stringify("") },
  test: { environment: "jsdom", include: ["client/src/demo/__tests__/**/*.test.tsx"], setupFiles: ["client/src/demo/__tests__/setup.ts"], testTimeout: 60000, hookTimeout: 60000, css: false },
});
