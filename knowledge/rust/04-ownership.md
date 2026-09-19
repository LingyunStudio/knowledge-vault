---
title: 所有权：三条规则与 Move
order: 4
tags: 所有权, Move, Copy, Clone, Drop
summary: 所权三规则（唯一所有者/作用域释放/转移时失效）、Move 语义的精确行为、Copy 与 Clone 的类型分层、函数间所有权的流动模式、Drop 与确定性释放，以及「借用检查器报错其实是所有权设计问题」的诊断视角。
---

所有权是 Rust 的第一性原理：**每一份数据在任一时刻都有唯一的「所有者」（owner）**，所有者离开作用域时数据被自动释放。这条规则（编译器强制）直接消灭了「谁来释放这块内存」的四十年难题——[C 的手动 free](../c/07-dynamic-memory.md)、[C++ 的 RAII 约定](../cpp/04-raii.md)、GC 语言的运行时回收，在 Rust 都被「所有权类型系统」收编。

## 1. 三条规则

```rust
{
    let s = String::from("hello");   // ① s 拥有这个字符串（堆上的数据）
    use_it(&s);
}                                    // ② s 离开作用域 → drop 自动调用 → 内存释放
```

1. Rust 中每个值都有一个**所有者**（owner）。
2. 同一时刻**只能有一个**所有者。
3. 所有者离开作用域，值被**丢弃**（drop）。

这三条规则由编译器静态检查——没有运行时开销，也没有 GC。String 在这里的关键：它是「指针 + 长度 + 容量」的结构，**指向堆上的数据**——所有权讨论的就是「堆数据的归属」。

## 2. Move：赋值即转移

```rust
let s1 = String::from("hello");
let s2 = s1;                          // ★ Move：所有权从 s1 转移到 s2
// println!("{s1}");                  // ❌ 编译错误：s1 已失效（value borrowed after move）

println!("{s2}");                     // ✅ s2 是当前所有者
```

赋值 `let s2 = s1` 不是 [C 的拷贝](../c/02-types.md)也不是引用——是**所有权的转移**：s1 交出所有权后「失效」（编译器拒绝再使用它）。为什么这样设计？如果允许 s1、s2 同时「拥有」同一块堆内存，作用域结束时就会**双重释放**（double free）——Move 语义用「转移后失效」在编译期杜绝了它：

```text
let s1 = ...     栈: [ptr|len|cap] ──→ 堆: "hello"     s1 拥有
let s2 = s1      栈: s1 的三个字段**复制**到 s2（浅拷贝），
                 但编译器把 s1 标记为失效 → 只有一个所有者（s2）
                 → 作用域结束时只有一次 free
```

「浅拷贝字段 + 失效原绑定」——这就是 Move 的全部机器行为。与 [C++ 的 move](../cpp/05-copy-move.md) 对比：C++ 的 move 是可选优化（移动后对象状态依赖实现），Rust 的 move 是**默认语义 + 编译期强制失效**。

## 3. Copy：哪些类型不 Move

```rust
let x = 5;
let y = x;              // ✅ Copy 类型：按位拷贝，x 仍然可用
println!("{x} {y}");    // 5 5

// 实现 Copy 的类型：整数/浮点/bool/char/不可变引用/全 Copy 字段的元组与数组
let point = (1.0, 2.0);
let p2 = point;          // Copy：元组全是 f64
```

Copy 类型是「栈上的小数据」——按位拷贝比转移更自然，且没有堆资源需要双重释放的担忧。规则一句话：**有堆资源的类型（String/Vec/Box）不 Copy（Move）；纯栈类型 Copy**。类型自己不能「既 Copy 又 Drop」（会双重释放——语言禁止）。

### 3.1 Clone：显式的深拷贝

```rust
let s1 = String::from("hello");
let s2 = s1.clone();        // ★ 显式深拷贝：堆数据也复制一份
println!("{s1} {s2}");      // 两个都可用——各自拥有自己的数据
```

