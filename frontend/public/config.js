/* 运行时配置占位文件。
 * 容器启动时若设置了 API_BASE_URL，docker/40-runtime-config.sh 会覆盖本文件；
 * 本地开发可留空，前端将回退到构建期 VITE_API_BASE_URL 或同源 /api。
 */
window.__APP_CONFIG__ = {};
