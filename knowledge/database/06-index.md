---
title: 索引
order: 6
tags: 核心, 索引, B+ 树
summary: 索引为什么快、B+ 树的直觉、最左前缀、覆盖索引，以及索引的代价。
---

索引是数据库里投入产出比最高的优化：一条 `CREATE INDEX` 让查询从全表扫描变成毫秒直达。但它不是免费午餐——每个索引都在拖慢写入、占用存储。这一章讲清它快在哪、什么情况下失效、什么时候不该加。

## 没有索引会发生什么

```sql
SELECT * FROM orders WHERE user_id = 42;
```

没有索引时，数据库只能**全表扫描**：一行行读出来比对。1000 万行的表哪怕每行只花 1 微秒，也要 10 秒——而且并发查询一起来，每个都在扫全表。有 `(user_id)` 索引时，走的是对数级查找：B+ 树 3~4 层就能定位任意一行，千万行和十行在"跳几次"上没有本质区别。

## B+ 树的直觉

不用抠实现，抓住三个特性就够用：

1. **有序**：树按索引列的顺序组织，所以 `ORDER BY` 同序的查询可以免排序，范围条件（`BETWEEN`、`>`、前缀 `LIKE 'abc%'`）顺着叶子节点扫过去就行
2. **矮胖**：每个节点扇出几百上千，1000 万行也就 3~4 层——查一次索引等于 3~4 次页面访问，上层节点基本常驻内存
3. **叶子串成链表**：范围扫描在叶子层顺序推进，不用反复回到上层

写入的代价也随之而来：插入不在末尾的行，所在页可能要**分裂**（一页装不下，拆成两页），上层节点跟着长高。随机写（如 UUID 主键）让分裂发生在树的所有角落，追加写只发生在最右端——这就是"自增主键插入快"的根源。

> [!NOTE]
> 哈希索引等值查询更快（O(1)），但不支持范围和排序——这正是主流引擎默认选 B+ 树的原因：它是"等值 + 范围 + 排序"的均衡解。InnoDB 只在引擎内部悄悄用自适应哈希补热门页，对外暴露的仍是 B+ 树。

## 聚簇与二级：主键为什么不能太长

InnoDB 的表本身就是按主键组织的聚簇索引——**叶子节点存的是整行数据**，主键即数据的物理顺序。其他索引叫二级索引，叶子节点存"索引列 + 主键值"，命中后要拿主键回聚簇索引再查整行，这一步叫**回表**。两个推论：

- 主键要短：每个二级索引的叶子都复制了一份主键，主键 8 字节和 36 字节，乘上索引数量就是实打实的空间差
- PostgreSQL 走另一条路：堆表存数据、索引全部平等，索引命中后按行指针回表，没有"聚簇"包袱，但回表成本逻辑相同

理解回表，才能理解下一节的覆盖索引为什么快。

## 最左前缀原则

联合索引 `(a, b, c)` 相当于电话簿"先按姓排、再按名排、再按生日排"：可以按姓查、按姓+名查，但不能跳过姓直接按名查。

```sql
CREATE INDEX idx_abc ON t (a, b, c);

WHERE a = 1                      -- 用上索引（a 段）
WHERE a = 1 AND b = 2            -- 用上（a, b 段）
WHERE a = 1 AND b = 2 AND c = 3  -- 全用上
WHERE b = 2                      -- 用不上：缺最左列 a
WHERE a = 1 AND c = 3            -- 只用上 a 段：b 断层，c 够不着
```

注意条件里列的**书写顺序无关紧要**（优化器会重排），重要的是条件集合里有没有从最左列开始的连续前缀。两个建索引的推论：

- **等值列放前，范围列放后**：`a = 1 AND b > 5` 建 `(a, b)` 两段全用；反过来 `a > 1 AND b = 2` 建 `(a, b)` 只能用 a——一旦在 a 上走了范围，后面的 b 就失序了
- **让一个索引服务多组查询**：`(user_id, created_at)` 同时覆盖"查某用户"和"查某用户某时间段"，省掉单列索引的重复维护

> [!TIP]
> 索引失效的常见姿势：对列做运算或套函数（`WHERE YEAR(created_at) = 2024` 改写成范围条件 `created_at >= '2024-01-01' AND created_at < '2025-01-01'` 就能用索引）；隐式类型转换（字符串列拿数字去比）；前导 `%` 的 LIKE。写完条件用 EXPLAIN 验证，别靠感觉。

## 覆盖索引：不回表

如果查询要的列**索引里全有**，就可以停在索引上，连回表都省了：

```sql
CREATE INDEX idx_cover ON orders (user_id, status, created_at);

SELECT created_at FROM orders WHERE user_id = 42 AND status = 'paid';
-- user_id、status、created_at 全在索引里，免回表
-- PostgreSQL 执行计划显示 Index Only Scan，MySQL 显示 Using index
```

为高频查询定制覆盖索引，是把"回表随机 IO"压成"顺序读索引"，收益常常立竿见影——尤其是列表页这种"按条件取几列"的模式。但列别贪多：索引列越多，每行写入要维护的东西越多。

## 验证与进阶用法

加没加对，EXPLAIN 说了算：

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 42;
-- Index Scan using idx_orders_user on orders   → 用上了
-- Seq Scan on orders (cost=0.00..35811.00 ...)  → 没用上，回查失效原因
```

几个进阶形态，PostgreSQL 都支持，按需取用：

```sql
CREATE UNIQUE INDEX idx_users_email ON users (email);            -- 唯一索引：UNIQUE 约束的实现本体
CREATE INDEX idx_pending ON orders (created_at)
    WHERE status = 'pending';                                    -- 部分索引：只索引待处理单，又小又准
CREATE INDEX idx_lower ON users (lower(email));                  -- 表达式索引：配合 WHERE lower(email) = ?
```

MySQL 侧记住一条：InnoDB 会自动给外键建索引，PostgreSQL 不会——外键列没索引时，删除父表行会触发对子表的全表扫描，批量删除卡死多半是它。

## 索引的代价与加法

每个索引都是一棵要同步维护的 B+ 树，代价三笔账：

- **写放大**：INSERT/UPDATE/DELETE 除了改数据还要改所有相关索引
- **存储**：索引体积常与数据同量级，一张表七八个索引，磁盘和内存缓存都吃紧
- **选择负担**：索引越多，优化器选错计划的概率越高

加索引的判断顺序：

1. WHERE、JOIN、ORDER BY 里高频出现的列优先
2. **选择性**要高：`COUNT(DISTINCT col) / COUNT(*)` 越接近 1 越值得。性别这种两三个取值的列，建 B+ 树索引基本无效，优化器多半也不理它
3. 写多读少的表（日志、流水）克制加索引——每个索引都是给每次写入加的税
4. 加完跑 EXPLAIN 确认真的用上了，观察一周写入性能没有劣化

索引也要定期清点：上线半年后，一半索引可能从未被任何查询用过——它们只有成本，没有收益。PostgreSQL 自带用量统计，低峰期清点一遍：

```sql
SELECT relname AS table, indexrelname AS index, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND relname NOT LIKE 'pg_%';   -- 从未被扫描过的索引，确认后可删
```

> [!WARNING]
> 在千万行大表上直接 CREATE INDEX 可能造成长时间高负载甚至锁写（依引擎和版本而异）。生产建索引用在线方式：PostgreSQL 的 `CREATE INDEX CONCURRENTLY`、MySQL 8.0 的 `ALGORITHM=INPLACE`，避开业务高峰，先在备库或预发验证耗时。

相关阅读：[SQL 进阶](08-sql-advanced.md)，[表设计与范式](05-design-schema.md)
