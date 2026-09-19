---
title: 安装与第一个容器：run 的解剖
order: 2
tags: 安装, docker run, exec, logs, 生命周期
summary: 三平台的安装形态与守护进程架构、docker run 的参数解剖（-d/-p/--name/-e/--rm）、容器生命周期的完整循环（start/stop/rm/ps -a）、logs 与 exec -it 的日常调试双件套。
---

本篇用一条 `docker run` 命令把「镜像 → 容器 → 交互 → 清理」的完整循环走通——`run` 的十几个参数是 Docker 的日常词汇表，逐个解剖比背清单有效。

## 1. 安装：三平台的三种形态

| 平台            | 方案                  | 说明                                        |
| --------------- | --------------------- | ------------------------------------------- |
| Linux           | Docker Engine（apt/dnf） | 原生守护进程——容器的「正统环境」（[第 1 篇](01-why-containers.md)：需要 Linux 内核）|
| Windows         | Docker Desktop（WSL2 后端） | dockerd 跑在 WSL2 的 Linux VM 里             |
| macOS           | Docker Desktop        | dockerd 跑在轻量 Linux VM（apple 芯片注意镜像架构，[第 8 篇](08-registry.md)）|

架构的现实（[第 1 篇](01-why-containers.md)）：**容器需要 Linux 内核**，所以 Desktop 版本本质是「VM 里的 Docker」——bind mount 的跨 VM 路径、网络拓扑的中间层，都源于此。

安装后的第一课：**docker 用户组**（Linux）。`sudo usermod -aG docker $USER` 让当前用户免 sudo 用 docker——但要知道这等价于给 root 权限（[第 4 篇](../linux/04-permissions.md)的 `-aG` 纪律 + [第 11 篇](11-pitfalls.md)的安全边界）。

## 2. 第一个容器：hello-world 与解剖

```bash
docker run hello-world
```

输出里的流程就是 Docker 的全部机制：

```text
Unable to find image 'hello-world:latest' locally   ← 本地没有
latest: Pulling from library/hello-world            ← 从 Docker Hub 拉取镜像
Hello from Docker!                                  ← 用这个镜像创建容器并运行
                                                    ← 打印后容器退出（进程结束 = 容器结束）
```

「**容器 = 进程**」：主进程退出，容器就停止——`hello-world` 打印一行就退出，所以容器 `Exited`。这个模型解释了后面所有行为（-d、stop、restart 策略）。

## 3. docker run 的参数解剖

```bash
docker run \
  -d \                                # detached：后台运行（否则占住当前终端）
  --name web \                        # 容器名（不指定则随机名——脚本里必须指定）
  -p 8080:80 \                        # 端口映射：宿主 8080 → 容器 80
  -e NGINX_PORT=80 \                  # 环境变量（应用配置的标准入口）
  -v webdata:/usr/share/nginx/html \  # 卷挂载（[第 5 篇](05-volumes.md)）
  --restart unless-stopped \          # 崩溃/开机自动重启策略
  --memory 512m --cpus 1 \            # 资源限制（cgroups）
  nginx:1.27                          # 镜像（ tag 精确版本，不用 latest）
```

| 参数            | 作用            | 忘了会怎样                        |
| --------------- | --------------- | --------------------------------- |
| `-d`            | 后台运行         | 终端被日志占住（Ctrl+C 还会停容器） |
| `-p 宿:容`      | 端口映射         | 容器端口外部访问不到（容器网络隔离，[第 6 篇](06-networks.md)）|
| `--name`        | 命名             | 只能用随机名/ID 操作               |
| `-e`            | 环境变量         | 应用读不到配置                     |
| `--rm`          | 退出即删除       | `docker ps -a` 堆满一次性容器      |
| `--restart`     | 重启策略         | 宿主重启/崩溃后服务不自动回来       |

`-d` 的配套观察命令：

```bash
docker logs web              # 查看容器 stdout/stderr（应用的日志入口！）
docker logs -f web           # 实时跟踪（tail -f 的容器版）
docker logs --tail 50 web
```

## 4. 进入与检查：exec 与 inspect

```bash
docker exec -it web bash          # ★ 进入运行中的容器（开一个交互 shell）
docker exec web ls /etc/nginx     # 单命令执行（脚本化检查）
docker attach web                 # ⚠️ 连接到主进程（Ctrl+C 可能停掉容器——调试日志用 logs）

docker inspect web                # 容器完整元数据（IP/挂载/环境变量）
docker stats                      # 实时资源占用（所有容器的 top）
docker top web                    # 容器内的进程列表
```

`exec -it`（interactive + tty）是「容器内调试」的标准入口——进去后就是一个普通的 Linux 环境（[linux 篇](../linux/01-philosophy.md)的命令全部可用）。但要记住[第 1 篇](01-why-containers.md)的警告：exec 进去装的调试工具随容器消失——**诊断结论应该回溯到镜像或配置的修改**，而不是「容器里修好了」。

## 5. 生命周期：完整的循环

