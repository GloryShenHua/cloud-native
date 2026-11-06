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

if [[ ! -f "${K8S_DIR}/02-secret.yaml" ]]; then
  cp "${K8S_DIR}/02-secret.example.yaml" "${K8S_DIR}/02-secret.yaml"
  echo "[info] 已从 02-secret.example.yaml 生成本地 02-secret.yaml（已加入 .gitignore）"
fi
kubectl apply -f "${K8S_DIR}/02-secret.yaml"

echo ""
echo "=== 3. 部署 PostgreSQL StatefulSet + PVC + 内部 Service ==="
kubectl apply -f "${K8S_DIR}/10-database.yaml"
kubectl rollout status statefulset/database -n "${NAMESPACE}" --timeout=120s
kubectl get statefulset,pod,pvc,svc -l app=database -n "${NAMESPACE}" -o wide

echo ""
echo "=== 4. 部署 API Deployment (2 副本) + ClusterIP Service ==="
kubectl apply -f "${K8S_DIR}/20-api.yaml"
kubectl rollout status deployment/api -n "${NAMESPACE}" --timeout=120s
kubectl get deployment,pod,svc,endpoints -l app=api -n "${NAMESPACE}" -o wide

echo ""
echo "=== 5. 验证数据库 Pod 重建后的数据持久化 (StatefulSet + PVC) ==="
kubectl port-forward -n "${NAMESPACE}" svc/api 18080:8080 >/tmp/k8s_api_pf.log 2>&1 &
PF_PID=$!
trap 'kill ${PF_PID} 2>/dev/null || true' EXIT
sleep 2

echo "[5.1] 创建一条测试场地与预约记录..."
VENUE_JSON=$(curl -fsS -X POST http://127.0.0.1:18080/api/venues \
  -H "Content-Type: application/json" \
  -d '{"name":"K8s验收专用会议室","location":"云原生实验楼 301","capacity":30,"openingTime":"08:00:00","closingTime":"22:00:00","status":"OPEN"}')
VENUE_ID=$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["id"])' <<<"${VENUE_JSON}")
CREATED_JSON=$(curl -fsS -X POST http://127.0.0.1:18080/api/reservations \
  -H "Content-Type: application/json" \
  -d "{\"venueId\":${VENUE_ID},\"organizer\":\"施钧凯-K8s验收\",\"reservationDate\":\"2026-11-15\",\"startTime\":\"09:00:00\",\"endTime\":\"11:00:00\",\"purpose\":\"StatefulSet+PVC重建持久化验证\"}")
echo "创建响应: ${CREATED_JSON}"
RES_ID=$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["id"])' <<<"${CREATED_JSON}")
echo "记录场地编号: venueId=${VENUE_ID}, 预约编号: id=${RES_ID}"

echo "[5.2] 删除数据库 Pod (database-0) 触发 StatefulSet 自动重建..."
kubectl delete pod database-0 -n "${NAMESPACE}"
kubectl rollout status statefulset/database -n "${NAMESPACE}" --timeout=120s
kubectl get pod database-0 -n "${NAMESPACE}" -o wide
kubectl get pvc -n "${NAMESPACE}"

echo "[5.3] 重新查询预约 id=${RES_ID}，验证数据持久化..."
AFTER_JSON=$(curl -fsS "http://127.0.0.1:18080/api/reservations/${RES_ID}")
echo "重建后查询响应: ${AFTER_JSON}"

kill "${PF_PID}" 2>/dev/null || true
wait "${PF_PID}" 2>/dev/null || true

echo ""
echo "=== 6. 验证 API 多副本负载均衡与并发压测 (Service -> 2 API Pods) ==="
RUN_TAG="run-$(date +%s)"
echo "[6.1] 顺序短连接请求验证 (20 次请求，批次标识 ${RUN_TAG})..."
kubectl run lb-bench --rm -i --restart=Never --image=postgres:17-alpine -n "${NAMESPACE}" -- \
  /bin/sh -c "for i in \$(seq 1 20); do wget -q -O /dev/null --header='Connection: close' 'http://api:8080/api/venues?batch=${RUN_TAG}&req='\${i}; done"

echo "[6.2] 并发预约冲突压测 (10 个并发客户端同时向同一场地、同一时段发起 POST /api/reservations)..."
CONC_DATE="2026-12-01"
kubectl run conc-bench --rm -i --restart=Never --image=postgres:17-alpine -n "${NAMESPACE}" -- \
  /bin/sh -c "for i in \$(seq 1 10); do (wget -S -O - --header='Content-Type: application/json' --header='Connection: close' --post-data='{\"venueId\":${VENUE_ID},\"organizer\":\"并发压测-'\"\${i}\"'\",\"reservationDate\":\"${CONC_DATE}\",\"startTime\":\"14:00:00\",\"endTime\":\"16:00:00\",\"purpose\":\"双副本并发冲突压测\"}' http://api:8080/api/reservations 2>&1 | grep -E 'HTTP/|RESERVATION_CONFLICT|\"id\":' | tr '\n' ' '; echo '') & done; wait"

sleep 2
echo "--- 两个 API Pod 处理业务请求 (/api/venues?batch=${RUN_TAG}) 的日志明细 ---"
kubectl logs -l app=api -n "${NAMESPACE}" --tail=-1 | grep "GET \"/api/venues?batch=${RUN_TAG}"
echo "--- 两个 API Pod 命中次数汇总 (/api/venues) ---"
kubectl logs -l app=api -n "${NAMESPACE}" --tail=-1 | grep "GET \"/api/venues?batch=${RUN_TAG}" | grep -o '\[pod=api-[^]]*\]' | sort | uniq -c
echo "--- 两个 API Pod 处理并发预约 (POST /api/reservations) 的命中次数汇总 ---"
kubectl logs -l app=api -n "${NAMESPACE}" --tail=-1 | grep 'POST "/api/reservations"' | grep -o '\[pod=api-[^]]*\]' | sort | uniq -c
