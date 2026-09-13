---
title: 并发与异步
order: 13
tags: 核心, 线程, async
summary: 所有权延伸到线程：Send/Sync 保证并发安全；channel 传数据、Mutex 共享、async/await 处理 IO 密集。
---

Rust 的并发口号是**无畏并发**（Fearless Concurrency）：所有权与 trait 系统延伸到线程边界后，数据竞争在编译期就不可能存在。你写的多线程代码，要么正确，要么编译不过。

## 线程与 move

```rust
use std::thread;

let data = vec![1, 2, 3];

let handle = thread::spawn(move || {
    // move：数据所有权移入线程，编译器保证主线程不再使用它
    println!("{:?}", data.iter().map(|x| x * 2).collect::<Vec<_>>());
});

handle.join().unwrap();     // 等待线程结束，返回闭包的返回值
```

## Send 与 Sync：线程安全的类型系统表达

两个自动推导的标记 trait：

- **`Send`**：类型的所有权可以**转移到**另一个线程
- **`Sync`**：类型的引用 `&T` 可以**共享给**另一个线程（即 `T: Sync ⟺ &T: Send`）

绝大多数类型自动满足。编译器据此把关：

```rust
let data = Rc::new(5);
thread::spawn(move || println!("{data}"));
// ❌ Rc 不是 Send：非原子计数跨线程会算错
//    错误信息直接告诉你换成 Arc
```

## Channel：用通信共享内存

> Do not communicate by sharing memory; instead, share memory by communicating.

```rust
use std::sync::mpsc;
use std::thread;

let (tx, rx) = mpsc::channel();

thread::spawn(move || {
    for i in 0..5 {
        tx.send(i).unwrap();
    }
});     // tx 随线程结束被 drop，通道关闭

for received in rx {            // 迭代在通道关闭时自然结束
    println!("收到 {received}");
}
```

`mpsc` = 多生产者单消费者。多生产者就 `clone` 发送端。需要多消费者用 `crossbeam-channel` 或 `tokio::sync::mpsc`。

## Mutex<T>：必须持锁才能访问

Rust 的 `Mutex` 与众不同：**数据锁在 Mutex 里面**，没有锁就拿不到数据——忘记加锁是不可能的编译错误：

```rust
use std::sync::{Arc, Mutex};

let counter = Arc::new(Mutex::new(0));
let mut handles = vec![];

for _ in 0..10 {
    let counter = Arc::clone(&counter);
    handles.push(thread::spawn(move || {
        let mut num = counter.lock().unwrap();   // 拿锁才能访问
        *num += 1;
    }));    // guard 离开作用域自动解锁（RAII），不存在忘记 unlock
}

for h in handles { h.join().unwrap(); }
assert_eq!(*counter.lock().unwrap(), 10);
```

组合逻辑：`Arc` 解决"多线程拥有"（跨线程的 Rc），`Mutex` 解决"可变访问"。两者几乎总是成对出现。

> [!WARNING]
> Mutex 只防数据竞争，不防**死锁**。规则：多把锁按全局固定顺序获取；拿锁期间不做慢操作；能用 channel 就不用共享内存。

| 共享需求 | 方案 |
| --- | --- |
| 读多写少 | `RwLock<T>`（多读并行） |
| 简单原子量 | `AtomicU64` / `AtomicBool` |
| 只读共享大结构 | `Arc<T>` |
| 一次性初始化 | `OnceLock<T>` / `LazyLock<T>` |

## async/await：IO 密集的另一条路

线程是 OS 调度的**抢占式**并发，每个线程 MB 级栈；`async` 是**协作式**并发，任务只有几十字节，单机轻松百万级——适合网络服务这类 IO 密集场景。

```rust
// Cargo.toml: tokio = { version = "1", features = ["full"] }

use tokio::time::{sleep, Duration};

#[tokio::main]
async fn main() {
    let (a, b) = tokio::join!(fetch("a"), fetch("b"));  // 并发跑两个
    println!("{a} {b}");
}

async fn fetch(name: &str) -> String {
    sleep(Duration::from_millis(100)).await;   // await = 让出执行权
    format!("{name} 完成")
}
```

关键心智模型：

- `async fn` 返回一个 `Future`——**惰性的**，不 `await` 就不执行
- `.await` 是让出点：任务暂停，执行器去跑别的任务
- `Future` 是状态机，编译期生成，无 GC、无虚表
- 标准库只定义了 `Future` trait，**执行器需要运行时**（tokio 是事实标准）

> [!IMPORTANT]
> async 代码同样受 [借用检查](05-borrowing.md) 约束，且跨 `.await` 持有引用需要 `Future` 满足 `Send`——这就是为什么异步错误信息里常出现 `'static` 和 `Send`。把握不住时先 `move` + `Arc`。

### 同步 vs 异步选型

| 场景 | 推荐 |
| --- | --- |
| CPU 密集计算 | 多线程（或 `rayon` 数据并行） |
| 少量并发（< 百级）连接 | 多线程，简单直接 |
| 海量并发 IO（网络服务） | async（tokio / async-std） |
| GUI、游戏 | 线程 + 事件循环 |

## 并发实践清单

- [ ] 用两个线程分别累加偶数和奇数，channel 汇总求和
- [ ] 用 `Arc<Mutex<HashMap>>` 实现多线程写入的计数器，再对比 `DashMap`
- [ ] 用 tokio 并发抓取 10 个网页（`join_all`），对比串行耗时
