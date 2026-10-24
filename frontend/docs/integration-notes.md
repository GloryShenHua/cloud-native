# 前端与部署的对接说明

本文件面向负责“数据库与部署集成”的同学。**本次前端交付只包含 `frontend/` 目录**：前端源码、前端 Dockerfile、Nginx 配置、本文档与报告章节。根目录的 `compose.yaml`、`.env.example` 与项目级 README 由你创建和维护，不在前端交付物内。

- [1. 构建镜像](#1-构建镜像)
- [2. 运行契约](#2-运行契约)
- [3. 浏览器 origin 与 CORS](#3-浏览器-origin-与-cors)
- [4. 参考服务定义](#4-参考服务定义仅供参考不是交付文件)
- [5. 前端不负责的部分](#5-前端不负责的部分)
- [6. 部署后自检](#6-部署后自检)
- [7. 构建环境注意事项](#7-构建环境注意事项)
- [8. 本地验证环境](#8-本地验证环境非交付物)

## 1. 构建镜像

```bash
docker build -t cloud-native-lab1-frontend:1.0.0 ./frontend
```

| 项 | 值 |
|---|---|
| 构建上下文 | `frontend/`（`Dockerfile` 在目录根部） |
| 目标阶段 | `runtime`（默认即为最后一段，可不指定） |
| 构建所需网络 | 构建阶段拉取 `node:24-alpine`、npm 依赖；运行阶段拉取 `nginx:1.29-alpine` |
| 构建参数 | 无必填参数。需要把后端地址固化进产物时才用 `--build-arg VITE_API_BASE_URL=...`（不推荐，优先用运行时变量） |
| 产物位置 | 镜像内 `/usr/share/nginx/html`（`index.html`、`assets/`、`config.js`） |
| 镜像大小 | 约 62 MB |
| `.dockerignore` | 已排除 `node_modules`、`dist`、`.env`、`docs/`、`*.md`，构建上下文很小 |

## 2. 运行契约

前端容器是一个 Nginx 静态服务器 + `/api` 反向代理，只需要下面这些约定：

| 项 | 约定 | 说明 |
|---|---|---|
| 容器端口 | `80` | 已在 Dockerfile 中 `EXPOSE 80` |
| 宿主机映射 | 建议 `127.0.0.1:${FRONTEND_PORT:-5173}:80` | 端口号由编排决定，前端不写死 |
| `API_UPSTREAM` | 默认 `api:8080` | Nginx 把 `/api/` 转发到该地址；同一 Compose 网络内就是 `服务名:端口` |
| `API_BASE_URL` | 默认 `/api` | 浏览器使用的后端地址，启动脚本写入 `config.js`。只有需要跨域直连时才改成绝对地址 |
| 健康检查 | `GET /healthz` → `200 ok` | Dockerfile 已带 `HEALTHCHECK`，编排可用 `service_healthy` |
| 网络 | 必须与 `api` 在同一个网络 | 前端只与 api 通信，不需要也不应该加入数据库网络 |
| 依赖顺序 | `depends_on: api: { condition: service_healthy }` | 官方入口脚本先写 `config.js` 再启动 nginx，启动很快 |
| 用户 | nginx master 为 root，worker 为 `nginx` 用户 | 官方 nginx 镜像的默认行为，前端不额外降权 |
| 持久化 | 无 | 前端容器无状态，不需要 Volume |

`/api` 前缀会被原样转发（`proxy_pass` 不带 URI），因此前端容器内 `curl /api/venues` 等价于直连 `http://<api>:8080/api/venues`。

## 3. 浏览器 origin 与 CORS

这是最容易踩的坑，前端不能单方面解决：

- 前端容器默认走同源 `/api`，**但浏览器对 POST 仍会发送 `Origin` 头**，Spring 的 CORS 校验照样生效；
- GET 不带 `Origin`，所以「列表能显示、提交却 403」是典型症状；
- `http://localhost:5173` 与 `http://127.0.0.1:5173` 是**两个不同的 origin**；
- 后端当前默认值（`backend/compose.yaml`、`backend/.env.example`）只包含 `http://localhost:5173`，用 `127.0.0.1` 访问会 403。

建议部署时把实际访问地址都列进 `CORS_ALLOWED_ORIGINS`：

```text
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

如果前端以后改到 `http://<服务器IP>:<端口>`，该 origin 也必须加入白名单。前端在收到 403 时会提示当前页面 origin，便于排查。

## 4. 参考服务定义（仅供参考，不是交付文件）

下面这段只是把上面的契约写成 YAML，方便直接粘贴到你自己的 `compose.yaml`，请按你的服务名、网络与端口策略调整：

```yaml
frontend:
  image: cloud-native-lab1-frontend:1.0.0
  build:
    context: ./frontend
    target: runtime
  environment:
    API_BASE_URL: /api          # 浏览器使用同源 /api
    API_UPSTREAM: api:8080      # Nginx 转发目标
  ports:
    - "127.0.0.1:5173:80"
  depends_on:
    api:
      condition: service_healthy
  restart: unless-stopped
```

数据库相关变量（`DB_*`、`POSTGRES_*`）**不要**传给前端容器；前端没有任何数据库配置。

## 5. 前端不负责的部分

| 项 | 归属 |
|---|---|
| `compose.yaml`、`.env.example`、项目级 README | 部署同学 |
| api 镜像、数据库镜像、Volume、健康检查、端口发布策略 | 部署同学 |
| 后端 CORS 默认值、`DB_*` 变量 | 后端 / 部署同学 |
| 登录鉴权、预约改期、列表总数 | 后端未提供，前端也不实现 |

## 6. 部署后自检

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/            # 200
curl -s http://localhost:5173/healthz                                      # ok
curl -s http://localhost:5173/config.js                                    # window.__APP_CONFIG__ = { apiBaseUrl: "/api" };
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/api/venues  # 200（经 Nginx 转发到 api）
```

浏览器中至少确认：场地列表有数据、创建一条预约成功、再提交同一时段返回「预约时间冲突（409）」。若第一步就失败，先看 `docker logs <前端容器>` 里 `runtime config written` 那行与 Nginx 的 `proxy_pass` 报错。

## 7. 构建环境注意事项

- **不要加回 `# syntax=docker/dockerfile:1`**：该指令会让 BuildKit 额外从 Docker Hub 拉取 frontend 镜像，在无法访问 `registry-1.docker.io` 的网络下会直接构建失败（本次已因此踩坑并移除）。
- 若构建机访问不了 Docker Hub，可先用镜像源拉取并 `docker tag` 成官方名称：`node:24-alpine`、`nginx:1.29-alpine`。`compose.yaml` 与 Dockerfile 保持引用官方镜像即可，不必改文件。
- 运行时改 `API_BASE_URL` 只需重启容器，**不需要重新构建镜像**；`config.js` 已设置 `Cache-Control: no-store`。
- 前端容器不支持被挂载覆盖 `/usr/share/nginx/html/config.js`（启动脚本每次都会重写），需要改配置请用环境变量。

## 8. 本地验证环境（非交付物）

我在本机用一个临时的三服务编排把前端 + api + postgres 全部打通，完成了截图与验收记录；该编排文件**已删除，不随前端提交**。若在本机看到下列残留，可直接丢弃：

- 项目名 `cloud-native-lab1`、网络 `cloud-native-lab1_default`、卷 `cloud-native-lab1_database_data`；
- 镜像 `cloud-native-lab1-api:1.0.0`、`cloud-native-lab1-frontend:1.0.0`。

正式部署请按你的命名重新建卷与网络，不要复用上述卷名（其中只有我验证时写入的演示数据）。
