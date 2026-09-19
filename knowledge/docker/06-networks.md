---
title: 容器网络：桥接、端口与 DNS
order: 6
tags: bridge, 端口映射, 容器DNS, 网络
summary: 四种网络驱动的分工（bridge/host/none/macvlan）、-p 端口映射的完整语义与冲突排查、自定义 bridge 的容器名 DNS 解析（默认 bridge 没有的关键能力）、以及容器间通信与网络排障的标准姿势。
---

每个容器自带独立的网络栈（net namespace：自己的网卡、IP、端口表）——「容器如何联网、容器之间如何互访、外部如何进来」由 Docker 的**网络驱动**决定。本篇的核心结论提前放：**容器之间互访要用自定义 bridge（有 DNS），外部访问用 -p 端口映射**。

## 1. 四种网络驱动

| 驱动       | 语义                                     | 适用                          |
| ---------- | ---------------------------------------- | ----------------------------- |
| `bridge`   | 桥接到宿主的 docker0 网桥（NAT 出网）      | 默认；单机容器网络              |
| `host`     | 与宿主共享网络栈（无隔离，性能最好）        | 高性能场景；端口直接占用宿主     |
| `none`     | 只有 lo（完全断网）                        | 安全沙箱、离线任务              |
| `macvlan`  | 容器获得局域网独立 MAC/IP                  | 需要容器像物理机一样出现在局域网  |

```bash
docker network ls              # 内置 bridge/host/none + 你创建的
docker network inspect bridge  # 网桥的子网、网关、挂着的容器清单
```

默认 bridge 的行为：容器拿到 172.17.x.x 的 IP，出网走 NAT（宿主 IP），互相之间**只能按 IP 访问**（没有 DNS）——这是它最大的坑（下节）。

## 2. -p 端口映射：外部进来的唯一正门

```bash
docker run -d -p 8080:80 nginx           # 宿主 8080 → 容器 80
docker run -d -p 127.0.0.1:8080:80 nginx # ★ 只绑本机回环（内网服务不暴露公网！）
docker run -d -p 8080:80/udp app         # UDP 协议
docker run -d -P nginx                   # 随机高端口映射（docker port 查映射结果）
docker run --network host nginx          # host 模式：容器直接用宿主端口（无映射）
```

机制：-p 是宿主的 **iptables/NAT 规则**（进站流量 DNAT 到容器 IP:端口）——「容器端口映射后宿主多了一条防火墙规则」，这也是「-p 会绕过 ufw」的安全冷知识（ufw 挡不住 docker 的 NAT 链，公网服务器要显式绑 127.0.0.1 或用 firewalld/直接 deny）。

端口冲突的经典报错与排查：

```bash
docker: Error response from daemon: driver failed programming external connectivity:
bind: address already in use
ss -tlnp | grep 8080          # 谁占了宿主端口（[linux 篇](../linux/08-network-remote.md)）
docker port web               # 容器的映射表
```

## 3. 容器互访：自定义 bridge 与 DNS

```bash
# ❌ 默认 bridge：只有 IP，无 DNS —— 重启 IP 变，脚本全断
docker run -d --name db postgres:16
docker run -d --name app myapp
docker exec app ping db            # 解析失败（默认 bridge）

# ✅ 自定义 bridge：内置 DNS，按容器名互访
docker network create mynet
docker run -d --name db --network mynet postgres:16
docker run -d --name app --network mynet myapp
docker exec app ping db            # ✅ 直接解析 "db" —— 容器名即主机名
```

这是 Docker 网络最重要的一条规则：**自定义网络 = 内置 DNS 服务器**（容器名、网络别名可解析）。应用的数据库连接串从此写 `postgres://db:5432`——**容器名就是服务发现**（compose 的服务互访正是基于此，[第 7 篇](07-compose.md)）。

网络隔离也是安全面：**不同自定义网络之间默认不通**——数据库放 backend 网络、只有后端容器接入；前端容器加入 frontend 网络——网络边界即最小权限（[linux 篇](../linux/04-permissions.md)思想的容器版）。

```bash
docker network connect mynet existing-container    # 运行中的容器追加网络（可多网络并存）
```

## 4. 容器与外网的出入方向

```text
出方向：容器 → NAT（伪装成宿主 IP）→ 互联网        （默认畅通）
入方向：互联网 → 宿主端口(-p/NAT) → 容器           （必须 -p）
容器↔容器：同一 bridge 网络直连（DNS 名字）；跨网络默认不通
容器→宿主服务：用 host.docker.internal（Desktop 版）/ 网桥网关 IP
```

「容器访问宿主上的数据库」是常见需求：Desktop 环境 `host.docker.internal` 一行解决；Linux 上加 `--add-host=host.docker.internal:host-gateway`（或直接用 docker0 网关 172.17.0.1）。方向感混乱时的排查表：**先分清「谁访问谁」再选工具**。

## 5. 网络排障：进容器做诊断

