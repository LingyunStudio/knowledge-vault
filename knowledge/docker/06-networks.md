---
title: 容器网络
order: 6
tags: 核心, 网络, 端口
summary: 端口映射、bridge 网络与容器互联、容器名即域名、暴露的学问。
---

默认情况下，容器能访问外网，外网却够不着容器——网络是单向的。把服务跑起来的最后两步：把端口"发布"出去让外部访问，把容器"组网"起来让彼此互通。这一篇讲清端口映射、几种网络模式，以及为什么自定义网络里容器名可以直接当域名用。

## 端口映射

容器有自己的网络栈，里面的 80 端口宿主机并不知道。`-p` 把宿主机端口转发到容器端口：

```bash
docker run -d -p 8080:80 nginx            # 宿主机 8080 → 容器 80
docker run -d -p 127.0.0.1:8080:80 nginx  # 只绑宿主机回环地址，外部机器访问不到
docker run -d -p 8080:80/udp some/udp-app # UDP 端口要显式声明协议
docker run -d -P nginx                    # 大写 P：把镜像 EXPOSE 的端口全映射到宿主机随机端口
docker port web                           # 查看容器当前的端口映射关系
```

规则是 `宿主机IP:宿主机端口:容器端口`，左宿右容。几个高频坑：

- 宿主机端口被占用会直接启动失败（"port is already allocated"），先 `docker port` 或 `ss -ltnp` 查占用
- `-p` 映射的是端口，容器内应用还得真的监听那个端口；监听 127.0.0.1 而不是 0.0.0.0 的应用，映射了也连不进
- `127.0.0.1:` 前缀是最容易被忽略的安全项——数据库容器不加它，等于对局域网/公网开放
- 映射关系是容器创建时定下的，想换宿主机端口只能删容器重建，没有"热改端口"
- `-p` 映射进来的流量，源 IP 是 Docker 网关而非真实客户端——依赖真实 IP 做日志、限流的服务要留意

```bash
# ❌ 公网服务器上这样跑数据库等于裸奔
docker run -d -p 5432:5432 postgres

# ✅ 只绑回环，本机调试工具能连，外面进不来
docker run -d -p 127.0.0.1:5432:5432 postgres
```

> [!WARNING]
> Docker 发布端口走的是自己的 iptables 规则，会**绕过 ufw/firewalld**——防火墙没放行 8080，容器照样能被外部访问。服务器上要么用 `127.0.0.1:` 前缀，要么在 Docker 层面控制暴露面，别指望系统防火墙兜底。

## 出去容易，进来难

容器主动访问外网不需要任何配置：出站流量由宿主机做源地址伪装（MASQUERADE）后发出去。难的是反方向——容器的 IP 是宿主机私有网段（默认 172.17.0.0/16）里的地址，外部根本路由不到，所以才有端口映射这回事。同一 bridge 网络内的容器互访走网桥直连、不经 NAT，也因此默认彼此可达——同网络内没有访问隔离，跨网络才需要显式 connect。

## 四种网络模式

| 模式 | 说明 | 适用 |
| --- | --- | --- |
| bridge（默认） | 接入 docker0 网桥，独立网络栈 | 绝大多数场景 |
| host | 直接共享宿主机网络栈，-p 失效 | 网络性能极致要求；仅 Linux |
| none | 只有回环，没有网络 | 离线批处理、自定义组网 |
| container:xxx | 与另一个容器共享网络栈 | sidecar 模式（如代理伴生容器） |

```bash
docker network ls                  # 内置 bridge / host / none 三个网络
docker network inspect bridge      # 网段、网关、接在上面的容器及各自 IP
```

host 模式下 `-p` 无效、端口直接用宿主机的；container 模式的典型用法是 sidecar——代理容器与应用容器共享网络栈，直接监听对方的 localhost。日常主力还是 bridge。

bridge 模式下容器互联有一个关键分界——**默认 bridge 和自定义 bridge 不是一回事**，这是 Docker 网络里最容易踩的认知坑。

## 自定义 bridge：容器名即域名

