---
title: JOIN 连接
order: 3
tags: 核心, JOIN, 关联
summary: INNER/LEFT/RIGHT/FULL 的方向感、防笛卡尔积、多表连接的读法。
---

范式化把订单和客户拆进了两张表，JOIN 负责在读的时候把它们按条件拼回来。JOIN 出错的高发点有两个：选错连接类型静默丢数据，忘写条件瞬间笛卡尔积爆炸。

## 样例数据

**customers**

| id | name |
| --- | --- |
| 1 | 张三 |
| 2 | 李四 |
| 3 | 王五（从没下过单） |

**orders**

| id | customer_id | amount |
| --- | --- | --- |
| 101 | 1 | 200 |
| 102 | 1 | 350 |
| 103 | 2 | 90 |
| 104 | 9 | 120 |

注意 104 号订单的 `customer_id = 9` 指向不存在的客户——脏数据在所难免，正是它让连接类型的选择变得要紧。

## 四种 JOIN：先分清"保谁"

```sql
SELECT o.id, o.amount, c.name
FROM orders o
INNER JOIN customers c ON o.customer_id = c.id;   -- ON 是连接条件
```

| 类型 | 结果 | 记忆 |
| --- | --- | --- |
| INNER JOIN | 两边都匹配得上的行 | 只要交集 |
| LEFT JOIN | 左表全部 + 右表补 NULL | 保左表 |
| RIGHT JOIN | 右表全部 + 左表补 NULL | 保右表 |
| FULL OUTER JOIN | 两边全部，缺的互相补 NULL | 两边都保 |

方向感：**LEFT JOIN 的"左"就是 FROM 后面那张表**。对着样例数据看四种写法的行数：

```sql
-- INNER JOIN：3 行。104 被静默丢弃（客户 9 不存在）；张三出现两次（101、102 都匹配）
-- LEFT JOIN（orders 在左）：4 行。104 保留，c.name 为 NULL；王五不出现在结果里
-- FULL OUTER JOIN：5 行。104 保留补 NULL，王五也保留（o.id 为 NULL）
```

INNER 丢行是静默的——语法没错、结果看起来正常，只是少了几行，往往要等对账才发现。**主表有"可能没有从表数据"的合法状态（未支付、未填写资料）时，用 LEFT；确定必须成对存在时，INNER 还能把不匹配的脏数据一并筛掉，两派都有正当用途，关键是有意识地去选。**

> [!NOTE]
> RIGHT JOIN 几乎没人写：`a RIGHT JOIN b` 完全等价于 `b LEFT JOIN a`，调换表序就能改成 LEFT。主流代码风格约定只用 LEFT，省掉读代码时的方向脑补。SQLite 直到 2022 年的 3.39 才支持 RIGHT/FULL，也从侧面说明它不常用。

## LEFT JOIN 的经典套路：查"没有匹配的"

"找出从没下过单的客户"——把 INNER 的思路反过来不行，要用 LEFT JOIN + NULL 判断：

```sql
SELECT c.id, c.name
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.id IS NULL;        -- 右表列全为 NULL → 没有匹配 → 从未下单（王五）
```

这个模式叫反连接（anti-join）。用 `id NOT IN (SELECT ...)` 也能写，但见上一章的 NULL 陷阱——只要子查询结果里混进一个 NULL，整个查询静默变空。**否定类条件优先用 NOT EXISTS 或 LEFT JOIN**，这是三里挑一时最稳的两个。

## 防笛卡尔积

JOIN 不带 ON 条件（或老式的逗号连接），结果集是两表行数的**乘积**：

```sql
SELECT * FROM orders, customers;             -- 4 × 3 = 12 行的灾难（表大时是核弹）
SELECT * FROM orders CROSS JOIN customers;   -- 同上；CROSS JOIN 是显式的"我就是要组合"
```

CROSS JOIN 本身有正当用途（生成组合、构造日历骨架），事故来自"手滑忘了 ON"。显式写 `JOIN ... ON` 而不是逗号连接，让语法帮你把关：漏写 ON 时 INNER JOIN 直接报错，逗号连接则安静地给你一个乘积。

另一类隐性爆炸：**ON 两边的连接键在"多"的那一侧不唯一**。订单表连物流表，物流表里同一订单有 3 条轨迹记录，订单行就被复制成 3 份——随后 SUM 一算，金额凭空翻三倍。连接前先确认连接键的唯一性，聚合前先想清楚重复行要不要去重。

> [!WARNING]
> 大表上忘写 ON 的 JOIN，轻则一条慢查询拖垮连接池，重则把整库内存吃满。写完 JOIN 先扫一眼 ON 是否写全、两侧键是否唯一，再上生产。

## 条件放 ON 还是 WHERE

外连接下这两个位置语义不同，INNER 下等价：

```sql
LEFT JOIN payments pay
    ON pay.order_id = o.id AND pay.status = 'paid'   -- 条件在 ON：先筛右表再连接，主表行全保留

LEFT JOIN payments pay ON pay.order_id = o.id
WHERE pay.status = 'paid'                            -- 条件在 WHERE：连接后再筛，NULL 行全被淘汰
                                                     -- → LEFT 退化成 INNER
```

直觉：ON 是"怎么连"，WHERE 是"连完之后整体要什么"。想按右表条件过滤又保留左表，条件必须写在 ON 里。

## 多表连接的读法与执行直觉

四五个表连起来时逐段读，别一口吞：

```sql
SELECT o.id, u.name, p.name, pay.amount
FROM orders o
JOIN users u        ON o.user_id = u.id           -- 订单 → 下单的人（多对一）
JOIN order_items i  ON i.order_id = o.id          -- 订单 → 明细（一对多，行会变多）
JOIN products p     ON i.product_id = p.id        -- 明细 → 商品（多对一）
LEFT JOIN payments pay ON pay.order_id = o.id;    -- 订单 → 支付，可能没付，保订单
```

每 JOIN 一次问自己三个问题：拿什么键连到哪张表？一对多还是多对一？要不要保主表？规律是：**多对一连接不改变行数，一对多连接会让行数变多**。payments 用 LEFT 是因为"未支付"是合法业务状态，INNER 会把没付钱的订单悄悄抹掉。

引擎内部实际怎么执行连接，常见三类算法，知道名字就能读懂执行计划：**嵌套循环**（外表每行去内表找一遍，靠索引时极快，小表连大表常用）、**哈希连接**（把小表建成哈希表，大表逐行探测，大结果集的主力）、**归并连接**（两边都按连接键排好序后同步推进，数据已排序时最省）。优化器自己会挑，你只需要在计划里认出它们、判断选择是否合理。

## 自连接：一张表和自己连

员工表里 manager_id 指向同表的 id，"查出每个员工的上级姓名"就是自连接：

```sql
SELECT e.name AS employee, m.name AS manager
FROM employees e
LEFT JOIN employees m ON e.manager_id = m.id;   -- CEO 的 manager_id 为 NULL，用 LEFT 保住他
```

自连接的要点是**别名必须起**：同一张表在查询里扮演两个角色（员工 / 上级），靠别名区分。

> [!TIP]
> JOIN 写完先看一眼结果行数对不对：主表行数是预期下限（LEFT）或恰好匹配数（INNER），一旦比主表还多，几乎一定是一对多连接造成的行复制——先解决它再谈聚合。

相关阅读：[聚合与分组](04-aggregation.md)，[表设计与范式](05-design-schema.md)