`.clone()` 让「我确实要两份」**显式化**——代码评审一眼看到深拷贝的成本点。与 [GC 语言](../python/01-python-model.md)的对照：python 里 `list(a)` 也是显式拷贝，但 GC 语言不强制（共享是常态），Rust 的 Move 默认把「共享还是拷贝」变成每次赋值都要回答的问题——**这就是「显式化」的工程价值**。

## 4. 函数与所有权的流动

```rust
fn take_ownership(s: String) {          // s 进函数：所有权移交
    println!("{s}");
}                                        // s 离开作用域 → 释放

fn give_back() -> String {              // 返回值：所有权移交出去
    String::from("created here")
}

fn take_and_give(s: String) -> String {  // 进来再出去（转移）
    s + "!"
}

fn main() {
    let s = give_back();                 // 获得所有权
    take_ownership(s);                   // 交出去（s 失效）
    let t = take_and_give(give_back());  // 链式转移：赋值即交接
}
```

函数边界的所有权语义：**参数收走、返回值交出**——数据的生命周期沿着调用链清晰流动。三类常见「为什么编译不过」的现场：

```rust
// ① 忘了 move 失效：把所有权交出去后继续用
let s = String::from("x");
take_ownership(s);
println!("{s}");                        // ❌ —— 修法：take_ownership(s.clone()) 或传引用

// ② 函数返回内部创建的引用
fn dangle() -> &String {
    let s = String::from("x");
    &s                                  // ❌ 返回后 s 释放 → 悬垂引用（编译拒绝）
}                                       // 修法：返回 String（所有权带出来）

// ③ 临时值活得不够久
let r = &make_string();                 // ❌ 临时值在语句结束即释放
```

「修法」的方向暴露了所有权设计的思维：**要么 clone（付拷贝成本）、要么传引用（不转移，[第 5 篇](05-borrowing.md)）、要么调整所有权流向（让数据活得够久）**。

## 5. Drop：确定性释放

```rust
struct TempFile { path: String }

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);   // 自动清理
        println!("已删除 {}", self.path);
    }
}

fn main() {
    {
        let _t = TempFile { path: "tmp.txt".into() };
        // ... 使用 ...
    }                                    // ← 作用域结束：drop 自动执行（逆序释放）
}
```

Drop trait 是 [C++ RAII](../cpp/04-raii.md) 在 Rust 的**语言级形态**：资源（文件/锁/连接）绑定类型的 drop——「忘记释放」在 Rust 不是 bug 类型。释放顺序是**逆序**（后构造先析构，与 [C++](../cpp/03-classes.md) 一致）——依赖关系的正确性由顺序保证。

```rust
let f = File::open("a.txt")?;           // 文件：作用域结束自动 close
let _guard = mutex.lock().unwrap();      // 锁：作用域结束自动解锁（[第 13 篇](13-concurrency.md)）
```

## 6. 陷阱清单

- 到处 clone 绕过 Move 错误：编译过了但失去所有权设计；先想「谁该拥有」。
- 以为 Copy 类型也会 Move（或反之）：按「有无堆资源」记忆；自定义类型 `#[derive(Copy, Clone)]` 仅当全字段 Copy。
- 误以为 `let s2 = s1` 后 s1 是旧值（GC 直觉）：Move 后 s1 编译期失效。
- 期待「Move 后 s1 指向的数据被清空」：Move 只标记失效，不擦内存（安全由「不可用」保证）。
- 返回内部引用修成 clone 之前先想所有权流向（返回 String 而不是 &String）。
- Drop 里 panic：展开中的二次 panic → abort；drop 只做可靠清理。
- 把 Move 后的变量再绑定（`let s = s;` 也不行）：失效是终局的，重新赋值 `let mut s; s = ...` 才行。

## 7. 小结

