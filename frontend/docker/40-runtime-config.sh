#!/bin/sh
# 在前端容器启动时把环境变量写成浏览器可读的运行时配置，
# 这样更换后端地址只需重启容器，不必重新构建镜像。
set -eu

html_root="${HTML_ROOT:-/usr/share/nginx/html}"
api_base_url="${API_BASE_URL:-/api}"

cat > "${html_root}/config.js" <<EOF
window.__APP_CONFIG__ = { apiBaseUrl: "${api_base_url}" };
EOF

echo "[frontend] runtime config written: apiBaseUrl=${api_base_url}"
