# 场地预约系统 · Kubernetes 工作负载编排（Lab 2）

本目录包含场地预约系统迁移至 Kubernetes 的资源清单与自动化验证脚本，当前已完成**集群环境配置、配置外部化（ConfigMap / Secret）、PostgreSQL 有状态工作负载（StatefulSet + PVC + 内部 Service）以及后端 API 无状态多副本编排（Deployment 2 副本 + ClusterIP Service）**。

---

## 一、环境要求与本地镜像说明

### 1.1 实验集群环境

- **Kubernetes 发行版**：Colima 内置 K3s（`v1.35.0+k3s1`）或 `kind` / `minikube` / Docker Desktop Kubernetes。
- **节点与存储**：单节点控制平面兼工作节点（`colima`），默认动态存储类为 `local-path`（`rancher.io/local-path`，`WaitForFirstConsumer`）。
- **镜像导入方式**：
  - 使用 Colima（Docker 运行时）或 Docker Desktop K8s 时，K8s 与本机 Docker 共享本地镜像存储，只需在仓库根目录构建镜像，清单中配置 `imagePullPolicy: IfNotPresent` 即可直接使用：
    ```bash
    docker build -t cloud-native-lab1-api:1.0.0 ./backend
    docker build -t cloud-native-lab1-frontend:1.0.0 ./frontend
    ```
  - 若使用 `kind` 集群，构建后执行 `kind load docker-image cloud-native-lab1-api:1.0.0` 导入节点。

---

## 二、目录结构与资源划分

所有资源统一部署在独立命名空间 `venue-booking` 中，按序号拆分文件以便小组成员协作：

```text
k8s/
├── 00-namespace.yaml        # 施钧凯：命名空间 venue-booking
├── 01-configmap.yaml        # 施钧凯：非敏感配置 booking-config（DB_URL、端口、CORS、Web请求日志格式）
├── 02-secret.example.yaml   # 施钧凯：敏感凭据模板 booking-secret（DB_USERNAME、DB_PASSWORD 示例值）
├── 10-database.yaml         # 施钧凯：PostgreSQL StatefulSet (1副本) + volumeClaimTemplates (1Gi PVC) + ClusterIP Service
├── 20-api.yaml              # 施钧凯：后端 API Deployment (2副本) + ClusterIP Service
├── scripts/
│   └── verify-db-and-api.sh # 施钧凯：一键部署、StatefulSet Pod重建持久化验证与API双副本并发压测脚本
└── README.md                # 本说明文档與团队对接契约
```

> **安全说明**：真实的 `k8s/02-secret.yaml` 已加入根目录 `.gitignore`，不会提交到 Git 仓库。首次运行前请复制 `cp k8s/02-secret.example.yaml k8s/02-secret.yaml` 或直接运行 `k8s/scripts/verify-db-and-api.sh` 自动生成。

---

## 三、快速部署与验收命令

### 3.1 手动分步部署

```bash
# 1. 创建命名空间与配置
cp -n k8s/02-secret.example.yaml k8s/02-secret.yaml
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/01-configmap.yaml
kubectl apply -f k8s/02-secret.yaml

# 2. 部署数据库 StatefulSet 与内部 Service
kubectl apply -f k8s/10-database.yaml
kubectl rollout status statefulset/database -n venue-booking

# 3. 部署后端 API 双副本 Deployment 与 Service
kubectl apply -f k8s/20-api.yaml
kubectl rollout status deployment/api -n venue-booking

# 4. 查看命名空间下所有资源状态
kubectl get all,pvc,cm,secret -n venue-booking -o wide
```

### 3.2 一键执行持久化验证与双副本负载均衡压测

```bash
./k8s/scripts/verify-db-and-api.sh
```

该脚本自动完成以下三项核心验收：
1. **StatefulSet + PVC 重建持久化验证**：创建测试场地与预约记录 $\rightarrow$ 执行 `kubectl delete pod database-0 -n venue-booking` 销毁数据库 Pod $\rightarrow$ 等待 `database-0` 重新挂载原有 PVC `database-data-database-0` 就绪 $\rightarrow$ 再次查询确认原预约记录完整保留。
2. **API 双副本顺序请求分流验证**：通过 `http://api:8080/api/venues` 连续发起 20 次短连接请求，统计两个 API Pod 日志中的 `[pod=api-...]` 实例标识命中次数。
3. **API 双副本并发冲突压测**：同时启动 10 个并发客户端对同一场地、同一日期时段发起 `POST /api/reservations`，验证请求被分发到两个 API Pod 处理，且依托 PostgreSQL 行锁仅 1 个请求返回 `201 Created`、其余 9 个返回 `409 Conflict`。

---

## 四、团队后续模块对接契约（供前端/DaemonSet 与 Job/CronJob 复用）

集群内已提供稳定的服务发现与外部化配置，队友无需重复创建数据库或修改已有配置：

| 对接方 | 可直接复用的集群资源 | 连接/引用方式说明 |
|---|---|---|
| **刘和鑫（前端 Deployment/Service + 巡检 DaemonSet）** | 命名空间：`venue-booking`<br/>后端 Service：`api:8080` | 1. 前端 `Deployment` 环境变量配置 `API_UPSTREAM: "api:8080"`、`API_BASE_URL: "/api"`，通过 Nginx 反向代理访问后端。<br/>2. 节点巡检 `DaemonSet` 在 `venue-booking` 命名空间内定期请求 `http://api:8080/actuator/health` 并输出节点名（`spec.nodeName`）与状态。 |
| **徐润杰（场地利用率报告 Job + CronJob）** | 命名空间：`venue-booking`<br/>数据库 Service：`database:5432`<br/>ConfigMap：`booking-config`<br/>Secret：`booking-secret` | `Job` 与 `CronJob` 的 Pod 模板可直接通过 `envFrom` 或 `valueFrom` 引用 `booking-config`（含 `DB_HOST=database`、`DB_PORT=5432`、`DB_NAME=venue_booking`、`DB_URL`）和 `booking-secret`（含 `DB_USERNAME`、`DB_PASSWORD`），直接读写 PostgreSQL。 |
