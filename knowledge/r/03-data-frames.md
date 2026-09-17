---
title: 数据框与读取
order: 3
tags: 核心, data.frame
summary: data.frame 与 tibble、read.csv/readr 导入、str/summary 第一眼。
---

数据框是 R 的核心数据结构：一列一个变量，一行一个观测，本质是「长度相等的一堆向量组成的 list」。分析工作八成时间在和它打交道，而导入数据和第一眼检查，是每个项目的固定开场。

## data.frame：等长向量的 list

```r
df <- data.frame(
  name  = c("李雷", "韩梅梅", "张伟"),
  score = c(90, 85, NA),
  group = c("A", "B", "A")
)
class(df)           # "data.frame"
nrow(df); ncol(df)  # 3 3
names(df)           # "name"  "score" "group"，列名就是 list 的元素名
df$score            # 90 85 NA，取一列得到原子向量
```

因为底层是 list，`df[["score"]]` 等价于 `df$score`；而 `df["score"]` 返回的是只有一列的数据框——`[` 与 `[[` 的规则原样适用。

> [!NOTE]
> R 4.0（2020 年）之前，`data.frame()` 默认把字符串列转成因子（`stringsAsFactors = TRUE`），无数老教程因此行为怪异。现在默认不转了——如果教程里显式写着 `stringsAsFactors = FALSE`，说明它写于 2020 年之前，其余代码也可能过时。

## tibble：现代版数据框

tidyverse 用 tibble 替代原生 data.frame，行为更克制：

```r
library(tidyverse)
tb <- tibble(name = c("李雷", "韩梅梅"), score = c(90, 85))
as_tibble(df)       # data.frame 转 tibble
```

| 行为 | data.frame | tibble |
| --- | --- | --- |
| 打印 | 全部行刷屏 | 前 10 行 + 列类型缩写 |
| `df[, "score"]` | 退化成向量 | 仍返回 tibble |
| `df$sco` 部分匹配 | 静默命中 `score` | 报错 |
| 行名 rownames | 支持 | 不支持 |

打印差异最实用：tibble 的列头自带 `<chr>` `<dbl>` 等类型标注，等于顺手完成了小半次 `str()`。`[, j]` 不退化意味着写自动化脚本时，类型不会在某一步悄悄从数据框变成向量。

## 导入数据

base R 和 readr 各有一套 reader，返回类型不同：

```r
df1 <- read.csv("data/raw.csv")         # base，返回 data.frame
df2 <- readr::read_csv("data/raw.csv")  # readr，返回 tibble
```

| | read.csv | readr::read_csv |
| --- | --- | --- |
| 返回类型 | data.frame | tibble |
| 字符串转因子 | 参数可开启 | 永不 |
| 类型推断 | 看全部数据 | 只看前 1000 行（guess_max 可调） |
| 速度 | 慢 | 快（底层是 Rust 实现） |
| 解析问题反馈 | 静默 | 汇总成 warning 列出 |

read_csv 只用前 1000 行猜类型，后面藏着更「复杂」的值会解析失败——导入完务必看它的 warning。其他格式：Excel 用 `readxl::read_excel()`，SPSS/Stata/SAS 用 `haven`，数据库走 `DBI`。

导出同理，`row.names` 是 base 版的经典坑：

```r
write.csv(df, "output/clean.csv", row.names = FALSE)  # ❌ 不加 row.names = FALSE 会多一列行号
readr::write_csv(df, "output/clean.csv")              # ✅ 永不写行名，默认 UTF-8
```

> [!TIP]
> 中文 Windows 上 Excel 另存的 csv 常是 GBK 编码，直接读会乱码：base 用 `read.csv("x.csv", fileEncoding = "GBK")`，readr 用 `read_csv("x.csv", locale = locale(encoding = "GBK"))`。

原始数据永远保持只读。需要「修数据」时把修正逻辑写进代码，而不是手工编辑文件——这是第 10 篇可重复报告能成立的前提。

## 第一眼：str、summary、glimpse

拿到数据先花三分钟，再谈分析：

```r
head(df, 5)      # 前几行长什么样
str(df)          # 每列的类型 + 前几个值
summary(df)      # 数值列给五数与均值
glimpse(df)      # dplyr 版 str，转置显示，列多时更好用
```

重点看三样：

- **类型对不对**：分数被读成字符串，多半是列里有脏值
- **缺失在哪**：`colSums(is.na(df))` 逐列数一遍
- **范围离不离谱**：年龄出现 999，多半是「缺失」被编码成了数字

## 取列的姿势与 drop

```r
df$score                     # 向量
df[["score"]]                # 向量，列名存在变量里时只能用它
df[, "score"]                # ⚠️ 退化成向量！
df[, "score", drop = FALSE]  # 保持数据框
```

`df[, j]` 取单列时会「简化」成向量，这是 base R 的历史设计。列名存在变量里写通用代码时，建议明确用 `drop = FALSE`，否则列数变化时返回类型会悄悄改变：

```r
col <- "score"
df[[col]]                    # ✅ 稳定返回向量
df[, col, drop = FALSE]      # ✅ 稳定返回数据框
```

> [!WARNING]
> `df$sc` 这种部分匹配是交互时手滑的「福利」，写进脚本就是隐患：列改名后它静默命中别的列或返回 NULL。tibble 直接禁用了它——`tb$sc` 报错 `Unknown or uninitialised column`，把问题暴露在第一时间。

## 练习

- [ ] 同一个 csv 分别用 `read.csv` 和 `readr::read_csv` 读取，用 `class()` 对比返回类型
- [ ] 造一个含 NA 的数据框，用 `colSums(is.na(df))` 找出缺失最多的列
- [ ] 验证 `df[, 2]` 与 `df[, 2, drop = FALSE]` 的 `class()` 差异

相关阅读：[dplyr 数据处理](04-dplyr.md)
