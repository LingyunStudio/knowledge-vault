---
title: 变量与数据类型
order: 2
tags: 基础, 类型, 可变性
summary: 不可变绑定与遮蔽、基本类型、类型推断与转换，以及 Rust 的编译期数值安全。
---

Rust 变量默认**不可变**（immutable）。这不是风格偏好，而是语言设计的基石：能变的少了，编译器能推理的就多了。

## 变量绑定与可变性

```rust
fn main() {
    let x = 5;        // 不可变绑定
    // x = 6;         // ❌ 编译错误：cannot assign twice to immutable variable

    let mut y = 5;    // mut 显式声明可变
    y = 6;            // ✅
    println!("y = {y}");
}
```

> [!NOTE]
> 需要可变性时必须写 `mut`，这让"谁会改这个值"在代码层面一目了然。API 设计里也有一条推论：能不接受 `&mut` 就不接受。

### 遮蔽（Shadowing）

同名变量可以重复声明，后者**遮蔽**前者，连类型都可以换：

```rust
let spaces = "   ";          // &str
let spaces = spaces.len();   // usize，全新绑定，不是修改
```

这和 `mut` 不同：`mut` 是原地修改，类型不能变；遮蔽是创建新绑定，一切都可以变。循环解析输入、中间值转换时非常好用。

## 基本类型

### 标量类型

| 类型 | 位宽 | 说明 |
| --- | --- | --- |
| `i8` ~ `i128`, `isize` | 有符号整数 | `isize`/`usize` 跟随平台位数 |
| `u8` ~ `u128`, `usize` | 无符号整数 | `u8` 常用于字节序列 |
| `f32`, `f64` | 浮点 | 默认 `f64` |
| `bool` | 1 字节 | `true` / `false` |
| `char` | 4 字节 | **Unicode 标量值**，可存任意文字 |

```rust
let a: i32 = -42;       // 类型标注
let b = 42u8;           // 后缀标注
let c = 1_000_000;      // 数字下划线分隔
let hex = 0xff;
let bin = 0b1010;
let ch = '中';           // char 是 Unicode，'单引号'
```

整数默认 `i32`，它通常是性能与通用性的最佳平衡。

> [!WARNING]
> Debug 构建下整数溢出会 **panic**，Release 构建下默认**回绕**（two's complement wrapping）。不要依赖回绕行为，需要显式语义时用 `wrapping_add` / `checked_add` / `saturating_add`。

### 复合类型

**元组**：固定长度，元素类型可不同。

```rust
let tup: (i32, f64, char) = (500, 6.4, 'z');
let (x, y, z) = tup;        // 解构
let first = tup.0;           // 点号索引
```

**数组**：固定长度、元素同类型、分配在栈上。

```rust
let arr = [1, 2, 3, 4, 5];
let zeros = [0; 10];         // 10 个 0
let first = arr[0];
let len: usize = arr.len();  // 索引必须是 usize
```

需要动态长度时用 `Vec`，见 [常用集合](08-collections.md)。

## 类型推断与转换

Rust 的类型推断很强，但**不隐式转换数值类型**：

```rust
let n: u32 = 5;
let m: i64 = n;              // ❌ 不允许隐式转换
let m: i64 = n as i64;       // ✅ 显式 as 转换
let m: i64 = i64::from(n);   // ✅ From trait 转换（安全转换优先用这个）
let p: i32 = "42".parse().expect("不是数字");  // 字符串解析
```

> [!TIP]
> `as` 是"尽力转"（可能截断或改变符号），`From`/`Into` 只在**保证无损**的方向上提供转换。优先 `From`/`Into`，必要时才 `as`。

## 单元类型 `()`

没有值的时候用 `()`（读作 unit）。函数不写返回类型就是返回 `()`，它相当于其他语言的 void，但它是真实的一等类型。

## 编译期数值安全

数组越界在 Rust 是**运行时 panic**，但很多问题能在编译期抓住：

```rust
let arr = [1, 2, 3];
let i = 5;
// let e = arr[i];   // 运行时 panic：index out of bounds
// arr[5];           // ❌ 字面量越界：编译错误
```

配合 [所有权系统](04-ownership.md) 与类型系统，Rust 把"低级错误"大量前移到了编译期——这是"编译通过就基本能跑"这句话的由来。

## 练习

- [ ] 写一个程序，把华氏温度转换为摄氏温度（用 `f64`）
- [ ] 用遮蔽分步解析一个字符串："42" → 数字 → 数字平方
- [ ] 制造一次 Debug 溢出 panic，再用 `checked_add` 改写为返回 `Option`
