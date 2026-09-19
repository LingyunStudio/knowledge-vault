---
title: 并发：线程、锁、原子与内存模型
order: 13
tags: thread, mutex, atomic, condition_variable, 数据竞争, 内存序
summary: 数据竞争的精确定义与 UB 后果、mutex 家族与死锁预防（scoped_lock 多锁、锁排序）、条件变量的谓词等待与虚假唤醒、atomic 与内存序的实用子集、async/future 的异常通道，以及一个完整的线程安全队列实现。
---

并发 bug 的可怕在于「测试通过」与「正确」彻底脱钩：数据竞争可能一万次里错一次，死锁在负载高峰才出现。C++11 起标准库提供了完整的并发设施（`<thread>` `<mutex>` `<atomic>` `<condition_variable>` `<future>`），C++11 同时定义了**内存模型**——这是 C++ 第一次回答「两个线程同时读写一块内存到底会发生什么」。本篇按「问题 → 机制 → 惯用法」展开，终点是一个可直接使用的线程安全队列。

## 1. 数据竞争：并发世界的头号 UB

**定义**：两个线程访问同一内存位置、至少一个是写、且没有同步——这三条同时成立就是数据竞争，后果是 UB（不是「读到一个随机旧值」那么简单：编译器与 CPU 都有权假设竞争不存在，重排、缓存寄存器、撕读撕写都可能）。

```cpp
int counter = 0;

// 线程 A：for (int i = 0; i < 100000; ++i) ++counter;
// 线程 B：for (int i = 0; i < 100000; ++i) ++counter;
// 结果：大概率 < 200000（++ 是 读-改-写 三步，中间被插队），且是 UB
```

「看起来跑对了」毫无意义——竞争的暴露依赖时序。检测武器：TSan（[C 篇第 13 篇](../c/13-tools-debugging.md)的 sanitizer 四件套）与代码审查。所有并发正确性的起点都是一句纪律：**任何共享可变状态，必须有同步策略（锁/原子/不可变），且策略写在类型与注释里**。

### 1.1 三条出路

| 策略       | 手段                          | 适用                         |
| ---------- | ----------------------------- | ---------------------------- |
| 不共享     | 线程各管各的数据（值语义、消息传递） | 默认首选——消灭问题本身        |
| 锁         | `mutex` 保护临界区             | 复杂不变量跨多个数据          |
| 原子       | `atomic<T>`                    | 单变量的计数/标志/指针交换    |

「不可变」（共享但不写）是第四条隐形出路：`const` 数据天然线程安全——设计时让可变状态最小化，并发 bug 面积随之最小化。

## 2. thread：启动与生命周期

```cpp
#include <thread>

void work(int id, std::string tag);

std::thread t1(work, 1, "a");              // 参数被拷贝/移动进线程
std::thread t2([] { heavy_task(); });      // lambda 也行
t1.join();                                 // 等待结束（必须显式：join 或 detach 二选一）

// C++20 的 jthread：析构自动 join + 可协作取消
std::jthread jt([](std::stop_token st) {
    while (!st.stop_requested()) step();   // 协作式取消：循环里检查
});
```

**thread 对象析构前必须 join() 或 detach()**——否则 `std::terminate`（C++11 的设计：不猜测你的意图）。这一条让裸 thread 容易在异常路径上炸（抛异常时忘了 join），所以 C++20 的 `jthread`（RAII 自动 join）应成为默认。

线程的创建成本可观（微秒级 + 栈内存），「每任务一线程」在高频场景是反模式——用线程池（第 6 节）。

## 3. mutex 家族与锁的惯用法

### 3.1 基础形制

```cpp
#include <mutex>

std::mutex m;
int shared_value = 0;

// 手动 lock/unlock：❌ 中间 return/throw 就死锁 —— 永远不用
// RAII 锁守卫：✅ 唯一正确姿势
{
    std::lock_guard lock(m);               // 构造上锁，作用域结束自动解锁（C++17 类模板推导）
    ++shared_value;
}                                          // 自动解锁

// scoped_lock（C++17）：一次锁多个，内部用避免死锁的算法
std::mutex ma, mb;
void transfer(Account &a, Account &b, double amt) {
    std::scoped_lock lock(a.m, b.m);       // 两把锁按全局算法获取 —— 天然无死锁
    a.balance -= amt;
    b.balance += amt;
}
```

