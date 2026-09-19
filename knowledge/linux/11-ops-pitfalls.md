---
title: 运维与陷阱全景：服务器的日常
order: 11
tags: journalctl, df, 性能, 安全基线, rm 事故
summary: 磁盘（df/du）与日志（journalctl/轮转）的日常巡检、性能入门的顺序（load→CPU→内存→IO→网络）、rm 类灾难的防御工程、服务器安全基线（SSH 加固/最小权限/防火墙/自动更新），以及一份按「出现频率 × 危害」排序的运维陷阱清单。
---

前几篇讲了机制与工具；本篇讲**把机器养好**的日常：磁盘、日志、性能、安全四条巡检线，加上把事故变成工程问题的防御清单。运维的元技能是**顺序**——出问题时先查什么后查什么，比会多少命令重要。

## 1. 磁盘：最常爆的资源

```bash
df -h                    # 文件系统层：哪块盘满了（i 节点用 df -i 看：小文件灾难）
du -h --max-depth=1 /var | sort -rh | head     # 目录层：/var 里谁吃的空间

lsof +D /var/log 2>/dev/null | grep deleted    # 「rm 了但空间没释放」：进程还开着文件
```

磁盘满的三种典型现场：

1. **日志暴涨**：`/var/log` 的某个文件失控——治本靠 logrotate（轮转 + 压缩 + 保留 N 份，`/etc/logrotate.d/` 每服务一个策略文件）。
2. **rm 后不释放**：进程持有已删除文件的 inode——`lsof | grep deleted` 找到持有者重启它，或截断 `/proc/<pid>/fd/<n>`（[第 2 篇](02-filesystem.md)练习 5）。
3. **inode 耗尽**：df 显示还有空间但写不进——百万小文件（缓存/邮件目录）吃光 inode；`df -i` 确认。

预防：`df` 进监控（阈值告警在 80%，不是 99%——到 99% 已经来不及了），日志全部走轮转，临时目录有清理策略。

## 2. 日志：系统的记忆

```bash
journalctl -u nginx --since today        # 服务日志（[第 7 篇](07-processes.md)）
journalctl -p err -b                     # 本次开机以来的错误级
journalctl -f                            # 实时总流

tail -f /var/log/syslog                  # 传统日志文件（非 systemd 管的）
grep -i error /var/log/nginx/error.log | tail
```

读日志的纪律：**先看时间窗内、先看 error 级、先看重复模式**（同一错误刷屏 1000 次只需要看第一次）。应用日志的结构化（JSON 每行一条）让 grep/awk 分析更稳——`journalctl -o json` 也能输出结构化。

## 3. 性能入门：五步排查顺序

服务器变慢时的固定顺序（每步用一两个命令，从粗到细）：

```bash
uptime                        # ① load：除以核数，先定「系统整体是否过载」
top / htop                    # ② CPU：谁在吃（us 用户态 / sy 内核态 / wa 等 IO）
free -h                       # ③ 内存：available 才是真实可用（不是 free！）
                              #    swap 用得多 = 内存压力大
iostat -x 2                   # ④ IO：%util、await——磁盘是不是瓶颈
ss -s / ip -s link            # ⑤ 网络：重传、丢包（更深的用 net 篇的工具）
```

| 现象                        | 第一嫌疑                         | 下一步                        |
| --------------------------- | -------------------------------- | ----------------------------- |
| load 高 + us 高             | CPU 密集（某进程失控）            | top 找进程 → cProfile/剖析     |
| load 高 + wa 高             | 磁盘慢（日志写入、数据库）        | iostat 定位盘 → 找写它的进程    |
| load 高 + CPU 低 + free 低  | 内存压力/swap 抖动                | free -h → 找内存大户          |
| 系统空闲但仍慢              | 网络或外部依赖                    | ping/curl 分段定位            |

内存的常识修正：**Linux 会把空闲内存拿去做缓存（buff/cache），`free` 列几乎总是接近 0——这是健康的**；看 `available` 列。内存真紧张的信号是 swap 的 si/so（iostat 里的换入换出）持续非零。

## 4. rm 类灾难的防御工程

`rm -rf` 的防御不是「小心」，是**结构**（[第 3 篇](03-file-ops.md)的习惯 + 本节的系统级防线）：

1. **备份先于一切**：rsync 快照链（[第 8 篇](08-network-remote.md)的 link-dest 方案）+ 异地副本；「能恢复」让删除事故降级为「小麻烦」。
2. **权限隔离**：生产数据目录的属主是服务账号、运维用受限 sudo（[第 4 篇](04-permissions.md)）——误操作的爆炸半径由权限圈定。
3. **删除的两步法**：先 `mv` 到 `/tmp/to-delete-$$`（当日清理），确认无申诉再真删——「缓冲区」抵消手滑。
4. **高危操作强制确认**：`rm -rf $VAR` 类命令写脚本时用 `${VAR:?}`；交互 shell 里 `echo` 预演通配符。
5. **文件系统快照**：LVM/btrfs/ZFS 的快照让「整个盘的 rm」也能回滚——基础设施级的后悔药。

## 5. 服务器安全基线

```bash
# SSH 加固（/etc/ssh/sshd_config）
PasswordAuthentication no          # 免密验证成熟后关密码（[第 8 篇](08-network-remote.md)）
PermitRootLogin no                 # 禁 root 直接登录
# 改完：systemctl reload sshd（reload 不断当前会话——验证后再断开旧会话！）

# 防火墙：默认拒绝，白名单放行
ufw default deny incoming && ufw allow 22 && ufw enable

# 自动安全更新
sudo apt install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades

# 定期自查
ss -tlnp                           # 有没有不认识的监听端口
sudo last -20                      # 登录记录
find / -perm -4000 2>/dev/null     # setuid 清单（[第 4 篇](04-permissions.md)）
```

