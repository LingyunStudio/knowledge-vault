---
title: 引用与借用
order: 5
tags: 核心, 借用, 引用
summary: 借用规则是 Rust 的"交通法规"：多个只读引用或一个可变引用，二者不可兼得。
---

移动所有权太重，日常代码需要"临时使用但不接管"——这就是**引用**（reference）。创建引用的行为叫**借用**（borrowing），因为最终要还。

## 引用基础

```rust
fn length(s: &String) -> usize {
    s.len()
}   // s 是引用，函数结束不拥有它，什么都不发生

fn main() {
    let s1 = String::from("hello");
    let len = length(&s1);      // 借用，s1 所有权不变
    println!("'{s1}' 长度为 {len}");   // s1 仍可用
}
```

`&String` 是指向 `String` 的引用，解引用是自动的（方法调用时）。可变引用用 `&mut`：

```rust
fn push_world(s: &mut String) {
    s.push_str(", world");
}

let mut s = String::from("hello");
push_world(&mut s);
println!("{s}");     // hello, world
```

注意三件事：

1. 值本身必须是 `mut` 才能可变借用
2. 引用默认不可变，写 `&mut` 是显式授权
3. 函数签名上的 `&mut` 声明了"我会改它"——调用方一眼可见

## 借用规则

这是 Rust 最重要的规则，没有之一：

> 同一时刻，一个值要么有**任意多个不可变引用** `&T`，要么只有**一个可变引用** `&mut T`，两者不能同时存在。

```rust
let mut s = String::from("hello");

let r1 = &s;
let r2 = &s;        // ✅ 多个只读引用并存
println!("{r1} {r2}");

let r3 = &mut s;    // ✅ 只读引用已不再使用，可变借用合法
r3.push_str("!");

// let r4 = &s;     // ✅ NLL：r3 最后一次使用之后，可以再只读借用
```

违反规则的代码直接编译失败：

```rust
let mut v = vec![1, 2, 3];
let first = &v[0];
v.push(4);
// println!("{first}");   // ❌ push 可能导致堆内存重新分配，
                          //    first 变成悬垂指针——借用检查器直接拒绝
```

> [!IMPORTANT]
> 这条规则在编译期消灭了三类 bug：**数据竞争**（并发写）、**迭代器失效**（边遍历边改）、**悬垂指针**。C++ 里这些全是运行期的心智负担，Rust 里是编译错误。

## NLL：借用按"使用"计算生命周期

借用检查基于 **NLL**（Non-Lexical Lifetimes）：引用的活跃期从创建到最后一次**使用**，不是到作用域结束。所以"先读后改"这样自然的代码是合法的：

```rust
let mut s = String::from("a");
let r = &s;
println!("{r}");        // r 的生命周期到此为止
let r2 = &mut s;        // ✅
r2.push_str("b");
```

## 悬垂引用不可能存在

Rust 编译器保证引用永远指向有效数据：

```rust
fn dangle() -> &String {        // ❌ 编译错误
    let s = String::from("hello");
    &s
}   // s 在此被销毁，返回它的引用就是悬垂引用
```

正确做法是直接把 `String` 移出去（返回所有权）。

## 切片：View 类型的日常

切片（slice）是对集合中一段连续序列的引用，不拥有数据：

```rust
let s = String::from("hello world");
let hello: &str = &s[..5];      // 字符串切片
let world: &str = &s[6..];

let arr = [1, 2, 3, 4, 5];
let mid: &[i32] = &arr[1..4];   // 数组切片 [2, 3, 4]
```

实践中最重要的用法：**函数参数优先用切片类型**。

```rust
fn first_word(s: &str) -> &str {    // &str 既能接收 String 又能接收字面量
    s.split_whitespace().next().unwrap_or("")
}
```

| 参数类型      | 能接收                  |
| --------- | -------------------- |
| `&str`    | `&String`、`&str`、字面量 |
| `&String` | 只有 `&String`         |
| `&[T]`    | `&Vec<T>`、数组、切片      |
| `&Vec<T>` | 只有 `&Vec<T>`         |

> [!TIP]
> "参数用 `&str`/`&[T]`，存储用 `String`/`Vec<T>`"是 Rust 的黄金法则——接口对调用方最友好。

## 与所有权的配合

- [所有权系统](04-ownership.md) 回答"数据归谁"
- 借用回答"谁能临时用"
- [生命周期](06-lifetimes.md) 回答"借用能活多久"

三者合起来构成了 Rust 内存安全的完整图景。

## 练习

- [ ] 写一个 `fn largest(list: &[i32]) -> i32` 返回最大值，注意参数为什么不用 `&Vec<i32>`
- [ ] 尝试在 `for v in &vec` 循环体里 `vec.push(x)`，观察并阅读编译器错误
- [ ] 实现一个函数接收 `&mut Vec<String>`，去重并保持原有顺序
