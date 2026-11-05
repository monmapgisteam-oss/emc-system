import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(["/api", "/uuliin-tsul", "/_next", "/data", "/logo.svg"].map((path) => [path, "http://127.0.0.1:8000"])),
  },
});
