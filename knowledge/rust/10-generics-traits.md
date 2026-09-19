---
title: 泛型与 trait：多态的两种形态
order: 10
tags: trait, 泛型, dyn, 单态化, trait bound
summary: trait 作为 Rust 的「接口」（定义与实现分离）、泛型与单态化（编译期特化的零成本）、trait bound 的三种写法、std 核心 trait 全景（Display/Clone/From/Iterator）、dyn Trait 动态派发与泛型的取舍、以及 trait 作为能力契约的设计用法。
---

Rust 的多态有两个形态：**泛型**（编译期单态化——每种类型一份代码，零运行时成本）与 **trait 对象**（运行时动态派发——虚表调用，[C++ 虚函数](../cpp/10-inheritance.md)的形态）。两者的共同基础是 **trait**：定义「类型必须具备的能力」的契约。

## 1. trait：能力的契约

```rust
trait Summary {
    fn summarize_author(&self) -> String;                 // 必须实现的方法

    fn summarize(&self) -> String {                       // 默认方法（可覆盖）
        format!("阅读 {} 的更多内容...", self.summarize_author())
    }
}

struct Article { title: String, author: String, body: String }
struct Tweet { user: String, text: String }

impl Summary for Article {                                // 为类型实现 trait
    fn summarize_author(&self) -> String { self.author.clone() }
    // summarize 用默认实现
}

impl Summary for Tweet {
    fn summarize_author(&self) -> String { format!("@{}", self.user) }
    fn summarize(&self) -> String { format!("{}, by {}", self.text, self.user) }   // 覆盖默认
}
```

trait 的语义：**「这个类型能做什么」的契约**——与 [C++ 的抽象类](../cpp/10-inheritance.md)、[java 接口](../python/07-classes.md)同位，但 Rust 的 trait 是**独立于类型定义**的（后补实现、跨 crate 可实现、一个类型实现多个 trait）——组合而非继承的多态。默认方法让 trait 可以提供「部分实现」（调用方只需实现必要项）。

## 2. 泛型与单态化：零成本的静态派发

```rust
// trait bound：T 必须实现 Summary
fn notify<T: Summary>(item: &T) {
    println!("速报! {}", item.summarize());
}

notify(&article);        // 编译期单态化：生成 notify_Article
notify(&tweet);          // 编译期单态化：生成 notify_Tweet
// 运行时调用 = 直接函数调用（无虚表、可内联）—— 零成本
```

**单态化（monomorphization）**：泛型函数对每个用到的类型**生成一份专用代码**——与 [C++ 模板](../cpp/07-templates.md)同机制（[第 7 篇](../cpp/07-templates.md)的实例化）。代价：编译时间与二进制膨胀（[C++ 同款账](../cpp/07-templates.md)）；收益：静态派发（可内联）——性能敏感路径用泛型。

三种 bound 写法（同一语义的不同甜度）：

```rust
fn notify<T: Summary>(item: &T) { }             // 泛型参数 + bound
fn notify(item: &impl Summary) { }              // impl Trait 语法糖（单参数场景）
fn notify<T>(item: &T) where T: Summary + Display, T: Clone { }   // where：复杂约束的清晰形态
```

`impl Trait` 还用于**返回值**：`fn make() -> impl Summary`（返回某个实现了 Summary 的类型——具体类型编译期确定，调用方只见契约）。

## 3. dyn Trait：动态派发

```rust
// trait 对象：运行时才知道具体类型（异构集合的形态）
let feed: Vec<Box<dyn Summary>> = vec![Box::new(article), Box::new(tweet)];

for item in &feed {
    println!("{}", item.summarize());     // 虚表派发（[C 篇函数指针](../c/09-function-pointers.md)的形态）
}
```

`dyn Summary` 是「不知道具体类型、只知道它实现 Summary」——编译期生成虚表、调用走间接跳转（与 [虚函数](../cpp/10-inheritance.md)同价）。两种多态的选型：

| 维度         | 泛型（static）             | dyn（dynamic）              |
| ------------ | -------------------------- | --------------------------- |
| 派发         | 编译期（可内联）            | 运行时虚表                   |
| 集合类型     | `Vec<T>`（同构）           | `Vec<Box<dyn Trait>>`（异构）|
| 编译产物     | 每类型一份（膨胀）          | 一份                          |
| 适用         | 热路径、同构数据            | 插件/异构集合/降低编译膨胀    |

与 [C++ 模板 vs 虚函数](../cpp/07-templates.md)的对照完全成立——「零成本抽象」的另一个体现：**两种派发都显式可选，成本写在选择里**。

## 4. std 的核心 trait 全景

| trait            | 语义                 | derive？   | 用途                                    |
| ---------------- | -------------------- | ---------- | --------------------------------------- |
| `Debug`          | 开发者打印 {:?}      | ✅         | 日志/调试                                |
| `Display`        | 用户打印 {}          | ❌ 手写     | 面向用户的输出                           |
| `Clone`/`Copy`   | 显式深拷贝/位拷贝     | ✅         | [第 4 篇](04-ownership.md)               |
| `PartialEq/Eq`   | 相等比较             | ✅         | ==、HashMap key（配 Hash）                |
| `Hash`           | 哈希                 | ✅         | HashMap/HashSet 的 key                   |
| `Default`        | 默认值               | ✅         | `..Default::default()`                   |
| `From/Into`      | 无损转换             | ❌         | 类型转换体系（[第 2 篇](02-variables-types.md)、`?` 的 [From](09-error-handling.md)）|
| `Iterator`       | 迭代能力             | ❌         | for 循环/map/filter（[第 11 篇](11-closures-iterators.md)）|
| `Drop`           | 释放钩子             | ❌         | RAII（[第 4 篇](04-ownership.md)）        |

