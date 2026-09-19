---
title: 网络工具与 SSH：远程世界的入口
order: 8
tags: ssh, 密钥, rsync, curl, ss, 隧道
summary: SSH 密钥体系与免密配置的完整流程、~/.ssh/config 的别名管理、三类端口转发、rsync 的增量同步与备份方案、ss/ip/curl/dig 的现代诊断工具箱，以及 host key 变更与权限要求的陷阱处理。
---

协议的原理在[计算机网络篇](../net/01-layered-model.md)；本篇讲**操作面**：作为运维者，你与网络的日常交互是 SSH 登录、文件同步、端口诊断、HTTP 调试四类。SSH 是这个世界的正门——密钥体系、配置管理、隧道能力都值得系统掌握。

## 1. SSH：密钥体系与免密登录

### 1.1 密钥对与公钥认证

```bash
ssh-keygen -t ed25519 -C "alice@laptop"     # 生成密钥对（ed25519 现代首选；~/.ssh/）
ls ~/.ssh
# id_ed25519      私钥（绝不离开本机，权限 600！）
# id_ed25519.pub  公钥（随便发——它就是「锁」不是「钥匙」）
```

公钥认证的机制：把**公钥**放到服务器的 `~/.ssh/authorized_keys`，登录时服务器用公钥发起一道只有持有**私钥**者能通过的挑战——私钥全程不传输。免密配置的完整流程：

```bash
ssh-copy-id user@server       # 一键：把公钥追加到服务器的 authorized_keys
# 等价手工：cat ~/.ssh/id_ed25519.pub | ssh user@server 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys'
ssh user@server               # 无密码直接进入
```

服务器端 `authorized_keys` 与 `~/.ssh` 的权限要求严格（`.ssh` 700、authorized_keys 600、家目录不可组可写）——权限不对，sshd 直接拒绝公钥登录，这是「配了免密还要密码」的第一原因（sshd 的 `-v` 调试看拒绝原因）。

### 1.2 ssh-agent 与多密钥

```bash
eval "$(ssh-agent)"           # 启动代理
ssh-add ~/.ssh/id_ed25519     # 私钥解密一次装入内存（之后免输 passphrase）
ssh-add -l                    # 查看已装载
```

私钥本身建议加 passphrase（生成时设置）——**私钥文件泄露 ≠ 立即沦陷**（还有 passphrase 挡一层），agent 让你「每次会话只解一次」。

### 1.3 ~/.ssh/config：SSH 的「书签 + 策略」

```
# ~/.ssh/config（权限 600）
Host web
    HostName 203.0.113.10
    User deploy
    Port 2222
    IdentityFile ~/.ssh/id_ed25519_work

Host db-*
    User admin
    ProxyJump web            # ★ 跳板：经 web 访问内网 db-*（现代跳板写法）

Host *
    ServerAliveInterval 60   # 保活（防 SSH 空闲断线）
    ServerAliveCountMax 3
```

之后 `ssh web`、`ssh db-01` 一键直达，跳板链路自动构建。config 还被 scp/rsync/git（SSH 协议）共享——**别名是整个 SSH 生态的统一入口**。

## 2. 端口转发：隧道的三种形态

```bash
# 本地转发：把远程服务拉到本地端口
ssh -L 5432:db.internal:5432 user@web
# 之后本机连 localhost:5432 == 经 web 加密隧道访问 db.internal:5432
# 场景：本地 GUI 工具访问内网数据库（不开放公网端口！）

# 远程转发：把本地服务推给远程
ssh -R 8080:localhost:3000 user@server
# 服务器上的 localhost:8080 == 你的开发机 3000（内网穿透的朴素形态）

# 动态转发（SOCKS 代理）
ssh -D 1080 user@server       # 本机 1080 变成 SOCKS5 代理，出口是 server
```

隧道是 SSH 除登录外最常用的能力——**「内网服务不出网」的安全策略与「我需要本地访问」的需求之间的标准解法**。加 `-N`（不开 Shell 纯转发）与 `-f`（后台化）组合成常驻隧道。

