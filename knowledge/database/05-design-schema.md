---
title: 表设计与范式
order: 5
tags: 核心, 范式, 主键
summary: 主键/外键与约束、三大范式的直觉、反范式的取舍、常见关系建模。
---

建表不是把字段一摊就完事：类型选错、约束缺失、冗余设计，这些错误会在数据量增长后以"数据不一致"的形式连本带利还回来。范式是消除冗余的清单，反范式是有意付出的代价——两者都得心里有数。

## 类型和约束：把非法数据挡在门外

```sql
CREATE TABLE orders (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),        -- 外键 + 非空
    amount      DECIMAL(10,2) NOT NULL CHECK (amount >= 0),   -- 金额：精确小数
    status      TEXT NOT NULL DEFAULT 'pending',
    email       TEXT CHECK (email LIKE '%_@_%._%'),           -- 轻量校验，别指望它兜住一切
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 改数据时记得同步更新
    UNIQUE (user_id, created_at)                              -- 组合唯一
);
```

两条铁律：**金额永远用 DECIMAL/NUMERIC，不用 FLOAT/DOUBLE**——二进制浮点表示不了 0.1，累加对账的差错全从这来；**能用约束表达的规则就别留给应用层**——CHECK、NOT NULL、UNIQUE 拦在最后一道，任何语言、任何脚本、任何手抖的运维都绕不过去。应用层的校验是用户体验，数据库的约束是底线，两者不是替代关系。

命名也有共识可抄：表和列统一 snake_case；时间列 `created_at` / `updated_at` 几乎每张表都该有（排查问题全靠它）；布尔列加 `is_` 前缀（`is_active`）；不要用数据库保留字（`order`、`desc`）当名字，省下满屏的引号转义。

> [!WARNING]
> FLOAT 存金额不是"精度差一点"，是会算错钱：`0.1 + 0.2 ≠ 0.3`。已经上线的浮点金额列，回头迁移的成本远高于建表时用对类型。

## 主键与外键：身份和引用

主键唯一标识一行。实战分两派：

- **代理主键**：自增整数或 UUID，与业务无关——默认选择
- **自然主键**：手机号、身份证号等业务字段——看着合理，实则脆弱，业务规则一变（手机号可换绑）主键跟着动摇，所有引用它的外键一起遭殃

自增整数做主键还有实打实的好处：小、有序，索引插入是追加而非随机写。UUID 的优势是分布式生成不冲突，代价是随机写打乱 B+ 树局部性（v4 如此；v7/ULID 带时间戳有序，两全）。业务字段的唯一性照样要保，但用 UNIQUE 约束去保，而不是拿它当主键。

外键保证"被引用的行一定存在"，从根上杜绝孤儿数据。删除时的行为值得专门背下来：

```sql
REFERENCES users(id) ON DELETE CASCADE   -- 删用户，连带删他所有订单
REFERENCES users(id) ON DELETE RESTRICT  -- 还有订单的用户不许删
REFERENCES users(id) ON DELETE SET NULL  -- 删用户，订单的 user_id 置 NULL（列需可空）
```

> [!WARNING]
> CASCADE 是链式删除：删一个节点可能顺着外键清空半张业务网。给关键关系配 CASCADE 前先画一遍删除传播图，不确定就用 RESTRICT 让删除显式报错。

## 三大范式：别背定义，记三个问题

拿一张"销售流水 Excel"走一遍，三个问题各拆一刀：

```text
原始宽表：order_id | customer_name | customer_phone | product_name | product_price | qty
```

- **1NF：字段不可再拆。** `tags = "rust,db"` 挤在一个字段里，"查含 rust 的行"就得 LIKE 全表扫，多值拆成子表或单独的标签表。Excel 头部的合并单元格，进数据库前先拆平。
- **2NF：非主键列不能只依赖联合主键的一部分。** 明细表主键 `(order_id, product_id)`，`product_name`、`product_price` 只依赖 `product_id`——同一商品在几百行里重复存，改价要改几百行，漏一行就是不一致。拆出 products 表。
- **3NF：非主键列不能依赖另一个非主键列。** 流水表里存了 `customer_id` 又冗余 `customer_phone`（它依赖 customer_id），用户改手机号要扫全表。电话属于 customers 表。

