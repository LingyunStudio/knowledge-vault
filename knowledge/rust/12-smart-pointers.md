---
title: 智能指针：所有权的扩展
order: 12
tags: Box, Rc, RefCell, Arc, Mutex
summary: 智能指针的本质（指针 + 所有权/借用语义的封装）、Box 的堆分配与递归类型、Rc 引用计数的多所有者、RefCell 的运行时借用检查（内部可变性）、Weak 破循环引用、Arc+Mutex 的线程安全组合——以及「默认不需要智能指针」的诊断意识。
---

Rust 的所有权系统让「一个值一个主人」成为默认——但真实世界有「多个主人」（共享配置）与「内部可变」（缓存）的需求。**智能指针**是标准库给的所有权扩展件：**Box**（转移到堆）、**Rc**（引用计数的共享所有权）、**RefCell**（运行时借用检查的内部可变性）、**Arc/Mutex**（线程安全版，[第 13 篇](13-concurrency.md)）。

## 1. Box<T>：堆分配

```rust
let b = Box::new(5);              // 5 放到堆上，b 是栈上的指针
println!("{b}");                   // 解引用透明（Deref）

enum List {                        // ★ 递归类型：必须 Box（否则大小无限递归）
    Cons(i32, Box<List>),
    Nil,
}
```

Box 的三个用途：**堆上放大对象**（避免栈拷贝）、**递归类型**（编译期大小必须已知——Box 打断递归）、**trait 对象**（`Box<dyn Trait>`，[第 10 篇](10-generics-traits.md)）。Box 的语义仍是「唯一所有权」——只是数据住在堆上。

## 2. Rc：引用计数的共享所有权

```rust
use std::rc::Rc;

let shared = Rc::new(String::from("配置"));     // 所有者 1
let a = Rc::clone(&shared);                      // ★ clone = 计数 +1（不是深拷贝！）
let b = Rc::clone(&shared);                      // 所有者 3
println!("{}", Rc::strong_count(&shared));       // 3

// a、b、shared 都能读——最后一个 drop 时数据释放
```

Rc（Reference Counted）打破「唯一所有者」的规则：**计数式多所有者**——clone 只是计数递增（廉价），计数归零才释放。「只读共享」的形态（Rc 的内容不可变——除非配合 RefCell）。

```rust
// 场景：多个节点共享同一个配置对象
struct Node {
    config: Rc<Config>,       // 每个节点 clone 同一个 Rc（同一份 Config）
}
```

与 [python 的引用计数](../python/01-python-model.md)对照：python 的每个对象都是 Rc（透明的、有 GC 兜循环）——Rust 的 Rc 是**显式选择的**（类型签名可见）且**没有 GC 兜循环**——循环引用会真泄漏（Weak 是解药）。

## 3. RefCell：运行时借用检查（内部可变性）

```rust
use std::cell::RefCell;

let data = RefCell::new(vec![1, 2, 3]);
data.borrow_mut().push(4);          // 运行时借用检查：借用规则不变，检查时机移到运行时
let sum: i32 = data.borrow().iter().sum();
```

借用规则（[第 5 篇](05-borrowing.md)的「要么多读要么一写」）不变——RefCell 把检查从**编译期移到运行时**：违反规则 panic（而不是编译错误）。这换来的是「&self 方法内部修改数据」的能力——**内部可变性**（interior mutability）：

```rust
struct Cache {
    data: RefCell<HashMap<String, String>>,    // 外部只读接口、内部可变
}
impl Cache {
    fn get(&self, key: &str) -> String {       // &self！但内部缓存被更新
        self.data.borrow_mut().entry(key.into()).or_insert_with(|| load(key)).clone()
    }
}
```

缓存、观察者、自引用——「逻辑上只读、实现上要写」的场景是 RefCell 的正当用武之地（[python 的对象可变默认](../python/07-classes.md)在 Rust 需要 RefCell 显式化）。代价：**借用错误从编译期变成运行时 panic**——它是「借用检查器的逃生舱」，不是默认路线。

### 3.1 Rc<RefCell<T>>：共享 + 可变

```rust
let shared = Rc::new(RefCell::new(0));          // 多所有者 + 可变
let a = Rc::clone(&shared);
*a.borrow_mut() += 1;                            // 任一所有者都能改
```

「多个所有者、其中一个想改」的组合标配——但也意味着**编译期借用检查的完全退场**（运行时 panic 风险）+ **非线程安全**（多线程用 Arc<Mutex>）。诊断意识：`Rc<RefCell<T>>` 出现频率高时，先怀疑数据流设计（[第 6 篇](../c/07-dynamic-memory.md)的引用计数循环引用风险同款）。

## 4. Weak：打破循环引用

```rust
use std::rc::{Rc, Weak};

struct Node {
    next: RefCell<Option<Rc<Node>>>,     // 强引用：拥有
    prev: RefCell<Option<Weak<Node>>>,   // ★ 弱引用：观察不拥有
}
// 双向链表：next 用 Rc、prev 用 Weak —— 计数不归零的循环被打破
// weak.upgrade() -> Option<Rc<T>>：访问时「还活着就拿 Rc」
```

循环引用（A→B→A 的 Rc）让计数永不归零 → 泄漏——Weak 提供不增加强计数的引用（`upgrade()` 尝试升级，[python weakref](../python/01-python-model.md)、[C++ weak_ptr](../cpp/06-smart-pointers.md) 的同款机制）。所有权方向单向（强）、反向与观察用 Weak——与[智能指针的所有权决策树](../cpp/06-smart-pointers.md)完全同构。

## 5. Arc<Mutex<T>>：线程安全组合（预览）

