---
title: Schema 设计：建模与范式
order: 5
tags: Schema, 范式, 主键, 外键, 多对多
summary: 从需求到表结构的建模步骤（实体/关系/列/约束）、主键的三种选择与「业务字段当主键」的禁忌、一对一/一对多/多对多的落地形态、三大范式的白话解释与反范式化时机、以及软删除/枚举表/审计字段等设计模式。
---

Schema 设计是数据库的「架构设计」：表结构定下来后，查询、性能、扩展都被它塑形——改 schema 的成本远高于改应用代码。本篇给出一条可操作的建模流程与几组关键取舍。

## 1. 建模四步：从需求到 DDL

以电商为例走一遍：

```text
① 找实体（名词）：用户、商品、订单
② 定关系（动词）：
   用户 ——下单→ 订单（一对多）
   订单 ——包含→ 商品（多对多：一个订单多商品、一个商品进多订单）
③ 定列与类型：每个实体的属性；金额用 NUMERIC 不用 FLOAT！
④ 加约束：主键、外键、NOT NULL、UNIQUE、CHECK
```

```sql
CREATE TABLE users (
    id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name  TEXT NOT NULL
);

CREATE TABLE products (
    id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name  TEXT NOT NULL,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0)   -- 金额：精确十进制（[C 篇](../c/02-types.md)浮点教训的数据库版）
);

CREATE TABLE orders (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id),
    status     TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (                 -- 多对多的桥表
    order_id   BIGINT REFERENCES orders(id),
    product_id BIGINT REFERENCES products(id),
    quantity   INT NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10,2) NOT NULL,     -- ★ 成交价快照：商品涨价不影响历史订单
    PRIMARY KEY (order_id, product_id)     -- 复合主键：一行 = 一个订单里的一种商品
);
```

两个值得停顿的决策：

- **金额用 NUMERIC**：FLOAT 的二进制表示误差（[C 篇](../c/02-types.md)）在对账场景不可接受——`NUMERIC(10,2)` 是十进制的精确。
- **unit_price 快照**：订单项存「成交时价格」而非只存 product_id 引用——历史订单的正确性不随商品改价漂移。这是「快照 vs 引用」的设计模式（与 [docker tag vs digest](../docker/03-images.md) 的可变引用/不可变指纹同构）。

## 2. 主键：身份的选择

| 方案                | 优点                     | 缺点                                   | 适用                     |
| ------------------- | ------------------------ | -------------------------------------- | ------------------------ |
| 自增（IDENTITY/SERIAL）| 紧凑、索引友好、有序      | 分布式生成难、URL 可枚举                 | 单库的默认                |
| UUID v4（随机）      | 全局唯一、可离线生成      | 36 字节、随机写入索引分裂（B 树插入点随机）| 分布式、客户端生成          |
| UUIDv7/ULID（时序）  | 全局唯一 + 时间有序       | 较新（原生支持有限）                     | 分布式 + 索引友好的折中     |

**业务字段（手机号、身份证）当主键是禁忌**：业务会变（换号/规则调整）、唯一性可能被打破（历史遗留号码）、索引为长字符串付费。主键应该与业务无关（surrogate key）——业务唯一性用 UNIQUE 约束表达。

## 3. 关系的三种形态

```text
一对一：用户 ↔ 用户档案      → 外键加 UNIQUE（或合并成一张表，看访问模式）
一对多：用户 → 订单          → 多方持外键（orders.user_id）
多对多：订单 ↔ 商品          → 桥表（order_items），桥表常携带关系自身的属性（quantity/成交价）
```

判断技巧：**「关系本身有属性吗？」**——「用户收藏商品」只是关系（纯桥表两列）；「用户购买商品」有数量与价格（桥表加列）。多对多的桥表常常长成一个独立实体（order_items → orders 的明细），这是建模的自然演化。

## 4. 范式：消除冗余的层次

范式回答「这一份事实应该存几份」：

