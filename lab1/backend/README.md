# Lab 1 场地预约系统：Java 后端

Java 21 + Spring Boot 3.5.16 + Spring JDBC + PostgreSQL 17 + Flyway。通过 Maven 构建，提供 HTTP JSON API。

这里完成后端同学的工作，并提供独立运行、测试后端所需的数据库配置。最终小组项目还需要前端同学的页面和 frontend 容器；本目录的 Compose 默认启动 api、database 两个服务。

## 1. 用 Docker 启动

在本目录执行（需要 Docker Desktop / Docker Engine 和 Compose v2）：

```bash
cp .env.example .env
docker compose up --build -d --wait
curl http://localhost:8080/actuator/health
curl http://localhost:8080/api/venues
```

健康检查应返回 `{"status":"UP"}`。首次启动自动执行 Flyway 迁移，建立表并插入三个演示场地；重启不会重复插入种子数据。`.env` 中只有本地实验示例值，可自行修改，真实配置不提交 Git。数据库初始化后修改密码环境变量不会自动修改已有数据库用户密码。

```bash
docker compose ps
docker compose logs --tail=100 api
docker compose down
docker compose up -d --wait
```

`down` 保留命名 Volume。只有明确要清空本实验数据库时才使用 `docker compose down -v`。默认仅将 API 的 8080 端口映射到本机回环地址；数据库不发布端口。可在 `.env` 中修改 `API_PORT`。

## 2. 本地 IDE / Maven 开发

需要 JDK 21 或兼容的较新 JDK、Maven 3.6.3+。先启动数据库开发配置，它仅向 `127.0.0.1:55432` 开放 PostgreSQL，便于宿主机上的 Java 进程连接：

```bash
cp .env.example .env  # 已有 .env 时跳过
docker compose -f compose.yaml -f compose.dev.yaml up -d --wait database
set -a
. ./.env
set +a
export DB_URL="jdbc:postgresql://127.0.0.1:${DB_HOST_PORT}/${DB_NAME}"
mvn spring-boot:run
```

如果容器 API 已占用 8080，可先 `docker compose stop api`，或给本地进程设置 `SERVER_PORT=8081`。在 IntelliJ IDEA 中打开 `pom.xml`，为 `BookingApplication` 配置 `DB_URL`、`DB_USERNAME`、`DB_PASSWORD` 即可运行。Spring Boot 本身不会自动加载 `.env`，IDE 中需显式填写环境变量。

打包：`mvn -DskipTests package`。产物为 `target/venue-booking-api.jar`，使用上述数据库环境变量运行 `java -jar target/venue-booking-api.jar`。

## 3. 接口约定

