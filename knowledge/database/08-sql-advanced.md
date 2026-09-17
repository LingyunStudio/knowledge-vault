---
title: SQL 进阶
order: 8
tags: 进阶, 窗口函数, CTE
summary: 窗口函数 OVER/PARTITION、递归 CTE、EXPLAIN 看执行计划。
---

GROUP BY 聚合后行被折叠，窗口函数给出第三种可能：**算聚合，但不折叠行**。加上递归 CTE 和执行计划分析，SQL 就从"查数"升级成"分析与调优"。本章示例以 PostgreSQL 语法为主，MySQL 8.0+ 与 SQLite 3.25+ 同样适用。

## 窗口函数：聚合但不折叠

```sql
SELECT name, dept, salary,
       AVG(salary) OVER (PARTITION BY dept) AS dept_avg   -- 每行都带上本部门均值
FROM employees;
```

与 GROUP BY 的区别一眼可见：结果还是每人一行，只是多了一列"本部门平均"——**原始明细保留，聚合作为附加列**。想做"高于本部门均值的人"这类判断，套一层子查询过滤即可，GROUP BY 做不到（组里的人没了）。

OVER 里两个部件各管一件事：

- `PARTITION BY dept`：按部门切分区，窗口在区内计算
- `ORDER BY ...`：区内再排序，定义"从区首到当前行"的框架——跑动聚合全靠它

```sql
SELECT date, amount,
       SUM(amount) OVER (ORDER BY date) AS running_total  -- 按日期累计到当天的总和
FROM daily_sales;
```

不加 PARTITION BY 时整张结果集是一个大窗口；加了 ORDER BY 不写上下界时，默认框架是"区首到当前行"——所以上面是累计值而不是全表总和，这是最容易想错的地方。框架也能显式指定，移动平均就是一个参数的事：

```sql
SELECT date, amount,
       AVG(amount) OVER (
           ORDER BY date
           ROWS BETWEEN 2 PRECEDING AND CURRENT ROW    -- 当天 + 前两天：三日移动平均
       ) AS ma3
FROM daily_sales;
```

## 排名与每组前 N

```sql
SELECT * FROM (
    SELECT name, dept, salary,
           ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) AS rn
    FROM employees
) ranked
WHERE rn <= 2;      -- 每个部门薪水前 2 名
```

"每组取前 N"是窗口函数最经典的应用，老版本数据库要靠相关子查询模仿，又慢又难读。三个排名函数的差别在并列时：`ROW_NUMBER` 硬排 1、2、3；`RANK` 并列同名次、随后跳号（1、2、2、4）；`DENSE_RANK` 并列但不跳号（1、2、2、3）。取"前 N 名"用 ROW_NUMBER，展示排行榜用 DENSE_RANK。

相邻行对比用 `LAG` / `LEAD`，环比、留存这类指标直接写：

```sql
SELECT date, amount,
       LAG(amount) OVER (ORDER BY date) AS prev_amount,           -- 上一天的值
       amount - LAG(amount) OVER (ORDER BY date) AS day_change    -- 环比变化
FROM daily_sales;
```

同族函数还有 `FIRST_VALUE` / `LAST_VALUE`（区内第一个/最后一个值）和 `NTILE(n)`（把区内行均分成 n 桶，做"前 25%"分段统计用）。

> [!NOTE]
> 窗口函数已是各家标配：PostgreSQL 全系支持，MySQL 8.0+、SQLite 3.25+ 支持，MySQL 5.7 和更老的 SQLite 写不了，只能子查询硬凑。项目还卡在旧版本上时，升级往往比写兼容代码便宜。

## 递归 CTE：SQL 里的循环

组织架构树、目录树、图遍历——"不知道有多少层"的数据，普通 JOIN 写不出来，递归 CTE 专治这个：

```sql
WITH RECURSIVE subordinates AS (
    SELECT id, name, manager_id, 1 AS depth
    FROM employees
    WHERE id = 1                          -- 锚点：递归的起点（CEO）

    UNION ALL

    SELECT e.id, e.name, e.manager_id, s.depth + 1
    FROM employees e
    JOIN subordinates s ON e.manager_id = s.id    -- 递归：拿上一轮结果找下一层
)
SELECT * FROM subordinates ORDER BY depth;
```

结构固定两段：锚点查询给出起点，递归部分反复引用 CTE 自己，每轮拿上一轮的输出当输入，直到某轮产出 0 行为止。SQLite、PostgreSQL、MySQL 8.0+ 全都支持。递归部分还能边走边拼路径，输出"层级面包屑"：

```sql
WITH RECURSIVE tree AS (
    SELECT id, name, name::text AS path FROM categories WHERE parent_id IS NULL
    UNION ALL
    SELECT c.id, c.name, t.path || ' > ' || c.name      -- 数码 > 手机 > 折叠屏
    FROM categories c JOIN tree t ON c.parent_id = t.id
)
SELECT * FROM tree;
```

> [!TIP]
> 递归写错会无限循环：数据里有环（A 汇报给 B、B 汇报给 A）或终止条件写反都会跑飞。调试期在递归部分加 `WHERE s.depth < 20` 这类深度上限，先保证能停，再谈正确；生产上防环则靠数据端约束（禁止自己当自己的上级）。

## EXPLAIN：看数据库打算怎么跑

查询慢，别猜，问优化器要执行计划：

```sql
EXPLAIN ANALYZE
SELECT * FROM orders WHERE user_id = 42;
-- PostgreSQL：EXPLAIN 是估算，EXPLAIN ANALYZE 真跑一遍报每步实际耗时
-- MySQL：EXPLAIN 看计划；8.0+ 也有 EXPLAIN ANALYZE
```

PostgreSQL 的文本计划里，两个数字（cost）分别是最小和最大预估成本，rows 是预估命中行数：

```text
Seq Scan on orders  (cost=0.00..35811.00 rows=1 width=68)             -- 全表扫 10 万行找 1 行
Index Scan using idx_orders_user on orders  (cost=0.29..8.31 rows=1)  -- 3~4 次页面访问直达
```

MySQL 的表格计划抓这几列：

```text
type: ref            -- 访问类型：ALL（全表扫）最差，index/range/ref 依次改善，const 最快
key:  idx_orders_user  -- 实际选用的索引；NULL = 没用索引
rows: 1                -- 预估扫描行数
Extra: Using index     -- 覆盖索引的标志；Using filesort / Using temporary 多半是坏消息
```

无论哪家，读计划先抓三件事：**扫描方式**（大表全表扫是危险信号）、**rows 估算**（与真实差一个数量级多半是统计信息过期，跑 `ANALYZE 表名` 更新）、**行数走势**（JOIN 之后行数暴涨，回头查连接键唯一性和过滤条件）。

> [!TIP]
> EXPLAIN 是估算，EXPLAIN ANALYZE 是实战——但后者真的执行语句。UPDATE/DELETE 想看计划又不想真改，包在 `BEGIN; EXPLAIN ANALYZE ...; ROLLBACK;` 里跑。

相关阅读：[SQL 查询基础](02-sql-select.md)，[索引](06-index.md)
