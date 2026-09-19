---
title: 索引与子集：取数的完整语法
order: 3
tags: 索引, 逻辑索引, which, drop, apply
summary: 向量/矩阵/data.frame/list 的完整索引语法（正负整数、逻辑、名字、[[ ]]与[ ]）、which/match/%in% 的定位工具、索引赋值与 NA 下标的行为、apply 家族的向量化取数，以及 drop 参数的细节。
---

R 的取数语法密度极高——同一个 `[ ]` 在向量、矩阵、data.frame、list 上有四套行为。本篇把索引语法系统化：**五种下标类型 × 四种容器 × 单双括号**，再配三个定位工具（which/match/%in%）。

## 1. 向量索引：五种下标

```r
x <- c(10, 20, 30, 40)
names(x) <- c("a", "b", "c", "d")

x[2]              # 20  —— 正整数下标（1-based）
x[-1]             # 20 30 40 —— 负整数：排除（remove）而不是「倒数」！
x[x > 25]         # 30 40 —— 逻辑下标（过滤的标准姿势）
x["c"]            # 30 —— 名字下标
x[c(1, 1, 4)]     # 10 10 40 —— 可重复（采样/重排的基础）
x[0]              # numeric(0) —— 0 下标返回空向量（哨兵用法）

x[c(TRUE, FALSE, TRUE, FALSE)]   # 10 30 —— 逻辑长度不足时 recycling（[第 2 篇](02-vectors.md)）
```

**负索引是「排除」**——与 Python 的「-1 是最后一个」方向相反，这是 R/Python 互译的又一颗雷（[python 篇](../python/03-control-flow.md)）。想要「倒数第一个」用 `x[length(x)]` 或 `tail(x, 1)`。

混合正负（`x[c(-1, 2)]`）直接报错——语义矛盾。零下标合法（返回零长度向量），用于「占位构造」。

## 2. 三个定位工具：which / match / %in%

```r
v <- c(5, 8, 3, 8, 1)

which(v > 4)              # 1 2 4 —— 满足条件的「下标」（不是值！）
which.max(v)              # 2 —— 最大值的位置

match(c(8, 1), v)         # 2 5 —— 第一个出现位置（查「在哪」）
c(8, 99) %in% v           # TRUE FALSE —— 批量「在不在」（逻辑向量，与 match 的区别）
```

三者的分工：**which 给位置、match 给首个位置（找不到 NA）、%in% 给存在性**。数据筛选的组合：

```r
df[df$ID %in% target_ids, ]           # 筛出目标 ID 的行（%in% 处理「目标里没有的」不报错）
df[match(target_ids, df$ID), ]        # 按目标顺序重排行（match 保序）
```

## 3. 高维容器的索引

### 3.1 矩阵：二维下标与 drop

```r
M <- matrix(1:6, nrow = 2)
M[1, 3]             # 5 —— [行, 列]
M[1, ]              # c(5, 1, 3)? —— 实际是第一行 c(1,3,5)：返回向量
M[1, , drop = FALSE]   # ★ 保留矩阵形态（1×3）—— drop 默认 TRUE 会「掉维」
M[, -2]             # 排除第 2 列
```

`drop` 是 R 索引的隐蔽细节：**取一行/一列默认降成向量**——批量处理时形态不一致的 bug 源。想要结果保持矩阵（逐列循环、cbind 回去），`drop = FALSE` 必写。

### 3.2 data.frame 与 list

```r
df$col              # 向量（内容）
df[["col"]]         # 同上
df["col"]           # 单列 data.frame（容器！）
df[1:3, c("a", "b")]    # 行列切片
df[df$b > 0 & !is.na(df$b), ]   # 条件筛选（注意 NA 行为，见下）

lst[[1]]            # 内容；lst[1:2] 子列表
```

单双括号总纲：**`[ ]` 永远返回同类容器、`[[ ]]`/`$` 解一层包装**。`df$col` 的优势是自动部分匹配（打字快）——**脚本里建议 `df[["col"]]`（精确名，拼写错误立刻暴露）**，`$` 的部分匹配在列名变化时静默取错列。

## 4. 索引赋值与 NA 的下标行为

```r
x[x < 0] <- 0                  # 条件替换（[第 2 篇](02-vectors.md)）
df$new <- df$a * 2             # $ 赋值新增列
df[df$temp > 50, "flag"] <- "hot"   # 条件新增

v[c(1, NA, 3)]                 # NA 位置的值也是 NA —— NA 下标「占位」
v[-c(1, NA)]                   # ⚠️ 含 NA 的负索引直接报错
```

索引赋值是 R 数据加工的另一半：**条件替换、按位置改、新增列**——与索引读取共享同一套下标语法。

## 5. apply 家族：函数式的批量取数

```r
M <- matrix(rnorm(100), 10)

apply(M, 1, mean)        # 按行应用（1 = 行）；2 = 列
apply(M, 2, function(col) col[col > 0])   # 返回 list（各行结果长度可不同）

lapply(list(1:3, c("a","b")), length)     # list 逐元素 → 返回 list
sapply(list(1:3, 4:6), mean)              # 同上但尝试简化成向量/矩阵
vapply(lst, mean, numeric(1))             # ★ 声明返回类型（安全：类型不符即报错）

tapply(grade, class, mean)                # 分组应用（按因子分组求均值）
mapply(function(a, b) a + b, 1:3, 10:12)  # 多参数并行应用
```

