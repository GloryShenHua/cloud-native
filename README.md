# 场地预约系统（Cloud-Native Lab 1）

场地预约系统是一个基于三层架构（`frontend` → `api` → `database`）开发并完成 Docker 容器化与 Docker Compose 多容器编排的云原生实验项目（Lab 1）。

系统支持场地列表与详情查询、场地创建、预约创建、预约记录筛选与详情查询、预约取消，以及基于数据库事务与行级锁（`SELECT ... FOR UPDATE`）的预约时间冲突检测。

---

## 一、系统架构与技术栈

### 1.1 运行结构

```text
浏览器 (Browser)
  │
  ▼  HTTP (127.0.0.1:5173)
前端容器 (frontend: Nginx 1.29 + React 19 SPA)
  │
  ▼  Compose 网络 frontend_net (/api 反向代理 → http://api:8080/api)
后端容器 (api: Spring Boot 3.5.16 + Java 21 JRE)
  │
  ▼  Compose 网络 backend_net (JDBC → database:5432)
关系数据库容器 (database: PostgreSQL 17 + 命名 Volume 持久化)
```

### 1.2 组件职责与技术栈

| 组件 | 服务名 | 技术栈与基础镜像 | 职责说明 |
|---|---|---|---|
| 前端 | `frontend` | React 19 + TypeScript + Vite 8（构建：`node:24-alpine`，运行：`nginx:1.29-alpine`） | 提供用户界面，通过 HTTP `/api` 调用后端 Web API，支持运行时注入 `API_BASE_URL`，不直接访问数据库 |
| 后端 API | `api` | Java 21 + Spring Boot 3.5.16 + Spring JDBC + Flyway（构建：`maven:3.9.11-eclipse-temurin-21`，运行：`eclipse-temurin:21-jre-jammy`） | 实现业务规则、参数校验、开放时间检查、同场地同日期时段冲突控制（事务 + 行锁）及数据持久化访问 |
| 数据库 | `database` | PostgreSQL 17（`postgres:17-alpine`） | 持久化存储场地表（`venues`）与预约表（`reservations`），挂载命名 Volume `database_data` |

### 1.3 仓库目录结构

```text
cloud-native/
├── compose.yaml                # 根目录三服务 Docker Compose 编排文件（frontend + api + database）
├── .env.example                # 根目录环境变量示例文件（复制为 .env 后使用）
├── README.md                   # 项目总部署、运行、接口与验收说明文档（本文件）
├── docs/
│   └── lab1-report.md          # Lab 1 实验报告（含架构、数据库、容器化、持久化验证与用例截图）
├── frontend/                   # 前端应用源码、Dockerfile、Nginx 配置与前端报告章节
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── nginx/default.conf.template
│   ├── docker/40-runtime-config.sh
│   ├── src/
│   └── docs/
└── backend/                    # 后端 API 源码、Flyway 数据库迁移脚本、Dockerfile 与测试脚本
    ├── Dockerfile
    ├── .dockerignore
    ├── pom.xml
    ├── scripts/smoke.py        # HTTP 冒烟与持久化验证脚本
    ├── src/main/resources/db/migration/
    │   ├── V1__create_booking_tables.sql  # 场地表与预约表结构、约束及索引
    │   └── V2__seed_demo_venues.sql       # 演示场地种子数据（2 开放 + 1 停用）
    └── docs/
```

---

## 二、快速开始（Docker Compose 一键部署）

### 2.1 环境要求

- Docker Engine 24+
- Docker Compose v2

### 2.2 启动步骤

1. **在项目根目录复制环境变量配置文件**：

   ```bash
   cp .env.example .env
   ```

   > `.env` 已被加入 `.gitignore`，不会提交到 Git 仓库。可根据需要修改 `.env` 中的 `DB_PASSWORD` 或宿主机映射端口。

2. **构建镜像并后台启动三个服务容器**：

   ```bash
   docker compose up --build -d
   ```

3. **查看容器运行与健康检查状态**：

   ```bash
   docker compose ps
   ```

   等待 `database`、`api`、`frontend` 三个容器状态均变为 `Up (healthy)`：
   - **前端页面访问地址**：<http://localhost:5173>
   - **前端健康检查**：`curl http://localhost:5173/healthz`（返回 `ok`）
   - **经前端反向代理访问后端 API**：`curl http://localhost:5173/api/venues`
   - **后端健康检查**：`curl http://localhost:8080/actuator/health`（返回 `{"status":"UP"}`）

---

## 三、环境变量与网络配置说明

### 3.1 环境变量表（`.env.example`）

| 变量名 | 默认/示例值 | 作用范围 | 说明 |
|---|---|---|---|
| `DB_NAME` | `venue_booking` | `database` / `api` | PostgreSQL 数据库名称 |
| `DB_USERNAME` | `venue_app` | `database` / `api` | 数据库连接与初始化用户名 |
| `DB_PASSWORD` | `lab1_demo_change_me` | `database` / `api` | **必填**，数据库密码（不硬编码于源码或镜像中） |
| `FRONTEND_PORT` | `5173` | `frontend` | 前端发布到宿主机的访问端口（绑定 `127.0.0.1`） |
| `API_PORT` | `8080` | `api` | 后端发布到宿主机的调试/验收端口（绑定 `127.0.0.1`） |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000` | `api` | 后端允许的浏览器跨域 `Origin` 列表 |
| `API_BASE_URL` | `/api` | `frontend` | 前端运行时 API 基础路径（启动时写入 `/usr/share/nginx/html/config.js`） |

### 3.2 网络与端口安全策略

- **双层网络隔离**：
  - `frontend_net`：仅连接 `frontend` 与 `api`，前端 Nginx 通过 `http://api:8080` 转发 `/api/*` 请求；
  - `backend_net`：仅连接 `api` 与 `database`，`api` 通过 Compose 服务名 `database:5432` 访问 PostgreSQL；
  - **`frontend` 不加入 `backend_net`**，从网络层杜绝前端直接访问数据库。
