---
title: 并发：无畏并发与 async
order: 13
tags: 线程, 通道, Mutex, Send, async, tokio
summary: 无畏并发的类型学基础（Send/Sync 让数据竞争编译期不可能）、线程与 move 闭包、channel 的消息传递哲学、Mutex/Arc 的共享状态纪律、async/await 与 tokio 运行时的模型，以及「线程 vs 异步」的选型。
---

Rust 并发的口号是「无畏并发（fearless concurrency）」：**数据竞争在编译期不可能**——不是靠纪律，是靠 Send/Sync 这两个标记 trait 与借用检查器的联动。这一篇讲三件事：线程与共享的编译期防线、channel 的消息传递哲学、async/await 的异步模型。

## 1. 线程与所有权：编译期的数据竞争防线

```rust
use std::thread;

let data = vec![1, 2, 3];
let handle = thread::spawn(move || {          // move：数据的所有权进线程
    println!("{:?}", data);                    // data 归这个线程所有
});
handle.join().unwrap();                        // 等待结束（拿回返回值）

// 两个线程同时持有 &mut data？—— 编译错误！
// 借用规则（[第 5 篇](05-borrowing.md)）在线程语境同样成立：
// 可变借用必须独占 → 两个线程不可能同时写同一数据
```

`thread::spawn(move || ...)` 的 move 是必然：**闭包活过当前函数**（线程可能在函数返回后才跑），捕获的借用会悬垂——move 让所有权随线程走（[第 11 篇](11-closures-iterators.md)）。而数据竞争的编译期防线来自两个标记 trait：

| trait        | 语义                                        | 谁实现                       |
| ------------ | ------------------------------------------- | ---------------------------- |
| `Send`       | 可以**转移**到另一个线程                     | 大部分类型；Rc ❌（非原子计数）|
| `Sync`       | 可以**共享引用**给其他线程（&T 是 Send）     | 大部分类型；RefCell/Cell ❌   |

thread::spawn 的闭包要求 `Send`——**含 Rc 的闭包直接编译错误**（Rc 非原子计数，[第 12 篇](12-smart-pointers.md)）——「错误数据的跨线程流动」在类型层被拦下。这是 [C 数据竞争](../c/13-tools-debugging.md)（运行时 TSan 抓）到 Rust（编译期拒）的层级跃迁。

## 2. Channel：消息传递的哲学

```rust
use std::sync::mpsc;                          // multi-producer, single-consumer

let (tx, rx) = mpsc::channel();
let tx2 = tx.clone();                          // 多个生产者

thread::spawn(move || { tx.send(42).unwrap(); });     // 发送：所有权转移进通道
thread::spawn(move || { tx2.send("msg".into()).unwrap(); });

for received in rx {                            // 接收：拿到值的所有权
    println!("{received}");
}                                                // 全部发送端 drop 后循环结束（通道关闭）
```

channel 的哲学：**「通过通信共享内存，而不是通过共享内存通信」**——数据在线程间**转移所有权**，没有共享、没有锁、没有竞争。接收端拿到的是值的所有权（send 转移进来）——Rust 的 channel 比 Go 的更强：**所有权随消息移动**，发送后原线程不能用（编译期保证）。

| 模式       | 工具                     | 适用                          |
| ---------- | ------------------------ | ----------------------------- |
| 任务分发   | mpsc channel             | 生产者-消费者、工作池          |
| 共享状态   | Arc<Mutex<T>>            | 真需要共享读写的（如共享缓存）  |
| 一次交接   | 通道/Atomic              | 简单信号                       |

优先 channel（避免共享），共享状态用 Arc<Mutex>（[第 12 篇](12-smart-pointers.md)）——与 [Go 的口号](../python/11-standard-library.md)、[linux 的锁纪律](../linux/07-processes.md)同源。

## 3. Mutex 与 Arc 的纪律

