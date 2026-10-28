/**
 * 后端地址解析顺序：
 * 1. 运行时配置 window.__APP_CONFIG__.apiBaseUrl（容器启动脚本按环境变量写入）；
 * 2. 构建期变量 VITE_API_BASE_URL；
 * 3. 同源相对路径 /api（由 Nginx / Vite 反向代理转发到 api 服务）。
 *
 * 前两种适合前后端不同源或地址需要外部化的场景，第三种适合容器内统一入口。
 */
function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') {
    return '/api';
  }
  return trimmed.replace(/\/+$/, '');
}

const runtimeConfig = typeof window === 'undefined' ? undefined : window.__APP_CONFIG__;

export const apiBaseUrl = normalizeBaseUrl(
  runtimeConfig?.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL,
);
