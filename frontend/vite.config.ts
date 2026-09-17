import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 期望固定端口；产物供 src-tauri/tauri.conf.json 的 frontendDist 收集
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    // 显式绑 IPv4：Tauri CLI 的 devUrl 健康检查走 127.0.0.1，
    // 默认可能只监听 IPv6 [::1] 导致 CLI 一直等待
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
  define: {
    // Crepe 内嵌 Vue 运行时的 tree-shaking 标记
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
  },
});
