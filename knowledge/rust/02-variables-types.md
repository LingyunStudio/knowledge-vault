---
title: 变量与类型：不可变是默认
order: 2
tags: mut, shadowing, 类型, 整数溢出
summary: 变量绑定与默认不可变的设计动机、shadowing 与 mut 的区别、const/static、标量类型全景（整型的溢出行为在 debug/release 的差异！）、元组与数组、类型推断的边界与 as 转换。
---

Rust 变量系统的第一原则：**不可变是默认**——`let x = 5` 之后 `x = 6` 编译不过，要改必须显式声明 `let mut x`。这个默认与 [C 的 const](../c/02-types.md) 体系方向相反（C 是可变默认），它把「这个值会不会变」变成编译器与读者都能看见的显式信息。

## 1. 绑定、mut 与 shadowing

```rust
let x = 5;
// x = 6;                    // ❌ 编译错误：cannot assign twice to immutable variable
let mut y = 5;
y = 6;                        // ✅ mut 声明可变

// shadowing：重新绑定同名的**新**变量（类型都可以不同）
let spaces = "   ";           // &str
let spaces = spaces.len();    // usize —— 不是修改，是遮蔽旧绑定！
```

shadowing 与 mut 的区别值得精确理解：

| 维度     | `mut`                    | shadowing                    |
| -------- | ------------------------ | ---------------------------- |
| 本质     | 同一个变量原地修改        | 创建新绑定，旧名字被遮蔽      |
| 类型     | 必须相同                  | 可以不同（转换的惯用法）      |
| 作用     | 允许状态变化              | 值的「阶段化处理」（解析→计数）|

shadowing 的惯用场景：`let input = input.trim()`——**同名变量承载「同语义的不同阶段」**，避免 `input2/input_trimmed` 的命名增殖；旧绑定在新绑定前仍可使用（临时对比）。

```rust
const MAX_POINTS: u32 = 100_000;      // 编译期常量：类型必须标注、编译期求值
static LANGUAGE: &str = "Rust";       // 静态：程序全程存活（全局可变要 unsafe/原子）
```

const 与 static 的区别：const 内联进使用处（无固定地址）、static 有固定地址（全局生命周期）——常量优先 const，需要可寻址/跨线程共享才 static。

## 2. 标量类型全景

| 类型       | 范围/大小             | 默认推断    |
| ---------- | --------------------- | ----------- |
| `i8/i16/i32/i64/i128/isize` | 有符号，i32 默认 | 字面量无后缀时 |
| `u8/u16/u32/u64/u128/usize` | 无符号（usize 与指针同宽）| 索引/长度 |
| `f32/f64`  | IEEE 754              | f64 默认    |
| `bool`     | true/false            | —           |
| `char`     | **4 字节 Unicode 标量**| —           |

```rust
let a: i32 = -42;
let b = 255u8;                 // 后缀标注
let hex = 0xFF; let oct = 0o77; let bin = 0b1010; let under = 1_000_000;
let c = '中';                   // char 是 Unicode 标量（4 字节）——不是 C 的 1 字节！
let f: f64 = 2.5;
```

`char` 的 4 字节设计：**一个 char 是一个 Unicode 标量值**（不是用户感知的「字符」——组合字符/emoji 是多个标量）。「字符数」的正确操作在 String/str 的 chars() 与 graphemes 讨论（[第 8 篇](08-collections.md)）。

### 2.1 整数溢出：debug 与 release 的行为差异（重要！）

```rust
let x: u8 = 250;
let y = x + 10;                // debug 构建：panic！release 构建：回绕成 4（两码事！）
```

| 构建        | 溢出行为                                  |
| ----------- | ----------------------------------------- |
| debug       | **panic**（overflow checks 默认开）        |
| release     | **两补码回绕**（静默——与 C 的有符号 UB 不同，Rust 定义为回绕）|

工程纪律：**显式选择溢出语义**，不依赖构建模式的偶然行为：

```rust
let z = x.checked_add(10);      // Option<u8>：None 表示溢出（显式处理）
let w = x.saturating_add(10);   // 饱和：停在 255（计数/容量的常用语义）
let v = x.wrapping_add(10);     // 显式回绕（哈希/位运算意图）
let ov = x.overflowing_add(10); // (结果, 是否溢出)
```

四兄弟的语义化选择正是 Rust 精神的体现：**把「溢出时该怎么办」写成代码而不是留给运气**。对比 [C 的有符号溢出 UB](../c/02-types.md) 与 [python 的任意精度](../python/02-data-model.md)——三种语言的溢出光谱。

## 3. 复合类型：元组与数组

```rust
let tup: (i32, f64, char) = (500, 6.4, 'z');     // 元组：异构、定长
let (a, b, c) = tup;                              // 解构
let first = tup.0;                                // 点号访问

let arr: [i32; 5] = [1, 2, 3, 4, 5];              // 数组：同构、**编译期定长**、栈上
let zeros = [0; 8];                                // [元素; 重复次数]
let first = arr[0];                                // 越界 → panic（边界检查默认开）
```

数组 `[T; N]` 的定长性是它的身份：**长度是类型的一部分**（[C 篇](../c/05-arrays-strings.md)、[C++ array](../cpp/08-stl-containers.md)的同款语义）——尺寸已知且小（坐标/缓冲区）用数组；可变长度用 Vec（[第 8 篇](08-collections.md)）。元组的用途是「临时打包多个不同类型的值」（函数多返回值的载体——`Result<(T, U), E>`）。

## 4. 类型推断与标注

