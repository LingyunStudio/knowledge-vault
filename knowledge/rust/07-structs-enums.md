---
title: 结构体、枚举与模式匹配
order: 7
tags: 基础, struct, enum
summary: 用 struct 组织数据、用 enum 表达"多选一"、用 match 与 impl 把行为挂上去。
---

Rust 没有"类"，数据建模由三件套完成：**struct**（组合）、**enum**（多选一）、**impl**（行为）。配合模式匹配，能精确表达业务里的每一种状态。

## 结构体

```rust
#[derive(Debug, Clone)]
struct User {
    name: String,
    age: u8,
    active: bool,
}

fn main() {
    // 创建：所有字段必须给全
    let mut u = User {
        name: String::from("Ada"),
        age: 36,
        active: true,
    };

    u.age += 1;
    println!("{u:?}");   // Debug 输出：User { name: "Ada", age: 37, active: true }

    // 字段初始化简写：变量名与字段名相同时
    let name = String::from("Alan");
    let age = 41;
    let v = User { name, age, active: false };

    // 结构体更新语法：其余字段取自 v（注意：移动非 Copy 字段！）
    let w = User { active: true, ..v };
    // println!("{}", v.name);   // ❌ v.name 已被移动进 w
}
```

三种结构体形态：

```rust
struct Point(f64, f64);          // 元组结构体：字段无名
struct Unit;                      // 单元结构体：无字段，常用作标记类型
struct Color { r: u8, g: u8, b: u8 }   // 经典命名字段
```

### 方法与关联函数

`impl` 块中定义方法。第一个参数是 `self` 变体之一：

```rust
impl User {
    // 关联函数（没有 self）——常用于构造器，用 :: 调用
    fn new(name: impl Into<String>) -> Self {
        User { name: name.into(), age: 0, active: true }
    }

    // &self：只读方法
    fn is_adult(&self) -> bool {
        self.age >= 18
    }

    // &mut self：可修改自身
    fn birthday(&mut self) {
        self.age += 1;
    }

    // self：拿走所有权（少见，多用于转换成别的类型）
    fn into_name(self) -> String {
        self.name
    }
}

let mut u = User::new("Ada");
u.birthday();
assert!(u.is_adult());
```

> [!TIP]
> 方法签名就是所有权的取舍题：默认 `&self`；要改状态用 `&mut self`；`self` 通常只出现在 `into_xxx` 这类消费自身的转换函数里。

## 枚举：精确表达"多选一"

Rust 的枚举是**代数数据类型**（sum type）——每个变体可以携带不同类型的数据：

```rust
enum Shape {
    Circle { radius: f64 },
    Rectangle { w: f64, h: f64 },
    Triangle(f64, f64, f64),     // 变体携带元组数据
}

fn area(s: &Shape) -> f64 {
    match s {
        Shape::Circle { radius } => std::f64::consts::PI * radius * radius,
        Shape::Rectangle { w, h } => w * h,
        Shape::Triangle(a, b, c) => {
            // 海伦公式（示意）
            (a + b + c) / 2.0
        }
    }
}
```

`match` 强制穷尽所有变体——给 `Shape` 加一个新变体，所有相关 match 都会编译报错，这就是"用类型系统跟踪业务变更"。

## Option<T>：没有 null 的世界

Rust 用枚举消灭了空指针：

```rust
enum Option<T> {
    Some(T),
    None,
}
```

一个"可能没有"的值，类型上就是 `Option<T>`，你必须解包才能使用内值——**null 是类型错误**，而不是运行事故：

```rust
fn find_user(name: &str) -> Option<&User> { ... }

match find_user("ada") {
    Some(u) => println!("找到：{}", u.name),
    None => println!("没有这个用户"),
}

// 常用组合子
let age = find_user("ada").map(|u| u.age);            // Option<u8>
let fallback = age.unwrap_or(0);                       // 有值取值，无值给默认
let doubled = age.filter(|&a| a > 0).map(|a| a * 2);
```

> [!WARNING]
> `unwrap()` / `expect()` 会在 `None` 时 panic，原型阶段可用；生产代码请用 `?`、`match`、`unwrap_or` 系列显式处理（见 [错误处理](09-error-handling.md)）。

## Result\<T, E>：同样是个枚举

```rust
enum Result<T, E> {
    Ok(T),
    Err(E),
}
```

它与 `Option` 共享大部分组合子，是错误处理的主角，详见 [错误处理](09-error-handling.md)。

## 模式匹配的更多场景

match 的模式能力贯穿整个语言：

```rust
// 解构嵌套
match point {
    (0, y) => println!("在 y 轴，y = {y}"),
    (x, 0) => println!("在 x 轴，x = {x}"),
    (x, y) => println!("({x}, {y})"),
}

// if let 链（Rust 1.65+ 的 let-chains 需 edition 2024）
if let Shape::Circle { radius } = shape {
    println!("半径 {radius}");
}

// while let：持续解构
let mut stack = vec![1, 2, 3];
while let Some(top) = stack.pop() {
    println!("{top}");
}

// match 中用 @ 绑定整体
match n {
    x @ 1..=9 => println!("个位数 {x}"),
    _ => {}
}
```

## derive：自动实现常用 trait

`#[derive(...)]` 让编译器自动生成实现，覆盖大多数场景：

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash, Default)]
struct Config {
    name: String,
    retries: u32,
}
```

| derive               | 用途                |
| -------------------- | ----------------- |
| `Debug`              | `{:?}` 打印         |
| `Clone`              | 手动 `.clone()`     |
| `Copy`               | 按位拷贝（仅限全 Copy 字段） |
| `PartialEq` / `Eq`   | 相等比较              |
| `Hash`               | 作 HashMap 的键      |
| `Default`            | 默认值               |
| `PartialOrd` / `Ord` | 排序                |

## 练习

- [ ] 定义 `enum Temperature { Celsius(f64), Fahrenheit(f64) }`，实现 `to_celsius()`
- [ ] 用 `Option` 改写一个"可能失败"的查找函数，禁用 `unwrap`
- [ ] 用 `match` 实现一个简易计算器，处理加减乘除和除零
