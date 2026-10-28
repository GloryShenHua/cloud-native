# 前端部署约定

完整部署使用仓库根目录的 [compose.yaml](../../compose.yaml)，启动命令和环境变量见 [项目 README](../../README.md)。本文件说明前端与后端、数据库部署之间的约定。

## 服务与网络

| 项 | 约定 |
|---|---|
| 镜像 | `cloud-native-lab1-frontend:1.0.0` |
| 构建上下文 | `frontend/`，默认目标为 Dockerfile 的 `runtime` 阶段 |
| 容器端口 | 80，宿主机默认映射 `127.0.0.1:5173:80` |
| 通信网络 | `frontend_net`，与 `api` 共享；不加入 `backend_net` |
| 依赖 | API 健康检查通过后启动前端 |
| 健康检查 | `GET /healthz` 返回 `200 ok` |
| 持久化 | 前端无状态，不挂载数据卷 |

Nginx 托管静态文件，将 `/api/` 请求原样转发到后端。数据库连接变量只注入 API 和数据库容器，前端不接收 `DB_*` 或 `POSTGRES_*` 配置。

## 配置

| 变量 | 默认值 | 含义 |
|---|---|---|
| `API_UPSTREAM` | `api:8080` | Nginx 在容器网络中访问的后端地址，格式为主机:端口 |
| `API_BASE_URL` | `/api` | 浏览器使用的接口基础路径；启动脚本生成 `config.js` |

默认使用同源代理。选择跨域直连时，`API_BASE_URL` 必须是浏览器能够访问的地址，不能填仅容器网络能解析的 `api:8080`。URL 不能包含未编码的引号、反斜杠或控制字符，启动脚本会拒绝这类配置。

修改根目录 `.env` 后执行：

```sh
docker compose up -d frontend
```

Compose 会重新创建配置发生变化的容器；只执行 `restart` 不会加载修改后的环境变量。容器每次启动重新生成 `config.js`，该文件禁用浏览器缓存。不要挂载只读文件覆盖此路径。

本地直接构建静态产物时，可以通过 `VITE_API_BASE_URL` 配置 API 地址；Docker 构建未声明这个 build arg，容器部署使用运行时变量即可。

## 浏览器来源与 CORS

浏览器对 POST 请求携带的 `Origin` 会经过 Nginx 转发到后端。`http://localhost:5173` 和 `http://127.0.0.1:5173` 是不同来源，应分别加入白名单。

根目录 Compose 默认允许两个 5173 地址及 `http://localhost:3000`。单独使用 `backend/compose.yaml` 时，默认仅允许 localhost 的 5173 和 3000；实际访问地址不同时，应配置 `CORS_ALLOWED_ORIGINS` 并重新创建 API 容器。

403 的页面提示为“暂时无法提交”。具体原因通过浏览器网络面板与 API 日志排查，页面不显示环境变量名和服务内部信息。

## 构建与排查

```sh
# 仓库根目录
docker build -t cloud-native-lab1-frontend:1.0.0 ./frontend
docker compose logs frontend api
curl -fsS http://localhost:5173/healthz
curl -fsS http://localhost:5173/config.js
curl -fsS http://localhost:5173/api/venues
```

构建需要访问 Docker 镜像仓库和 npm 包仓库。遇到下载超时先确认网络和镜像缓存，再重试。项目未使用额外的 Dockerfile 语法解析器镜像。

`cloud-native-lab1_database_data` 是根目录 Compose 的正式数据库卷，保存当前预约数据；`cloud-native-lab1-backend_database_data` 属于后端独立开发编排。两者不能当作临时缓存清理。普通停止使用 `stop` 或 `down`，不附加 `-v`。