```rust
let x = 5;                     // 推断为 i32（默认）
let y: u64 = 5;                // 显式标注
let z = 5.0;                   // f64（浮点默认）
let v: Vec<_> = some_iter.collect();   // 部分推断（下划线让编译器定）

// 推断的边界：无法从使用处唯一确定时必须标注
let parsed = "42".parse().unwrap();       // ❌ 报错：type annotations needed
let n: i32 = "42".parse().unwrap();       // ✅ 或 "42".parse::<i32>()
```

Rust 的类型推断是**局部的、基于赋值目标的**（Hindley-Milner 的简化版）——标注的原则：**函数签名必须标注（接口文档）、局部变量尽量靠推断**。`parse()` 的报错是学习「推断边界」的最好教材：泛型的目标类型需要你声明。

### 4.1 数值转换：as 与转换四兄弟

```rust
let big: i64 = 100;
let small = big as i8;              // ❌ as 截断（静默丢高位）——慎用
let ok = i8::try_from(big);         // ✅ Result：范围检查（转换的 Rust 姿势）
let f = 3.7_f64 as i32;             // 3（向零截断）
i32::from(small_val); big.try_into(); // From/Into trait 的转换体系
```

`as` 的语义是「位级重解释/截断」——与 [C 的 cast](../c/02-types.md) 同样危险；`try_from/try_into`（返回 Result）与 `From/Into`（无损转换）是惯用通道。整数与浮点互转也有精度语义（f64 → i64 超范围是饱和/未定义的边界——i64::try_from 处理）。

## 5. 陷阱清单

- 靠 release 的回绕行为：溢出语义显式化（checked/saturating/wrapping）。
- as 静默截断：try_from/try_into。
- shadowing 当 mut 用（类型也变了）：语义不同——遮蔽是「新值阶段」，mut 是「原地改」。
- char 当字节（C 习惯）：char 是 4 字节 Unicode 标量；字节用 u8。
- 数组越界期待 UB：Rust 是 panic（安全语言的边界检查默认开）。
- 忘了 usize 与索引的配合（i32 下标编译错）：索引/长度用 usize（[第 2 篇](../c/02-types.md)size_t 纪律的镜像）。
- const 用运行时值初始化：const 必须编译期可求值（运行时初始化用 static + OnceLock）。

## 6. 小结

- 不可变默认把「值是否会变」显式化；mut 与 shadowing 是两个机制（原地改 vs 阶段化重绑）——后者是 Rust 命名洁癖的解药。
- 整数溢出在 debug panic / release 回绕——checked/saturating/wrapping/overflowing 四兄弟让语义显式化，对比 C 的 UB 与 python 的任意精度。
- 数组定长（长度入类型）、元组异构解构、char 是 Unicode 标量——复合类型的边界清晰。
- 推断的边界（parse 需要目标类型）与转换的体系（as 危险、try_from 安全、From/Into 无损）。
- usize 是索引与长度的正统类型——与 C 的 size_t 纪律完全镜像。

## 7. 练习

**1.** 分别在 debug 与 release 构建下触发 u8 溢出，观察 panic 与回绕；再用 saturating_add/wrapping_add 显式化两种语义——把「构建模式决定行为」的隐患写成你自己的一页笔记。

> [!TIP]
> 思路`cargo run`（debug）panic、`cargo run --release` 回绕——这个差异的工程含义：测试环境与生产环境的行为可能不同！显式语义化 API 是唯一可靠路线。

**2.** shadowing 练习：把「读取输入 → trim → parse → 校验范围」写成同名的四段 shadowing 链，对比用四个不同变量名的版本——评价可读性。

> [!TIP]
> 思路shadowing 链的阅读体验：「input 这个概念在不断精化」；反例：转换类型不同但语义相同的场景才适合——语义跳跃大时新名字更诚实。

**3.** 写一个函数接受 `[f64; 3]`（三维坐标）返回长度，练习：数组类型标注、解构、sqrt（f64 方法）。再故意传一个 4 元素数组看编译错误——「长度入类型」的体验。

> [!TIP]
> 思路`fn len3(p: [f64; 3]) -> f64`：类型系统保证只接受三维——参数错误在编译期被拒（对比 C 传长度参数的运行时信任）。

**4.** 实现「安全的摄氏转华氏」：输入 i16，计算含乘法（可能溢出），用 try_from/checked_mul 写出正确处理范围的版本，与 as 版本对比边界值。

> [!TIP]
> 思路`c as i64 * 9 / 5 + 32`（升宽防中间溢出）再 try_from 回 i16——「升宽计算、收窄校验」是整型运算的通用模板。

**5.** 探索 char 与字节：`'中'.len_utf8()` 是 3、`'中' as u32` 是码点——用 chars() 遍历含 emoji 的字符串，观察「一个 emoji ≠ 一个 char」的现象。

> [!TIP]
> 思路Unicode 的三层（码点/字形/字节）在 Rust 里对应 char/graphemes/bytes——「字符数」的语义必须先定义。字符串篇（[第 8 篇](08-collections.md)）的 UTF-8 处理由此展开。

**6.** 讨论：为什么 Rust 选择「不可变默认 + mut 显式」而不是 C 的「可变默认 + const 显式」？从「API 契约的可读性」「并发安全（共享可变是万恶之源）」「编译器优化的信息量」三个角度分析，并对照 [python 的约定式私有](../python/07-classes.md)（_ 前缀）与 [C++ const](../cpp/02-references-auto.md)——「默认不变」在三个语言里的不同强制力。

> [!TIP]
> 思路强制力光谱：Rust（编译器强制）> C++ const（编译器但可 const_cast）> python（约定）。默认值的强制力决定了「不变量」的可靠性——并发安全（共享不可变天然安全）是 Rust 选择的最强动机。
