# Cloud Native · 场地预约系统

当前实现 Lab 1 的场地预约和 Docker 容器化，后续功能在同一仓库继续扩展。前端使用 React 和 TypeScript，后端使用 Java 21、Spring Boot 与 Spring JDBC，数据保存在 PostgreSQL 17。

支持场地查询与创建、预约查询与创建、取消预约，以及开放时间和预约冲突校验。

## 启动系统

安装 Docker Engine 与 Docker Compose v2 后，在仓库根目录执行：

```sh
cp .env.example .env             # 仅首次创建配置时执行
# 按需修改 .env 中的密码和端口
docker compose up --build -d --wait
docker compose ps
```

- 页面：<http://localhost:5173>
- 前端健康检查：<http://localhost:5173/healthz>
- 后端健康检查：<http://localhost:8080/actuator/health>
- 经前端代理访问 API：<http://localhost:5173/api/venues>

完整系统使用根目录的 `compose.yaml`。`backend/compose.yaml` 用于单独开发后端，两套编排的数据卷独立；不要同时占用相同端口。使用前端开发服务器时，也应先释放 Compose 前端占用的 5173 端口。

```sh
docker compose logs -f api      # 查看后端日志
docker compose stop            # 停止服务，保留容器与数据
docker compose up -d --wait     # 启动已有镜像
docker compose down            # 删除容器与网络，保留数据库 Volume
```

`docker compose down -v` 会同时删除数据库数据，日常停止服务不使用该选项。更新代码后执行 `docker compose up --build -d --wait`。

## 运行结构

```text
浏览器 → frontend（Nginx:80）→ api（Java:8080）→ database（PostgreSQL:5432）
           宿主机 5173           宿主机 8080           不发布宿主机端口
```

`frontend` 与 `api` 共享 `frontend_net`，Nginx 将 `/api/` 原样转发到 `api:8080`。`api` 与 `database` 共享 `backend_net`，通过 `database:5432` 连接数据库。前端不加入数据库网络。

数据库文件挂载到命名 Volume `cloud-native-lab1_database_data`。API 启动时执行 Flyway 迁移，创建场地和预约表，并初始化三个演示场地。迁移不会在每次重启时重复插入数据。

## 配置

真实 `.env` 仅保存在本地，Git 中只保留示例配置。

| 变量 | 示例或默认值 | 用途 |
|---|---|---|
| `DB_NAME` | `venue_booking` | 数据库名称 |
| `DB_USERNAME` | `venue_app` | 数据库连接账号 |
| `DB_PASSWORD` | 见 `.env.example`，启动时必填 | 数据库密码，由环境变量注入 |
| `FRONTEND_PORT` | `5173` | 前端宿主机端口，绑定 127.0.0.1 |
| `API_PORT` | `8080` | 后端宿主机端口，用于本地开发和接口调试 |
| `CORS_ALLOWED_ORIGINS` | localhost:5173、127.0.0.1:5173、localhost:3000 对应的 HTTP origin | 后端接受的浏览器访问来源，逗号分隔 |
| `API_BASE_URL` | `/api` | 浏览器使用的 API 基础路径，前端启动时写入 `config.js` |

修改端口后，应同步调整 `CORS_ALLOWED_ORIGINS`。即使经过同源代理，浏览器 POST 请求携带的 Origin 仍可能被后端校验。修改 `.env` 后用 `docker compose up -d` 重新创建受影响容器；单纯 `restart` 不会重新读取 Compose 环境变量。

## 接口与字段

请求和响应使用 JSON，字段采用 camelCase。成功时直接返回对象或数组，没有 `data` 外层包装。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/venues` | 场地列表，支持 `limit`、`offset` |
| GET | `/api/venues/{id}` | 场地详情 |
| POST | `/api/venues` | 创建场地 |
| POST | `/api/reservations` | 创建预约 |
| GET | `/api/reservations` | 按 `venueId`、`date`、`status` 筛选，支持 `order`、`limit`、`offset` |
| GET | `/api/reservations/{id}` | 预约详情 |
| POST | `/api/reservations/{id}/cancel` | 逻辑取消预约 |
| DELETE | `/api/reservations/{id}` | 与显式取消接口相同 |

场地创建字段：

| 字段 | 类型 | 约束 |
|---|---|---|
| `name` | string | 必填，最多 100 字符 |
| `location` | string | 必填，最多 255 字符 |
| `capacity` | integer | 正整数 |
| `openingTime`、`closingTime` | string | `HH:mm` 或 `HH:mm:ss`，开放时间早于关闭时间 |
| `status` | string | `OPEN` 或 `DISABLED` |

预约创建字段：

| 字段 | 类型 | 约束 |
|---|---|---|
| `venueId` | integer | 已存在的开放场地编号 |
| `organizer` | string | 必填，最多 100 字符 |
| `reservationDate` | string | `YYYY-MM-DD` |
| `startTime`、`endTime` | string | `HH:mm` 或 `HH:mm:ss`，起始早于结束，且在开放时间内 |
| `purpose` | string | 必填，最多 500 字符 |

场地响应额外包含 `id`；预约响应额外包含 `id`、`status`（`ACTIVE` / `CANCELLED`）。时间响应统一包含秒。日期与时间按场地当地时间解释，不携带时区；当前演示按北京时间使用，允许查询和创建历史日期预约。

列表默认每次 100 条，最多 200 条，`offset` 从 0 开始；预约默认按编号升序，`order=DESC` 返回最近创建的记录。取消保留历史记录并释放时段；相邻时段可以分别预约。

查询与取消返回 200，创建返回 201 并带 `Location`。参数错误返回 400，资源不存在返回 404，预约冲突返回 409。错误体格式为 `{"error":{"code":"...","message":"...","details":[]}}`，不包含异常堆栈。

数据库表名为 `venues` 和 `reservations`，外键 `reservations.venue_id` 指向 `venues.id`。列名使用 snake_case，由后端映射为 API 字段。完整字段、错误码和数据库接入约定见 [后端 README](backend/README.md)。

## 开发与测试

- [前端开发说明](frontend/README.md)
- [前端部署约定](frontend/docs/integration-notes.md)
- [后端开发与接口说明](backend/README.md)
- [Lab 1 实验报告](docs/lab1-report.md)

```sh
# 前端：在 frontend/ 中执行
pnpm install --frozen-lockfile
pnpm test
pnpm build

# 系统启动后，在仓库根目录运行 HTTP 冒烟测试
python3 backend/scripts/smoke.py --url http://localhost:8080

# 带多个查询参数的 URL 必须加引号
curl -s 'http://localhost:5173/api/reservations?venueId=1&date=2026-11-02'
```

冒烟测试会创建专用场地及预约数据。后端集成测试使用独立测试数据库，执行命令见后端 README。
