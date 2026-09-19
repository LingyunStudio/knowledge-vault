---
title: 向量与类型：NA 的语义学
order: 2
tags: 原子向量, NA, recycling, 因子, 列表
summary: 六种原子向量与强制转换的优先级、NA/NULL/NaN/Inf 四者的精确语义（缺失会传染）、recycling 循环补齐的规则与警告、factor 因子的双刃剑、list 异构容器与属性的承载机制。
---

R 的数据地基是**原子向量**（atomic vector）：同类型元素的一维序列。理解向量需要三把钥匙：**类型系统**（六种原子类型与转换规则）、**缺失语义**（NA 是 R 的灵魂概念）、**循环补齐**（recycling——R 最著名的双刃剑）。

## 1. 六种原子向量

```r
c(TRUE, FALSE)          # logical   逻辑
c(1L, 2L)               # integer   整数（L 后缀）
c(1.5, pi)              # double    双精度（数字字面量默认）
c("a", "b")             # character 字符串（双引号惯例）
c(1+2i)                 # complex   复数
raw(3)                  # raw       字节
```

类型系统两个要点：

1. **同质性**：一个原子向量只有一种类型——混入不同类型时**静默转换**到最宽容的：

```r
str(c(1, "a"))          # chr [1:2] "1" "a"  —— 数字被转成字符串！
str(c(TRUE, 1L))        # int [1:2] 1 1      —— 逻辑 → 整数

# 转换优先级：logical < integer < double < character
as.numeric("3.5")       # 3.5；as.numeric("abc") → NA + 警告
typeof(1:3)             # "integer"；typeof(c(1,2)) → "double"
```

「数字悄悄变字符串」是脏数据读取的经典 bug：一列里混进一个 `"N/A"`，整列变 character——`readr::read_csv` 的列类型探测与 `str(df)` 的检查习惯就是为此而生。

2. **标量不存在**：`x <- 5` 是 `length(x) == 1` 的 double 向量。所有函数按向量设计（[第 1 篇](01-r-model.md)）。

## 2. NA / NULL / NaN / Inf：四种「不是数」

| 值    | 含义                     | 传染行为                              |
| ----- | ------------------------ | ------------------------------------- |
| `NA`  | 缺失（数据里该有而没有）  | 传染：`NA + 1` 是 NA、`mean(c(1,NA))` 是 NA |
| `NaN` | 未定义的数值运算结果      | `0/0`、`log(-1)`                       |
| `Inf` | 无穷                     | `1/0`；`Inf - Inf` 变 NaN              |
| `NULL`| 「不存在」（空对象）      | 吸收：`c(1, NULL)` 就是 `c(1)`         |

```r
x <- c(1, NA, 3)
mean(x)                    # NA —— 缺失传染（统计正确性优先）
mean(x, na.rm = TRUE)      # 2 —— 显式忽略缺失

is.na(x)                   # FALSE TRUE FALSE —— 判缺失的标准姿势
x == NA                    # ⚠️ 全 FALSE！NA 与任何比较（含与自己）都是 NA
x[!is.na(x)]               # 过滤缺失

NULL                       # 函数「没有返回值」的形态；list 里表示「这个槽位没有」
```

`NA == NA` 返回 NA 而非 TRUE 是逻辑一致性的选择（两个未知值无法断言相等）——它制造的经典 bug 是 `x[x == NA]` 静默得到全 NA，**判缺失永远 is.na**。

NA 的类型亦有讲究：`NA` 默认是 logical NA，放进数字向量自动变 double NA；`NA_character_` 可显式指定——读表格时的 `na.strings` 参数决定哪些字符串被解读为缺失。

## 3. recycling：循环补齐的双刃剑

```r
c(1, 2, 3, 4) + c(10, 100)
# [1]  11 102  13 104   ← 短向量被「循环使用」

c(1, 2, 3) + c(10, 100, 1000, 10000)
# 警告：longer object length is not a multiple of shorter object length
# [1]  11 102 1003 10004    ← 不整除：部分循环，结果大概率不是你想要的

1:5 + 1                    # 标量即长度 1 向量 → 完美循环（这是「标量运算」的真相）
```

