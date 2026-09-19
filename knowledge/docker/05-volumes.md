---
title: 数据持久化：卷与挂载
order: 5
tags: volume, bind mount, tmpfs, 持久化, 备份
summary: 容器写层临时性推出的两种数据需求、三种挂载（named volume/bind mount/tmpfs）的语义与选型表、volume 管理命令与存储位置、数据库数据卷的实战模式与备份配方。
---

容器的写层随容器删除而消失（[第 1 篇](01-why-containers.md)）——这对「无状态应用」是特性（幂等可重建），对「有状态应用」（数据库、文件上传、日志）是灾难。Docker 的答案是把「数据」从容器的生命周期中**剥离**出来：数据放卷（volume），容器随便生灭。

## 1. 三种挂载：语义与选型

```bash
# ① 命名卷：Docker 管理存储位置（推荐的数据持久化形态）
docker run -v pgdata:/var/lib/postgresql/data postgres:16

# ② bind mount：宿主目录直通容器（开发的热重载形态）
docker run -v $(pwd)/src:/app/src node:20 npm run dev

# ③ tmpfs：内存挂载（临时敏感数据，不落盘）
docker run --tmpfs /app/cache:rw,size=100m myapp
```

| 维度        | named volume            | bind mount                | tmpfs          |
| ----------- | ----------------------- | ------------------------- | -------------- |
| 存储位置    | Docker 管理（/var/lib/docker/volumes/）| 宿主任意路径       | 内存            |
| 内容初始化  | 空卷可从镜像目录预填充     | 直接是宿主内容             | 空              |
| 可移植性    | 高（不依赖宿主路径）      | 低（绑定宿主具体路径）      | 高              |
| 典型场景    | **数据库数据、持久状态**   | **开发热重载、配置文件**     | 敏感临时缓存     |

选型口诀：**「容器生灭数据要在」→ volume；「宿主文件实时同步进容器」→ bind；「临时且敏感」→ tmpfs**。开发环境的代码挂载（bind）让「改代码立即生效、无需重建镜像」——容器的开发体验由此而来。

### 1.1 挂载的语法变体

```bash
-v pgdata:/data                 # 短语法：卷名:容器路径（无宿主路径 → 卷）
-v /host/path:/data             # 短语法：宿主绝对路径 → bind mount
-v data:/data:ro                # 只读挂载（配置文件的标准姿势）
--mount type=volume,source=pgdata,target=/data     # 长语法（显式、可读）
--mount type=bind,source=/host,target=/data,readonly
```

短语法的一处歧义陷阱：`-v webdata:/data`（卷）与 `-v ./webdata:/data`（bind）只差一个 `./`——**以 / 开头的是 bind、否则是卷名**。长语法（--mount type=）消灭歧义，脚本与文档推荐。

## 2. Volume 的管理

```bash
docker volume create pgdata          # 显式创建（或 run 时隐式创建）
docker volume ls
docker volume inspect pgdata         # Mountpoint：宿主上的实际路径（Linux: /var/lib/docker/volumes/pgdata/_data）
docker volume rm pgdata              # 删除（容器占用中会拒绝）
docker volume prune                  # ★ 清理无人引用的卷 —— 危险：可能删掉不再运行容器的数据！

docker system df -v                  # 卷的占用明细
```

卷的生命周期与容器**解耦**：容器删除卷仍在（这是特性）；但也意味着「删掉退役容器时数据卷悄悄累积」——prune 前确认「哪些卷真的不要了」。备份是比清理更重要的动作：

```bash
# 备份卷的标准配方：借一个临时容器挂卷 + tar
docker run --rm -v pgdata:/data -v $(pwd):/backup alpine \
    tar czf /backup/pgdata-$(date +%F).tar.gz -C /data .
# 恢复：反向解包
docker run --rm -v pgdata:/data -v $(pwd):/backup alpine \
    sh -c "cd /data && tar xzf /backup/pgdata-2026-09-19.tar.gz"
```

更专业的数据库备份不走文件系统拷贝（一致性快照问题），走 `pg_dump`/`mysqldump` 进容器执行（[第 10 篇](10-debug-ops.md)的 exec 配合）——文件级 tar 只用于「离线且确认一致」的场景。

## 3. Dockerfile 里的 VOLUME 与匿名卷

```dockerfile
VOLUME /var/lib/postgresql/data       # 声明：这个路径的数据应外置
```

镜像里的 `VOLUME` 指令的效果：run 时即使不挂载，Docker 也自动创建**匿名卷**挂上去。好处：忘记挂载时数据库数据不至于写进写层；坏处：**匿名卷堆积**（每个容器一个，prune 前难辨认）——数据库镜像都用它（保护用户），应用镜像一般不用（增加意外）。

```bash
docker run postgres:16               # 自动生成匿名卷
docker volume ls                     # 一串匿名 hash 卷 —— prune 时小心
```

## 4. 数据库数据卷实战

```bash
# 数据库容器的标准形态
docker run -d --name pg \
  -v pgdata:/var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=secret \
  postgres:16

# 验证持久性：建表 → 删容器 → 重建同名卷容器 → 数据还在
docker exec pg psql -U postgres -c "CREATE TABLE t(x int)"
docker rm -f pg
docker run -d --name pg -v pgdata:/var/lib/postgresql/data postgres:16
docker exec pg psql -U postgres -c "\dt"        # 表 t 还在 —— 持久化成立
```

