---
title: 所有权系统
order: 4
tags: 核心, 所有权, move
summary: Rust 最独特的机制：值有唯一所有者，赋值与传参默认移动，离开作用域自动析构。
---

所有权（Ownership）是 Rust 的核心机制，也是它不需要垃圾回收却能保证内存安全的原因。规则本身只有三条：

1. 每个值都有一个**所有者**（owner）
2. 同一时刻，所有者**有且只有一个**
3. 所有者离开作用域，值被**丢弃**（drop）

内存的分配与释放由编译器在编译期静态插入，运行时零开销——没有 GC 暂停，也没有手动 `free`。

## 移动语义（Move）

对非 `Copy` 类型，赋值是**移动**而不是拷贝：

```rust
let s1 = String::from("hello");
let s2 = s1;                    // 所有权从 s1 移动到 s2

// println!("{s1}");            // ❌ 编译错误：s1 已失效
println!("{s2}");               // ✅
```

`String` 由三部分组成（指针、长度、容量）在栈上，实际内容在堆上。如果赋值是浅拷贝，`s1`、`s2` 会指向同一块堆内存，作用域结束时**双重释放**。Rust 的解法很果断：`s1` 直接失效，"移动"了所有权。

> [!NOTE]
> 从汇编角度看，move 就是复制栈上的小结构体，然后让原变量失效。所谓"移动"是语义概念，不是昂贵的深拷贝。

## Copy 类型

简单标量类型实现了 `Copy` trait，赋值时按位拷贝，原变量继续可用：

```rust
let x = 5;
let y = x;          // 拷贝
println!("x = {x}, y = {y}");   // 都能用
```

`Copy` 类型包括：整数、浮点、`bool`、`char`、以及全由 `Copy` 成员组成的元组/数组。**含堆数据的类型**（`String`、`Vec` 等）不是 `Copy`。

需要真正的深拷贝时，显式调用 `clone()`：

```rust
let s1 = String::from("hello");
let s2 = s1.clone();     // 深拷贝堆内容
println!("s1 = {s1}, s2 = {s2}");   // 都能用
```

> [!TIP]
> `clone()` 不是免费的。在热点路径上看到 `clone()`，先想想是不是可以改成借用——这正是下一章的主题。

## 函数与所有权

传参和返回值同样遵循移动语义：

```rust
fn take_ownership(s: String) {
    println!("{s}");
}   // s 在此 drop

fn give_ownership() -> String {
    String::from("yours")
}

fn main() {
    let s = give_ownership();   // 所有权移入 main
    take_ownership(s);          // 所有权移入函数
    // println!("{s}");         // ❌ s 已失效
}
```

如果函数用完还要用，就把所有权"借出去"（[引用与借用](05-borrowing.md)），或者**用完还回来**：

```rust
fn process(s: String) -> String {
    // ... 处理
    s    // 还回去
}
```

这种"传来传去"的写法很啰嗦，实际代码里几乎总是用引用代替——但理解值的流向仍是前提。

## Drop：确定性析构

值离开作用域时自动调用 `drop`，实现 `Drop` trait 可以挂钩清理逻辑：

```rust
struct Connection;

impl Drop for Connection {
    fn drop(&mut self) {
        println!("连接关闭");
    }
}

fn main() {
    {
        let _c = Connection;
        println!("使用连接");
    }           // _c 在此离开作用域，先打印"连接关闭"
    println!("作用域结束");
}
```

这就是 **RAII**（资源获取即初始化）：文件句柄、锁、网络连接统统交给所有权系统管理。C++ 的 RAII 是"约定"，Rust 的 RAII 是"强制"——你没有办法忘记释放，也没有机会重复释放。

> [!WARNING]
> `std::mem::drop(value)` 可以提前放弃所有权。常见误区是调用 `value.drop()`——那只是调用了方法，值离开作用域时**还会再次 drop**，造成双重释放；正确做法是使用自由函数 `drop(value)`。

## 所有权驱动的 API 设计

所有权规则会反过来塑造你的接口：

- 函数需要"拥有"数据存进结构体 → 接收 `String` / `Vec<T>`
- 函数只是读一下 → 接收 `&str` / `&[T]` / `&MyType`
- 需要可变借用 → 接收 `&mut`

```rust
fn print_all(items: &[String]) { ... }     // 只读，谁都传得进
fn add_item(items: &mut Vec<String>, s: String) { ... }
```

参数用 `&str` 而不是 `&String`、用 `&[T]` 而不是 `&Vec<T>`，可以同时接受更宽的入参类型——这是 Rust 的惯例（称为泛型化引用）。

## 小结

| 操作 | Copy 类型 | 非 Copy 类型 |
| --- | --- | --- |
| `let b = a;` | 按位拷贝，a 可用 | 移动，a 失效 |
| `a.clone()` | — | 深拷贝，a 可用 |
| 传参 `f(a)` | 拷贝 | 移动，a 失效 |
| 传参 `f(&a)` | — | 借用，a 可用 |

- [ ] 写一个函数接收 `String` 并返回字符数，然后在调用方继续使用原字符串（提示：借用）
- [ ] 实现一个带 `Drop` 的计时器，统计作用域耗时
- [ ] 解释：为什么 `let s2 = s1;` 之后 `s1.len()` 不能编译，而 `let i2 = i1;` 之后 `i1` 还能用？
