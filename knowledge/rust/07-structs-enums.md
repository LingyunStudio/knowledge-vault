---
title: 结构体与枚举：数据建模
order: 7
tags: struct, enum, impl, Option, derive
summary: 三种结构体与方法系统（impl/self 的三种形态/关联函数）、枚举的代数数据类型本质（变体携带数据）、Option 作为「可空」的类型化答案、derive 宏的派生体系、以及「枚举 + match」与 OOP 继承的建模对照。
---

Rust 没有「类」——它的数据建模由**结构体**（数据的形状）+ **枚举**（数据的可能形态）+ **impl 块**（行为）组合而成。这套组合的建模能力（代数数据类型）比继承更强也更可预测：**枚举 + match 的穷尽性检查让「数据的所有形态都被处理」成为编译期保证**。

## 1. 结构体：数据的形状

```rust
#[derive(Debug, Clone, PartialEq)]
struct User {
    name: String,          // 拥有数据（String 而非 &str，[第 5 篇](05-borrowing.md)）
    email: String,
    active: bool,
    age: u8,
}

let mut u = User {
    name: String::from("alice"),
    email: String::from("a@x.com"),
    active: true,
    age: 30,
};
u.age = 31;                 // 字段访问（整体 mut 才能改字段——无字段级 mut）

let u2 = User { name: String::from("bob"), ..u };   // 结构体更新语法：其余字段来自 u
// ⚠️ ..u 移动了 u 的 String 字段（u 部分失效——只化用 Copy 字段仍可用）
```

三种结构体形态：

```rust
struct Point(f64, f64);      // 元组结构体：命名的元组（无字段名）
struct Milestone;             // 单元结构体：无数据（标记类型/trait 的空实现载体）
```

`..u` 更新语法的关键细节：**非 Copy 字段（String）被移走**——u 的一部分失效（结构体的部分 move），之后只能用 u 的 Copy 字段。Rust 的部分移动检查（partial move）比 C++ 的移动语义（[第 5 篇](../cpp/05-copy-move.md)）更精细：字段级追踪。

## 2. 方法：impl 块与 self 的三种形态

```rust
impl User {
    // 关联函数（无 self）：构造器的惯例形态（new）
    fn new(name: &str, email: &str) -> Self {
        User { name: name.to_string(), email: email.to_string(), active: true, age: 0 }
    }

    // &self：只读借用（最常见）
    fn is_adult(&self) -> bool { self.age >= 18 }

    // &mut self：可变借用（改字段）
    fn deactivate(&mut self) { self.active = false; }

    // self：收走所有权（转换/消费自己的场景）
    fn into_email(self) -> String { self.email }
}

let u = User::new("alice", "a@x.com");       // 关联函数：路径调用
println!("{}", u.is_adult());                 // 方法调用（自动引用：调用点不用写 &）
```

self 三形态的选择与[函数签名惯例](05-borrowing.md)一致：**读用 &self、写用 &mut self、消费/转换用 self**。自动引用（method resolution）：`u.is_adult()` 自动取 `&u`——省去显式 `(&u).is_adult()`。关联函数（无 self）是 Rust 的「静态方法 + 构造函数 + 命名空间函数」三合一。

## 3. 枚举：变体携带数据的建模神器

Rust 的枚举远强于 [C 的枚举](../c/02-types.md)（只是整数常量）——**每个变体可以携带不同类型的数据**：

```rust
enum Shape {
    Circle { radius: f64 },                    // 结构体式变体
    Rect { w: f64, h: f64 },
    Point,                                     // 无数据变体
}

enum Message {
    Quit,                                      // 无数据
    Move { x: i32, y: i32 },                   // 具名字段
    Write(String),                             // 元组式（单值）
    ChangeColor(i32, i32, i32),                // 多值
}

fn area(s: &Shape) -> f64 {
    match s {
        Shape::Circle { radius } => std::f64::consts::PI * radius * radius,
        Shape::Rect { w, h } => w * h,
        Shape::Point => 0.0,
    }                                          // 穷尽性：加变体全项目 match 报错（[第 3 篇](03-control-flow.md)）
}
```

这就是**代数数据类型**（ADT）：「或」关系用 enum（几种可能形态）、「与」关系用 struct（字段的组合）——两者嵌套可以精确建模任意数据。与 OOP 继承建模（[C++ 多态](../cpp/10-inheritance.md)）的对照：**「数据的不同形态」用枚举 + match（封闭集合、编译器检查完备），「开放扩展的行为」才用 trait 对象**——封闭 vs 开放的分界（[C++ variant 讨论](../cpp/12-modern-features.md)同款）。

## 4. Option：可空的类型化答案

```rust
fn find_user(id: u32) -> Option<&User> { ... }    // 可能没有

// ❌ 不存在 null ——「没有值」是一等公民类型
let u = find_user(42);
match u {
    Some(user) => println!("{}", user.name),
    None => println!("not found"),
}

// 组合子：链式处理（[python 的 optional](../python/12-quality.md) 的强化版）
u.map(|user| user.name.clone())          // Some → Some(String)
 .unwrap_or("unknown".to_string());      // None → 默认值
u.and_then(|user| find_email(user))      // 链式：可能失败的后续
 .ok_or("no email")?;                     // Option → Result
```

`Option<T>` 把「可能没有」编码进类型——**忘记处理 None 直接编译不过**（match 穷尽性）——[C 的 NULL](../c/04-pointers.md)、[python 的 None 崩溃](../python/03-control-flow.md)这类「空引用十亿美元错误」从语言层消失。unwrap 是显式承认「我知道这里有值」（panic 路线）——生产代码的 unwrap 要有注释支撑。

