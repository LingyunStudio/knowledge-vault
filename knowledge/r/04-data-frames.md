---
title: data.frame 与 tibble：表格数据的主场
order: 4
tags: data.frame, tibble, readr, merge, tidy data
summary: data.frame 的结构与 str/summary 检查、tibble 相对 data.frame 的三处现代化、readr 读入的类型探测与 na.strings、base 的 merge/order 与 tidy 数据原则、以及修改时拷贝的性能意识。
---

data.frame 是 R 的标志性结构：**列式的表格**（每列一个向量、可异型，行数对齐）——统计软件的数据集、Excel 的表、SQL 的查询结果，在 R 里都长成它。tibble 是它的现代重制版（tidyverse 系）。本篇讲结构、检查与 base 的操作面，tidyverse 的整理语法在[下一篇](05-dplyr.md)。

## 1. 结构与检查

```r
df <- data.frame(
    id   = 1:4,
    name = c("a", "b", "c", "d"),
    score = c(88, 92, 75, NA)
)

str(df)                  # ★ 结构一览：列名/类型/前几行值
head(df, 3)              # 前 3 行
summary(df)              # 每列的摘要统计（数值列分位数、因子列频数）
nrow(df); ncol(df); dim(df); names(df)
```

data.frame 的本质（[第 2 篇](02-vectors.md)的属性观）：**「列向量的 list + class 属性」**——所以它同时吃 list 的索引语法（`[[ ]]`）与表格的行/列语法。每列是独立向量（可异型：数值列、字符列共存），行数必须一致——「列对齐」是 data.frame 的不变量。

## 2. tibble：data.frame 的现代版

```r
library(tibble)
tb <- tibble(id = 1:4, name = c("a", "b", "c", "d"), score = c(88, 92, 75, NA))

tb                  # 打印只显示前 10 行与适应宽度的列 + 每列类型 —— 大表友好
```

tibble 相对 data.frame 的三处现代化：

1. **打印智能**：data.frame 在控制台里一次倒出全部行（大表刷屏）；tibble 自适应显示并带列类型标注。
2. **无部分匹配、无字符串自动转换**：`tb$sc` 不再匹配 score（data.frame 的 `$` 部分匹配是静默事故源，[第 3 篇](03-subsetting.md)）；tibble 默认不把字符串转 factor。
3. **不做行名（rownames）**：行名是 data.frame 的历史包袱（一列「隐藏的元数据」，排序/子集时易错位）——tibble 强制显式行号列。

读入侧对应 `readr::read_csv`（返回 tibble）：

```r
library(readr)
tb <- read_csv("data.csv")          # 类型探测 + 进度条 + 干净的 spec 报告
spec(tb)                            # ★ 查看它猜的列类型 —— 「猜错了」在此核对修正
problems(tb)                        # 解析问题清单（哪行哪个值没转换成功）

tb <- read_csv("data.csv",
      col_types = cols(id = col_integer(), date = col_date(format = "%Y-%m-%d")),
      na = c("", "NA", "N/A"))      # 显式类型 + 显式缺失标记
```

base 的 `read.csv` 与 readr 的取舍：read.csv 返回 data.frame 且 stringsAsFactors 在 R4 后默认 FALSE（历史行为已修正）；read_csv 更快（C 实现）、类型探测可审计、返回 tibble。**脚本里推荐 readr（类型显式化），一次性交互用谁都快**。

## 3. base 的操作面：合并、排序、变换

```r
# 合并（SQL 风格 join 的 base 版）
merge(a, b, by = "id")                  # 内连接
merge(a, b, by = "id", all.x = TRUE)    # 左连接

# 行列拼合
rbind(df1, df2)                         # 纵向追加（列须一致）
cbind(df1, extra_col)                   # 横向拼接（行须对齐）

# 排序
df[order(df$score, decreasing = TRUE), ]        # 按列排序（order 返回下标）
df[order(df$grp, -df$score), ]                  # 多级排序（负号 = 降序）

# 变换与筛选（base 风格）
subset(df, score > 80, select = c(id, name))    # 条件 + 选列
transform(df, ratio = score / 100)              # 新增列
```

这些 base 操作全部可用，但 dplyr 的语法（[第 5 篇](05-dplyr.md)）在可读性与组合性上全面胜出——base 版本的价值在于**读别人的老代码**与**理解 tidyverse 替代了什么**。

## 4. tidy data：表格数据的形状原则

tidy 数据（Wickham 的定义）三条：**每个变量一列、每个观测一行、每种观测单元一张表**。反面教材：

```r
# 不 tidy：年份摊成了列（变量变成了列头）
#   name   2023   2024
#   a      10     12
# tidy 版（用 pivot_longer 融化）：
#   name   year   value
#   a      2023   10
#   a      2024   12

library(tidyr)
long  <- pivot_longer(wide, cols = `2023`:`2024`, names_to = "year", values_to = "value")
wide2 <- pivot_wider(long, names_from = year, values_from = value)   # 反向（透视表）
```

