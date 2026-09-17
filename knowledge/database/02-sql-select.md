---
title: SQL 查询基础
order: 2
tags: 核心, SELECT, WHERE
summary: SELECT/FROM/WHERE/ORDER/LIMIT 骨架、NULL 的三值逻辑、去重与别名。
---

SQL 是声明式语言：你描述"要哪些数据"，不指挥"怎么取"。绝大多数查询长着同一副骨架——先把它和 NULL 的怪脾气搞懂，再谈花活。本章以标准 SQL 为主，方言差异单独标注。

## 样例表

后面所有示例基于这张 `products` 表，结果可以对着数：

| id | name | category | price | stock | note |
| --- | --- | --- | --- | --- | --- |
| 1 | 键盘 | 数码 | 299 | 5 | NULL |
| 2 | 铅笔 | 文具 | 2.5 | 100 | 促销品 |
| 3 | 显示器 | 数码 | 1299 | 0 | NULL |
| 4 | 笔记本 | 文具 | 8 | 50 | NULL |

## 查询骨架：书写顺序不等于执行顺序

```sql
SELECT name, price * 1.1 AS price_with_tax   -- 5. 挑列、算表达式
FROM products                                -- 1. 从哪张表
WHERE price > 100                            -- 2. 逐行过滤
ORDER BY price DESC                          -- 6. 排序
LIMIT 10;                                    -- 7. 截取前 10 行
```

书写顺序是 `SELECT → FROM → WHERE → ... → LIMIT`，执行顺序却是 `FROM → WHERE → SELECT → ORDER → LIMIT`。数据库先锁定表，按 WHERE 一行行筛，**然后**才挑列、算别名——所以 WHERE 里不能引用 SELECT 里定义的别名，执行到那里时别名还不存在。GROUP BY 和 HAVING 插在 WHERE 与 SELECT 之间执行（见[聚合与分组](04-aggregation.md)）；ORDER BY 里反而可以用别名，因为它执行得最晚。

## WHERE：行级过滤

常用条件一网打尽：

```sql
WHERE price BETWEEN 10 AND 20                  -- 闭区间，含两端
WHERE category IN ('书', '文具')                -- 集合匹配
WHERE name LIKE 'SQL%'                         -- % 任意多个字符，_ 单个字符
WHERE note IS NULL                             -- 判空只能用 IS NULL
WHERE price > 10 AND (stock > 0 OR on_sale)    -- AND 优先级高于 OR，别省括号
```

`AND` 优先级高于 `OR`，两者混用不加括号，条件组合大概率不是你以为的那个。对着样例表找找感觉：

```sql
SELECT * FROM products WHERE category = '文具';           -- 2 行：铅笔、笔记本
SELECT * FROM products WHERE stock > 0 AND price < 300;   -- 键盘、铅笔、笔记本
SELECT * FROM products WHERE note IS NOT NULL;            -- 只有铅笔
```

`LIKE '%词%'` 双侧通配在大多数引擎下用不上普通索引（前导 `%` 失效），大表上要靠全文索引或搜索引擎接手。

## NULL：三值逻辑

NULL 是 SQL 里最容易埋雷的设计。它不是 0，不是空字符串，而是"未知"。核心规则一句话：**NULL 与任何值比较（包括 NULL 和 NULL 自己比），结果都是 NULL**——不是 true，也不是 false。WHERE 只放行结果为 true 的行，于是：

```sql
-- 样例表的 note 列有 3 个 NULL、1 个 '促销品'
SELECT * FROM products WHERE note <> '促销品';   -- 返回 0 行！NULL 的比较结果全是 NULL
SELECT * FROM products WHERE note = NULL;        -- 永远 0 行：= NULL 是错误写法
SELECT * FROM products WHERE note IS NULL;       -- 3 行，判空的唯一正确姿势
```

