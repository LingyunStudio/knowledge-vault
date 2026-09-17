---
title: 聚合与分组
order: 4
tags: 核心, GROUP BY, HAVING
summary: 聚合函数、GROUP BY 的语义、HAVING 与 WHERE 的时机、子查询与 CTE。
---

聚合是 SQL 里第一次出现"行变少"的操作：很多行算成一个数。GROUP BY 决定按什么分组算，HAVING 决定保留哪些组——各管一层，混在一起就糊涂。本章还捎带子查询与 CTE 两种"先算中间结果"的写法。

## 样例数据

本章基于 `orders` 表：

| id | user_id | amount | status | created_at |
| --- | --- | --- | --- | --- |
| 1 | 1 | 200 | paid | 2024-01-05 |
| 2 | 1 | 300 | paid | 2024-02-10 |
| 3 | 2 | 50 | pending | 2024-02-12 |
| 4 | 1 | 800 | refunded | 2024-03-01 |
| 5 | 2 | 600 | paid | 2024-03-15 |

## 聚合函数：先分清数的是什么

五个最常用：COUNT、SUM、AVG、MIN、MAX。

```sql
SELECT COUNT(*) FROM orders;                  -- 5：行数，含 NULL 行
SELECT COUNT(paid_at) FROM orders;            -- 只有 paid_at 非 NULL 的行数
SELECT COUNT(DISTINCT user_id) FROM orders;   -- 2：下过单的去重用户数
SELECT SUM(amount), AVG(amount), MAX(amount) FROM orders;
```

`COUNT(*)` 与 `COUNT(列)` 不是性能差异，是**语义差异**：前者数行，后者数"该列非 NULL 的行"。SUM/AVG/MIN/MAX 会自动忽略 NULL——列里 NULL 一多，AVG 的分母悄悄缩小，"平均客单价对不上"的报表事故多半源于此。另外 COUNT/SUM 在零行输入上返回 0/NULL，AVG 在零行上返回 NULL，外层做除法前要先兜住。

> [!NOTE]
> 聚合函数忽略 NULL 是"设计"而不是"缺陷"，但它和三值逻辑叠加出的行为需要刻意记：`SUM(price * discount)` 会跳过 discount 为 NULL 的行，而不是按无折扣算。业务上"缺省当无折扣"就写 `SUM(price * COALESCE(discount, 1))`，把语义显式说给数据库听。

## GROUP BY 的语义：每组输出一行

```sql
SELECT user_id, COUNT(*) AS order_cnt, SUM(amount) AS total
FROM orders
GROUP BY user_id;
-- user_id=1：3 行订单，total=1300；user_id=2：2 行订单，total=650
```

规则随之而来：SELECT 里只能出现**分组列**和**聚合函数**。`SELECT name, category, COUNT(*) ... GROUP BY category` 在标准 SQL 里直接报错——组内 name 有多个值，数据库不知道取哪个。MySQL 传统模式下会"随便挑一个"返回，更害人；开 `ONLY_FULL_GROUP_BY`（5.7+ 默认开）后同样报错。想取组内某个具体值，用窗口函数（[SQL 进阶](08-sql-advanced.md)）或 `MIN(name)` 这类显式聚合说清楚。

按时间分组是报表最常用的姿势，各家的日期截断函数不同：

```sql
-- PostgreSQL
SELECT date_trunc('month', created_at) AS month, SUM(amount) FROM orders GROUP BY 1;
-- MySQL
SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, SUM(amount) FROM orders GROUP BY 1;
-- SQLite
SELECT strftime('%Y-%m', created_at) AS month, SUM(amount) FROM orders GROUP BY 1;
```

GROUP BY 可以直接引用列的序号（`GROUP BY 1`）或别名，省字但牺牲可读性，团队统一即可。条件聚合还有更清爽的写法（PostgreSQL 的 FILTER，其余用 CASE）：

```sql
SELECT user_id,
       SUM(amount) FILTER (WHERE status = 'paid') AS paid_total,               -- PostgreSQL
       SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS paid_total2    -- 全方言通用
FROM orders
GROUP BY user_id;
```

## WHERE 与 HAVING：过滤的时机不同

两者都是过滤，发生的位置一前一后：

```sql
SELECT user_id, SUM(amount) AS total
FROM orders
WHERE status = 'paid'           -- ① 分组前：筛行，决定哪些行参与计算
GROUP BY user_id
HAVING SUM(amount) >= 500       -- ② 分组后：筛组，聚合结果出来才能比
ORDER BY total DESC;
```

- WHERE 作用于**原始行**，此时聚合还没发生，所以 WHERE 里不能出现聚合函数
- HAVING 作用于**分组后的结果**，可以引用聚合，也可以引用分组列

判断口诀：条件针对**单行的属性**（状态、日期、类别）放 WHERE，条件针对**聚合的结果**（总数、均值、计数）放 HAVING。能用 WHERE 就用 WHERE——先把行筛掉再分组，参与计算的数据更少，还能让索引派上用场；把行级条件塞进 HAVING 是纯浪费。

## 子查询：三种用法

查询套查询，按位置分三类：

```sql
-- ① 标量子查询：结果当单个值，出现在 SELECT 列里
SELECT name,
       (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS cnt
FROM users u;

-- ② 集合子查询：配合 IN，出现在 WHERE 里
SELECT name FROM users
WHERE id IN (SELECT user_id FROM orders WHERE amount > 500);

-- ③ EXISTS：只问"存在匹配吗"，不关心具体值
SELECT name FROM users u
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.amount > 500);
```

EXISTS 与 IN 的性能取舍没有定论：外表大、内表小时 EXISTS（半连接）常更快，反之 IN 快——交给执行计划判断。真正必须记住的是 NULL 差异：`NOT IN` 碰上 NULL 全军覆没，`NOT EXISTS` 没有这个问题，**否定条件一律优先 NOT EXISTS**。

> [!TIP]
> 引用了外层列的相关子查询，对外层每一行执行一次，大表上可能退化成逐行扫描。遇到慢的相关子查询，多数能改写成 JOIN 让优化器统一调度；"每行取最新一条"这类场景，改窗口函数更干净。

## CTE：把复杂查询写成流水线

三层嵌套的子查询没人想读第二遍。CTE（公用表表达式）把中间结果命名，自上而下像管道一样搭：

```sql
WITH paid AS (                            -- 第一步：已支付订单
    SELECT * FROM orders WHERE status = 'paid'
), user_totals AS (                       -- 第二步：按用户汇总（引用上一个 CTE）
    SELECT user_id, SUM(amount) AS total
    FROM paid
    GROUP BY user_id
)
SELECT u.name, t.total
FROM user_totals t
JOIN users u ON u.id = t.user_id
WHERE t.total >= 500;
```

CTE 不改变查询语义，改变的是**可读性**：每个中间步骤有名字、能单独注释和调试，嵌套层数不再和心智负担成正比。两个实现细节：PostgreSQL 12 之前 CTE 一律物化（中间结果落成临时快照，反而可能更慢也可能更快），之后默认内联，需要钉住快照时写 `WITH paid AS MATERIALIZED (...)`；同一个 CTE 在查询里可以引用多次，这是它比子查询省事的另一个地方。递归 CTE 还能表达循环计算（组织树、图遍历），留给[SQL 进阶](08-sql-advanced.md)。

相关阅读：[JOIN 连接](03-joins.md)，[SQL 进阶](08-sql-advanced.md)