## 3. rsync：增量同步的标准答案

```bash
rsync -avz src/ user@server:/backup/src/     # -a 归档(保属性) -v 详细 -z 压缩传输
rsync -avz --delete src/ dst/                # ★ --delete：镜像同步（源删了目标也删）
rsync -avzP 大文件.iso user@server:/tmp/     # -P 断点续传 + 进度

# rsync 式增量备份（快照去重——[第 2 篇](02-filesystem.md)硬链接的实战）
rsync -a --delete --link-dest=/backup/昨天的目录 src/ /backup/今天的目录
# 未变化的文件用硬链接指向前一天：每天完整快照，只占变化部分的磁盘
```

rsync 与 scp 的区别是**增量**：只传输差异块（滚动校验），中断可续传、重复执行近零成本。cp -a 是一次性复制、rsync 是可重复同步——备份与部署都该选 rsync。注意尾斜杠语义：`src/`（内容）与 `src`（目录本身）不同——rsync 的头号困惑点。

## 4. 诊断工具箱：从链路到端口

```bash
ping 8.8.8.8                  # 连通性与延迟（ICMP）；不通 ≠ 服务挂（可能禁 ICMP）
ip addr                       # 本机网卡与 IP（替代过时的 ifconfig）
ip route                      # 路由表（默认网关在哪行）

ss -tlnp                      # ★ 监听端口全景：tcp/listen/numeric/pid
# State  Local Address:Port   Process
# LISTEN 0.0.0.0:22           sshd
# 场景：「服务起来了但连不上」→ 先看它到底监听了 0.0.0.0 还是 127.0.0.1！

dig example.com               # DNS 解析全过程（+short 简洁版）；nslookup 的现代替代
traceroute example.com        # 逐跳路径；mtr 交互式（ping+traceroute 合体）

curl -I https://example.com           # HEAD：看状态码与响应头
curl -v https://api.example.com       # 全过程（TLS 握手、请求响应头都可见）
curl -X POST -H "Content-Type: application/json" -d '{"k":1}' http://localhost:8000/api
curl -o file.tar.gz https://host/file.tar.gz    # 下载（-O 按远端名）
```

「服务连不上」的三层排查就是这三个命令的顺序：**ss 看监听了吗 → ip/防火墙看路径通吗 → curl 看应用响应吗**。curl 的 `-v` 是 HTTP 调试的显微镜（TLS 证书错误、重定向链、慢在哪一步都现形）。

## 5. 防火墙一瞥

```bash
ufw status                    # Ubuntu 简洁前端
ufw allow 22/tcp && ufw allow from 10.0.0.0/8 to any port 5432   # 只对内网开放 DB
ufw enable

firewall-cmd --list-all       # RHEL 系 firewalld
```

防火墙排查的位置感：应用监听（ss）→ 本机防火墙（ufw/firewalld）→ 云安全组（平台控制台）——**三层各挡一道**，「端口明明开了还连不上」通常是三层里漏了一层（云安全组最常被忘）。

## 6. host key 与 known_hosts：安全机制还是烦人警告

首次连接时 SSH 记录服务器的**主机公钥指纹**到 `~/.ssh/known_hosts`，之后每次连接比对。出现警告：

```text
WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!
```

两种含义：**服务器重装/换 IP**（正常，`ssh-keygen -R <host>` 删掉旧记录重连）或**中间人攻击**（异常）。纪律是：**先核实指纹再删记录**，绝不条件反射地删——这个警告是 SSH 少数「烦人但救命」的机制。

## 7. 陷阱清单

- 私钥权限 644：SSH 拒绝使用；`chmod 600 ~/.ssh/id_*`。
- 公钥配好仍要密码：服务器端权限链（家目录/.ssh/authorized_keys）不达标，sshd 静默降级；`ssh -v` 看细节。
- 服务监听 127.0.0.1 以为对外开放：`ss -tlnp` 验证绑定地址。
- 「端口开了连不上」只查一层：应用 → 本机防火墙 → 云安全组三层全过。
- rsync 尾斜杠语义混淆：`src/` 传内容、`src` 传目录本身。
- known_hosts 警告无脑删：先核实变更原因（重装 vs 中间人）。
- 密码登录长期不关：免密验证后 `PasswordAuthentication no`（sshd_config）加固。

