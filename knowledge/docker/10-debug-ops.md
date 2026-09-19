---
title: 调试与运维：容器的日常
order: 10
tags: 调试, OOM, healthcheck, 日志驱动, docker events
summary: 五步调试路线（logs/inspect/exec/stats/events）、日志驱动的配置与轮转、资源限制与 OOMKilled 的诊断、healthcheck 的设计要点，以及容器化应用的典型生产故障（OOM、信号、僵尸进程、时钟）。
---

容器上线后的日常是「看状态、查故障、控资源、保清洁」。本篇把 [第 2 篇](02-install-cli.md)的调试双件套扩展成完整的**五步路线**，再讲四个容器特有的生产故障——它们与 [linux 篇](../linux/11-ops-pitfalls.md)的运维清单互为镜像，但多了容器层的独特机制。

## 1. 五步调试路线

```bash
docker ps -a                        # ① 状态：活着吗？退出码多少？
docker logs --tail 100 web          # ② 应用日志：它自己说了什么
docker inspect web                  # ③ 元数据：配置对吗（退出码/OOMKilled/重启次数）
docker stats --no-stream           # ④ 资源：CPU/内存水位
docker events --since 10m          # ⑤ 事件流：Docker 层发生了什么（die/oom/kill）
```

inspect 里的关键退出诊断字段：

```bash
docker inspect web --format '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}} {{.RestartCount}}'
# exited 137 false 3     ← 137 = 128+9：SIGKILL 杀的（不是 OOM 就是手动 kill -9）
# exited 137 true  3     ← OOMKilled=true：内存超限被内核杀（[linux 第 7 篇](../linux/07-processes.md)信号表的落地）
```

**退出码翻译表**：0 正常退出、137 SIGKILL（OOM 高嫌疑）、143 SIGTERM（正常终止信号收到）、126/127 命令无法执行/不存在。`docker events` 是「容器为什么死了」的目击者——oom、die、exec_create 全部留痕。

## 2. 日志：驱动、轮转与结构化

```bash
docker logs 的来源 = 容器主进程的 stdout/stderr（dockerd 收集到 json 文件）
```

应用日志的最佳实践因此是：**只写 stdout**（不写文件）——容器侧自动收集，`docker logs`/日志采集器（fluentd/promtail）都能接管。日志驱动配置（daemon 全局或每容器）：

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
```

不加轮转的 json-file 驱动是**磁盘事故大户**（[linux 篇](../linux/11-ops-pitfalls.md)日志暴涨的容器版）：高流量容器一天写几十 GB，宿主盘满拖垮全机。应用侧结构化输出（JSON 每行一条）让 `docker logs | jq` 与采集系统直接可用。

## 3. 资源限制与 OOM

```bash
docker run -d --memory=512m --memory-swap=512m --cpus=1.5 --name web myapp
# --memory-swap=512m：禁 swap（内存超限直接 OOM 而不是拖慢）
```

cgroups 限额（[第 1 篇](01-why-containers.md)）的容器面：**超内存 = cgroup OOM killer 杀主进程**（ExitCode 137 + OOMKilled=true）——「应用在容器里跑一阵就被杀」的第一诊断就是 inspect 的 OOMKilled 字段。

OOM 的两层预防：**限制值给对**（观察 stats 的真实水位 × 安全系数，而不是拍脑袋 512m）+ **应用内的内存治理**（连接池上限、批量大小、泄漏排查——[C 篇](../c/07-dynamic-memory.md)的泄漏清单在语言层）。JVM 类应用还有堆与容器限额的识别问题（`-XX:MaxRAMPercentage` 替代固定 -Xmx）。

## 4. healthcheck：就绪语义的实现

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
```

三个参数的设计含义：`interval`（多久查一次）、`start-period`（启动宽限——应用冷启动期间失败不计入）、`retries`（连续失败几次才判 unhealthy）。healthcheck 的状态是「健康语义」的声明：

```bash
docker inspect web --format '{{.State.Health.Status}}'    # starting/healthy/unhealthy
```

healthcheck 检查什么决定它的价值：**进程活着（弱）→ 端口可连（中）→ 业务探针（/health 返回依赖状态，强）**。深度检查（依赖数据库连通）适合「liveness 与 readiness 分离」的编排场景——compose 里它是 depends_on 的 condition（[第 7 篇](07-compose.md)），K8s 里拆成 liveness/readiness 两个探针。

## 5. 清洁：磁盘与生命周期的保养

```bash
docker system df            # 四类对象占用总览
docker system prune         # 悬空层 + 停止容器 + 无用网络
docker system prune -a --volumes    # ⚠️ 核弹档：连未引用镜像与卷一起清（生产禁用）

# 精确打击：
docker container prune; docker image prune -a; docker builder prune   # 构建缓存（[第 9 篇](09-dockerfile-best.md)）
```

构建密集环境的磁盘三大户：**构建缓存、日志文件、dangling 镜像**——「定期 prune + 日志轮转」是容器宿主的固定保养（cron 一条，[linux 篇](../linux/07-processes.md)）。prune 的纪律：先 `df` 看占比、再分级清理、**`--volumes` 永远单独决策**（[第 5 篇](05-volumes.md)的数据红线）。

## 6. 容器特有的生产故障

