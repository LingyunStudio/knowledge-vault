---
title: 控制流：一切皆表达式
order: 3
tags: match, 表达式, if let, 穷尽性
summary: Rust 的表达式导向设计（if/块/match 都有值）、loop 的 break 值、match 的完整模式匹配（解构/守卫/绑定/穷尽性检查）、if let 与 let else 的简化形态，以及「控制流是表达式」对代码风格的塑造。
---

Rust 是**表达式导向**的语言：if、match、块本身都有值——控制流不只是「跳转」，而是「求值」。这个设计让 Rust 的代码风格向「声明结果」倾斜（val 风格），也解释了为什么 `match` 成为核心（表达式 + 穷尽性检查 = 逻辑的完整性保证）。

## 1. 表达式与语句：求值的语言

```rust
let x = 5;
let y = {
    let a = 3;
    a * x + 1                  // ★ 块的值 = 最后一个表达式（无分号！）
};                             // y = 16

let status = if temp > 37 { "fever" } else { "normal" };   // if 是表达式
```

「块是表达式」的规则：块的最后**无分号的表达式**是它的值——这个细节同时是 Rust 新手的头号「为什么函数没返回值」疑问（多了分号就变成语句返回 ()）。对比 C 系（if 是语句）与 [python 的条件表达式](../python/03-control-flow.md)（三元是补丁），Rust 把「求值」作为控制流的统一形态。

## 2. 三种循环

```rust
// loop：无限循环 + 可返回值（重试逻辑的形态）
let result = loop {
    match try_connect() {
        Ok(conn) => break conn,          // ★ break 带值：循环的返回值
        Err(_) => continue,
    }
};

// while：条件循环
while attempts < max { ... }

// for：遍历迭代器（Rust 的 for 只干这一件事！）
for i in 0..5 { }                    // Range：0,1,2,3,4（半开区间）
for x in arr.iter() { }              // 迭代器（[第 11 篇](11-closures-iterators.md)）
for (i, v) in arr.iter().enumerate() { }   // 带下标
```

Rust 没有 C 风格的 `for (i=0; i<n; i++)`——**for 就是迭代器遍历**（与 [python](../python/03-control-flow.md) 同哲学）；`break 值` 是 loop 的独门（把「重试直到成功」的返回值写进循环本体，不用外部变量）。

## 3. match：模式匹配的核心

### 3.1 基本形态与穷尽性

```rust
enum Command { Quit, Move { x: i32, y: i32 }, Say(String) }

fn execute(cmd: &Command) {
    match cmd {
        Command::Quit => println!("bye"),
        Command::Move { x, y } => println!("move to ({x},{y})"),   // 解构！
        Command::Say(text) => println!("say: {text}"),
        // 没有分支漏掉的可能：少一个变体 → 编译错误（[第 1 篇](01-getting-started.md)的穷尽性）
    }
}
```

match 的三个保证：**穷尽性**（所有可能必须覆盖——枚举加变体时全项目报错点名）、**模式即解构**（直接拆开数据拿字段）、**分支是表达式**（每个分支有值）。

### 3.2 模式的完整语法

```rust
match value {
    1 | 2 => "one or two",                       // 或模式
    3..=9 => "three to nine",                    // 范围模式
    n if n % 2 == 0 => "even (beyond 9)",        // 守卫（额外条件）
    other => other,                              // 绑定（捕获整个值）
    _ => "_",                                    // 通配：显式「其余我不关心」
}

// 解构嵌套与元组
match point {
    (0, y) => println!("y 轴上: {y}"),
    (x, 0) => println!("x 轴上: {x}"),
    (x, y) => println!("({x},{y})"),
}

// Option 的匹配：处理「可能没有」的标准姿势
match maybe_name {
    Some(name) => println!("hello {name}"),
    None => println!("anonymous"),
}
```

模式匹配是 Rust 的「解构 + 分支 + 绑定」三合一——`if let` 是「只关心一个模式」的简化：

```rust
if let Some(name) = maybe_name {          // 只处理 Some 的情况
    println!("{name}");
}

let Some(name) = maybe_name else {        // let else（Rust 1.65+）：不匹配就早退
    return;                               // 「期待某形态，否则离开」的卫语句形态
};
```

## 4. match 与 if 的选型、match 的其他细节

```rust
// 布尔条件用 if；「值的形态分类」用 match
if x > 0 { } else { }                     // 条件判断
match x { 0 => ..., n if n < 0 => ..., _ => ... }   // 分类匹配——大量 if-else 链的重构目标
```

细节四则：

