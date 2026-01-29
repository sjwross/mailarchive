import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// Vite config for the mailarchive web UI
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            const auth = (req as { headers?: { authorization?: string } }).headers?.authorization;
            if (auth) proxyReq.setHeader("Authorization", auth);
          });
        },
      },
    }
  }
});

