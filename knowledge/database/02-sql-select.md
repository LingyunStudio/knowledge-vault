---
title: SELECT：查询的完整语法
order: 2
tags: SELECT, WHERE, NULL, LIMIT, CASE
summary: SELECT 的书写与执行顺序、WHERE 的完整条件语法（IN/BETWEEN/LIKE 与通配符陷阱）、NULL 的三值逻辑（=NULL 不成立）、排序分页与 DISTINCT、CASE 表达式，以及 UPDATE/DELETE 的 WHERE 纪律。
---

SELECT 是 SQL 里使用频率 90% 的部分。它的语法表面简单，但有两个「深水区」：**执行顺序**（书写顺序 ≠ 执行顺序）与 **NULL 语义**（三值逻辑）。掌握这两点，SQL 查询就从「套模板」变成「可推导」。

## 1. 书写顺序与执行顺序

```sql
SELECT name, price * 0.9 AS discounted      -- 5. SELECT：投影与表达式
FROM products                                -- 1. FROM：数据来源
WHERE price > 100                            -- 2. WHERE：行级过滤
ORDER BY discounted DESC                     -- 7. ORDER：排序
LIMIT 10;                                    -- 8. LIMIT：截取
```

执行顺序：**FROM → WHERE → SELECT（投影）→ ORDER → LIMIT**（含 JOIN/GROUP 的完整序在[第 4 篇](04-aggregation.md)）。这个顺序直接解释三个高频疑问：

- `WHERE` 里**不能用 SELECT 的别名**（投影发生在 WHERE 之后）——`WHERE discounted > 50` 报错；要复用复杂表达式就重写一遍或用子查询/CTE。
- `ORDER BY` **可以**用别名（排序在投影之后）。
- `LIMIT` 在排序后生效——没有 ORDER BY 的 LIMIT 结果是「任意 N 行」（无序集合，别当「前 N 个」用）。

## 2. WHERE：条件的完整语法

```sql
-- 比较与逻辑
WHERE price >= 100 AND stock > 0
WHERE category = 'book' OR category = 'toy'
WHERE NOT (status = 'cancelled')

-- IN：多值等值（比多个 OR 干净）
WHERE status IN ('pending', 'paid', 'shipped')

-- BETWEEN：闭区间（含两端！）
WHERE created_at BETWEEN '2026-09-01' AND '2026-09-30'   -- ⚠️ 日期上界要小心（见下）

-- LIKE：模式匹配（SQL 通配符：% 任意串、_ 单字符）
WHERE name LIKE '张%'          -- 张开头
WHERE email LIKE '%@gmail.com' -- 后缀
WHERE phone LIKE '138____'     -- 138 后恰好四位

-- IS NULL：判空（唯一的正确姿势）
WHERE deleted_at IS NULL
```

三个高频陷阱：

1. **LIKE 的通配符不是正则**：`%`/`_` 之外不支持 `\d`、`+` 等——需要正则用 `REGEXP`（MySQL）或 `~`（PostgreSQL）。**别把正则习惯带进 LIKE**。
2. **BETWEEN 的日期上界**：`BETWEEN '2026-09-30'` 只覆盖到 9 月 30 日 **00:00:00**（timestamp 类型）——「查整个 9 月」应该写 `>= '2026-09-01' AND < '2026-10-01'`（半开区间，与 [C 篇](../c/05-arrays-strings.md)的 `i < n` 纪律同源）。
3. **隐式类型转换**：`WHERE phone = 13800138000`（phone 是 varchar）——数字与字符串比较触发转换，索引失效 + 静默错配；**比较双方类型必须一致**（[C 篇](../c/02-types.md)类型纪律的 SQL 版）。

## 3. NULL：三值逻辑的深水区

NULL 的语义是「**未知/不存在**」，它让布尔逻辑从两值变成三值（TRUE/FALSE/UNKNOWN）：

```sql
SELECT * FROM users WHERE age > 18;      -- age 为 NULL 的行：不返回（UNKNOWN ≠ TRUE）
SELECT * FROM users WHERE NOT (age > 18); -- 同样不返回 NULL 行！（UNKNOWN 的 NOT 还是 UNKNOWN）
```

