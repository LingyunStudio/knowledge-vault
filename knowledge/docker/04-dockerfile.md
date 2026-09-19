---
title: Dockerfile：把应用烤进镜像
order: 4
tags: Dockerfile, RUN, CMD, ENTRYPOINT, 构建缓存
summary: 构建上下文与指令执行模型、核心指令全表（FROM/COPY/RUN/WORKDIR/ENV/ARG/EXPOSE）、CMD 与 ENTRYPOINT 的分工与 exec 形式、层缓存机制与指令排序优化，以及一个真实 Node 应用的 Dockerfile 逐行解读。
---

Dockerfile 是「环境配置的代码化」：一串指令声明「从基础镜像出发，如何一步步烤出你的应用环境」。`docker build` 逐条执行、逐层提交。写 Dockerfile 的两个核心技能：**每条指令的精确语义**（尤其 CMD vs ENTRYPOINT）与**指令排序**（配合层缓存，[第 3 篇](03-images.md)）。

## 1. 构建模型：上下文与执行

```bash
docker build -t myapp:1.0 .
#                            ↑ 构建上下文：这个目录被打包发给 daemon（不是逐条读文件！）
```

两个机制性事实：

1. **上下文整体上传**：`.` 目录的全部内容（含没被 .dockerignore 排除的）先打包发给守护进程——上下文里有 2GB 数据集 = 每次 build 上传 2GB。**.dockerignore 是构建的礼貌与效率**。
2. **每条指令一层**：RUN/COPY/ADD 产生文件层；FROM/ENV/WORKDIR 等产生元数据层。构建的本质是「在临时容器里逐条执行、逐层快照」。

```dockerfile
.dockerignore:
node_modules
.git
*.log
data/                  ← 大文件/无关文件全部挡在上下文外
```

## 2. 核心指令全表

| 指令         | 作用                  | 要点                                  |
| ------------ | --------------------- | ------------------------------------- |
| `FROM`       | 基础镜像               | 多阶段可以有多个 FROM（[第 9 篇](09-dockerfile-best.md)）|
| `RUN`        | 构建时执行命令（产生层）| 洗涤 && 连接；清理要在同层完成          |
| `COPY`       | 从上下文复制文件        | 推荐；来源只能是上下文                  |
| `ADD`        | COPY + 自动解压 tar + URL| 语义含糊——只在需要解压时用            |
| `WORKDIR`    | 设置工作目录           | 后续指令的 cwd；用绝对路径               |
| `ENV`        | 运行时+构建时环境变量   | 镜像里永久存在                          |
| `ARG`        | 仅构建时的变量         | `--build-arg` 传入；不进最终镜像环境      |
| `EXPOSE`     | 声明端口（文档性质）    | 实际发布靠 run -p                        |
| `CMD`        | 默认启动命令（可被覆盖）| 容器的「默认参数」                        |
| `ENTRYPOINT` | 固定入口命令           | CMD 变成它的参数                         |
| `USER`       | 运行身份               | 生产镜像非 root（[第 9 篇](09-dockerfile-best.md)）|
| `LABEL`      | 元数据键值             | 维护者/版本信息                          |
| `HEALTHCHECK`| 健康检查命令           | 编排层的健康判定基础                      |

### 2.1 RUN 的书写纪律：层的合并与清理

```dockerfile
# ❌ 三层，且中间层里留着 apt 缓存（删不掉！）
RUN apt-get update
RUN apt-get install -y curl
RUN rm -rf /var/lib/apt/lists/*

# ✅ 一层完成 + 同层清理
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*
```

「同层清理」是 [第 3 篇](03-images.md)「追加覆盖」的推论：`rm` 在新层只是标记删除，旧层的大文件仍在——**安装与清理必须同一条 RUN**。

## 3. 层缓存：构建提速的机制

```dockerfile
# ❌ 代码一改，依赖重装（COPY 在前 → 缓存全失效）
COPY . /app
RUN pip install -r requirements.txt

# ✅ 依赖声明先复制（依赖不变 → 该层缓存命中）
COPY requirements.txt /app/
RUN pip install -r requirements.txt
COPY . /app
```

缓存机制：每条指令先算「指令文本 + 上下文文件哈希」的指纹，命中则直接复用层。由此推出排序总则：**变化频率从低到高排列**——基础镜像 → 系统依赖 → 语言依赖清单 → 源码。`--no-cache` 用于怀疑缓存投毒/需要强制刷新。

## 4. CMD 与 ENTRYPOINT：容器的启动语义

```dockerfile
# exec 形式（推荐）：JSON 数组，直接 exec，信号直达进程
CMD ["nginx", "-g", "daemon off;"]
ENTRYPOINT ["/app/entrypoint.sh"]

# shell 形式：包一层 /bin/sh -c（信号被 sh 拦截 → 容器无法优雅停止！）
CMD nginx -g "daemon off;"
```

两者的分工用一张表看清：

```bash
docker run myapp              # ENTRYPOINT + CMD 拼接执行
docker run myapp --verbose    # CMD 被参数替换：entrypoint.sh --verbose
docker run --entrypoint bash myapp   # 整个入口被替换（调试用）
```

| 组合                          | 语义                     | 典型用途                     |
| ----------------------------- | ------------------------ | ---------------------------- |
| 只有 CMD                       | 可完全替换的默认命令       | 通用镜像（ubuntu: bash）      |
| ENTRYPOINT + CMD               | 固定程序 + 可调默认参数    | 应用镜像（入口固定、参数可调）|
| ENTRYPOINT（exec 形式脚本）     | 启动前逻辑 + exec 真进程   | 需要环境准备/模板渲染的应用    |