- **端口发布**：
  - `frontend` 对宿主机发布 `127.0.0.1:5173:80` 供浏览器访问；
  - `api` 对宿主机发布 `127.0.0.1:8080:8080` 便于直接执行 `curl` / `smoke.py` 接口验收；
  - `database` **不对外发布任何宿主机端口**，仅在 `backend_net` 内部通信。

---

## 四、Web API 接口与状态码约定

后端提供以下 RESTful JSON 接口（均可通过前端同源代理 `http://localhost:5173/api/...` 或后端直连 `http://localhost:8080/api/...` 调用）：

| 方法 | 路径 | 功能说明 | 成功状态码 |
|---|---|---|---|
| `GET` | `/api/venues` | 查询场地列表（支持 `limit`、`offset`） | `200 OK` |
| `GET` | `/api/venues/{id}` | 查询单个场地详情 | `200 OK` |
| `POST` | `/api/venues` | 创建新场地（校验非空、容量 > 0、开放时间 < 关闭时间） | `201 Created` |
| `POST` | `/api/reservations` | 创建场地预约（校验场地开放状态、开放时间范围及时间段冲突） | `201 Created` |
| `GET` | `/api/reservations` | 查询预约列表（支持 `venueId`、`date`、`status`、`order`、`limit`、`offset`） | `200 OK` |
| `GET` | `/api/reservations/{id}` | 查询单条预约详情 | `200 OK` |
| `POST` | `/api/reservations/{id}/cancel` | 取消预约（逻辑取消，状态更新为 `CANCELLED` 并释放时段） | `200 OK` |
| `DELETE` | `/api/reservations/{id}` | 取消预约（与 `/cancel` 等价，状态更新为 `CANCELLED`） | `200 OK` |

### 错误响应与状态码语义

所有异常均由全局异常处理器 `ApiErrorHandler` 转换为统一 JSON 结构 `{"error": {"code": "...", "message": "...", "details": [...]}}`，不向客户端暴露异常堆栈或 SQL 信息：

| 场景 | HTTP 状态码 | `error.code` |
|---|---|---|
| 查询或取消成功 | `200 OK` | - |
| 创建场地或预约成功 | `201 Created` | - |
| 必填字段缺失、格式错误、超出开放时间、停用场地预约 | `400 Bad Request` | `INVALID_ARGUMENT` |
| 场地或预约资源不存在 | `404 Not Found` | `NOT_FOUND` |
| 同一场地同一日期的有效预约时间段重叠（`[startTime, endTime)`） | `409 Conflict` | `RESERVATION_CONFLICT` |
| 数据库不可用或锁等待超时 | `503 Service Unavailable` | `DATABASE_UNAVAILABLE` |
| 未处理的服务端错误 | `500 Internal Server Error` | `INTERNAL_ERROR` |

---

## 五、数据库设计与持久化机制

- **迁移与种子数据**：后端启动时由 Flyway 自动执行 `backend/src/main/resources/db/migration/` 下的迁移脚本：
  - `V1__create_booking_tables.sql`：创建场地表 `venues` 与预约表 `reservations`（外键 `venue_id REFERENCES venues(id)`，包含 `CHECK` 约束与部分索引 `idx_reservation_active_slot`）。
  - `V2__seed_demo_venues.sql`：初始化 3 条演示场地数据（`第一会议室` 开放、`篮球场` 开放、`维护中的活动室` 停用）。
- **取消策略说明**：取消预约采用**逻辑取消**（将 `reservations.status` 从 `ACTIVE` 更新为 `CANCELLED`），保留历史预约记录；冲突检测仅扫描 `status = 'ACTIVE'` 的记录，因此取消后原时间段可重新预约。

---

## 六、运行验收与数据持久化验证

### 6.1 自动化冒烟验收

容器启动后，可直接运行冒烟测试脚本验证场地创建、正常预约、时间冲突拒绝（409）、取消预约及取消后重新预约：

```bash
python3 backend/scripts/smoke.py --url http://localhost:8080
```

### 6.2 数据持久化验证流程

```bash
# 1. 创建一条预约并记录返回的预约 id（或使用 smoke.py 输出的 persistentReservationId）
curl -s -X POST http://localhost:5173/api/reservations \
  -H "Content-Type: application/json" \
  -d '{"venueId":1,"organizer":"云原生验收组","reservationDate":"2026-11-02","startTime":"14:00","endTime":"16:00","purpose":"持久化验证测试"}'

# 2. 停止并移除所有运行容器与网络（不加 -v，保留命名 Volume）
docker compose down

# 3. 再次启动服务
docker compose up -d

# 4. 查询刚创建的预约，确认容器重建后数据依然存在
curl -s http://localhost:5173/api/reservations?venueId=1&date=2026-11-02

# 5. 查看 Docker 命名 Volume
docker volume ls | grep cloud-native-lab1
```

更多单模块开发调试细节可参考：
- 前端详细说明：[frontend/README.md](frontend/README.md)
- 后端详细说明：[backend/README.md](backend/README.md)
- 完整实验报告：[docs/lab1-report.md](docs/lab1-report.md)
