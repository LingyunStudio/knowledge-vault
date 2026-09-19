---
title: 进阶 SQL 与方言
order: 8
tags: 窗口函数, UPSERT, JSONB, 方言, gaps-islands
summary: 窗口函数的进阶形态（滑动窗口/gaps-and-islands）、UPSERT 的两种方言写法、PostgreSQL 的 JSONB 与数组类型、MySQL/PG/SQLite 的方言差异对照表，以及「写可移植 SQL」的取舍策略。
---

SQL 的「进阶」不在冷门语法，而在三件事：**把窗口函数用到复杂分析**（滑动窗口、序列问题）、**掌握 UPSERT 与 JSON 这类现代必备**、**意识到方言差异**（同一需求在 MySQL/PG/SQLite 写法不同）。本篇以此组织，附方言对照表。

## 1. 窗口函数进阶：框架与序列问题

### 1.1 滑动窗口：ROWS/RANGE 框架

```sql
-- 7 天滑动平均（前 6 行 + 当前行）
SELECT day, revenue,
       AVG(revenue) OVER (
           ORDER BY day
           ROWS BETWEEN 6 PRECEDING AND CURRENT ROW      -- 物理行框架
       ) AS ma7
FROM daily_sales;

-- RANGE 与 ROWS 的差别：RANGE 按值聚合（同值行一起进窗口）
ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING        -- 前后各 2 行（固定 5 行）
RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW   -- 按值域（缺数据日不影响）
```

`ROWS`（物理行）与 `RANGE`（逻辑值域）的区分在有缺失数据的时序里至关重要——「7 天滑动均值」应该用日期 RANGE（缺日时 ROWS 会把 8 天前算进来）。

### 1.2 gaps and islands：序列分组经典题

问题：「找出连续登录 ≥3 天的用户」——把连续的日期段聚成「岛」：

```sql
WITH marked AS (
    SELECT user_id, login_day,
           login_day - ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY login_day) AS grp
           -- ★ 连续日期减去连续序号 = 常量（岛的编号）
    FROM logins
)
SELECT user_id, MIN(login_day) AS start_day, MAX(login_day) AS end_day, COUNT(*) AS days
FROM marked
GROUP BY user_id, grp
HAVING COUNT(*) >= 3;
```

「差值分组法」（日期 - 行号 = 岛 ID）是 gaps-and-islands 的核心技巧——凡是「连续段」类问题（连续签到、连续涨停、断档检测）都是它的变体。这类问题标志着 SQL 分析能力从「查询」进入「计算」。

## 2. UPSERT：存在则更新，否则插入

```sql
-- PostgreSQL / SQLite：ON CONFLICT
INSERT INTO stats (key, value, updated_at)
VALUES ('pv', 1, now())
ON CONFLICT (key) DO UPDATE
    SET value = stats.value + 1, updated_at = now();   -- ★ 冲突时更新（value 引用已有值）

ON CONFLICT (key) DO NOTHING                            -- 或：冲突就忽略（幂等写入）

-- MySQL：ON DUPLICATE KEY UPDATE
INSERT INTO stats (key, value) VALUES ('pv', 1)
ON DUPLICATE KEY UPDATE value = value + 1;
```

UPSERT 的两大用途：**计数器/汇总的原子累加**（与 [事务](07-transactions.md)的原子性配合——两条语句变成一条原子语句，天然免「先查后插」的竞态）与**幂等导入**（重复执行同结果——数据同步的标配）。PG 的 `ON CONFLICT` 需要冲突目标（唯一约束列）；不加目标时冲突任意唯一键都触发（语义模糊，显式写目标）。

## 3. JSONB：PostgreSQL 的半结构化牌