核心规则与事故：

```sql
NULL = NULL          -- 结果是 NULL（不是 TRUE！两个未知不能断言相等）
age = NULL           -- 永远不命中 —— 判空必须 IS NULL / IS NOT NULL
NULL + 1             -- NULL：算术传染
COUNT(*) vs COUNT(age)   -- 前者数全部行，后者跳过 NULL（聚合的 NULL 规则见第 4 篇）
IN 与 NULL           -- x NOT IN (1, 2, NULL) 的坑：含 NULL 的 NOT IN 永远不返回行！
```

`NOT IN` 遇 NULL 的行为值得单独刻住：子查询里若有一个 NULL，`x NOT IN (子查询)` 对**所有行**返回空——因为 `x != NULL` 是 UNKNOWN，整个 IN 表达式无法为 TRUE。工程纪律：**子查询里先滤 NULL 或改用 NOT EXISTS**。

NULL 的设计立场：**列能 NOT NULL 就 NOT NULL**（[第 1 篇](01-db-model.md)的约束哲学）——NULL 越少，查询逻辑越简单。需要「默认值」时用 DEFAULT 而不是容忍 NULL。

## 4. 排序、分页与去重

```sql
SELECT * FROM products
ORDER BY category ASC, price DESC        -- 多级：先类目内再价格降
ORDER BY price DESC NULLS LAST;          -- NULL 的排序位置（PG 语法；MySQL 用 ISNULL 辅助）

SELECT DISTINCT category FROM products;  -- 去重（对多列是「组合去重」）

-- 分页：LIMIT/OFFSET 的性能问题
SELECT * FROM products ORDER BY id LIMIT 20 OFFSET 100000;
-- ⚠️ OFFSET 10 万 = 先取 10 万零 20 行再丢弃！深分页用「游标分页」：
SELECT * FROM products WHERE id > 100000 ORDER BY id LIMIT 20;   -- 上次最后一行的 id 做游标
```

游标分页（keyset pagination）是深分页的唯一正解：O(1) 定位 vs OFFSET 的 O(n) 丢弃；代价是只能按单调键（id/时间）翻页、不能跳页——「跳页」的需求用 LIMIT/OFFSET 承受其成本。

## 5. CASE 表达式：行内的分支逻辑

```sql
SELECT name, price,
    CASE
        WHEN price >= 1000 THEN 'premium'
        WHEN price >= 100 THEN 'standard'
        ELSE 'basic'
    END AS tier,
    CASE WHEN stock = 0 THEN 1 ELSE 0 END AS out_of_stock   -- 布尔转可排序标志
FROM products;
```

CASE 在**表达式可以出现的任何地方**工作（SELECT/WHERE/ORDER BY/GROUP BY）——「按条件改标签」「条件聚合」（配合 [GROUP BY](04-aggregation.md)：`SUM(CASE WHEN status='paid' THEN amount END)`) 的瑞士军刀。注意 `ELSE` 缺省是 NULL——统计场景显式写 `ELSE 0`。

## 6. 写入操作：UPDATE/DELETE 的 WHERE 纪律

```sql
INSERT INTO products (name, price) VALUES ('widget', 9.99), ('gadget', 19.99);

UPDATE products SET price = price * 1.1 WHERE category = 'book';
DELETE FROM orders WHERE status = 'cancelled' AND created_at < '2020-01-01';
```

UPDATE/DELETE 的第一纪律：**先 SELECT 后执行**——把 WHERE 条件先跑一遍 SELECT 确认影响行，再原样换语句。生产事故的常青款是「忘记 WHERE 的全表 UPDATE」（**用事务包裹**：BEGIN → UPDATE → 确认行数 → COMMIT/ROLLBACK，[第 7 篇](07-transactions.md)）。

## 7. 陷阱清单

- WHERE 里用 SELECT 别名：执行序不允许；重写表达式或用 CTE。
- BETWEEN 时间上界：半开区间写法（>= 起点 AND < 终点+1）。
- `= NULL`：永远不命中；IS NULL 是唯一姿势；NOT IN 含 NULL 全空。
- LIKE 当正则用：%/_ 是通配符；正则走方言函数。
- 隐式类型转换毁索引：比较双方类型一致。
- 无 ORDER BY 的 LIMIT：结果行不确定；分页必须带确定排序。
- OFFSET 深分页：游标分页替代。
- UPDATE/DELETE 不开事务先试 SELECT：生产操作的两步纪律。

