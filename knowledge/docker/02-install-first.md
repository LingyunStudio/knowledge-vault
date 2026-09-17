---
title: 安装与第一个容器
order: 2
tags: 工具链, run, 生命周期
summary: 安装与镜像加速、hello-world、run 的交互与后台模式、容器生命周期。
---

安装本身没什么知识点，值得说的是每个平台该选什么、装完怎么验证。这一篇把 `run` 命令的常用形态过一遍——它是 Docker 使用频率最高的命令——弄清交互与后台两种模式的区别，再串一遍容器从生到死的完整生命周期，后面所有篇章都建立在这之上。

## 安装

| 平台 | 方案 | 说明 |
| --- | --- | --- |
| Windows / macOS | Docker Desktop | 自带 Linux 虚拟机与图形界面，个人免费，达到一定规模的企业需付费授权 |
| Linux 服务器 | Docker Engine（docker-ce） | 原生运行，无虚拟机开销，生产首选 |
| 只想练手 | Play with Docker 等在线环境 | 浏览器里开临时 Docker 环境 |

Linux 安装后把当前用户加进 docker 组，免得每条命令都 sudo：

```bash
# Debian/Ubuntu：先配官方 apt 源再装，别用发行版自带的老版本
sudo apt-get install docker-ce docker-ce-cli containerd.io
sudo usermod -aG docker $USER    # 加入 docker 组，重新登录后生效
docker version                   # 能同时打印 Client 和 Server 版本即安装成功
```

> [!WARNING]
> docker 组等价于 root 权限——组内用户可以把宿主机任意目录挂进容器任意读写。个人开发机无所谓，多用户共用的机器上别随手把人拉进 docker 组。

国内网络环境拉镜像经常超时，配置镜像加速器（daemon 的拉取代理）：

```json
// /etc/docker/daemon.json（Docker Desktop 在设置界面的 Docker Engine 配置里改）
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.1ms.run"
  ]
}
```

```bash
sudo systemctl daemon-reload && sudo systemctl restart docker   # 改完必须重启 daemon
docker info | grep -A 3 -i mirrors   # 确认加速器已加载
```

镜像加速器地址时效性强，失效了就换一个；公司内网通常有自己的 Harbor（见 [镜像仓库](08-registry.md)），直接配它当加速地址。

## hello-world 背后发生了什么

```bash
docker run hello-world
```

一条命令，Docker 在背后做了四件事：本地找不到 `hello-world:latest` 镜像 → 连接 Docker Hub 分层拉取 → 用镜像创建容器 → 运行容器里唯一的程序，打印说明后退出。这段输出本身就在讲架构：client 发请求给 daemon，daemon 从 registry 拉镜像并运行，三层各司其职。

> [!TIP]
> `docker run` ≈ `docker create` + `docker start`。镜像不存在时自动 pull，存在就直接用——这个"自动拉取"在生产环境是版本漂移的来源，要锁版本就显式写 tag，别裸用 latest（见[镜像与分层](03-images.md)）。

## run 的两种模式

前台交互模式，适合调试和一次性任务：

```bash
docker run -it ubuntu bash      # -i 保持标准输入打开，-t 分配伪终端，进来就是一个 shell
docker run --rm alpine echo hi  # --rm：退出后自动删容器，跑完即走不留垃圾
docker run -it --name box alpine sh
exit                            # 退出即停止容器——PID 1 结束，容器生命周期结束
```

后台模式，才是长期服务的常态：

```bash
docker run -d --name web -p 8080:80 nginx       # -d 后台运行，宿主机 8080 映射容器 80
docker run -d --name db -e POSTGRES_PASSWORD=secret postgres  # -e 注入环境变量
docker logs -f web              # 跟踪后台容器的输出（代替前台的屏幕显示）
docker exec -it web bash        # 进入运行中的容器开个 shell，不影响主进程
```

两种模式的容器没有区别，区别只在你的终端是否挂着容器的 stdin/stdout。容器本身的生命周期由 PID 1 进程决定：它退，容器就退。

## 常用 run 选项速查

| 选项 | 作用 |
| --- | --- |
| `-d` | 后台运行（detached） |
| `-it` | 交互 + 伪终端，配 shell 使用 |
| `--name` | 指定容器名，省得记随机名（如 nostalgic_turing） |
| `--rm` | 容器退出后自动删除 |
| `-p 宿主:容器` | 端口映射（详见[容器网络](06-networks.md)） |
| `-e KEY=value` | 注入环境变量 |
| `-v a:b` | 挂载卷（详见[数据卷与持久化](05-volumes.md)） |
| `--restart` | 重启策略，见下节 |
| `--network` | 接入指定网络 |

## 容器生命周期

容器状态机不复杂，一条命令一个状态：

| 状态 | 含义 | 进入方式 |
| --- | --- | --- |
| Created | 已创建未运行 | `docker create` |
| Running | 主进程运行中 | `docker start` / `docker run` |
| Paused | 进程被冻结 | `docker pause`（cgroup freezer 实现） |
| Exited | 主进程已退出 | `docker stop` / 主进程自己退出 |
| Removed | 对象已删除 | `docker rm` |

```bash
docker pause web && docker unpause web   # 冻结/恢复，进程现场原样保留
docker stop web                # 发 SIGTERM，默认等 10 秒再 SIGKILL，给应用优雅退出的机会
docker stop -t 30 web          # 数据库这类收尾慢的，放宽宽限期
docker kill web                # 直接 SIGKILL，跳过优雅退出
docker start web               # 重新启动已停止的容器（可写层和配置都还在）
docker restart web             # stop + start 的组合
docker rm web                  # 删除容器（须处于停止状态）
docker rm -f web               # ❌ 强制删除运行中的容器 = 先 kill 再 rm
```

`ps` 看状态，`-a` 把已退出的也翻出来：

```bash
docker ps                      # 运行中的容器
docker ps -a                   # 全部容器，包括 Exited (137) 这种异常退出记录
docker ps -a --filter "status=exited"    # 只看挂掉的
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"   # 自定义列
```

> [!NOTE]
> 退出码有信息量：`Exited (0)` 正常退出；`Exited (137)` = 128+9，被 SIGKILL，最常见原因是内存超限被 OOM 杀掉；`Exited (143)` = 128+15，收到 SIGTERM。排查"容器莫名其妙挂了"先看退出码（详见[调试与运维](10-debug-ops.md)）。

## 重启策略

长期服务不该靠人肉拉起，run 时声明重启策略：

```bash
docker run -d --restart=unless-stopped --name web nginx
```

| 策略 | 行为 |
| --- | --- |
| no | 默认，挂了不管 |
| on-failure[:n] | 非零退出才重启，最多 n 次 |
| always | 总是重启，daemon 重启后也拉起 |
| unless-stopped | 同 always，但手工 stop 过的不拉起 |

单机的重启策略只管"进程死了拉起来"，不管健康与否——进程活着但服务不可用它无能为力，那要靠健康检查（见 [Docker Compose](07-compose.md)）。

相关阅读：[镜像与分层](03-images.md)
