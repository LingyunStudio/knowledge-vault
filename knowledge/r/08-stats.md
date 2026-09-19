---
title: 统计建模基础：公式接口与 lm
order: 8
tags: lm, glm, 公式, t.test, 假设检验, 诊断
summary: 公式接口的完整语法（交互项/去截距/I()）、lm 拟合与 summary 的逐字段解读、四张诊断图、glm 的 logistic/possion 形态、假设检验函数族与分布函数四兄弟 r/p/q/d。
---

R 的建模层建立在**公式接口**上：`y ~ x1 + x2` 这一行同时是统计记号与可执行语法。本篇以 lm 为中心讲「拟合 → 解读 → 诊断」的完整闭环，再带 glm 与假设检验函数族——统计理论的推导在[概率论篇](../prob/01-foundations.md)，这里是「把理论跑起来」的操作面。

## 1. 公式接口：模型规范的语言

```r
lm(mpg ~ wt, data = mtcars)              # 简单线性回归
lm(mpg ~ wt + hp, data = mtcars)         # 多元（+ 是「加入」不是加法）
lm(mpg ~ wt + hp + wt:hp, data = mtcars) # 交互项（:）
lm(mpg ~ wt * hp, data = mtcars)         # 等价 wt + hp + wt:hp（* 展开全交互）
lm(mpg ~ (wt + hp)^2, data = mtcars)     # 同上（括号幂 = 全交叉）
lm(mpg ~ wt - 1, data = mtcars)          # 去截距
lm(mpg ~ log(wt) + I(hp^2), data = mtcars)   # 变换：I() 包住算术（^ 在公式里是交互）
lm(mpg ~ ., data = mtcars[, 1:5])        # 所有用列
```

公式的语义约定：

| 记号          | 含义                                  |
| ------------- | ------------------------------------- |
| `~`           | 左响应右解释                           |
| `+`           | 加入项                                 |
| `:` / `*`     | 交互 / 全交叉（主效应+交互）            |
| `-1`          | 无截距                                 |
| `I(...)`      | 原始算术（否则 `^`、`+` 被公式语法征用） |
| `poly(x, 2)`  | 正交多项式（多项式回归的标准姿势）       |
| `factor(g)`   | 分类编码（哑变量）                      |
| `offset(x)`   | 固定系数为 1 的项（泊松回归的曝光量）     |

公式里列名在 data 参数中查找——**「公式 + 数据框」是 R 建模的统一接口**，从 lm 到 glm 到 lmer（混合模型）到 tidymodels 全部遵守。

## 2. lm：拟合与 summary 解读

```r
m <- lm(mpg ~ wt + hp, data = mtcars)
summary(m)
```

```text
Coefficients:
            Estimate Std. Error t value Pr(>|t|)
(Intercept) 37.22727    1.59879  23.285  < 2e-16 ***
wt          -3.87783    0.63273  -6.129 1.12e-06 ***
hp          -0.03177    0.00903  -3.519  0.00145 ** 
---
Signif. codes: 0 '***' 0.001 '**' 0.01 '*' 0.05
Residual standard error: 2.593 on 29 degrees of freedom
Multiple R-squared: 0.8268,  Adjusted R-squared: 0.8148
F-statistic: 69.21 on 2 and 29 DF,  p-value: 9.109e-12
```

逐字段解读（统计含义见[概率篇](../prob/06-hypothesis-testing.md)）：

- **Estimate**：系数（wt 每增 1 单位 mpg 降 3.88）。
- **Std. Error / t / Pr**：系数的不确定度与显著性——p 值是对「系数为 0」的检验。
- **Residual SE**：残差的标准差（模型的典型误差尺度）。
- **R² / Adjusted R²**：解释方差比例（调整版惩罚变量数）。
- **F 统计量**：整体显著性（所有系数同时为 0 的检验）。

```r
coef(m)                # 系数向量
confint(m)             # ★ 系数置信区间（比 p 值信息量大）
predict(m, newdata = data.frame(wt = 2.5, hp = 100), interval = "prediction")
```

报告纪律：**看置信区间而不只看 p 值**（区间给出效应量与不确定度，p 值只回答「是否为 0」）；预测时区分 `interval = "confidence"`（均值的区间）与 `"prediction"`（单点的区间——更宽）。

