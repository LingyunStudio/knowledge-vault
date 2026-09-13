---
title: 智能指针
order: 12
tags: 核心, Rc, RefCell
summary: Box 装箱、Rc 共享所有权、RefCell 内部可变性——打破默认规则的三件工具。
---

智能指针是一类实现了 `Deref`/`Drop` 的结构体，行为像指针但附带元数据与清理逻辑。本章只讲最常用的三个：`Box`、`Rc`、`RefCell`，它们分别在"**堆分配**""**共享所有权**""**运行时可变性**"三个维度上扩展了默认规则。

## Box<T>：把值放进堆

```rust
let b = Box::new(5);
println!("b = {b}");        // Deref 自动解引用

// 递归类型的必需品
enum List {
    Cons(i32, Box<List>),
    Nil,
}
```

三个典型用途：

1. **打破无限大小**：递归类型、巨大结构体的栈占位
2. ** trait 对象**：`Box<dyn Trait>` 动态分发（见 [泛型与 Trait](10-generics-traits.md)）
3. **转移大值**避免拷贝（现代编译器优化下较少需要）

> [!NOTE]
> `Box` 是"单一所有者，只是搬家"。它不解决共享问题——那是 Rc 的事。

## Rc<T>：引用计数共享所有权

当**多个所有者**合法且必要时（图节点、共享缓存），用 `Rc`（Reference Counted）：

```rust
use std::rc::Rc;

let a = Rc::new(String::from("共享数据"));
let b = Rc::clone(&a);          // 只增加计数，不深拷贝
let c = a.clone();              // 等价写法

println!("{}", Rc::strong_count(&a));   // 3

drop(c);
println!("{}", Rc::strong_count(&a));   // 2
// 计数归零时，数据被释放
```

`Rc::clone(&a)` 的开销只是计数器 +1，与 `String::clone` 的堆拷贝完全不同量级。

> [!WARNING]
> `Rc` 是**单线程**的（计数器非原子）。跨线程共享用 `Arc`（Atomic Rc）。而且 `Rc<T>` 的内容**不可变**——共享的东西怎么能随便改？

## RefCell<T>：把借用检查挪到运行时

`Rc` 只读的限制由 `RefCell` 打破——它把"同一时刻要么多个读、要么一个写"的借用规则从编译期挪到运行期：

```rust
use std::cell::RefCell;

let data = RefCell::new(vec![1, 2, 3]);

data.borrow_mut().push(4);          // 可变借用（运行时记账）
let len = data.borrow().len();      // 不可变借用
assert_eq!(len, 4);
```

- `borrow()` → `Ref<T>`（多个可并存）
- `borrow_mut()` → `RefMut<T>`（独占）
- 违反规则**运行时 panic**：`already borrowed: BorrowMutError`

### 经典组合：Rc<RefCell<T>>

共享 + 可变，两者搭配是 Rust 处理共享可变状态的标准姿势（单线程）：

```rust
use std::rc::Rc;
use std::cell::RefCell;

let shared = Rc::new(RefCell::new(0));

let a = Rc::clone(&shared);
*a.borrow_mut() += 1;

let b = Rc::clone(&shared);
*b.borrow_mut() += 1;

assert_eq!(*shared.borrow(), 2);
```

> [!WARNING]
> `RefCell` 绕过了编译期检查，纪律就全靠你了。最容易踩的坑是**在一个 borrow 还活着时再 borrow_mut**：
>
> ```rust
> let mut m = data.borrow_mut();
> m.push(5);
> let n = data.borrow();    // ❌ panic！m 还活着
> ```
>
> 解法是缩小借用范围：把 `borrow_mut()` 的结果限制在最小的作用域里。

## 引用循环与内存泄漏

`Rc` 有 GC 的便利，也有 GC 的经典病：**引用循环**导致计数永不清零：

```rust
// A 持有 B，B 持有 A → 两者计数都不归零 → 泄漏
struct Node {
    next: RefCell<Option<Rc<Node>>>,
}
```

解法是把环上的一条边改成**弱引用** `Weak`（不增加强计数）：

```rust
use std::rc::{Rc, Weak};

struct Node {
    parent: RefCell<Weak<Node>>,      // 弱引用：父节点不因子节点存活
    children: RefCell<Vec<Rc<Node>>>,
}

// Weak 需要升级成 Rc 才能访问，可能失败（数据已释放）
let strong: Option<Rc<Node>> = weak.upgrade();
```

> [!TIP]
> 树/图结构的设计口诀：**"父 → 子"用强引用，"子 → 父"用 Weak**。用 `Rc::downgrade(&rc)` 生成 Weak。

## 选择指南

| 需求 | 工具 |
| --- | --- |
| 放进堆 / 递归类型 | `Box<T>` |
| 单线程共享所有权（只读） | `Rc<T>` |
| 单线程共享可变 | `Rc<RefCell<T>>` |
| 跨线程共享所有权（只读） | `Arc<T>` |
| 跨线程共享可变 | `Arc<Mutex<T>>` / `Arc<RwLock<T>>` |
| 打破引用循环 | `Weak<T>` |
| 惰性初始化 / 全局常量 | `OnceLock` / `LazyLock` |

看到 `Rc<RefCell<...>>` 嵌套变深时先停下来想想：是不是数据建模可以更扁平？这些工具是逃生舱，不是默认姿势。

## 练习

- [ ] 用 `Rc<RefCell<Vec<String>>>` 实现一个多"视图"共享的日志，两个函数都能写入
- [ ] 故意触发 `BorrowMutError`，再重构代码把借用范围缩小修复它
- [ ] 用父子 Weak 引用实现一棵树，遍历时验证父节点可随时销毁
