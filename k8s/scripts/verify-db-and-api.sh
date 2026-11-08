#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
NAMESPACE="venue-booking"

echo "=== 1. 检查 Kubernetes 集群环境 ==="
kubectl version
kubectl get nodes -o wide
kubectl get storageclass

echo ""
echo "=== 2. 创建 Namespace、ConfigMap 与 Secret ==="
kubectl apply -f "${K8S_DIR}/00-namespace.yaml"
kubectl apply -f "${K8S_DIR}/01-configmap.yaml"

if [[ -z "$(kubectl -n "${NAMESPACE}" get secret booking-secret --ignore-not-found -o name)" ]]; then
  if [[ -f "${K8S_DIR}/02-secret.yaml" ]]; then
    kubectl create -f "${K8S_DIR}/02-secret.yaml"
  else
    { printf 'DB_USERNAME=venue_app\nDB_PASSWORD='; openssl rand -hex 24; } |
      kubectl -n "${NAMESPACE}" create secret generic booking-secret --from-env-file=/dev/stdin
  fi
fi

echo ""
echo "=== 3. 部署 PostgreSQL StatefulSet + PVC + 内部 Service ==="
kubectl apply -f "${K8S_DIR}/10-database.yaml"
kubectl rollout status statefulset/database -n "${NAMESPACE}" --timeout=120s
kubectl get statefulset,pod,pvc,svc -l app=database -n "${NAMESPACE}" -o wide

echo ""
echo "=== 4. 部署 API Deployment (2 副本) + ClusterIP Service ==="
kubectl apply -f "${K8S_DIR}/20-api.yaml"
kubectl rollout status deployment/api -n "${NAMESPACE}" --timeout=120s
kubectl get deployment,pod,svc -l app=api -n "${NAMESPACE}" -o wide
kubectl get endpointslice -l kubernetes.io/service-name=api -n "${NAMESPACE}"

RUN_TAG="lab2-$(date +%s)-$$"
CLIENT="client-${RUN_TAG}"
kubectl -n "${NAMESPACE}" run "${CLIENT}" --restart=Never --image=postgres:17-alpine --command -- sleep 600
trap 'kubectl -n "${NAMESPACE}" delete pod "${CLIENT}" --ignore-not-found --wait=false >/dev/null' EXIT
kubectl -n "${NAMESPACE}" wait --for=condition=Ready "pod/${CLIENT}" --timeout=90s
client() { kubectl -n "${NAMESPACE}" exec "${CLIENT}" -- "$@"; }

echo ""
echo "=== 5. 验证数据库 Pod 重建后的数据持久化 (StatefulSet + PVC) ==="
POD_UID=$(kubectl -n "${NAMESPACE}" get pod database-0 -o jsonpath='{.metadata.uid}')
PVC_UID=$(kubectl -n "${NAMESPACE}" get pvc database-data-database-0 -o jsonpath='{.metadata.uid}')

echo "[5.1] 创建一条测试场地与预约记录..."
VENUE_JSON=$(client wget -q -T 10 -O - --header='Content-Type: application/json' \
  --post-data='{"name":"K8s验收专用会议室","location":"云原生实验楼 301","capacity":30,"openingTime":"08:00:00","closingTime":"22:00:00","status":"OPEN"}' \
  http://api:8080/api/venues)
VENUE_ID=$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["id"])' <<<"${VENUE_JSON}")
CREATED_JSON=$(client wget -q -T 10 -O - --header='Content-Type: application/json' \
  --post-data="{\"venueId\":${VENUE_ID},\"organizer\":\"K8s验收\",\"reservationDate\":\"2026-11-15\",\"startTime\":\"09:00:00\",\"endTime\":\"11:00:00\",\"purpose\":\"验证数据库持久化\"}" \
  http://api:8080/api/reservations)
echo "创建响应: ${CREATED_JSON}"
RES_ID=$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["id"])' <<<"${CREATED_JSON}")
echo "记录场地编号: venueId=${VENUE_ID}, 预约编号: id=${RES_ID}"

