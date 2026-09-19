---
title: 进程与服务：信号、作业与 systemd
order: 7
tags: 进程, 信号, systemd, journalctl, 作业控制
summary: 进程树与 fork/exec 模型、ps/top 的输出解读（含 R/S/D/Z 状态与 load average 的真实含义）、信号体系与优雅关闭、作业控制（&/jobs/fg/bg/nohup）、systemd 服务管理与 journalctl 日志查询。
---

「程序」与「进程」的差别是静态与动态：程序是磁盘上的文件，进程是它的一次运行实例——有 PID、有内存、有打开的文件、有退出码。管理服务器就是管理进程：看它活着没有、卡在哪、怎么让它优雅退出、怎么让它开机自启。

## 1. 进程模型：树与 fork

Linux 的进程是**一颗树**：每个进程由父进程 fork（复制）+ exec（换程序）而来，init/systemd（PID 1）是所有进程的祖先。

```bash
ps -f --forest | head -20      # 树状进程列表
pstree -p                      # 更直观的树
cat /proc/self/status | head   # 自己的状态（/proc 的进程视图，[第 2 篇](02-filesystem.md)）
```

父进程退出而子进程还在时，子进程被 PID 1 收养；子进程退出但父进程没「收尸」（wait）时变成**僵尸（Z）**——僵尸不占内存只占进程表位，成片的僵尸说明父进程有 bug 而不是系统有病。

## 2. ps 与 top：观测的两大入口

### 2.1 ps 的两种输出风格

```bash
ps aux        # BSD 风格：USER PID %CPU %MEM VSZ RSS STAT START TIME COMMAND
ps -ef        # System V 风格：UID PID PPID ... （看父子关系）
ps aux --sort=-rss | head    # 按内存排序（RSS：常驻内存，实际占用的物理内存）
```

STAT 列的状态码是解读重点：

| 状态 | 含义                     | 关注点                              |
| ---- | ------------------------ | ----------------------------------- |
| R    | 运行/就绪                 | CPU 在干活                           |
| S    | 可中断睡眠（等事件/IO）    | 正常的等待态                         |
| D    | **不可中断睡眠**           | 通常在等磁盘/NFS——杀不掉，D 堆积 = 存储问题 |
| Z    | 僵尸                      | 父进程没 wait，看父进程              |
| T    | 停止                      | 被 SIGSTOP/调试器暂停                |

### 2.2 top/htop 与 load average

```bash
top                    # 交互式：M 按内存排序、P 按 CPU、k 杀进程、q 退出
htop                   # 现代替代品（彩色、树状、鼠标）
uptime
# 14:23:01 up 42 days,  load average: 3.20, 2.85, 2.10
```

load average 的三个数是**1/5/15 分钟的运行队列长度**（想用 CPU 的任务数 = 运行中 + 不可中断等待）。解读要除以核数：8 核机器 load 8 ≈ 满载（健康），load 32 = 严重排队。**load 高但 CPU% 低**的经典组合指向 D 状态堆积（存储慢）——load 与 CPU 是两个维度。

top 里 `%wa`（iowait）是「CPU 空闲但在等 IO」的比例——iowait 持续高 = 磁盘是瓶颈（[第 11 篇](11-ops-pitfalls.md)的性能入门）。

## 3. 信号：与进程对话的语言

信号是内核发给进程的异步通知，`kill` 命令发信号（名字吓人，本质是「发通知」）：

```bash
kill 1234              # 默认 SIGTERM（15）：请求优雅退出——进程可以清理后自尽
kill -9 1234           # SIGKILL：内核直接回收，进程无从感知、无法清理 —— 最后手段
kill -HUP 1234         # SIGHUP：约定俗成「重读配置」（守护进程的 reload 传统）
killall nginx          # 按名字；pkill -f "python.*worker" 按模式
```

必背信号表：

