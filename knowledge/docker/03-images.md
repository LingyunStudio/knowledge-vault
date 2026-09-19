---
title: 镜像深入：分层与内容寻址
order: 3
tags: 镜像分层, tag, digest, registry, 层复用
summary: 镜像的分层只读结构与层复用机制（与 git 对象模型的相似性）、tag 的可变性与 digest 的不可变性、版本钉住策略、registry 与镜像同步（save/load/镜像源），以及 history 探视分层的调试方法。
---

镜像不是一个「压缩包」，而是一棵**分层的内容寻址文件系统**——每个 Dockerfile 指令产生一层，层被复用、共享、增量拉取。这套设计与 [git 的对象模型](../git/01-object-model.md)惊人相似：内容寻址、不可变层、轻量引用。理解分层，拉取加速、构建缓存（[第 4 篇](04-dockerfile.md)）、镜像瘦身（[第 9 篇](09-dockerfile-best.md)）全部变成可推导。

## 1. 分层：镜像的真实结构

```text
镜像 nginx:1.27 的层叠：
┌────────────────────────┐
│ 层5: COPY 配置 /etc/nginx│ ← 你的改动层
│ 层4: RUN apt-get 安装    │
│ 层3: RUN set -x && apt update│
│ 层2: CMD ["nginx"]       │
│ 层1: 基础层 ubuntu 24.04 │ ← 与其他 ubuntu 镜像共享
└────────────────────────┘
每层 = 一组文件变更（增/改/删）的压缩包 + 元数据
容器运行 = 这些只读层之上叠一个可写层
```

三个机制性推论：

1. **层复用**：两个镜像都用 `ubuntu:24.04` 基础层 → 本地只存一份（内容寻址去重，与 git 的 blob 复用同理）。宿主机上 100 个 Python 应用镜像共享同一个 python 基础层。
2. **增量拉取**：`docker pull` 只下载本地没有的层——基础层 200MB 只拉一次，你的应用层 5MB 天天更新也只传 5MB。
3. **层是追加的**：后一层「覆盖」前一层的内容（同名文件上层赢）——**「删掉一层里的大文件」不会让镜像变小**（文件还在下层！），这是镜像瘦身的核心认知（[第 9 篇](09-dockerfile-best.md)）。

```bash
docker history nginx:1.27          # 逐层查看：每层的指令、大小、创建方式
docker image inspect nginx:1.27    # 元数据：层数、架构、暴露端口、入口命令
```

## 2. tag 与 digest：可变引用与不可变指纹

```bash
nginx:1.27          # tag：可变引用（像 git 的分支——可能被重新指向）
nginx@sha256:abc123...   # digest：内容的哈希（像 git 的 commit——不可变）
```

tag 的语义陷阱：**同一个 tag 的内容会变**。`nginx:latest`、甚至 `nginx:1.27` 都可能被上游重新推送（安全补丁更新）——「昨天拉的镜像今天重新拉内容变了」。digest 是真正的钉子：

```bash
docker pull nginx@sha256:4c0fdaa8b6341bfdeca5f18f7837462c80cff90527ee35ef185571e1c327beac
docker images --digests            # 查看本地镜像的 digest
```

版本钉住策略的梯度（生产环境的选择）：

| 策略                | 稳定性 | 更新成本 | 适用                       |
| ------------------- | ------ | -------- | -------------------------- |
| `latest`            | ❌ 任意漂移 | 零      | 仅本地实验                  |
| `1.27`（主.次）     | 中     | 低       | 一般服务（补丁自动跟随）      |
| `1.27.4`（完整版本）| 高     | 手动升级 | 生产常规                     |
| `@sha256:digest`    | 绝对   | 手动     | 合规要求、供应链审计          |

## 3. registry：镜像的远程仓库

```bash
docker pull ubuntu:24.04            # 默认 registry = Docker Hub（library/ubuntu）
docker pull ghcr.io/org/app:1.0     # GitHub Container Registry
docker pull registry.example.com/team/app:1.0    # 私有 registry

docker login ghcr.io                # 推送前认证
docker tag app:dev ghcr.io/org/app:1.0.0    # tag 决定推送目的地（全名 = registry/命名空间/名字:标签）
docker push ghcr.io/org/app:1.0.0
```

- **Docker Hub**：公共默认仓库（拉取限速——国内环境常配**镜像加速器**/mirror：daemon.json 的 `registry-mirrors`）。
- **私有 registry**：企业内部 Harbor/云厂商 ACR/ECR——供应链安全的正解（镜像不出内网、可扫描、可审计）。
- 镜像的完整引用 `registry/namespace/name:tag`——省略 registry 默认 Hub、省略 namespace 用个人账号。

离线/直传场景：

```bash
docker save app:1.0 -o app.tar      # 导出镜像（含全部层）
docker load -i app.tar              # 导入（保留分层与历史）
docker export <容器> -o fs.tar      # ⚠️ 导出容器文件系统快照（丢分层历史——只用于应急）
```

## 4. 悬空与未使用镜像的清理

