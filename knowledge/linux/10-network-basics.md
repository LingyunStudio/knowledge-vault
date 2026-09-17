---
title: 网络工具速查
order: 10
tags: 进阶, 网络, 排查
summary: ip/curl/ping/dig/ss 的排查链路、端口占用、防火墙常识。
---

"服务不通"是服务器日常故障的一半。排查不靠猜，靠一条固定链路：**本机配置 → 连通性 → DNS → 端口 → 防火墙**，每层一个工具，逐层缩小范围。

## ip：本机配置一眼看清

```bash
ip addr                       # 网卡与 IP（替代老的 ifconfig）
ip -brief addr                # 精简版：只看网卡名、状态、地址
ip route                      # 路由表：默认网关看 default via 那一行
ip link                       # 链路层状态（网卡 UP/DOWN）
hostname -I                   # 本机所有 IP，一行搞定
ss -s                         # 连接总览：各状态 socket 的计数
```

用 `ip` 命令改的是运行时状态，重启会丢。持久化的网络配置在：Ubuntu 服务器是 `/etc/netplan/*.yaml`（改完 `sudo netplan apply`）；RHEL 系与桌面版是 NetworkManager（`nmcli device status`、`nmcli con show`）。

拿到信息先确认三层事实：本机有没有拿到地址、走哪个网关出去、网卡是不是 UP。`127.0.0.1` 是回环地址，`192.168.x`、`10.x`、`172.16-31.x` 是内网段——看一眼 IP 就知道自己在哪个网络里。

## 排查链路：从 ping 到 curl

```bash
ping -c 4 8.8.8.8             # 测三层连通性（ICMP），只发 4 个包
traceroute 8.8.8.8            # 看路径上每一跳，卡在哪一段一目了然
mtr 8.8.8.8                   # ping + traceroute 合体，实时刷新（更有用）
```

> [!NOTE]
> ping 不通 ≠ 服务挂了。很多服务器禁 ICMP 响应，ping 静默失败但 HTTP 正常；反过来 ping 通只证明 IP 层可达，不代表 80 端口开着。ping 只是链路的起点，不是结论。

```bash
dig example.com               # 查 DNS 解析全过程
dig +short example.com        # 只要答案
dig +trace example.com        # 从根服务器开始完整追踪解析链路
dig @223.5.5.5 example.com    # 指定用哪台 DNS 服务器问——对比结果定位 DNS 故障
dig +short example.com MX     # 查其他记录类型：A/AAAA（IPv6）、CNAME、MX（邮件）、TXT、NS
dig -x 8.8.8.8                # 反向解析
```

DNS 是隐形杀手：域名解析到旧 IP、本机 DNS 配置坏了、`/etc/hosts` 里有残留条目（它的优先级高于 DNS）——`dig` 一跑便知。系统用哪些 DNS 服务器看 `/etc/resolv.conf`。解析出的 IP 正确还是连不上？那是端口和防火墙的事。

```bash
curl -I https://example.com   # 只看响应头：状态码、服务器、跳转
curl -v https://example.com   # 全过程：TLS 握手、请求响应头都打出来
curl -L http://example.com    # 跟随 301/302 跳转
curl -o page.html https://example.com    # 存成文件
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" --connect-timeout 3 https://example.com
                              # 只要状态码和耗时——巡检脚本的标准姿势（加超时防卡死）
curl -x http://proxy.corp:8080 https://example.com   # 走指定代理访问
getent hosts example.com      # 走系统解析链（含 /etc/hosts），比 dig 更贴近应用视角
```

curl 卡在哪一步，问题就在哪一层：TCP 连不上是网络/防火墙，TLS 报错是证书，拿到 5xx 是服务端自己的问题。

## 端口占用：ss

"Address already in use" 的标准排查：

```bash
ss -tlnp                      # tcp、监听中、数字端口、带进程名——查端口占用的主命令
ss -tlnp | grep 8080          # 谁占着 8080
ss -tnp                       # 所有 TCP 连接（不限于监听）
lsof -i :8080                 # 同样能查，写法更直观
nc -zv 10.0.0.5 22            # 从外部探测远端某端口通不通（-z 只扫不发数据）
nc -l 9999                    # 反向验证：本机监听 9999，从另一台机器连过来测防火墙
```

常用的知名端口，看到数字要能对上服务：

| 端口 | 服务 |
| --- | --- |
| 22 | SSH |
| 80 / 443 | HTTP / HTTPS |
| 3306 / 5432 | MySQL / PostgreSQL |
| 6379 | Redis |
| 8080 / 8000 | 常见的应用与开发服务器 |

输出里 `0.0.0.0:8080` 表示对所有网卡监听（外部可连），`127.0.0.1:8080` 表示只服务本机。服务"明明在跑外部却连不上"，十有八九是只绑了 127.0.0.1——改应用的监听地址，不是防火墙的锅。`nc -zv` 是从**外部**验证端口的最快方式，和服务器内部的 `ss` 一里一外配合使用。

最后的大杀器是 tcpdump——直接看网线上跑的是什么包：

```bash
sudo tcpdump -i any port 80 -nn                  # 抓所有 80 端口的包，不解析主机名/端口名
sudo tcpdump -i any icmp                         # 只看 ICMP——ping 包到底有没有到达，一抓便知
sudo tcpdump -i eth0 host 10.0.0.5 -w cap.pcap   # 只抓某主机的流量并存文件（Wireshark 可读）
```

`ss` 看的是连接表，tcpdump 看的是原始流量：ping 得通但应用不通、疑似超时重传、想确认包到底有没有发出去——上 tcpdump，答案就在包里。

## 防火墙与安全组

Linux 本机防火墙只是其中一层。排查"外部连不上"时从内到外检查三层：**进程监听地址 → 本机防火墙 → 云平台安全组**。

```bash
# Ubuntu 的 ufw（iptables 的人性化外壳）
sudo ufw status               # 看规则
sudo ufw allow 22/tcp         # 放行 SSH——enable 之前先放行
sudo ufw allow 80,443/tcp
sudo ufw enable               # 启用

# RHEL 系的 firewalld
sudo firewall-cmd --list-all                        # 当前 zone 的规则
sudo firewall-cmd --permanent --add-port=8080/tcp   # 永久放行
sudo firewall-cmd --reload                          # permanent 改完必须 reload 才生效
```

ufw 和 firewalld 底层都是内核的 netfilter，老机器上可能直接面对 `iptables -L -n` 或它的继任者 `nft list ruleset`——日常不必手写，但看到这两个命令要知道它们在管同一件事。

> [!WARNING]
> ❌ 没放行 22 端口就 `ufw enable`，会把自己锁在服务器外面——云厂商只能走 VNC 救援。规则：先 `allow` SSH，再 enable 防火墙。

> [!TIP]
> "本机 curl 通、外部不通"的固定排查顺序：`ss -tlnp` 看监听地址 → `ufw status` / `firewall-cmd --list-all` 看本机防火墙 → 云控制台看安全组。三层各查一遍，五分钟定位。

相关阅读：[SSH 与远程操作](09-ssh-remote.md)
