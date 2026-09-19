---
title: Compose：多容器的声明式编排
order: 7
tags: compose, yaml, depends_on, healthcheck, 多服务
summary: compose.yml 的完整解剖（services/build/ports/volumes/networks/env）、depends_on 与 healthcheck 的启动顺序控制、命令族与项目隔离、overrides 的环境分层，以及一个 web+db+cache 三层应用的全量配置解读。
---

单容器是热身，真实应用是一组协作容器（应用 + 数据库 + 缓存 + 反向代理）。**Compose** 用一个 YAML 声明整组容器与它们的网络、卷、依赖关系，`docker compose up` 一键起全套——它把「部署步骤」变成了「声明文件」（可进 git、可 review、可复现）。

## 1. compose.yml 解剖：三层应用

```yaml
# compose.yml —— 一个典型的 web + db + cache 栈
services:
  web:                                # 服务名 = 容器名 = 网络内 DNS 名（[第 6 篇](06-networks.md)）
    build: .                          # 从 Dockerfile 构建（生产用 image: 拉取）
    image: myapp:1.0                  # 构建后打的名字
    ports:
      - "8080:3000"                   # 对外暴露的端口
    environment:                      # 环境变量（内联）
      - NODE_ENV=production
    env_file:                         # 或整文件注入（.env 不进 git！）
      - .env
    depends_on:
      db:
        condition: service_healthy    # ★ 等 db 健康才启动（不只是「先启动」）
    networks: [frontend, backend]
    restart: unless-stopped
    volumes:
      - ./src:/app/src                # 开发挂载
      - uploads:/app/uploads          # 持久卷

  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}    # 从 .env 读（模板变量）
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:                      # ★ 健康检查：compose 判定「真的就绪」
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5
    networks: [backend]

  cache:
    image: redis:7-alpine
    networks: [backend]

volumes:                              # 声明卷（compose 项目前缀命名）
  pgdata:
  uploads:

networks:
  frontend:                           # web 在此，db 不在
  backend:                            # db/cache/web 在此 —— web 直连不到 db 之外
```

这份配置的每个字段都在回答[前几篇](06-networks.md)的问题：服务名即 DNS、卷解耦生命周期、双网络做隔离、healthcheck 让依赖「等真的就绪」。**compose.yml 就是应用架构图**——读一份好的 compose 文件等于读懂整个部署拓扑。

## 2. depends_on 与 healthcheck：启动顺序的真相

```yaml
depends_on:
  - db                    # 只保证「启动顺序」（db 先 create）——不保证 db 已就绪！
depends_on:
  db:
    condition: service_healthy    # 等 healthcheck 通过才启动 web
```

初学者第一大坑：**「容器启动」≠「服务就绪」**。postgres 容器 1 秒启动，但数据库初始化要 5 秒——web 连不上库的应用报错不是 Docker 的问题，是「就绪判定」没做。三层解法（按推荐顺序）：

1. **healthcheck + condition: service_healthy**（声明式等待）；
2. **应用层重试**（连接失败退避重连——生产代码的标配韧性）；
3. 应用入口脚本轮询等待（`until pg_isready; do sleep 1; done`）。

## 3. 命令族

```bash
docker compose up -d              # 起全套（自动建网络/卷、按依赖顺序启动）
docker compose up -d --build      # 先重建镜像再起（代码变了必须带 --build）
docker compose down               # 停并删容器与网络（卷默认保留！）
docker compose down -v            # ⚠️ 连卷一起删（数据没了——开发环境重置用）

docker compose ps                 # 本项目的容器状态
docker compose logs -f web        # 单服务日志；logs -f 全部
docker compose exec web sh        # 进入某服务
docker compose build              # 只构建
docker compose pull               # 只拉镜像
docker compose restart web        # 重启单服务
docker compose config             # 校验并展开最终配置（模板变量已代入——排错利器）
```

**项目名与隔离**：目录名成为 compose 项目名（`myproject-web-1` 的容器命名、独立网络与卷前缀）——同一 compose 文件在两个目录起两套互不干扰的环境。`-p othername` 显式指定；`docker compose ls` 列出活跃项目。

## 4. 环境分层：override 与 profiles

```yaml
# compose.override.yml —— 自动叠加（同目录下 up 时自动合并）
services:
  web:
    build: { target: dev }        # 开发用带调试工具的构建阶段
    volumes:
      - ./src:/app/src            # 开发挂载源码
    environment:
      - DEBUG=1
```

compose 自动合并 `compose.yml`（基底，生产形态）+ `compose.override.yml`（本地开发差异）——**基底写生产真相、override 写开发便利**。显式选择：`docker compose -f compose.yml -f compose.prod.yml up -d`。

```yaml
# profiles：可选服务（调试工具、压测）
services:
  adminer:
    image: adminer
    profiles: [debug]             # 默认不起；--profile debug 才启动
```

## 5. 实战：开发环境的完整工作流

