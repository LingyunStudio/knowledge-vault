---
title: 错误处理
order: 9
tags: 核心, Result, thiserror
summary: panic 用于程序性错误，Result 用于可预期失败，? 让主流程保持干净。
---

Rust 把错误分成两类，用不同工具对待：

- **panic**：不可恢复，程序直接终止——索引越界、断言失败、无法继续的 bug
- **Result<T, E>**：可恢复，调用方必须处理——文件不存在、网络超时、输入不合法

## panic!：程序自己出了 bug

```rust
panic!("crash and burn");
let v = vec![1, 2, 3];
// v[99];          // 越界 → panic: index out of bounds
```

panic 会打印错误信息、展开（unwind）栈并退出。**它表达的是"这是我的 bug"**，而不是"外部环境出了问题"。库代码原则上不该 panic（除非遇到不变量被破坏），应返回 `Result` 让调用方决定。

几个场景的惯例：

| 场景 | 选择 |
| --- | --- |
| 原型、示例、脚本 | `unwrap()` 大胆用 |
| 断言逻辑前提 | `assert!` / `assert_eq!` |
| 明知有值但类型系统不知道 | `expect("说明为什么这里一定有值")` |
| 外部输入可能非法 | 一律 `Result` |

## Result 与 ?

```rust
use std::fs::File;
use std::io::{self, Read};

fn read_username(path: &str) -> Result<String, io::Error> {
    let mut s = String::new();
    File::open(path)?.read_to_string(&mut s)?;   // ? 传播错误
    Ok(s)
}
```

`?` 是错误处理的糖：`expr?` 等价于

```rust
match expr {
    Ok(v) => v,
    Err(e) => return Err(From::from(e)),   // 还会自动做错误类型转换
}
```

它只能在返回 `Result`（或 `Option`）的函数中使用。配合提前返回，主流程里几乎看不到错误处理的痕迹：

```rust
fn parse_config(path: &str) -> Result<Config, MyError> {
    let text = std::fs::read_to_string(path)?;      // IO 错误
    let toml: toml::Value = toml::from_str(&text)?; // 解析错误
    parse_toml(toml)                                // 业务错误
}
```

## 设计错误类型

### 库：thiserror 定义错误

给调用方一个**精确**的错误枚举：

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("配置文件读取失败: {0}")]
    Io(#[from] std::io::Error),

    #[error("第 {line} 行格式错误: {msg}")]
    Syntax { line: usize, msg: String },

    #[error("缺少必填字段 {0}")]
    Missing(&'static str),
}
```

`thiserror` 自动实现 `Display`、`Error`，`#[from]` 还能自动写 `From` 转换——`?` 于是可以跨错误类型传播。

### 应用：anyhow 兜底

应用层通常不在乎错误的具体分类，只要错误链完整、信息可读：

```rust
use anyhow::{Context, Result};

fn run() -> Result<()> {
    let text = std::fs::read_to_string("app.toml")
        .context("读取 app.toml 失败")?;      // 附加上下文，保留原始错误
    Ok(parse(text))
}
```

> [!TIP]
> 经验法则：**写库用 thiserror（精确枚举），写应用用 anyhow（动态错误链）**。两者不冲突，应用内也可以对核心模块定义精确错误，边界上转成 anyhow。

## 与 Option 的互转

```rust
let maybe: Option<i32> = Some(3);
let r: Result<i32, &str> = maybe.ok_or("没有值");   // Option → Result

let r2: Result<i32, std::convert::Infallible> = Ok(1);
let o: Option<i32> = r2.ok();                       // Result → Option（丢弃错误）
```

规则直觉：`Option` 表达"可能没有"，`Result` 表达"失败有原因"。函数可能失败且原因重要时，永远用 `Result`。

## 处理 Result 的常用组合子

```rust
let r: Result<i32, Error> = parse("42");

r.is_ok();  r.is_err();
r.unwrap_or(0);              // 失败给默认
r.unwrap_or_else(|e| fallback(e));
r.map(|v| v * 2)?;           // 链式变换
r.and_then(|v| check(v))?;   // 链式调用可能失败的函数

// 批量结果
let results: Vec<Result<i32, E>> = ...;
let all: Result<Vec<i32>, E> = results.into_iter().collect();  // 遇错即败
```

> [!NOTE]
> `Vec<Result<T, E>>` 可以整体 `collect()` 成 `Result<Vec<T>, E>`——任何一个失败就整体失败。这个技巧在批量 IO/解析时极常用。

## main 也能返回 Result

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let text = std::fs::read_to_string("data.txt")?;
    println!("{}", text.len());
    Ok(())
}
```

失败时自动打印 `Debug` 格式的错误并以非零码退出，适合中小型工具。

## 练习

- [ ] 把一个全用 `unwrap` 的函数改造成 `Result` + `?` 风格
- [ ] 用 thiserror 定义三级错误（IO → 解析 → 业务），并在 main 里打印错误链
- [ ] 实现批量读取目录下所有文件，用 `collect::<Result<Vec<_>, _>>()` 统一处理