```sql
CREATE TABLE events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payload JSONB NOT NULL                     -- ★ JSONB：二进制存储（可索引），非 text
);

INSERT INTO events (payload) VALUES ('{"type": "click", "user": {"id": 42}, "tags": ["a","b"]}');

-- 查询操作符
SELECT payload->>'type'                       -- 文本值："click"
FROM events WHERE payload->>'type' = 'click';
SELECT payload->'user'->>'id'                 -- 嵌套取（-> 返回 jsonb，->> 返回文本）
FROM events WHERE payload @> '{"user": {"id": 42}}';   -- @> 包含（可用索引）

-- 索引：GIN 让 JSONB 内部可查
CREATE INDEX idx_events_payload ON events USING GIN (payload);
```

JSONB 的定位：**schema 的灵活溢出区**——固定核心列（关系约束）+ payload 存「变化快/低查询频次」的扩展字段。两个纪律：**核心查询字段不进 JSON**（提取成列才能索引/约束）；**JSONB 不等于无 schema**（用 CHECK 约束或应用层校验结构）。MySQL 对应 `JSON` 类型 + `->>` 操作符，能力类似但索引机制不同。

数组类型是 PG 的另一特色：

```sql
SELECT * FROM articles WHERE 'db' = ANY(tags);         -- 数组包含
SELECT * FROM articles WHERE tags @> ARRAY['db','sql'];
```

## 4. 方言对照表：同一需求的四种写法

