---
title: 运维基础
order: 11
tags: 进阶, 备份, 慢查询
summary: 备份与恢复、慢查询日志、SQLite/Postgres/MySQL 的选型与迁移常识。
---

数据库出问题，最常见的不是"查询慢"，而是"数据没了"和"突然全慢"。运维基础就三件事：备份能恢复、慢查询有人看、选型与迁移不踩坑。这一篇按"出事概率"从高到低讲。

## 备份与恢复

备份先分两派：

- **逻辑备份**：导出成 SQL/文本（`pg_dump`、`mysqldump`），跨版本、可读、可挑表，恢复慢
- **物理备份**：直接拷贝数据文件或做快照（`pg_basebackup`、存储快照），恢复快，通常绑定版本与实例

```bash
# PostgreSQL：单库逻辑备份与恢复（-Fc 自定义压缩格式，支持选择性恢复）
pg_dump -Fc mydb > mydb.dump
pg_restore -d mydb_new mydb.dump

# MySQL：全库逻辑备份；--single-transaction 让 InnoDB 在一致性快照里导出，不阻塞写入
mysqldump --single-transaction --all-databases > all.sql

# SQLite：在线备份。别直接 cp 正在写入的库文件——拷到的是损坏状态
sqlite3 mydb.db ".backup 'mydb.bak'"
```

生产备份是三条铁律的组合：**定期自动跑**（调度任务，不是想起来才跑）、**异地存放**（同一块磁盘防不了磁盘故障，更防不了勒索软件）、**演练恢复**（定期在另一台机器上真的恢复一次）。保留策略按"越老越稀"排：日备留 7 份、周备留 4 份、月备留 12 份，配合经典的 3-2-1 原则——3 份副本、2 种介质、1 份异地。

> [!WARNING]
> 没有验证过恢复的备份等于没有备份。备份文件损坏、还原命令早已失效、没人知道密码——这些都会在灾难当天才暴露。第一次恢复演练请安排在平静的日子，而不是着火的那晚。

需要"恢复到任意时间点"（误删表想回到删除前一秒），靠持续归档 WAL（PostgreSQL）或 binlog（MySQL）：全量快照打底，日志重放到指定时刻，即 PITR。误删数据的急救通道是它，不是每周一次的全量备份。恢复演练可以固定成一张小清单：

```text
1. 找一台隔离的机器，装同版本数据库
2. 拉最近一次备份，按文档执行恢复
3. 跑对账查询：行数、关键表抽样、最新时间戳
4. 记录总耗时与踩到的坑，回去修文档——演练的价值全在这一步
```

## 慢查询：找到它们

慢查询日志是性能问题的第一现场，先开日志再谈优化：

```bash
# MySQL：记录超过 1 秒的查询（默认关闭）
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;
```

```sql
-- PostgreSQL：记录执行超过 500ms 的语句，改完 reload 即生效
ALTER SYSTEM SET log_min_duration_statement = 500;
SELECT pg_reload_conf();
```

日志有了还要会读。裸日志没法看，要聚合成榜单：MySQL 配 `pt-query-digest`，PostgreSQL 装上 `pg_stat_statements` 扩展，一条视图直接拿累计耗时 TOP：

```sql
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC LIMIT 10;   -- 按总耗时排：优化它全局收益最大
```

排序指标有讲究：`total_exec_time`（单次 × 次数）反映全局负担，优先打它；`mean_exec_time` 高但调用少的查询，多半不值得动。找到目标后按[SQL 进阶](08-sql-advanced.md)的 EXPLAIN 流程走：看扫描方式 → 查缺索引 → 查索引失效写法，三步能解决绝大多数慢查询。

正在发生的卡顿用另一条路查——看当前在跑什么：

```sql
-- PostgreSQL：谁在跑、跑了多久
SELECT pid, state, now() - xact_start AS xact_age, left(query, 60) AS query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY xact_age DESC NULLS LAST;
```

```bash
# MySQL：当前连接与语句概览
SHOW FULL PROCESSLIST;
```

`xact_age` 特别大的那个就是长事务——它可能是连接堆积和表膨胀的元凶，处理办法见[事务与并发](07-transactions.md)。

## 监控什么

不必铺开全套可观测性，先盯住这几个核心指标：

| 指标 | 为什么要看 |
| --- | --- |
| 连接数 / 活跃查询数 | 逼近上限或长期打满 → 池配置或慢查询问题 |
| 慢查询数量趋势 | 突增往往对应新代码上线，回溯版本好定位 |
| 磁盘水位与增长速度 | 磁盘写满是数据库最体面的死法，日志和 WAL 都会吃磁盘 |
| 复制延迟（若有从库） | 从库读到旧数据，业务上表现为"刚提交的数据不见了" |
| 缓存命中率 | 断崖下跌说明内存不够或访问模式变了 |

内存参数基本决定性能上限：PostgreSQL 的 `shared_buffers`、MySQL 的 `innodb_buffer_pool_size`，常规起点是机器内存的四分之一到一半——内存命中率上不去，加索引都救不了。

## 选型：SQLite / PostgreSQL / MySQL

| | SQLite | PostgreSQL | MySQL |
| --- | --- | --- | --- |
| 形态 | 嵌入式，整个库是一个文件 | 独立服务进程 | 独立服务进程 |
| 并发模型 | 单写多读（WAL 模式） | 多写，MVCC，默认 RC | 多写，MVCC，默认 RR |
| 适合 | 单机应用、桌面/移动端、嵌入式、小型网站 | 绝大多数业务系统的默认选择 | 生态成熟、运维人才普及、历史包袱兼容 |

> [!TIP]
> 别迷信"生产必须上独立数据库"。本地工具、个人项目、读多写少的单机服务，SQLite 又稳又零运维，WAL 模式下并发读很能打。需要独立数据库服务器、更丰富的类型与扩展、更复杂的查询能力时，再上 PostgreSQL。

长大到需要读写分离时，常识两条：主从复制默认异步，从库有延迟，"写完立刻读"的请求要强制走主库；复制延迟本身要进监控（上表第五行），它是"刚保存的数据不见了"这类诡异 bug 的常见源头。

## 迁移常识

改表结构与换库，共同的常识只有一条：**小步走，永远留退路**。

- **表结构变更**用迁移脚本管理（sqlx migrate、diesel migration、Flyway），纳入版本控制，只向前不回改——回滚靠写"向前修正"的新迁移，而不是把旧迁移倒着跑
- **大表加列**拆三步：加可空列 → 分批回填 → 设默认值。一条 `ALTER` 带默认值直接怼上去，老版本 MySQL 会锁表重建
- **换数据库**先双写对账，再灰度切读，最后切写——每一步都可以停住观察
- 迁移脚本与代码版本要兼容：新代码上线前，旧代码必须还能在**新表结构**上跑（先加列后删列，删列等代码全面下线后再执行）

相关阅读：[程序访问数据库](10-orm-access.md)，[索引](06-index.md)
