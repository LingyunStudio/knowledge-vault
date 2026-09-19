---
title: Dockerfile 精进：多阶段与生产素养
order: 9
tags: 多阶段构建, alpine, distroless, 非 root, hadolint
summary: 镜像瘦身三件套（小基础镜像/多阶段构建/同层清理）、多阶段构建的完整形态与缓存挂载、生产安全素养（非 root、只读文件系统、秘密零镜像）、hadolint 静态检查，以及一个生产级镜像的完整打磨过程。
---

「能跑的 Dockerfile」与「生产的 Dockerfile」之间隔三个台阶：**镜像体积**（拉取/部署速度、攻击面）、**安全身份**（非 root、无秘密）、**可维护性**（可复现、可检查）。本篇把这三个台阶走完——多阶段构建是其中的核心技巧。

## 1. 瘦身第一步：基础镜像的选择

| 基础镜像           | 大小       | 内容                      | 取舍                       |
| ------------------ | ---------- | ------------------------- | -------------------------- |
| `ubuntu:24.04`     | ~78MB      | 完整发行版                 | 兼容性最好、体积最大        |
| `debian:bookworm-slim` | ~74MB  | 裁剪版                     | 兼容与体积的平衡（常用）    |
| `node:20-alpine`   | ~50MB 基底 | musl libc 的迷你发行版     | 小但 musl 兼容性有坑（C 扩展）|
| `gcr.io/distroless/nodejs` | ~30MB | **无 shell 无包管理器**，只有运行时 | 最小攻击面；无 shell 可调     |
| `scratch`          | 0          | 空镜像（静态编译程序的容器）| Go/Rust 静态二进制的极致     |

选型逻辑：**语言运行时镜像的 alpine/slim 变体是默认起点**；C 扩展依赖重的（Python 的 numpy 等）警惕 musl 兼容性（改用 slim 版 Debian）；对安全要求极高的生产（对外暴露服务）上 distroless——没有 shell 意味着攻击者进来也无处下手。`scratch` + 静态编译（Go: `CGO_ENABLED=0`）是体积的终极形态。

## 2. 多阶段构建：编译环境与运行环境分离

问题的本质：**构建需要编译器与依赖源，运行只需要二进制与运行时**——把两者混在一个镜像里，就是把 gcc、构建缓存、源码全部带上了生产。

```dockerfile
# ── 阶段一：构建 ──
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build            # 产出 dist/（编译产物）

# ── 阶段二：运行 ──
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist      # ★ 只搬走产物！
COPY --from=build /app/node_modules ./node_modules
USER node
CMD ["node", "dist/server.js"]
```

`--from=build` 从构建阶段**只拷贝需要的产物**——node_modules 的 devDependencies、源码、npm 缓存、git 历史全部留在第一阶段被丢弃。效果：镜像从 1.2GB 到 180MB 级别；攻击面同步缩小（生产里没有编译器）。

### 2.1 用 target 复用：测试在构建里

```dockerfile
FROM base AS test
RUN npm run test

FROM base AS production
...
```

```bash
docker build --target test .          # CI 里跑测试阶段
docker build --target production .    # 部署构建生产阶段
```

一个 Dockerfile 多个用途：**CI 的测试阶段与生产阶段共享前几层的缓存**——「测试用的环境 = 生产的环境」由同一构建保证（构建即测试环境，漂移归零）。

### 2.2 BuildKit 缓存挂载：构建加速的现代答案

```dockerfile
# 语法检查要求 # syntax 指令启用 BuildKit 特性
# syntax=docker/dockerfile:1
RUN --mount=type=cache,target=/root/.npm \
    npm ci                            # npm 缓存存进缓存挂载，不进镜像层！
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y curl
```

`--mount=type=cache` 解决了「缓存要留（加速）与缓存要清（瘦身）」的矛盾：**缓存活在构建器里，不进镜像层**——上一版「同层清理」的更优解。

## 3. 安全素养：非 root 与秘密零镜像

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY --chown=node:node . .        # 文件属主直接对齐
USER node                          # ★ 之后的一切以 node 身份运行
```

非 root 的必要性：容器内的 root 在内核层面就是 root（uid 0）——逃逸漏洞或挂载失误时破坏力完整；`USER node` 让进程的破坏半径缩小到容器可写层与挂载卷的权限。

配套的运行时加固（run/compose 层面）：

```yaml
services:
  web:
    read_only: true                # 根文件系统只读（写需求走显式卷）
    tmpfs: ["/tmp"]
    cap_drop: [ALL]                # 丢弃全部 Linux capabilities
    security_opt: ["no-new-privileges:true"]
```

秘密的清单核对（[第 4 篇](04-dockerfile.md)）：ENV 无秘密、ARG 无秘密、日志无秘密、.dockerignore 挡住 .env——秘密只存在于运行时注入（-e/compose secret/平台 KMS）。

```bash
# 静态检查：hadolint —— Dockerfile 的 shellcheck
hadolint Dockerfile
# DL3008: Pin versions in apt-get install    ← 版本钉住建议
# DL3006: Always tag the version of an image
```

hadolint 与 [shellcheck](../linux/06-shell-scripting.md)、[clang-tidy](../c/13-tools-debugging.md) 是同族：**静态规则把「最佳实践」从评审共识变成机器裁决**——进 pre-commit/CI。

## 4. 生产级镜像的完整样例（Go）

```dockerfile
# syntax=docker/dockerfile:1

FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download
COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -ldflags="-s -w" -o /bin/app .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /bin/app /app
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/app"]
```

五个产线的决策点都在这里：**依赖下载与编译双缓存**（BuildKit）、`-ldflags="-s -w"`（去调试信息瘦身）、**distroless + 静态二进制**（无 shell 无 libc 依赖、约 20MB）、**nonroot 用户**、ENTRYPOINT exec 形式。这个形态是「Go 微服务镜像」的社区标准答案。

## 5. 陷阱清单

- 单阶段构建把编译器/源码/devDeps 带上生产：多阶段是标配不是优化。
- alpine 上装 C 扩展失败（musl）：换 slim/debian 系；「小」不是唯一目标。
- distroless 里 exec sh 调试（没有 shell）：调试用 ephemeral 伴生容器（[第 6 篇](06-networks.md)的 netshoot 思路）。
- COPY --chown 遗漏：非 root 进程读不了自己的应用文件。
- 多阶段的测试层不接 CI：测试环境与生产环境漂移；--target 复用。
- .dockerignore 缺失导致源码/秘密进上下文：第一个要写的文件。
- 忘了 -ldflags 瘦身与静态编译参数：scratch/distroless 跑不起来（动态链接）。

## 6. 小结

- 瘦身三件套的层次：基础镜像选择（alpine/slim/distroless/scratch）→ 多阶段构建（只带产物）→ 缓存挂载（缓存不进层）——三者叠加从 GB 到 20MB。
- 多阶段是「构建环境与运行环境的职责分离」：--from 搬产物、--target 复用测试、缓存挂载解「加速与瘦身」的矛盾。
- 安全素养四件：USER 非 root、read_only+cap_drop 运行时加固、秘密零镜像、hadolint 静态门禁。
- distroless/scratch 的调试形态变化（无 shell）：伴生工具容器是新时代的排障姿势。
- Go 静态二进制 + distroless 是「镜像极简主义」的终点形态；解释型语言的多阶段终点是「运行时 + 依赖 + 产物」。

## 7. 练习

**1.** 给一个应用做「瘦身三部曲」实测：单阶段 Debian 版 → 多阶段 + alpine 版 → 极限版（distroless/scratch 或 slim+产物），记录三版镜像大小、启动时间、行为差异。

> [!TIP]
> 思路记录表的维度：大小/层数/可调试性（有无 shell）/兼容性坑。三版的递进让「每一步优化换来了什么、付出了什么」变成自己的量化结论。

**2.** 把测试阶段接进构建：Dockerfile 加 test target（跑单元测试），CI 里 `--target test` 失败则阻断——验证「测试环境=生产基础」的保证链。

> [!TIP]
> 思路关键收益：测试跑在与生产完全相同的镜像层上（同基础镜像同依赖解析）——「本地能跑 CI 挂」的环境类失败归零。

**3.** 安全加固实战：给现有镜像加 USER 非 root、compose 层加 read_only/cap_drop/no-new-privileges，跑通应用；故意找一个需要 root 的行为（如写 /etc）验证加固生效。

> [!TIP]
> 思路加固的调试循环：应用报权限错误 → 检查哪些路径需要写 → 显式挂卷或 tmpfs 补写点。加固不是开关而是「给最小写权限」的设计过程。

**4.** hadolint 全量体检你写过的 Dockerfile，逐条修复 DL 警告并理解每条规则背后的机制（对照[第 4 篇](04-dockerfile.md)）——把 lint 规则翻译成自己的检查清单。

> [!TIP]
> 思路高频规则与机制对应：DL3008（钉版本→可复现）、DL3016（pip 钉版本→同上）、DL3025（用 exec 形式→信号）、DL3059（连续 RUN→可合并）。理解机制后规则不再是束缚。

**5.** 用 BuildKit 缓存挂载改造一个 Python/Node 项目的依赖安装层，对比改造前后（同代码反复构建）的耗时——验证「缓存不进层」的双重收益。

> [!TIP]
> 思路对照实验：老方案（rm -rf 缓存同层）重装耗时 vs 新方案（cache mount）秒级。两个收益：构建快 + 镜像小（缓存本来就不进层）。

**6.** 讨论：镜像体积与构建速度、可调试性之间的三角权衡——distroless 放弃了什么、多阶段放弃了什么？从「生产与开发是否应该同镜像」引出 dev/prod 镜像分裂的管理策略（compose override 的 [Dockerfile target](07-compose.md)）。

> [!TIP]
> 思路distroless 放弃 shell 调试换取攻击面最小；多阶段放弃「所见即所得」（产物层不可见）换取体积。管理策略：同一 Dockerfile 的 target 分层 + override 挂调试工具——「一套配方、两种形态」是漂移与便利的平衡解。