| 需求            | PostgreSQL                  | MySQL                       | SQLite                   |
| --------------- | --------------------------- | --------------------------- | ------------------------ |
| 自增主键        | `GENERATED ALWAYS AS IDENTITY` | `AUTO_INCREMENT`          | `INTEGER PRIMARY KEY`（rowid） |
| UPSERT          | `ON CONFLICT`               | `ON DUPLICATE KEY`          | `ON CONFLICT`            |
| 分页            | `LIMIT n OFFSET m`          | `LIMIT m, n` / `LIMIT n OFFSET m` | `LIMIT n OFFSET m` |
| 当前时间        | `now()`                     | `NOW()`                     | `datetime('now')`        |
| 字符串拼接      | `\|\|` 或 `concat()`        | `CONCAT()`（\|\| 在部分模式不可用） | `\|\|`               |
| 大小写敏感      | 默认敏感                    | 排序规则决定（常不敏感）      | LIKE 不敏感 / = 敏感     |
| JSON            | `JSONB` + GIN               | `JSON` + 函数索引            | `json_extract`           |
| 正则            | `~ 'pattern'`               | `REGEXP 'pattern'`          | 无（扩展）               |
| 引号            | 标识符 `""` 字符串 `''`     | 反引号 `` ` `` 标识符        | 双引号/反引号均可        |

三大实用建议：

1. **开发与生产同库**（至少同族）——方言差异在「以为一样」的地方咬人（大小写、隐式转换、默认值）。
2. **ORM/查询构建器吸收部分方言**（[第 10 篇](10-orm-access.md)），但原生 SQL 的可移植性要自己负责——复杂的方言语法封装成数据库视图或函数。
3. **SQLite 是最好的学习环境**（零安装）但不是 MySQL/PG 的行为复制品——事务粒度、并发、类型亲和都有差异（[第 7 篇](07-transactions.md)的隔离级别表）。

## 5. 陷阱清单

- ROWS 与 RANGE 混淆：时序滑动窗口缺数据日时结果错；按语义选框架。
- gaps-islands 的差值分组技巧不会推：连续段问题的固定起手式。
- ON CONFLICT 不写冲突目标：任意唯一键触发；显式目标。
- JSONB 当垃圾桶（核心查询字段塞进去）：可查询列提取成列；GIN 索引按查询模式建。
- 假设方言一致（大小写/类型/隐式行为）：同库族开发；方言差异进代码评审清单。
- MySQL 的隐式类型转换与宽松 GROUP BY：`ONLY_FULL_GROUP_BY` 开启、比较显式转型。
- 用 ORM 的方言抽象掩盖 SQL 差异：复杂查询仍需方言测试（迁移演练，[第 5 篇](05-schema.md)）。

## 6. 小结

- 窗口进阶两件套：ROWS/RANGE 框架（物理行 vs 值域）支撑滑动统计；差值分组法解 gaps-and-islands——「连续段」类分析在 SQL 内完成。
- UPSERT 是「原子累加 + 幂等写入」的标准件：PG/SQLite 的 ON CONFLICT 与 MySQL 的 ON DUPLICATE KEY 语义对齐写法不同。
- JSONB 的定位是「关系模型内的受控灵活性」：核心列关系化、扩展字段文档化、GIN 按需索引。
- 方言差异集中在类型/自增/UPSERT/大小写/JSON——「开发生产同库 + 方言清单进评审」是务实防线。
- SQL 的进阶不是背更多语法，而是把「分析意图」精确翻译到正确的机制（窗口/UPSERT/JSON/CTE）。

## 7. 练习

**1.** 用窗口框架实现「最近 7 个自然日（含缺数据日）的滚动总销售额」与「最近 7 行记录的滚动总和」，对比两者在有缺失日的数据上的差异。

> [!TIP]
> 思路RANGE INTERVAL 版把缺日视为窗口一部分、ROWS 版会把更早的行拉进来——时序语义题必须先答「窗口按时间还是按行」。

**2.** 用差值分组法解「找出连续 3 天以上未登录的用户」（连续缺席段）：对登录日做补全或反向技巧（提示：先构造连续日历表再反连接）。

> [!TIP]
> 思路gaps-islands 的「islands 找 gap」变体：日历表（generate_series 生成）LEFT JOIN 登录记录 → 缺席的行 → 再对缺席行做差值分组。「先补全维度再分析」是时序分析的通用前置。

**3.** 用 UPSERT 实现一个「幂等数据同步」：把外部 API 的数据反复写入表（重复执行不产生重复行、变化字段更新）——ON CONFLICT 的 UPDATE 子句要覆盖哪些列、哪些列保持不变（如 created_at）？

> [!TIP]
> 思路可变字段进 UPDATE、创建时间/主键类保持——幂等同步的字段分级是设计核心。配合唯一键的选择（业务键 vs 代理键）练习 [第 5 篇](05-schema.md)。

**4.** 给 events 表的 JSONB 设计混合查询：核心字段（type/user_id/created_at）提升为独立列并建索引、低频扩展字段留 payload + GIN——把一个「全 JSON」的烂设计重构为混合形态，EXPLAIN 验证。

> [!TIP]
> 思路重构判断标准：哪些字段出现在 WHERE/GROUP BY（提升成列+索引）、哪些只是随行取用（留 JSON）。EXPLAIN 的 GIN 扫描 vs btree 扫描对比是落点。

**5.** 把[第 4 篇](04-aggregation.md)的递归 CTE、本篇的 UPSERT、窗口函数三段 SQL 分别在 SQLite/MySQL/PostgreSQL 上跑通（或记录不兼容点）——产出一份你自己的方言差异表。

> [!TIP]
> 思路递归 CTE 三家都支持（语法一致）、UPSERT 写法各异、窗口函数 SQLite 3.25+ 支持。亲手撞过差异，「可移植 SQL」才不是一个口号。

**6.** 讨论：「把逻辑写进 SQL」（复杂窗口/递归/JSON 操作）vs「拉到应用层处理」的边界在哪？从「数据移动成本、可测试性、优化器能力、团队技能」四个角度给出决策框架，并与 [第 5 篇练习 6](04-aggregation.md)的 CQRS 讨论衔接。

> [!TIP]
> 思路SQL 内处理省数据移动（单机分析强）；应用层处理可测试可组合（复杂逻辑强）。决策框架的锚点：中间数据量（大→SQL）与逻辑复杂度（高→应用）。CQRS 是这个边界的架构级表达——写侧范式、读侧按需投影。
