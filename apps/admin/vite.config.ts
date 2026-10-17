import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Админка отдаётся сервером по пути /admin/. В dev-режиме API проксируется на :3000.
export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { "/admin/api": "http://localhost:3000", "/uploads": "http://localhost:3000" },
  },
});
