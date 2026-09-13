---
title: 控制流与函数
order: 3
tags: 基础, match, 表达式
summary: if 是表达式、match 是真正的模式匹配、loop 能返回值——Rust 控制流的独特气质。
---

Rust 的控制流有两个鲜明特征：**一切都是表达式**（有值），以及 **match 提供穷尽性检查**。理解这两点，写出的代码会自然偏向"声明结果"而不是"执行步骤"。

## if：它是表达式

```rust
let n = 7;
let parity = if n % 2 == 0 { "偶数" } else { "奇数" };
```

`if` 有值，因此可以直接赋值。推论：**各分支的类型必须一致**，且没有"悬空 else 分支导致的未定义值"——不写 else 就是返回 `()`。

```rust
let x = if cond { 5 } else { 6 };
// let y = if cond { 5 };        // 合法，else 分支是 ()
// let z = if cond { 5 } else { "six" };  // ❌ 类型不一致
```

## loop：可以返回值的循环

`while` 和 `for` 没什么意外，但 `loop` 设计成了表达式：

```rust
let mut count = 0;
let result = loop {
    count += 1;
    if count == 10 {
        break count * 2;    // break 带出返回值
    }
};
println!("{result}");       // 20
```

多层循环里用**带标签的 break/continue** 跳出外层：

```rust
'outer: for i in 0..10 {
    for j in 0..10 {
        if i * j > 50 {
            break 'outer;
        }
    }
}
```

## for：迭代器优先

Rust 的 `for` 不是 C 风格的三段式，而是**遍历迭代器**：

```rust
for i in 0..5 { }         // 0,1,2,3,4（左闭右开）
for i in 0..=5 { }        // 0..=5，含 5
for (i, ch) in "中文abc".chars().enumerate() { }
```

遍历集合时的三种姿势，与所有权规则一一对应（见 [所有权系统](04-ownership.md)）：

```rust
for v in &list  { }   // 只读借用
for v in &mut list { } // 可变借用
for v in list    { }  // 拿走所有权
```

## match：模式匹配是灵魂

`match` 把一个值与一系列模式比较，远比 C 的 switch 强大：

```rust
enum Message {
    Quit,
    Move { x: i32, y: i32 },
    Write(String),
    ChangeColor(u8, u8, u8),
}

fn process(msg: Message) {
    match msg {
        Message::Quit => println!("退出"),
        Message::Move { x, y } => println!("移动到 ({x}, {y})"),
        Message::Write(text) if text.len() > 10 => println!("长文：{text}"),
        Message::Write(text) => println!("写入：{text}"),
        Message::ChangeColor(r, g, b) => println!("颜色 #{r:02x}{g:02x}{b:02x}"),
    }
}
```

> [!IMPORTANT]
> match 必须**穷尽所有情况**。漏掉一个变体就是编译错误——这保证了增删枚举成员时，编译器会强制你检查所有分支。这是 Rust 代码敢于重构的底气。

常用模式速查：

| 模式 | 含义 |
| --- | --- |
| `Some(x)` | 解构 Option，绑定内值 |
| `(a, b)` / `Point { x, y }` | 元组 / 结构体解构 |
| `1 \| 2 \| 3` | 多值匹配 |
| `1..=5` | 范围匹配 |
| `x if x > 0` | 匹配守卫（额外条件） |
| `_` | 兜底，不绑定 |
| `other` | 兜底并绑定 |

只要不匹配整个枚举，用 `if let` / `let else` 更轻：

```rust
if let Some(v) = maybe_value {
    println!("有值：{v}");
}

let Some(v) = maybe_value else {
    return;             // 解包失败时的提前返回
};
// 此后 v 可用
```

## 函数：参数、返回值与表达式体

```rust
fn add(a: i32, b: i32) -> i32 {
    a + b              // 表达式，无分号即返回值
}
```

两条铁律：

1. **必须标注参数与返回值的类型**——函数签名是编译器推理的锚点
2. 返回值是**表达式**（无分号）；加了分号就变成语句，类型变 `()`

提前返回用 `return`，但 Rust 惯例是**最后一个表达式就是结果**，配合 `?` 运算符（见 [错误处理](09-error-handling.md)）可以让主流程一马平川。

```rust
fn first_char(s: &str) -> Option<char> {
    s.chars().next()          // 直接返回 Option
}
```

## 练习

- [ ] 用 `loop` + `break value` 实现一个简单的猜数字重试计数
- [ ] 写一个 `fn classify(n: i32) -> &'static str`，用 match 区分负数、零、1-100、大于 100
- [ ] 用 `for` + `enumerate` 打印九九乘法表
