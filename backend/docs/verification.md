# 验证记录

验证日期：2026-10-19（北京时间）。本记录对应 Java 后端初始实现，代码基线为 `51e9e4c`；后续目录调整未修改业务代码。以下结果是当时的运行记录，不代表服务当前在线状态。

验证环境：Java 21 容器、PostgreSQL 17、Docker Compose。宿主机使用 JDK 25 完成编译打包。验证范围包括 API、数据库迁移、容器运行和数据持久化，不包含前端。

## 构建与自动化测试

命令在 `backend` 目录执行：

```bash
docker compose --profile test build api tests
docker compose --profile test run --rm tests
```

构建成功，测试结果如下：

| 测试类 | 用例数 | 失败 | 错误 | 跳过 |
|---|---:|---:|---:|---:|
| `BookingApiTest` | 24 | 0 | 0 | 0 |
| `ApiErrorHandlerTest` | 2 | 0 | 0 | 0 |
| 合计 | 26 | 0 | 0 | 0 |

集成测试使用独立 schema，执行 V1、V2 迁移后调用 API。主要检查项：

| 检查项 | 结果 |
|---|---|
| 创建、查询、取消、重复取消及取消后重新预约 | 通过 |
| 五种时段重叠关系 | 均返回 409，未插入冲突记录 |
| 相邻时段、不同场地或不同日期 | 允许创建 |
| 开放时间边界、错误输入、停用或不存在资源 | 返回预期状态和错误响应 |
| 分页、筛选与跨域配置 | 通过 |
| 两个请求同时预约同场地、同时段 | 一个 201、一个 409，最终仅一条有效预约 |
| 等待场地锁后读取其他事务提交的预约 | 等待结束后识别冲突，返回 409 |
| 数据库故障及未处理异常 | 响应未暴露内部异常信息 |

## HTTP 冒烟测试

在 API 启动后执行：

```bash
python3 scripts/smoke.py --url http://127.0.0.1:8080
```

脚本依次检查健康状态、创建场地、创建预约、拒绝冲突、查询、取消和重新预约，最后按场地及状态查询记录。该次输出为：

```json
{
  "result": "PASS",
  "venueId": 4,
  "cancelledReservationId": 1,
  "persistentReservationId": 2
}
```

编号是本次运行生成的值。重新执行脚本时，应使用新输出的编号；脚本会在数据库中留下测试数据。

## 持久化验证

1. 保存预约 2 的完整响应。
2. 执行 `docker compose down`，删除 API、数据库容器和项目网络，保留命名 Volume。
3. 执行 `docker compose up -d --wait`，等待两个服务健康检查通过。
4. 查询 `/api/reservations/2`，与步骤 1 的响应逐字段比较。

结果：预约内容一致，状态仍为 `ACTIVE`。Volume `cloud-native-lab1-backend_database_data` 保留，Flyway 历史包含版本 1、2，未重复插入初始场地数据。

## 容器检查

| 检查项 | 当次结果 |
|---|---|
| `api`、`database` 健康状态 | 均为 healthy |
| API 宿主机端口 | `127.0.0.1:8080` |
| 数据库宿主机端口 | 未发布 |
| API 运行用户 | `uid=10001(app) gid=10001(app)` |
| 容器主进程 | `java -jar /app/app.jar` |
| 运行镜像中的 Maven、源码目录和 Maven 缓存 | 未包含 |

测试完成后已删除独立测试数据库容器及其匿名 Volume，业务数据 Volume 保留。

## 环境问题

| 现象 | 处理与验证范围 |
|---|---|
| 宿主机 JDBC 连接 localhost 或 127.0.0.1 时出现 `UnknownHostException` | 改在 Java 21 容器中运行集成测试并通过。宿主机已验证编译打包，未完成 JDBC 联调验证；错误根因未确认。 |
| 首次从 Docker Hub 下载镜像超时 | 重试下载官方镜像后构建成功。 |
