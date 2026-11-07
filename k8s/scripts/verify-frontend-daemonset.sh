#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
NAMESPACE="${NAMESPACE:-venue-booking}"
NODE_PORT="${NODE_PORT:-30080}"
PF_PORT="${PF_PORT:-${NODE_PORT}}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${NODE_PORT}}"
PF_PID=""

cleanup() {
  if [[ -n "${PF_PID}" ]]; then
    kill "${PF_PID}" 2>/dev/null || true
    wait "${PF_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "=== 1. 检查集群与前置资源 ==="
kubectl get nodes -o wide
kubectl -n "${NAMESPACE}" get deployment/api >/dev/null
kubectl -n "${NAMESPACE}" get service/api >/dev/null

echo ""
echo "=== 2. 部署前端 Deployment (2 副本) + NodePort Service ==="
kubectl apply -f "${K8S_DIR}/30-frontend.yaml"
kubectl -n "${NAMESPACE}" rollout status deployment/frontend --timeout=180s
kubectl -n "${NAMESPACE}" get deployment,pod,service -l app=frontend -o wide

echo ""
echo "=== 3. 部署节点巡检 DaemonSet ==="
kubectl apply -f "${K8S_DIR}/40-daemonset.yaml"
kubectl -n "${NAMESPACE}" rollout status daemonset/node-api-healthcheck --timeout=120s
kubectl -n "${NAMESPACE}" get daemonset node-api-healthcheck -o wide
kubectl -n "${NAMESPACE}" get pods -l app=node-api-healthcheck -o wide

echo ""
echo "=== 4. 验证前端页面与 /api 反向代理 ==="
if ! curl -fsS --max-time 5 "${BASE_URL}/healthz" >/dev/null 2>&1; then
  echo "[info] NodePort ${NODE_PORT} 不可直接访问，改用 kubectl port-forward ${PF_PORT}:80（保持与 CORS 白名单一致的 30080）"
  kubectl -n "${NAMESPACE}" port-forward service/frontend "${PF_PORT}:80" >/tmp/k8s_frontend_pf.log 2>&1 &
  PF_PID=$!
  BASE_URL="http://127.0.0.1:${PF_PORT}"
  i=0
  until curl -fsS --max-time 2 "${BASE_URL}/healthz" >/dev/null 2>&1; do
    i=$((i + 1))
    if [[ "${i}" -ge 30 ]]; then
      echo "[error] port-forward 启动超时，日志：" >&2
      cat /tmp/k8s_frontend_pf.log >&2 || true
      exit 1
    fi
    sleep 1
  done
fi

echo "GET ${BASE_URL}/healthz -> $(curl -fsS "${BASE_URL}/healthz")"
echo "GET ${BASE_URL}/config.js -> $(curl -fsS "${BASE_URL}/config.js")"
echo "GET ${BASE_URL}/api/venues?limit=2 ->"
curl -fsS "${BASE_URL}/api/venues?limit=2"
echo ""
if curl -fsS "${BASE_URL}/" | grep -q 'id="root"'; then
  echo "SPA index.html OK"
else
  echo "[error] 首页未返回包含 id=\"root\" 的 SPA HTML" >&2
  exit 1
fi

echo ""
echo "=== 5. 验证 DaemonSet 覆盖所有可调度节点 ==="
DESIRED="$(kubectl -n "${NAMESPACE}" get daemonset node-api-healthcheck -o jsonpath='{.status.desiredNumberScheduled}')"
READY="$(kubectl -n "${NAMESPACE}" get daemonset node-api-healthcheck -o jsonpath='{.status.numberReady}')"
NODE_COUNT="$(kubectl get nodes --no-headers | wc -l | tr -d ' ')"
echo "desiredNumberScheduled=${DESIRED} numberReady=${READY} 集群节点数=${NODE_COUNT}"
if [[ "${DESIRED}" != "${READY}" ]]; then
  echo "[error] DaemonSet 未全部就绪：desired=${DESIRED}, ready=${READY}" >&2
  exit 1
fi
if [[ "${DESIRED}" -lt "${NODE_COUNT}" ]]; then
  echo "[warn] 有节点被判定为不可调度，未运行巡检 Pod；请检查节点污点或 cordon 状态。"
fi

echo ""
echo "=== 6. 巡检日志（每个节点一个 Pod，输出节点名与 API 状态）==="
kubectl -n "${NAMESPACE}" logs -l app=node-api-healthcheck --tail=10 --prefix

echo ""
echo "=== 验收结论 ==="
echo "- 前端 Deployment 2 副本已就绪，Service frontend (NodePort ${NODE_PORT}) 已创建。"
echo "- 当前访问地址：${BASE_URL}（NodePort 不可达时脚本自动使用 port-forward）。"
echo "- 浏览器打开 ${BASE_URL} 可跑通场地/预约流程，/api 由 Nginx 代理到 api:8080。"
echo "- DaemonSet 在 ${READY} 个可调度节点上运行，巡检日志持续输出 status=UP/DOWN。"
