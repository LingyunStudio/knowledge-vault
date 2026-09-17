---
title: 函数与向量化
order: 6
tags: 基础, 函数, apply
summary: 函数定义与返回值、用向量化替代循环、apply 家族速查。
---

R 的函数语法五分钟能学会，真正要养成的习惯有两个：重复出现三遍的逻辑就写成函数；能用向量化表达的循环就不写循环。后者不是审美洁癖——向量化把循环下沉到 C 层，快一个数量级，代码还更短。

## 函数：输入、计算、返回

```r
bmi <- function(weight_kg, height_m) {
  weight_kg / height_m^2
}

bmi(70, 1.75)                          # 22.86
bmi(height_m = 1.75, weight_kg = 70)   # 具名实参，顺序无关
```

三条规则要清楚：

- **最后一个表达式的值就是返回值**，不必写 `return()`；`return()` 只用来提前退出
- 函数体内赋值的变量是局部的；虽然能读到全局变量，但正经函数永远只依赖参数
- 没有返回语句时，函数返回最后一个表达式——把要返回的东西写在最后，读代码的人不用找

```r
safe_log <- function(x, base = exp(1)) {    # base 有默认值
  if (any(x <= 0, na.rm = TRUE)) {
    return(rep(NA_real_, length(x)))        # 提前退出：非法输入统一返回 NA
  }
  log(x) / log(base)                        # 最后一个表达式即返回值
}
```

> [!TIP]
> 抽函数的时机不必教条：同一段代码出现第三次，就抽。写法上先在交互环境把逻辑跑通，再整体包进 `function(...)`——不要一上来就对着空函数体硬写。

## 向量化：把循环交给 R

R 的算术运算符和绝大多数数学函数天生对整个向量生效：

```r
x <- c(1, 4, 9, 16)
sqrt(x)            # 1 2 3 4，不需要循环
x / sum(x)         # 整列归一化
pmax(x, 5)         # 5 5 9 16，逐元素取较大值
```

条件逻辑用 `ifelse()` 与 `dplyr::case_when()`，同样对整列生效：

```r
scores <- c(90, 55, 72, NA)
ifelse(scores >= 60, "及格", "不及格")   # NA 的位置返回 NA，传染依旧

dplyr::case_when(                # 多分支首选，从上到下匹配
  scores >= 90  ~ "优",
  scores >= 60  ~ "中",
  is.na(scores) ~ "缺考",
  TRUE          ~ "差"           # TRUE 兜底，等价 else
)
```

什么时候必须写 for：当前值依赖上一步结果（迭代、递推）时。而累积和、累积最大值这类 `cumsum()` / `cummax()` 能覆盖的需求，优先用现成函数。

```r
# 确实要写 for 时的两个规范
out <- numeric(10)          # 1. 先分配好结果空间，别在循环里 rbind/c 追加
for (i in seq_len(10)) {    # 2. 用 seq_len(n)，不用 1:n
  out[i] <- i^2
}
# 1:n 的坑：n = 0 时 1:0 是 c(1, 0)，循环会多跑一次
```

## apply 家族速查

apply 家族把「函数当参数传」，对数据的不同维度批量应用：

```r
m <- matrix(1:6, nrow = 2)

apply(m, 1, mean)             # 按行求均值（MARGIN = 1），2 是按列
lapply(list(1, 2:5), sum)     # 对 list 逐元素应用，返回 list
sapply(1:3, function(i) i^2)  # lapply 的简化版，自动变成向量 c(1, 4, 9)
vapply(1:3, function(i) i^2, numeric(1))   # 指定返回类型，最稳
tapply(mtcars$mpg, mtcars$cyl, mean)       # 按分组计算，返回命名向量
```

| 函数 | 作用对象 | 返回 | 典型场景 |
| --- | --- | --- | --- |
| `apply` | 矩阵/数组 | 向量或矩阵 | 按行/列算统计量 |
| `lapply` | 向量/list | list | 通用，永不简化 |
| `sapply` | 向量/list | 尽量简化 | 交互探索 |
| `vapply` | 向量/list | 预设类型 | 脚本与生产代码 |
| `tapply` | 向量 + 分组 | 命名向量 | 快速分组统计 |
| `mapply` | 多个向量并行 | 尽量简化 | 多参数版 sapply |

> [!WARNING]
> sapply 的「简化」是猜的：结果元素个数不定时，它在向量、list 甚至矩阵之间摇摆。写脚本请用 `vapply(..., FUN.VALUE = numeric(1))` 钉死返回类型，或者全套 lapply 再自己 unlist——类型不稳定是这类代码最阴的 bug 来源。

## 数据框上的批量操作

数据框是 list，所以 `lapply(df, class)` 能逐列查类型。但数据框的批量变换，日常更多交给 dplyr 的 `across()`：

```r
library(dplyr)
starwars %>% summarize(across(where(is.numeric), mean, na.rm = TRUE))
```

分工记法：**dplyr 管数据框，apply 家族管 list 与矩阵**。在数据框上硬写 apply / sapply，多半是还没想到 across 怎么写。

> [!NOTE]
> 性能敏感的场景还有 purrr 的 `map_*` 家族：`map_dbl()`、`map_chr()`、`map_dfr()` 按返回类型命名，没有简化猜测问题，和管道配合更好。它与 lapply 思想完全一致，学会一个等于学会两个。

## 练习

- [ ] 写函数 `safe_divide <- function(a, b)`：b 中含 0 的位置返回 NA，其余返回 a/b（提示：向量化一行搞定）
- [ ] 用 `case_when` 把数值向量分成三档，注意 NA 的落点
- [ ] 用 sapply 分别对 `list(c(1, 2), c(3, 4))` 和 `list(c(1, 2), 3)` 做恒等变换，对比返回的矩阵与列表——返回类型取决于数据

相关阅读：[dplyr 数据处理](04-dplyr.md)
