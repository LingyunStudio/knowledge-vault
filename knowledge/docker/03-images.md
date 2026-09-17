---
title: 镜像与分层
order: 3
tags: 核心, 镜像, 分层
summary: 只读分层与写时复制、tag 的真相、pull/push、镜像为什么会越养越大。
---

镜像不是一个文件，而是一叠只读层的叠加视图；容器跑起来时再在最上面盖一层可写层。理解分层，才能理解镜像为什么能秒级拉取、多个镜像为什么不重复占磁盘，以及镜像为什么总会越养越大。

## 只读分层与写时复制

Dockerfile 里每条指令生成一层，层是只读的：

```text
容器可写层（随容器删除而消失）   ← docker run 时动态添加
──────────────────────────
Layer 4: COPY app.py /app/      ← 只读
Layer 3: RUN pip install ...    ← 只读
Layer 2: COPY requirements.txt  ← 只读
Layer 1: FROM python:3.12-slim  ← 本身又是很多层的叠加
```

- **共享**：两个镜像若基于同一个基础镜像，底下那些层在磁盘上只存一份。这就是 `docker pull` 经常显示 "Layer already exists" 的原因
- **写时复制（CoW）**：容器要改某个文件时，先把文件从镜像层复制到可写层再改；读则从上往下找第一个命中的版本
- **删除即遮挡**：容器里删一个镜像层里的文件，只是在可写层放一个删除标记，底层文件还在——所以容器里删大文件不会让镜像变小

```bash
docker history nginx           # 查看镜像由哪些层构成、每层多大、哪条指令生成
docker diff 容器名              # 容器对文件系统做了哪些改动（A 新增 / C 修改 / D 删除）
docker image inspect nginx:1.27 --format '{{.RootFS.Layers}}'   # 层的校验和列表
```

> [!TIP]
> 由于 CoW，频繁写大文件的场景（数据库、高频日志）放可写层性能差且越写越厚。正确做法是数据全部落 volume——见[数据卷与持久化](05-volumes.md)。

## tag 的真相

镜像的完整名字长这样：

```text
registry.example.com:5000/team/myapp:1.4.2
└──────仓库地址──────┘└命名空间┘└名称┘└tag─┘
```

- `docker pull nginx` 实际是 `docker pull docker.io/library/nginx:latest`——没写仓库默认 docker.io，没写命名空间默认 library（官方镜像），没写 tag 默认 latest
- **tag 只是一个可变的别名**，指向某个镜像 ID。同一个镜像 ID 可以挂任意多个 tag；重新 push 同名 tag 会把指针挪走，旧的"版本号"从此名不副实

关于 `latest` 的误解值得单独澄清：latest 不代表"最新版本"，它只是"没写 tag 时的默认值"。作者哪天给旧版本重新打了 latest，latest 就指过去了。生产环境禁止裸用 latest，要么固定版本号，要么用摘要：

```bash
docker pull nginx:1.27.3              # 固定小版本
docker pull nginx@sha256:ed8f...      # 按内容摘要拉取，不可变，最严格
docker inspect --format '{{index .RepoDigests 0}}' nginx:1.27.3   # 查镜像的摘要
```

> [!WARNING]
> tag 可以被覆盖，"写了版本号"不等于"不可变"。真正的不可变锚点是 sha256 摘要。供应链要求高的场景，CI 里记录镜像摘要，部署按摘要拉取。

## pull 与 push

```bash
docker pull postgres:16              # 拉镜像，分层并行下载，本地已有的层直接跳过
docker login                         # 登录（默认 Docker Hub），凭证存进 ~/.docker/config.json
docker tag myapp:dev myname/myapp:1.0    # 重命名/补 tag，指向同一个镜像 ID
docker push myname/myapp:1.0         # 推送：分层上传，仓库已有的层秒传
docker image inspect nginx:1.27 | head    # 元数据：架构、层数、暴露端口、环境变量
```

推送前必须把名字补全到 `仓库/命名空间/名称:tag` 的完整形态，Docker 按名字决定推去哪个仓库：

```bash
docker tag myapp:1.0 registry.example.com:5000/backend/myapp:1.0
docker push registry.example.com:5000/backend/myapp:1.0
```

分层设计的直接收益：改一行代码重新构建，只有最上面一两层变了，push/pull 只传差异——这是镜像分发比"传一个 tar 包"快的根本原因。

## 镜像为什么会越养越大

层是只读且不可变的，这个设计带来一个反直觉的后果：**后一层删不掉前一层的文件**。

```dockerfile
# ❌ 经典错误：看似删了，其实前一层的 apt 缓存永远留在镜像里
RUN apt-get update && apt-get install -y curl
RUN rm -rf /var/lib/apt/lists/*

# ✅ 正确：安装和清理在同一条 RUN，垃圾只存在于这一层的构建过程中
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
```

常见的膨胀来源：

- 包管理器缓存（apt、pip、npm 的 cache）没在同一条 RUN 里清理
- 编译工具链（gcc、完整 JDK）被带进运行时镜像
- `COPY . .` 把 .git、测试数据、模型文件全拷进去
- 每次改代码重新构建，旧的悬空镜像（dangling，`<none>:<none>`）不断堆积

```bash
docker images -f "dangling=true"    # 找出悬空镜像
docker image prune                  # 清理悬空镜像，安全
docker image prune -a               # ❌ 清掉所有没被容器引用的镜像，下次部署全量重拉
docker save -o app.tar myapp:1.0    # 导出镜像为 tar，离线环境搬运用
docker load -i app.tar              # 导入，分层结构原样保留
```

> [!NOTE]
> 镜像大小 = 所有层之和，容器里删文件不能给镜像瘦身，镜像里删文件也删不掉别的层。真正有效的瘦身三件套：同层清理缓存、精选基础镜像、多阶段构建，详见 [Dockerfile 最佳实践](09-dockerfile-best.md)。

## 镜像操作速查

```bash
docker images                       # 本地镜像列表（REPOSITORY/TAG/IMAGE ID/SIZE）
docker images --digests             # 连摘要一起列出
docker rmi myapp:1.0                # 删除指定 tag（有容器引用时删不掉）
docker rmi 镜像ID                    # 按 ID 删，同时摘掉它所有的 tag
docker system df                    # 磁盘占用总览：镜像/容器/卷/构建缓存各占多少
```

相关阅读：[Dockerfile](04-dockerfile.md)