```rust
let counter = Arc::new(Mutex::new(HashMap::new()));

*c.lock().unwrap() += 1;              // lock() 返回守卫：MutexGuard
// ★ 守卫离开作用域自动解锁（RAII，[第 4 篇](04-ownership.md)）——忘记解锁不可能
```

Mutex 的 Rust 化：**锁守卫是类型**（MutexGuard）——数据只能通过守卫访问（`*guard`），守卫析构自动解锁。「忘了解锁」在 Rust 不是 bug 类型（[C++ lock_guard](../cpp/04-raii.md)、[linux 的 mutex](../linux/07-processes.md) 同思想的强制版）。纪律继承：锁内不做慢操作、多锁定序（[死锁预防](../cpp/13-concurrency.md)）、粒度（[第 7 篇](../cpp/13-concurrency.md)）。

## 4. async/await：并发任务的模型

```rust
// async fn 返回 Future：一个「可能还没完成的值」
async fn fetch(url: &str) -> Result<String, reqwest::Error> {
    let res = reqwest::get(url).await?;          // .await：让出执行权，就绪后恢复
    res.text().await
}

#[tokio::main]                                     // 运行时（异步需要执行器！）
async fn main() -> Result<()> {
    // 并发：join! 同时等待多个 Future
    let (a, b) = tokio::join!(fetch("a"), fetch("b"));
    Ok(())
}
```

async/await 的模型要点：

1. **async fn 返回 Future**（惰性——不 await 不执行！）；`.await` 在等待时**让出线程**（任务切换由运行时调度，不是 OS 线程切换）。
2. **需要运行时**（tokio/async-std）：Future 是状态机，需要执行器驱动——与 [python asyncio](../python/11-standard-library.md)、[JS 事件循环](../frontend/07-async.md)同构（Rust 把运行时留给你选）。
3. **异步的并发**：`tokio::join!`（等待多个）/`spawn`（后台任务）/`select!`（竞速）。

### 4.1 线程 vs 异步的选型

| 维度       | 线程（thread::spawn）       | async（tokio）                  |
| ---------- | --------------------------- | -------------------------------- |
| 成本       | OS 线程：MB 级栈、切换贵     | 任务：字节级、海量并发（万级连接） |
| 适用       | CPU 密集、少量并行           | **IO 密集高并发**（网络服务）     |
| 阻塞       | 阻塞无妨（独立线程）         | ★ 阻塞会卡整个执行器（async 内禁止阻塞调用！）|
| 生态       | 标准库                       | tokio 生态（hyper/reqwest）      |

异步的头号陷阱：**async 里做阻塞调用**（同步 IO/CPU 密集/长锁）——执行器的线程被卡住，所有任务跟着卡。解法：`spawn_blocking`（把阻塞活扔给专门线程池）。选型一句话：**IO 密集万级并发选 async、CPU 并行或简单线程选 thread**（与 [python 的三层选择](../python/11-standard-library.md)同构）。

## 5. 陷阱清单

- async fn 里阻塞（同步 IO/重计算/长锁）：执行器卡死；spawn_blocking。
- 忘 move 的线程闭包：借用悬垂编译错误；所有权进线程。
- Mutex 的 guard 跨 await 持有：其他任务全部阻塞；锁内不 await（tokio 用 async Mutex 或重设计）。
- 忘 join/spawn 的任务没人跑：Future 惰性——不 await/spawn 不执行。
- 数据竞争的「绕过」倾向（unsafe 裸指针）：Send/Sync 是设计工具；正确姿势是 Arc/Mutex/channel。
- 共享状态优先于消息传递：channel 往往更简洁；「通信优于共享」。
- 忽略 tokio 的运行时成本（单线程 worker/blocking 池）：CPU 任务 spawn_blocking、IO 任务 async——混跑要分层。

## 6. 小结