recycling 是「向量对齐运算」的实现机制：长度 1（标量）对任意向量完美循环（安全且常用）；**等长或倍数长度的向量间运算**（如列与列）安全；**不成倍数的长度**会警告且结果几乎必错——**警告不是可忽略的提示，是 bug 报告**。names 与 recycling 叠加还有静默错位风险：给 recycling 后的结果赋名字时属性丢失。

## 4. 因子：分类变量的编码

```r
sex <- factor(c("M", "F", "F", "M"))
sex
# [1] M F F M
# Levels: F M            ← levels：取值的全集（字母序默认）

levels(sex)               # "F" "M"
nlevels(sex)              # 2
table(sex)                # F:2 M:2 —— 频数表（因子的本命）

factor(c("low", "high"), levels = c("low", "mid", "high"))   # 显式全集（含未出现的水平）
factor(c("low", "high"), levels = c("low", "high"), ordered = TRUE)   # 有序因子
```

factor 的两个身份：

1. **统计语义**：进入模型时自动哑变量编码（[第 1 篇](01-r-model.md)公式接口的基础）——「分组变量必须是 factor」是老 R 的纪律；现代 tidyverse 倾向 string + 显式 factor()。
2. **陷阱载体**：底层是整数编码 + levels 表——`as.numeric(sex)` 得到的是**编码**（1,2）不是原值；`as.character(sex)` 才是原字符串。修改 levels、合并不同 levels 的因子、`factor()` 包 `factor()`（把字符串变 levels）是历史事故高发区。

forcats 包（tidyverse）是为「操纵 levels」而生：`fct_relevel` 重排（控制图序/基线组）、`fct_lump` 合并小类、`fct_recode` 重命名。

## 5. list：异构容器与递归结构

```r
lst <- list(num = c(1, 2, 3), name = "exp01", model = lm(mpg ~ wt, mtcars))
lst$num                   # $ 按名取（返回向量）
lst[["name"]]             # [[ ]] 按名取（同 $）
lst[[1]]                  # [[ ]] 按位置取内容
lst[1]                    # [ ] 取子列表（仍是 list！单双括号的经典差异）

length(lst)               # 3 —— list 的长度是「元素个数」不是元素内长度
```

list 是 R 的**万能容器**（每个元素可以是任何东西、任何长度）：函数的返回值打包（lm 对象内部就是 list）、JSON 解析的落点、`lapply` 的输出（`unlist`/`purrr::map` 展开）。单双括号的口诀：**`[ ]` 永远返回同类容器（切片），`[[ ]]`/`$` 解一层包装取内容**——data.frame 的两列取法（`df[1]` 是 df、`df[[1]]` 是向量）同一规则。

## 6. 属性：元数据挂在哪里

```r
x <- c(a = 1, b = 2)      # names 属性
names(x)                  # "a" "b"
attr(x, "names")

dim(x) <- c(2, 1)         # dim 属性把向量「变」成矩阵（matrix 就是带 dim 的向量！）
class(x)                  # matrix —— class 也是属性：S3 分派的挂点
```

R 的一切高级结构都是「向量 + 属性」：matrix（dim）、factor（levels + class）、data.frame（list of vectors + class）——**R 没有神秘结构，只有属性组合**。这个「窥视能力」用 `attributes(obj)`/`str(obj)` 随时可用，是理解任何陌生对象的钥匙。

## 7. 陷阱清单

- 混型向量静默转 character：脏值进列毁类型；`str()` 检查 + readr 显式 col_types。
- `x == NA` 全 NA：判缺失只 is.na；`%in%` 对 NA 的行为也别忘了想。
- recycling 不整除的警告被无视：检查长度；`stopifnot(length(a) == length(b))` 进防御。
- `as.numeric(factor)` 得到编码不是原值：先 as.character 再 as.numeric。
- `[ ]` 与 `[[ ]]` 混淆：单括号保留容器、双括号解包；list 链式访问的层级想清。
- factor 的 levels 与实际值不同步（过滤后空水平残留）：`droplevels()`；画图/建表前检查 levels。
- `c(1, NULL)` 吞 NULL：NULL 在原子向量里消失（list 里才保留槽位）。

