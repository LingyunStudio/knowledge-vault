---
title: 泛型与 Trait
order: 10
tags: 核心, trait, 泛型
summary: trait 定义共享行为，泛型让代码零成本复用；trait bound 是 Rust 的接口约束。
---

Trait 是 Rust 对"接口"的实现，泛型是"一份代码多种类型"。两者结合，加上单态化（monomorphization），达成**静态分发、零运行时开销**的抽象。

## Trait：定义共享行为

```rust
trait Summary {
    fn summarize(&self) -> String;

    // 默认实现，覆盖者可不写
    fn preview(&self) -> String {
        format!("【{}】", self.summarize())
    }
}

struct Article {
    title: String,
    body: String,
}

struct Tweet {
    user: String,
    text: String,
}

impl Summary for Article {
    fn summarize(&self) -> String {
        format!("{}: {}...", self.title, &self.body[..20.min(self.body.len())])
    }
}

impl Summary for Tweet {
    fn summarize(&self) -> String {
        format!("@{}: {}", self.user, self.text)
    }
}
```

trait 方法没有 `self` 的就是**关联函数**（如 `String::from`），用 `::` 调用。

## trait bound：约束泛型

```rust
// 写法一：impl Trait（简洁，适合参数/返回值）
fn notify(item: &impl Summary) {
    println!("快讯：{}", item.summarize());
}

// 写法二：显式泛型 + bound（等价，可表达更复杂约束）
fn notify<T: Summary>(item: &T) { ... }

// 多重约束
fn compare_and_print<T: Summary + PartialEq>(a: &T, b: &T) { ... }

// where 子句：约束多时更可读
fn process<T, U>(t: &T, u: &U) -> String
where
    T: Summary + Clone,
    U: Debug,
{ ... }
```

> [!NOTE]
> `impl Trait` 作返回值时返回的是**某个实现了该 trait 的固定类型**（编译期确定，即静态分发），而不是"任意实现"。需要运行时多态时用 `dyn Trait`。

## 静态分发 vs 动态分发

```rust
// 静态分发：单态化，为每个具体类型生成一份代码，无开销、可内联
fn print_all(items: &[impl Summary]) { ... }

// 动态分发：trait object，运行时查虚表，有间接开销
fn print_all_dyn(items: &[Box<dyn Summary>]) { ... }
```

| | `impl Trait` / `T: Trait` | `dyn Trait` |
| --- | --- | --- |
| 分发 | 编译期（快，可内联） | 运行时（虚表跳转） |
| 代码体积 | 每类型一份 | 一份 |
|异构集合 | ❌ | ✅ `Vec<Box<dyn Trait>>` |
| 返回不同具体类型 | ❌ | ✅ |

默认写泛型；当需要"运行时才确定类型"（插件、异构列表、简化二进制体积）时再上 `dyn`。

## 标准库核心 trait

这些 trait 出现频率极高，值得优先掌握：

| trait | 作用 |
| --- | --- |
| `Debug` / `Display` | 调试打印 / 用户展示 |
| `Clone` / `Copy` | 深拷贝 / 位拷贝 |
| `PartialEq` / `Eq` / `Hash` | 相等 / 哈希（HashMap 键的要求） |
| `PartialOrd` / `Ord` | 比较 / 排序 |
| `Default` | 默认值 |
| `From` / `Into` | 无损类型转换 |
| `Iterator` | 迭代协议 |
| `Fn` / `FnMut` / `FnOnce` | 可调用对象 |
| `Send` / `Sync` | 跨线程安全（见并发篇） |

`From` 实现后自动获得 `Into`：

```rust
impl From<Meter> for Millimeter { ... }
let mm: Millimeter = m.into();
```

## 常用派生与运算符重载

运算符就是 trait 的语法糖：`+` 对应 `Add`，`==` 对应 `PartialEq`。自己实现 `Add` 即可让自定义类型支持 `+`。

`#[derive(...)]` 覆盖了上表前六个的标准实现，能派生就别手写。

## trait 继承与 blanket impl

```rust
trait Named: Summary {        // Named 的实现者也必须实现 Summary
    fn name(&self) -> String;
}
```

标准库的 blanket impl（如 `Into<T> for T where T: From<T>`）让整个生态的转换 API 自动互联。

## 泛型与所有权

泛型参数默认会**拥有**值，配合生命周期标注常见于持有引用的结构：

```rust
struct Wrapper<T> {
    inner: Vec<T>,
}

impl<T: Display> Wrapper<T> {     // impl 块上也要加约束
    fn show(&self) {
        for x in &self.inner { println!("{x}"); }
    }
}
```

> [!TIP]
> trait bound 写在 `impl` 块上（而不是每个方法）可以只约束部分方法：`impl<T> Wrapper<T> { fn general(&self) } impl<T: Display> Wrapper<T> { fn show(&self) }`——`general` 对所有类型可用，`show` 只对满足约束的类型可用。

## 练习

- [ ] 定义 `trait Shape { fn area(&self) -> f64; }`，为三个结构体实现，并用 `Vec<Box<dyn Shape>>` 求总面积
- [ ] 写一个泛型函数 `fn max_of<T: PartialOrd>(a: T, b: T) -> T`
- [ ]为自己的错误枚举实现 `From<io::Error>`，然后观察 `?` 如何自动转换