## 8. 小结

- SELECT 的执行序（FROM→WHERE→SELECT→ORDER→LIMIT）推导出别名可用性、LIMIT 语义等一切细节——「执行序」是 SQL 语法的总纲。
- WHERE 的条件工具箱：IN/BETWEEN/LIKE/IS NULL；三个坑（LIKE 非正则、BETWEEN 上界、隐式转换）。
- NULL 是三值逻辑：=NULL 永不命中、NOT IN 含 NULL 全空、聚合跳 NULL——「能 NOT NULL 就 NOT NULL」是治本。
- 分页：OFFSET 的 O(n) 丢弃 → 游标分页是深分页正解；排序必须有确定键。
- CASE 是行内分支的瑞士军刀；UPDATE/DELETE 遵守「先 SELECT 后执行、事务包裹」的纪律。

## 9. 练习

**1.** 不运行数据库，写出以下查询的执行顺序编号与每步后的行数变化（给定 1 万行表）：

```sql
SELECT status, COUNT(*) FROM orders
WHERE created_at > '2026-01-01'
GROUP BY status HAVING COUNT(*) > 100
ORDER BY COUNT(*) DESC LIMIT 5;
```

> [!TIP]
> 思路执行序：FROM→WHERE（时间过滤）→GROUP BY→HAVING（组级过滤）→SELECT 投影→ORDER→LIMIT。执行序是 GROUP BY 语法的心智底座（[第 4 篇](04-aggregation.md)展开）。

**2.** 找出下面查询的三个问题并修正：「查 2026 年 9 月的全部订单」`WHERE date BETWEEN '2026-09-01' AND '2026-09-30'`。

> [!TIP]
> 思路①timestamp 时 9-30 只到零点；②date 列若带时间同病；③修法半开区间 `< '2026-10-01'`。附带检查：date 列有没有索引（时间过滤的高频查询）。

**3.** 解释 `SELECT * FROM t WHERE col NOT IN (SELECT val FROM s)` 在 s 含 NULL 时的行为，并用 NOT EXISTS 改写。

> [!TIP]
> 思路s 里有 NULL → 每行的 NOT IN 结果是 UNKNOWN → 空结果。NOT EXISTS 相关子查询对 NULL 天然免疫——「NOT IN 是 SQL 经典地雷」的完整机制。

**4.** 写一个「条件聚合」查询：一次扫描 orders 表，同时输出「已支付金额、已退款金额、取消单数」三列（不写三条查询）。

> [!TIP]
> 思路`SUM(CASE WHEN status='paid' THEN amount END) AS paid_amount, ...` 与 `COUNT(*) FILTER (WHERE ...)`（PG 扩展）两种写法。一次扫描多指标是报表查询的性能常识。

**5.** 对比两种分页在 100 万行表上的行为：LIMIT 20 OFFSET 999980 与游标分页（WHERE id > X LIMIT 20）——用 EXPLAIN（[第 6 篇](06-index.md)预告）或理论分析代价差。

> [!TIP]
> 思路OFFSET 需要扫过并丢弃近百万行；游标用索引直接定位——O(n) vs O(log n)。「跳页 UI」与「深翻页」的产品决策因此关联到数据库实现。

**6.** 讨论：为什么 SQL 选择「NULL=UNKNOWN」的三值逻辑而不是「NULL 当 false/0 处理」？从「缺失信息不能参与断言」的语义出发，对比 [R 的 NA 传染](../r/02-vectors.md)与 [python 的 None]——三种语言的缺失语义设计差异与各自的代价。

> [!TIP]
> 思路SQL/R 的传染模型保证「未知不产生虚假结论」（统计正确性优先）；Python 的 None 靠显式检查。SQL 的代价是三值逻辑的学习曲线与 NULL 陷阱——「正确性模型」与「易用性」的又一组权衡。