```bash
docker images -a                    # 全部镜像
docker images -f "dangling=true"    # 悬空镜像：<none>:<none>（重新构建同名 tag 后旧层失去引用）
docker image prune                  # 删悬空层
docker image prune -a               # ★ 删所有「没有容器引用」的镜像（谨慎：清理本地缓存）
docker system df                    # 镜像/容器/卷/缓存的磁盘占用总览
```

「dangling」的来源与 [git 的 dangling commit](../git/07-undo.md) 同理：引用被更新后，旧内容失去指针。构建频繁的机器上 dangling 层是磁盘的大户。

## 5. 多架构镜像：apple silicon 的现实

```bash
docker pull --platform linux/amd64 nginx:1.27    # 显式指定架构（M 系列 Mac 跑 x86 镜像）
docker buildx ls                   # 多架构构建器（[第 8 篇](08-registry.md)的 CI 多架构发布）
```

一个「镜像名」背后可能是多个架构的清单（manifest list）——docker 按宿主架构自动选。跨架构跑镜像（Apple Silicon 跑 x86）默认走模拟（qemu），性能损失明显——「本地能跑 ≠ 生产架构能跑」的验证要在同架构做。

## 6. 陷阱清单

- 删层瘦身无效：文件在下层仍占空间；瘦身靠构建期选择（多阶段/基础镜像，[第 9 篇](09-dockerfile-best.md)）。
- 生产用 latest/浮动 tag：内容漂移不可追溯；完整版本或 digest。
- 把 export 当 save 用：export 丢分层与元数据；迁移镜像用 save/load。
- 忘记 docker login 就 push：authentication required；push 前确认目的地（tag 全名）。
- 跨架构镜像的模拟性能损失当真实性能：同架构验证。
- 本地镜像堆积不管：system df 定期看，prune 配清理节奏。

## 7. 小结

- 镜像 = 分层的内容寻址文件系统：层复用（基础层共享）、增量拉取、追加覆盖（删下层文件不瘦身）——与 git 对象模型同构。
- tag 是可变引用、digest 是不可变指纹：生产钉版本梯度（latest ❌ → 完整版本 → digest）。
- registry 的完整引用结构决定 push/pull 目的地；镜像加速器与私有 registry 是网络与安全的现实配置。
- save/load 保分层、export 丢历史；dangling 镜像来自 tag 重指向，prune 分级清理。
- 多架构 manifest 是 Apple Silicon 时代的必知——跨架构模拟的性能不能当真。

## 8. 练习

**1.** 用 `docker history` 查看一个大型官方镜像（如 tensorflow），找出最大的三层并说明各层的构成；数一数它与另一个镜像共享的层（对比两个基础层相同的镜像的 ID）。

> [!TIP]
> 思路history 从下到上 = 构建顺序；最大层通常是依赖安装（apt/pip）。共享验证：两个 ubuntu 系镜像的最底层 ID 相同——层复用在本地即生效。

**2.** 验证 tag 的可变性：给一个镜像打两个 tag（1.0 与 latest），重新 build 一个不同内容的镜像覆盖 latest tag，观察 1.0 不变、dangling 出现——用实验证明「tag 是引用不是内容」。

> [!TIP]
> 思路这就是生产环境禁 latest 的机制论据。dangling 的出现（旧镜像失去 tag）连接到 prune 的清理对象。

**3.** 用 digest 钉住一个镜像并重建容器：记录 digest → 删本地镜像 → 用 digest 拉 → 对比前后镜像 ID 一致——完成一次「供应链可复现」的演练。

> [!TIP]
> 思路digest 拉取保证逐位一致——合规与审计场景的终极形态。日常工程的折中：完整版本 tag + CI 里记录 digest。

**4.** 用 docker save/load 在两台机器（或与同事实例）间迁移镜像；再试 docker export/import，对比两个产物的大小、分层（history）与可运行性。

> [!TIP]
> 思路export 的产物是「文件系统快照」——没有 CMD/ENTRYPOINT 元数据，run 必须补命令。实验后「什么时候用哪个」不再是背书题。

**5.** 检查你机器的 docker 磁盘占用（system df），执行分级清理（prune → prune -a），记录清理前后空间；把「构建机器的定期清理」写成一条 cron（[linux 篇](../linux/07-processes.md)）。

> [!TIP]
> 思路构建密集机器的磁盘大户通常是 build cache 与 dangling 层——与 [git 的 gc](../git/01-object-model.md) 一样，「引用清理」是内容寻址系统的必修保养。

**6.** 讨论：为什么「镜像分层」能同时改善传输、存储与缓存三个维度？对照 [git 的层（对象包）](../git/01-object-model.md)与 [NumPy 的内存复用](../python/01-python-model.md)，总结「内容寻址 + 分层共享」这一设计模式的适用条件。

> [!TIP]
> 思路适用条件：①内容不可变（改 = 新内容新地址）②有大量共享前缀（基础层/公共依赖）③增量分发有价值。三个条件同时成立的场景（镜像/git/备份快照）都是这个模式的受益者——设计模式的迁移能力比记住某个工具更有价值。
