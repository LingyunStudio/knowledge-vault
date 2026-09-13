---
title: 环境搭建与 Cargo 入门
order: 1
tags: 工具链, cargo, 入门
summary: 安装 Rust、理解 Cargo 的项目结构、依赖管理与常用命令，跑出第一个程序。
---

Rust 是一门**编译型、多范式**的系统编程语言，核心卖点是三件事：**内存安全**、**无畏并发**、**零成本抽象**。它没有垃圾回收器，却能在编译期杜绝悬垂指针、数据竞争等一大类内存错误——代价是你要向编译器证明代码的正确性。

> [!TIP]
> 与其死记语法，不如先把工具链玩熟。Rust 的开发体验高度绑定 Cargo，理解它比理解语法更早产生收益。

## 安装 Rust

官方推荐通过 `rustup` 安装和管理工具链。Windows 上下载 [rustup-init.exe](https://rustup.rs)，或用 winget：

```bash
winget install Rustlang.Rustup
# 或者直接下载后运行
rustup-init
```

安装完成后，验证环境：

```bash
rustc --version   # 编译器版本
cargo --version   # 构建工具版本
rustup update     # 更新工具链
```

rustup 管理三个组件：

| 组件 | 作用 |
| --- | --- |
| `rustc` | 编译器本体，一般不直接调用 |
| `cargo` | 构建、依赖、测试、文档的一体化工具 |
| `rustup` | 工具链版本管理器，切换 stable / nightly |

## 第一个项目

```bash
cargo new hello-rust
cd hello-rust
cargo run
```

`cargo new` 生成的目录结构非常克制：

```text
hello-rust/
├── Cargo.toml      # 项目清单：元信息 + 依赖
└── src/
    └── main.rs     # 程序入口
```

`Cargo.toml` 是整个项目的心脏：

```toml
[package]
name = "hello-rust"
version = "0.1.0"
edition = "2021"

[dependencies]
```

`src/main.rs` 里已经有一个能跑的程序：

```rust
fn main() {
    println!("Hello, world!");
}
```

> [!NOTE]
> `println!` 结尾的 `!` 表示它是一个**宏**而不是函数。Rust 的宏可以接受任意数量的参数并在编译期展开，格式化输出就是最典型的应用。

## Cargo 常用命令

日常开发 90% 的时间只需要这几条：

```bash
cargo run          # 编译并运行
cargo build        # 编译（调试模式，产物在 target/debug/）
cargo build --release   # 优化编译（产物在 target/release/，快得多）
cargo check        # 只做类型检查，不生成二进制，速度最快
cargo test         # 运行测试
cargo doc --open   # 生成并打开文档
cargo fmt          # 代码格式化
cargo clippy       # 静态检查，能发现大量坏味道
```

> [!IMPORTANT]
> 写代码时保持 `cargo check` 常开（编辑器插件会自动做）。它比 `cargo build` 快一个量级，反馈循环越短越好。

## 依赖管理

Rust 的包叫 **crate**，集中托管在 [crates.io](https://crates.io)。添加依赖只需编辑 `Cargo.toml`：

```toml
[dependencies]
rand = "0.8"          # 语义化版本：兼容 0.8.x 的最新版
serde = { version = "1.0", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
```

然后直接 `cargo run`，Cargo 会自动下载、编译并锁定版本到 `Cargo.lock`。

- `Cargo.toml`：声明**意图**——我要什么范围版本的依赖
- `Cargo.lock`：记录**事实**——实际解析出的精确版本，应提交到版本库

## Edition：语言的"版本号"

Rust 用 **edition** 来引入不破坏旧代码的大版本变更。2015 / 2018 / 2021 / 2024 各版共存，同一个编译器可以编译任意 edition 的代码，区别只在默认开启的语言特性。新项目用最新 edition 即可。

## 快速试错：Rust Playground

不想装环境？打开 [play.rust-lang.org](https://play.rust-lang.org) 就能在浏览器里写 Rust、跑测试、生成汇编，还支持分享链接——提问求助时贴 Playground 链接是社区惯例。

## 下一步

环境就绪后，按顺序过一遍语言基础：

- [变量与数据类型](02-variables-types.md)
- [控制流与函数](03-control-flow.md)
- 然后进入 Rust 的灵魂：[所有权系统](04-ownership.md)
