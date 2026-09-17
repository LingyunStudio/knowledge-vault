---
title: Docker 是什么
order: 1
tags: 概念, 容器, 镜像
summary: 容器与虚拟机的区别、镜像/容器/仓库三大概念、终结"在我机器上能跑"。
---

"在我机器上能跑"的根源是：程序不只是代码，还是运行时、系统库、依赖版本、配置文件的一整套组合。Docker 把应用连同全部依赖打包成一个标准单元（镜像），在任何装了 Docker 的机器上行为一致。它不模拟硬件，而是共享内核、隔离进程——所以比虚拟机轻得多，也快得多。

## 容器与虚拟机

虚拟机在 Hypervisor 上再装一个完整操作系统，每个 VM 有自己的内核；容器只是宿主机上被隔离的一组进程，所有容器共用宿主机内核。

| 维度 | 虚拟机 | 容器 |
| --- | --- | --- |
| 虚拟化层级 | 硬件级，独立内核 | 操作系统级，共享内核 |
| 启动速度 | 分钟级 | 秒级，接近启动一个进程 |
| 资源开销 | 每 VM 数 GB 内存起步 | 通常 MB 级额外开销 |
| 单机密度 | 几台到几十台 | 成百上千个 |
| 隔离强度 | 强（内核级隔离） | 较弱，存在逃逸风险 |
| 数据持久化 | 磁盘镜像文件，随 VM 存在 | 可写层随容器销毁，必须挂卷 |
| 典型用途 | 跑异构系统、强隔离需求 | 打包交付应用、微服务部署 |

注意最后几行：容器不是"更轻的虚拟机"。VM 解决的是"机器不够用"，容器解决的是"环境不一致、交付不标准"。需要强隔离（跑不可信代码、多租户混部）时，容器替代不了 VM。

> [!WARNING]
> 共享内核意味着容器不是安全沙箱：容器内 root 能触到的内核攻击面与宿主机 root 相同。跑不可信代码要上 rootless 模式、user namespace 重映射，或干脆用 VM。

## 隔离靠什么实现

容器不是 Docker 发明的新技术，Docker 做的事是把 Linux 内核已有的机制包装成人人可用：

- **Namespace**：让进程"看不见"别人。PID namespace 让容器内进程从 PID 1 重新编号；NET、MNT、UTS、IPC、User 分别隔离网络栈、挂载点、主机名、进程间通信、用户视角
- **Cgroups**：限制一组进程能消耗多少资源——CPU 配额、内存上限、IO 带宽。容器能"限制用 2 核 4G"，靠的就是它
- **联合文件系统（UnionFS）**：把多层只读目录叠成一个文件系统，这是镜像分层、容器秒级创建的物理基础

```bash
docker run -d --name demo alpine sleep 3600
docker top demo              # 宿主机视角：sleep 就是一个普通进程
ps aux | grep sleep          # 容器不是黑盒，本质是带隔离参数的进程
docker rm -f demo
```

镜像层在磁盘上由存储驱动管理（现代默认 overlay2）：多个只读目录加一个可写目录，叠加挂载成容器的根文件系统。`docker info | grep -i storage` 可以看到当前用的驱动。

> [!NOTE]
> Windows 和 macOS 没有这些 Linux 内核机制，Docker Desktop 的实际结构是：后台起一个轻量 Linux 虚拟机，容器全跑在 VM 里。这解释了为什么 Docker Desktop 常驻吃几个 GB 内存，也解释了跨 VM 挂载文件时的性能损耗——bind mount 跨过了虚拟化边界。

## 三个核心概念

Docker 的一切围绕三样东西流转，先建立心智模型：

- **镜像（Image）**：只读模板，内含文件系统和启动配置。类比面向对象里的"类"
- **容器（Container）**：镜像的一个运行实例。类比"对象"——在镜像的只读层之上叠一层可写层，容器删除时可写层一并消失
- **仓库（Registry）**：托管镜像的服务，Docker Hub 是默认公共仓库，类比 GitHub