## 3. 诊断：plot(model) 的四张图

```r
par(mfrow = c(2, 2))
plot(m)                 # ① 残差-拟合 ② Q-Q ③ 尺度-位置 ④ 残差-杠杆
par(mfrow = c(1, 1))

residuals(m); rstandard(m)     # 原始/标准化残差
influence.measures(m)          # 影响点（cooks.distance/leverage）
```

四张图的诊断语义：

1. **残差-拟合**：查线性与同方差——弯曲 = 模型形式不对（补项/变换）；喇叭形 = 方差不齐（考虑 log 变换）。
2. **Q-Q**：残差正态性——点偏离对角线 = 分布假设存疑（推断的 p 值随之打折）。
3. **尺度-位置**：同方差性的另一视角。
4. **残差-杠杆**：找 influential 点（Cook 距离等高线外的点）——删掉重拟合对比结论。

「拟合完不诊断直接报告系数」是统计实践的三大罪之一（另两个：不画原始数据、多重比较不校正）——诊断图是 lm 工作流的强制环节。

## 4. glm：广义线性模型

```r
# logistic：二分类响应（0/1），输出 logit 链接
m_logit <- glm(survived ~ age + sex, data = titanic, family = binomial)
summary(m_logit)
exp(coef(m_logit))                    # ★ 系数取指数 = 优势比 OR（可解释性的关键转换）
pred <- predict(m_logit, type = "response")   # 概率（默认给 logit 尺度！）

# 泊松：计数响应
m_pois <- glm(count ~ treatment + offset(log(exposure)), family = poisson, data = d)

# 拟合评价
1 - m_logit$deviance / m_logit$null.deviance        # 伪 R²
confint(m_logit)                      # profile 置信区间
```

glm 用 `family` 参数切换响应分布（binomial/poisson/Gamma…）——线性模型的框架延伸。两个高频坑：**predict 默认给链接尺度**（logit 的对数几率）需要 `type = "response"` 才是概率；系数要 `exp()` 才是可解释的优势比。

## 5. 假设检验函数族

```r
t.test(x, y)                          # 两样本 t（默认 Welch 不等方差——稳健默认）
t.test(x, mu = 0, alternative = "greater")
wilcox.test(x, y)                     # 非参数替代（秩和）
prop.test(c(30, 45), c(100, 120))     # 比例比较
chisq.test(table(df$grp, df$outcome)) # 卡方（列联表独立性的标准检验）
fisher.test(tab)                      # 小样本列联表

aov(score ~ grp, data = d)            # 单因素方差分析
summary(aov(score ~ grp + block, data = d))
TukeyHSD(aov(score ~ grp, data = d))  # 事后两两比较（多重比较校正）
```

检验的输出对象同样是「模型对象」——`t.test` 返回 list（statistic/p.value/conf.int），`htest` 类可被 broom::tidy 转成整洁表（[第 9 篇](09-modeling-workflow.md)）。多重比较的纪律：**探索性比较要做校正**（Tukey/BH），预注册的比较才可以直接报告 p 值。

## 6. 分布函数四兄弟

R 的每个分布有四个函数（前缀 r/p/q/d + 分布名）：

```r
rnorm(100)                    # r = random：随机抽样
pnorm(1.96)                   # p = CDF：P(X ≤ 1.96) ≈ 0.975
qnorm(0.975)                  # q = quantile：分位数（置信区间的常数来源）
dnorm(0)                      # d = density：密度值

rt(10, df = 5); qt(0.975, df = 29); pchisq(...); qbinom(...)
set.seed(42); rnorm(3)        # ★ 可复现：seed 在模拟/bootstrap 前必设
```

「r 抽样、p 累积、q 反查、d 密度」的命名贯穿全部分布——蒙特卡洛模拟、功效计算、Bootstrap 的原料函数。`set.seed` 是**可复现性的开关**：任何含随机性的分析，seed 必须写进代码（[第 11 篇](11-projects-reports.md)的可复现纪律）。

## 7. 陷阱清单