tidy 数据的直接收益：**dplyr 的每个动词、ggplot2 的每个映射都假设 tidy 形状**——数据「融化/透视」成 tidy 后，后续所有工具零适配。tidyr 的 pivot_longer/pivot_wider 就是 Excel 透视图的逆向工程。

## 5. 修改时拷贝：data.frame 的性能现实

```r
df$x[1] <- 999          # ⚠️ 修改 df 的列：R 的写时复制（copy-on-modify）可能拷贝整列
```

R 的对象赋值是引用计数 + 写时复制（R 3.1+ 对列的修改优化了很多，仍存在）：循环里逐行修改 data.frame 是经典性能陷阱（与 [MATLAB 动态增长](../matlab/09-vectorization.md)同族）。对策：**向量化整列运算**（R 的常态本来就是）、批量修改用 dplyr::mutate（内部做了优化）、真需要高频修改用 data.table 包（引用语义）。

## 6. 陷阱清单

- read.csv 的类型猜测静默出错（日期变字符、ID 变数字）：read_csv + spec() 审计 + col_types 显式。
- stringsAsFactors 的版本差异（R < 4.0 默认转 factor）：老代码/老教程的坑；显式声明意图。
- `$` 部分匹配取错列：tibble 或 `[["精确名"]]`。
- 行名当数据用：排序/子集后行名错位；行标识显式成列。
- 循环逐行修改 data.frame：写时复制放大开销；向量化或 data.table。
- merge 的笛卡尔积（两边 key 不唯一）：合并前检查 key 唯一性（`anyDuplicated`）。
- rbind 列顺序/类型不一致：静默对不上；列名核对。

## 7. 小结

- data.frame = 列向量的 list + class 属性；str/head/summary 是三连体检；tibble 的现代化（打印、无部分匹配、无行名）是 tidyverse 时代的默认。
- readr 的价值：类型探测可审计（spec/problems）+ 显式 col_types；「猜类型」必须核对而不是信任。
- base 操作（merge/rbind/order/subset）能读懂、tidyverse 能写好；order 返回下标是 base 排序的心智。
- tidy data 三原则是 dplyr/ggplot 的隐含假设：pivot_longer/wider 是形状的两种翻译。
- 写时复制的性能现实：列级向量化是 R 的常态、逐行循环是反模式。

## 8. 练习

**1.** 对一份自带脏数据的小 CSV（混合日期格式、千分位数字、多种缺失标记）分别用 read.csv 与 read_csv 读入，`str` 对比类型猜测；用 spec/problems 审计 read_csv 的决策并修正。

> [!TIP]
> 思路脏数据的三个经典现场：日期被读成 character、数字因千分位逗号变 character、"N/A" 没被识别为缺失。col_types + na 参数是修正的落点。

**2.** 把一份「宽表」（年份为列）用 pivot_longer 变长、做一次 group 汇总、再 pivot_wider 变回宽表——验证 round-trip 无损，总结长宽两种形状各自适合的操作。

> [!TIP]
> 思路长表适合汇总/建模/画图（ggplot 偏爱），宽表适合人读与展示。round-trip 的验证点：行列顺序与缺失格子的处理。

**3.** 用 base 与 dplyr 各写一遍「筛选 + 排序 + 新增列」三连，对比行数与可读性；故意在 base 版打错一个列名、在 tibble 版用 `$` 访问不存在的列——观察两种错误暴露方式。

> [!TIP]
> 思路base 的 `$` 部分匹配可能静默成功（错列真取到了）；tibble 立刻报错。错误早暴露 = 调试成本低——这是 tibble「不宽容」的价值论证。

**4.** 检查一份表的主键唯一性（anyDuplicated / group_by+count>1），然后做左连接；再故意用不唯一的 key 连接，观察行数膨胀——把「连接前的键检查」写成习惯函数。

> [!TIP]
> 思路`check_key <- function(df, key) { stopifnot(anyDuplicated(df[[key]]) == 0) }`。join 的行数膨胀是最难事后发现的静默错误——前置检查三行代码换后置半天调试。

**5.** 实验「逐行修改 data.frame」的性能：1e5 行的表，逐行 `df[i, "x"] <- ...` 与向量化 `df$x <- ...`，system.time 对比并解释写时复制的放大机制。

> [!TIP]
> 思路逐行版每次 `[i, ]` 取行都触发拷贝——O(n²)。与 [MATLAB 练习](../matlab/09-vectorization.md)的动态增长实验互为镜像：向量化不是风格是架构。

**6.** 讨论：为什么 tibble 要「移除」data.frame 的部分匹配与行名？从「静默错误的延迟成本」角度（对照 [C 篇](../c/01-c-model.md)的 UB、[R 第 2 篇](02-vectors.md)的 recycling 警告）分析 API 设计中「不宽容」的价值。

> [!TIP]
> 思路部分匹配的错误在「列名重命名后」才爆发——延迟 N 天；行名的错位在「排序后」——更隐蔽。tibble 的不宽容把错误从「静默的数据错」升级为「立刻的显式报错」——错误处理设计的通用定律：越早、越响，越好。
