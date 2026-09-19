---
title: 闭包与迭代器：零成本的函数式
order: 11
tags: 闭包, 迭代器, Fn, move, 惰性
summary: 闭包的捕获三模式（借用/可变/所有权与 move 关键字）、Fn/FnMut/FnOnce 三 trait 的语义、迭代器 trait 与适配器的惰性管道、collect 的类型目标、以及「迭代器链编译成循环」的零成本验证。
---

Rust 的函数式两面：**闭包**（捕获环境的匿名函数）与**迭代器**（惰性的序列管道）。两者在 Rust 里的特点是**零成本**——迭代器链编译后就是手写的循环（无装箱、无虚表、可内联），[C++ range](../cpp/09-stl-algorithms.md) 的理想形态。

## 1. 闭包：捕获环境的函数

```rust
let factor = 2;
let scale = |x: i32| x * factor;        // 闭包：捕获了 factor
assert_eq!(scale(10), 20);

// 完整语法（类型通常省略——推断自使用处）
let add = |a: i32, b: i32| -> i32 { a + b };
```

闭包与函数的区别只有一条：**闭包能捕获定义处的变量**。捕获有三种模式（按需自动选择，可显式）：

| 模式    | 闭包做了什么         | 对应 trait |
| ----- | -------------- | -------- |
| 不可变借用 | 只读捕获的变量        | `Fn`     |
| 可变借用  | 修改捕获的变量        | `FnMut`  |
| 所有权   | **move**：把变量收走 | `FnOnce` |

```rust
let name = String::from("alice");
let greet = || println!("{name}");            // Fn：只读借用
greet(); println!("{name}");                   // name 还在

let mut count = 0;
let mut incr = || count += 1;                 // FnMut：可变借用（闭包本身要 mut）
incr(); incr();

let data = vec![1, 2, 3];
let owned = move || println!("{:?}", data);   // ★ move：强制拿所有权（data 失效）
```

**move 关键字**是「闭包活过捕获变量」的必需品：线程（[第 13 篇](13-concurrency.md)）、异步任务（[第 13 篇](13-concurrency.md)）把闭包送到别处执行——捕获的借用会悬垂，`move` 让闭包收走所有权（[第 6 篇](06-lifetimes.md)标注复杂度的工程出口之一）。

Fn/FnMut/FnOnce 三兄弟是「闭包的能力契约」（trait 的另一个用场，[第 10 篇](10-generics-traits.md)）：**FnOnce（消费捕获，只能调一次）→ FnMut（可变借用，可多次）→ Fn（只读，任意次）**——函数签名按需声明（`impl Fn(&str) -> bool` 接受只读闭包）。

## 2. 迭代器：惰性的序列

```rust
let v = vec![1, 2, 3, 4, 5];

// 迭代器的核心：next() 返回 Some(元素) / None（耗尽）
let mut it = v.iter();
assert_eq!(it.next(), Some(&1));
assert_eq!(it.next(), Some(&2));

// for 循环就是迭代器的语法糖
for x in &v { }          // 等价 while let Some(x) = it.next()
```

`Iterator` trait 只有一个必须方法（next），一切高级能力都由**适配器**组合：

```rust
let result: Vec<i32> = v.iter()
    .filter(|&&x| x % 2 == 0)        // 适配器：过滤（惰性！）
    .map(|&x| x * 10)                 // 适配器：变换（惰性！）
    .take(2)                           // 适配器：取前 2
    .collect();                        // 消费者：真正驱动整个管道
```

**适配器全是惰性的**——`.filter().map()` 不做任何计算，只构建「处理管道」；直到**消费者**（collect/sum/for\_each/next）出现才逐元素驱动。这个设计与 [python 生成器](../python/06-iterators-generators.md)、[Unix 管道](../linux/05-pipes-text.md)同思想，但 Rust 的版本**编译后就是手写循环**：

```rust
// 上面的迭代器链 ≈ 编译产物（伪代码）
let mut result = Vec::new();
let mut taken = 0;
for &x in &v {
    if x % 2 == 0 && taken < 2 {
        result.push(x * 10);
        taken += 1;
    }
}
```

无堆分配的中间集合、无函数指针、循环被内联——**「声明式写法、命令式性能」就是零成本抽象的代表作**（[第 1 篇](01-getting-started.md)承诺的兑现）。

## 3. collect 与类型目标

```rust
let v: Vec<i32> = (1..=10).filter(|x| x % 2 == 0).collect();
let s: String = "hello".chars().rev().collect();          // 迭代器 → String
let set: HashSet<i32> = v.iter().copied().collect();      // 迭代器 → 任何 FromIterator
let map: HashMap<_, _> = pairs.into_iter().collect();     // (k, v) 对 → map
```

collect 的**目标类型由变量标注/上下文决定**（[第 2 篇](02-variables-types.md)的推断边界—— turbofish `collect::<Vec<_>>()` 是显式形态）。collect 的多态性（任何 FromIterator 容器）让「迭代器 → 集合」零样板。

## 4. 常用适配器速查

