---
title: 项目与报告：可复现的分析工程
order: 11
tags: RStudio Project, renv, R Markdown, Quarto, testthat
summary: Project 与 here 的路径锚定、renv 的包环境锁定、R Markdown/Quarto 的可复现报告管线、testthat 的分析测试、R 包开发一瞥，以及「分析即软件工程」的完整清单。
---

数据分析的可信度有一半来自**可复现性**：半年后、换台机器、换个人，同一份代码能否跑出同样的结果？R 的答案是一套工程组件——**Project 锚定路径、renv 锁定包、seed 锁定随机、R Markdown/Quarto 织合叙述与代码**。本篇把它们组装成「分析即软件工程」的完整形态。

## 1. Project：路径的锚点

```text
my-analysis/                 ← .Rproj 文件所在 = 项目根
├── my-analysis.Rproj
├── data/                    ← 原始数据（只读！）
│   ├── raw/  └── processed/
├── R/                       ← 函数与脚本（[第 7 篇](07-functions.md)的四层）
│   ├── 01-load.R  02-clean.R  03-model.R
├── output/                  ← 产物（图/表/模型）
└── report.Rmd               ← 报告（叙述 + 代码）
```

三条纪律：

1. **每个分析一个 Project**：双击 .Rproj 打开——工作目录自动锚定到项目根，`getwd()` 永远正确。
2. **路径用 here 包**：`here("data", "raw", "file.csv")` 从项目根出发（无论脚本在哪个子目录被 source）——相对路径的 cwd 依赖（[linux 篇](../linux/02-filesystem.md)脚本教训的 R 版）就此根除。
3. **数据目录只读**：原始数据永不修改（分析脚本生成 processed 版本）——「原始不可变」是可复现的物理基础。

## 2. renv：包环境的锁

「我机器上能跑」的头号来源是**包版本漂移**：CRAN 的包每周更新，函数行为随之变化。renv 给项目一个私有库 + 锁文件：

```r
install.packages("renv")
renv::init()          # 项目初始化：创建 renv/ 与私有包库
renv::snapshot()      # ★ 记录当前用的包与版本 → renv.lock（进 git！）
renv::restore()       # 新机器：按 lock 精确还原包版本
renv::status()        # 检查 lock 与实际使用是否同步
```

```json
// renv.lock 片段：包 → 精确版本 → 来源
{ "Packages": { "dplyr": { "Version": "1.1.4", "Repository": "CRAN" }, ... } }
```

renv.lock 进版本库 = **代码与依赖同版本管理**——半年后 `restore()` 回到当时的宇宙。与 [python 的 uv lock](../python/12-quality.md)、[Node 的 package-lock](../python/08-modules-packages.md) 同一思想：**环境是可复现性的地基**。

## 3. R Markdown / Quarto：叙述与代码的织合

```markdown
---
title: "季度分析报告"
output: html_document          # 或 pdf/word
params:                        # ★ 参数化：一份报告 × 多期数据
  quarter: "Q3"
---

## 结论摘要

本季度均值 `r params$quarter` 期间上升了 `r round(delta, 1)`%。

```{r analysis, include=FALSE, message=FALSE}
library(dplyr)
df <- read_csv(here("data", "processed", paste0(params$quarter, ".csv")))
delta <- compute_delta(df)
```

### 图 `r params$quarter`

```{r plot, fig.width=6, fig.height=4, echo=FALSE}
ggplot(df, aes(x, y)) + geom_line()
```
```

`rmarkdown::render("report.Rmd", params = list(quarter = "Q4"))` 一条命令产出报告——**叙述文字、代码、结果三者绑定**：数据变了重 render，图表自动更新，代码与结论不可能脱节（手工复制粘贴图表进 Word 的时代问题）。

**Quarto** 是 R Markdown 的下一代（语言中立：R/Python/Obsidian 皆可，渲染引擎统一）——新项目建议直接 Quarto（`.qmd`），语法与 Rmd 几乎一致。

报告的工程纪律：

- **chunk 缓存**（`cache=TRUE`）加速重渲染，但改了数据必须清缓存——缓存与正确性的权衡要显式。
- **echo/include 的取舍**：给业务看的报告 `echo=FALSE`，给同行的审计文档 `echo=TRUE`。
- **params 参数化**：月报/分组报告是「一个模板 × N 组参数」，不是 N 份代码。

## 4. testthat：分析代码的测试

```r
library(testthat)

test_that("compute_delta 处理缺失列", {
    df_bad <- tibble(x = c(1, NA))
    expect_error(compute_delta(df_bad), "missing")       # 抛出即契约
})

test_that("计算结果与手算一致", {
    df <- tibble(cur = c(110, 90), prev = c(100, 100))
    expect_equal(compute_delta(df), 0, tolerance = 1e-12)   # 浮点容差断言
})
```

测试的对象是**函数层的业务逻辑**（清洗规则、计算函数）——不测绘图/模型收敛本身。统计代码的特有测试形态：**已知答案的模拟数据**（[第 8 篇练习 4](08-stats.md)的模拟检验、黄金数据集快照）——「用一个算过的结果钉住回归」。CI 里 `Rscript -e 'testthat::test_local()'` 与 [python 篇](../python/12-quality.md)的流水线同构。

## 5. R 包开发一瞥：函数的最终归宿

当函数集稳定复用，把它做成包（usethis 半自动化）：