1. **match 穷尽但可 `_` 兜底**——`_` 的使用要有意识：枚举的新变体会**不会**提醒你（兜底吞掉了穷尽性检查）——「关键逻辑别用 \_ 吞」与 [C 的 default 纪律](../c/03-operators-control.md)同款但更严格。
2. **match 分支间共享代码用 `|`**；守卫 `if` 只能用已有绑定。
3. **绑定与 @**：`n @ 3..=9` 把范围匹配的值绑定给 n。
4. match 是**表达式**——每个分支的值就是 match 的值（分支类型必须一致）。

## 5. 陷阱清单

- 块末表达式多写分号（返回 ()）：「函数没有返回值」的头号原因。
- match 漏分支：编译器点名（这是福利不是麻烦）。
- `_` 兜底吞掉穷尽性：新变体静默走默认；关键逻辑枚举全部显式。
- match 分支类型不一致：match 是表达式，各分支必须同型。
- 守卫里用不存在的绑定：守卫只能引用该分支已绑定的变量。
- 期待 for 的 C 风格三段：用 Range/迭代器；while 需要手动推进条件。
- `if let` 与 match 混用导致嵌套：多模式用 match、单模式用 if let/let else。

## 6. 小结

- 表达式导向是 Rust 的风格基因：if/块/match/loop 都有值——代码向「声明结果」倾斜，语句与表达式的边界清晰。
- match 是语言的核心机制：穷尽性检查（枚举演化的安全网）、模式即解构、分支即表达式——逻辑的完整性由编译器保证。
- 模式的语法面（或/范围/守卫/绑定/嵌套解构/`_`）覆盖「值分类」的全部需求；if let/let else 是单模式场景的降维简化。
- for = 迭代器遍历（无 C 风格三段式）；loop 的 break 值服务重试语义。
- 「值的形态分类」用 match、「真假条件」用 if——选型本身就是代码可读性的一部分。

## 7. 练习

**1.** 用 match 重写一段 if-else if 链（状态码分类），对比可读性；故意给枚举加一个变体体验「全项目编译报错点名」——穷尽性的价值实测。

> [!TIP]
> 思路if 链的问题在「分类意图」与「遗漏分支」都不可见；match 的变体列表就是分类的完备性声明。加变体实验是 [C switch default](../c/03-operators-control.md) 问题的对照。

**2.** 用 `loop + break 值` 实现「重试连接最多 5 次，成功返回连接、全败返回错误」——对比用外部 Option 变量的版本。

> [!TIP]
> 思路`break Ok(conn)` / 循环尾 `Err(...)`——循环本身是表达式。外部变量版本多一个「必须初始化的可变状态」，这就是 break 值消灭的东西。

**3.** 实现一个「计算器」：match 解析 `enum Op { Add(f64, f64), Sub(f64, f64), Neg(f64) }`——练习嵌套解构、守卫（如除零判断需要的话）、与 Option 返回。

> [!TIP]
> 思路嵌套解构 `Op::Add(a, b) => a + b` 直接拿到字段——模式匹配让「数据的形态」与「处理逻辑」一一对应。对比 OOP 的 visitor 模式（[C++ 篇](../cpp/07-templates.md)）看表达力差异。

**4.** 用 if let 与 let else 各处理一次 Option：单个成功路径用 let else 早退、可选附加处理用 if let——总结两者的选型口诀。

> [!TIP]
> 思路let else 的语义是「这个函数就是为处理 Some 而生，None 直接离开」——卫语句风格；if let 是「None 也有事做」的对称处理。口诀：主路径化简用 let else、双路径用 match/if let。

**5.** 探索块表达式：写一个「计算 + 日志」的块赋值（块内 println 调试、末尾表达式返回），对比引入临时变量的版本——体会「块即迷你函数」的代码组织。

> [!TIP]
> 思路块表达式让「临时计算」保持局部（不出块）——作用域最小化（[第 6 篇](../c/06-scope-lifetime.md)作用域纪律）的 Rust 形态。

**6.** 讨论：为什么 Rust 把 match（模式匹配）作为核心控制流而 C 系只有 switch？从「代数数据类型（enum + 结构体组合）需要解构才能消费」的角度分析——match 与 enum 是一对不可分割的设计，缺一个另一个的表达力就减半。

> [!TIP]
> 思路enum 的变体携带不同数据（Circle 有半径、Say 有文本）——消费它必须「按变体拆开」（解构），switch 的常量匹配无法胜任。ADT + 模式匹配 = 数据建模与消费的闭环（函数式语言的遗产在系统语言的落地）。