echo "[5.2] 删除数据库 Pod (database-0) 触发 StatefulSet 自动重建..."
kubectl delete pod database-0 -n "${NAMESPACE}"
kubectl wait --for=create pod/database-0 -n "${NAMESPACE}" --timeout=120s
kubectl rollout status statefulset/database -n "${NAMESPACE}" --timeout=120s
kubectl get pod database-0 -n "${NAMESPACE}" -o wide
kubectl get pvc -n "${NAMESPACE}"
NEW_POD_UID=$(kubectl -n "${NAMESPACE}" get pod database-0 -o jsonpath='{.metadata.uid}')
NEW_PVC_UID=$(kubectl -n "${NAMESPACE}" get pvc database-data-database-0 -o jsonpath='{.metadata.uid}')
if [[ "${NEW_POD_UID}" == "${POD_UID}" || "${NEW_PVC_UID}" != "${PVC_UID}" ]]; then
  echo '数据库 Pod 或 PVC 的 UID 不符合重建预期' >&2
  exit 1
fi
echo "Pod UID: ${POD_UID} -> ${NEW_POD_UID}; PVC UID: ${PVC_UID}"
client pg_isready -h database-0.database-headless -t 5
kubectl rollout status deployment/api -n "${NAMESPACE}" --timeout=120s

echo "[5.3] 重新查询预约 id=${RES_ID}，验证数据持久化..."
AFTER_JSON=$(client wget -q -T 10 -O - "http://api:8080/api/reservations/${RES_ID}")
echo "重建后查询响应: ${AFTER_JSON}"
if [[ "${AFTER_JSON}" != "${CREATED_JSON}" ]]; then
  echo '数据库 Pod 重建前后的预约记录不一致' >&2
  exit 1
fi

echo ""
echo "=== 6. 验证 API 多副本负载均衡与并发压测 (Service -> 2 API Pods) ==="
echo "[6.1] 顺序短连接请求验证 (20 次请求，批次标识 ${RUN_TAG})..."
client sh -ec '
  for i in $(seq 1 20); do
    wget -q -T 10 -O /dev/null --header="Connection: close" "http://api:8080/api/venues?batch=$1&req=$i"
  done
' sh "${RUN_TAG}"

echo "[6.2] 并发预约冲突压测 (10 个并发客户端同时向同一场地、同一时段发起 POST /api/reservations)..."
PAYLOAD="{\"venueId\":${VENUE_ID},\"organizer\":\"并发压测\",\"reservationDate\":\"2026-12-01\",\"startTime\":\"14:00:00\",\"endTime\":\"16:00:00\",\"purpose\":\"双副本并发冲突压测\"}"
STATUSES=$(client sh -c '
  for i in $(seq 1 10); do
    wget -S -T 10 -O /dev/null --header="Content-Type: application/json" --header="Connection: close" \
      --post-data="$2" "http://api:8080/api/reservations?batch=$1&req=$i" 2>&1 |
      awk '\''$1 ~ /^HTTP\// { print $2; exit }'\'' &
  done
  wait
' sh "${RUN_TAG}" "${PAYLOAD}")
echo '并发 HTTP 状态计数：'
printf '%s\n' "${STATUSES}" | sort | uniq -c
if ! awk '$0 == "201" {created++} $0 == "409" {conflicts++}
          END {exit !(NR == 10 && created == 1 && conflicts == 9)}' <<<"${STATUSES}"; then
  echo '预期 1 个 201 和 9 个 409' >&2
  exit 1
fi

API_LOGS=$(kubectl logs -l app=api -n "${NAMESPACE}" --tail=-1)
QUERY_HITS=$(grep -F "GET \"/api/venues?batch=${RUN_TAG}&req=" <<<"${API_LOGS}" | grep -o '\[pod=api-[^]]*\]')
BOOKING_HITS=$(grep -F "POST \"/api/reservations?batch=${RUN_TAG}&req=" <<<"${API_LOGS}" | grep -o '\[pod=api-[^]]*\]')
echo '本批 20 次查询的 API Pod 命中数：'
sort <<<"${QUERY_HITS}" | uniq -c
echo '本批 10 次并发预约的 API Pod 命中数：'
sort <<<"${BOOKING_HITS}" | uniq -c
if [[ $(wc -l <<<"${QUERY_HITS}") -ne 20 || $(sort -u <<<"${QUERY_HITS}" | wc -l) -lt 2 ||
      $(wc -l <<<"${BOOKING_HITS}") -ne 10 ]]; then
  echo 'API 日志未证明两个副本均处理过本批查询，或本批命中总数不匹配' >&2
  exit 1
fi
echo 'PASS 数据库重建、PVC 保留、API 多副本与并发冲突'