所有请求和响应使用 JSON，字段采用 camelCase。创建成功返回 201 和 Location 响应头，查询、取消返回 200。列表直接返回数组，按 id 升序，默认 `limit=100&offset=0`；limit 为 1–200，offset 不小于 0。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/venues` | 场地列表，支持 limit、offset |
| GET | `/api/venues/{id}` | 场地详情 |
| POST | `/api/venues` | 创建场地 |
| POST | `/api/reservations` | 创建预约 |
| GET | `/api/reservations` | 预约列表，支持 venueId、date、status、limit、offset |
| GET | `/api/reservations/{id}` | 预约详情 |
| POST | `/api/reservations/{id}/cancel` | 逻辑取消预约，可重复调用 |
| DELETE | `/api/reservations/{id}` | 同上，保留历史记录，不物理删除 |
| GET | `/actuator/health` | 包含数据库连通性检查的健康状态 |

创建场地请求（全部字段必填）：

```json
{
  "name": "第三会议室",
  "location": "教学楼 A303",
  "capacity": 20,
  "openingTime": "08:00:00",
  "closingTime": "22:00:00",
  "status": "OPEN"
}
```

场地响应在上述字段上增加数字 `id`。name 最长 100 字符，location 最长 255 字符，均不可为空白；capacity 为正整数；status 只能是 `OPEN` 或 `DISABLED`。

创建预约请求（全部字段必填）：

```json
{
  "venueId": 1,
  "organizer": "张同学 / 云原生小组",
  "reservationDate": "2026-11-01",
  "startTime": "10:00:00",
  "endTime": "11:00:00",
  "purpose": "小组实验讨论"
}
```

预约响应在上述字段上增加数字 `id` 和 `status`（`ACTIVE` / `CANCELLED`）。organizer 最长 100 字符，purpose 最长 500 字符，均不可为空白。服务端生成 id 和初始状态，客户端不传这两个字段。

例如查询某场地当天的有效预约：

```bash
curl 'http://localhost:8080/api/reservations?venueId=1&date=2026-11-01&status=ACTIVE'
```

业务规则：

- 日期格式为 `YYYY-MM-DD`，时间为 `HH:mm` 或 `HH:mm:ss`，按场地本地时间解释，组内约定为北京时间。没有时区偏移，最多精确到秒，不支持跨天预约及跨天开放时间。
- 开始时间必须早于结束时间；预约必须处于场地开放时间内，允许恰好在开放时刻开始或关闭时刻结束。
- 不存在的场地返回 404；停用场地和无效时间返回 400。
- 同场地、同日期的有效预约按 `[开始, 结束)` 判断冲突。10:00–11:00 与 11:00–12:00 不冲突；不同场地或不同日期互不影响。
- 取消保留原记录，释放时段；重复取消返回 200。不存在的预约返回 404。
- Lab 1 没有规定“禁止历史日期”或登录权限，因此当前不添加这两个限制。

统一错误示例：

```json
{
  "error": {
    "code": "RESERVATION_CONFLICT",
    "message": "该场地在所选时间段已有有效预约",
    "details": []
  }
}
```

| HTTP 状态 | error.code | 含义 |
|---|---|---|
| 400 | INVALID_ARGUMENT | 缺少字段、空白文本、类型/格式错误、无效时间、停用场地等 |
| 404 | NOT_FOUND | 场地或预约不存在 |
| 409 | RESERVATION_CONFLICT | 有效预约时间重叠 |
| 503 | DATABASE_UNAVAILABLE | 数据库连接失败、锁等待超时等 |
| 500 | INTERNAL_ERROR | 未处理异常；客户端不会收到堆栈或 SQL |
| 404 / 405 / 415 等 | HTTP_ERROR | 不支持的路径、HTTP 方法或媒体类型 |

字段验证错误的 details 包含 field、message，前端可以直接显示。CORS 预检被拒绝的响应由 Spring 框架处理，不使用上述业务错误结构。未知 JSON 字段会被拒绝，以便尽早发现前后端字段拼写错误。

可以使用 [api.http](docs/api.http) 在 IntelliJ HTTP Client / VS Code REST Client 中手动调用。

## 4. 数据库、并发与迁移

- `venues`：id、name、location、capacity、opening_time、closing_time、status。
- `reservations`：id、venue_id 外键、organizer、reservation_date、start_time、end_time、purpose、status。
- Flyway 脚本位于 `src/main/resources/db/migration/`；V1 建表和索引，V2 插入演示场地。后续变更新增 V3 等脚本，不修改已经应用的迁移。
- 创建预约在一个 READ COMMITTED 事务中先对场地执行 `SELECT ... FOR UPDATE`，再检查有效预约重叠并插入。相同场地的并发写入串行执行；锁在提交或回滚时释放。取消使用同一把场地锁。
- 冲突条件：`existing.start_time < new.end_time AND existing.end_time > new.start_time`。
- 数据库约束保证外键、正容量、状态和时间先后关系。重叠检查由事务服务实现，直接绕过 API 写入预约表不受该业务检查保护。

实现参考：[Spring 事务管理](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html)、[PostgreSQL 行锁](https://www.postgresql.org/docs/current/explicit-locking.html)。

## 5. 自动化测试

推荐使用独立的测试数据库容器运行，宿主机无需安装 Java/Maven：

```bash
docker compose --profile test run --build --rm tests
docker compose --profile test stop test-database
docker compose --profile test rm -f -v test-database
```

测试覆盖接口完整流程、数据库迁移、输入验证、停用/不存在资源、五种重叠关系、相邻时间、不同场地/日期、逻辑取消、分页、CORS，以及两个请求并发预约、等待场地锁后读取已提交冲突。

宿主机 Maven 也可以执行。启动第 2 节的数据库并加载环境变量后：

```bash
export TEST_DATABASE_URL="$DB_URL"
export TEST_DATABASE_USERNAME="$DB_USERNAME"
export TEST_DATABASE_PASSWORD="$DB_PASSWORD"
mvn test
```

测试创建随机命名的独立 schema，结束后删除该 schema，不清空应用表；数据库用户需要创建 schema 的权限。未设置 TEST_DATABASE_* 时测试会明确失败，避免误连数据库或静默跳过。

服务运行后的真实 HTTP 冒烟验证（需要 Python 3，仅用标准库）：

```bash
python3 scripts/smoke.py
```

该脚本会创建专用演示场地，验证成功预约、冲突拒绝、取消和重新预约，并输出保留的预约编号。它会在实验数据库中留下这组演示记录。

持久化验收：记录脚本输出的预约编号，然后执行 `docker compose down`、`docker compose up -d --wait`，再 GET `/api/reservations/该编号`，确认记录仍存在。可用 `docker volume ls` 查看 Volume。

## 6. 与组员集成

前端同学：调用以上 API，通过 `.env` 中 `CORS_ALLOWED_ORIGINS` 配置实际前端 origin（逗号分隔）。浏览器开发时使用 `http://localhost:8080/api`。静态页面的浏览器代码不能直接解析 Compose 内的 `api` 服务名；部署时可由前端 Nginx 将 `/api` 反向代理至 `http://api:8080`。

数据库/部署同学：后端 Docker 构建上下文为本目录，容器监听 8080；通过 `DB_URL`、`DB_USERNAME`、`DB_PASSWORD` 配置数据库，Compose 内 DB_URL 的主机名使用数据库服务名。请复用、审查现有 Flyway 表结构，避免另写一套不兼容初始化脚本。完整 Compose 中补充 frontend 服务，保留数据库健康检查和 Volume。

最终镜像采用多阶段构建，只包含 JRE、运行 JAR 和健康检查工具，使用非 root 用户；没有 Maven、测试源码或开发缓存。密码不写入 Dockerfile 或镜像。

后端报告素材见 [backend-report.md](docs/backend-report.md)，验证结果见 [verification.md](docs/verification.md)。

## 7. Git 协作

Git 仓库位于课程项目根目录，包含实验 PDF、源码和配置模板；`.env`、target、IDE 文件不纳入版本管理。建议每人使用功能分支，接口变动先同步给前端和部署同学。
