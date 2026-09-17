---
title: 回归建模
order: 8
tags: 进阶, lm, glm
summary: lm 线性回归与诊断图、glm 逻辑回归、broom 把模型变成整洁表格。
---

回归是数据分析的主力武器：既回答「有没有关系」（p 值），也回答「关系多大」（系数）。R 里拟合线性回归只有一行 `lm()`，真功夫在两处：读懂 `summary()` 的输出，画诊断图确认模型假设没崩。

## lm：线性回归

```r
fit <- lm(mpg ~ wt + hp, data = mtcars)   # 油耗 ~ 车重 + 马力
summary(fit)
```

`summary()` 的输出按这个顺序读：

1. **Coefficients 的 Estimate 列**：`wt` 的 -3.88 意思是「车重每增加 1000 磅，油耗下降 3.88 MPG，马力保持不变」——多元回归的每个系数都是**控制其他变量后**的效应
2. **每行的 Pr(>|t|)**：该系数是否显著不为 0，`***` 星号是显著性标记
3. **Adjusted R-squared**：模型解释了多少方差，用调整版是为了防止「加变量就涨」
4. **Residual standard error**：典型残差大小，拿业务量纲对照着感受

因子变量进公式会自动做虚拟编码，系数以字母序第一个水平为基准；交互项直接写 `x1:x2` 或 `x1*x2`。

## 诊断图：四张图各查一件事

```r
par(mfrow = c(2, 2))    # 拼成 2x2 四宫格
plot(fit)
par(mfrow = c(1, 1))    # 恢复
```

| 图 | 查什么 | 健康的样子 |
| --- | --- | --- |
| Residuals vs Fitted | 线性假设 | 残差随机散布在 0 附近，无弯曲趋势 |
| Normal Q-Q | 残差正态性 | 点大致贴着对角线 |
| Scale-Location | 方差齐性 | 条带大致等宽，不随拟合值发散 |
| Residuals vs Leverage | 强影响点 | 没有点越过 Cook 距离虚线 |

诊断图不是走形式：残差有弯曲说明要加二次项或做变换（`log(y) ~ x`、`y ~ poly(x, 2)`）；喇叭口说明方差不齐；Leverage 图右上角冒出的点要回查原始数据是不是录错。

> [!WARNING]
> 诊断不合格时，先怀疑数据：异常值、录入错误、漏掉重要变量，最后才考虑换模型。反复调模型把 p 值磨到显著，是回归分析的头号歧路——p 值在这种操作下已经失去意义。

## 预测

```r
new <- data.frame(wt = c(2.5, 3.5), hp = c(100, 200))
predict(fit, new)                            # 点预测
predict(fit, new, interval = "confidence")   # 均值的置信区间
predict(fit, new, interval = "prediction")   # 单个新观测的预测区间（更宽）
```

`newdata` 的列名必须与训练数据完全一致，缺列多列都会报错——这是好事，逼你明确模型的输入。

模型对象本身还能继续深挖：

```r
confint(fit)                      # 系数的 95% 置信区间
fit2 <- update(fit, . ~ . + cyl)  # 在旧模型上加变量，不必重写整个公式
anova(fit, fit2)                  # 两模型比较，看新变量值不值得
```

写报告时，`confint()` 的区间往往比星号更有说服力：区间横跨 0，再多星号也撑不住结论。

## glm：不止线性

`glm` 把回归推广到非正态响应，最常用的是逻辑回归（二分类结果）：

```r
gfit <- glm(am ~ wt + hp, data = mtcars, family = binomial)
summary(gfit)
```

系数在**对数几率（log-odds）**尺度上，直接读数字不直观；取指数变成几率比（odds ratio）才好解释：

```r
exp(coef(gfit))    # wt 的 OR ≈ 0.0003：车重每加 1000 磅，是手动挡的几率约变为原来的 0.0003 倍
```

预测时注意 `type`：

```r
# predict(gfit, new)                    # ❌ 返回对数几率，不是概率
predict(gfit, new, type = "response")   # ✅ 返回 0~1 的概率
```

> [!TIP]
> `family = binomial` 是 logit 链接；计数数据用 `family = poisson`，调用方式一模一样。glm 的学习成本在统计原理而不在代码——代码层面，它和 lm 只差一个 family 参数。

## broom：模型变成整洁表格

模型对象是复杂的 list，不便于进管道、进表格、进图。broom 的三个函数负责「拆包」：

```r
library(broom)

tidy(fit)      # 系数表：term / estimate / std.error / statistic / p.value
glance(fit)    # 模型整体：r.squared / AIC / BIC / nobs
augment(fit)   # 每个观测：.fitted / .resid / 各类诊断量
```

三个函数都返回 tibble，模型结果可以直接接 dplyr 和 ggplot2：

```r
library(dplyr)
tidy(fit) %>% filter(p.value < 0.05)                            # 挑显著项
augment(fit) %>% ggplot(aes(.fitted, .resid)) + geom_point()    # 自制残差图
```

分组批量建模也靠它：`group_by %>% nest %>% mutate(fit = map(data, ~ lm(mpg ~ wt, data = .x))) %>% mutate(coef = map(fit, tidy))`——一百个组的模型结果收进一张表。

> [!NOTE]
> 嵌套模型比较用 `AIC(fit1, fit2)`，越小越好，但只在同一数据上可比。变量选择是手段不是目的：回到业务问题，模型越简单越好解释。

## 练习

- [ ] 拟合 `lm(mpg ~ wt + hp)`，用自己的话解释 wt 系数
- [ ] 画四联诊断图，找出 Cook 距离最大的观测并回查原始数据
- [ ] 用 broom 提取系数表，过滤出 p < 0.05 的项，按 estimate 排序

相关阅读：[统计分析入门](07-stats-basics.md)、[可重复报告](10-reports.md)
