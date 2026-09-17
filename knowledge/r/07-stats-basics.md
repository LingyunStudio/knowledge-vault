---
title: 统计分析入门
order: 7
tags: 核心, 统计, 检验
summary: 描述统计、t 检验/卡方/相关性、公式接口 y ~ x 的读法。
---

R 是统计学家写给统计学家用的语言，统计检验是它的主场。入门真正要掌握的并不多：会算描述统计、会跑三个最常用的检验（t、卡方、相关）、会读公式接口 `y ~ x`。检验原理请配合教材，本篇聚焦「在 R 里怎么算、结果里先看哪个数」。

## 描述统计：先看再检验

```r
x <- c(23, 25, 28, 22, 90)        # 故意放一个离群值

mean(x)         # 37.6，被 90 拉飞
median(x)       # 25，几乎不受影响
sd(x); var(x)   # 标准差、方差
quantile(x, c(0.25, 0.5, 0.75))   # 分位数
IQR(x)          # 四分位距
range(x)        # 22 90，极值
```

规律：`mean`、`sd` 对离群值敏感，`median`、`IQR` 稳健。偏态分布报中位数和四分位距，对称分布才轮到均值加减标准差。分类变量用 `table()`：

```r
g <- c("A", "A", "B", "B", "B", "C")
table(g)                # 频数：A 2, B 3, C 1
prop.table(table(g))    # 频率：0.333 0.500 0.167
```

## 公式接口：y ~ x 的读法

R 的统计函数统一用公式（formula）描述模型，读法固定：**~ 左边是响应变量（结果），右边是解释变量（原因）**：

```r
weight ~ height        # 用身高解释体重
weight ~ height + sex  # + 表示「同时纳入模型」
weight ~ height * sex  # * = 主效应 + 交互效应，等价 height + sex + height:sex
mpg ~ .                # . 表示除 mpg 之外的所有列
```

同一套写法贯穿 t 检验、方差分析、线性回归、逻辑回归——学一次，用全程。

## t 检验：比较均值

```r
male   <- c(175, 180, 168, 172)
female <- c(162, 168, 170, 158)

tt <- t.test(male, female)   # 双样本 t 检验
tt                           # 打印完整结果
tt$p.value                   # 结果是对象，字段可单独取用
```

输出按顺序看三样：`t` 统计量、`df` 自由度、`p-value`。R 默认 `var.equal = FALSE`，即 Welch t 检验，不要求两组方差齐——比教科书里的经典 t 检验更稳健，除非有明确理由，不要改回 TRUE。其他形态：单样本 `t.test(x, mu = 170)`，配对设计 `t.test(before, after, paired = TRUE)`。

> [!TIP]
> 检验函数返回的是 list 型对象，`str(tt)` 看一眼全部字段：`estimate`（均值差）、`conf.int`（置信区间）、`p.value` 都能单独取出。写自动化报告靠这个，而不是从打印文本里抠数字。

## 卡方检验：分类变量的关联

```r
tab <- matrix(c(30, 20, 25, 45), nrow = 2,
              dimnames = list(c("男", "女"), c("买", "不买")))
chisq.test(tab)
chisq.test(tab)$expected     # 查看期望频数
```

卡方检验回答「两个分类变量是否独立」。前提是期望频数不能太小（经验值：全部 ≥ 5），不满足时 R 会警告——样本小时改用 `fisher.test(tab)` 精确检验即可，不必纠结。

> [!WARNING]
> 卡方检验默认每个观测只贡献一次。把同一顾客的多笔消费当多行喂进去再跑卡方，是最常见的误用——先想清楚分析单位是什么。

## 相关性

```r
x <- mtcars$wt; y <- mtcars$mpg
cor(x, y)                          # -0.868，Pearson 相关系数
cor(x, y, method = "spearman")     # 秩相关：抗离群值、不要求线性
ct <- cor.test(x, y)               # 带置信区间与 p 值
```

有缺失时 `cor` 默认返回 NA，改用 `use = "complete.obs"` 成对剔除。两个提醒：相关系数只度量**线性**关系，接近 0 不代表没关系（可能有强曲线关系）；相关不等于因果，这条没有例外。

## 检验怎么选

| 问题 | 数据形态 | 函数 |
| --- | --- | --- |
| 两组均值有无差异 | 连续 | `t.test` |
| 多组均值有无差异 | 连续 | `aov` + `pairwise.t.test` |
| 两个分类变量是否独立 | 分类 | `chisq.test` / `fisher.test` |
| 两个连续变量是否线性相关 | 连续 | `cor.test` |
| 数据是否服从正态分布 | 连续 | `shapiro.test` |

正态性检验常在选检验之前做：

```r
shapiro.test(x)    # p < 0.05：拒绝正态假设
```

不过 t 检验对正态性偏离相当稳健，大样本下尤其如此——Shapiro 显著未必是天塌了。分布明显偏、样本又小时，换非参数对应物：`wilcox.test` 对应 t 检验，`kruskal.test` 对应 aov。

## 从检验到模型

t 检验和方差分析其实是同一族模型的特例，R 里可以直接用公式写：

```r
t.test(mpg ~ am, data = mtcars)                   # 二分组：自动按 am 分两组
summary(aov(mpg ~ factor(cyl), data = mtcars))    # 多组：单因素方差分析
```

多组比较显著之后，想知道具体哪两组有差异，用 `pairwise.t.test()`；一次做很多检验时要考虑多重比较校正（Bonferroni 等）。公式 `y ~ x` 到这里已经出现四次——下一篇它升级为回归建模的主舞台。

## 练习

- [ ] 对 mtcars 跑 `t.test(mpg ~ am)`，从输出里读出均值差、置信区间和 p 值
- [ ] 构造一个 2x2 频数表跑 `chisq.test`，并检查 `$expected` 是否都 ≥ 5
- [ ] 用 `quantile(mtcars$mpg)` 输出五数概括，判断分布是否对称

相关阅读：[回归建模](08-modeling.md)