trait 的「能力契约」用法：**函数签名声明最小能力**——`fn process<T: Read>(r: T)` 接受任何可读源（文件/内存/Cursor）；`impl AsRef<str>` 接受任何字符串形态——**能力即接口，类型即实现**。这是 [C++ concepts](../cpp/07-templates.md) 与 [python 鸭子类型](../python/02-data-model.md)的编译期强化。

## 5. 陷阱清单

- dyn Trait 的大小未知（存进 Vec 要 Box）：trait 对象必须放指针后（Box/Arc/&）。
- 泛型与 dyn 混淆（`impl Trait` 参数 vs `&dyn Trait` 参数）：静态派发 vs 动态派发的语义差异（泛型参数对每个类型单态化）。
- 为「未来可能的扩展」全用 dyn：虚表税白付；封闭集合用枚举（[第 7 篇](07-structs-enums.md)的权衡）。
- derive Eq 忘 Hash（或 Ord 需要全序的语义审查）：key 契约与排序语义。
- orphan rule 惊讶（不能为外部类型实现外部 trait）：新建包装类型（newtype pattern）是标准解。
- trait 方法改签名：所有实现点破坏（契约的代价）；默认方法可缓冲演化。
- 忘 `where` 可读性：多 bound 的函数签名用 where 子句。

## 6. 小结

- trait 是「能力契约」：定义与类型解耦（后补/跨 crate/多实现）——组合式多态的载体。
- 泛型 = 编译期单态化（零派发成本、二进制膨胀）vs dyn = 运行时虚表（异构/一份代码）——「成本写在选择里」的零成本抽象。
- bound 三写法（T: Trait / impl Trait / where）+ 返回 impl Trait——契约在签名中的表达层级。
- std 的 trait 生态是日常接口：Debug/Clone/PartialEq/Hash/Default/From/Iterator/Drop——derive 与手写的分工。
- 封闭集合用枚举、开放扩展用 trait 对象、热路径用泛型——三个多态场景的选型矩阵（与 [C++](../cpp/07-templates.md)、[函数指针](../c/09-function-pointers.md)的对位）。

## 7. 练习

**1.** 把「媒体播放器」建模为 trait：Media { fn play(&self); fn duration(&self) -> u32 }，实现 Audio/Video/Podcast 三类型；用泛型函数与 `Vec<Box<dyn Media>>` 两种方式消费——对比两种多态的代码形态。

> [!TIP]
> 思路泛型版只能装同一种媒体（Vec<T: Media>）、dyn 版混装——「同构与异构」的选型就在这里。播放走 dyn 虚表 vs 泛型单态化的区别在 Compiler Explorer 里可见。

**2.** 单态化验证：写一个泛型 `fn max_of<T: PartialOrd>(a: T, b: T)`，用 i32 与 f64 分别调用，在 Compiler Explorer 观察生成两份函数——「每类型一份代码」的实证。

> [!TIP]
> 思路符号名里的类型后缀（max_of::<i32>）是单态化的证据。与 [C++ 模板](../cpp/07-templates.md)的实例化完全同机制——两语言的「零成本泛型」血脉相同。

**3.** trait bound 进阶：实现 `fn print_all<T: Display>(items: &[T])` 与 `fn largest<T: PartialOrd>(list: &[T]) -> &T`——练习 where 子句与多 bound（`T: PartialOrd + Debug` 同时需要打印）。

> [!TIP]
> 思路largest 的返回 `&T`（借用列表元素，[第 5 篇](05-borrowing.md)）——bound 与借用同时出现在签名，是 Rust 泛型的完整形态。Debug bound 是「打印错误信息」的附带需求——bound 按实际需求加。

**4.** From/Into 体系练习：为自定义 `Temperature` 类型实现 `From<f64>`（摄氏），然后 `let t: Temperature = 25.0.into();`——理解 From 的对称自动实现（Into 自动获得）与 ? 的 [From 通道](09-error-handling.md)。

> [!TIP]
> 思路实现 From 自动获得 Into（标准库的 blanket impl）——转换体系「实现一侧、两侧可用」。与 [C++ 的隐式转换](../cpp/03-classes.md)对比：Rust 的转换走显式 trait（.into() 可见）。

**5.** orphan rule 体验：尝试为外部类型 Vec<T> 实现外部 trait Display（编译拒绝）——用 newtype 模式（包装 struct MyVec(Vec<T>)）绕行——理解「实现权」的归属规则。

> [!TIP]
> 思路orphan rule 防「生态混乱」（谁都给 String 加方法的世界）。newtype 是标准解——同时是「零成本包装类型」的惯用法（[第 12 篇](12-smart-pointers.md)的类型状态思想入口）。

**6.** 讨论：Rust 的 trait 与 [Go 的 interface](../python/07-classes.md)、[C++ 的 concepts](../cpp/07-templates.md)、[Java 的接口]相比——「后补实现」（给已有类型实现新 trait）与「默认方法」的组合为什么强大？从「生态协作（你无法修改的类型获得新能力）」的角度，分析「能力与类型分离」对库设计的意义。

> [!TIP]
> 思路trait 的「能力外挂」让第三方可以给 String 实现 serde 的序列化、给任意类型实现你库的 trait——类型不需要预知所有用例。这与继承体系的「设计时继承」相比是生态级的解耦——库作者的边界感由此而来。