```r
usethis::create_package("mytools")
usethis::use_r("clean_names")           # R/clean_names.R：函数 + roxygen 注释
usethis::use_test("clean_names")        # tests/testthat 自动建测试骨架
devtools::document(); devtools::check() # 文档生成 + 全包体检（R CMD check）
```

包结构的纪律是**文档与代码同文件**（roxygen 注释生成 man 页）+ **测试与函数一一对应** + **DESCRIPTION 声明依赖版本**——renv 锁的是分析环境，包的 DESCRIPTION 锁的是它的依赖面。「自己的常用函数升格为内部包」是团队 R 工程的成熟标志。

## 6. 可复现性清单

| 组件         | 保障什么         | 工具                          |
| ------------ | ---------------- | ----------------------------- |
| 目录锚定     | 路径可迁移       | Project + here                 |
| 包环境       | 依赖版本         | renv.lock                      |
| 随机性       | 结果可复现       | set.seed 进代码                 |
| 数据不可变   | 输入一致性       | data/raw 只读 + 处理产物分目录  |
| 叙述-代码织合 | 结论与代码不脱节 | Rmd/Quarto + render             |
| 逻辑正确性   | 函数行为         | testthat + CI                   |
| 计算环境     | 系统级一致       | Docker（[docker 篇](../docker/01-why-containers.md)）|

清单的哲学：**把「分析」当作软件发布**——发布物（报告/模型）的可信度取决于构建过程（代码/环境/数据）的工程化程度。

## 7. 陷阱清单

- 绝对路径或 setwd 进代码：换机器/换人即断；here + Project。
- renv.lock 不进 git 或忘记 snapshot：环境漂移照旧；status 纳入日常。
- Rmd 缓存导致「改了数据图没变」：cache 的失效管理；交付前无缓存重跑一遍。
- seed 只设一次而脚本多次重跑中途改代码：随机流错位——分析起点统一 seed + 分阶段独立 seed。
- 原始数据被分析脚本「顺手」修改：raw 只读权限（[linux 篇](../linux/04-permissions.md)）+ 目录纪律。
- 报告手工粘贴图表进 Word：结论与代码脱节；render 参数化。
- 测试只测「不报错」：断言具体数值/形状（expect_equal 的容差）才有回归价值。

## 8. 小结

- 可复现性的四支柱：Project+here 锚路径、renv 锁包、seed 锁随机、raw 数据只读——「环境与输入的版本管理」先于任何统计方法。
- R Markdown/Quarto 织合叙述与代码：params 参数化一份模板多期报告、render 一键重建、结论不可能与代码脱节。
- testthat 测函数层逻辑，统计代码的特殊测试是「模拟已知答案」与「黄金快照」；CI 接管回归。
- usethis/devtools 把稳定函数集升格为内部包：roxygen 文档、测试骨架、依赖声明一体的工程终态。
- 「分析即软件工程」的元教训：分析报告是发布物，发布物的可信度由构建系统决定——这与 [C 篇三配置](../c/10-header-linking.md)、[python CI](../python/12-quality.md) 的哲学完全同源。

## 9. 练习

**1.** 把一份现有分析改造成 Project + here + renv：建目录、初始化 renv、snapshot、脚本里所有路径换 here()——在另一台机器（或虚拟机）验证 restore + 全链跑通。

> [!TIP]
> 思路迁移验证的清单：renv::restore 成功、here 路径全对、seed 下结果一致。三关全过才算「可复现」——这是分析项目的交付定义。

**2.** 把一份「月报 Word」改造成参数化 Rmd：数据文件、标题、结论文字全部来自 params 与行内计算；render 三份不同参数的报告对比。

> [!TIP]
> 思路改造的难点是「把叙述里的硬编码数字换成行内表达式」——倒逼你把「结论的推导」写进代码。参数化的月报让每月工作量从半天降到一条命令。

**3.** 为你的 compute 函数写 testthat 套件：正常路径、缺失列报错、边界值（全 NA/单行）、黄金快照（已知输出钉住）——接入一次本地 test_local()。

> [!TIP]
> 思路黄金快照的生成要人工审核一次再钉死——它从此是回归的锚。统计函数的测试预算：正常/边界/缺失三类占 80%，价值足够。

**4.** 在 Quarto 报告里做一个「缓存陷阱实验」：cache=TRUE 的 chunk 改上游数据后观察图不更新，再学会 purge/重跑的正确姿势——写下你团队的缓存使用规约。

> [!TIP]
> 思路规约要点：只缓存昂贵的读入与重计算、开发期禁缓存、交付前全量无缓存重渲染。「缓存的正确性 > 缓存的速度」——与[构建系统](../c/10-header-linking.md)的依赖追踪同款哲学。

**5.** 用 usethis 把三个常用函数做成内部包：roxygen 文档、测试、LICENSE、DESCRIPTION 依赖——devtools::check 全绿后本地安装使用。

> [!TIP]
> 思路check 的报错是「包的真实门槛」（文档缺失/未用导入/示例失败）——全绿一次后，「函数复用」从复制粘贴升级为版本化安装。

**6.** 讨论：数据分析项目的「可复现」与「可复用」是两个目标（前者锁环境、后者抽象函数）。你的项目如何同时满足两者？从「renv 锁什么、包抽象什么、报告交付什么」三层给出你的架构答案。

> [!TIP]
> 思路答案的形状：renv 锁「本次分析的宇宙」、内部包沉淀「跨项目稳定的工具」、报告只引用包函数与数据产物。三层的版本策略不同（lock 严格/包语义化/报告归档）——分层是矛盾的唯一解。