锁粒度的两难：粒度太细（每变量一把）→ 不变量跨多变量时保护不了；太粗（全局一把）→ 并发度归一。经验：**锁保护的是「不变量」，不是「变量」**——先写出「这个不变量要求这些数据一起原子地改」，锁的范围就是它们。

### 3.2 死锁的成因与预防

死锁四条件（互斥、持有并等待、不可剥夺、循环等待）里工程上能掐死的是**循环等待**——全局锁排序：

```cpp
// 危险：线程1 lock(a) → lock(b)；线程2 lock(b) → lock(a) —— 循环等待，死锁
// 解法①：scoped_lock(ma, mb) —— 标准库用死锁避免算法
// 解法②：全局锁序 —— 一律先锁「地址小」的 mutex：
if (&ma > &mb) std::swap(ma, mb);
std::lock_guard l1(ma), l2(mb);
// 解法③：std::lock(ma, mb) + adopt_lock —— 先全拿再接管
```

再加两条纪律：**持锁时不调用未知代码**（回调/虚函数可能反手锁别的锁）；**锁内不做慢操作**（IO、分配尽量移出临界区）。

## 4. condition_variable：等待「条件成立」

互斥锁解决「独占」，条件变量解决「等待某条件再继续」：

```cpp
#include <condition_variable>

std::mutex m;
std::condition_variable cv;
std::queue<Job> jobs;
bool done = false;

// 消费者
void worker() {
    std::unique_lock lock(m);                       // 必须配 unique_lock（wait 要解锁）
    cv.wait(lock, [] { return !jobs.empty() || done; });
    // wait 的三步曲：检查谓词 → 不满足则原子地「解锁+睡眠」→ 唤醒后重加锁再查谓词
    // 谓词版本 = 循环 + 谓词检查，自动处理虚假唤醒
    while (!jobs.empty()) { process(jobs.front()); jobs.pop(); }
}

// 生产者
void submit(Job j) {
    {
        std::lock_guard lock(m);
        jobs.push(std::move(j));
    }                                                // 先解锁再通知（减少唤醒方空转）
    cv.notify_one();                                 // 或 notify_all
}
```

三个必须理解的细节：

1. **虚假唤醒**（spurious wakeup）：wait 可能在无人 notify 时醒来——这是底层 futex 允许的行为，**必须用谓词版 wait**（裸 wait + 标志位是 bug）。
2. **notify 在解锁后**：持锁 notify 会让被唤醒者立刻撞上锁空转。
3. **谓词必须涵盖所有唤醒原因**（新任务、退出信号）——`done` 标志让消费者能退出而不是永远等。

条件变量的完整正确性靠「锁 + 谓词 + notify」三方配合，任何一方缺失都是经典死锁/丢失唤醒——这也是为什么现代代码倾向用更高层封装（线程池队列、channel、futures）。

## 5. atomic：无锁的单变量同步

```cpp
#include <atomic>

std::atomic<int> counter{0};
++counter;                                    // 原子的读-改-写
counter.fetch_add(1, std::memory_order_relaxed);

std::atomic<bool> ready{false};
// 线程A：data = 42; ready.store(true);
// 线程B：while (!ready.load()); use(data);    —— 这个正确性靠内存序（下节）

// CAS：比较交换 —— 无锁算法的基石
int expected = old_value;
if (counter.compare_exchange_strong(expected, new_value)) { /* 成功 */ }
else { /* 失败：expected 被更新为当前值，重试 */ }
```

atomic 的边界要刻准：

- **它只保证单个操作的原子性与可见性**——`std::atomic<Counter>` 内含两个字段时，`++a.x; ++a.y` 仍是两步，跨字段不变量必须用锁。
- `std::atomic<shared_ptr<T>>`（C++20）存在但成本高；共享指针的并发交换惯用 `std::atomic<std::shared_ptr<T>>::exchange` 或锁。
- **atomic 不便宜**：x86 上涉及 cache line 的全局同步（MESI 协议），seq_cst 还带全屏障。「原子一定比锁快」是谣言——复杂无锁算法常常输给一把好锁。**默认用锁，单变量场景才用原子**。

### 5.1 内存序：实用子集

内存序回答「这个原子操作前后的**其他**内存读写，别的线程按什么顺序看到」：

| 内存序            | 含义（实用版）                                   | 典型用途                   |
| ----------------- | ------------------------------------------------ | -------------------------- |
| `seq_cst`（默认） | 全局统一顺序，最强最易推理                        | 默认选择                   |
| `acquire`/`release` | release 写之前的所有写，对 acquire 读之后的代码可见 | 「发布数据」：标志 + 载荷    |
| `relaxed`         | 只保证本操作原子，不管顺序                        | 纯计数器（不需要同步其他数据） |

