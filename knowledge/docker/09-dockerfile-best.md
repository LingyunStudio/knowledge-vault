---
title: Dockerfile 最佳实践
order: 9
tags: 进阶, 最佳实践, 瘦身
summary: 选基础镜像、层缓存友好的写法顺序、多阶段构建实例、.dockerignore。
---

基础篇讲过每条指令一层、缓存逐条匹配。这一篇把零散规则收拢成一套可以照抄的工程实践：基础镜像怎么挑、依赖和源码怎么排、多阶段构建怎么写、构建上下文怎么瘦身。目标只有三个——镜像小、构建快、可复现。

## 选对基础镜像

基础镜像决定下限，一张表说清常见选择：

| 基础镜像 | 体积 | 说明 |
| --- | --- | --- |
| python:3.12 | ~1 GB | 完整 Debian，调试方便，生产嫌大 |
| python:3.12-slim | ~120 MB | 精简 Debian，**多数场景的首选** |
| python:3.12-alpine | ~50 MB | musl libc，小但兼容性有坑 |
| golang:1.23 → scratch | 最终几 MB | 静态编译 + 空镜像，Go 专属福利 |
| distroless | ~20 MB | 只有运行时没有 shell，攻击面最小 |

alpine 的坑值得单独说：它用 musl 而非 glibc，部分预编译依赖（Python 的 C 扩展 wheel、原生 Node 模块）不兼容或要自己编译；DNS 解析行为历史上有差异；没有 bash（用 sh）。纯 Go/Rust 静态编译用它很香；Python/Node 项目先测再上，别为省几十 MB 赌兼容性。

```dockerfile
# ❌ 永远追最新，构建不可复现
FROM node

# ✅ 锁定大版本，升级是显式动作
FROM node:22-slim
```

> [!TIP]
> 锁版本指的是"不自动漂移"，不是"永不升级"——安全补丁不会自动进你的镜像。CI 里加一条定期重建流水线，或用 dependabot 类工具盯 FROM 行的更新。

## 层缓存友好的写法

原则在 [Dockerfile](04-dockerfile.md) 篇讲过：越常变的越靠后。落到 Node 项目上就是一个固定模板：

```dockerfile
FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json ./    # 1. 只拷依赖清单
RUN npm ci                                # 2. 装依赖（独立成层，源码变了也不重跑）
COPY . .                                  # 3. 最后拷源码
CMD ["node", "server.js"]
```

改一行业务代码，重建只执行第 3 步以后的部分，秒级完成。反例是把 `COPY . .` 放在 `npm ci` 之前——任何文件一动，依赖全部重装，几分钟的构建就是这么来的。

同一层内"造的垃圾同层清"，apt 是最典型的场景：

```dockerfile
# ✅ update/install/清理一条龙，缓存不落层
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*
```

pip 用 `--no-cache-dir`，npm 生产用 `npm ci --omit=dev`；Go/Rust 可以用 BuildKit 的缓存挂载把构建缓存放到层外——构建照常加速，镜像一点不胖：

```dockerfile
RUN --mount=type=cache,target=/root/.cache/go-build \
    go build -o /bin/app ./cmd/server
```

## 多阶段构建

编译型语言的痛点：编译需要 gcc 和完整工具链，运行时只需要一个二进制。多阶段构建用多个 FROM 解决——前面的阶段负责构建，最后的阶段只留产物：

```dockerfile
# ---- 阶段一：构建 ----
FROM golang:1.23 AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download                    # 依赖层独立，源码变更不重下
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /bin/app ./cmd/server

# ---- 阶段二：运行 ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata   # 只装运行时必需品
COPY --from=builder /bin/app /bin/app  # 只从构建阶段拷二进制
ENTRYPOINT ["/bin/app"]
```

效果对比：直接在 golang:1.23 里跑同一个应用，镜像 800 MB 起步；两阶段之后 15 MB 左右。工具链、源码、依赖缓存全部留在 builder 阶段，根本不进最终镜像。

Python/Node 有对应套路：builder 阶段把依赖装进 venv 或 node_modules，运行阶段只 COPY 这些目录加源码。前端更典型——builder 里 `npm run build`，运行阶段只剩一个 nginx 和静态文件：

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
```

> [!NOTE]
> 判断要不要多阶段：最终镜像里出现了编译器、构建缓存、开发工具，就该拆。`docker history 镜像名` 看到几百 MB 的 gcc 层就是明确信号。

## .dockerignore

构建上下文整个发给 daemon，`COPY . .` 又容易把杂物拷进镜像——.dockerignore 从源头掐断。放在上下文根目录，语法同 .gitignore：

```text
.git
node_modules
target
dist
*.log
.env
.env.*
tests/
docs/
Dockerfile
.dockerignore
```

收益有三层：上下文小，构建启动快；`COPY . .` 不会把 .env、本地构建产物带进镜像；本机的 node_modules 不进上下文，容器内的依赖以 RUN 安装的那份为准——跨平台的原生模块（macOS 构建出 Linux 镜像）尤其不能让宿主机的依赖混进来。

> [!WARNING]
> `.env` 被 COPY 进镜像 = 把密码发布出去，push 之后删镜像也救不回来——层是公开可下载的。日常习惯：构建输出里 `transferring context` 的大小超过几十 MB，通常意味着没 ignore 干净，先查再建。

## 其余值得固化的习惯

- **非 root 运行**：`RUN useradd -m appuser` + `USER appuser`，容器被攻破时少一层权限
- **一个容器一个职责**：别把 nginx、应用、cron 塞进一个镜像，日志和生命周期都会变难
- **COPY 指名道姓**：`COPY app/ ./app/` 优于 `COPY . .`，意外变更的影响范围可控
- **exec 形式启动命令**：信号能直达 PID 1，`docker stop` 才优雅
- 本地跑一遍 lint：`hadolint Dockerfile`，低效写法和常见坑它都能揪出来

## 照抄模板

把上面所有点拼成一个 Python 服务的生产模板：

```dockerfile
FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
RUN useradd -m appuser && chown -R appuser /app
USER appuser

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

相关阅读：[Dockerfile](04-dockerfile.md)、[调试与运维](10-debug-ops.md)