默认 bridge 里容器之间只能靠 IP 互访，**没有内置 DNS**——容器重启 IP 会变，靠 IP 互联的配置说崩就崩。自定义网络给两个决定性能力：

- **容器名即域名**：内置 DNS 自动把容器名解析成 IP，配置里写服务名就行
- **运行时插拔**：`docker network connect/disconnect` 能给跑着的容器挂上/摘下网络
- **别名轮询**：`--network-alias web` 让多个实例共用一个名字，DNS 自动轮询——最朴素的负载均衡

```bash
docker network create appnet    # 创建自定义 bridge 网络

docker run -d --name db --network appnet -e POSTGRES_PASSWORD=secret postgres:16
docker run -d --name web --network appnet -p 8080:80 myapp
# web 容器里连数据库，主机名直接写 db：
# postgresql://postgres:secret@db:5432/app

docker network connect appnet 已有容器    # 给运行中的容器临时接入
docker network disconnect appnet web     # 摘下来
docker network inspect appnet            # 确认谁在这个网络里
docker network rm appnet                 # 删除网络（有容器接入时删不掉）
docker network prune                     # 清理所有未使用的网络，安全
```

> [!NOTE]
> 容器名解析由 Docker 内置 DNS（容器内 127.0.0.11）提供，同一自定义网络内按容器名或别名解析。Compose 里"服务名即主机名"正是这套机制的默认化——Compose 自动建了自定义网络（见 [Docker Compose](07-compose.md)）。默认 bridge 想按名字互联？老方案 `--link` 已废弃，正确答案就是换自定义网络。

## EXPOSE 与"暴露"的学问

镜像里的 `EXPOSE 80` 经常被误解为"开放端口"。它不做任何映射，只是元数据，作用有二：给人看（这个镜像打算监听 80）；给 `docker run -P` 用（随机映射时以 EXPOSE 为准）。EXPOSE 的价值在文档与审计层面：镜像元数据里的 ExposedPorts 声明了镜像意图，扫描和 CI 检查会参考它。真正把服务暴露出去只有三条路：

```bash
docker run -p 8080:80 ...       # 1. 发布端口：容器外的世界访问它
docker network connect ...      # 2. 接入共享网络：容器间互访，不对外
docker run --network host ...   # 3. 共享宿主机网络栈，端口天然互通（仅 Linux）
```

三条路面向不同受众：`-p` 给容器外的人用，`connect` 给容器彼此用，host 模式用隔离换性能。拿不准就先不暴露，需要时再加——收窄暴露面永远比事后补救容易。

安全基线由此清晰：**数据库、缓存等内部服务不发布端口**，只放在自定义网络里让应用容器按名字访问；需要本机调试工具访问的，用 `127.0.0.1:` 前缀。一个服务要不要 `-p`，判断标准只有一条——这个端口是否需要被"容器之外"的东西访问。

## 排查手段

```bash
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' web  # 容器 IP
docker exec web ping -c 2 db          # 容器里测连通性（alpine 要先 apk add iputils）
docker exec web wget -qO- http://db:8000/health 2>&1 | head   # 没有全套工具时用 wget 试探
docker network inspect appnet \
  --format '{{range .Containers}}{{.Name}} {{end}}'            # 网络里有哪些容器
```

> [!TIP]
> 排查容器网络问题的瑞士军刀是 `nicolaka/netshoot` 镜像：`docker run -it --rm --network appnet nicolaka/netshoot`，tcpdump、dig、traceroute 全套自带，还能直接解析服务名验证 DNS 是否生效。

排查顺序有讲究：先 `docker network inspect` 确认两个容器真的在同一个网络，再测名字解析（能不能 ping 通对方名字），最后才查应用配置。一半的"连不上数据库"都卡在第一步——忘了 `--network`，或者写错了网络名。

工具层面还能从宿主机直接抓容器流量：`nsenter -t $(docker inspect -f '{{.State.Pid}}' web) -n tcpdump -i any port 80`，与进容器抓包等效，适合目标容器里没有任何排查工具的情况。

相关阅读：[Docker Compose](07-compose.md)、[数据卷与持久化](05-volumes.md)