apply 家族的现代替代是 **purrr::map**（tidyverse，类型一致性更好：`map_dbl/map_int/map_chr` 强制声明输出类型）。纪律：**sapply 的「自动简化」是隐患**（结果形态随数据变化）——交互探索用 sapply、代码用 vapply 或 map 系。

这些工具与 [MATLAB 的 arrayfun](../matlab/09-vectorization.md)、[Python 的列表推导](../python/06-iterators-generators.md)是同一思想的三种拼写：**对集合逐元素应用函数，返回集合**。

## 6. 陷阱清单

- 负索引当「倒数」用：R 的负号是排除；倒数用 length/tail。
- `[1, ]` 掉维：需要保形加 `drop = FALSE`；列循环收集时形态错乱。
- `$` 部分匹配静默取错列：脚本用 `[["精确名"]]`。
- `df[df$x > 0, ]` 遇 NA 行为不定（NA 行保留为 NA 行）：先 `!is.na()` 或用 dplyr::filter（NA 自动排除）。
- sapply 的输出形态随输入变化：生产代码 vapply/map_dbl 声明类型。
- `which` 的结果直接当逻辑用（`df[which(df$x>0), ]` 冗余且丢 NA 语义）：直接用逻辑向量。
- 索引越界返回 NA 而不报错：长度校验进防御（`stopifnot`）。

## 7. 小结

- 向量五下标（正/负/逻辑/名/零）+ 索引赋值构成取数与改数的对称语法；负号是排除，逻辑下标是过滤的正道。
- 定位三件套：which（位置）、match（首现位置、保序重排）、%in%（存在性批量）。
- 容器语法：矩阵 `[r, c]` 与 drop、df 的 `$`/`[[ ]]`/`[ ]` 三态、list 的容器/内容二分——单双括号总纲贯穿。
- apply 家族与 purrr 是「批量应用函数」的 R 形态：交互用 sapply、代码用 vapply/map_dbl 声明类型。
- 索引的宽容（越界 NA、部分匹配）是交互便利与脚本隐患的同一枚硬币——生产代码用显式与断言补墙。

## 8. 练习

**1.** 用五种下标各取一次向量中的元素/子集，预测输出后验证；重点验证负索引与 0 下标的返回。

> [!TIP]
> 思路`x[-length(x)]` 取「去掉最后一个」——负索引的正确倒数姿势。0 下标返回同类型空向量：`numeric(0)`，可用 `c(x[0], 新值)` 做类型占位构造。

**2.** 实现三种「按目标 ID 列表筛行」：`%in%`、match 重排、merge——对比三者在「目标 ID 有缺失/有重复/顺序敏感」时的行为差异。

> [!TIP]
> 思路%in% 保数据原序（丢目标序）、match 按目标序（找不到 NA 行）、merge 类 SQL 连接（可能生成笛卡尔积）。需求决定工具——「顺序敏感的取数」用 match，「纯筛选」用 %in%。

**3.** 实验 drop 参数：对 3×4 矩阵分别执行 `M[1, ]` 与 `M[1, , drop=FALSE]`，`str()` 对比；再写一个「逐列标准化」的循环，故意不加 drop 观察错乱，修复验证。

> [!TIP]
> 思路不 drop 时第一列是向量，与第二列矩阵 rbind 形态错乱。`drop = FALSE` 是「批量矩阵处理」的隐形保镖——形态一致性 bug 的最常见修复点。

**4.** 用 tapply 实现「按组求均值」，再用 dplyr 的 group_by+summarise 重写——对比两版代码的可读性与结果对象类型（矩阵 vs table）。

> [!TIP]
> 思路tapply 返回 array（levels 组合），dplyr 返回 tibble（可直接续管道）。base R 与 tidyverse 是「两套方言」——现代代码建议一套为主，读懂另一套。

**5.** 把一段「for 循环 + 结果 append 到 list」的代码改写为 lapply/purrr::map，用 str 对比两种返回结构；再改需求为「每个元素返回两个值」，体验 map 的 list 输出 + purrr::transpose 的整理。

> [!TIP]
> 思路map 的思维转变：「先造容器再填」变成「声明转换，容器由框架给」。返回多值时 map 给 list-of-list——transpose 转 list-of-field（列式），是 purrr 的标志性操作。

**6.** 讨论：R 索引的「宽容」（越界 NA、部分匹配、recycling）与 [C 篇](../c/01-c-model.md)的 UB、[Python 篇](../python/03-control-flow.md)的假值表相比，各自选择了什么权衡？「交互探索语言」需要什么样的错误行为？

> [!TIP]
> 思路R 的宽容服务于「快速探索不中断」；代价是错误延迟暴露。对照 C 的「全权交给程序员」与 Python 的「显式报错」，三种策略对应三种使用场景（统计交互/系统编程/通用工程）——错误行为的设计即目标用户的画像。
