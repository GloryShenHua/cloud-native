# 场地预约系统 · Kubernetes 工作负载编排（Lab 2）

本目录包含场地预约系统的 Kubernetes 清单与验证脚本，包括 PostgreSQL StatefulSet、API 和前端 Deployment、场地利用率报告 Job 与 CronJob、节点巡检 DaemonSet，以及配套的 Service、ConfigMap、Secret 和 PVC。

---

## 一、环境要求与本地镜像说明

### 1.1 实验集群环境

- **Kubernetes 发行版**：Colima 内置 K3s（`v1.35.0+k3s1`）或 `kind` / `minikube` / Docker Desktop Kubernetes。
- **节点与存储**：需要默认可动态供给 PVC 的 StorageClass。Colima 实验使用 `local-path`，kind 复验使用 `standard`。两者的供给器均为 `rancher.io/local-path`，绑定模式为 `WaitForFirstConsumer`。
- **验收工具**：Bash、`kubectl`、`curl`、Python 3，以及首次生成测试凭据所需的 OpenSSL。复验使用 `kubectl v1.36.1`。

从仓库根目录构建与集群节点架构匹配的镜像。

```bash
docker build --provenance=false -t cloud-native-lab1-api:1.0.0 ./backend
docker build --provenance=false -t cloud-native-lab1-frontend:1.0.0 ./frontend
```

Colima 使用 Docker 运行时时，清单通过 `imagePullPolicy: IfNotPresent` 使用本机镜像。独立 kind 集群可用 `kind load docker-image --name <集群名> cloud-native-lab1-api:1.0.0 cloud-native-lab1-frontend:1.0.0` 导入。双节点复验使用 `docker image save --platform linux/arm64` 保存镜像后，用 `kind load image-archive --name <集群名> <镜像归档>` 导入。Docker Desktop 内置 kind 模式使用独立的 containerd 镜像存储，需先导入镜像到节点或使用节点可访问的镜像仓库。部署前用 `kubectl config current-context` 和 `kubectl get storageclass` 确认目标环境。

---

## 二、目录结构与资源划分

所有资源统一部署在独立命名空间 `venue-booking` 中，按序号拆分文件以便小组成员协作：

```text
k8s/
├── 00-namespace.yaml        # 施钧凯：命名空间 venue-booking
├── 01-configmap.yaml        # 施钧凯：非敏感配置 booking-config（DB_URL、端口、CORS、Web请求日志格式）
├── 02-secret.example.yaml   # 施钧凯：敏感凭据模板 booking-secret（DB_USERNAME、DB_PASSWORD 示例值）
├── 10-database.yaml         # 施钧凯：PostgreSQL StatefulSet、1Gi PVC、ClusterIP 与 Headless Service
├── 20-api.yaml              # 施钧凯：后端 API Deployment (2副本) + ClusterIP Service
├── 30-frontend.yaml         # 刘和鑫：前端 Deployment (2副本) + NodePort Service (30080)
├── 40-daemonset.yaml        # 刘和鑫：节点巡检 DaemonSet node-api-healthcheck
├── 50-venue-usage-report.yaml # 徐润杰：场地利用率报告 CronJob 和共享 Job 模板
├── report/venue-usage.sql   # 汇总指定日期范围内有效预约，保存报告结果
├── scripts/
│   ├── verify-db-and-api.sh # 施钧凯：一键部署、StatefulSet Pod重建持久化验证与API双副本并发压测脚本
│   ├── run-venue-usage-report.sh # 徐润杰：从模板创建独立的一次性报告 Job
│   ├── verify-frontend-daemonset.sh # 刘和鑫：前端业务流程与 DaemonSet 验收
│   └── verify-venue-usage-report.sh # 徐润杰：手动、失败、重试和定时报告验收
└── README.md                # 本说明文档与团队对接契约
```

`k8s/02-secret.example.yaml` 只提供示例值。若需自定义凭据，将模板复制到 Git 忽略的 `k8s/02-secret.yaml`，替换示例值后用于首次部署。验收脚本可直接在实验集群生成随机测试凭据。

