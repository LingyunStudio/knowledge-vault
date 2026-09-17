---
title: 调试与运维
order: 10
tags: 进阶, 日志, 排查
summary: logs/exec/inspect/stats 四板斧、进容器排查、资源限制与磁盘清理。
---

容器出了问题从哪下手？日常 90% 的排查靠四条命令：logs 看输出、exec 进现场、inspect 查配置、stats 看资源。这一篇把四板斧用顺，再补上资源限制、OOM 判定和磁盘清理——单机运维 Docker 的基本盘。

## 四板斧速览

```bash
docker logs -f --tail 100 web     # 跟踪最近 100 行日志（-t 加时间戳）
docker logs --since 30m web       # 最近 30 分钟的日志
docker exec -it web sh            # 进容器开个 shell
docker inspect web                # 全量元数据：配置、网络、挂载、状态
docker stats                      # 所有容器实时 CPU/内存/网络/IO
```

日志从哪来：容器内 PID 1 的 stdout/stderr 被 daemon 接走，默认用 json-file 驱动落盘。所以**应用要往 stdout 打日志**，别写本地文件——写文件的日志 docker logs 看不到，还得进容器翻，日志分散在各容器里也收不拢。

```bash
docker inspect -f '{{.HostConfig.LogConfig}}' web    # 查日志驱动
# daemon.json 里全局配轮转：
# { "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
```

> [!WARNING]
> 默认 json-file 不轮转，长期运行的服务能把磁盘写满。生产容器要么在 daemon.json 里全局配 max-size/max-file，要么 compose 里逐服务配 logging。另外容器删除后它的日志随之消失——要留档就接集中式日志或换转发类驱动。

## exec 进容器排查

```bash
docker exec -it web bash          # Debian/Ubuntu 系镜像
docker exec -it web sh            # alpine 没有 bash，用 sh
docker exec web ps aux            # 不进交互，直接执行命令看进程
docker exec -it db psql -U postgres    # 直接跑容器内的客户端，本地连装都不用装
```

exec 起的进程是"容器里多出来的一个进程"，退出它不影响主进程——这是和 attach 的本质区别：

> [!WARNING]
> 别用 `docker attach` 做日常排查：它挂上的是主进程的 stdin/stdout，Ctrl+C 会把信号发给 PID 1——多数容器当场就停了。看日志用 `logs -f`，进容器用 `exec -it`，attach 只在交互式调试前台进程时有用。

精简镜像（alpine、distroless）里没有 curl、ps，甚至没有 shell，两种思路：

```bash
# 思路一：借目标容器的网络/文件系统，用一个带工具的容器去查
docker run -it --rm --network container:web nicolaka/netshoot   # 全套网络排查工具
docker run -it --rm -v pgdata:/data alpine sh                   # 挂同一个卷直接看数据

# 思路二：真需要宿主机视角时用 nsenter 进 PID 命名空间（需要 root 和容器主进程 PID）
nsenter -t $(docker inspect -f '{{.State.Pid}}' web) -n -p sh
```

## inspect 与 stats

inspect 输出很大，重点是 `--format` 抽字段（Go template）：

```bash
docker inspect -f '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}' web
docker inspect -f '{{.RestartCount}}' web                                 # 重启过几次
docker inspect -f '{{json .Mounts}}' web | python -m json.tool            # 挂载关系
docker inspect -f '{{.NetworkSettings.Networks.appnet.IPAddress}}' web    # 指定网络的 IP
```

`OOMKilled` 是最值得记的字段：容器无声无息消失，十有八九是内存超限。

```bash
docker stats --no-stream         # 快照一次，不刷屏
docker top web                   # 容器内进程列表（宿主机视角）
```

## 资源限制与退出码

不加限制的容器可以吃满宿主机，共享机器上的容器必须配额：

```bash
docker run -d --name web \
  --memory=512m --memory-swap=512m \    # 内存 512M，swap 也不给
  --cpus=1.5 \                          # 最多 1.5 核
  --pids-limit=200 \                    # 进程数上限，防 fork 炸弹
  myapp:1.0
```

容器退出码速查：

| 退出码 | 含义 |
| --- | --- |
| 0 | 正常退出 |
| 137 | 128+9，被 SIGKILL——最常见元凶是超内存被 OOM 杀 |
| 143 | 128+15，收到 SIGTERM（docker stop 的正常结果） |
| 125 | daemon 层面启动失败，参数或端口有问题 |
| 126 / 127 | 命令不可执行 / 命令不存在——多半是 Dockerfile 或启动命令拼错 |

> [!TIP]
> 排查"容器反复重启"三连：`docker ps -a` 看退出码 → `docker inspect -f '{{.State.OOMKilled}}'` 确认是否 OOM → `docker stats` 对照限制值。OOM 的解法是调大 `--memory` 或修内存泄漏，重启策略只会让它无限循环地死。

## 磁盘清理

Docker 吃磁盘是常态，先看账单再动手：

```bash
docker system df          # 总览：镜像/容器/卷/构建缓存各占多少、可回收多少
docker system df -v       # 明细到每个镜像、每个卷
```

```bash
docker container prune    # 清所有已停止的容器，安全
docker image prune        # 只清悬空镜像（<none>:<none>），安全
docker image prune -a     # ❌ 清所有没被容器使用的镜像——下次部署全量重拉
docker volume prune       # ❌ 清未使用的卷——数据可能就在里面，最高危
docker builder prune      # 清构建缓存——只是下次构建变慢，无数据损失
docker system prune       # 上述低危项 + 无用网络的打包清理
docker system prune -a --volumes   # ❌❌ 全家桶，卷也删，生产机器上禁用
```

> [!TIP]
> 清理优先级从低危到高危：builder → container/image → system → volume 相关。卷永远最后动，动之前 `docker volume ls` 逐个确认。磁盘告警时的安全顺序：先构建缓存，再悬空镜像，再停止的容器。

## 事件与全景

```bash
docker events --since 1h  # 过去一小时的容器事件：谁退出、被谁杀、何时重启
docker system info        # daemon 全局状态
docker port web           # 端口映射
docker diff web           # 容器对文件系统的改动（对照镜像与分层篇的 CoW）
```

排查一条龙的实际顺序通常是：`ps -a` 看退出码和重启次数 → `logs --tail` 看临终输出 → `inspect` 看 OOMKilled、挂载、网络配置 → `exec` 或 netshoot 进现场复现 → `stats`/`events` 对时间线。工具都在，关键是按证据链走，而不是挨个命令碰运气。

相关阅读：[Docker Compose](07-compose.md)、[安装与第一个容器](02-install-first.md)