| 信号     | 编号 | 行为                          | 键盘            |
| -------- | ---- | ----------------------------- | --------------- |
| SIGTERM  | 15   | 请求终止（可拦截、可清理）      | `kill` 默认      |
| SIGKILL  | 9    | 强杀（**不可拦截、不可清理**）  | `kill -9`       |
| SIGINT   | 2    | 中断                          | `Ctrl+C`        |
| SIGHUP   | 1    | 挂断（守护进程读作「重载配置」） | 终端断开         |
| SIGSTOP/CONT | 19/18 | 暂停/恢复（不可拦截）      | `Ctrl+Z`（STOP）|

「先 TERM 后 KILL」是杀进程的礼仪：TERM 给进程机会刷缓冲、关连接、写状态；等几秒不走再 KILL。**KILL 掉数据库/写密集进程是数据损坏的经典来源**——它们没机会完成清理。

## 4. 作业控制：前台、后台与断线

```bash
./long-task.sh &          # & 直接后台跑
jobs                      # 当前 Shell 的作业列表
Ctrl+Z                    # 暂停当前前台作业（SIGSTOP）
bg %1                     # 让暂停的作业 1 在后台继续
fg %1                     # 调回前台

nohup ./task.sh &         # ★ 免疫 SIGHUP：终端断开（SSH 掉线）后继续跑
disown %1                 # 已启动的作业从 Shell 的作业表摘除（同效）
```

关键机制：SSH 会话断开时，终端发 SIGHUP 给所有作业——`&` 启动的后台作业**挡不住 SIGHUP**（照样被杀）。`nohup` 或 `disown` 才是「断线存活」的正解；更正经的长期任务用 systemd（下一节）或 tmux/screen（会话复用）。

## 5. systemd：服务的一生

现代发行版的服务管理统一在 systemd：

```bash
systemctl status nginx        # 状态（含最近日志几行）
systemctl start|stop|restart|reload nginx
systemctl enable nginx        # 开机自启（创建链接）；enable --now = 启动+自启一步
systemctl list-units --type=service --state=failed    # 找失败的服务
systemctl cat nginx           # 看它的 unit 定义文件
systemctl daemon-reload       # 改过 unit 文件后必做（重载定义）
```

一个最小自研服务的 unit 文件（`/etc/systemd/system/myapp.service`）：

```ini
[Unit]
Description=My App
After=network.target                    # 启动顺序约束

[Service]
ExecStart=/usr/local/bin/myapp --config /etc/myapp.conf
Restart=on-failure                      # 崩了自动拉起
RestartSec=3
User=appuser                            # 降权运行（[第 4 篇](04-permissions.md)）
WorkingDirectory=/var/lib/myapp
Environment="LOG_LEVEL=info"

[Install]
WantedBy=multi-user.target              # 开机自启的挂点
```

「把你的脚本变成服务」的全部要点就在这个骨架里：ExecStart 定义启动、Restart 定义崩溃策略、User 定义身份、 WantedBy 定义自启。改完 `daemon-reload` 再 `restart`。

### 5.1 journalctl：systemd 的日志总管

```bash
journalctl -u nginx                     # 某服务的日志
journalctl -u myapp -f                  # 实时跟踪（tail -f 的服务版）
journalctl -u myapp --since "1 hour ago"
journalctl -u myapp -n 100              # 最近 100 行
journalctl --disk-usage                 # 日志占了多少（可 vacuum 清理）
```

## 6. 优先级与资源

```bash
nice -n 10 ./batch-job &       # 启动时降优先级（不给交互任务抢 CPU）
renice 10 -p 1234              # 运行中调整（只能调高 nice 值的普通用户）
ulimit -n                      # 进程可开文件数上限（「Too many open files」事故的源头）
```

nice 的取值 −20（最高）~19（最低）——它不是「配额」只是「倾向」，真正的资源限制（内存/CPU 硬顶）用 cgroup（systemd 的 `CPUQuota=`/`MemoryMax=`，unit 文件里一行）。

## 7. 陷阱清单

