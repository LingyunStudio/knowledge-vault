---
title: 错误处理：Result 与 ?
order: 9
tags: Result, panic, ? 运算符, 错误传播
summary: 两大失败类别（panic 不可恢复 vs Result 可恢复）、? 运算符的错误传播机制（From 自动转换）、组合子链式处理、自定义错误类型与 thiserror/anyhow 的分工（库用精确类型、应用用 anyhow）、以及「错误即值」的设计哲学。
---

Rust 的错误处理分为两个世界：**panic**（不可恢复：程序出 bug 了，展开或中止）与 **Result**（可恢复：预期中的失败，调用方决定怎么办）。核心设计是**错误即值**——`Result<T, E>` 把错误编码进返回类型，编译器强制处理（[第 7 篇](07-structs-enums.md)的 Option 同族）。

## 1. panic vs Result：失败的分类

```rust
// panic：不可恢复 —— 代码的 bug（违反契约/不可能的状态）
panic!("crash and burn");
let x: Option<i32> = None;
x.unwrap();                       // panic：显式承认「这里必有值，没有就是 bug」

// Result：可恢复 —— 外部世界的失败（文件不存在/网络断/输入非法）
enum Result<T, E> {
    Ok(T),
    Err(E),
}

fn parse_config(path: &str) -> Result<Config, ConfigError> { ... }
```

分类的判据：**「这是程序的 bug 还是环境的现实？」**——数组越界/断言失败（bug）→ panic 合理（尽早崩溃带现场）；文件不存在/网络超时（现实的常态失败）→ Result（调用方决定重试/降级/上报）。对照 [C 的返回值约定](../c/12-errors-robustness.md)与 [python 的异常体系](../python/09-errors-exceptions.md)：Result 相当于「强制检查的返回值 + 类型化的错误通道」。

## 2. match 处理 Result：显式的两分支

```rust
use std::fs::File;
use std::io::{self, Read};

fn read_username(path: &str) -> Result<String, io::Error> {
    let file = File::open(path);              // Result<File, io::Error>
    let mut file = match file {
        Ok(f) => f,
        Err(e) => return Err(e),              // 失败：把错误上抛
    };
    let mut s = String::new();
    match file.read_to_string(&mut s) {
        Ok(_) => Ok(s),
        Err(e) => Err(e),                     // 同样上抛
    }
}
```

match 版本「显式但啰嗦」——每个 Result 都要手写两分支。它是理解 ? 的基础（? 就是这个模式的语法糖）。

## 3. ? 运算符：错误传播的语法糖

```rust
fn read_username(path: &str) -> Result<String, io::Error> {
    let mut file = File::open(path)?;         // Ok → 取值继续；Err → 直接 return Err(e)
    let mut s = String::new();
    file.read_to_string(&mut s)?;             // 同样：一行完成「解包或上抛」
    Ok(s)
}
```

`?` 的语义：**Ok 取出值、Err 立即从函数返回错误**——把 `match` 的上抛样板压缩成一个字符。它要求函数返回 Result（错误有处可去）——`main` 也可以返回 Result（顶层错误处理）。

```rust
// ? 的完整机制：还会做错误类型转换（From trait）
fn read_config() -> Result<Config, AppError> {
    let text = std::fs::read_to_string(path)?;    // io::Error → AppError（自动！）
    let config = parse(text)?;                     // ParseError → AppError（自动）
    Ok(config)
}
// 编译器要求：AppError: From<io::Error> —— 不同错误类型间的桥
```

`?` 的 From 自动转换是错误分层的基础：**库的错误类型 → 应用的错误类型**在传播中自动包装（[第 12 篇](../c/12-errors-robustness.md)的「边界翻译」原则在语言机制里的落地）。

## 4. 组合子：链式处理

```rust
// 不用 match/ ? 的轻量处理
let port = parse_port(input).unwrap_or(8080);          // 失败用默认值
let port = parse_port(input).unwrap_or_else(|e| { log(e); 8080 });  // 失败走逻辑
let opt = result.ok();                                  // Result → Option（丢错误信息）
let name = maybe_name.ok_or("name missing")?;           // Option → Result（补错误信息）

// 链式转换
parse_port(input)
    .map(|p| p.clamp(1, 65535))                         // Ok 分支变换
    .map_err(|e| format!("端口错误: {e}"))              // Err 分支变换
    .and_then(|p| check_available(p))                   // 链上再接一个可能失败的步骤
```

组合子的哲学：**错误处理变成值的变换管道**（[python 的 optional monadic](../python/12-quality.md)、[Rust 的迭代器](11-closures-iterators.md)同思想）——`?` 管「必须成功否则早退」、组合子管「失败有默认/可转换」。

## 5. 自定义错误与生态库

```rust
// 库的形态：精确的错误枚举（thiserror 派生）
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("配置文件读取失败: {0}")]
    Io(#[from] std::io::Error),           // #[from]：自动实现 From（? 的转换通道）
    #[error("解析错误，第 {line} 行: {msg}")]
    Parse { line: usize, msg: String },
}
```

| 库         | 定位                    | 何时用                       |
| ---------- | ----------------------- | ---------------------------- |
| `thiserror`| 库：派生精确的错误枚举    | 错误类型要被调用方**程序化处理** |
| `anyhow`   | 应用：anyhow::Error 万能错误 + 上下文 | 错误只需**记录/上报**，不分类处理 |

