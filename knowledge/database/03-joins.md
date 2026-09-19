---
title: JOIN：表与表的连接
order: 3
tags: JOIN, INNER, LEFT, UNION, 笛卡尔积
summary: JOIN 存在的原因（范式化分散数据）与四种连接的精确语义、LEFT JOIN 条件放置位置的世纪陷阱（ON 与 WHERE 的差别）、一对多连接导致的行数膨胀、自连接与集合运算（UNION 系）、以及 join 的执行算法概览。
---

关系型数据库把数据**按范式拆散**成多张表（用户表、订单表、商品表——[第 5 篇](05-schema.md)），JOIN 是把它们**按需拼回**的语法。写对 JOIN 的关键不是背四种类型，而是理解两个机制：**匹配规则**（ON 怎么配对）与**行数变化**（连接后多少行——一对一？一对多膨胀？）。

## 1. INNER JOIN：只保留匹配的行

```sql
SELECT o.id, o.amount, u.name
FROM orders o
JOIN users u ON o.user_id = u.id;      -- INNER 可省略
```

语义：对 orders 的每一行，在 users 里**找 user_id 相等的行**拼上——没有匹配用户的订单（脏数据）与没有订单的用户**都不会出现在结果里**。

维度关系决定结果行数（比类型更重要的概念）：

| 关系             | INNER JOIN 结果行数                     |
| ---------------- | --------------------------------------- |
| 一对一           | 等于主表行数                             |
| **一对多**       | 等于**多侧行数**（每个订单一行，用户重复出现）|
| 多对多（经桥表） | 两次 JOIN：桥表行数                       |

「JOIN 后行数暴增」的排查起点就是维度关系：明细表 join 维度表 → 行数 = 明细行数（正常）；两个明细表直接 join → 行数 = 笛卡尔积量级（错误设计）。

## 2. LEFT JOIN：主表全保，缺则补 NULL

```sql
-- 所有用户 + 他们的订单数（没有订单的用户也要出现！）
SELECT u.id, u.name, COUNT(o.id) AS orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id;
```

LEFT JOIN 语义：**左表全保**，右表没匹配的行补 NULL——「没有订单的用户 orders 计数为 0」（COUNT(o.id) 数非 NULL，正确得 0；用 COUNT(*) 会数成 1）。

### 2.1 世纪陷阱：右表条件放 WHERE 会吃掉 LEFT 语义

```sql
-- 意图：所有用户 + 他们 9 月的订单（没订单的用户也要在）
-- ❌ 错误写法：
SELECT u.name, o.amount
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.created_at >= '2026-09-01';     -- NULL 行的 o.created_at 是 NULL → 过滤掉！
-- LEFT JOIN 退化成 INNER JOIN：没订单的用户消失了

-- ✅ 正确写法一：条件进 ON
LEFT JOIN orders o
    ON o.user_id = u.id AND o.created_at >= '2026-09-01';

-- ✅ 正确写法二：条件允许 NULL（显式表达意图）
WHERE o.created_at >= '2026-09-01' OR o.id IS NULL
```

**ON 是「匹配规则」（决定怎么拼），WHERE 是「结果过滤」（决定留下谁）**——对 LEFT JOIN，右表条件放 ON 才能保住「补 NULL 的行为」。这条规则是 JOIN 的第一大面试题与事故源。

## 3. RIGHT/FULL 与自连接

```sql
RIGHT JOIN  -- 右表全保（= 交换左右位置的 LEFT JOIN；可读性差，习惯上重排成 LEFT）
FULL JOIN   -- 两边都全保（PG 支持；MySQL 用 UNION 模拟）

-- 自连接：同一张表当两个角色用（员工-经理）
SELECT e.name AS employee, m.name AS manager
FROM employees e
LEFT JOIN employees m ON e.manager_id = m.id;
```

自连接是「表内关系」的标准形态（组织架构、分类树、评论回复）。配套语法还有 `USING(col)`（同名列连接的简写）与 `NATURAL JOIN`（按全部同名列自动连接——**禁止使用**，列名变化即静默改变连接语义）。

## 4. 笛卡尔积：CROSS JOIN 与忘写 ON

```sql
SELECT * FROM a, b;                -- 旧语法：忘了 WHERE 条件 = 笛卡尔积！
SELECT * FROM a CROSS JOIN b;      -- 显式笛卡尔积（1000 行 × 1000 行 = 100 万行）
```

「忘了 ON」产生的意外笛卡尔积是性能事故的经典来源——排查方法：`EXPLAIN` 看执行计划里的 Nested Loop 无索引匹配（[第 6 篇](06-index.md)）。显式 CROSS JOIN 的正当用途：生成组合（尺寸×颜色的 SKU 表）。

## 5. 集合运算：UNION 家族

```sql
-- 列结构相同的两批结果合并
SELECT id, name FROM users_2025
UNION                              -- 去重（排序去重的代价）
SELECT id, name FROM users_2026;

UNION ALL                          -- 不去重：快，日志/分区表合并的默认选择
INTERSECT / EXCEPT                 -- 交集 / 差集（EXCEPT = 「在 A 不在 B」）
```

UNION 与 JOIN 是两种组合：**UNION 纵向堆行**（同构数据合并），**JOIN 横向拼列**（关联数据拼接）——「数据分散在两张同构表」用 UNION，「一行业务事实横跨多表」用 JOIN。

