# 场地预约服务

提供场地查询、场地创建、预约查询、预约创建和取消预约接口。预约数据存储在 PostgreSQL 中，表结构由 Flyway 管理。

技术栈：Java 21、Spring Boot 3.5.16、Spring JDBC、PostgreSQL 17。默认 Compose 配置包含 `api` 和 `database` 两个服务。

- [启动与配置](#启动与配置)
- [前端接口约定](#前端接口约定)
- [数据库接入与字段映射](#数据库接入与字段映射)
- [业务规则](#业务规则)
- [测试与排查](#测试与排查)

## 启动与配置

### Docker 启动

需要 Docker 和 Compose v2。从仓库根目录进入 `backend`，首次运行时复制配置文件：

```bash
cd backend
cp .env.example .env
```

已有 `.env` 时保留现有配置。以下命令均在 `backend` 目录执行：

```bash
docker compose up --build -d --wait
curl http://localhost:8080/actuator/health
curl http://localhost:8080/api/venues
```

健康检查正常时返回 `{"status":"UP"}`。首次启动自动建表并插入三个示例场地，后续启动只执行尚未应用的迁移。

API 默认地址为 `http://localhost:8080`，只绑定宿主机回环地址。数据库通过 Compose 网络提供服务，默认不向宿主机开放端口。

### 本地 Java 开发

需要 JDK 21 和 Maven 3.6.3+。使用开发配置将数据库端口映射到 `127.0.0.1:55432`：

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d --wait database
set -a
. ./.env
set +a
export DB_URL="jdbc:postgresql://127.0.0.1:${DB_HOST_PORT}/${DB_NAME}"
mvn spring-boot:run
```

如果容器中的 API 已占用 8080，可先执行 `docker compose stop api`，或为本地进程设置 `SERVER_PORT=8081`。

IDE 导入 `pom.xml`，运行入口为 `edu.cloudnative.booking.BookingApplication`。运行配置中需设置 `DB_URL`、`DB_USERNAME` 和 `DB_PASSWORD`；Spring Boot 不会自动读取 `.env`。

```bash
mvn -DskipTests package
java -jar target/venue-booking-api.jar
```

### 环境变量

| 变量 | 使用位置 | 默认值或要求 |
|---|---|---|
| `DB_URL` | API 的 JDBC 连接地址 | 本地默认 `jdbc:postgresql://127.0.0.1:5432/venue_booking`；Compose 中为 `jdbc:postgresql://database:5432/${DB_NAME}` |
| `DB_NAME` | Compose 创建数据库、拼接 JDBC 地址 | `venue_booking` |
| `DB_USERNAME` | API 连接账号、Compose 数据库初始化账号 | `venue_app` |
| `DB_PASSWORD` | API 连接密码、Compose 数据库初始化密码 | 必填，无程序默认值 |
| `API_PORT` | Compose 发布到宿主机的 API 端口 | `8080` |
| `SERVER_PORT` | Java 进程监听端口 | `8080`；本地运行时可调整 |
| `DB_HOST_PORT` | `compose.dev.yaml` 发布的数据库端口 | `55432` |
| `CORS_ALLOWED_ORIGINS` | API 允许的跨域来源 | `http://localhost:5173,http://localhost:3000`，多个地址用逗号分隔 |

`.env.example` 中的密码仅用于本地示例，实际配置保存在未纳入 Git 的 `.env` 中。PostgreSQL 初始化完成后，修改环境变量不会同步修改数据库内已有账号的密码。

Compose 中的 `DB_URL` 由服务名 `database` 和 `DB_NAME` 生成。接入外部数据库时，需修改 `compose.yaml` 中 `api.environment.DB_URL`；仅在 `.env` 增加 `DB_URL` 不会覆盖这一配置。

## 前端接口约定

### 地址与响应格式

本地直连 API 的基础路径为 `http://localhost:8080/api`。JSON 字段使用 camelCase，请求体设置 `Content-Type: application/json`。

成功响应直接返回资源对象或数组，没有 `code`、`data` 外层包装。列表默认按 `id` 升序返回，预约列表可通过 `order=DESC` 先返回新建记录。空列表为 `[]`，不附带总条数。创建成功返回 `201`，并在 `Location` 响应头中提供详情路径；查询和取消返回 `200`。

| 方法 | 路径 | 请求 | 成功响应 |
|---|---|---|---|
| GET | `/api/venues` | `limit`、`offset` 可选 | 场地对象数组 |
| GET | `/api/venues/{id}` | `id` 为正整数 | 场地对象 |
| POST | `/api/venues` | 场地创建 JSON | 新建场地对象，201 |
| POST | `/api/reservations` | 预约创建 JSON | 新建预约对象，201 |
| GET | `/api/reservations` | 筛选与分页参数可选，见下表 | 预约对象数组 |
| GET | `/api/reservations/{id}` | `id` 为正整数 | 预约对象 |
| POST | `/api/reservations/{id}/cancel` | 无请求体 | 状态为 `CANCELLED` 的预约对象 |
| DELETE | `/api/reservations/{id}` | 无请求体 | 与 cancel 接口相同，返回 200 |

### 场地字段

创建场地时，除 `id` 外所有字段必填。创建和详情接口返回下表中的全部字段，列表中的每一项也使用同一结构。

| JSON 字段 | 类型 | 创建时是否传入 | 说明与约束 |
|---|---|---|---|
| `id` | integer / int64 | 否，由数据库生成 | 场地编号 |
| `name` | string | 必填 | 场地名称，非空白，最长 100 字符 |
| `location` | string | 必填 | 位置，非空白，最长 255 字符 |
| `capacity` | integer / int32 | 必填 | 容纳人数，大于 0，不接受小数 |
| `openingTime` | string | 必填 | 每日开放时间，如 `08:00:00` |
| `closingTime` | string | 必填 | 每日关闭时间，必须晚于开放时间 |
| `status` | string | 必填 | `OPEN`：开放；`DISABLED`：停用 |

场地响应示例：

```json
{
  "id": 1,
  "name": "第一会议室",
  "location": "办公楼 A101",
  "capacity": 20,
  "openingTime": "08:00:00",
  "closingTime": "22:00:00",
  "status": "OPEN"
}
```

创建请求使用相同字段，去掉 `id`。当前没有场地更新接口，状态在创建时指定。

### 预约字段

| JSON 字段 | 类型 | 创建时是否传入 | 说明与约束 |
|---|---|---|---|
| `id` | integer / int64 | 否，由数据库生成 | 预约编号 |
| `venueId` | integer / int64 | 必填 | 场地编号，大于 0，场地必须存在且处于开放状态 |
| `organizer` | string | 必填 | 预约人或组织名称，非空白，最长 100 字符 |
| `reservationDate` | string / date | 必填 | 预约日期，格式 `YYYY-MM-DD` |
| `startTime` | string | 必填 | 开始时间，如 `10:00:00` |
| `endTime` | string | 必填 | 结束时间，必须晚于开始时间 |
| `purpose` | string | 必填 | 使用目的，非空白，最长 500 字符 |
| `status` | string | 否，由服务端设置 | 创建后为 `ACTIVE`，取消后为 `CANCELLED` |

创建预约请求：

```json
{
  "venueId": 1,
  "organizer": "研发团队",
  "reservationDate": "2026-11-01",
  "startTime": "10:00:00",
  "endTime": "11:00:00",
  "purpose": "需求评审"
}
```

成功响应：

```json
{
  "id": 42,
  "venueId": 1,
  "organizer": "研发团队",
  "reservationDate": "2026-11-01",
  "startTime": "10:00:00",
  "endTime": "11:00:00",
  "purpose": "需求评审",
  "status": "ACTIVE"
}
```

详情、创建和取消接口均返回完整预约对象。列表返回相同结构的数组，不内嵌场地名称或位置，需要时通过 `venueId` 关联场地数据。

状态值区分大小写。创建请求不传 `id`，创建预约不传 `status`；未知 JSON 字段会返回 400。文本字段入库时去除首尾空白。

### 查询参数

| 参数 | 适用接口 | 默认值 | 约束与含义 |
|---|---|---|---|
| `limit` | 两个列表接口 | `100` | 1–200，每次最多返回的条数 |
| `offset` | 两个列表接口 | `0` | 不小于 0，跳过的条数 |
| `venueId` | 预约列表 | 不筛选 | 正整数，按场地筛选 |
| `date` | 预约列表 | 不筛选 | `YYYY-MM-DD`，按预约日期筛选 |
| `status` | 预约列表 | 不筛选 | `ACTIVE` 或 `CANCELLED` |
| `order` | 预约列表 | `ASC` | 按 `id` 排序：`ASC` 从旧到新，`DESC` 从新到旧；先排序，再应用 limit 和 offset |

多个筛选条件同时生效。不传 `status` 时，结果包含有效和已取消记录。查询参数名是 `date`，请求体和响应对象中的字段名是 `reservationDate`。

场地详情页的近期预约使用 `venueId=<id>&order=DESC&limit=20`，返回该场地最新创建的 20 条记录。`order` 不改变时间冲突检查，也不按预约日期排序。

```http
GET /api/reservations?venueId=1&date=2026-11-01&status=ACTIVE&limit=20&offset=0
```

### 错误处理

业务接口的错误响应格式如下：

```json
{
  "error": {
    "code": "RESERVATION_CONFLICT",
    "message": "该场地在所选时间段已有有效预约",
    "details": []
  }
}
```

| HTTP 状态 | `error.code` | 场景 |
|---|---|---|
| 400 | `INVALID_ARGUMENT` | 必填字段缺失、类型或格式错误、无效时间、停用场地 |
| 404 | `NOT_FOUND` | 详情、创建预约或取消操作引用的资源不存在 |
| 409 | `RESERVATION_CONFLICT` | 预约时段与现有有效预约重叠 |
| 503 | `DATABASE_UNAVAILABLE` | 数据访问失败，包括连接失败和锁等待超时 |
| 500 | `INTERNAL_ERROR` | 未处理的服务端异常 |
| 404 / 405 / 415 等 | `HTTP_ERROR` | 请求路径、方法或媒体类型不受支持 |

`error.message` 用于提示信息，业务分支判断使用 HTTP 状态和 `error.code`。字段校验失败时，`details` 可能包含 `{"field":"organizer","message":"..."}`；其他错误通常返回空数组，不应假定每次都有字段级信息。响应不包含异常堆栈或 SQL。

CORS 拒绝由 Spring 直接处理，不保证返回上述 JSON。健康检查位于 `/actuator/health`，使用独立格式：正常时 HTTP 200、`{"status":"UP"}`，故障时可能返回 HTTP 503、`{"status":"DOWN"}`。

### 联调方式

浏览器直连后端时，将前端实际 origin 加入 `CORS_ALLOWED_ORIGINS`。例如开发服务运行在 `http://localhost:5173`，该地址需要完整匹配，包括协议和端口；配置中不带路径。

容器部署时可由前端 Nginx 将 `/api` 转发至 `http://api:8080`，并保留请求路径。浏览器使用前端站点的 `/api` 相对地址，不使用 Compose 服务名。前端容器需要与 API 加入同一个 Docker 网络。

创建预约返回 409 时，提示冲突并刷新该场地的有效预约列表；取消成功后刷新列表和可用时段。重复取消返回同一条已取消记录，不会报冲突。

可执行请求示例见 [api.http](docs/api.http)。

## 数据库接入与字段映射

后端直接使用 PostgreSQL，不提供独立的数据库 HTTP 接口。数据库侧需要提供 JDBC 地址、账号、密码和目标 schema；当前默认使用 `public`。配置入口见前面的环境变量表。

### `venues` 场地表

以下列均为 `NOT NULL`。

| 数据库列 | PostgreSQL 类型 | API 字段 | 数据库约束 |
|---|---|---|---|
| `id` | `BIGINT` | `id` | 主键，`GENERATED ALWAYS AS IDENTITY` |
| `name` | `VARCHAR(100)` | `name` | `btrim(name) <> ''` |
| `location` | `VARCHAR(255)` | `location` | `btrim(location) <> ''` |
| `capacity` | `INTEGER` | `capacity` | 大于 0 |
| `opening_time` | `TIME(0)` | `openingTime` | 与关闭时间共同校验先后关系 |
| `closing_time` | `TIME(0)` | `closingTime` | `opening_time < closing_time` |
| `status` | `VARCHAR(16)` | `status` | 仅允许 `OPEN`、`DISABLED`，无默认值 |

### `reservations` 预约表

以下列均为 `NOT NULL`。

| 数据库列 | PostgreSQL 类型 | API 字段 | 数据库约束 |
|---|---|---|---|
| `id` | `BIGINT` | `id` | 主键，`GENERATED ALWAYS AS IDENTITY` |
| `venue_id` | `BIGINT` | `venueId` | 外键引用 `venues(id)`，不级联删除 |
| `organizer` | `VARCHAR(100)` | `organizer` | `btrim(organizer) <> ''` |
| `reservation_date` | `DATE` | `reservationDate` | 预约日期 |
| `start_time` | `TIME(0)` | `startTime` | 与结束时间共同校验先后关系 |
| `end_time` | `TIME(0)` | `endTime` | `start_time < end_time` |
| `purpose` | `VARCHAR(500)` | `purpose` | `btrim(purpose) <> ''` |
| `status` | `VARCHAR(16)` | `status` | 仅允许 `ACTIVE`、`CANCELLED`，无默认值；后端插入时显式写入 `ACTIVE` |

索引：

| 索引 | 列 | 用途 |
|---|---|---|
| `idx_reservation_active_slot` | `venue_id, reservation_date, start_time, end_time`，仅索引 `status = 'ACTIVE'` 的记录 | 有效预约冲突查询 |
| `idx_reservation_date` | `reservation_date, id` | 按日期查询预约 |

### 初始化与结构变更

表结构以 [V1 迁移](src/main/resources/db/migration/V1__create_booking_tables.sql) 为准；[V2 迁移](src/main/resources/db/migration/V2__seed_demo_venues.sql) 插入三个示例场地，其中两个开放、一个停用。示例数据在首次迁移时执行，不按运行环境区分。

应用启动时自动执行 Flyway。连接账号需要目标 schema 的建表、建索引和数据读写权限。已执行的版本记录在 `flyway_schema_history` 中；后续结构变更新增 V3、V4 等脚本，保留已应用脚本的内容和校验和。

接入已有数据库前，先确认目标 schema 中没有同名业务表或冲突的 Flyway 历史。不要同时使用另一套初始化脚本创建这些表。

使用非 `public` schema 时，例如 `booking`，JDBC 地址设置为 `jdbc:postgresql://<host>:5432/<database>?currentSchema=booking`，同时设置 `SPRING_FLYWAY_DEFAULT_SCHEMA=booking`。该 schema 应提前创建并授予连接账号相应权限。Compose 部署时，将这两个配置显式加入 `api.environment`。

Compose 将 PostgreSQL 数据目录挂载到命名 Volume `database_data`。`docker compose down` 保留数据，`docker compose down -v` 会删除该 Volume 及其中的数据。

## 业务规则

日期使用 `YYYY-MM-DD`；时间使用 `HH:mm` 或 `HH:mm:ss`，精度最多到秒。接口不携带时区，联调统一按 `Asia/Shanghai` 的本地日期和时间传值，后端不做时区换算。

预约的开始时间必须早于结束时间，并且整个时段都在场地开放时间内。可以从开放时刻开始，或在关闭时刻结束；不支持跨天预约或跨天开放时间。当前允许提交历史日期。

冲突检查只考虑同一场地、同一天的 `ACTIVE` 预约，时间区间采用 `[startTime, endTime)`。例如 10:00–11:00 与 11:00–12:00 可以同时存在；10:30–11:30 则与前者冲突。取消将状态改为 `CANCELLED`，保留记录并释放时段。

创建预约和取消预约均在事务中锁定对应场地行。同一场地的并发写入串行执行，冲突判断和新增预约在同一事务内完成。直接向数据库写入预约会绕过这套检查；数据库目前没有防止时段重叠的排斥约束。

当前接口没有登录鉴权或预约改期功能。`capacity` 是场地展示信息，预约请求没有使用人数，后端不做人数与容量比较。事务流程和模块说明见 [后端设计说明](docs/backend-report.md)。

## 测试与排查

### 自动化测试

使用独立测试数据库运行：

```bash
docker compose --profile test run --build --rm tests
docker compose --profile test stop test-database
docker compose --profile test rm -f -v test-database
```

测试会创建随机命名的 schema，结束后删除，不清空业务表。测试账号需要创建 schema 的权限。使用本地 Maven 时，先按“本地 Java 开发”一节准备数据库并加载环境变量，再执行：

```bash
export TEST_DATABASE_URL="$DB_URL"
export TEST_DATABASE_USERNAME="$DB_USERNAME"
export TEST_DATABASE_PASSWORD="$DB_PASSWORD"
mvn test
```

未设置上述三个测试变量时，集成测试会失败，不会自动使用业务数据库配置。

### HTTP 冒烟与持久化检查

服务启动后执行以下脚本，需要 Python 3：

```bash
python3 scripts/smoke.py
```

脚本验证创建、查询、冲突拒绝、取消和重新预约，并在数据库中保留测试记录。输出中的 `persistentReservationId` 可用于持久化检查：执行 `docker compose down` 和 `docker compose up -d --wait` 后，再查询该编号，比较预约内容。

### 常用排查命令

```bash
docker compose ps
docker compose logs --tail=100 api
docker compose logs --tail=100 database
curl http://localhost:8080/actuator/health
```

数据库使用已有 Volume 时，先核对账号实际密码与 `DB_PASSWORD` 是否一致。端口冲突检查 `API_PORT` 或本地进程的 `SERVER_PORT`；跨域请求失败检查浏览器的 origin 是否与允许列表一致。

历史测试结果、持久化验证步骤和已知环境问题见 [验证记录](docs/verification.md)。
