# 后端设计说明

本服务负责场地和预约数据的读写，以及预约时间校验、冲突检查和取消处理。接口字段与数据库列的完整定义见 [README](../README.md)。

## 模块划分

| 模块 | 入口 | 职责 |
|---|---|---|
| HTTP 接口 | `BookingController` | 路由、请求体校验、查询参数校验、HTTP 状态和 Location 响应头 |
| 业务处理 | `BookingService` | 开放时间校验、场地状态检查、冲突检查、事务边界 |
| 数据访问 | `BookingRepository` | 参数化 SQL、行锁查询、数据写入和结果映射 |
| 错误响应 | `ApiErrorHandler` | 将校验异常、业务异常和数据库异常转换为错误响应 |
| 跨域配置 | `WebConfig` | 从环境配置读取允许的前端 origin |
| 结构迁移 | `db/migration` | 创建业务表和索引，插入初始场地数据 |

请求经 Controller 校验后交给 Service，Service 通过 Repository 访问 PostgreSQL。所有 SQL 参数均通过 JDBC 绑定。API 对象使用 camelCase，数据库列使用 snake_case，由 Repository 显式映射。

## 创建预约

一次创建请求在 `READ COMMITTED` 事务中完成：

1. 检查开始和结束时间，拒绝相同时间、倒置时间和秒以下精度。
2. 对目标场地执行 `SELECT ... FOR UPDATE`。场地不存在返回 404。
3. 检查场地是否开放，以及预约是否处于开放时间内；不满足时返回 400。
4. 查询同场地、同日期的有效预约是否与新时段重叠。冲突时返回 409。
5. 插入状态为 `ACTIVE` 的预约并提交事务，返回 201 和新建记录。

冲突条件为：

```sql
venue_id = :venueId
AND reservation_date = :date
AND status = 'ACTIVE'
AND start_time < :end
AND end_time > :start
```

时间区间按左闭右开处理，所以 10:00–11:00 和 11:00–12:00 不冲突。

锁定的是场地行，而不是已有预约行。即使某场地还没有预约记录，两个请求也必须依次完成冲突检查和写入。锁由 PostgreSQL 持有到事务结束，多个 API 实例连接同一数据库时使用相同机制。不同日期但属于同一场地的预约写入也会串行执行。

连接配置将锁等待时间设为 5 秒。等待超时等数据访问异常返回 503，客户端不会收到数据库错误详情。

## 取消预约

`POST /api/reservations/{id}/cancel` 与 `DELETE /api/reservations/{id}` 使用相同逻辑：查找预约，锁定关联场地，将状态更新为 `CANCELLED`，返回更新后的记录。

取消不删除数据，重复调用返回 200。冲突查询只扫描 `ACTIVE` 记录，因此取消提交后，相同时段可以重新预约。创建和取消都锁定场地行，以协调同一场地上的并发操作。

当前没有恢复预约或改期接口，取消后需要创建新预约。

## 数据库约束与迁移

`venues` 保存场地信息，`reservations.venue_id` 通过外键引用 `venues.id`。所有业务列均为非空，数据库检查约束限制容量、状态值和时间先后关系；字符串长度由列类型限制。

开放时间范围和预约重叠由业务事务校验。现有表结构没有排斥约束，直接执行 SQL 插入预约可能绕过这些规则。业务写入应通过 API 完成。

Flyway 在应用启动时执行迁移：

| 版本 | 内容 |
|---|---|
| V1 | 创建场地表、预约表、外键、检查约束和查询索引 |
| V2 | 插入三个示例场地 |

迁移历史保存在 `flyway_schema_history`。已经执行的脚本保持不变，新的结构变更使用后续版本文件。示例数据当前随 V2 一起初始化，没有单独的生产环境开关。

## 容器运行

Dockerfile 的构建阶段使用 Maven 和 JDK 21 生成可执行 JAR；运行阶段使用 JRE 21，仅复制 JAR，并安装健康检查所需的 curl。容器以 `app` 用户运行，Java 进程作为 PID 1 监听 8080。

数据库连接信息通过 `DB_URL`、`DB_USERNAME`、`DB_PASSWORD` 注入。`.dockerignore` 只允许构建所需文件进入上下文，排除 `.env`、本地构建目录和 IDE 配置。

Compose 在数据库健康检查通过后启动 API。API 的 `/actuator/health` 同时检查数据库连通性；数据库文件保存在命名 Volume 中，普通 `docker compose down` 不删除该 Volume。

## 测试

`BookingApiTest` 使用真实 PostgreSQL，覆盖接口行为、校验规则、状态变更、分页和并发写入。每次运行使用独立 schema，并执行实际迁移脚本。

`ApiErrorHandlerTest` 检查数据库异常和未处理异常的响应，确认内部错误信息没有出现在响应体中。`scripts/smoke.py` 通过 HTTP 验证已启动的服务。

执行命令见 [README](../README.md)，历史运行结果见 [验证记录](verification.md)。
