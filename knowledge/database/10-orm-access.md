---
title: 程序访问数据库
order: 10
tags: 基础, 连接池, ORM
summary: 连接与连接池、SQL 注入与参数化查询、ORM 的便利与代价。
---

应用代码和数据库之间隔着三层工具：裸驱动、查询构造器、ORM。选哪层不重要，两件事必须做对：**连接要池化，SQL 要参数化**。本章以 Rust 生态举例，套路对所有语言通用。

## 连接是贵资源，池化是基本功

建立一条数据库连接要走 TCP 握手、认证、会话初始化，几十毫秒起步；服务端还要为它留内存和进程配额。每个请求现连现断是灾难，复用靠连接池：

```rust
use sqlx::postgres::{PgPool, PgPoolOptions};

let pool = PgPoolOptions::new()
    .max_connections(10)          // 池上限：压住应用占用的连接总数
    .acquire_timeout(std::time::Duration::from_secs(3))  // 拿不到连接快速失败，别无限等
    .connect("postgres://user:pass@localhost/mydb").await?;
```

两个参数要对账：`max_connections` × 应用实例数，不能超过数据库端的连接上限（PostgreSQL 默认 100，每条连接都是一个进程）；上限太小则请求在池里排队。连接是**借还制**——用完归还，忘还（连接泄漏）会让池慢慢耗干，表现为"服务跑着跑着全部超时"，重启又好一阵。嵌入式场景（rusqlite + SQLite）连接即文件句柄，成本模型不同，但"复用而不是反复开关"的原则不变：

```rust
use rusqlite::Connection;

let conn = Connection::open("app.db")?;      // SQLite：一个连接就是一个"池"
let name: String = conn.query_row(
    "SELECT name FROM users WHERE id = ?1",  // ?1 是 SQLite 风格的占位符
    [42],
    |row| row.get(0),
)?;
```

> [!TIP]
> 排查"获取连接超时"类故障，按顺序看三个数：应用的池活跃连接数是否打满、数据库的当前连接数是否逼近上限、有没有挂住的长事务占着连接不放。九成答案在这三个数里。

## SQL 注入与参数化查询

注入的本质：**数据被当成了代码**。拼接出来的 SQL：

```rust
// 反面教材：name 一旦来自用户输入，语句结构就能被改写
let q = format!("SELECT * FROM users WHERE name = '{}'", name);
// name = "x' OR '1'='1" → 查出全表；更狠的可以叠加重写、删表
```

防御的正解只有一个——**参数化查询**：SQL 骨架和参数分开发送，驱动把参数当纯数据绑定，引号、分号都失去语法意义：

```rust
let user = sqlx::query_as::<_, User>(
    "SELECT id, name, email FROM users WHERE name = $1"   // 占位符，绝不拼接
)
.bind(&name)                  // 参数单独传，永远不进 SQL 文本
.fetch_optional(&pool).await?;
```

参数化还有附带收益：同一骨架、不同参数的查询能命中数据库的预编译缓存，省去重复解析。

> [!WARNING]
> 任何"把输入拼进 SQL 文本"的写法都是注入，包括动态拼接表名、排序字段、IN 列表。表名和排序字段用白名单校验后才能进 SQL；IN 列表改用 `= ANY($1)` 把数组整体传参。ORM 的常规接口默认参数化，但 `raw_sql` / `sql()` 这类逃生舱不设防——用逃生舱时安全责任回到你自己手上。

## 三层工具：裸 SQL、构造器、ORM

| 层次 | Rust 代表 | 适合 |
| --- | --- | --- |
| 裸驱动 + SQL | sqlx、rusqlite | 想完全掌控 SQL；sqlx 支持编译期连库校验查询 |
| 查询构造器 | sea-query | 动态条件（筛选、排序可拼）又不想丢 SQL 语义 |
| 全功能 ORM | diesel、sea-orm | 表映射结构体、关联、迁移全套，CRUD 密集型应用 |

sqlx 的编译期检查值得单独一提：`query!` 宏在编译时（借助 DATABASE_URL 或离线缓存）对 SQL 做类型检查，表结构改了、SQL 忘改，编译直接报错——把"运行时才发现的 SQL 错误"提前到了编译期：

```rust
let rows = sqlx::query!(
    "SELECT id, name FROM users WHERE age > $1",
    age
).fetch_all(&pool).await?;   // 返回的每一列都有类型，字段名写错编译不过
```

## 事务边界：一次业务操作一个事务

转账要原子、下单扣库存要原子——事务的边界应该画在**业务操作**上，而不是单个函数上：

```rust
let mut tx = pool.begin().await?;                            // 借一条连接并开事务
sqlx::query("UPDATE accounts SET balance = balance - 100 WHERE id = $1")
    .bind(1).execute(&mut *tx).await?;                       // 所有语句走同一条连接
sqlx::query("UPDATE accounts SET balance = balance + 100 WHERE id = $1")
    .bind(2).execute(&mut *tx).await?;
tx.commit().await?;                                          // 全部成功才提交；中途 ? 出错即回滚
```

`tx` 提前被 `?` 中断时，drop 会自动回滚——这是把事务边界交给作用域管理的好处。反过来，"每个仓储方法自己开事务"会让一次业务操作里的多笔写入各奔东西，原子性就破了；ORM 的事务作用域 API（sea-orm 的 `db.transaction`、diesel 的 `transaction`）提供的是同一种封装。

批量写入也是同理：循环里一条条 INSERT，不如拼一次多值 `INSERT INTO t VALUES (...), (...)` 或走批量绑定，往返次数差一个数量级。

## ORM 的便利与代价

ORM 买到的是：类型安全的字段引用、跨数据库方言、迁移脚本管理、CRUD 样板归零。代价也明码标价，最大的一个叫 **N+1**：

```rust
// 取 100 篇文章，再对每篇单独查作者 → 1 + 100 条 SQL
let posts = Post::find_all().await?;
for p in &posts {
    let author = p.load_author(&db).await?;    // 循环里逐条查询：列表页性能杀手
}

// 正解：预加载（eager loading），两条 SQL（IN 或 JOIN）搞定
let posts = Post::find()
    .with_related(Author)
    .all(&db).await?;
```

N+1 在开发库（几行数据）上毫无感知，上生产（列表页 × 千万行库）才开始报警。检测手段很简单：开发时开着 SQL 日志跑一遍列表页，一条请求冒出几十条相似 SQL，基本就是 N+1。其他代价：ORM 在你不知情时生成低效 SQL（多余列、深层嵌套 JOIN、错过的索引）；复杂报表查询写到最后往往是"在 ORM 里塞原生 SQL"。

> [!NOTE]
> 成熟的分工：**ORM 管 CRUD 和迁移，复杂查询退回手写 SQL**。把 ORM 生成的 SQL 日志打开看一两个下午，知道它对每个 API 生成什么查询，它就是生产力工具；把它当黑盒，它就是性能债的源头。

迁移是 ORM（或配套工具）的另一项核心服务，一句话版本：

```bash
sqlx migrate add create_users   # 生成带时间戳的 SQL 迁移文件，按序执行，记录在 _sqlx_migrations 表
```

迁移文件纳入版本控制、只向前不回改，细节见[运维基础](11-ops-basics.md)。

相关阅读：[事务与并发](07-transactions.md)，[SQL 查询基础](02-sql-select.md)