## 8. 小结

- 六种原子向量 + 强制转换优先级（logical < int < double < character）；混型静默转换是脏数据 bug 的经典现场。
- 四种「非数」各有语义：NA 缺失（传染、is.na 判）、NaN 运算未定义、Inf 无穷、NULL 不存在（被 c 吞掉）——na.rm 是统计函数的显式缺失开关。
- recycling 支撑向量对齐运算：长度 1 与倍数长安全，不整除的警告即 bug 报告。
- factor = 整数编码 + levels：统计建模的分类语义载体；as.numeric 拿到编码、as.character 拿到原值；forcats 管理 levels。
- list 是异构万能容器：`[ ]` 切片保容器、`[[ ]]`/`$` 解包取内容；一切高级对象 = 向量 + 属性（str/attributes 可窥）。

## 9. 练习

**1.** 依次执行 `str(c(TRUE, 1, "a"))`、`c(1L, 2.5)`、`c(NA, 1)` 的输出，画出三条强制转换链；再用 `typeof()` 验证。

> [!TIP]
> 思路TRUE→1→"TRUE"（logical→double→character）；1L→2.5（integer→double）；NA→double NA。转换链的记法「越宽容越靠后」。

**2.** 构造含 NA 的向量，分别实验 `sum(x)`、`sum(x, na.rm=TRUE)`、`x[!is.na(x)]`、`x == NA`、`x %in% NA`——总结「NA 处理」的四种正确姿势与一种错误姿势。

> [!TIP]
> 思路姿势：na.rm、先过滤、`is.na` 逻辑索引、（table 里的）显式缺失参数；错误：`== NA`。`x %in% NA` 返回 TRUE 的位置——与 `== NA` 的全 NA 不同，值得记。

**3.** 解释 `1:3 + 1:5` 与 `1:3 + c(1,1,1)` 的输出差异，并用循环补齐规则推导；再验证「警告会不会随包函数静默消失」。

> [!TIP]
> 思路前者长度不成倍 → 警告 + 部分循环；后者长度 1 完美循环。警告会被某些包装函数吞掉——防御性写法是显式 `rep()` 或长度断言，不依赖警告触发。

**4.** 建一个 factor，实验：`as.numeric(f)`、`as.character(f)`、`as.numeric(as.character(f))` 三个结果；把 levels 重排后再比较——总结「因子编码 vs 显示值」的两层结构。

> [!TIP]
> 思路as.numeric 直接给编码（随 levels 重排变化），双层转换给原值。因子参与数值计算的隐雷全在这两层结构的错位上。

**5.** 用 list 打包一次回归分析的产物（数据子集、模型对象、系数向量、p 值），分别用 `[1]`、`[[1]]`、`$` 取出并 `str()` 对比返回类型——总结单双括号规则并造一个记忆口诀。

> [!TIP]
> 思路`[ ]` 「拿出一格抽屉（抽屉还在）」、`[[ ]]`「打开抽屉拿东西」——容器语义与内容语义。这条规则贯穿 list/data.frame/环境，是 R 取数语法的总纲。

**6.** 讨论：为什么 R 选择「缺失会传染」而 SQL 的 NULL 在聚合中自动忽略、Python 的 NaN 参与运算返回 NaN？从「统计正确性」的角度比较三种 NA 语义，说明 na.rm 设计的好处（显式 > 隐式）。

> [!TIP]
> 思路传染策略逼你面对「缺失怎么办」（删、填、建模）——统计推断中缺失机制本身就是研究问题（[概率篇](../prob/01-foundations.md)的 MCAR/MAR 讨论 preview）。显式 na.rm 把决策留在代码里、留痕于可复现记录中。