---

## 三、快速部署与验收命令

### 3.1 手动分步部署

```bash
# 1. 创建命名空间与配置
kubectl apply -f k8s/00-namespace.yaml -f k8s/01-configmap.yaml
# 仅首次创建 Secret。已有 booking-secret 时复用原凭据。
if [ -z "$(kubectl -n venue-booking get secret booking-secret --ignore-not-found -o name)" ]; then
  if [ -f k8s/02-secret.yaml ]; then
    kubectl create -f k8s/02-secret.yaml
  else
    { printf 'DB_USERNAME=venue_app\nDB_PASSWORD='; openssl rand -hex 24; } |
      kubectl -n venue-booking create secret generic booking-secret --from-env-file=/dev/stdin
  fi
fi

# 2. 部署数据库 StatefulSet 与内部 Service
kubectl apply -f k8s/10-database.yaml
kubectl rollout status statefulset/database -n venue-booking

# 3. 部署后端 API 双副本 Deployment 与 Service
kubectl apply -f k8s/20-api.yaml
kubectl rollout status deployment/api -n venue-booking

# 4. 部署前端双副本 Deployment、NodePort Service 与节点巡检 DaemonSet
kubectl apply -f k8s/30-frontend.yaml
kubectl apply -f k8s/40-daemonset.yaml
kubectl rollout status deployment/frontend -n venue-booking
kubectl rollout status daemonset/node-api-healthcheck -n venue-booking

# 5. API 就绪后部署报告 SQL 与每日 CronJob
kubectl -n venue-booking create configmap venue-usage-report-sql \
  --from-file=k8s/report/venue-usage.sql --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f k8s/50-venue-usage-report.yaml

# 6. 查看命名空间下所有资源状态
kubectl get all,pvc,cm,secret -n venue-booking -o wide
```

浏览器使用可达的节点地址与端口 `30080` 访问前端。若集群没有映射 NodePort，可执行 `kubectl port-forward -n venue-booking svc/frontend 30080:80`，再访问 <http://localhost:30080>。

#### 从旧版 Lab 2 升级

如果现有 `statefulset/database` 的 `spec.serviceName` 为 `database`，步骤 2 需要先重建 StatefulSet，因为该字段不可直接修改。选择可以暂停数据库访问的时段执行以下命令。原清单采用默认 PVC 保留策略，重建时继续使用原 PVC `database-data-database-0` 和 ClusterIP Service `database`。

```bash
kubectl -n venue-booking scale statefulset/database --replicas=0
kubectl -n venue-booking wait --for=delete pod/database-0 --timeout=120s
kubectl -n venue-booking delete statefulset database
kubectl apply -f k8s/10-database.yaml
kubectl -n venue-booking rollout status statefulset/database --timeout=120s
```

步骤 3 和 4 使用当前源码构建的镜像。如果同名 Deployment 已运行且沿用原镜像标签，导入新镜像后分别执行 `kubectl -n venue-booking rollout restart deployment/api` 或 `kubectl -n venue-booking rollout restart deployment/frontend` 并等待就绪。API 启动时由 Flyway 执行 V3，创建报告结果表。随后可执行步骤 5。

### 3.2 一键执行持久化验证与双副本负载均衡压测

```bash
./k8s/scripts/verify-db-and-api.sh
```

脚本会创建测试记录并重建数据库 Pod，请在实验集群运行。它会校验新旧 Pod UID 不同、PVC UID 相同、Pod 稳定 DNS 可用，并逐字段比较重建前后的预约。随后通过 `api:8080` 发出 20 次短连接查询，校验两份 Pod 日志均有本批请求。10 个同场地同时段的并发预约须返回 1 个 `201` 和 9 个 `409`，日志按批次归集。

### 3.3 前端与节点巡检一键验收

```bash
./k8s/scripts/verify-frontend-daemonset.sh
```