```bash
docker exec -it app sh
  ping db                 # DNS 与连通性（镜像需有 ping 工具，精简镜像可能没有）
  nslookup db             # DNS 解析细节
  curl -v telnet://db:5432   # 端口通不通
  ip addr; cat /etc/resolv.conf   # 容器视角的网卡与 DNS 配置

# 宿主侧：
docker network inspect mynet    # 该网络下的容器 IP 清单
docker logs <容器>              # 应用层报错（连不上数据库的第一手信息）
```

排障顺序（与 [linux 篇](../linux/08-network-remote.md)一致）：**DNS 解析了吗（nslookup）→ 端口通吗（curl/nc）→ 应用配置对吗（连接串/端口）**。精简镜像（alpine/distroless）缺调试工具——用 `docker run --network container:<id> nicolaka/netshoot` 借网络命名空间挂一个工具箱容器（共享目标容器的网络栈直接诊断）。

## 6. 陷阱清单

- 用默认 bridge 并按 IP 互连：重启 IP 漂移全断；自定义网络 + 容器名。
- 忘记 -p 以为服务可用：「容器内 curl 通、外面不通」的经典现场；映射方向与绑定地址核对。
- -p 直接暴露数据库到 0.0.0.0：公网裸奔；绑 127.0.0.1 或仅内网网络。
- 以为 -p 能被 ufw 拦住：Docker 直写 iptables 绕过 ufw；安全策略在 Docker 层做。
- host 网络当默认选择：放弃隔离、端口冲突原样出现；性能敏感才用。
- 精简镜像里没有诊断工具：netshoot 伴生容器借网络诊断。
- 「容器访问宿主服务」写 localhost：那是容器自己；用 host.docker.internal 或网关地址。

## 7. 小结

- 四驱动的分工：bridge 默认、host 共享栈、none 沙箱、macvlan 局域网直通——「共享内核但独立网络栈」是容器的网络模型。
- -p 是外部入口的唯一正门（iptables NAT）：绑定地址（127.0.0.1 防暴露）、协议、随机端口；它绕过 ufw 的安全冷知识要刻住。
- 自定义 bridge 的容器名 DNS 是容器互访与服务发现的基石：**应用配置里写容器名，不写 IP**；网络边界即安全边界。
- 出网默认通、入网必映射、容器访问宿主有专用地址——方向感清楚后排障按「DNS→端口→配置」三层走。
- netshoot 伴生容器是精简镜像时代的排障标配。

## 8. 练习

**1.** 复现「默认 bridge 无 DNS」：默认网络起两个容器互相 ping 名字（失败）、换自定义网络重试（成功）——把这条规则从文档变成实验结论。

> [!TIP]
> 思路alpine 镜像自带 ping/nslookup 适合做实验。失败信息（bad address）与成功（IP 返回）的对照就是 DNS 有无的直接证据。

**2.** 端口实验三部曲：-p 8080:80 外部访问、再起一个同映射的容器（冲突报错）、改为 127.0.0.1:8080:80 验证外部不可达但宿主可达——三层语义逐一落验。

> [!TIP]
> 思路绑定地址实验用 `curl 本机IP:8080`（换另一台机器/手机热点更真）与 `curl 127.0.0.1:8080` 对照。「内外有别」从实验里长出来。

**3.** 搭一个「两层网络」的安全拓扑：backend 网络（db + api）、frontend 网络（api + web），验证 web 直接 ping db 不通、api 两网皆通——体验「网络即最小权限」。

> [!TIP]
> 思路api 容器 `docker network connect` 追加第二网络。这是 compose 多网络配置（[第 7 篇](07-compose.md)）的手动版——先手动后编排，配置项的含义全懂。

**4.** 用 netshoot 诊断「容器连不上数据库」：先故意把连接串端口写错，依次 nslookup（DNS 对）、nc -zv db 5432（端口拒绝）、改正后连通——形成一份「网络排障三步」的记录。

> [!TIP]
> 思路`docker run --rm -it --network mynet nicolaka/netshoot` 与目标容器同网络。排障记录的模板：现象/假设/验证/修复——四个字段一组故障。

**5.** 验证「-p 绕过 ufw」：宿主开 ufw 默认拒绝、不放行 8080，run 一个 -p 8080:80 的容器——外部依然可达。分析原因并给出三条真正的防护措施。

> [!TIP]
> 思路原因：Docker 在 iptables 的 DOCKER 链直接插 NAT 规则，优先于 ufw 的 INPUT 链。防护：绑 127.0.0.1、Docker 层 firewall 配置（ufw-docker 方案）、或云安全组兜底。「工具叠加不等于安全叠加」——每层语义要懂。

**6.** 讨论：容器网络与服务发现的关系——为什么「容器名即 DNS」让 compose/K8s 的服务配置变得声明式？对照 [git 分支名](../git/03-branches.md)与 [DNS 的名字系统](../net/06-dns.md)，分析「名字解耦地址」在三个系统里的同构价值。

> [!TIP]
> 思路名字解耦地址 = 引用稳定、实现可变：容器重启换 IP 不改配置、分支重指不换工作流、DNS 换机不改域名。「间接层」是分布式系统的万能解药——三处同构不是巧合，是同一设计需求。