这个实验是卷语义的终极验证：**容器的生死与数据的存亡解耦**。加上 `--volumes-from` 的复用模式（一个数据容器、多个使用容器）在 compose 时代已让位于直接命名卷（[第 7 篇](07-compose.md)），但理解它有助于读懂老部署。

## 5. bind mount 的现实问题

```bash
# 开发热重载的完整形态
docker run -it --rm -p 3000:3000 \
  -v $(pwd)/src:/app/src \
  -v /app/node_modules \              # ★ 匿名卷「屏蔽」宿主没有的 node_modules
  -w /app node:20 sh -c "npm i && npm run dev"
```

`-v /app/node_modules`（只写容器路径 = 匿名卷）是开发挂载的经典技巧：宿主的 src 挂进来，但 node_modules 用容器内安装的版本（宿主与容器系统不同，二进制依赖不兼容）——**「先 bind 再用匿名卷覆盖子目录」**是混合挂载的标准配方。

bind mount 的平台坑：Windows/macOS 上跨 VM 的文件系统事件（inotify）不可靠（热重载失灵——需要 polling 模式）；性能比原生卷差一个量级。Linux 上没有这些问题——**生产跑 Linux 容器、开发也尽量 WSL2** 是性能与一致性的共同选择。

## 6. 陷阱清单

- 把数据留在容器写层当持久化：rm 即蒸发；数据库/上传文件必须卷。
- `-v ./dir` 与 `-v dir` 的歧义：一个 bind 一个卷；脚本用 --mount type= 显式。
- volume prune 误删退役容器的数据：prune 前盘点；重要卷用命名 + 备份。
- 开发挂载覆盖了容器内的构建产物：匿名卷覆盖技巧（node_modules 模式）。
- 宿主 uid 与容器内进程 uid 不匹配：bind mount 的文件权限错乱；容器内 USER 对齐宿主 uid 或统一用 root+降权方案。
- 文件级 tar 备份运行中的数据库：备份出损坏快照；用数据库逻辑备份工具。
- Windows/macOS 的 bind mount 上跑 IO 密集应用：性能陷阱；数据与依赖放卷/容器内。

## 7. 小结

- 三种挂载的分工：volume 持久化（Docker 管理存储）、bind 开发热重载与配置注入、tmpfs 敏感临时——选型口诀「生灭要留→卷、实时同步→bind、临时敏感→tmpfs」。
- 卷与容器生命周期解耦是特性也是管理面：命名卷、定期备份（tar 配方或数据库逻辑备份）、prune 前盘点。
- VOLUME 指令的自动匿名卷：数据库镜像的保护机制、应用镜像的意外来源。
- 开发挂载的经典配方：bind 源码 + 匿名卷屏蔽构建产物；平台差异（inotify/性能）是 bind 的现实成本。
- 持久性验证实验（建表删容器重建）是把「卷语义」变成肌肉记忆的最短路径。

## 8. 练习

**1.** 完整跑通本篇第 4 节的数据库持久性实验：建表 → rm 容器 → 重建 → 数据还在；再用 volume prune 删掉卷后重复——把「卷在数据在、卷亡数据亡」写成自己的实验记录。

> [!TIP]
> 思路实验的后半段（删卷）故意展示数据丢失——最便宜的代价理解最贵的教训。生产上「删卷前双确认」的纪律来源就是这个实验。

**2.** 用三种挂载各跑一个容器：命名卷（数据持久）、bind（挂宿主目录读写）、tmpfs（写文件后查宿主不存在）——用 `docker inspect` 的 Mounts 字段核对三种挂载的类型与来源。

> [!TIP]
> 思路inspect 的 Mounts 数组是挂载的权威记录：Type/Source/Destination 三字段。三个实验做完全部挂载场景的心智模型齐了。

**3.** 实现本篇第 5 节的「开发热重载」配方：Node（或 Python）应用 bind 源码 + 匿名卷屏蔽 node_modules，改代码验证热重载生效；再故意删掉宿主的 node_modules 验证容器内不受影响。

> [!TIP]
> 思路匿名卷的「屏蔽」语义：容器路径已有卷挂载时，bind 只挂父路径不影响子路径——这是技巧生效的机制。画一张挂载叠加图帮助理解。

**4.** 写「卷备份与恢复」脚本：用临时容器 tar 备份命名卷（带日期文件名）、清空卷、恢复、校验文件一致——用非数据库文件（如 nginx 静态文件）做实验。

> [!TIP]
> 思路备份脚本参数化（卷名、输出目录），恢复前先 `docker volume rm` 保证干净。做完这个脚本，「数据卷的运维闭环」就有了最小实现。

**5.** 制造一次 bind mount 的权限错乱（宿主 uid 1000 写、容器内进程 uid 0 或反之），观察写入失败/文件属主漂移，用三种方案修复（容器内 USER 对齐、chown、named volume 替代）。

> [!TIP]
> 思路根因：bind mount 绕过 Docker 的用户映射，文件系统权限直接对撞。named volume 有 uid 对齐机制（卷初始化时继承镜像目录属主）——「权限问题换卷解决」是常用解。

**6.** 讨论：为什么「无状态容器 + 外置状态（卷/数据库）」是编排系统（K8s/Swarm）调度的前提？从「容器可被随时销毁重建」推出应用设计的约束，并对照 [十二要素应用](../python/08-modules-packages.md)的哪一条原则。

> [!TIP]
> 思路调度器的自由度 = 随时迁移/重建容器——状态外置让容器「可抛弃」。十二要素第 6 条「进程无状态、状态存后端」——容器时代把这条从「建议」变成了「调度器的前置条件」。