```cpp
// acquire/release 的「发布」范式：
// 线程A：payload = 42;                        // 普通写
//        ready.store(true, std::memory_order_release);   // 发布：之前的写对 acquire 可见
// 线程B：while (!ready.load(std::memory_order_acquire));  // 获取
//        use(payload);                        // 保证看到 42
```

规约：**默认 seq_cst；profiling 证明热点后，才考虑 acquire/release；relaxed 只用于「计数但不同步」**。内存序的推理极容易错——大多数项目正确答案就是「全 seq_cst + 锁」。

## 6. future/promise：带返回值的异步

```cpp
#include <future>

// async：最简单的异步 —— 返回 future，结果/异常都由它搬运
auto fut = std::async(std::launch::async, [] { return heavy_compute(); });  // 立即起线程
// std::async(launch::deferred, ...)：惰性，get() 时在同线程执行

do_other_work();
int result = fut.get();                       // 等待 + 拿结果；工作线程的异常在这里重抛！

// promise：手动喂数据（线程间单次交接）
std::promise<int> p;
auto pf = p.get_future();
std::thread producer([&p] {
    try { p.set_value(compute()); }
    catch (...) { p.set_exception(std::current_exception()); }   // 异常也能交接
});
int v = pf.get();
```

`future::get()` 是「异常穿越线程」的标准通道（[第 11 篇](11-errors-exceptions.md)）——工作线程的异常被存进共享状态，get 处原样重抛。这解决了「异常不能跨线程边界」的根本限制。

`std::async` 的一个著名陷阱：**不指定 launch 策略时（默认）可能延迟执行**，且返回的 future 析构会阻塞等待（策略为 async 时）——「async 却变成同步」的根源。生产代码用显式 `std::launch::async` 或线程池。

### 6.1 完整示例：线程安全的有界阻塞队列

把前面所有机制装配成一个生产-消费队列（线程池的核心组件）：

```cpp
#include <deque>
#include <mutex>
#include <condition_variable>
#include <optional>

template <typename T>
class BlockingQueue {
public:
    explicit BlockingQueue(size_t cap) : cap_(cap) {}

    void push(T item) {
        std::unique_lock lock(m_);
        not_full_.wait(lock, [this] { return q_.size() < cap_ || closed_; });  // 有界：满了等
        if (closed_) return;
        q_.push_back(std::move(item));
        not_empty_.notify_one();
    }

    std::optional<T> pop() {                       // 关闭后返回 nullopt（消费者退出信号）
        std::unique_lock lock(m_);
        not_empty_.wait(lock, [this] { return !q_.empty() || closed_; });
        if (q_.empty()) return std::nullopt;       // 关闭且取空
        T item = std::move(q_.front());
        q_.pop_front();
        not_full_.notify_one();
        return item;
    }

    void close() {
        { std::lock_guard lock(m_); closed_ = true; }
        not_empty_.notify_all();
        not_full_.notify_all();                    // 唤醒所有等待者处理关闭
    }

private:
    std::mutex m_;
    std::condition_variable not_empty_, not_full_;
    std::deque<T> q_;
    size_t cap_;
    bool closed_ = false;
};
```

这个类的每个设计点都对应本篇的一个知识点：RAII 锁守卫、谓词版 wait（防虚假唤醒）、双条件变量（满/空各自等待）、关闭信号与 notify_all（消费者退出协议）、move 语义减少拷贝。线程池 = 固定 worker 线程循环 `pop()` + 任务分派——绝大多数业务场景，这个级别的封装就是并发架构的全部。

## 7. 陷阱清单

- 裸 thread 异常路径不 join：terminate；jthread 或包装。
- 数据竞争靠「测过了」放行：UB 且时序依赖；TSan + 审查。
- 手动 lock/unlock 配对：异常即死锁；RAII 守卫。
- 裸 wait 不带谓词：虚假唤醒破坏逻辑；谓词版 wait。
- notify 在持锁时：唤醒方空转；解锁后通知。
- 锁内调用未知回调：反向锁序死锁；持锁不调未知代码。
- 多锁获取顺序不定：全局排序或 scoped_lock。
- atomic 保护多字段不变量：只保证单操作；不变量跨字段用锁。
- 默认 async 不带策略：可能 deferred；显式 launch::async 或线程池。
- 线程函数里未捕获异常：terminate；future 通道或边界 catch。
- volatile 当同步：不保证原子性/可见性（[C 篇](../c/14-pitfalls.md)）；用 atomic。
- 线程池 = 每任务一线程：创建成本吞掉并行收益；有界队列 + 固定 worker。

