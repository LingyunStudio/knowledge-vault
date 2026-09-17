---
title: 镜像仓库
order: 8
tags: 基础, registry, push
summary: Docker Hub 与私有仓库、登录与推送、镜像命名 tag 规范。
---

构建出的镜像只存在于构建机上，要让别的机器跑起来，就得经过仓库中转——push 上去、pull 下来。Git 托管代码，Registry 托管镜像，逻辑完全同构。这一篇讲清镜像全名的解析规则、推送全流程，以及内网自建仓库的最小方案。

## 名字解析规则

镜像全名的完整形态是 `[registry地址[:端口]/][命名空间/]仓库名[:tag]`，各段都有默认值：

```text
docker pull nginx
≡ docker pull docker.io/library/nginx:latest
└─ docker.io ─┘└library┘└nginx┘└latest┘
    默认仓库    官方命名空间  仓库名  默认 tag

docker push reg.corp.com:5000/backend/pay:1.4.0
└─仓库地址+端口──┘└命名空间┘└名┘└tag──┘
```

| 写法 | 实际指向 |
| --- | --- |
| nginx | docker.io/library/nginx:latest |
| myname/myapp | docker.io/myname/myapp:latest |
| localhost:5000/myapp | 本机 5000 端口的仓库 |
| reg.corp.com/backend/myapp:1.0 | 公司私有仓库 |

记忆规则：**全名第一段里出现 `.` 或 `:` 或是 localhost，Docker 就把它当仓库地址**。这就是为什么自建仓库的镜像必须带地址前缀——不带的话，`myregistry/myapp` 会被当成 Docker Hub 上的普通命名空间。

## 推送全流程

```bash
docker login                        # 默认登录 Docker Hub，提示输入用户名与密码/令牌
docker build -t myapp:1.0 .         # 本地构建
docker tag myapp:1.0 mydockerid/myapp:1.0   # 补全命名空间，否则推不出去
docker push mydockerid/myapp:1.0    # 推送：分层上传，仓库已有的层秒传
docker search postgres              # 搜索公共镜像
docker logout                       # 清除本地凭证
```

推送是分层的：已存在于仓库的层（大家共用的基础镜像层）直接跳过，只传差异层，pull 同理。所以"改一行代码重新推送"通常只传最上面一两层——这是镜像分发比传 tar 包快的根本原因（见[镜像与分层](03-images.md)）。

> [!TIP]
> 发布的标准动作是同一镜像打多个 tag 一次推完：`docker tag myapp:1.0 mydockerid/myapp:latest && docker push mydockerid/myapp`——两个 tag 指向同一个镜像 ID，第二次 push 几乎零传输。另外 Docker Hub 对匿名拉取有限流（按 IP 计数），CI 里频繁匿名 pull 失败多半是这个原因，登录或换源可解。

## 多架构镜像

Apple Silicon、ARM 云服务器普及之后，"一个 tag 同时支持 amd64 和 arm64"成了刚需，buildx 一条命令搞定：

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t mydockerid/myapp:1.0 --push .    # 一次构建多架构并直接推送
```

拉取时 Docker 按 CPU 架构自动选对应的变体，使用者无感；CI 里要注意每个平台各跑一遍构建步骤，流水线耗时会翻倍。

## tag 规范

tag 的本质是可变指针，规范的意义在于**让人和脚本都猜得到指针该指向哪**：

| tag | 用途 | 风险 |
| --- | --- | --- |
| myapp:latest | 本地开发图省事 | 生产禁用：含义漂移、回滚无据 |
| myapp:1.4.2 | 语义化版本，正式发布 | 需要纪律保证不被覆盖 |
| myapp:1.4 | 滚动小版本 | 同名 tag 被覆盖时内容悄悄变化 |
| myapp:git-8f3a2c1 | Git 提交哈希 | 不可变、可追溯，推荐与版本号并存 |
| myapp:20260913 | 按日期 | 高频发布时直观 |

实践组合：**版本号 + git 哈希双 tag**。版本号给人看，哈希保证精确追溯到某次构建；CI 里用 `$GIT_SHA` 或构建参数注入，谁也不用手工打 tag。

> [!WARNING]
> 别把敏感信息烘进镜像再 push 到公共仓库：`.env`、私钥、数据库密码一旦被 COPY 进某一层，删除镜像也删不掉历史层——任何拉过的人都能分层下载后 `docker history` 扒出来。秘密走环境变量或运行时挂载（见[数据卷与持久化](05-volumes.md)），构建产物只放代码和依赖。

## 自建私有仓库

不想用公共仓库（合规、内网带宽、私有代码），最小方案是官方 registry 镜像：

```bash
docker run -d --name registry \
  -p 127.0.0.1:5000:5000 \
  -v registry-data:/var/lib/registry \
  --restart=always \
  registry:2

docker tag myapp:1.0 localhost:5000/myapp:1.0
docker push localhost:5000/myapp:1.0
curl localhost:5000/v2/_catalog         # 仓库里有哪些镜像
curl localhost:5000/v2/myapp/tags/list  # 某镜像的全部 tag
```

registry 默认只接受 HTTPS，纯 HTTP 需要在每台使用它的机器上声明不安全仓库：

```json
// /etc/docker/daemon.json
{ "insecure-registries": ["reg.corp.com:5000"] }
```

```bash
sudo systemctl restart docker            # 改完重启 daemon 生效
docker pull reg.corp.com:5000/myapp:1.0  # 之后就能正常推拉
```

镜像删除后，registry 里的层不会立刻回收，要定期跑垃圾回收：

```bash
docker exec registry bin/registry garbage-collect /etc/docker/registry/config.yml
```

内网试用可以 insecure，正式使用必须挂 TLS（前置 nginx/traefik 终结证书，或 registry 自带 TLS 配置）——没有 TLS 的 registry 等于无鉴权裸奔。要 UI、权限控制、漏洞扫描、主从同步，上 Harbor，它是 CNCF 毕业项目，公司内网的事实标准。

## 部署链路串起来

开发机 build → push 到仓库 → 服务器 pull → run/up。仓库是这条链上唯一的"真源"，由此推出两条纪律：

- 服务器上不 build：构建依赖多、不可复现，服务器只 pull 固定 tag 或摘要
- 部署记录到摘要级别：出了问题，"线上到底跑的哪个镜像"必须 30 秒内答得出来

```bash
# 服务器上的典型发布：换 tag、拉新、滚动重启
docker compose pull && docker compose up -d
```

相关阅读：[镜像与分层](03-images.md)、[Docker Compose](07-compose.md)
