---
title: Docker Compose
order: 7
tags: 核心, compose, 编排
summary: 一个 YAML 编排多容器：服务/网络/卷、depends_on 与健康检查。
---

一个真实应用从来不止一个容器：Web 服务、数据库、缓存、队列，各有各的镜像、端口、环境变量和启动顺序。手敲十几条 docker run 既记不住也难复现，Compose 的答案是把这堆定义收进一个 YAML，一条命令拉起整套环境。

## 一个典型的 compose.yaml

```yaml
services:
  web:
    build: .                          # 用当前目录 Dockerfile 构建（也可以只写 image:）
    image: myapp:1.0                  # build 产物打上这个 tag
    ports:
      - "8080:80"                     # 等价于 docker run -p
    environment:
      - DATABASE_URL=postgres://app:app@db:5432/app   # 服务名 db 就是主机名
      - REDIS_URL=redis://cache:6379
    depends_on:
      db:
        condition: service_healthy    # 等 db 健康检查通过再启动
    restart: unless-stopped
    volumes:
      - ./uploads:/app/uploads        # bind mount：开发时挂上传目录

  db:
    image: postgres:16
    environment:
      - POSTGRES_USER=app
      - POSTGRES_PASSWORD=app
    volumes:
      - pgdata:/var/lib/postgresql/data   # 命名卷：数据持久化
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      timeout: 3s
      retries: 5

  cache:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]

volumes:
  pgdata:                              # 声明命名卷，实际名字带项目前缀
```

```bash
docker compose up -d        # 一条命令：建网络、建卷、按依赖顺序起全部服务
```

三大部分对应三篇旧知识：`services` 是容器定义（每个服务约等于一条 docker run）；`volumes` 是命名卷声明；网络不用写——Compose 自动创建自定义 bridge 网络，服务名即 DNS，正是容器名解析那套机制的默认化。

## depends_on 与健康检查

depends_on 只保证**启动顺序**：db 的容器先创建，不保证 PostgreSQL 已经能接受连接。应用进程比数据库起得快，连接失败、crash、靠 restart 反复重试，就是经典的"Compose 之坑"。解法是给依赖方定义健康检查，把依赖从"等它启动"升级成"等它健康"：

```yaml
depends_on:
  db:
    condition: service_healthy     # healthy 才继续
  cache:
    condition: service_started     # 默认行为：容器启动即可
```

healthcheck 的 test 两种写法：`["CMD", "curl", "-f", "http://localhost:8080/health"]` 直接执行；`["CMD-SHELL", "..."]` 走 shell、支持变量和管道。interval 是检查间隔，retries 是连续失败多少次后标记 unhealthy。

> [!TIP]
> 健康检查命令要"轻且准"：pg_isready、redis-cli ping、mysqladmin ping 都是现成探针，HTTP 服务用内部 health 端点。别拿重查询当检查——5 秒一次的重查询本身就是负担。

## 日常命令

```bash
docker compose up -d              # 创建并启动全部服务（配置变了的自动重建）
docker compose up -d --build      # 顺带重新 build
docker compose down               # 停止并删除容器和网络（卷保留）
docker compose down -v            # ❌ 连命名卷一起删——数据库数据随之消失
docker compose logs -f web        # 看单个服务日志；不带服务名看全部
docker compose ps                 # 本项目的容器状态
docker compose exec web sh        # 进入某个服务的容器
docker compose restart web        # 重启单个服务
docker compose pull               # 拉取各服务的新镜像
docker compose config             # 校验并渲染最终 YAML（合并环境变量后的样子）
```

`up` 是幂等的：YAML 没变的容器不动，变了的重建。改完配置不用 down 再 up，直接 `up -d`，它自己算 diff。

## 项目、网络与环境变量

- **项目名**默认取 compose 文件所在目录名，所有资源带前缀（容器 `myapp-web-1`、卷 `myapp_pgdata`）。`docker compose -p othername up` 可改，同机多套环境靠它隔离
- **同一服务多副本**：`docker compose up -d --scale web=3`，服务名的 DNS 解析会轮询到多个实例；注意各副本若都 `-p` 映射同一个宿主机端口会冲突，副本模式通常不映射宿主机端口
- **环境变量三级**：`environment` 里写死；`env_file: .env` 整文件注入容器；YAML 里的 `${VAR}` 从 shell 或 compose 同目录的 .env 读取（给 Compose 自己用的）。密码这类不该进版本库的东西走 .env，并把 .env 加进 .gitignore

```yaml
services:
  web:
    image: myapp:${APP_VERSION:-latest}   # 支持默认值语法
    env_file:
      - .env                              # 整个文件作为环境变量注入容器
```

> [!NOTE]
> compose 目录下的 .env 会同时作用于两个层面：YAML 里 `${VAR}` 的替换（给 Compose 解析用），以及被 `env_file` 显式注入的变量（给容器用）。两者来源相同但受众不同，写文档时别混为一谈。

## 按需裁剪：profiles

调试用的管理界面、压测工具没必要每次都起。给服务标 profiles，默认不启动，显式激活才拉起：

```yaml
services:
  adminer:                      # 数据库管理界面，调试时才用
    image: adminer
    profiles: ["debug"]
```

```bash
docker compose --profile debug up -d   # 显式激活 profile 才会创建
docker compose ps                      # 默认 up 时它不会出现
```

## 单机编排的边界

Compose 管的是**一台主机**上的多容器：启动顺序、网络、卷、重建。它不做多机调度、不做自动扩缩容、不做跨机服务发现——那是 Swarm 和 Kubernetes 的领域。反过来说，绝大多数中小项目和本地开发环境，Compose 恰好够用且简单得多。

把 compose.yaml 提交进版本库，.env 不提交——前者是环境的定义，后者是环境的秘密。CI/CD 也自然长成固定套路：构建镜像 push 到仓库（见 [镜像仓库](08-registry.md)），服务器上改个 tag 再 `up -d`。

相关阅读：[容器网络](06-networks.md)、[数据卷与持久化](05-volumes.md)