- 公式里 `^`/`+` 被语法征用：算术变换用 I()，多项式用 poly()。
- predict 忘 type="response"：glm 拿到 logit 尺度的「概率」当概率用；系数不 exp 当 OR 报。
- 不画诊断图：线性/同方差/正态/影响点四项检查是 lm 的强制环节。
- p 值崇拜：置信区间 + 效应量是报告的主件；多重比较不校正。
- t.test 用等方差默认（var.equal=TRUE 的旧习惯）：Welch 默认更稳健。
- 随机分析不设 seed：结果不可复现；seed 与代码同库。
- NA 静默删行（lm 的 na.action）：样本量变化不察觉；`model$na.action` 检查删了谁。

## 8. 小结

- 公式接口是 R 建模的统一语法：`+ : * -1 I() poly() factor() offset()` 各有统计语义——模型规范直接可执行。
- lm 的闭环：summary 五字段解读 → confint/predict → 四张诊断图（线性/正态/同方差/影响点）——诊断是强制环节。
- glm 扩展响应分布族：logistic 的 exp(系数)=OR、predict 的 response 尺度是两大纪律点。
- 检验函数族（t/prop/chisq/aov+Tukey）与分布四兄弟（r/p/q/d）覆盖推断与模拟的原料；seed 是可复现开关。
- 报告纪律：效应量与置信区间为主、p 值为辅、多重比较校正、缺失处理透明。

## 9. 练习

**1.** 用 mtcars 拟合 mpg ~ wt*hp，解读交互项系数的含义；再用 I() 与 poly() 各拟合一个非线性版本，比较 Adjusted R²。

> [!TIP]
> 思路交互项系数回答「wt 对 mpg 的影响随 hp 变化的斜率」。poly(x, 2) 优于 I(x^2)（正交化减少共线）——两种非线性形态的数值差异是公式语法细节的活教材。

**2.** 构造一个「喇叭形残差」的数据（方差随均值增大），拟合 lm 并画出四张诊断图；用 log(y) 重拟合对比——把「诊断 → 修正 → 再诊断」的循环走完整。

> [!TIP]
> 思路y = x + x*rnorm() 类构造方差异质。log 变换后残差图收紧——「看图诊断 → 模型修正」的肌肉记忆来自这种故意造病的练习。

**3.** 用 titanic 类数据做 logistic 回归全流程：系数 OR 化、概率预测、混淆矩阵与准确率、ROC/AUC（pROC 包）——把「模型输出 → 业务可解释」走通。

> [!TIP]
> 思路type="response" 的概率与 0.5 阈值切分是基线；OR 表（exp(coef)+confint）是给业务的语言。AUC 的解读与阈值选择的关系（[概率篇](../prob/07-bayesian.md)的先验影响）值得延伸。

**4.** 用 rnorm 模拟「已知真值的 t 检验」：真 μ=0 的数据重复 1000 次 t.test，统计 p<0.05 的比例（应≈5%）；再让 μ=0.5 看功效——用模拟验证检验的「大小与功效」。

> [!TIP]
> 思路set.seed + replicate 是统计模拟的标准骨架。α=0.05 的含义（真零假设被拒的比例）与功效（真效应被检出率）在模拟里从抽象变成数字——统计教学的蒙特卡洛路线。

**5.** 对一个三组比较做 aov + TukeyHSD，再手动做三次 t.test 加 Bonferroni 校正（p×3），对比结论与 p 值——直观感受多重比较校正的代价与必要。

> [!TIP]
> 思路未校正的多次比较让假阳性率从 5% 膨胀到 ~14%（1−0.95³）。Tukey 的联合分布校正更精确——「检验次数与假阳性」的定量关系是统计素养的分水岭。

**6.** 讨论：R 的公式接口（模型规范进语法）vs [sklearn 的 API](../python/12-quality.md)（fit(X, y) 矩阵进、无公式）——两种接口哲学在「探索性建模 vs 工程化管线」场景各赢在哪？哑变量编码的隐式（公式自动）与显式（ColumnTransformer）各适合谁？

> [!TIP]
> 思路公式接口服务「统计学家思维」（变量语义/交互/编码都在规范里），矩阵接口服务「管线思维」（类型化输入、列变换显式、可序列化）。显式编码避免「隐式哑变量在预测时水平不一致」的坑——工程管线里显式化的价值再次胜出。