| 故障                        | 症状                                | 机制与对策                                      |
| --------------------------- | ----------------------------------- | ----------------------------------------------- |
| OOM 杀容器                   | ExitCode 137 + OOMKilled             | 限额过小或泄漏；inspect 定位 + 调限额/修泄漏     |
| 优雅关闭失败（数据损坏/重启慢）| stop 卡 10 秒后强杀                  | shell 形式 CMD（[第 4 篇](04-dockerfile.md)）或进程不处理 SIGTERM；exec 形式 + 信号处理 |
| 僵尸进程堆积                 | 容器内 ps 出现 defunct               | 主进程没 wait 子进程；tini/`--init` 兜底         |
| 时钟漂移                     | 日志时间乱、证书校验失败             | 容器共享宿主内核时钟（一般无此问题）；宿主 chrony（[linux 篇](../linux/11-ops-pitfalls.md)）|
| 时区不对                     | 日志时间差 8 小时                    | 镜像默认 UTC；`-e TZ=Asia/Shanghai` 或统一 UTC 存储 |
| 端口耗尽/冲突                | bind: address already in use         | [第 6 篇](06-networks.md)的排查表                 |

**僵尸进程与 `--init`** 值得单独一句：容器里 PID 1 由你的应用担任——它如果不承担「收尸」职责（多数语言运行时不自动做），子进程退出后变僵尸累积。`docker run --init`（注入 tini 作 PID 1）一行解决——这是「容器不是轻量 VM」的又一处机制差异。

## 7. 陷阱清单

- 日志驱动无轮转：磁盘大户；max-size/max-file 全局配置。
- OOM 后只重启不诊断：inspect 的 OOMKilled/RestartCount 是第一现场；限额要基于观测。
- 内存限额忘了 memory-swap：swap 拖慢代替 OOM——「变慢被误判为 CPU 问题」。
- healthcheck 查得太深（依赖全链路）或太浅（只查进程）：探针分级设计。
- prune 用 --volumes 兜底：数据蒸发；卷的清理单独走（[第 5 篇](05-volumes.md)）。
- 多阶段时区/区域设置不一致：显式 TZ/UTC；时间语义全链路统一。
- 用 restart 策略掩盖崩溃循环：RestartCount 高企要当「应用健康问题」处理而不是「容器配置问题」。

## 8. 小结

- 五步调试路线（ps -a/logs/inspect/stats/events）覆盖「状态→日志→配置→资源→事件」五个信息面；退出码 137/143 的翻译是诊断的起点。
- 日志的最佳实践链：应用写 stdout → 驱动收集（带轮转）→ 结构化输出给采集——「容器里写日志文件」是反模式。
- 资源限额的治理：限额值来自 stats 观测、OOMKilled 是明确信号、JVM 类应用注意堆识别容器的语义。
- healthcheck 分级（进程/端口/业务探针）决定它的价值；它是 compose condition 与 K8s 探针的共同基础。
- 容器特有故障清单（OOM/信号/僵尸/时区）的机制根源都在「共享内核 + PID 1 语义」——`--init` 与 exec 形式是两颗定心丸。

## 9. 练习

**1.** 制造并诊断一次 OOM：容器限 64MB 跑一个吃内存的进程（如 Python 分配大列表），观察 137 退出码、inspect 的 OOMKilled、docker events 的 oom 事件——写一份故障报告（现象/证据/根因/修复）。

> [!TIP]
> 思路报告模板四字段是[第 6 篇](06-networks.md)排障的延续。修复验证：调大限额恢复正常——「限额与负载匹配」的闭环。

**2.** 优雅关闭实验：两个镜像（shell/exec 形式 CMD），`time docker stop` 计时对比；再给应用加 SIGTERM 处理（打印清理日志）验证信号到达——汇总成「为什么 exec 形式是铁律」的证据链。

> [!TIP]
> 思路shell 版卡满 10 秒（T+KILL）且清理代码没跑；exec 版秒退且清理执行。信号实验把 [linux 篇](../linux/07-processes.md)的 TERM/KILL 礼仪在容器语境里闭环。

**3.** 用 `--init` 验证僵尸回收：跑一个「创建子进程但不 wait」的应用（shell 脚本 & 子进程即可），对比有无 --init 时容器内 ps 的僵尸数量。

> [!TIP]
> 思路没有 --init 时 PID 1 是你的应用（不收尸）→ defunct 累积；--init 后 tini 收尸。这个实验证明「PID 1 语义」是容器的独特运维知识。

**4.** 配置一套日志治理：daemon.json 全局轮转 + 一个应用的结构化日志（JSON 行）+ `docker logs --tail | jq` 的查询姿势；制造 1GB 日志验证轮转生效。

> [!TIP]
> 思路验证点：日志文件大小封顶在 max-size × max-file、旧轮转文件被删。结构化后 `docker logs web | jq 'select(.level=="error")'` 的体验是「日志即数据」。

**5.** 给 compose 栈加全套健康治理：healthcheck（业务探针）+ depends_on condition + restart 策略 + 资源限额——然后手动 kill 主进程观察自愈全过程（events + ps 记录时间线）。

> [!TIP]
> 思路时间线模板：kill → die 事件 → restart 策略拉起 → start-period 内 healthcheck 不计 → healthy。这套自愈链条跑通，「单机生产的可用性」就有了下限保障。

**6.** 讨论：容器日志「写 stdout 而不是写文件」为什么成为铁律？从「日志的生命周期归属」「采集架构」「轮转责任」三个维度分析，并对照 [linux 传统服务写 /var/log](../linux/11-ops-pitfalls.md) 的模式——两种模式各自的运维前提是什么？

> [!TIP]
> 思路stdout 模式的前提：有统一的收集层（dockerd/采集器）接管；/var/log 模式的前提：有 logrotate 与磁盘预算。「日志放哪」没有对错，只有「谁负责轮转与采集」的责任归属——分布式系统里责任清晰比形式正确更重要。
