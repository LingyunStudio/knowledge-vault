---
title: 排障工具箱：定位网络问题的套路
order: 8
tags: 排障, tcpdump, curl
summary: 分层定位法、ping/traceroute/tcpdump/curl 的实战用法、经典故障模式对照表——网络排障的肌肉记忆。
---

网络问题排障的核心不是工具多，是**分层定位的套路**：先确定问题在哪一层，再进那一层找细节。本篇把前面七篇的知识收拢成一份肌肉记忆。

## 通用定位流程

```text
① 确定边界：本机问题 or 远端问题？（换一台设备试、只这一个域名还是全挂）
② 自下而上：
   ping 网关        → 链路层/内网 OK？
   ping 8.8.8.8     → 出口路由 OK？
   ping 域名        → DNS OK？（IP 通域名不通 = DNS 问题）
   telnet host 443  → TCP 端口通？（连接被拒/超时含义不同）
   curl -v https:// → 应用层看完整交互
③ 抓包看真相：tcpdump / Wireshark，看包到底发没发、谁先断的
```

**超时 vs 拒绝**是第一判据：超时（包石沉大海）→ 路由/防火墙静默丢弃；拒绝（立即 RST）→ 机器活着但端口没服务。含义完全不同，方向完全不同。

## 工具箱与看什么

```bash
ping 8.8.8.8                 # 连通性 + 延迟 + 丢包率（链路/网络层）
traceroute 目标              # 逐跳路径，哪一跳开始 * 号（丢包段定位）
dig 域名 +trace              # DNS 解析全链路（第 06 篇）
ip addr / ip route           # 本机 IP、掩码、默认网关配置
ss -tlnp                     # 本机监听端口——"端口没起服务"的直查法
curl -v https://host         # 应用层全交互：DNS→TCP→TLS→HTTP 逐阶段耗时
curl -w 'dns:%{time_namelookup} tcp:%{time_connect} tls:%{time_appconnect} total:%{time_total}\n' -o /dev/null https://host
                             # 把延迟拆到各阶段——定位慢在哪一层
tcpdump -i eth0 host 10.0.0.5 and port 443 -w a.pcap   # 抓包
```

`curl -w` 的分段耗时是最被低估的排障技巧：**namelookup 慢 = DNS 问题；connect 慢 = 网络路由/丢包；appconnect 慢 = TLS 握手/证书链不完整；之后慢 = 服务端问题**。

## 经典故障模式对照表

| 症状 | 高概率原因 | 验证 |
| --- | --- | --- |
| 连接超时 | 防火墙丢包 / 目标挂了 / 路由黑洞 | telnet、对端监控、traceroute |
| Connection refused | 端口没监听 / 进程挂了 | `ss -tlnp` 看监听 |
| 能 ping 通但业务不通 | 端口被防火墙拦 / 服务异常 | telnet 端口、curl |
| 域名解析失败/时好时坏 | DNS 故障 / 缓存不一致 / TTL 旧值 | dig 对比多个解析器 |
| 首包慢、后续快 | DNS 慢（看 namelookup）或 TLS 证书链不全 | curl -w 分段 |
| 间歇性卡顿 | 丢包重传 / 带宽打满 / 拥塞 | 重传计数、网卡流量监控 |
| 大文件慢小文件快 | 窗口受限（高 RTT 长肥管道）/ 丢包 | 看吞吐 vs RTT 带宽积 |
| 只有个别用户出问题 | 运营商线路 / 地区网络 / NAT 老化 | 收集用户 traceroute |

## tcpdump 实战三招

抓包是最终真相，三个高频场景：

```bash
# ① 看握手是否完成：没有 SYN/ACK → 对方没回；有 SYN 无数据 → 中间被拦
tcpdump -i any 'tcp[tcpflags] & (tcp-syn|tcp-ack) != 0 and host 10.0.0.5'

# ② 看 RST 是谁发的：立即 RST = 拒绝（端口/防火墙 REJECT），多次重传无响应 = 丢包
tcpdump -i any 'tcp[tcpflags] & tcp-rst != 0'

# ③ Wireshark 里直接读：Expert Information 面板的 retransmission / dup ack 计数
#    大量 retransmission → 丢包或对端过载；零窗口 → 接收方应用读得慢（第 03 篇 rwnd）
```

> [!TIP]
> 排障纪律三句话：**一次只改一个变量**（改三个配置后"好了"= 你不知道哪个是解药）；**先看自己再怪别人**（本机监听/防火墙/DNS 缓存排完才找运维）；**留下证据**（抓包文件、分段耗时、时间线截图）——网络问题的复现窗口转瞬即逝，证据比记忆可靠。