```bash
docker run -d --name web nginx:1.27     # 创建并启动
docker ps                                # 运行中（docker ps -a 看全部，含 Exited）
docker stop web                          # 优雅停止（SIGTERM → 10s 超时 → SIGKILL）
docker start web                         # 再次启动（数据与改动还在——容器还在）
docker restart web
docker rm web                            # 删除（必须先 stop，或 -f 强制）
docker rm $(docker ps -aq --filter "status=exited")   # 批量清理退出的容器

docker update --restart=always web       # 改运行中容器的策略
```

生命周期的关键区分：**stop → start 保留容器的写层与配置；rm → run 才是「全新实例」**。调试中「重启试试」（restart）与「重建」（rm + run）的效果不同——配置类修改（环境变量、端口、挂载）必须重建才生效（它们是 `run` 时定死的）。

## 6. 交互式容器：学习与实验

```bash
docker run -it --rm ubuntu:24.04 bash    # -it 交互 + --rm 退出即删：一次性的实验沙箱
# 进去后随便折腾（apt install、改文件），exit 后一切归零——完美的学习环境
```

「`-it --rm` 一次性容器」是学习/验证 Linux 行为（[linux 篇](../linux/01-philosophy.md)的实验）的完美工具：干净、无风险、即用即弃。加 `--network host` 或挂载目录可以做更真实的实验。

## 7. 陷阱清单

- 忘记 -d 却 Ctrl+C 退出：主进程收 SIGINT，容器停止；后台用 -d。
- 端口映射写反（-p 80:8080）：「服务起不来」其实是「映射方向错」；`docker port web` 核对。
- stop 后直接 rm：先 stop（或 rm -f）；批量清理用 ps -a 过滤。
- exec 进容器改配置当「部署」：容器重建即失效；配置进镜像/卷/环境变量。
- attach 用来调试：它连的是主进程（Ctrl+C 停容器）；看日志用 logs。
- 容器名冲突（--name 已存在）：`docker rm 旧名` 或命名带项目前缀。
- 只用 latest 标签：行为漂移无法追溯；镜像 tag 锁版本。

## 8. 小结

- hello-world 的输出就是机制：拉镜像 → 创建容器 → 跑主进程 → 进程退容器停——「容器=进程」贯穿一切行为。
- run 参数是日常词汇表：-d（后台）、-p（端口）、-e（配置）、-v（数据）、--name/--rm/--restart/资源限制——每个都有「忘了会怎样」的后果面。
- 生命周期关键区分：restart 保状态、rm+run 才应用新配置；ps -a 看全量、批量清理有固定配方。
- 调试双件套：logs（主进程输出）+ exec -it（进容器检查）；inspect/stats 补足元数据与资源视图。
- `-it --rm` 一次性容器是学习 Linux 与验证行为的零成本沙箱。

## 9. 练习

**1.** 用一条 docker run 启动 nginx，完成「浏览器访问 → logs 看访问日志 → exec 进容器改首页 → 再访问验证 → rm 重建 → 改动消失」的完整实验，并把每步的现象写下来。

> [!TIP]
> 思路这组实验把「写层临时性 + 端口映射 + logs 的来源（主进程 stdout）」全部落到操作上。改首页用 `echo` 写到 /usr/share/nginx/html/index.html。

**2.** 故意制造三类常见事故并修复：忘 -d 后 Ctrl+C、端口映射写反、--name 冲突——每类记录报错/现象与修复命令。

> [!TIP]
> 思路事故预演比事故复盘便宜。三类对应三种修复知识：-d 语义、宿/容方向、名字先删后建。

**3.** 对比三个调试命令的信息差异：`docker logs web`、`docker exec web cat /var/log/nginx/error.log`、`docker inspect web`——总结「什么时候用哪个」。

> [!TIP]
> 思路logs=主进程输出（应用视角）、容器内文件=应用自己写的日志文件（nginx 有）、inspect=配置与元数据（连接失败先看 IP 与端口）。三层的分工是排障路线（[第 10 篇](10-debug-ops.md)）的雏形。

**4.** 用 `-it --rm ubuntu:24.04 bash` 验证 [linux 篇](../linux/02-filesystem.md)的 inode 与硬链接行为——体会「一次性容器作为 Linux 实验沙箱」的工作流。

> [!TIP]
> 思路容器里实验的好处：干净内核版本、root 权限、即抛。危险实验（rm -rf 等）可以放心做——这正是「隔离」的日常红利。

**5.** 配置一个「自愈」的容器：--restart unless-stopped + 资源限制 + 命名规范，然后 `docker stop` 主进程（exec 里 kill 1）观察自动重启；再用 update 改内存上限。

> [!TIP]
> 思路kill 1（主进程）触发容器退出 → unless-stopped 拉起——自愈行为与 [systemd Restart](../linux/07-processes.md) 同构。对比两种「进程守护」的抽象层级。

**6.** 讨论：为什么「配置类修改必须 rm + run 重建」而「数据类修改 restart 即可」？从容器的「run 时配置不可变」推出一套「什么放环境变量、什么放卷、什么进镜像」的配置管理决策表。

> [!TIP]
> 思路决策表的骨架：随代码变的进镜像（构建期）、随环境变的进环境变量（run 时）、随生命周期变的进卷（持久层）。这三分法就是十二要素应用（12-factor）在容器世界的落地。