- **1NF**：列是原子的——不存「tags = "a,b,c"」的逗号拼接（查询要 LIKE、无法建索引、无法约束）。多值关系拆成关联表或用数组/JSON 类型（有版本要求的权衡）。
- **2NF**：非键列依赖**整个主键**——桥表里「商品名称」不该挂在 (order_id, product_id) 上（它只依赖 product_id）→ 挪到商品表。
- **3NF**：非键列之间**无传递依赖**——用户表存「城市名 + 邮编」，邮编由城市决定 → 传递依赖 → 拆城市表（或接受冗余，见下）。

范式的收益是**写入一致性**（改一处即可）与**无更新异常**；代价是查询要 JOIN。**反范式化**（有意冗余）的正当时机：

```sql
-- 订单表冗余 user_name 快照：报表查询免 JOIN + 历史快照（改名不影响旧订单显示）
ALTER TABLE orders ADD COLUMN user_name TEXT;
```

纪律：**先范式（正确性），后在测量到的热点上反范式**——反范式是「用写入冗余换读取性能」的明确交易（[第 6 篇](06-index.md)的空间换时间同款思维），要有意识做、有注释记录、有同步策略。

## 5. 约束体系与外键之争

```sql
NOT NULL / DEFAULT        -- 最便宜的契约（[第 1 篇](01-db-model.md)）
UNIQUE                    -- 业务唯一性（email、订单号）
CHECK (amount > 0)        -- 值域规则
FOREIGN KEY ... ON DELETE CASCADE | RESTRICT   -- 引用完整性与级联行为
```

外键的争议（互联网大厂常禁用）：外键保证引用完整性（应用 bug 也坏不了数据），但**高并发写入时带来锁开销**、分库分表后无法跨库表达。两派立场：

- **要外键**：数据完整性是数据库的职责、ORML/迁移工具友好、中等规模完全没性能问题（PG 的 FK 检查是索引查找）。
- **不要外键**：应用层保证 + 分库场景；代价是孤儿数据要靠对账任务清理。

务实建议：**中小规模默认加外键（RESTRICT）；级联删除（CASCADE）慎用**——「删用户连带删订单」的静默级联是数据事故大户，显式在应用层做级联更可控。

## 6. 常用设计模式

```sql
-- 软删除：不物理删行（审计/恢复/外键友好）
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
-- 所有查询带 WHERE deleted_at IS NULL（或用视图/ORM 默认作用域封装）

-- 审计字段：谁改的什么时候改的
created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

-- 枚举值：CHECK 约束 vs 枚举表
status TEXT NOT NULL CHECK (status IN ('pending','paid','shipped','cancelled'))
-- 枚举表（status 表 + 外键）：状态可运营配置时用；固定小集合用 CHECK
```

软删除的代价要诚实面对：**所有查询都要带过滤**（漏一处就「看到已删数据」）、唯一约束与软删除的冲突（删除后 email 占位）、索引膨胀。物理删除 + 归档表是替代方案——按合规与产品需求选。

## 7. Schema 演进：迁移

表结构必然演化（加列、改类型、拆表）——**迁移脚本（migration）**把它变成版本化的代码（与[git 的历史观](../git/01-object-model.md)一致）：

```sql
-- migrations/003_add_phone.sql
ALTER TABLE users ADD COLUMN phone TEXT;      -- 加可空列（向后兼容的起步）
-- 迁移纪律：先加可空列 → 应用双写 → 回填 → 设 NOT NULL → 删旧列
```

迁移工具（Flyway/Liquibase/ORM 内置）管理「版本序列 + 已应用记录」。向前兼容的迁移纪律（expand-migrate-contract）：**先扩展（新列）、再迁移（双写回填）、最后收缩（删旧列）**——部署与迁移解耦，回滚不至于断崖。

## 8. 陷阱清单

