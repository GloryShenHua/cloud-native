# 场地预约系统 · 前端

Lab 1 的第三层：浏览器 → **frontend（本目录）** → api → database。前端只通过 HTTP 调用后端 Web API，不直接连接数据库，也不作为预约冲突的唯一判定方。

技术栈：React 19 + TypeScript + Vite 8 + React Router 7，构建产物由 Nginx 1.29 提供访问，并把 `/api` 反向代理到 `api:8080`。

- [快速开始](#快速开始)
- [目录结构](#目录结构)
- [后端地址的三种配置方式](#后端地址的三种配置方式)
- [页面与接口对应关系](#页面与接口对应关系)
- [容器镜像](#容器镜像)
- [验收对照](#验收对照)
- [已知限制](#已知限制)

## 快速开始

### 一、只跑前端（连接本机已启动的后端）

```bash
# 终端 1：启动后端与数据库（backend 目录）
cd backend
cp .env.example .env        # 首次运行
docker compose up --build -d --wait

# 终端 2：启动前端开发服务器（frontend 目录）
cd ../frontend
pnpm install
pnpm dev                    # http://localhost:5173
```

开发服务器把 `/api` 代理到 `http://127.0.0.1:8080`，浏览器侧是同源请求。但浏览器仍会在 POST 时带上 `Origin`，后端 CORS 白名单必须包含**地址栏里的 origin**：`http://localhost:5173` 与 `http://127.0.0.1:5173` 是两个不同的 origin。建议用 <http://localhost:5173> 打开；若要用 `127.0.0.1` 访问，需要后端在 `CORS_ALLOWED_ORIGINS` 里补上该地址（当前后端默认值只有 `localhost`，见[部署对接说明](docs/integration-notes.md#3-浏览器-origin-与-cors)）。

后端不在默认端口时：

```bash
VITE_API_PROXY_TARGET=http://127.0.0.1:8081 pnpm dev
```

### 二、只运行前端容器（本地验证前端产物）

```bash
docker build -t cloud-native-lab1-frontend:1.0.0 .
docker run --rm -p 127.0.0.1:5173:80 \
  --network <api 所在的 compose 网络> \
  -e API_UPSTREAM=api:8080 \
  cloud-native-lab1-frontend:1.0.0
# 浏览器打开 http://localhost:5173
```

前端容器需要与 `api` 在同一个 Docker 网络，并通过 `API_UPSTREAM`（`主机:端口`）访问它；没有 api 网络时也可以临时用 `-e API_UPSTREAM=host.docker.internal:8080` 指向宿主机上暴露的 API。完整的三服务编排、数据库与端口策略由**部署同学**负责，前端这边只需要下面这几个约定：[部署对接说明](docs/integration-notes.md)。

## 目录结构

```text
frontend/
├── src/
│   ├── api/
│   │   ├── client.ts          # fetch 封装、ApiError、错误码到提示文案的映射
│   │   └── types.ts           # Venue / Reservation 等接口类型
│   ├── components/
│   │   ├── BookingForm.tsx    # 创建预约表单与失败提示
│   │   ├── Badge.tsx          # 场地状态 / 预约状态徽标
│   │   ├── Feedback.tsx       # 加载中、空状态、错误横幅
│   │   ├── Layout.tsx         # 顶栏、导航、页脚
│   │   └── ToastProvider.tsx  # 全局轻提示
│   ├── lib/format.ts          # 时间、日期、状态文案
│   ├── pages/
│   │   ├── VenuesPage.tsx     # 场地列表 + 新建场地
│   │   ├── VenueDetailPage.tsx# 场地详情 + 创建预约 + 预约成功
│   │   ├── ReservationsPage.tsx# 预约记录 + 筛选 + 分页 + 取消 + 详情
│   │   └── NotFoundPage.tsx
│   ├── config.ts              # 后端地址解析（运行时 → 构建期 → 同源）
│   ├── App.tsx                # 路由表
│   ├── main.tsx
│   └── styles.css             # 全部样式，无 UI 框架依赖
├── public/config.js           # 运行时配置占位，容器启动时被覆盖
├── docker/40-runtime-config.sh# 启动脚本：把 API_BASE_URL 写进 config.js
├── nginx/default.conf.template# 静态文件 + /api 反向代理 + SPA 回退
├── docs/
│   ├── frontend-report.md     # 实验报告的前端章节
│   ├── integration-notes.md   # 交给部署同学的对接说明
│   └── screenshots/           # 界面截图
├── Dockerfile                 # node 构建 → nginx 运行
└── vite.config.ts
```

## 后端地址的三种配置方式

| 方式 | 配置项 | 生效时机 | 适用场景 |
|---|---|---|---|
| 同源反向代理（默认） | 无需配置，浏览器请求 `/api` | 运行时 | 容器部署，Nginx 转发到 `api:8080` |
| 运行时环境变量 | 容器环境变量 `API_BASE_URL` | 容器启动 | 换后端地址只需重启容器，不重新构建镜像 |
| 构建期变量 | `VITE_API_BASE_URL` | `pnpm build` 时 | 前端产物直接部署到其他域名，直连后端 |
| 开发期代理 | `VITE_API_PROXY_TARGET` | `pnpm dev` 时 | 本地连接非默认端口的后端 |

解析顺序为：`window.__APP_CONFIG__.apiBaseUrl`（运行时）→ `import.meta.env.VITE_API_BASE_URL`（构建期）→ `/api`。顶栏右侧会显示当前生效的地址，鼠标悬停可看到来源，便于排查“前端连错环境”。

选择绝对地址直连时，浏览器会产生跨域请求，需要把前端 origin 加入后端的 `CORS_ALLOWED_ORIGINS`。

## 页面与接口对应关系

| 页面 / 操作 | 接口 | 说明 |
|---|---|---|
| 场地列表 | `GET /api/venues` | 卡片展示名称、位置、容纳人数、开放时间、状态 |
| 场地详情 | `GET /api/venues/{id}` | 进入 `/venues/{id}` 时加载 |
| 新建场地 | `POST /api/venues` | 列表页“新建场地”折叠表单，成功后刷新列表 |
| 创建预约 | `POST /api/reservations` | 详情页表单，成功显示预约对象与 201 提示 |
| 当日已占用时段 | `GET /api/reservations?venueId&date&status=ACTIVE` | 仅作时间参考，冲突仍由后端判定 |
| 预约记录 | `GET /api/reservations?venueId&date&status&limit&offset` | 筛选 + 每页 20 条分页 |
| 预约详情 | `GET /api/reservations/{id}` | 表格“详情”按钮打开弹窗 |
| 取消预约 | `POST /api/reservations/{id}/cancel` | 二次确认后调用，成功后刷新列表 |

失败提示按 HTTP 状态与 `error.code` 区分，业务分支不使用文案匹配：

| 状态 / 错误码 | 界面表现 |
|---|---|
| 409 `RESERVATION_CONFLICT` | “预约时间冲突”错误条 + 自动刷新当日已占用时段 |
| 400 `INVALID_ARGUMENT` | “请求参数有误”，`details` 中的字段错误标红到对应输入框 |
| 404 `NOT_FOUND` | “资源不存在”，提示刷新列表 |
| 503 `DATABASE_UNAVAILABLE` | “数据库暂不可用”，提示稍后重试 |
| 500 `INTERNAL_ERROR` / 其他 | “服务端内部错误”，提示查看 `api` 日志 |
| 网络不可达 | “无法连接后端”，并在页面上显示当前 API 地址 |

## 容器镜像

```bash
docker build -t cloud-native-lab1-frontend:1.0.0 .   # 独立构建，上下文只有本目录
docker image inspect cloud-native-lab1-frontend:1.0.0 --format '{{.Size}}'  # 约 62 MB
```

镜像分两段：`node:24-alpine` 安装依赖并编译静态文件，`nginx:1.29-alpine` 只保留构建产物、Nginx 配置和启动脚本。运行阶段不含 Node、依赖缓存与源码；`.dockerignore` 排除了 `node_modules`、`dist`、`.env` 与文档。

容器内行为：

- `40-runtime-config.sh` 在 Nginx 启动前把 `API_BASE_URL` 写入 `/usr/share/nginx/html/config.js`；
- `default.conf.template` 由官方入口脚本用 `envsubst` 渲染，把 `/api/` 转发到 `${API_UPSTREAM}`；
- `/healthz` 返回 200 供容器健康检查使用；
- `/assets/` 命中带哈希的文件，长期缓存；`config.js` 禁止缓存；其余路径回退到 `index.html` 以支持前端路由刷新。

运行参数（端口、变量、依赖顺序、CORS）见[部署对接说明](docs/integration-notes.md)。

## 验收对照

作业“四、前端要求”的 7 项交互：

| 要求 | 实现位置 |
|---|---|
| 展示场地列表 | `/`，`VenuesPage` |
| 查看场地基本信息 | `/venues/{id}`，`VenueDetailPage` 顶部信息卡 |
| 创建场地预约 | `BookingForm` |
| 展示预约记录 | `/reservations`，`ReservationsPage` |
| 取消预约 | 表格“取消”按钮 → `POST /api/reservations/{id}/cancel` |
| 显示预约成功信息 | 详情页“预约成功”卡片 + 右上角轻提示 |
| 显示冲突 / 参数错误等失败信息 | 表单内错误条（含 HTTP 状态与 `error.code`）、字段级标红、轻提示 |

其他硬性要求：

| 要求 | 做法 |
|---|---|
| 通过 HTTP 调用后端 API | `src/api/client.ts` 使用 `fetch` |
| 不直接连接数据库 | 前端无任何数据库驱动或 SQL |
| 不在前端实现唯一的冲突判断 | 前端只做必填与时间先后校验；时段重叠一律由后端在事务中判定并返回 409 |
| 后端地址可配置 | 同源代理 / 运行时 `API_BASE_URL` / 构建期 `VITE_API_BASE_URL` |
| 页面能完成业务操作即可 | 无 UI 框架，样式集中在 `styles.css` |

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 列表能看到数据，但提交预约返回 403、响应体为空 | 浏览器 `Origin` 不在后端 `CORS_ALLOWED_ORIGINS` 中。GET 不带 `Origin` 所以列表正常，POST 带 `Origin` 被 Spring 拒绝。把地址栏里的 origin（`localhost` 与 `127.0.0.1` 要分别列出）加入白名单后重启 api |
| 页面显示“无法连接后端服务（/api）” | 前端容器访问不到 `api`：确认 api 容器健康（`docker ps`）、`API_UPSTREAM` 与网络正确；`docker logs <api 容器>` 查看启动日志 |
| 刷新 `/venues/1` 出现 404 | 反向代理缺少 SPA 回退；Nginx 配置应包含 `try_files $uri $uri/ /index.html` |
| `docker build` 卡在拉取基础镜像 | 网络无法访问 Docker Hub，可配置镜像加速源；`# syntax=docker/dockerfile:1` 也会触发外网拉取，本项目已移除该指令 |
| 改了 `API_BASE_URL` 但页面地址没变 | `config.js` 由容器启动脚本生成，需要重启（或重建）前端容器；浏览器侧已对该文件禁用缓存 |

## 已知限制

- 后端当前没有登录鉴权与改期接口，前端也没有用户体系与登录页。
- 列表分页使用 `limit`/`offset`，页面没有“总条数”，通过“下一页是否可点”判断是否还有数据。
- 前端的时间输入精度为分钟，后端允许到秒但页面只提交 `HH:mm`。
- 预约冲突的最终判定完全依赖后端；前端展示的“当日已占用时段”仅为提示。

## 常用命令

```bash
pnpm dev        # 开发服务器 http://127.0.0.1:5173
pnpm typecheck  # tsc --noEmit
pnpm build      # 类型检查 + 生产构建
pnpm preview    # 预览 dist/（同样代理 /api）
```
