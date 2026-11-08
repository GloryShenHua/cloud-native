#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
NAMESPACE="${NAMESPACE:-venue-booking}"
NODE_PORT="${NODE_PORT:-30080}"
PF_PORT="${PF_PORT:-${NODE_PORT}}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${NODE_PORT}}"
PF_PID=""
PF_LOG=""

cleanup() {
  if [[ -n "${PF_PID}" ]]; then
    kill "${PF_PID}" 2>/dev/null || true
    wait "${PF_PID}" 2>/dev/null || true
  fi
  if [[ -n "${PF_LOG}" ]]; then
    rm -f "${PF_LOG}"
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
  echo "[info] NodePort ${NODE_PORT} 不可直接访问，改用 kubectl port-forward ${PF_PORT}:80"
  PF_LOG=$(mktemp)
  kubectl -n "${NAMESPACE}" port-forward --address 127.0.0.1 service/frontend "${PF_PORT}:80" >"${PF_LOG}" 2>&1 &
  PF_PID=$!
  BASE_URL="http://127.0.0.1:${PF_PORT}"
  i=0
  until curl -fsS --max-time 2 "${BASE_URL}/healthz" >/dev/null 2>&1; do
    i=$((i + 1))
    if [[ "${i}" -ge 30 ]] || ! kill -0 "${PF_PID}" 2>/dev/null; then
      echo "[error] port-forward 启动超时，日志：" >&2
      cat "${PF_LOG}" >&2
      exit 1
    fi
    sleep 1
  done
fi

HEALTH=$(curl -fsS --max-time 10 "${BASE_URL}/healthz")
CONFIG=$(curl -fsS --max-time 10 "${BASE_URL}/config.js")
HTML=$(curl -fsS --max-time 10 "${BASE_URL}/")
echo "GET ${BASE_URL}/healthz -> ${HEALTH}"
echo "GET ${BASE_URL}/config.js -> ${CONFIG}"
if [[ "${HEALTH}" == "ok" && "${CONFIG}" == *'apiBaseUrl: "/api"'* && "${HTML}" == *'id="root"'* ]]; then
  echo "SPA index.html OK"
else
  echo "[error] 首页未返回包含 id=\"root\" 的 SPA HTML" >&2
  exit 1
fi
echo "经 ${BASE_URL} 验证场地列表和详情、创建场地、预约、冲突、查询与取消："
python3 "${K8S_DIR}/../backend/scripts/smoke.py" --url "${BASE_URL}" --via-frontend

echo ""
echo "=== 5. 验证 DaemonSet 覆盖所有可调度节点 ==="
DESIRED="$(kubectl -n "${NAMESPACE}" get daemonset node-api-healthcheck -o jsonpath='{.status.desiredNumberScheduled}')"
READY="$(kubectl -n "${NAMESPACE}" get daemonset node-api-healthcheck -o jsonpath='{.status.numberReady}')"
NODE_COUNT="$(kubectl get nodes --no-headers | wc -l | tr -d ' ')"
echo "desiredNumberScheduled=${DESIRED} numberReady=${READY} 集群节点数=${NODE_COUNT}"
if [[ "${DESIRED}" -lt 1 || "${DESIRED}" != "${READY}" ]]; then
  echo "[error] DaemonSet 未全部就绪：desired=${DESIRED}, ready=${READY}" >&2
  exit 1
fi
PODS=$(kubectl -n "${NAMESPACE}" get pods -l app=node-api-healthcheck --no-headers \
  -o 'custom-columns=POD:.metadata.name,NODE:.spec.nodeName,DELETING:.metadata.deletionTimestamp' |
  awk '$2 != "<none>" && $3 == "<none>" {print $1, $2}')
if [[ $(wc -l <<<"${PODS}") -ne "${DESIRED}" || $(awk '{print $2}' <<<"${PODS}" | sort -u | wc -l) -ne "${DESIRED}" ]]; then
  echo '巡检 Pod 未按每个符合条件的节点一个副本分布' >&2
  exit 1
fi

echo ""
echo "=== 6. 巡检日志（每个节点一个 Pod，输出节点名与 API 状态）==="
while read -r POD NODE; do
  for ((ATTEMPT=1; ATTEMPT<=16; ATTEMPT++)); do
    LOGS=$(kubectl -n "${NAMESPACE}" logs "${POD}" --tail=10 --prefix)
    if awk '/ status=(UP|DOWN)$/ {status=$NF} END {exit status != "status=UP"}' <<<"${LOGS}"; then
      break
    fi
    sleep 2
  done
  printf '%s\n' "${LOGS}"
  if [[ "${ATTEMPT}" -gt 16 ]]; then
    echo "节点 ${NODE} 上的巡检未检测到 API UP" >&2
    exit 1
  fi
done <<<"${PODS}"

echo ""
echo "=== 验收结论 ==="
echo "PASS 前端同源代理完整业务流程，${READY} 个符合条件的节点各有一个巡检 Pod，API 状态为 UP"
