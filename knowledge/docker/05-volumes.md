---
title: 数据卷与持久化
order: 5
tags: 核心, volume, 挂载
summary: 容器为什么易失、volume 与 bind mount 的选择、数据库数据怎么留。
---

容器的可写层随容器生、随容器死：删容器，容器里写过的一切跟着消失；重建容器，也找不回旧数据。所以"把数据存在容器里"从一开始就是错误命题，持久化要靠挂载——把 Docker 管理的卷或宿主机目录接到容器里。

## 容器为什么易失

回忆镜像与分层篇的结构：镜像是一叠只读层，容器在顶上多一层可写层。所有运行期写入——数据库文件、上传的附件、日志——都落在可写层，而可写层的命运绑定在容器上：

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=x postgres:16   # 不挂卷
docker exec pg psql -U postgres -c "CREATE TABLE t(id int);"
docker rm -f pg                             # 删容器，可写层一并销毁
docker run -d --name pg2 -e POSTGRES_PASSWORD=x postgres:16
docker exec pg2 psql -U postgres -c "\dt"   # 表没了
```

即使不删容器，数据放可写层还有两个问题：写时复制让随机写性能差；可写层持续膨胀拖慢容器的创建与销毁。结论明确：**容器 = 无状态的计算，数据全部外置**。

## 三种挂载方式

| 维度 | volume（卷） | bind mount（绑定挂载） | tmpfs |
| --- | --- | --- | --- |
| 存储位置 | Docker 管理，Linux 上在 /var/lib/docker/volumes/ | 宿主机任意路径 | 内存，不落盘 |
| 谁来创建 | docker volume create 或首次使用时自动 | 依赖宿主机上已存在的路径 | 挂载时创建 |
| 可移植性 | 好，不耦合宿主机目录结构 | 差，路径绑死宿主机 | 无所谓 |
| 典型用途 | 数据库、应用状态数据 | 开发挂源码热更新、挂配置文件 | 敏感的临时数据 |

**选型判断**：生产数据用 volume（Docker 统一管理、备份迁移方便、不依赖宿主机目录约定）；开发时把代码挂进容器做热更新用 bind mount；临时密钥用 tmpfs。

```bash
docker volume create pgdata        # 显式创建命名卷
docker volume ls                   # 列出所有卷
docker volume inspect pgdata       # 挂载点、驱动、创建时间
docker volume rm pgdata            # 删除卷（被容器引用时删不掉）
docker volume prune                # ❌ 清掉所有未被引用的卷——里面可能全是数据
```

> [!WARNING]
> `docker volume prune` 和 `docker system prune --volumes` 会删除所有未被容器使用的卷，这是 Docker 日常操作里最接近"rm -rf 数据库"的一条命令。执行前先 `docker volume ls` 逐个确认。

## -v 的两种语义

同一个小写 `-v`，第一段长得不一样，含义完全不同：

```bash
# 命名卷：第一段不以 / 开头，Docker 统一管理
docker run -d -v pgdata:/var/lib/postgresql/data postgres:16
# bind mount：第一段以 / 或 ./ 开头，直接映射宿主机路径
docker run -d -v /opt/pgdata:/var/lib/postgresql/data postgres:16
# :ro 只读挂载，容器内改不了
docker run -d -v /etc/localtime:/etc/localtime:ro nginx
# 匿名卷：只写容器路径，卷名由 Docker 随机生成
docker run -d -v /data myapp
```

判断口诀：**以 / 或 ./ 开头是宿主机路径（bind mount），否则是卷名**。匿名卷用完容易忘，`docker volume ls` 里一串十六进制的多半就是它们，是磁盘泄漏的常见来源。长格式 `--mount` 语义更明确，脚本和 CI 里推荐：

```bash
docker run -d --mount type=volume,source=pgdata,target=/var/lib/postgresql/data postgres:16
docker run -d --mount type=bind,source=/opt/myapp,target=/app,readonly myapp
docker run -d --mount type=tmpfs,target=/tmp,tmpfs-size=100m myapp
```

开发场景的经典组合是 bind mount + 热更新：宿主机的源码目录整个挂进容器，改代码即时生效，不用重建镜像：

```bash
docker run -d --name dev -v "$(pwd)":/app -w /app -p 3000:3000 node:22-slim npm run dev
```

## 数据库数据怎么留

以 PostgreSQL 为例，标准姿势是命名卷 + 环境变量：

```bash
docker volume create pgdata
docker run -d \
  --name pg \
  -e POSTGRES_PASSWORD=secret \
  -v pgdata:/var/lib/postgresql/data \
  --restart=unless-stopped \
  postgres:16

# 验证持久化：删容器、用同一个卷重建，数据原样回来
docker exec pg psql -U postgres -c "CREATE TABLE demo(id int);"
docker rm -f pg
docker run -d --name pg -e POSTGRES_PASSWORD=secret \
  -v pgdata:/var/lib/postgresql/data postgres:16
docker exec pg psql -U postgres -c "\dt"    # demo 表还在
```

数据库特有的几个注意点：

- 挂载点要用镜像声明的数据目录（PostgreSQL 是 /var/lib/postgresql/data，MySQL 是 /var/lib/mysql），别凭感觉写路径
- 卷里已有旧版本数据时，换大版本镜像不会自动迁移——PostgreSQL 大版本升级要 pg_dump/pg_upgrade，直接换镜像会起不来
- 权限：镜像内部常以非 root 用户运行，命名卷首次使用时 Docker 会自动初始化属主；bind mount 则容易碰上宿主机 uid 不匹配
- 接手不熟悉的环境，先 `docker inspect -f '{{json .Mounts}}' 容器名` 看挂载——数据在卷里还是在可写层里，一眼定生死

> [!TIP]
> 卷首次挂到空目录时，Docker 会把镜像里该目录的已有内容拷进卷做初始化；但目录非空时不会反向覆盖。升级数据库镜像前先备份数据，别赌初始化行为。

## 备份与迁移

卷的本质是宿主机上的一个目录，备份思路就是"起个临时容器把目录打包出来"：

```bash
# 备份：临时容器同时挂载卷和当前目录，tar 打包
docker run --rm -v pgdata:/data -v $(pwd):/backup alpine \
  tar czf /backup/pgdata-$(date +%F).tar.gz -C /data .

# 恢复：反向解包进卷
docker run --rm -v pgdata:/data -v $(pwd):/backup alpine \
  sh -c "cd /data && tar xzf /backup/pgdata-2026-09-13.tar.gz"
```

小量文件也可以 `docker cp 容器:/路径 ./` 直接拷，但它走的是容器文件系统，不如卷备份通用。多主机共享数据用卷驱动（NFS、云盘类插件），或者干脆把状态放到外部服务——编排越复杂，"数据不进容器"这条纪律越重要。

相关阅读：[Docker Compose](07-compose.md)、[容器网络](06-networks.md)