| 适配器                                          | 作用           | 例                                    |      |                    |
| -------------------------------------------- | ------------ | ------------------------------------ | ---- | ------------------ |
| `map`                                        | 逐元素变换        | \`.map(                              | x    | x \* 2)\`          |
| `filter`                                     | 条件保留         | \`.filter(                           | x    | x > 0)\`           |
| `take/skip`                                  | 取前 n / 跳过前 n | 分页                                   |      |                    |
| `enumerate`                                  | 带下标          | `for (i, x) in v.iter().enumerate()` |      |                    |
| `zip`                                        | 平行配对         | `zip(names)` → (name, item)          |      |                    |
| `chain`                                      | 串联           | 两个序列合并                               |      |                    |
| `flat_map`                                   | 变换 + 展平      | \`.flat\_map(                        | line | line.split(','))\` |
| `rev`                                        | 反向           | `v.iter().rev()`                     |      |                    |
| 消费：`sum/count/max/find/any/for_each/collect` | 驱动管道         | ——                                   |      |                    |

## 5. 陷阱清单

- 适配器写了没消费者（惰性陷阱）：管道不执行；collect/sum/for\_each 收尾。
- `.map()` 里 clone 侵入：迭代链的隐式拷贝；借用迭代器（iter/iter\_mut/into\_iter 三形态选对）。
- `for x in v` 无意消费掉 v（into\_iter）：只读用 `&v`。
- 闭包捕获引用活得不够久（线程/异步）：move 关键字。
- FnOnce 闭包被调用两次：它消费了捕获；按需用 FnMut/Fn。
- 迭代器失效问题不存在（Rust 无失效——借用规则保证），但「迭代中修改集合」在借用层面直接编译错误——用 into\_iter/收集后再改。
- 过度链式嵌套难读：适度拆中间变量（可读性与性能不冲突——零成本）。

## 6. 小结

- 闭包 = 捕获环境的匿名函数：捕获三模式（Fn 只读/FnMut 可变/FnOnce 消费）由编译器按使用推导、move 强制所有权——线程与异步的门票。
- 迭代器是惰性管道：适配器构建、消费者驱动；编译后即手写循环——零成本抽象的代表作。
- collect 的目标类型多态（FromIterator）+ turbofish 显式化——迭代器与一切集合的桥梁。
- 三种迭代形态（iter/iter\_mut/into\_iter）对应借用/可变借用/消费——与[借用规则](05-borrowing.md)完全一致。
- 函数式的表达力（map/filter 组合）与命令式的性能（编译为循环）在 Rust 里不需要二选一。

## 7. 练习

**1.** 三种捕获模式的实验：只读闭包、修改闭包、move 闭包各写一个，尝试在闭包使用后继续用捕获的变量——验证 Fn/FnMut/FnOnce 的借用语义差异。

> [!TIP]
> 思路move 后原变量失效（所有权规则[第 4 篇](04-ownership.md)）、FnMut 的闭包本身要 mut——闭包把借用检查从「数据」延伸到「函数对象」。

**2.** 零成本验证：写一个迭代器链（filter+map+sum）与等价手写 for 循环，在 Compiler Explorer（或 --release 基准）对比生成的汇编/耗时——亲眼确认「编译后一样」。

> [!TIP]
> 思路-release 下两者几乎逐指令相同（内联 + 无分配）。这个实验是「零成本抽象」从口号到事实的最短路径——对比 [python 生成器](../python/06-iterators-generators.md)的装箱开销。

**3.** 用迭代器链重写一个手写循环（如「从日志行提取错误码并去重排序」），对比两版的行数与意图清晰度——练习「声明式改写」的眼力。

> [!TIP]
> 思路filter\_map（Option 过滤+变换一体）、sorted/dedup（collect 后）——迭代器的组合通常更短且「无循环变量/索引」噪音。零成本让重构无性能顾虑。

**4.** 实现一个自定义迭代器：`Fibonacci` 结构体实现 Iterator（next 产出下一个斐波那契数），用 take(10) 消费——理解「Iterator trait 只需 next」的最小实现面。

> [!TIP]
> 思路`impl Iterator for Fibonacci { type Item = u64; fn next(&mut self) -> Option<u64> }`——无限序列（[python 生成器](../python/06-iterators-generators.md)的同款练习）在 Rust 用状态结构体 + 惰性。

**5.** move 闭包实战：`thread::spawn(move || ...)` 共享一段数据（[第 13 篇](13-concurrency.md)预习），先不加 move 观察编译错误（借用活得不够久），加 move 后理解所有权进入线程——闭包与并发的交界。

> [!TIP]
> 思路报错信息「closure may outlive the current function」直指借用悬垂——move 把数据搬进闭包（所有权随线程走）。这是[所有权](04-ownership.md)×[并发](13-concurrency.md)的交汇点。

**6.** 讨论：迭代器的「惰性」为什么重要（而不是立刻算完返回 Vec）？从「无限序列」「组合不被中间集合放大」「短路消费」三个角度分析，对照 [python 生成器](../python/06-iterators-generators.md)、[C++ ranges](../cpp/09-stl-algorithms.md) 与 [MATLAB 的急切向量化](../matlab/09-vectorization.md)——惰性在「内存」与「表达」上各买到了什么。

> [!TIP]
> 思路惰性买到：无限序列可表达、链式组合零中间集合、take/any 的短路（可能只算几个元素）。MATLAB 的急切向量化在「每步都物化」——惰性是「函数式组合」能规模化到大数据的前提。