**为什么 exec 形式重要**：容器的主进程必须直接接收 SIGTERM（`docker stop` 的优雅关闭）——shell 形式下信号给了 sh，真进程收不到，10 秒后被 SIGKILL 硬杀（[linux 篇](../linux/07-processes.md)的信号纪律）。entrypoint 脚本的最后一行永远是 `exec "$@"`——把 shell 让位给真进程。

## 5. 真实样例：Node 应用的 Dockerfile

```dockerfile
FROM node:20-alpine

WORKDIR /app

# 依赖层（变化最慢 → 缓存友好）
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 源码层（变化最快）
COPY src ./src

ENV NODE_ENV=production \
    PORT=3000

USER node                                    # 非 root 运行

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
```

逐行回顾前面的原则：alpine 基础镜像（体积，[第 9 篇](09-dockerfile-best.md)）、依赖层与源码层分离（缓存）、npm 缓存同层清理、ENV 显式配置、USER 降权、HEALTHCHECK 声明健康语义、exec 形式 CMD。

## 6. 构建失败的调试

```bash
docker build -t myapp . 
# Step 4/8 : RUN npm ci
# npm ERR! ...                              ← 哪一步失败一目了然
#   失败层的临时容器还留着（docker build 的输出里有它的 ID）

docker run -it <失败的中间层ID> sh          # 进到失败现场继续排查
```

或者把可疑指令换成 `RUN sleep 1000` 让构建停在那里，另开终端 exec 进去检查。构建失败的调试心法：**失败的是「指令在容器里的执行」——进入那个容器环境复现，比猜 Dockerfile 有效**。

## 7. 陷阱清单

- 上下文塞满无关大文件：.dockerignore 第一优先。
- apt/pip 缓存跨层清理：白删；安装与清理同一条 RUN。
- COPY . 放在依赖安装之前：缓存全部失效；声明文件先行。
- shell 形式 CMD/ENTRYPOINT：信号被 sh 拦截、优雅关闭失效；exec 形式 + `exec "$@"`。
- ADD 当 COPY 用：语义含糊；解压需求才用 ADD。
- 忘 .dockerignore 的 .git：上下文泄露历史+体积暴涨。
- ENV 里塞密码/密钥：inspect 可见、镜像分层可提取；秘密走运行时注入（[第 11 篇](11-pitfalls.md)）。

## 8. 小结

- 构建模型：上下文整体上传（.dockerignore 必配）+ 每指令一层（追加覆盖 → 同层清理）。
- 指令地图：FROM/RUN/COPY 是骨架，ENV/ARG 分运行与构建，USER/HEALTHCHECK 是生产素养。
- 缓存的灵魂是排序：低频变化在前（依赖声明）高频在后（源码）；缓存指纹 = 指令 + 输入哈希。
- CMD/ENTRYPOINT 的启动语义：exec 形式保信号直达（优雅关闭的生命线），ENTRYPOINT+CMD = 固定入口+可调参数。
- 构建失败的调试进入中间容器现场——Dockerfile 是「在容器里执行的环境脚本」，调试思维与 shell 一致。

## 9. 练习

**1.** 为一个 Python（或你熟悉的栈）应用写 Dockerfile：依赖层分离、同层清理、非 root、exec 形式 CMD；build 后用 history 验证每层的体积来源。

> [!TIP]
> 思路对照本篇第 5 节的 Node 模板逐条映射。history 检查「最大层是什么」——依赖层大是正常的，基础层决定下限。

**2.** 缓存实验：写一个「COPY . 在前」的慢 Dockerfile，改一行代码重新 build 记录耗时；调整指令顺序后再 build 对比——用数字证明排序的价值。

> [!TIP]
> 思路重点观察「CACHED」标记的位置变化：缓存命中的分界线 = 第一条输入变化的指令。改动源码时依赖层全部 CACHED 才是正确形态。

**3.** CMD/ENTRYPOINT 实验：写 ENTRYPOINT ["echo"] + CMD ["hello"] 的镜像，分别 run 不带参数/带参数/--entrypoint sh——把「拼接与覆盖」的规则做成自己的验证记录。

> [!TIP]
> 思路run 不带参数 → echo hello；带参数 → CMD 被替换成参数；--entrypoint 整个换入口。这三条规则是理解所有官方镜像用法说明的基础。

**4.** 制造一次构建失败（依赖清单写错包名），用中间容器现场调试修复；体验「失败层容器还在」的调试路径。

> [!TIP]
> 思路build 输出里的 `---> <id>` 是失败前最后成功的层——run -it 进去手动执行失败指令，把报错看全再改 Dockerfile。

**5.** 信号实验：写 shell 形式与 exec 形式 CMD 的两个镜像（CMD 跑一个 trap SIGTERM 的脚本），docker stop 计时对比——验证「shell 形式无法优雅停止」。

> [!TIP]
> 思路shell 形式下 stop 会等满 10 秒超时（SIGTERM 被 sh 吞掉）后 SIGKILL；exec 形式立刻优雅退出。`docker events` 或 stop 的耗时是证据。

**6.** 讨论：为什么「ENV 塞秘密」是反模式而 ARG 也不安全（build-arg 会留在镜像历史里）？从「镜像分层的可提取性」分析，给出秘密的三个正确注入点（运行时环境/编排 secret/挂载文件）与各自适用场景。

> [!TIP]
> 思路镜像层任何人 docker history/拉取解包都能看到——构建期的秘密必然泄露。运行时注入（-e/secret/挂载）让镜像本身无秘密——「构建产物零敏感、运行时才具身」是不可变基础设施的保密模型。