```bash
# 日常循环
docker compose up -d
docker compose logs -f web                 # 看应用日志
vim src/server.js                          # 改代码（bind mount 热重载，[第 5 篇](05-volumes.md)）
docker compose exec web npm test           # 进容器跑测试
docker compose down && docker compose up -d --build    # 需要新依赖时重建
```

compose 的甜区判断：**单机、团队内部、几个服务的应用**——它是「一套服务器上跑整个栈」的答案。何时升级 K8s：多机调度、滚动发布、自动扩缩容、跨节点网络——需求出现再上（[第 1 篇](01-why-containers.md)的演进正道），compose 的配置概念（服务/网络/卷/健康检查）在 K8s 里全部对应存在，学习不浪费。

## 6. 陷阱清单

- 代码改了但容器没变：没 --build；「up 不会自动重建镜像」。
- `down -v` 当常规操作：卷里是生产数据时就是事故；-v 只用于开发重置。
- depends_on 不加 condition：以为等了就绪其实只等了启动；healthcheck 配起来。
- .env 提交进 git：密码泄露；.env 进 .gitignore、.env.example 进库（[git 篇](../git/02-daily-workflow.md)）。
- 单网络放全部服务：数据库暴露给前端容器；双网络隔离。
- compose 里 build 与 image 同时用没理解：build 产生 image 名——生产把 image 换成 registry 引用（[第 8 篇](08-registry.md)）。
- 服务名与容器名混淆：compose 容器的实际名字带项目前缀，DNS 名是服务名。

## 7. 小结

- compose.yml 是应用架构的声明：服务（=DNS 名）、双网络隔离、卷解耦、healthcheck 定义就绪、depends_on condition 串依赖——「读配置即读架构」。
- 启动顺序的真相：容器启动 ≠ 服务就绪；healthcheck+condition 是声明式解法，应用重试是韧性兜底。
- 命令族围绕 up/down/logs/exec/config 展开；`--build` 与 `-v` 的危险语义要刻住；config 是模板变量的展开验证器。
- 环境分层：override 自动叠加开发差异、profiles 管可选服务、.env 管秘密（不进 git）。
- compose 与 K8s 是同一概念的两种规模：服务/网络/卷/健康检查的概念一一对应，先 compose 后 K8s 是顺滑演进。

## 8. 练习

**1.** 从零搭一个三服务栈：web（简单 HTTP 应用）+ db（postgres）+ cache（redis），配双网络、健康检查、持久卷——用 [第 6 篇](06-networks.md)的方法验证 web 能解析 db、cache 不可从 web 外访问。

> [!TIP]
> 思路配置直接抄本篇第 1 节骨架改应用。验证三连：exec web 里 `getent hosts db`（DNS）、`nc -zv cache 6379`（通不通）、`db` 的端口外部不通（未 -p）。

**2.** 健康检查实验：web 用 condition: service_healthy 依赖 db，先不配 db 的 healthcheck（启动报错循环），再配上观察就绪等待——用 compose logs 记录两次行为差异。

> [!TIP]
> 思路错误形态：web 反复重启连不上库。配上后 web 的启动延迟到 db healthy——日志时间戳的对比就是「启动顺序真语义」的证据。

**3.** 做 dev/prod 双环境：基底 compose.yml 用 image、compose.override.yml 加 build+挂载+DEBUG——验证 `up`（开发形态）与 `-f compose.yml up`（生产形态）的差异。

> [!TIP]
> 思路override 合并是「字段级」的（列表类字段可能拼接）——`docker compose config` 看最终合并结果，对理解合并语义最快。

**4.** 故意踩三个坑并修复：改代码不 --build、.env 带 POSTGRES_PASSWORD 提交 git（用 git rm --cached 补救）、down -v 删库——每个坑记录「现象→定位→修复→预防」。

> [!TIP]
> 思路预防措施：README 写清工作流命令、pre-commit 检查 .env（[git 篇](../git/09-hooks-automation.md)）、生产禁用 -v 的文档约定。坑的记录比坑的修复更值钱。

**5.** 用 compose 完整跑一遍 [第 8 篇](08-registry.md)的发布链：本地 compose 构建 → tag → push 到 registry → 另一目录用纯 image 引用的 compose.yml 拉起——体验「开发栈到交付栈」的切换。

> [!TIP]
> 思路开发 compose（build）与交付 compose（image）分离是团队的标准形态——前者在开发者机器、后者在部署目标。理解切换点就理解了 CI/CD 的第一段。

**6.** 讨论：compose 的健康检查与 [k8s 的 readiness probe](../linux/07-processes.md)、[systemd 的 Type=notify](../linux/07-processes.md) 是同一问题的三种解。从「就绪判定」的通用性分析：为什么所有编排系统都需要它，而裸 docker run 没有？（引出「编排系统管什么」的边界）

> [!TIP]
> 思路裸 docker run 是「单进程管理者」（只知道进程活没活）；编排系统管理「服务依赖图」——就绪判定是依赖调度的输入。健康检查是「从进程管理到服务编排」的分水岭指标——这个概念链条帮你判断自己的项目需要哪一层。