```rust
// 应用形态：anyhow + 上下文（错误链）
use anyhow::{Context, Result};

fn run() -> Result<()> {
    let text = std::fs::read_to_string("config.toml")
        .context("读取配置文件失败")?;                 // 错误链：上下文包装
    let cfg: Config = toml::from_str(&text)
        .context("配置解析失败")?;
    Ok(cfg)
}
```

thiserror/anyhow 的分工是 Rust 错误处理生态的成熟标志：**库给调用方精确类型（可 match）、应用给自己堆栈与上下文（可诊断）**——「错误是值」让两个库的分工成为可能（值可以精确也可以泛化）。错误链（context）对应 [python 的异常链 from](../python/09-errors-exceptions.md) 与 [C 的洋葱错误信息](../c/12-errors-robustness.md)。

## 6. 陷阱清单

- unwrap/expect 满天飞：panic 进入生产路径；unwrap 要有「不可能失败的论证」（注释）。
- 错误类型丢失信息（map_err 剥成 String）：保留错误链；库用 thiserror 枚举。
- ? 的 From 转换没实现：编译错误指引你加 #[from] 或手动 map_err。
- 库用 anyhow（调用方无法程序化处理）：库给精确类型、应用才用 anyhow。
- panic 在库代码中暴露（供调用的库）：库用 Result 传播；panic 留给真正的不变量违反。
- 忘记错误是「值」可以组合：把错误处理写成嵌套 match 泥潭；组合子/ ? 管道。
- catch_unwind 试图「捕获一切继续跑」：panic 后的不变量破坏不可信；恢复要谨慎（[第 4 篇](../c/12-errors-robustness.md)的事务边界）。

## 7. 小结

- 失败二分法：panic 管 bug（不可恢复、尽早暴露）、Result 管现实失败（可恢复、调用方决策）——判据是「bug 还是环境的现实」。
- ? 是错误传播的语法糖：Ok 解包、Err 上抛、From 自动跨类型转换——「洋葱式错误链」的语言级机制。
- 组合子把错误处理变成值的管道：unwrap_or/and_then/map_err 与 ? 的分工（默认/链式 vs 早退）。
- 生态分工：thiserror（库的精确枚举）+ anyhow（应用的上下文链）——「错误即值」让分层处理成为可能。
- unwrap 的纪律：要么有「不可能失败」的论证，要么交给组合子与 ?。

## 8. 练习

**1.** 把一段「三层 match 上抛」的代码重构为 ? 版本，对比行数与可读性；再故意让两层错误类型不同，观察 ? 的 From 编译错误并修复（#[from]）。

> [!TIP]
> 思路重构的三层样板消失后，函数体的「业务逻辑」浮现——? 的价值不是省字符是「让主路径成为主角」。From 缺失的报错会教你补转换通道。

**2.** panic vs Result 的分类练习：对以下场景逐一判定（数组越界/配置文件缺失/网络超时/整数溢出/用户输入非法/断言内部不变量）——给出你的判定与理由，形成自己的「panic 白名单」。

> [!TIP]
> 思路判据「bug 还是现实」：越界与不变量违反=bug（panic）、配置缺失/网络/输入=现实（Result）。溢出是灰色（[第 2 篇](02-variables-types.md)的 checked 系）——「显式选择」再次胜出。

**3.** 用 thiserror 定义一个库的错误枚举（三种变体：Io/Parse/NotFound，含字段与 #[from]），写库函数返回它；再用 anyhow 的应用调用它并加 context——体验「库与应用」两层的完整链路。

> [!TIP]
> 思路错误链的最终形态：库的精确类型 → anyhow 的 context 包装 → 顶层打印完整链。每一层的责任（库=可分类、应用=可诊断）在链上各就各位。

**4.** 组合子练习：`parse` 一个可能失败的字符串链（trim → parse → 校验范围 → 默认值），分别用 ? + match、全组合子两种风格实现——总结两种风格适合的复杂度。

> [!TIP]
> 思路简单线性流用 ?（主路径清晰）、需要「失败降级/多分支」用组合子。混合使用是常态：? 主干 + 局部 unwrap_or。

**5.** 诊断 unwrap：在一个开源 crate（或自己代码）里 grep unwrap，对每一处分类（测试代码/不可能失败的论证处/隐患）——建立「unwrap 审计」的视角，统计「论证缺失」的比例。

> [!TIP]
> 思路unwrap 本身不是罪，「无论证的 unwrap」才是。审计的分类训练「panic 白名单」的现实判断——与[错误处理三问](../c/12-errors-robustness.md)（什么阶段/推没推/谁负责）形成呼应。

**6.** 讨论：Rust 的「错误即值」与 [python/Java 的异常]相比，得失是什么？从「可见性（签名里写着 Result）」「传播成本（? 一个字符 vs 隐式展开）」「组合性（值可以变换/收集）」「人类习惯（异常的简洁）」四个角度，并回答「为什么 Rust 不加异常」——与 [所有权默认值](04-ownership.md)的设计哲学对照。

> [!TIP]
> 思路错误即值让「错误路径」进入类型与控制流图（签名可读、组合子可变换、? 零成本）——代价是啰嗦（用 ? 与生态库补偿）。不加异常的理由与 Move 默认同源：**机制要显式、成本要可见、正确性要编译期保证**。
