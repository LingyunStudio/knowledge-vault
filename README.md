# Knowledge Vault · 知识库

一个用 **Rust + egui** 编写的本地知识库桌面应用。知识以 Markdown 文件的形式按板块存放，应用提供排版精美的阅读界面——语法高亮、GFM callout、表格、页内目录、全文搜索一应俱全。

## 功能特性

- **板块化内容管理**：`knowledge/` 下每个子目录一个板块（C、Python、Git、MATLAB、Rust、AI），里面每个 `.md` 文件就是一篇文章
- **自动重载**：编辑或增删 Markdown 文件后界面自动刷新（约 1 秒内），无需重启，也可按 `F5` 手动刷新
- **自定义 Markdown 渲染器**（非简单的通用渲染）：
  - 代码块语法高亮（syntect）+ 行号 + 一键复制
  - GFM 风格 callout（`> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]`）
  - 表格（表头强调、斑马纹）、任务列表、脚注
  - 文内互链（`[文字](05-borrowing.md)` 直接跳转文章）与外部链接
  - 中西文混排优化：软换行在中文字符间不插入空格
- **阅读体验**：固定内容列宽、1.6 倍行高、页内目录（TOC）滚动跟踪、正文缩放（A− / A+）、深浅两套主题
- **全局搜索**：`Ctrl+K` 聚焦，按标题与正文匹配，结果带高亮片段
- **零依赖运行**：中文字体自动使用系统微软雅黑，无需额外安装

## 快速开始

```bash
cargo run            # 开发模式
cargo build --release
./target/release/knowledge_vault.exe
```

要求：Rust 1.85+（edition 2024）。

## 目录结构

```text
knowledge/               ← 知识内容根目录
├── c/                   ← C 板块：一个 .md 文件 = 一篇文章
├── python/
├── git/
├── matlab/
├── rust/                ← 当前已有 13 篇 Rust 篇章
└── ai/

src/
├── main.rs              ← 入口
├── app.rs               ← 应用壳：路由/侧栏/首页/板块页/阅读页/搜索
├── content.rs           ← 内容层：目录扫描、front matter、自动重载指纹
├── markdown.rs          ← pulldown-cmark 事件流 → 自定义文档 AST
├── render.rs            ← AST → egui 绘制（排版/代码块/表格/callout/链接）
├── highlight.rs         ← syntect 高亮封装
└── theme.rs             ← 配色、系统字体加载、egui 样式
```

## 如何添加内容

### 新增文章

在对应板块目录下新建 `.md` 文件即可，文件头部支持简易 front matter：

```markdown
---
title: 所有权系统
order: 4
tags: 核心, 所有权
summary: 一句话简介，显示在列表与搜索结果里。
---

正文使用标准 Markdown……
```

| 字段 | 说明 | 默认 |
| --- | --- | --- |
| `title` | 文章标题 | 文件名（去扩展名） |
| `order` | 排序权重，小的在前 | 999 |
| `tags` | 逗号分隔的标签 | 空 |
| `summary` | 摘要 | 空 |

以 `_` 开头的文件（如 `_draft.md`）会被忽略，可当草稿。

### 新增板块

在 `knowledge/` 下新建目录即可。已知六个板块有专属配色与简介；其他目录会以通用样式出现在侧栏与首页。

### 支持的语法

标准 Markdown 之外，额外支持：

````markdown
> [!NOTE]
> 提示callout（另有 TIP / IMPORTANT / WARNING / CAUTION）

- [x] 任务列表

| 表格 | 支持 |
| --- | --- |

`行内代码`、**粗体**、*斜体*、~~删除线~~、[文内链接](04-ownership.md)、[外部链接](https://rust-lang.org)

![图片说明](图片路径.png)   ← 支持相对路径与网络图片
````

## 技术栈

| 组件 | 选型 |
| --- | --- |
| GUI | `eframe` / `egui` 0.36（glow 后端） |
| Markdown 解析 | `pulldown-cmark` 0.13 |
| 语法高亮 | `syntect` 5（fancy-regex 纯 Rust 后端） |
| 图片加载 | `egui_extras`（image feature） |
| 字体 | Segoe UI + 微软雅黑 + Consolas（运行时加载系统字体） |

## Roadmap

- [ ] C / Python / Git / MATLAB / AI 板块内容
- [ ] 文章收藏与阅读进度记忆
- [ ] 导出（PDF / HTML）
- [ ] 双栏对照模式

## License

内容与代码仅供个人学习使用。
