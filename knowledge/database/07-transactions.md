---
title: 事务与并发
order: 7
tags: 核心, 事务, 隔离级别
summary: BEGIN/COMMIT/ROLLBACK、四种隔离级别与三类现象、死锁常识。
---

单用户的事务很好懂，难的是并发：两个事务同时读写同一行时，数据库给你什么保证、不给你什么保证。隔离级别就是这份"保证价目表"——级别越高越正确，也越贵。

## BEGIN / COMMIT / ROLLBACK

```sql
BEGIN;                                              -- PostgreSQL 用 BEGIN，MySQL 常用 START TRANSACTION
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;                                             -- 两步都成功，一并生效
```

任何一步出错，`ROLLBACK` 撤销事务里**全部**修改——包括你已经看到"改成功"的那些。原子性的意义就在这：外界永远看不到半截操作。长事务还可以用 SAVEPOINT 设中途存档，出错只回滚一段：

```sql
SAVEPOINT before_cleanup;
DELETE FROM logs WHERE created_at < '2023-01-01';
ROLLBACK TO before_cleanup;    -- 只撤销这一段 DELETE，事务继续
COMMIT;
```

两个日常注意点：第一，DDL（改表结构）在 MySQL 里会隐式提交当前事务，别指望 ROLLBACK 能撤销 ALTER；第二，很多驱动默认自动提交模式——每条语句就是一个事务，需要原子性时必须显式开事务（或用 ORM 的事务 API）。还有一条连接常识：**一条连接同一时刻只属于一个事务**，连接归还池之前必须结束事务，绝大多数池会直接回滚未提交的部分。

## 并发会出什么问题：三类现象

两个事务 T1、T2 并发跑，经典的"不干净"有三种：

| 现象 | 定义 | 例子 |
| --- | --- | --- |
| 脏读 | 读到别人**未提交**的数据 | T2 读到 T1 改了一半的余额，T1 回滚后 T2 拿假数据做了决策 |
| 不可重复读 | 同一事务内两次读**同一行**结果不同 | T1 读余额 100，T2 改成 50 并提交，T1 再读变 50 |
| 幻读 | 同一事务内两次**同一范围查询**行数不同 | T1 统计到 10 条订单，T2 插入一条并提交，T1 再统计变 11 条 |

用 SQL 时序看清"不可重复读"长什么样（READ COMMITTED 下就会发生）：

```sql
-- T1: BEGIN; SELECT balance FROM accounts WHERE id = 1;   → 100
-- T2:             UPDATE accounts SET balance = 50 WHERE id = 1;  COMMIT;
-- T1:        SELECT balance FROM accounts WHERE id = 1;   → 50    同一事务，两次读不一样
```

不可重复读针对**一行数据的值**（别人改了），幻读针对**符合条件的行数**（别人插了/删了）——一个是改，一个是增删。区分它们不是为了考试，是因为不同引擎防幻读的手段完全不同。

## 四种隔离级别

SQL 标准定义四档，逐级排除上述现象：

| 隔离级别 | 脏读 | 不可重复读 | 幻读 |
| --- | --- | --- | --- |
| READ UNCOMMITTED | 可能 | 可能 | 可能 |
| READ COMMITTED | 不可能 | 可能 | 可能 |
| REPEATABLE READ | 不可能 | 不可能 | 可能* |
| SERIALIZABLE | 不可能 | 不可能 | 不可能 |

\* 实现普遍超标：PostgreSQL 的 RR 用快照语义连幻读也挡住了；MySQL InnoDB 的 RR 靠间隙锁（锁住范围防止插入）在很大程度上防幻读。标准是底线，不是各家实现的上限。

默认值必须记牢：**PostgreSQL 和 Oracle 默认 READ COMMITTED，MySQL InnoDB 默认 REPEATABLE READ**。SQLite 没有服务端并发模型，整库一写多读，靠文件锁把写者串行化。按事务设置级别的语法：

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ;   -- PostgreSQL：事务第一条查询前声明
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;   -- MySQL：会话级
```

另有两点常识：SERIALIZABLE 遇到冲突会报错要求重试，它不是"更慢但安静"，是"失败要你重试"；隔离级别可以按事务单独设置，不必全库一刀切。

> [!TIP]
> 不要无脑拉到 SERIALIZABLE。多数业务在 READ COMMITTED 下写对逻辑就够了；真正需要跨行强一致的关键操作（扣库存、结算），用 `SELECT ... FOR UPDATE` 把要改的行显式锁住，比全局调高级别精准得多。

## 显式加锁：SELECT ... FOR UPDATE

"查出来 → 判断 → 更新"三步之间数据可能被别人改掉，防止的办法是把行锁到事务结束：

```sql
BEGIN;
SELECT stock FROM inventory WHERE sku = 'A1' FOR UPDATE;   -- 锁住这行，别人也想 FOR UPDATE 就得等
UPDATE inventory SET stock = stock - 1 WHERE sku = 'A1';
COMMIT;
```

FOR UPDATE 挡住的是"别人的写和别人的 FOR UPDATE"，普通 SELECT（走 MVCC 快照）不受影响——这正是 MVCC 的设计取舍：读写不互斥，写写才互斥。

## 实现的直觉：MVCC

现代主流引擎（InnoDB、PostgreSQL）靠 **MVCC（多版本并发控制）**实现隔离：每行保留多个版本，读者按快照取"自己该看的版本"，读写互不阻塞。快照的取法正是两个级别的分野：**PostgreSQL 的 READ COMMITTED 每条语句取一次新快照**（所以语句内一致、语句间可能变——不可重复读），**REPEATABLE READ 在事务开头取一次用到底**（所以全程一致）。写与写之间仍靠行锁仲裁，同一行同时只有一个事务能改。

代价是旧版本需要清理：PostgreSQL 靠 VACUUM 回收死元组，InnoDB 靠回滚段。**长事务会拖住清理**，让表和 undo 无限膨胀——这是很多"数据库越跑越慢"的幕后原因。

## 死锁常识

两个事务互相等对方的锁，就死锁了：

```text
T1: 已锁行 A，想要行 B
T2: 已锁行 B，想要行 A    -- 谁也不放，谁都走不了
```

数据库的死锁检测会发现这个环，**主动回滚其中一个**（报 deadlock 错误），另一个继续跑。所以死锁不是"数据库卡死"，而是"其中一个事务吃罚单"——应用代码要能接受重试：

```rust
// 伪代码：死锁报错退避重试，其他错误照常上抛
loop {
    match run_in_transaction(&pool).await {
        Ok(result) => break result,
        Err(e) if is_deadlock(&e) => tokio::time::sleep(backoff).await,
        Err(e) => return Err(e),
    }
}
```

预防比重试更优雅：**所有事务按同一顺序访问资源**（例如都先锁 id 较小的行），环就构不成。缩短事务、减少锁的持有时间，是死锁与一切锁问题的通用处方。

> [!WARNING]
> 事务里不要放网络调用、用户确认、长时间计算——事务开启的那一刻锁就开始持有、快照开始堆积。长事务是生产事故的常青树：锁排队、连接占满、表膨胀，源头常常只是一段"在事务里调第三方 API"的代码。

相关阅读：[程序访问数据库](10-orm-access.md)，[运维基础](11-ops-basics.md)
