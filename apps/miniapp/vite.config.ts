import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Mini App отдаётся сервером по пути /app/. В dev-режиме API проксируется на :3000.
export default defineConfig({
  base: "/app/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000", "/uploads": "http://localhost:3000" },
  },
});