- 金额用 FLOAT：对账灾难；NUMERIC。
- 业务字段当主键：主键换业务的代价是无解的；代理键 + UNIQUE。
- 逗号拼接的多值列（1NF 违反）：查询/索引/约束三重失败；关系表或数组类型。
- 桥表缺「关系属性」列（成交价快照）：历史正确性丧失。
- CASCADE 删除的静默级联：慎用；显式应用层删除。
- 无迁移脚本的手改库：环境漂移；迁移进版本控制。
- 过早反范式（冗余无同步策略）：不一致数据；先范式后优化。
- 软删除漏过滤：删了的还出现；封装默认作用域。

## 9. 小结

- 建模四步：实体 → 关系（一对多/多对多落地为外键与桥表）→ 列与类型（NUMERIC 管钱、快照管历史）→ 约束（契约下沉）。
- 主键用代理键（自增/UUID），业务唯一性交 UNIQUE；分布式场景 UUIDv7/ULID 兼顾唯一与索引友好。
- 范式是「一份事实存一处」的正确性基线；反范式是测出来的读写交易——先范式后冗余，冗余要有注释与同步策略。
- 外键之争的实质是完整性与扩展性的权衡：中小默认加（RESTRICT）、CASCADE 慎用；约束系统（NOT NULL/UNIQUE/CHECK）是廉价的一致性保险。
- 软删除/审计字段/迁移是 schema 的日常工程：expand-migrate-contract 让演化不断服。

## 10. 练习

**1.** 为「在线问卷系统」建模：问卷、题目（单选/多选/文本）、选项、答卷、答案。画出 ER 图并写 DDL——重点：题目类型的处理（CHECK/枚举表/分表）与答案表的通用结构（不同类型答案怎么存）。

> [!TIP]
> 思路答案的多类型是设计难点：分列（text_answer/int_answer，带 CHECK 互斥）、JSONB 列、或分表。三种方案的查询代价与约束强度对比是练习的核心。

**2.** 找出下面表设计的四处问题并重构：`orders(id, user_name, user_phone, product_names, amount, created)`。

> [!TIP]
> 思路：①user 信息冗余且依赖用户改名（拆用户表+外键）；②product_names 多值列（1NF 违反→订单项）；③金额无类型约束；④缺状态与审计字段。每处标注违反的范式或缺失的模式。

**3.** 设计「商品价格历史」：商品改价要保留历史（页面显示当前价、订单引用成交价）。给出两种方案（价格历史表 vs 订单项快照）并分析查询差异。

> [!TIP]
> 思路价格历史表支持「任意时刻的价格查询」（时态查询）；订单项快照支持「订单事实不变」。两者常并存——历史表管商品维度、快照管订单维度，服务不同的时间旅行需求。

**4.** 实践 expand-migrate-contract：给 users 表加一个 NOT NULL 的 nickname 列（不允许停机）——写出四步迁移脚本与每步的应用状态。

> [!TIP]
> 思路①加可空列；②应用写时同时写（代码双写）；③批量回填 UPDATE ... WHERE nickname IS NULL（分批！）；④加 NOT NULL 约束。每步都可独立部署与回滚——不停机演化的核心。

**5.** 为「多租户 SaaS」设计数据隔离：tenant_id 进每张表 + 复合索引 + 应用层强制过滤。分析「tenant_id 缺失导致跨租户泄露」的防线（索引设计/ORM 全局作用域/数据库 RLS 行级安全）。

> [!TIP]
> 思路防线纵深：schema 每表 tenant_id、所有复合索引以 tenant_id 开头（[第 6 篇](06-index.md)）、ORM 全局 scope、PG 的 Row Level Security 兜底。单点防线（只靠 ORM）是 SaaS 泄露事故的模板。

**6.** 讨论：「先范式后反范式」与「一开始就按查询模式建模（查询优先）」两种流派——在「读多写少的报表库」与「写入密集的业务库」各选哪派？CQRS（读写分离模型）的概念如何统一两者？

> [!TIP]
> 思路业务库范式（写入一致性与灵活性）、报表库按查询建模（宽表/冗余，读性能优先）。CQRS：写侧范式化 + 读侧反范式投影（同步管道）——两种流派在「命令与查询职责分离」下各得其所。
