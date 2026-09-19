---
title: 聚合、分组与窗口函数
order: 4
tags: GROUP BY, HAVING, 子查询, CTE, 窗口函数
summary: 聚合函数的 NULL 规则与 FILTER、GROUP BY 的分组语义与「只查分组列」规则、HAVING 与 WHERE 的层次差异、子查询三种形态与 EXISTS、CTE 与递归查询、以及窗口函数对 GROUP BY 的超越（保行聚合）。
---

聚合是把「行」压成「统计值」的过程；GROUP BY 决定「按什么分桶」；窗口函数则是聚合的第三种形态——**不压行、在行旁边附上统计**。本篇沿着「聚合 → 分组 → 子查询 → CTE → 窗口」的演进线走完 SQL 的分析能力。

## 1. 聚合函数：把多行变一个值

```sql
COUNT(*)               -- 行数（含 NULL 行）
COUNT(col)             -- 非 NULL 的行数 ⚠️ 与 COUNT(*) 不同
COUNT(DISTINCT col)    -- 去重计数
SUM(amount)            -- 求和（无行时 NULL，不是 0！）
AVG(amount)            -- 平均（NULL 不参与）
MIN/MAX(price)         -- 极值（可用于日期/字符串）

-- PG 的 FILTER：条件聚合的优雅形态
COUNT(*) FILTER (WHERE status = 'paid')      AS paid_count,
SUM(amount) FILTER (WHERE status = 'paid')   AS paid_amount
-- 通用写法：SUM(CASE WHEN status='paid' THEN amount END)
```

NULL 的三条聚合规则（[第 2 篇](02-sql-select.md)三值逻辑的延续）：**COUNT(col) 跳过 NULL、SUM/AVG/MIN/MAX 跳过 NULL、全 NULL 或空集时 SUM/AVG 返回 NULL**（不是 0——需要 0 用 `COALESCE(SUM(x), 0)`）。LEFT JOIN 后 COUNT(*) 数出 1 的经典事故就是这里：**计数「某事物的量」永远用 COUNT(具体列) 或 COUNT(*) FILTER**。

## 2. GROUP BY：分桶

```sql
SELECT category, COUNT(*) AS cnt, AVG(price) AS avg_price
FROM products
GROUP BY category;                    -- 每个类目一行
```

分组的核心规则：**SELECT 里的每一列要么在 GROUP BY 里、要么被聚合函数包裹**——否则数据库不知道「组内多行的 name 取哪个」（PG 直接报错；MySQL 旧版随机取一个 + `ONLY_FULL_GROUP_BY` 关闭时静默——**静默取错值是事故**，升级 MySQL 后大量老查询报错的原因就在此）。

```sql
-- HAVING：组级过滤（WHERE 过滤原始行、HAVING 过滤聚合后的组）
SELECT category, COUNT(*) AS cnt
FROM products
WHERE status = 'active'               -- ① 先滤行（可以走索引！）
GROUP BY category
HAVING COUNT(*) >= 10;                -- ② 再滤组（聚合结果，索引无用）
```

WHERE 与 HAVING 的分工由执行序决定（[第 2 篇](02-sql-select.md)）：**能放 WHERE 的条件绝不放 HAVING**（更早过滤 = 更少数据参与聚合 = 快）。

## 3. 子查询：查询里的查询

```sql
-- ① 标量子查询：结果当值用
SELECT name, price,
       (SELECT AVG(price) FROM products) AS market_avg
FROM products;

-- ② IN/EXISTS：集合成员判断
SELECT * FROM users u
WHERE EXISTS (SELECT 1 FROM orders o
              WHERE o.user_id = u.id AND o.amount > 1000);
              -- EXISTS 短路：找到一行就停（比 IN 大子查询稳，NULL 免疫 [第 2 篇](02-sql-select.md)）

-- ③ 派生表：子查询当临时表
SELECT c.category, c.cnt
FROM (SELECT category, COUNT(*) AS cnt FROM products GROUP BY category) c
WHERE c.cnt > 100;
```

