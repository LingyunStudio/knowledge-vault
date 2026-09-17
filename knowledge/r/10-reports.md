---
title: 可重复报告
order: 10
tags: 进阶, rmarkdown, quarto
summary: R Markdown/Quarto：代码+文字+图表一键成稿，可复现研究的习惯。
---

分析结果的生命周期通常比当天的记忆更长。把代码、说明、图表写进同一个文档，一键从原始数据生成整份报告——这是 R 生态对「可重复研究」的直接回答，工具是 R Markdown 及其继任者 Quarto。

## 一个文档 = 文字 + 代码 + 输出

Markdown 里插代码块，渲染时代码执行、结果原地嵌入：

````markdown
---
title: 月度销售分析
format: html
---

```{r setup, include=FALSE}
library(tidyverse)
sales <- read_csv("data/sales.csv")
n_sales <- nrow(sales)
```

## 结论

本月共 `r n_sales` 笔订单，华东区占比最高。

```{r}
sales %>%
  count(region, sort = TRUE) %>%
  head(3)
```
````

渲染（knit）时发生的事：**启动一个全新的干净 R 会话**，从上到下依次执行所有代码块，代码与输出一起写进成品（HTML / PDF / Word）。这意味着文档里的每个数字都来自文档里的代码——没有手工复制粘贴的容身之处。

> [!WARNING]
> 「从头到尾能跑通」是文档有效的前提。你随手在 Console 里跑过的赋值、装过的包，knit 的干净会话里统统不存在。本地能看、一渲染就报错的文档，几乎总是漏了某句 `library()` 或数据准备。

## 代码块选项

每个代码块用 `{r 名称, 选项}` 控制行为，setup 块通常设全局默认：

```r
knitr::opts_chunk$set(
  echo = FALSE,       # 成品里不显示代码（报告常用；教学文档改为 TRUE）
  warning = FALSE,
  message = FALSE
)
```

| 选项 | 作用 | 典型用法 |
| --- | --- | --- |
| `echo` | 是否显示代码 | 报告 FALSE，教学 TRUE |
| `eval` | 是否执行 | 展示示例代码但不跑 |
| `include` | 执行但不输出 | setup 块设为 FALSE |
| `fig.width` / `fig.height` | 图幅尺寸 | 全文档统一图幅 |
| `cache` | 缓存结果 | 耗时的计算块 |

`cache = TRUE` 慎用：它把结果缓存到磁盘，改了上游数据却没改这个代码块时，文档会安静地输出过期结果。要用就配合 `cache.extra` 之类的显式失效条件，否则宁可不用。

正文里的行内代码 `` `r n_sales` `` 在渲染时执行并把结果嵌进文字——「样本量 386」这类数字从此与代码同源，永远不会过期。图表标题在块头写 `fig.cap = "图 1：各区域销售额"`，PDF 输出时可自动编号。

## 参数化与多格式

报告要按月、按区域重复出，就把变化的部分做成参数。YAML 头声明：

```yaml
params:
  region: 华东        # 默认值
  month: "2026-08"
```

正文里用 `params$region` 引用；出不同版本时改参数重渲染：

```r
rmarkdown::render(
  "report.Rmd",
  params = list(region = "华北", month = "2026-09"),
  output_file = "report-north-0909.html"
)
```

一份模板出 N 份报告，周报自动化就是这么干的。输出格式切换只改 YAML 一行：`pdf_document`（需要 LaTeX 环境）、`word_document`（配 reference-doc 模板套样式）、默认的 `html_document`。

> [!NOTE]
> Notebook 模式下可以乱序运行代码块，但 knit 永远从上到下按顺序执行。编辑过程中随手 Knit 一次，确认文档在干净会话里仍然健康，比攒到最后集中排错省力得多。

## 从 R Markdown 到 Quarto

Quarto 是原班团队的继任产品：语法几乎相同、渲染引擎换代、不止支持 R（Python / Julia 通用）。代码块仍是三反引号加 `{r}` 的形式，选项也可以写在块首的 `#| echo: false` 里；迁移成本主要是 YAML 头字段名（`output: html_document` 变成 `format: html`）。

选择不纠结：维护旧项目用 R Markdown，新建项目优先 Quarto。渲染命令分别是 `rmarkdown::render()` 与 `quarto render`，RStudio 里都是同一个 Knit 按钮。

> [!TIP]
> 检验复现性的标准动作：Session → Restart R，然后立刻 Knit。一次通过，说明任何人在任何机器上拿到你的文档和数据都能得到同样结果。

## 可复现的习惯清单

工具只解决一半问题，另一半是纪律：

- **固定随机种子**：任何抽样、模拟、交叉验证之前 `set.seed(2026)`，写在数据准备块里
- **只用相对路径**：配合第 1 篇的 Project，脚本里绝不出现 `C:/Users/...`
- **`sessionInfo()` 放文档末尾**：自动记录 R 版本与全部包版本，是半年后排查环境问题的唯一线索
- **不保存工作空间**：Tools → Global Options → General 取消「Save workspace to .RData on exit」，每次启动都是干净会话，逼着所有状态落在代码里
- **原始数据只读**：脚本可以产出中间结果，但原始数据永远不手工编辑

> [!NOTE]
> 这些习惯的共同点是「状态只存在于代码与文件里，不存在于会话里」。做到这一条，报告、复现、交接其实是同一件事的三个名字。

## 练习

- [ ] 新建 R Markdown，写一个 `set.seed` 加 `sample()` 的代码块，反复 Knit 确认数字不变
- [ ] 把 `echo` 从 TRUE 改为 FALSE，对比成品差异
- [ ] 给文档加 `params`，用 `rmarkdown::render()` 从命令行出一份不同参数的版本
- [ ] 在文档末尾加 `sessionInfo()` 块，观察它输出了哪些环境信息

相关阅读：[环境与 RStudio](01-getting-started.md)