脚本检查前端页面与同源 `/api` 代理，并携带浏览器 `Origin` 跑完场地列表和详情、创建场地、预约冲突、查询及取消。NodePort 不可达时会改用本地端口转发。DaemonSet 验收要求至少有一个符合条件的节点，各节点恰好有一个就绪巡检 Pod，且日志显示 API 状态为 `UP`。

### 3.4 场地利用率报告

完成 §3.1 后，从仓库根目录指定起止日期运行一次性 Job。起止日期均包含在内。Job 名可自行指定，重复演示时使用新名称。

```bash
./k8s/scripts/run-venue-usage-report.sh venue-usage-report-demo 2026-11-01 2026-11-07
kubectl -n venue-booking wait --for=condition=complete job/venue-usage-report-demo --timeout=120s
kubectl -n venue-booking get job venue-usage-report-demo \
  -o 'custom-columns=JOB:.metadata.name,START:.status.startTime,END:.status.completionTime,CONDITIONS:.status.conditions[*].type'
kubectl -n venue-booking logs job/venue-usage-report-demo
```

按 Job 名从 PostgreSQL 查询结果。统计口径为当前有效预约（`ACTIVE`），时长以秒保存，零预约的场地也有一条统计记录。

```bash
kubectl -n venue-booking exec -i database-0 -- sh -c \
  'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' <<'SQL'
SELECT r.job_name, r.job_uid, r.start_date, r.end_date, r.generated_at,
       t.venue_id, t.venue_name, t.reservation_count, t.total_reserved_seconds
FROM venue_usage_reports r
LEFT JOIN LATERAL jsonb_to_recordset(r.venue_totals) AS t(
    venue_id bigint, venue_name text, reservation_count bigint, total_reserved_seconds bigint
) ON true
WHERE r.job_name = 'venue-usage-report-demo'
ORDER BY r.generated_at, t.venue_id;
SQL
```

CronJob 默认每天北京时间 02:00 统计前一自然日。用以下脚本在实验集群准备演示数据并验证手动任务、无效区间、同 UID 重试，以及控制器自动触发。脚本创建独立的每分钟 CronJob，完成后清理该调度器。

```bash
./k8s/scripts/verify-venue-usage-report.sh
```

任务失败时用 `kubectl -n venue-booking describe job JOB_NAME` 查看终态，用 `kubectl -n venue-booking logs -l batch.kubernetes.io/job-name=JOB_NAME --prefix` 查看各次尝试。调度通过 `concurrencyPolicy: Forbid` 避免同一 CronJob 的实例重叠。同一 Job 的 Pod 即使重试，也只会按 Job UID 保存一份结果。手动和定时 Job 各自保留报告快照。

---

## 四、团队模块对接契约（Job/CronJob 复用已有资源）

集群内已提供稳定的服务发现与外部化配置，队友无需重复创建数据库或修改已有配置：

| 对接方 | 可直接复用的集群资源 | 连接/引用方式说明 |
|---|---|---|
| **刘和鑫（前端 Deployment/Service + 巡检 DaemonSet）** | 命名空间 `venue-booking`<br/>后端 Service `api:8080` | 前端通过 Nginx 将同源 `/api` 代理到 API，浏览器通过节点端口 `30080` 或本地端口转发访问。节点巡检定期请求 `http://api:8080/actuator/health`，输出节点名和状态。 |
| **徐润杰（场地利用率报告 Job + CronJob）** | 命名空间：`venue-booking`<br/>数据库 Service：`database:5432`<br/>ConfigMap：`booking-config`<br/>Secret：`booking-secret` | `Job` 与 `CronJob` 的 Pod 模板可直接通过 `envFrom` 或 `valueFrom` 引用 `booking-config`（含 `DB_HOST=database`、`DB_PORT=5432`、`DB_NAME=venue_booking`、`DB_URL`）和 `booking-secret`（含 `DB_USERNAME`、`DB_PASSWORD`），直接读写 PostgreSQL。 |