- 无畏并发的机制：Send/Sync 标记 trait + 借用规则 + move 闭包——数据竞争从运行时事故变成编译错误。
- channel 的哲学「通信优于共享」：所有权随消息转移——Rust 的 channel 比 Go 更强（编译期保证发送后不可用）。
- Mutex 的 Rust 化：守卫类型自动解锁（RAII）；纪律继承（粒度/定序/锁内不做慢事）。
- async 是「IO 密集高并发」的模型：Future 惰性 + 运行时驱动 + await 让出；线程是 CPU 并行与简单并行的答案——混跑分层（spawn_blocking）。
- 并发的三件武器（线程/channel/async）与所有权系统的结合，是 Rust「无畏」的全部秘密：**安全的并发不再需要更小心，只需要类型正确**。

## 7. 练习

**1.** 数据竞争的编译期演示：两个线程各对非原子 i32 计数（编译错误）；改 Mutex（过）；改原子 AtomicU32（过，[原子操作](../cpp/13-concurrency.md)的对照）——三段代码记录「编译器教育并发」的过程。

> [!TIP]
> 思路C 里这三个版本「都能编译」——差异靠 TSan 或崩溃发现；Rust 第一版直接编译拒绝。竞态的「修复位置」从调试器前移到编译器。

**2.** channel 工作池：主线程分发 100 个任务（mpsc 多生产者）、4 个 worker 消费执行、结果通道汇总——经典工作池模板（对照 [python 线程池](../python/11-standard-library.md)）。

> [!TIP]
> 思路任务所有权随通道转移：worker 拿到任务后「独占」它——没有共享队列的锁。Arc<Mutex<VecDeque>> 手写队列 vs mpsc 的对比，体会「通信优于共享」。

**3.** Mutex 纪律实验：锁内 sleep 3 秒 + 另一线程 lock（阻塞观察）；对照「锁外完成慢操作」版本——量化「临界区最小化」的并发收益（[锁粒度纪律](../cpp/13-concurrency.md)的实验化）。

> [!TIP]
> 思路Instant 计时两版的等待时间差——锁的持有时间是「并发度」的直接函数。与 [RAII 守卫](../cpp/04-raii.md)结合：守卫作用域即临界区——scope 设计即性能设计。

**4.** tokio 入门：写一个「并发抓取 10 个 URL」的 async 程序（reqwest + join!），对比串行 await 与 join! 的总耗时——验证「await 让出、join 并发」的模型。

> [!TIP]
> 思路串行版总耗时 ≈ 各请求之和；join! ≈ 最慢一个。IO 并发的收益比（[python 实验同款](../python/11-standard-library.md)）在 async 里同样成立——但要记住它是 IO 的收益不是 CPU 的。

**5.** 制造并修复「async 内阻塞」：tokio 任务里放一个 2 秒的同步 sleep（std::thread::sleep），观察其他任务全部卡住；改 spawn_blocking 或 async sleep 修复——「执行器卡死」的现场教学。

> [!TIP]
> 思路async 的「协作式调度」本质：任务不让出，执行器无法切换——阻塞是 async 世界的原罪。区分「IO 等待（可让出）」与「CPU/同步阻塞（不可让出）」是 async 编程的第一课。

**6.** 讨论：为什么 Rust 的 async 选择「运行时可插拔」（Future 是语言特性、tokio 是库）而不是 [Go 的内建 goroutine](../python/11-standard-library.md)？从「嵌入式/无运行时场景的兼容」「生态竞争与演进」「复杂度转嫁给用户（Pick a runtime）」三个角度分析——语言把「并发模型」内建还是外置的权衡。

> [!TIP]
> 思路外置让 Rust 的 async 能进嵌入式（无 tokio）、让运行时竞争演化（ tokio 的成功是生态的）；代价是「选型成本」与「async fn 的传染性」（异步污染调用链）成为社区第一吐槽点。Go 内建换简单、Rust 外置换自由——语言设计的又一组「默认值哲学」（[所有权默认](04-ownership.md)的同题异构）。