基线的逻辑是**缩小攻击面**：能不暴露的端口不暴露（防火墙 + 只绑内网）、能不用的账号不用（root 禁登）、能自动打的补丁自动打。再往上是 fail2ban（爆破封禁）与审计日志——按资产重要性加码。

## 6. 运维陷阱清单（按频率 × 危害排序）

| 陷阱                                  | 防线                                   |
| ------------------------------------- | -------------------------------------- |
| 磁盘满导致服务异常（日志暴涨）          | df 告警 80% + logrotate                  |
| rm 误删生产数据                        | 备份快照 + 两步删除 + 权限隔离           |
| SSH 配置改错把自己锁外面               | reload 前保留旧会话验证；先起新连接再断旧 |
| 内存 OOM 杀掉关键进程                  | available 监控 + systemd MemoryMax 隔离 |
| 时区/时间漂移（证书、日志对不上）        | chrony/ntp 常驻 + 时区显式 UTC           |
| 凭据进日志（token 打在命令行/日志里）    | 日志脱敏 + 凭据走环境变量与密钥管理       |
| 升级后服务没起来（忘了 enable）        | 变更清单含 enable --now 检查             |
| 防火墙三层漏配（云安全组最常忘）        | [第 8 篇](08-network-remote.md)的三层排查表 |
| 改配置不备份原文件（回不去）            | `cp file file.bak.$(date +%F)` 前置习惯  |
| kill -9 数据库/写密集进程              | 先 TERM 后 KILL（[第 7 篇](07-processes.md)） |

时间同步值得单独一句：**一切日志对账、证书校验、分布式协调都假设时钟基本一致**——新服务器第一件事装 chrony，比任何应用配置都优先。

## 7. 小结

- 磁盘巡检三现场：日志暴涨（logrotate 治本）、rm 不释放（lsof deleted）、inode 耗尽（df -i）；告警阈值在 80%。
- 日志纪律：时间窗 + error 级 + 重复模式；journalctl 的服务维度与结构化输出。
- 性能五步序：load ÷ 核数 → CPU（us/sy/wa）→ 内存（available 与 swap）→ IO（%util/await）→ 网络；「load 高 CPU 低」指向存储或内存。
- rm 防御是工程：备份快照、权限圈定爆炸半径、两步删除、LVM 快照——「能恢复」优于「不手滑」。
- 安全基线 = 缩小攻击面：SSH 加固、默认拒绝的防火墙、自动安全更新、定期自查（监听/登录/setuid）。
- 新服务器仪式：装 chrony 对时——时间是一切对账与证书的隐含前提。

## 8. 练习

**1.** 给你的系统做一次完整巡检并记录：df/du（磁盘）、journalctl -p err（错误）、uptime+free（性能基线）、ss -tlnp（暴露面）——把「健康状态」写成一份你自己的基线文档。

> [!TIP]
> 思路巡检的价值在「基线」：知道正常时长什么样，异常才能被一眼识别。基线文档四张表（磁盘/错误/性能/端口）就是你的机器病历本。

**2.** 复现「rm 后磁盘不释放」并修复：用 dd 造大文件 → 后台进程持有它（tail -f）→ rm → df 验证空间未释放 → lsof 找持有者 → 修复（重启进程或截断 fd）。

> [!TIP]
> 思路修复选项：重启持有进程（简单）或 `: > /proc/<pid>/fd/<N>`（就地释放、不中断服务——数据库日志场景的急救招）。两个方法对应两种维护窗口。

**3.** 为一个虚拟机配置 logrotate 策略：某应用日志按天轮转、保留 14 天、压缩、缺失不报错；用 `logrotate -d`（dry-run）验证配置，再手动 `logrotate -f` 触发一次观察结果。

> [!TIP]
> 思路配置五要素：路径、rotate 14、daily、compress、missingok。`-d` 先验证是 logrotate 的「dry-run 文化」——配置错误的最坏结果是「日志没轮」而不是「数据没了」，所以敢 dry-run 就敢上线。

**4.** 按[第 7 篇](07-processes.md)的信号礼仪设计一次「服务重启」SOP：TERM 优雅等待（最长时间）→ 检查进程状态 → 必要时 KILL → systemd 拉起 → 健康检查。写成脚本并用一个测试服务演练。

> [!TIP]
> 思路`kill -TERM $pid; for i in {1..30}; do [[ ! -e /proc/$pid ]] && break; sleep 1; done; kill -KILL $pid 2>/dev/null`——「给清理留时间窗」是 KILL 纪律的脚本化。健康检查（curl 探活）收尾才叫「重启完成」。

**5.** 加固一台测试虚拟机：SSH 禁密码禁 root、ufw 只开 22 与业务端口、装 unattended-upgrades、改完用「新开连接验证、旧连接兜底」的流程确认没把自己锁外面。

> [!TIP]
> 思路「先起新连接再断旧」是远程改 SSH 配置的保命流程——reload 生效后新连接验证成功，旧会话才退场。任何「远程改自己的通道」的操作都适用此模式（防火墙、路由、sudoers）。

**6.** 讨论：一台「变慢」的服务器，为什么顺序（load→CPU→内存→IO→网络）不能乱？从「每层排除的成本」与「信息增益」的角度分析，并说明哪一步最常被跳过、跳过的代价是什么。

> [!TIP]
> 思路load 定「有没有病」，分层定位「病在哪」——先跑昂贵的深挖（如 strace/抓包）会在错误层面浪费数小时。最常被跳过的是内存检查（swap 抖动被误判为「CPU 慢」）——free -h 一眼的事，跳过它就是「方向性误诊」的经典样本。