第一行最反直觉：你以为 `<>` 会把 NULL 行"顺便"查出来，实际不会——NULL 的比较结果不为 true，直接被过滤。`IS NOT NULL` 才是补齐它的方式。

> [!WARNING]
> `NOT IN` 遇到 NULL 是著名陷阱：`x NOT IN (1, 2, NULL)` 中任何与 NULL 的比较都产生 NULL，整个条件永远不为 true，查询静默返回空集。子查询可能出 NULL 时，改用 `NOT EXISTS`。

三值逻辑的推论会一路蔓延到聚合：`COUNT(*)` 数所有行（4），`COUNT(note)` 只数 note 非 NULL 的行（1），同一张表两个数字可以不同；SUM/AVG 自动忽略 NULL，"平均值对不上"的常见根源就在这。拿不准的列直接加 `NOT NULL` 加默认值，把 NULL 从源头消灭，比在每条查询里防御它便宜得多。

## 去重与别名

```sql
SELECT DISTINCT category FROM products;           -- 数码、文具，共 2 行
SELECT DISTINCT category, brand FROM products;    -- 按"类别+品牌"组合去重

SELECT p.name, p.price * 0.9 AS discounted        -- AS 给列起别名
FROM products AS p                                -- 表别名，多表连接时必备
WHERE p.price * 0.9 > 50;                         -- 表别名在 WHERE 里可用
```

DISTINCT 作用于**所有选出列的组合**，不是挨列去重——两列组合去重的结果往往比单列多。别名规则再强调一次：WHERE 里不能用列别名（执行顺序靠前），ORDER BY、GROUP BY（多数方言）里可以。DISTINCT 还有性能暗面：去重要排序或哈希，大结果集上开销不小，能用索引天然去重的场景就别让数据库再算一遍。

## 排序与分页

```sql
ORDER BY price DESC, name ASC     -- 多列排序：价格相同再按名称升序
ORDER BY price * stock DESC       -- 按表达式排序也行
ORDER BY price DESC NULLS LAST    -- NULL 排哪边各库不同，显式声明最稳（PostgreSQL 支持）
LIMIT 10 OFFSET 20                -- 跳过 20 行取 10 行：第 3 页，每页 10 条
```

不加 ORDER BY 的查询，行的返回顺序**没有任何保证**——今天恰好按插入序返回，明天可能变。"我看到的顺序"不是承诺，分页、导出前必须显式排序，且排序列最好唯一（或加次级列凑唯一），否则同分行的页间顺序不稳定。

方言差异要留意：

| 分页写法 | 支持情况 |
| --- | --- |
| `LIMIT n OFFSET m` | PostgreSQL、MySQL、SQLite |
| `LIMIT m, n` | MySQL、SQLite（参数顺序与上面相反，易踩坑） |
| `FETCH FIRST n ROWS ONLY` | PostgreSQL、SQL 标准 |

> [!TIP]
> 深分页 `LIMIT 10 OFFSET 1000000` 要先扫过并丢弃前 100 万行，页码越深越慢。大偏移场景改用游标分页：`WHERE id > 上一页最后一个id ORDER BY id LIMIT 10`，走主键索引，任何一页都一样快。

## 改与删：同一套 WHERE，加十倍小心

UPDATE 和 DELETE 复用 WHERE 的全部语法，也继承全部 NULL 语义：

```sql
UPDATE products SET price = price * 0.9 WHERE category = '文具'
RETURNING id, name, price;      -- PostgreSQL：返回被改的行，当场核对
DELETE FROM products WHERE stock = 0 AND updated_at < '2024-01-01';
```

> [!WARNING]
> 不带 WHERE 的 UPDATE/DELETE 作用于全表。肌肉记忆：改数据的语句先当 SELECT 跑一遍确认命中范围，确认无误再改动词；或先 BEGIN，看到影响行数后 COMMIT——误操作在自动提交模式下没有撤销键。

相关阅读：[聚合与分组](04-aggregation.md)，[JOIN 连接](03-joins.md)