三句话归结成一句：**每个事实只存一份**。范式化的表改一个值只动一行，不存在"改了一半"的不一致状态——这才是范式防的东西，性能是其次。

> [!TIP]
> 新手的错误是"一张大宽表装天下"，老手的错误是"洁癖到 36 张表查一次点五个 JOIN"。把握默认：先范式化建模，出现可测量的性能问题后，再对具体热点做反范式。

## 反范式：有意的冗余

范式是默认，不是目的。典型场景："列表页每篇帖子显示评论数"，每次 COUNT 全评论表太贵，就在帖子表冗余一列：

```sql
ALTER TABLE posts ADD COLUMN comment_count INTEGER NOT NULL DEFAULT 0;

-- 发评论：同一事务里给帖子计数 +1，保证两边一致
UPDATE posts SET comment_count = comment_count + 1 WHERE id = 42;
```

冗余的本质：**写时多一步，换读时少一次聚合**。代价是冗余值可能漂移，必须保证它在同一事务里同步更新，或接受后台任务周期性校准。反范式决策要有明确的账：读频次 × 聚合成本，对比写频次 × 同步成本，算不过来账就不要冗余。

## 删除：硬删还是软删

`DELETE` 是硬删，"加 `deleted_at` 列、查询时过滤"是软删。软删保住数据可追溯、误删可挽回，但有两个坑：**所有查询都得记得带 `WHERE deleted_at IS NULL`**，漏一处就闹"已删数据复活"的事故；**唯一约束会被僵尸行挡住**——用户注销后换了邮箱想重新注册，旧行还占着 email 的唯一索引。PostgreSQL 用部分唯一索引解决后者：

```sql
CREATE UNIQUE INDEX idx_users_email_live
    ON users (email) WHERE deleted_at IS NULL;   -- 只对"活着"的行保证唯一
```

要么全库统一走软删并把它做进 ORM/视图层，要么就硬删加备份兜底——最糟的是一半表软删一半硬删，没人记得住哪张是哪张。

## 常见关系建模

| 关系 | 建模方式 | 例子 |
| --- | --- | --- |
| 一对一 | 从表加唯一外键，或共用主键 | 用户 ↔ 用户详情 |
| 一对多 | "多"的一方存外键 | 用户 → 订单 |
| 多对多 | 中间表存两个外键 | 学生 ↔ 课程 |

多对多没有直接语法，中间表是标准解法：

```sql
CREATE TABLE enrollments (
    student_id  INTEGER NOT NULL REFERENCES students(id),
    course_id   INTEGER NOT NULL REFERENCES courses(id),
    enrolled_at DATE NOT NULL DEFAULT CURRENT_DATE,
    grade       TEXT,                                  -- 将来要挂属性，直接加列
    PRIMARY KEY (student_id, course_id)               -- 组合主键顺带防止重复选课
);
```

中间表比"数组字段"高明的地方正在这里：关系本身可以有属性（什么时候选的、成绩多少），有约束（不重复选课），还能被索引和 JOIN。凡是想往 TEXT 字段里塞逗号分隔 ID 的冲动，都该用中间表压下去。

状态类的枚举值（订单状态、审核结论）同理，别用一段自由文本硬扛，两个档位按需选：

```sql
-- 轻量档：CHECK 约束圈死取值，改枚举要改表结构
status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'refunded'));
-- 正式档：查找表，状态可以挂属性（是否终态、排序权重），加值不用动 orders
CREATE TABLE order_status (code TEXT PRIMARY KEY, label TEXT NOT NULL, is_final BOOLEAN NOT NULL);
```

相关阅读：[JOIN 连接](03-joins.md)，[索引](06-index.md)
