---
title: 进程与任务管理
order: 7
tags: 核心, 进程, 信号
summary: ps/top/kill、前台后台与 nohup、常用信号语义、systemd 服务初识。
---

服务器上每个运行中的程序都是进程，进程管理就是你与系统的实时对话：谁在吃 CPU、谁卡死了、怎么让它优雅退出而不是被砍头。这一篇从查看到控制，再到用 systemd 和 cron 把长期服务与定时任务管起来。

## 查看进程

```bash
ps aux                        # 快照：所有用户的全部进程（BSD 风格，最常用）
ps -ef                        # 同样全列（System V 风格），多一列 PPID 父进程
ps aux --sort=-%mem | head    # 按内存倒序看前几名
ps aux --sort=-%cpu | head    # 按 CPU 倒序
ps -ef --forest               # 树状显示进程父子关系
```

`ps aux` 的关键列：`%CPU`/`%MEM` 占用率，`VSZ`/`RSS` 虚拟/实际内存，`STAT` 状态——`R` 运行、`S` 睡眠、`D` 不可中断的 IO 等待、`Z` 僵尸。`D` 状态的进程 kill 都杀不动，通常意味着存储层出问题了。

```bash
top                  # 实时刷新：P 按 CPU 排序、M 按内存、k 杀进程、q 退出
htop                 # 更好用的替代品，没有就 apt install htop
pgrep -a nginx       # 按名字找 PID（-a 顺带显示命令行）
```

> [!TIP]
> 分工记牢：ps 看快照，top 看趋势。top 里按 `1` 展开每个 CPU 核心的占用；磁盘 IO 怀疑对象用 `iostat -x 1` 或 `iotop` 观察。

## 信号与 kill

`kill` 发送的是**信号**，不是"杀死"——信号是进程间最原始的通知机制。常用的就这几个：

| 信号 | 编号 | 进程可捕获 | 语义 |
| --- | --- | --- | --- |
| SIGINT | 2 | 是 | 就是 Ctrl+C，请求中断 |
| SIGTERM | 15 | 是 | kill 默认发送。请求优雅退出：清理资源、落盘、通知子进程 |
| SIGKILL | 9 | **否** | 内核直接回收进程，不给任何清理机会 |
| SIGHUP | 1 | 是 | 终端断开时发送；nginx 等守护进程约定俗成用它"重载配置" |
| SIGSTOP / SIGCONT | 19 / 18 | 否 / 是 | 暂停 / 恢复进程 |

```bash
kill 1234            # 默认发 SIGTERM：先给它体面退出的机会
kill -9 1234         # ❌ 强杀是最后手段：数据没落盘、子进程变孤儿都是代价
kill -HUP 1234       # 让 nginx 重载配置
kill -l              # 列出全部信号，忘了编号就用它
pkill -f "python.*worker"   # 按完整命令行匹配杀（先 pgrep -f 预览会命中谁！）
```

正确姿势永远是**先 TERM，等几秒，无效再 KILL**。数据库这类进程被 SIGKILL 后重启要做崩溃恢复，慢且有风险——这就是为什么对它不能直接上 -9。

## 前台、后台与 nohup

```bash
long_task            # 前台跑：占住终端
long_task &          # 加 & 丢到后台，立刻拿回终端，输出仍打印到当前窗口
jobs                 # 看当前 shell 的后台任务（[1]+ Running ...）
fg %1                # 把 1 号任务调回前台
Ctrl+Z               # 暂停当前前台任务（发 SIGTSTP）
bg %1                # 让暂停的任务在后台继续跑
```

关键坑：**关掉终端，后台任务会死**——终端退出时 shell 给它们发 SIGHUP。三种对策：

```bash
nohup long_task &          # 忽略 SIGHUP，输出写进 nohup.out——最轻量的后台方案
disown %1                  # 任务已在跑、想脱离 shell：从 jobs 表里摘掉
systemd-run --user ...     # 更正式的方式
```

临时跑一炮用 nohup；长期跑的服务交给 systemd（下节）；需要断线重连、多窗口的交互式任务用 tmux/screen。三条路解决三个问题，别混着绕。

## systemd 服务初识

现代发行版里 PID 1 就是 systemd，一切开机自启服务都归它管：

```bash
systemctl status nginx        # 看状态：active(running) 还是 failed
sudo systemctl start nginx    # 启动
sudo systemctl stop nginx     # 停止（默认发 SIGTERM，等服务优雅退出）
sudo systemctl restart nginx  # 重启
sudo systemctl reload nginx   # 不停机重载配置（服务支持才有）
systemctl list-units --failed # 列出所有挂掉的服务
systemctl cat nginx           # 看这个服务用的是哪个 unit 文件、内容是什么
```

`enable`/`disable` 管的是**开机自启**（本质是创建/删除一个符号链接），和 start/stop 的"现在跑不跑"是两码事：

```bash
sudo systemctl enable --now nginx   # 开机自启 + 立即启动，一步到位
```

自己写的程序也能注册成服务——写一个 unit 文件放进 `/etc/systemd/system/`：

```ini
# /etc/systemd/system/myapp.service
[Unit]
Description=My App

[Service]
ExecStart=/usr/local/bin/myapp
Restart=on-failure            # 挂了自动拉起

[Install]
WantedBy=multi-user.target    # enable 时挂到哪个启动目标下
```

```bash
sudo systemctl daemon-reload        # 改完 unit 文件必须重载配置
sudo systemctl enable --now myapp
```

日志自动被 journald 收走，不用自己管文件：

```bash
journalctl -u myapp               # 只看这个服务的日志
journalctl -u myapp -f            # 实时跟踪（tail -f 的感觉）
journalctl -u myapp --since "1 hour ago"   # 按时间过滤
```

## 定时任务：cron

cron 是进程管理之外另一半的"任务管理"：到点执行命令。`crontab -e` 编辑当前用户的任务表：

```text
# 分 时 日 月 周   命令（共 5 个时间字段）
0 3 * * *     /home/deploy/backup.sh        # 每天凌晨 3 点
*/5 * * * *   /usr/local/bin/check.sh       # 每 5 分钟一次
0 9 * * 1-5   /usr/local/bin/report.sh      # 工作日早上 9 点
```

```bash
crontab -l            # 查看当前用户的定时任务
```

> [!WARNING]
> cron 的经典坑是**环境变量**：它跑在极简环境里，PATH 只有 `/usr/bin:/bin`，也不加载你的 bashrc。脚本里用到的命令要么写绝对路径，要么在脚本开头自己设置 PATH（见[环境变量与 shell 配置](11-environment-vars.md)）。

> [!NOTE]
> 让服务"永远在线"的正确答案是 systemd 的 `Restart=on-failure`，不是 nohup，更不是写个 cron 每分钟查进程。服务化之后还免费获得开机自启、日志集中、依赖管理。

相关阅读：[权限与用户](04-permissions.md)