## 5. derive：编译期生成实现

```rust
#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct Config {
    host: String,
    port: u16,
}
println!("{:?}", config);            // Debug：打印（{:?}）
config.clone();                       // Clone：深拷贝（[第 4 篇](04-ownership.md)）
config == Config::default();          // PartialEq + Default
```

derive 宏（[第 1 篇](01-getting-started.md)的编译期生成）按需实现常见 trait：`Debug`（打印）、`Clone/Copy`（复制语义）、`PartialEq/Eq/Hash`（比较与哈希——进 HashMap 的组合，[第 8 篇](08-collections.md)）、`Default`（默认值）、`PartialOrd/Ord`（排序）。**derive 的纪律**：只派生真正需要的（Hash 参与 HashMap key、PartialEq 参与比较——语义派生而非习惯派生）。

## 6. 陷阱清单

- 字段用 &str/&Vec（引用字段传染生命周期，[第 6 篇](06-lifetimes.md)）：默认 String/Vec 拥有数据。
- `..u` 更新语法后的部分移动：String 字段被移走，u 部分失效；Copy 字段仍可用。
- 方法与关联函数混淆（User::new vs u.new()）：有无 self 决定调用形态。
- 期待字段级 mut（struct 一个字段 mut 一个不）：mut 是整个绑定的；需要不可变字段的设计用方法封装或重新建模。
- match 枚举漏变体：编译器会点名——这是设计红利不是负担。
- unwrap 满天飞：Option/Result 的组合子（unwrap_or/and_then/?）才是正道（[第 9 篇](09-error-handling.md)）。
- 派生了 Eq 忘了 Hash（或反之）：进 HashMap 的 key 需要 Eq + Hash 成对。

## 7. 小结

- 结构体管「数据的与组合」（字段），枚举管「数据的或组合」（携带数据的变体）——ADT 建模 + match 消费的闭环，穷尽性让数据形态演化安全。
- impl 的 self 三形态对应[借用惯例](05-borrowing.md)：&self 读、&mut self 写、self 消费；关联函数承载构造与命名空间。
- Option 是「可空」的类型化终结：match 穷尽强制处理、组合子链式流转——null 这类事故从语言层消失。
- derive 把常见 trait 的实现交给编译期生成——按语义派生（Debug/Clone/PartialEq/Hash/Default）。
- `..u` 的部分移动与字段所有权：结构体的所有权是字段级的，Rust 追踪到字段粒度。

## 8. 练习

**1.** 建模一个「矩形区域系统」：Rectangle 结构体（width/height）+ can_hold(&self, other: &Rectangle) 方法——练习 &self 只读方法与借用参数的组合（The Book 的经典例）。

> [!TIP]
> 思路`fn can_hold(&self, other: &Rectangle) -> bool`——两个 &self 系借用（读读相容，[第 5 篇](05-borrowing.md)铁律①），对比误写成 &mut self 的连锁问题。

**2.** 用枚举重构「状态机」：`enum State { Idle, Running { elapsed: u32 }, Paused { progress: f32 } }`——每个状态的附加数据放变体里，match 处理事件迁移。对比「一个大 struct + 状态标志位」的设计（[tagged union](../c/08-structs-unions.md) 的对照）。

> [!TIP]
> 思路枚举版的「状态数据只在对应状态存在」（Running 才有 elapsed）——不变量由类型保证；标志位版的数据与状态可能错位。ADT 建模的核心优势。

**3.** Option 链式练习：嵌套结构 `Config → server → host` 三层 Option，分别用 match 嵌套、and_then 链、`?`（需函数返回 Option）三种方式取值——对比可读性。

> [!TIP]
> 思路三层 match 嵌套 9 行 vs `config.and_then(|c| c.server).and_then(|s| s.host)` 一行——组合子的表达力。`c?.server?.host?` 的 ? 形态（Rust 1.22+ Option）最贴近直觉。

**4.** derive 边界实验：给含 f64 的结构体派生 Eq（编译错误：f64 不实现 Eq——NaN 问题）——理解「derive 按字段能力派生」与「浮点不能全序」的联动（[第 2 篇](../c/02-types.md)浮点比较）。

> [!TIP]
> 思路NaN ≠ NaN 让 f64 违反 Eq 的全序要求——derive 把类型系统的约束传递到了结构体层。「PartialEq 与 Eq 的区别」在浮点语境里具体化。

**5.** 建模对比题：「形状面积计算」分别用「枚举 + match」与「trait 对象（dyn Shape）」实现（[第 10 篇](10-generics-traits.md)预习），对比两种在「新增形状」与「新增操作」时的改动面——封闭集合 vs 开放扩展的经典权衡。

> [!TIP]
> 思路枚举版：加形状改一处（enum 定义）但所有 match 都要动（编译器点名）；trait 版：加形状零改动、加操作（如周长）要改 trait + 所有实现。数据驱动的选择：形状集合稳定→枚举、行为集稳定→trait。

**6.** 讨论：为什么 Rust 用「struct + enum + impl」替代「class」？从「数据与行为的分离度」「继承的表达力陷阱（组合爆炸/脆弱基类）」「ADT 的穷尽性安全」三个角度分析，对照 [C++ 类](../cpp/03-classes.md)与 [python 类](../python/07-classes.md)——Rust 的取舍牺牲了什么、换到了什么？

> [!TIP]
> 思路牺牲：继承式的行为复用与多态便利（用 trait 泛型补偿）。换到：穷尽性检查（数据形态演化安全）、不变量与数据的绑定（枚举变体）、无脆弱基类。取舍的本质：把「继承的表达力」换成「组合 + 类型系统的完备性」——收益在大型代码库的演化中兑现。