「EXISTS vs IN」的选择：**外表小内表大 → IN（内表建好一次）；外表大 → EXISTS（外表逐行探测+索引）**；含 NULL 场景一律 EXISTS/NOT EXISTS。派生表的现代替代是 CTE——大多数场景 CTE 可读性碾压嵌套。

## 4. CTE：WITH 的可读性与递归

```sql
WITH monthly AS (
    SELECT date_trunc('month', created_at) AS m, SUM(amount) AS revenue
    FROM orders GROUP BY 1
),
avg_rev AS (
    SELECT AVG(revenue) AS avg_m FROM monthly
)
SELECT m.m, m.revenue, avg_m
FROM monthly m CROSS JOIN avg_rev
WHERE m.revenue > avg_m.avg_m;          -- 高于月均的月份
```

CTE 把查询拆成**命名的步骤**——从上到下读，每步一个意图（与 dplyr 管道、[git 历史的线性叙述](../git/02-daily-workflow.md)同构的可读性）。注意：PG 12 前 CTE 是「优化栅栏」（物化不内联）——老版本的大 CTE 有性能陷阱，现代版本已自动内联（`MATERIALIZED` 关键字可控制）。

### 4.1 递归 CTE：树与图的遍历

```sql
-- 遍历组织架构树（从某个节点向下）
WITH RECURSIVE tree AS (
    SELECT id, name, manager_id, 1 AS depth
    FROM employees WHERE id = 100          -- 起点
    UNION ALL
    SELECT e.id, e.name, e.manager_id, t.depth + 1
    FROM employees e JOIN tree t ON e.manager_id = t.id
)
SELECT * FROM tree ORDER BY depth;        -- 整棵子树（含深度）
```

`UNION ALL` + 自引用是递归 CTE 的固定结构：起点（锚）+ 递归步。它的应用面：分类树、评论楼、权限继承、图遍历——**SQL 内完成递归**而不必拉到应用层循环查询（N+1 的递归版，[第 10 篇](10-orm-access.md)）。

## 5. 窗口函数：不折叠的聚合

GROUP BY 把多行压成一行；**窗口函数保留每一行、在旁边附上组内统计**——这是它与 GROUP BY 的本质区别：

```sql
SELECT name, category, price,
       RANK()       OVER (PARTITION BY category ORDER BY price DESC) AS rank_in_cat,
       ROUND(price - AVG(price) OVER (PARTITION BY category), 2) AS vs_cat_avg,
       SUM(amount)  OVER (ORDER BY created_at)                    AS running_total,   -- 累计
       LAG(price)   OVER (ORDER BY created_at)                    AS prev_price       -- 前一行
FROM products;
```

| 函数                  | 用途                       | 典型问题                     |
| --------------------- | -------------------------- | ---------------------------- |
| `ROW_NUMBER()`        | 组内唯一序号               | 分组取 Top-N（每类前 3 名）   |
| `RANK()/DENSE_RANK()` | 并列排名（两种并列策略）    | 排行榜                       |
| `LAG()/LEAD()`        | 前/后一行的值               | 环比、留存计算                |
| `SUM() OVER`          | 组内累计/移动               | 累计求和、滑动平均             |
| `NTILE(n)`            | 均分 n 组                   | 四分位分桶                    |

「每类取前 3」是窗口函数的招牌题：

```sql
SELECT * FROM (
    SELECT name, category, price,
           ROW_NUMBER() OVER (PARTITION BY category ORDER BY price DESC) AS rn
    FROM products
) t WHERE rn <= 3;
```

GROUP BY 做不到这件事（聚合后丢掉了行内其他列的对应关系）——窗口函数补上了 SQL 表达力的最后一块。执行序在 GROUP/HAVING 之后、ORDER 之前（ORDER BY over 输出仍可再排序）。

## 6. 陷阱清单

