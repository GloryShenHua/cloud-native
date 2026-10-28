set -eu

html_root="${HTML_ROOT:-/usr/share/nginx/html}"
api_base_url="${API_BASE_URL:-/api}"

cat > "${html_root}/config.js" <<EOF
window.__APP_CONFIG__ = { apiBaseUrl: "${api_base_url}" };
EOF

echo "[frontend] runtime config written: apiBaseUrl=${api_base_url}"