- 所有权三规则（唯一所有者/同刻一个/作用域释放）由编译器静态强制——「谁负责释放」从纪律变成类型系统。
- Move 是赋值的默认语义：浅拷贝字段 + 原绑定失效——双重释放从编译期消失；Copy 类型（纯栈数据）按位拷贝；Clone 显式深拷贝。
- 函数边界 = 所有权交接点：参数收走、返回交出；「编译不过」的三类现场各有三种修法（clone/引用/调流向）。
- Drop 是语言级 RAII：资源与作用域绑定、逆序确定性释放——「忘记释放」与「忘记解锁」在 Rust 不是 bug 类型。
- 与借用检查器的搏斗是「所有权设计」的学习过程——修法的思考顺序（改流向 > 传引用 > clone）就是性能与正确的平衡。

## 8. 练习

**1.** 在 C++ 里写一个 double free（手动 delete 两次或浅拷贝对象），观察崩溃；在 Rust 里写对应代码观察编译拒绝——两类语言对同一错误的两层防御对照。

> [!TIP]
> 思路C++ 的浅拷贝 + 析构（[第 3 篇](../cpp/03-classes.md)的 Connection 案例）是 double free 经典；Rust 的 `let s2 = s1` 直接把 s1 失效——「事后崩溃检测 vs 事前编译拒绝」的分层对照。

**2.** 所有权流向实验：写一个函数「接收 String 并返回处理后的 String」的三种实现（收走再还/传引用原地改/收走返回新的），各自标注所有权流动图——总结每种的最适场景。

> [!TIP]
> 思路`fn f(s: String) -> String`（重用缓冲，链式处理）、`fn f(s: &mut String)`（调用方保留所有权、原地修改）、`fn f(s: &str) -> String`（借用输入、新建输出）。三形态覆盖 90% 的字符串处理接口设计。

**3.** Drop 练习：写一个「计时器」类型（Drop 时打印耗时）与「锁守卫」（Drop 时解锁），嵌套使用验证逆序释放——用打印顺序证明 Drop 的确定性。

> [!TIP]
> 思路逆序打印就是「栈式资源管理」的活演示。对照 [python 的 with](../python/10-files-context.md)（显式作用域）与 [Go 的 defer](../python/09-errors-exceptions.md)（函数级）——Rust 的作用域级 drop 是三者中最自动的。

**4.** 「编译不过诊断」练习：写三个编译失败的片段（move 后使用/返回内部引用/临时值借用），不看编译器提示自己先诊断原因，再对照编译器的建议——训练「所有权问题」的诊断直觉。

> [!TIP]
> 思路诊断的三个问题：这个值的所有者是谁？它还活着吗？我要的是所有权还是借用？——三问的答案就是修复方向。与 [C 指针三问](../c/04-pointers.md)（非空/存活/界内）形成跨语言的方法论对照。

**5.** Copy 边界实验：`#[derive(Copy, Clone)]` 一个含 String 字段的结构体观察编译错误——理解「Copy 与 Drop 互斥」的规则，再设计「含堆资源的类型」的正确复制方式（Clone）。

> [!TIP]
> 思路含 String 的类型不能 Copy（双重释放风险）——这正是「Copy=纯栈」规则的构成性证明。Clone 的显式性让深拷贝成本在代码里可见。

**6.** 讨论：为什么 Rust 选择「Move 默认」而不是「Copy 默认（像 GC 语言）」或「引用默认」？从「默认值的性能语义」（Copy 默认=每次深拷贝的意外成本/引用默认=生命周期不明）与「双重释放的编译期杜绝」分析默认值设计，对照 [C++ 的三态并存](../cpp/05-copy-move.md)与 [python 的引用默认](../python/01-python-model.md)。

> [!TIP]
> 思路默认值决定了「程序员的默认心智模型」：Move 默认让「交接」显式（性能语义清晰）、引用默认（python）让共享显式但生命周期失控、Copy 默认让性能不可控。Rust 的选择是「系统语言的性能语义 + 类型系统的安全网」的组合——默认值即语言哲学。