- COUNT(*) 当 COUNT(col) 用（LEFT JOIN 零计数场景）：数对列。
- SUM 空集得 NULL：COALESCE 包一层。
- SELECT 非分组列（MySQL 旧版静默随机）：ONLY_FULL_GROUP_BY 开着；升宽语义用聚合或窗口。
- 条件写进 HAVING 而不是 WHERE：丢失索引机会；先滤行后滤组。
- IN 大子查询/含 NULL：EXISTS + 索引。
- 递归 CTE 无终止保护（环状数据死循环）：depth 上限或 visited 检查。
- 窗口函数的 ORDER BY 与外层排序混淆：OVER 内的排序只服务窗口计算。

## 7. 小结

- 聚合三规则：COUNT(col) 跳 NULL、空集聚合给 NULL（COALESCE 兜底）、FILTER/条件聚合做一次扫描多指标。
- GROUP BY 的「列要么分组要么聚合」+ HAVING 滤组；条件能进 WHERE 不进 HAVING（更早过滤）。
- 子查询三种形态与 EXISTS 的稳健性；CTE 的可读性价值与递归能力（树的 SQL 内遍历）。
- 窗口函数 = 不折叠的聚合：排名/LAG/累计三大族 + PARTITION BY 分组——「每类 Top-N」等 GROUP BY 无解的问题在此解决。
- SQL 的分析表达力至此完整：从行过滤到组聚合到窗口分析——复杂报表不再必须拉到应用层。

## 8. 练习

**1.** 对 orders 表写一条查询同时输出：总单数、已支付单数、已支付金额、平均客单（已支付口径）——分别用 CASE 与 FILTER 两种写法。

> [!TIP]
> 思路FILTER 是 PG 语法糖；通用 CASE 写法在 MySQL 同样工作。「一次扫描多指标」与多次查询的性能差在大表上可达数倍。

**2.** 用窗口函数实现「每个类目价格前 3 的商品及其与类目均价的差」——一次查询完成（提示：两个窗口函数叠加）。

> [!TIP]
> 思路ROW_NUMBER 取前 3 + AVG OVER 求差：两个窗口在同一 SELECT 并存（执行互不干扰）。用 GROUP BY 需要两层子查询——对比可读性。

**3.** 用递归 CTE 遍历评论树（comments: id, parent_id, content）：给定根评论输出整棵子树（带缩进深度），并加「深度超过 10 强制终止」的防环保护。

> [!TIP]
> 思路锚（parent_id IS NULL 或指定根）+ 递归步（JOIN parent）+ depth 上限条件。递归 CTE 的终止性检查是生产必配——环状数据会让它无限循环。

**4.** 写「环比增长」查询：每月销售额与上月环比（LAG），输出月份、销售额、增长率百分比。注意首月 LAG 为 NULL 的处理。

> [!TIP]
> 思路`LAG(revenue) OVER (ORDER BY m)` 取上月 → 增长率 = (cur-prev)/prev，首月 NULL 用 CASE 或 COALESCE 标注。LAG 是时序环比的标准件。

**5.** 把一个 5 层嵌套的子查询改写成平铺 CTE 链（每步命名），对比两者的可读性与（PG 12+）执行计划是否一致。

> [!TIP]
> 思路嵌套子查询的可读性随深度指数下降；CTE 的线性结构让每步可单独验证。EXPLAIN 对比验证「改写不改性能」——重构的底线。

**6.** 讨论：窗口函数与「GROUP BY + 自 JOIN 回原表」的等价改写——后者为什么曾是唯一解、窗口函数解决了什么表达力瓶颈？从「聚合结果与明细行的关联」角度分析 SQL 标准引入窗口函数（1999→2003）的动机。

> [!TIP]
> 思路旧行法：先 GROUP BY 出组级统计 → JOIN 回明细——两步、可读性差、优化器难优化。窗口函数把「组上下文」变成行属性——声明式语言对「分析性需求」的又一次语法捕获。
