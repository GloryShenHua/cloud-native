import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// 开发与预览统一走同源 /api：由 Vite 反向代理到后端，浏览器侧不产生跨域请求。
// 代理目标可用 VITE_API_PROXY_TARGET 覆盖，默认指向本地后端 Compose 暴露的 127.0.0.1:8080。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const target = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8080';
  const proxy = {
    '/api': {
      target,
      changeOrigin: false,
    },
  };

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      proxy,
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: false,
    },
  };
});
