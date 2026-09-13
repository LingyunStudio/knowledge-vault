---
title: 生命周期
order: 6
tags: 核心, 生命周期, 泛型
summary: 生命周期是引用有效范围的标注，大多数时候靠省略规则自动推导，复杂结构才需要显式标注。
---

生命周期（lifetime）可能是 Rust 名声最"吓人"的概念，但它解决的任务很小：**确保引用永远不会活得比数据本身久**。它不改变引用的实际存活时间——那个由作用域决定——只是把事实**描述**给编译器检查。

## 为什么需要它

看一个不看不行的情况：

```rust
fn longest(a: &str, b: &str) -> &str {   // ❌ 编译不过
    if a.len() > b.len() { a } else { b }
}
```

返回值是引用，但编译器无法知道它指向 `a` 还是 `b`，因此无法判断调用方的使用是否安全。解决办法是给引用加上**生命周期参数**，把关系说清楚：

```rust
fn longest<'a>(a: &'a str, b: &'a str) -> &'a str {
    if a.len() > b.len() { a } else { b }
}
```

读法：返回的引用在 `a` 和 `b` 两个输入的**较小者**范围内有效。调用时若超界，编译器立刻指出：

```rust
let s1 = String::from("long string is long");
let result;
{
    let s2 = String::from("hi");
    result = longest(s1.as_str(), s2.as_str());
}   // s2 在此销毁
// println!("{result}");   // ❌ result 可能指向 s2，已悬垂
```

> [!NOTE]
> 生命周期参数 `'a` 是**泛型参数**，由编译器在调用点统一求解。它不延长任何东西的生命，只是约束"输入和输出之间的相对关系"。

## 省略规则：大多数标注是自动的

日常代码很少写 `'a`，因为编译器内置了三条省略规则（elision rules）：

1. 每个引用参数自动获得自己的生命周期
2. 只有一个输入生命周期时，它被赋给所有输出引用
3. 方法中有 `&self` / `&mut self` 时，`self` 的生命周期赋给所有输出引用

```rust
fn first_word(s: &str) -> &str { ... }
// 等价于
fn first_word<'a>(s: &'a str) -> &'a str { ... }

impl Sentence {
    fn first_word(&self) -> &str { ... }
    // 规则 3：输出引用跟随 &self，无需标注
}
```

只有当规则推不出关系时（比如返回值引用与 `self` 无关），才需要显式标注。

## 结构体中的生命周期

结构体如果持有引用，必须标注生命周期——含义是：**结构体的实例不能活过它引用的数据**。

```rust
struct Excerpt<'a> {
    part: &'a str,
}

let novel = String::from("很久很久以前……");
let first = novel.split('。').next().unwrap();
let excerpt = Excerpt { part: first };   // excerpt 不能活过 novel
```

这也解释了为什么自引用结构（结构体引用自己字段）在 Rust 里如此麻烦——那是真实存在的悬垂风险。

## 'static

`'static` 表示整个程序运行期都有效，所有字符串字面量都是 `'static`：

```rust
let s: &'static str = "硬编码在二进制里";
```

它常见于两种场景：

- `T: 'static` 约束：类型不包含任何非 `'static` 引用（线程、任务边界常用）
- 泄漏的数据：`Box::leak` 主动放弃清理权换取 `'static` 引用

> [!WARNING]
> 别把 `'static` 理解为"变量的值要活到程序结束"。`&'static str` 说的是**引用**有效，与变量无关。

## 生命周期 ≠ 语法负担

几个降低心智负担的事实：

- 函数和方法里 90% 的情况走省略规则，完全不用写
- `String`、`Vec` 等**拥有数据**的类型没有生命周期参数——所有权解决的部分不需要标注
- `Arc<T>` 搭配 `clone` 可以绕开复杂引用关系（见 [智能指针](12-smart-pointers.md)）
- 报错信息会给出建议的标注，跟着改就行

```rust
// 典型的"必须标注"场景：返回的引用和 self 无关
struct Parser<'a> {
    input: &'a str,
}

impl<'a> Parser<'a> {
    fn rest(&mut self) -> &'a str {
        self.input  // 返回引用需要活得和 'a 一样久
    }
}
```

## 练习

- [ ] 写 `fn longest<'a>(...)` 并用两个不同作用域的字符串验证编译器何时拒绝
- [ ] 实现持有 `&'a str` 的 `WordCounter`，统计单词出现次数
- [ ] 阅读一条真实的 E0106 报错，找出编译器建议的标注并理解含义