## 8. 小结

- SSH 公钥认证 = 公钥上服务器、私钥留本机：ssh-copy-id 一键、权限链达标、agent 管 passphrase；`~/.ssh/config` 是别名/跳板/保活的统一配置。
- 端口转发三形态：-L 拉内网到本地、-R 推本地给远程、-D 动态代理——内网访问的安全解法。
- rsync 的增量语义（-a、--delete、--link-dest 快照去重）使它成为同步/备份/部署的默认工具；尾斜杠要刻准。
- 诊断链：ss（监听）→ ip/ufw（路径）→ curl（应用）+ dig/traceroute（DNS/链路）——「连不上」按层定位。
- 防火墙三层（应用监听/本机规则/云安全组）各挡一道，排查要全过。
- known_hosts 警告是安全机制：核实指纹再处理。

## 9. 练习

**1.** 完整配置一次免密登录（虚拟机/WSL 即可）：生成 ed25519 密钥、ssh-copy-id、验证免密、故意把服务器端 authorized_keys 权限改成 666 观察降级、用 `ssh -v` 找到拒绝原因。

> [!TIP]
> 思路`ssh -v` 输出里找 "Permission denied (publickey)" 前的认证细节——sshd 的严格权限检查在 debug 日志里可见。「配了不用」类 SSH 问题 80% 是权限链，20% 是 SELinux/AppArmor。

**2.** 用 ~/.ssh/config 给三台机器配别名（不同端口/用户/密钥），其中一台经另一台 ProxyJump 跳转；验证 `ssh db-01` 直达内网。

> [!TIP]
> 思路ProxyJump 取代了老的 ProxyCommand/Agent Forwarding 组合，一行完成跳板且私钥不出本机（在跳板上不落私钥——安全设计的关键进步）。

**3.** 建立 -L 隧道访问「内网数据库」：在服务器上起一个 HTTP 服务（python -m http.server），从本地 `ssh -L 9000:localhost:8000 server` 后用 `curl localhost:9000` 验证；再加 -N -f 后台化。

> [!TIP]
> 思路隧道验证的三步：ss 看本地 9000 在听（sshd 开的）、curl 通、服务器日志里确认流量来源是 sshd。理解「隧道里每一跳的身份」后，端口转发不再是魔法。

**4.** 用 rsync 完成一次「周备份」：--link-dest 链到上周快照，对比两次备份的磁盘占用（du）与文件 inode（ls -li）——验证硬链接去重，再改一个文件重跑观察增量。

> [!TIP]
> 思路`du -sh /backup/*` 各天近似「全量」但 `du -sh` 汇总重复 inode 只算一次？不——du 默认对硬链接文件只在第一次出现时计数。观察 df 的真实增量与 ls -li 的 inode 复用。「快照式备份」的全部秘密就是硬链接。

**5.** 制造一次「服务连不上」并三层排查：起一个只绑 127.0.0.1 的服务、加防火墙规则挡端口、最后用 ss → 防火墙 → curl 的顺序逐层定位。

> [!TIP]
> 思路`python3 -m http.server 8000 --bind 127.0.0.1` 从外机 curl 必不通——ss 一眼看出绑定地址。三层各自的现象（ss 无监听 / 防火墙 REJECT 超时 / curl 拒绝连接）是「连接失败」的鉴别诊断表。

**6.** 讨论：为什么说「rsync --delete + 定时任务」可以替代大部分商业备份方案？它的三个盲区（误删同步、单点存储、无版本历史）分别怎么补？

> [!TIP]
> 思路--delete 镜像语义下源端误删 = 备份端同步删除（ransomware 级风险）——补救：--backup --backup-dir 保留被删文件、快照链（link-dest）天然多版本、备份盘只读挂载或异地。「备份」的定义是「可恢复的历史」而非「当前副本」。