```bash
docker pull nginx            # 从仓库拉镜像到本地
docker run nginx             # 用镜像创建并启动容器（本地没有会先自动 pull）
docker ps                    # 列出正在运行的容器
docker images                # 列出本地镜像
docker rm 容器ID              # 删除容器（运行中要加 -f）
docker rmi 镜像ID             # 删除镜像（有容器引用时删不掉）
```

完整的关系链：`Dockerfile --build--> 镜像 --run--> 容器`，`镜像 --push--> 仓库`，`仓库 --pull--> 别的机器`。构建、运行、分发各对应一组命令，后续篇章逐一展开。

这份设计还解释了资源占用：镜像只存一份，容器本身几乎不占空间——可写层通常只有几 MB，一台笔记本同时跑十几个容器毫无压力。

> [!TIP]
> 类比记忆：镜像 ≈ 类，容器 ≈ 实例，仓库 ≈ GitHub，Dockerfile ≈ 构建脚本。一个镜像可以同时跑任意多个容器，就像一个类可以 new 出无数对象。

## 它终结了什么问题

把环境差异逐条列出来，就是 Docker 的应用场景清单：

- 本机 macOS、测试机 Ubuntu、生产 CentOS，系统库和路径有微妙差异 → 镜像统一底层环境
- 两个项目依赖不同版本的 PostgreSQL → 各跑各的容器，互不污染
- 新人入职装环境要一整天 → 拉镜像、起容器，以分钟计
- 部署靠"上传代码 + 一堆手工步骤" → 上传镜像，执行环境与测试环境完全一致
- 老服务器一堆服务抢端口、抢全局依赖 → 每个服务一个容器，依赖自带
- 压测要临时起 20 个实例 → 同一个镜像 run 20 次，用完即删

```bash
# 同一台机器并存两套 PostgreSQL，版本不同、端口错开、互不干扰
docker run -d --name pg-old -e POSTGRES_PASSWORD=x -p 5432:5432 postgres:12
docker run -d --name pg-new -e POSTGRES_PASSWORD=x -p 5433:5432 postgres:16
```

关键在于**环境即代码**：环境不再是某台机器上不可复述的现状，而是一个进版本库、可审查、可重建的 Dockerfile（见 [Dockerfile](04-dockerfile.md)）。出了问题，重建环境而不是凭记忆修复环境。

## client/daemon 架构

你敲的 `docker` 命令只是客户端，真正干活的是常驻后台的 dockerd 守护进程：

```bash
docker version               # client 与 server 版本分开显示，可看出两者是否连通
docker info                  # daemon 状态：容器数、镜像数、存储驱动、内核版本
sudo systemctl status docker # daemon 本身也是个 systemd 服务
```

理解这一点，很多现象就顺理成章：

- `docker build` 时构建上下文（整个目录）会被发送给 daemon——上下文太大构建就慢，`.dockerignore` 有用武之地
- 容器是 daemon 管理的进程，daemon 停了容器也跟着停（除非配置了 live-restore）
- 删镜像提示"被容器使用"删不掉，是 daemon 在维护引用关系

## 术语速查

| 术语 | 含义 |
| --- | --- |
| daemon | 常驻服务端进程，负责构建、运行、管理一切 |
| client | `docker` 命令行，把请求发给 daemon |
| context | 构建时发送给 daemon 的文件集合 |
| layer | 镜像的一个只读层，可在多个镜像间共享 |
| tag | 镜像的版本别名，如 `nginx:1.27` |
| registry / repository | 仓库服务 / 仓库里某个镜像的全部版本 |
| storage driver | 管理镜像层叠加的机制，现代默认 overlay2 |
| dangling image | 没有任何 tag 指向的悬空镜像，显示为 <none>:<none> |

相关阅读：[安装与第一个容器](02-install-first.md)
