---
title: Dockerfile
order: 4
tags: 核心, Dockerfile, 构建
summary: FROM/COPY/RUN/CMD 的顺序学问、层缓存命中、ENTRYPOINT 与 CMD。
---

Dockerfile 是镜像的构建脚本：每条指令生成一层，从上往下按序执行。写 Dockerfile 的核心技能只有两个——指令用对，顺序排好。顺序直接决定构建速度，因为层缓存按指令逐条匹配，一条失配，后面全部重建。

## 一个最小可用的 Dockerfile

```dockerfile
FROM python:3.12-slim            # 基础镜像：决定下面所有层的起点

WORKDIR /app                     # 设置工作目录，目录不存在会自动创建

COPY requirements.txt .          # 先只拷依赖清单
RUN pip install --no-cache-dir -r requirements.txt   # 再装依赖

COPY . .                         # 最后才拷源码

EXPOSE 8000                      # 声明容器监听的端口（仅声明，不做映射）
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]   # 默认启动命令
```

```bash
docker build -t myapp:1.0 .      # 末尾的 . 是构建上下文（当前目录），不是 Dockerfile 的路径
docker run -d -p 8000:8000 myapp:1.0
```

注意 `.` 的含义：build 会把整个上下文目录打包发给 daemon，Dockerfile 里的 COPY 只能拷上下文内的东西——上下文之外的路径写得再对也无效。

## 常用指令

| 指令 | 作用 | 关键点 |
| --- | --- | --- |
| FROM | 指定基础镜像 | 优先 slim/alpine 变体；多个 FROM 即多阶段构建 |
| RUN | 构建时执行命令 | 每条 RUN 生成一层；安装与清理写进同一条 |
| COPY | 从上下文拷文件进镜像 | 指名道姓地拷，别图省事 COPY . . |
| ADD | 增强版 COPY | 额外支持 URL 下载与自动解压 tar；其余场景一律 COPY |
| WORKDIR | 设置工作目录 | 目录不存在自动创建；代替 RUN cd |
| ENV | 环境变量（构建与运行时都生效） | 配置类默认值写这里 |
| ARG | 仅构建期的变量 | `--build-arg` 传入，不进运行时环境 |
| EXPOSE | 声明监听端口 | 纯文档性质，详见[容器网络](06-networks.md) |
| ENTRYPOINT | 固定的启动命令 | 与 CMD 配合，见下节 |
| CMD | 默认启动命令 | `docker run img args` 会整体覆盖它 |

WORKDIR 与 cd 的区别值得强调：**RUN 里的 cd 只在那一条 RUN 的 shell 里生效，下一条 RUN 又回到原点**；WORKDIR 才是持久的。

```dockerfile
# ❌ 自以为进了 /app，实际每条 RUN 都还在默认目录执行
RUN cd /app
RUN make

# ✅ 用 WORKDIR，后续所有指令都以此为基准
WORKDIR /app
RUN make
```

> [!TIP]
> COPY 和 ADD 的取舍一句话：**默认 COPY，需要"下载"或"自动解包 tar"才用 ADD**。ADD 的隐式解压容易让人误判行为，显式永远好过隐式。

## 顺序与层缓存

Docker 对每条指令先查缓存：基础镜像相同 + 指令文本相同 + 拷入的文件内容没变 → 直接复用已有层。一旦某条失配，它之后的**所有层**全部重建。

所以顺序原则只有一条：**越常变的越靠后**。依赖清单改得少，源码改得勤，依赖必须排在源码前面：

```dockerfile
# ❌ 源码一改，pip install 重跑一遍，装依赖的层缓存全废
COPY . .
RUN pip install -r requirements.txt

# ✅ 先拷清单装依赖，再拷源码——改代码只重建最后一层
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
```

同理，`apt-get update` 这类慢操作要合并进一条 RUN 并放在确实少变的位置。调试构建慢，先看 `docker build` 输出在哪一步卡住——卡住的那层之上没有缓存命中，通常就是顺序排错了。

> [!NOTE]
> 缓存的粒度是指令文本和文件内容校验和，不是"文件改了哪一行"。`COPY . .` 只要上下文里有任何一个文件变了，这一层就算失配——这正是"先拷清单后拷源码"能救命的原因。

## CMD 与 ENTRYPOINT

两者都定义容器启动时跑什么，分工不同：

- **ENTRYPOINT**：容器的主命令，写死不易改，表达"这个容器就是干这个的"
- **CMD**：默认参数，运行时随时可以换

两者都以 exec 形式（JSON 数组）书写时，启动的完整命令是 `ENTRYPOINT + CMD` 拼接：

```dockerfile
ENTRYPOINT ["docker-entrypoint.sh"]   # 固定入口脚本
CMD ["postgres"]                      # 默认参数：跑 postgres
```

```bash
docker run postgres                                  # 实际执行 docker-entrypoint.sh postgres
docker run postgres postgres --max_connections=200   # CMD 被覆盖，ENTRYPOINT 不变
```

| Dockerfile 写法 | `docker run img` | `docker run img args` |
| --- | --- | --- |
| 只有 CMD | 执行 CMD | args 覆盖 CMD |
| 只有 ENTRYPOINT | 执行 ENTRYPOINT | args 作为参数追加给 ENTRYPOINT |
| 两者都有（exec 形式） | ENTRYPOINT + CMD | ENTRYPOINT + args |

覆盖入口：`docker run --entrypoint sh img` 临时换掉入口进容器排查；`--entrypoint ""` 清空它让 CMD 独立生效。

## exec 形式与 shell 形式

CMD/ENTRYPOINT 有两种写法，行为差异巨大：

```dockerfile
CMD ["python", "app.py"]      # exec 形式：python 直接是 PID 1
CMD python app.py             # shell 形式：实际执行 /bin/sh -c "python app.py"
```

shell 形式多套了一层 sh，代价主要在信号上：

- **PID 1 是 sh 不是你的程序**——SIGTERM 先到 sh，而 sh 默认不转发信号，`docker stop` 等满 10 秒后只能 SIGKILL 硬杀，优雅退出形同虚设
- 僵尸进程也没人回收——PID 1 有回收孤儿的职责，sh 不干这活

```dockerfile
# ❌ shell 形式：收不到优雅退出的信号
CMD node server.js

# ✅ exec 形式：node 就是 PID 1，SIGTERM 直达
CMD ["node", "server.js"]
```

> [!WARNING]
> 想用 shell 特性（变量展开、管道）又要信号转发？在命令末尾用 `exec`：`CMD ["sh", "-c", "prepare && exec node server.js"]`——exec 让 node 顶替 sh 成为 PID 1，信号路径就通了。配合 `docker run --init` 还能顺便解决僵尸进程回收。

## 构建相关命令

```bash
docker build -t myapp:1.0 .                        # 标准构建
docker build -f deploy/Dockerfile .                # Dockerfile 不在上下文根目录时用 -f
docker build --build-arg VERSION=1.0 -t myapp:1.0 . # 给 ARG 传值
docker build --target builder -t myapp:build .     # 多阶段构建只构建到指定阶段
docker build --no-cache -t myapp:1.0 .             # ❌ 全量重建，缓存污染时才用
```

相关阅读：[Dockerfile 最佳实践](09-dockerfile-best.md)、[镜像与分层](03-images.md)