## 6. JOIN 的执行算法：优化器在做什么

数据库执行 JOIN 的三种算法（理解它们，才知道索引为什么重要）：

| 算法              | 机制                                     | 适用                          |
| ----------------- | ---------------------------------------- | ----------------------------- |
| Nested Loop       | 外表每行去内表找匹配                       | 内表连接键有索引：O(n·log m)   |
| Hash Join         | 小表建哈希表，大表逐行探测                 | 无索引的大表等值连接            |
| Sort-Merge Join   | 两表按连接键排序后归并                     | 已排序数据/大结果集             |

「连接键必须有索引」的机制解释：没有索引的 Nested Loop 是 O(n·m) 全表扫描——10 万行 join 10 万行 = 百亿次比较。EXPLAIN 输出里的 `Nested Loop` + `Index Scan` 是健康形态，`Seq Scan` 堆叠是警报（[第 6 篇](06-index.md)展开）。

## 7. 陷阱清单

- 右表条件放 WHERE 吃掉 LEFT 语义：条件进 ON 或显式 OR IS NULL。
- LEFT JOIN 后 COUNT(*) 数出 1：数匹配列 COUNT(o.id)；聚合与 NULL 的交互（[第 4 篇](04-aggregation.md)）。
- 一对多 JOIN 后求和翻倍（订单 join 订单项后 SUM(amount)）：先子查询聚合再 join，或 DISTINCT 语义核对。
- 用 NATURAL JOIN/SELECT * 的 join：列名耦合；显式 ON + 显式列。
- 大表 join 无索引键：O(n·m)；EXPLAIN 检查。
- UNION（去重）当 UNION ALL 用：无谓的排序去重开销。
- 多表 JOIN 链超过 4-5 张：优化器难度与可读性陡增；拆 CTE（[第 4 篇](04-aggregation.md)）。

## 8. 小结

- JOIN 的两个思考轴：**匹配规则**（ON）与**维度关系**（一对一/一对多决定行数）——行数暴增的排查从维度关系开始。
- LEFT JOIN 的第一陷阱：右表条件进 WHERE 退化为 INNER——「ON 管匹配、WHERE 管过滤」的分工要刻死。
- LEFT JOIN + COUNT(col) 是「保留零计数」的标准组合；自连接解决表内关系；CROSS JOIN 是组合生成器与「忘 ON」的事故形态。
- UNION 纵向堆行（ALL 不去重）、JOIN 横向拼列——两种「组合」的分工。
- 三种执行算法（nested loop/hash/merge）解释了「连接键要索引」与优化器行为——EXPLAIN 是 JOIN 性能的对话工具。

## 9. 练习

**1.** 用 users/orders 两表分别演示：一对多 JOIN 的行数膨胀、LEFT JOIN 保留零订单用户、COUNT(o.id) 与 COUNT(*) 的差异——三个实验一张表记录。

> [!TIP]
> 思路造 3 用户（1 人无订单）+ 5 订单：INNER JOIN 5 行、LEFT JOIN 6 行、COUNT(o.id) 得 1/2/2/0、COUNT(*) 得 2/3/3/1——0 用户被数错的现场。

**2.** 修复「用户 + 9 月订单」查询的三种写法（WHERE 错版、条件进 ON、OR IS NULL），用 EXPLAIN 对比执行计划并解释差异。

> [!TIP]
> 思路条件进 ON 时优化器可以在 join 前先过滤 orders（先窄后宽）；OR IS NULL 的版本通常更慢且意图模糊——推荐 ON 版。执行计划的差异是「写法影响性能」的直接证据。

**3.** 一个报表查询「每个分类的商品数与库存总量」在 join 明细表后数字翻倍——定位原因（一对多双重 join）并用「先聚合后 join」修复。

> [!TIP]
> 思路category join products 再 join 明细 = 明细行重复计入 category 汇总。修法：子查询/CTE 先按商品聚合，再 join 商品与分类。「先聚后连」是报表 SQL 的黄金模式。

**4.** 用自连接实现「找出所有经理下属超过 3 人的经理」；再实现「评论表的两级回复查询」（评论+回复列表）。

> [!TIP]
> 思路自连接 + GROUP BY + HAVING；两级回复 = 评论 LEFT JOIN 回复（回复的 parent_id 指向评论）。递归树（无限层级）需要递归 CTE（[第 4 篇](04-aggregation.md)）。

**5.** 对比 UNION 与 UNION ALL 在 100 万行合并时的 EXPLAIN 差异；找出两个表数据「有交集」时 UNION 的去重行为——总结两者的使用判据。

> [!TIP]
> 思路UNION 多一步 Sort/Deduplicate（代价大）；确认无重复或需要保留重复 → UNION ALL。「去重是需求还是保险」要显式回答。

**6.** 讨论：为什么 SQL 的 JOIN 在应用代码里常被「劝退」（拆成多次查询在应用层拼接）？从「N+1 查询」[（第 10 篇）](10-orm-access.md)、网络往返、数据库专注三角度分析 JOIN 与应用层拼接的取舍，并给出你的默认策略。

> [!TIP]
> 思路JOIN 让数据库做它擅长的事（一次往返、优化器参与）；应用层拼接带来 N+1 与一致性复杂度。默认策略：聚合/关联查询用 JOIN（配合索引），写操作与复杂业务规则放应用层——「数据访问在库、业务逻辑在应用」的分层。