```rust
use std::sync::{Arc, Mutex};

let counter = Arc::new(Mutex::new(0));      // Arc：原子计数的 Rc（跨线程）
let handles: Vec<_> = (0..10).map(|_| {
    let c = Arc::clone(&counter);
    std::thread::spawn(move || {             // move：所有权进线程
        *c.lock().unwrap() += 1;             // Mutex：互斥访问（lock 得守卫，离开释放）
    })
}).collect();
for h in handles { h.join().unwrap(); }
println!("{}", *counter.lock().unwrap());    // 10 —— 数据竞争在编译期不可能
```

Arc（原子 Rc）+ Mutex（互斥锁）是「跨线程共享可变状态」的标准组合——数据竞争的防御从[运行时锁纪律](../cpp/13-concurrency.md)变成**类型系统**（非 Arc/Mutex 包装的数据根本进不了线程）。完整展开在[第 13 篇](13-concurrency.md)。

## 6. 陷阱清单

- 默认路径用智能指针（Box 满天飞）：先用栈/所有权；智能指针是扩展件。
- Rc 的循环引用泄漏：Weak 打破；所有权图无环（[第 6 篇](../cpp/06-smart-pointers.md)）。
- RefCell 的 borrow_mut 冲突 panic：运行时借用规则；借用区间不重叠（[第 5 篇](05-borrowing.md)规则的运行时版）。
- Rc 跨线程（Send 未实现编译错）：Arc；「Rc ≠ 线程安全」是编译器告诉你的。
- Arc<Mutex> 满天飞（先怀疑设计）：能转移所有权（channel）就别共享；锁粒度（[第 13 篇](13-concurrency.md)）。
- Deref 强制的滥用（自定义 Deref 做隐式转换）：它是给智能指针的机制不是泛型转换工具。

## 7. 小结

- 智能指针是「所有权的扩展件」：Box（堆/递归）、Rc（共享只读）、RefCell（内部可变）、Arc+Mutex（跨线程共享可变）——每个都有明确的适用面。
- Rc 的 clone 是计数不是拷贝；计数归零释放；循环引用靠 Weak 打破——「所有权图有向无环」纪律。
- RefCell 把借用检查移到运行时：内部可变性（&self 接口内改数据）的正当用例；滥用=失去编译期保证。
- Rc<RefCell<T>> 的出现频率是数据流设计的警报器——先重新设计所有权流向，再用内部可变性。
- Arc<Mutex> 把数据竞争变成编译期不可能——Rust 并发安全的类型学入口（[第 13 篇](13-concurrency.md)）。

## 8. 练习

**1.** Box 与递归：先写「不用 Box 的链表枚举」观察编译错误（recursive type），加 Box 修复——理解「编译期大小已知」的约束与 Box 打断递归的机制。

> [!TIP]
> 思路错误信息「recursive type has infinite size」直指根因——Box 把「指针大小」放进类型。对照 [C 的指针实现链表](../c/04-pointers.md)：C 天然用指针、Rust 默认值语义需要显式堆化。

**2.** 循环引用泄漏实验：Rc 循环（两个对象互持）→ 用 Rc::strong_count 观察永不归零 → drop 后数据仍在（泄漏）→ 改 Weak 修复——与 [python 的循环引用 GC](../python/01-python-model.md) 对照。

> [!TIP]
> 思路Rust 的 Rc 无 GC 兜底——循环=泄漏（Valgrind/计数验证）。python 有分代 GC 收循环，但代价是运行时；Rust 把「避免循环」交给类型设计（Weak）。两种 trade-off 各有代价。

**3.** RefCell 的运行时借用实验：同一作用域内两个 borrow_mut（第二个 panic）——观察运行时借用规则与编译期规则的同一性；用收窄借用区间修复。

> [!TIP]
> 思路panic 信息「already borrowed」就是借用规则的运行时版本——错误从编译期搬到运行时是 RefCell 的全部代价。修复手法与[编译期借用冲突](05-borrowing.md)一致。

**4.** 缓存实践：用 RefCell<HashMap> 实现一个「&self 接口的 memoize」（重复查询走缓存），对比「&mut self 接口」的设计——分析「内部可变性」换来了什么接口便利、付出了什么安全代价。

> [!TIP]
> 思路&self 接口让调用方不需要 mut 上下文（trait 对象/并发友好的外观）——代价是运行时借用与线程不安全。「外观不可变 + 内部可变」的模式在 RwLock/Mutex 上是线程安全版（[第 13 篇](13-concurrency.md)）。

**5.** Arc<Mutex> 计数器（本篇第 5 节）扩展成「多线程词频统计」：多个线程处理不同文本块 → 各自更新共享 HashMap（Mutex 包住）→ 汇总——预热[第 13 篇](13-concurrency.md)。

> [!TIP]
> 思路粒度实验：单把大锁 vs 分片锁（按首字母分 N 个 Mutex）的吞吐对比——锁粒度设计的入门（[第 13 篇](13-concurrency.md)展开）。所有权（Arc clone 进线程）与锁（Mutex 守卫）双轨的协作。

**6.** 讨论：Rust 的智能指针为什么「类型显式」而 GC 语言「运行时透明」？从「所有权语义的可读性（签名即文档）」「确定性释放的保持」「性能（无 GC 停顿）」三个角度分析，并回答「什么时候我应该怀疑自己在滥用 Rc<RefCell>」——智能指针的「代码坏味道」清单。

> [!TIP]
> 思路显式智能指针让「共享/可变/线程」的决策进入类型签名（编译器与读者都可见）；GC 语言把它藏进运行时（代码更简洁、语义更隐式）。Rc<RefCell> 的坏味道清单：出现次数多、跨函数边界传播、用于「只是想改个字段」的场景——回到数据流设计。