## 8. 小结

- 数据竞争的三要素（共享 + 写 + 无同步）触发 UB；出路四条：不共享（默认）、不可变、锁、原子。
- thread 必须显式 join/detach（否则 terminate）；jthread 是 RAII 化的默认；线程创建贵，池化是常态。
- 锁保护不变量而非变量：RAII 守卫是唯一姿势，多锁用 scoped_lock/全局排序防死锁，持锁不调未知代码。
- 条件变量的正确三角：unique_lock + 谓词版 wait（防虚假唤醒）+ 解锁后 notify；关闭协议用标志 + notify_all。
- atomic 服务单变量：计数 relaxed、发布 acquire/release、默认 seq_cst；跨字段不变量回到锁；「原子比锁快」未必。
- future/promise 是值与异常的线程通道；async 必须显式策略；有界阻塞队列是并发惯用法的集大成者。

## 9. 练习

**1.** 写两个线程各 ++ 一个非原子 int 十万次，运行多次观察结果偏差；再换 `std::atomic<int>` 验证；最后用 TSan（-fsanitize=thread）跑非原子版看报告。

> [!TIP]
> 思路非原子版结果 < 200000 且每次不同（++ 的读改写被插队）；atomic 版恒 200000；TSan 精确报告竞争的两个访问点与线程栈。三步实验分别对应「现象 → 修复 → 工具验证」，是并发调试的完整闭环。

**2.** 用第 6 节的 BlockingQueue 实现一个线程池：N 个 worker 线程 + submit(返回 future 的任务)。对比「每任务一线程」处理 10⁴ 个小任务的耗时。

> [!TIP]
> 思路submit 用 promise/packaged_task 把返回值变成 future；worker 循环 pop 执行。每任务一线程版 10⁴ 次线程创建（微秒级 × 10⁴）远慢于池化。加分：worker 异常处理（任务抛异常不能弄死 worker）。

**3.** 制造一个死锁（两线程交叉锁两把 mutex，中间 sleep 提高概率），用三种方式修复：scoped_lock、全局锁序、std::lock+adopt，对比可读性。

> [!TIP]
> 思路修复前程序偶发卡死（attach 调试器看两线程栈即死锁现场）。scoped_lock 一行最干净；锁序法要维护「排序约定」的全局纪律；std::lock 是前两者的底层。教训：死锁的修复都在「获取顺序」上，而 scoped_lock 把这个问题整个外包给标准库。

**4.** 用 acquire/release 重写「配置热更新」：后台线程加载新配置（普通写）后 release 发布指针，工作线程 acquire 读取，验证总能看到完整一致的配置。

> [!TIP]
> 思路`std::atomic<Config*> current{nullptr}`；写方：构建完整新 Config（局部）→ current.store(p, release)；读方：`auto *c = current.load(acquire)` → 安全读全部字段。release 保证「指针发布前 Config 的全部写对 acquire 方可见」——发布范式的标准应用。注意旧 Config 的回收（引用计数或 epoch，这里可讨论 RCU 思想）。

**5.** 讨论：为什么 `std::atomic<std::vector<int>>` 不存在，而 `std::atomic<std::shared_ptr<T>>`（C++20）存在但昂贵？从「原子操作能做什么」的机器层面分析。

> [!TIP]
> 思路原子操作本质是单次不可分割的访存/交换（一个 cache line 内的指令）；vector 含堆指针+动态数据，「原子的 vector」需要锁住整个内部结构——那已经是锁的领域。shared_ptr 原子化只交换控制块指针（单指针 CAS 可行），代价是控制块访问的原子计数竞争。结论：atomic 的适用域是「指针/整数级别」，复合结构用锁或不可变数据 + 指针发布。

**6.** 给第 6 节的队列加「带超时的 pop」（`try_pop_for`），用条件变量的 timed_wait 实现，并说明超时语义在「关闭竞争」场景下的正确行为。

> [!TIP]
> 思路`cv.wait_for(lock, dur, pred)` 返回谓词状态；超时后重新检查 closed_（防止「正好在超时瞬间关闭」的竞态丢失退出信号）。要点：超时是「多一次检查机会」，不是「替代谓词检查」——谓词检查永远优先，这是所有带超时等待的实现纪律。