- `kill -9` 当第一反应：跳过清理环节；先 TERM 等几秒。
- SSH 断线后台任务死亡：`&` 挡不住 SIGHUP；nohup/disown/tmux/systemd 四选一。
- load 高就慌：先除以核数、再看 CPU% 与 iowait 的组合——存储问题常伪装成「负载高」。
- 僵尸进程 kill 不掉就困惑：僵尸已经死了，该处理的是它的父进程。
- systemctl 改 unit 后忘 daemon-reload：改动「不生效」，误判为配置错误。
- 服务的 ExecStart 用相对路径/依赖登录环境：服务环境与终端环境不同（PATH/HOME 都不是你以为的）；全绝对路径 + 显式 Environment。
- ulimit 临时调整了事：会话级；持久化在 /etc/security/limits.conf 或 systemd 的 LimitNOFILE=。

## 8. 小结

- 进程是 fork/exec 树上的节点：ps 的 STAT（R/S/D/Z）与 load average（运行队列 ÷ 核数）是健康的两把尺；D 堆积指向存储。
- 信号是对话语言：TERM 请求优雅退出、KILL 是无清理的最后手段、HUP 是重载传统；「先 TERM 后 KILL」是礼仪。
- 作业控制：`&`/Ctrl-Z/fg/bg 管前台后台；断线存活靠 nohup/disown/tmux；长期任务升级 systemd。
- systemd 服务 = unit 文件四段式（Unit/Service/Install）+ daemon-reload + journalctl 日志；Restart/User/Environment 是自研服务的三个必配项。
- nice 是软倾向、cgroup 是硬配额；ulimit 的文件数上限是「Too many open files」的唯一源头。

## 9. 练习

**1.** 用 `sleep 300 &`、Ctrl+Z、fg、bg 完成一次作业控制全流程；然后关闭终端重开，用 `jobs` 验证后台作业的去向（被 SIGHUP 收走），再用 nohup 重复对照。

> [!TIP]
> 思路`ps` 确认 sleep 死了（SIGHUP 无情）vs nohup 版活着（输出进 nohup.out）。这一对照实验解释了「服务器上任务莫名消失」的一半案例。

**2.** 写一个「优雅关闭」演示脚本：trap SIGTERM 打印清理动作后退出；用 kill 发 TERM 观察 trap 触发，再 kill -9 观察清理代码被跳过。

> [!TIP]
> 思路脚本：`trap 'echo cleaning; exit 0' TERM; while true; do sleep 1; done`。TERM 触发 trap、KILL 绕过一切——「为什么数据库要缓慢关闭、为什么 kill -9 数据库危险」的微观答案。

**3.** 把一个后台脚本（如每分钟写时间戳到文件的 while 循环）做成 systemd 服务：写 unit、enable --now、journalctl -f 看日志、kill 掉进程观察 Restart= 拉起。

> [!TIP]
> 思路Restart=always + RestartSec=3 的自愈行为是 systemd 的核心价值——「进程死了自动回来」让 cron+nohup+screen 的老三样退休。journalctl -f 的实时性取代 tail -f。

**4.** 用 ps/top 分析一个 CPU 空转进程（`yes > /dev/null`）与一个 IO 等待进程（`dd if=/dev/sda of=/dev/null`）在 top 里的状态差异（STAT、%CPU、%wa）。

> [!TIP]
> 思路前者 R + 100%CPU；后者 D + 高 %wa。「CPU 密集与 IO 等待在 top 里长得完全不同」——load 高但 CPU 低的服务器，答案通常在 D 状态进程里。

**5.** 给你的 app 服务加资源配额：CPUQuota=50%、MemoryMax=500M，故意让应用内存超标（分配大数组），观察 systemd 的处理（OOM kill + 重启）与 journalctl 的记录。

> [!TIP]
> 思路cgroup 配额是「硬顶」——超限即被内核 OOM killer 收走，systemd 按 Restart 策略拉回。对比 ulimit 的「会话级软限制」，生产服务的资源治理已经统一收敛到 unit 文件。

**6.** 讨论：`systemctl restart` 与 `reload` 的语义差（以 nginx 为例）：什么信号、什么代价、什么场景必须 restart 而不能 reload？

> [!TIP]
> 思路reload = SIGHUP/平滑重载（老 worker 处理完存量请求再退，不断连接），restart = 全停全起（断连秒级）。证书/主程序升级必须 restart；限流规则/上游列表类配置 reload 足够。「重启代价」是服务设计（能否热重载）的度量之一。
