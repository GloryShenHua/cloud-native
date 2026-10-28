#!/bin/sh
set -eu

html_root="${HTML_ROOT:-/usr/share/nginx/html}"
api_base_url="${API_BASE_URL:-/api}"

# URL 中的引号、反斜杠和控制字符会破坏生成的 JavaScript，启动时直接报告配置错误。
if [ "$(printf '%s' "$api_base_url" | LC_ALL=C tr -d '[:cntrl:]"\\')" != "$api_base_url" ]; then
    echo '[frontend] API_BASE_URL contains invalid URL characters' >&2
    exit 1
fi

cat > "${html_root}/config.js" <<EOF
window.__APP_CONFIG__ = { apiBaseUrl: "${api_base_url}" };
EOF

echo "[frontend] runtime config written: apiBaseUrl=${api_base_url}"
