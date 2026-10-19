# 后端验证记录

验证日期：2026-10-19（北京时间）。范围为 Java 后端与 PostgreSQL；不包含尚未实现的前端。

## 构建及自动化测试

- Maven 编译和可执行 JAR 打包成功。
- `docker compose --profile test build api tests` 成功构建 Java 21 运行镜像与测试镜像。
- `docker compose --profile test run --rm tests`：**26 项测试通过，失败 0、错误 0、跳过 0**。
- BookingApiTest：24 项，使用真实 PostgreSQL 17、独立随机 schema，并实际运行 V1、V2 迁移。
- ApiErrorHandlerTest：2 项，验证数据库故障和内部异常不会将技术细节返回给用户。

覆盖正常预约、查询、逻辑取消、重复取消、取消后重新预约；五种重叠关系；相邻时段、不同场地/日期；开放时间边界；缺失/错误输入、无效容量/状态；不存在或停用资源；分页、CORS；两个请求并发预约以及事务锁等待。

并发测试确认相同场地、相同时段的两个请求恰好返回一个 201、一个 409，最终只有一条有效预约。锁等待测试确认请求等待其他事务释放场地锁后，能够读取其已提交的预约并返回 409。

## 真实 HTTP 验证

运行 `python3 scripts/smoke.py --url http://127.0.0.1:8080`，结果：

```json
{"result":"PASS","venueId":4,"cancelledReservationId":1,"persistentReservationId":2}
```

流程：健康检查 → 创建场地 → 创建预约 → 拒绝重复时段 → 查询 → 取消 → 同时段重新预约 → 按场地和状态筛选。上述记录保留在本地实验数据库中，编号仅代表本次运行结果。

## 容器重建及持久化

1. 记录预约 2 的全部字段。
2. 执行 `docker compose down`，删除 API、数据库容器和项目网络，保留命名 Volume。
3. 执行 `docker compose up -d --wait`，重建容器并等待健康检查通过。
4. 再查询预约 2，与重建前 JSON 逐字段比较，结果完全一致，状态仍为 ACTIVE。
5. 确认 Volume `cloud-native-lab1-backend_database_data` 存在，Flyway 历史仍为版本 1、2，种子数据没有重复初始化。

## 运行镜像与最终状态

- api、database 均为 healthy。
- API 访问地址：`http://localhost:8080`，仅映射宿主机回环地址。
- PostgreSQL 默认不向宿主机发布端口。
- API 运行身份：`uid=10001(app) gid=10001(app)`。
- 最终运行镜像没有 Maven、构建源码目录和 Maven 依赖缓存；Java 作为容器前台主进程。
- 独立测试数据库容器及其匿名数据卷已清理；正式 API 和数据库保留运行，便于继续联调。

## 环境说明

宿主机 JDK 25 的编译打包成功，但在本次执行环境里运行 JDBC 集成测试时，对 localhost / 127.0.0.1 的连接报 UnknownHostException。因此完整测试采用与交付一致的 Java 21 Docker 环境，并已通过；宿主机 IDE 的数据库运行路径未据此宣称验证通过。首次访问 Docker Hub 曾超时，重试下载官方镜像后构建成功。
