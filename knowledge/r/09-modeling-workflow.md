---
title: 建模工作流：broom 与 tidymodels
order: 9
tags: broom, tidymodels, 交叉验证, recipes, parsnip
summary: broom 的模型输出整洁化三件套、train/test 与交叉验证的重采样纪律、tidymodels 四件套（recipes/parsnip/workflows/tune）的统一建模语法，以及一个完整的预测工作流组装。
---

统计建模的输出（lm/glm 对象）是「专家格式」——summary 打印好看、程序化处理困难。**broom** 把模型输出变成整洁表（[第 4 篇](04-data-frames.md)的 tidy data 思想延伸到模型）；**tidymodels** 把「特征工程 + 模型 + 重采样 + 调参」组织成统一工作流。本篇是从「统计建模」（第 8 篇）走向「机器学习工作流」的桥。

## 1. broom：模型输出的整洁化

```r
library(broom)
m <- lm(mpg ~ wt + hp, mtcars)

tidy(m)          # 系数表：term/estimate/std.error/statistic/p.value（一行一系数）
glance(m)        # 整体指标：r.squared/AIC/BIC/nobs（一行一模型）
augment(m)       # 观测级：每行原始 y + fitted + resid + 影响量（一行一观测）
```

三件套的语义：**tidy = 系数、glance = 模型、augment = 观测**。收益立刻显现——模型比较与批量建模变成表格操作：

```r
models <- expand.grid(vars = c("wt", "hp", "disp")) |>
  rowwise() |>
  mutate(m = list(lm(reformulate(vars, "mpg"), mtcars)),
         glance = list(glance(m))) |>
  unnest(glance) |>                        # 模型比较表：N 个模型 × 各项指标
  arrange(desc(r.squared))

purrr::map_dfr(c("wt", "hp"), \(v) tidy(lm(reformulate(v, "mpg"), mtcars))))
# 多模型的系数表堆叠 —— 可视化/导出/报告直接可用
```

「N 个模型 → 一张比较表」是 broom 的核心价值：**把模型当数据**，dplyr/ggplot 的全部工具顺势接管。

## 2. 重采样：train/test 与交叉验证

```r
library(rsample)
set.seed(42)
split <- initial_split(mtcars, prop = 0.8)     # 分层可加 strata = y
train_df <- training(split)
test_df  <- testing(split)

folds <- vfold_cv(train_df, v = 5, repeats = 2)   # 5 折 × 2 重复交叉验证
folds |> analysis(1) |> nrow()                     # 每折的训练部分
```

纪律框架（与[python 篇](../python/12-quality.md)的测试纪律同源）：

- **test 集只在最后碰一次**——它是对「泛化性能」的一次性估计，不是调参的回音壁。
- **交叉验证在 train 内做**：调参、特征选择、模型比较全部用 CV 报告的指标。
- **随机性带 seed**；分类问题 `strata = y` 保分层。
- 数据泄漏的常见口子：标准化/特征选择在 split **之前**做（用了 test 的信息）——正确位置在 recipe 内、按折拟合（下节）。

## 3. tidymodels 四件套

```r
library(tidymodels)          # 加载 parsnip/recipes/workflows/rsample/yardstick/tune…

# ① parsnip：模型统一接口
lm_spec  <- linear_reg() |> set_engine("lm")        # 线性回归
rf_spec  <- rand_forest(trees = 500) |>             # 随机森林
              set_engine("ranger") |>
              set_mode("regression")

# ② recipes：特征工程配方（声明式、可按折拟合）
rec <- recipe(mpg ~ ., data = train_df) |>
    step_impute_median(all_numeric_predictors()) |>   # 缺失填充
    step_normalize(all_numeric_predictors()) |>       # 标准化（防止泄漏的正确位置！）
    step_dummy(all_nominal_predictors())              # 哑变量编码

# ③ workflows：配方 + 模型的封装
wf <- workflow() |>
    add_recipe(rec) |>
    add_model(rf_spec)

# ④ fit 与预测：同一 API 跨所有模型
fit_wf   <- fit(wf, data = train_df)
preds    <- predict(fit_wf, test_df) |> bind_cols(test_df)
metrics  <- preds |> metrics(truth = mpg, estimate = .pred)   # yardstick
metrics
```

parsnip 的价值是**模型无关的统一 API**：换模型（lm→rf→xgboost）只改 spec，fit/predict/extract 的调用形态不变——与 [sklearn 的 fit/predict](../python/12-quality.md) 同一接口哲学。recipes 的价值是**特征工程的声明式与防泄漏**：预处理步骤在 CV 的每折内重新拟合（impute 的中位数只来自该折训练部分）。

## 4. 调参与重采样的完整组装

```r
rf_tune <- rand_forest(trees = 500, mtry = tune(), min_n = tune()) |>
    set_engine("ranger") |> set_mode("regression")

set.seed(42)
cv_res <- workflow() |>
    add_recipe(rec) |>
    add_model(rf_tune) |>
    tune_grid(resamples = folds, grid = 10, metrics = metric_set(rmse, rsq))

autoplot(cv_res)                          # 超参-性能曲线
show_best(cv_res, metric = "rmse")        # 最优组合
final_wf <- finalize_workflow(wf |> add_model(rf_tune), select_best(cv_res, "rmse"))
final_fit <- last_fit(final_wf, split)    # ★ 在 test 上的一次性最终评估
collect_metrics(final_fit)
```

流程的时序纪律在 `last_fit` 里被固化：**CV 只碰 train、test 只被 last_fit 触碰一次**——「重采样内调参、最终评估一次性」的机器学习工作流标准形态。

## 5. 分类任务的指标面

```r
cls_res <- preds |> metrics(truth = vs, estimate = .pred_class)   # accuracy/recall...
conf_mat(preds, truth = vs, estimate = .pred_class) |> autoplot()
roc_curve(preds, truth = vs, .pred_1) |> autoplot()               # ROC 曲线
roc_auc(preds, truth = vs, .pred_1)
```

分类评估的完整面：**混淆矩阵（错误类型）、召回/精确（不对称成本）、ROC/AUC（阈值无关）**——单一 accuracy 在不平衡数据上的欺骗性（[概率篇](../prob/06-hypothesis-testing.md)的基率谬误延伸）是指标选择的出发点。

## 6. 陷阱清单

- 数据泄漏：标准化/插补/特征选择在 split 外做——全部进 recipe（按折拟合）。
- test 集反复触碰：last_fit 一次定终；中间评估全走 CV。
- 不设 seed 或丢 seed：结果不可复现；seed 与分析代码同版本管理。
- 忘记 step_dummy/编码导致模型引擎报错：分类列的处理显式化。
- 只看一个指标：不平衡分类看 PR 曲线/召回；回归看残差图不只 R²。
- tune 网格过大无导航：autoplot 看趋势再细化；随机网格优于全网格起步。
- 模型对象直接进报告：broom 化成表再进文档（可审计、可比较）。

## 7. 小结

- broom 三件套（tidy/glance/augment）把模型当数据：批量建模与模型比较变成 dplyr/ggplot 的表格操作。
- 重采样纪律：test 一次性、CV 内调参、分层与 seed；泄漏的预防靠「预处理进 recipe、按折拟合」。
- tidymodels 四件套各司其职：parsnip 统一模型 API、recipes 声明特征工程、workflows 封装、tune/yardstick 调参与评估——与 sklearn 的管线哲学同构。
- 完整形态：spec → recipe → workflow → tune_grid → finalize → last_fit；分类任务的指标面看混淆矩阵/ROC/AUC 而非单 accuracy。
- 「统计建模」（第 8 篇）与「机器学习工作流」在 R 里由 broom/tidymodels 连接：同一套 tidy 工具服务两种范式。

## 8. 练习

**1.** 拟合 5 个不同形式的 mpg 模型（不同变量组合），用 map + tidy/glance 组装「模型比较总表」，按 AIC 排序并可视化系数区间（coef 表 + geom_pointrange）。

> [!TIP]
> 思路模型比较表的列：model_id、变量集、r.squared、AIC、各系数。系数区间的 pointrange 图（多模型同图）是「变量稳健性」的可视化——符号翻转的变量即不稳定。

**2.** 用 tidymodels 完成 KNN 与随机森林的回归对比：同一 recipe、同一 CV、metric_set(rmse, rsq)——collect_metrics 汇总成对比表，并解释「重采样的重复对结论稳定性的作用」。

> [!TIP]
> 思路两模型共享 recipe/workflow 骨架，只有 spec 不同——parnsip 统一接口的红利。repeats=2~3 让指标带标准误——「CV 的波动性」需要被报告而不只是均值。

**3.** 故意制造一次数据泄漏：在 split 之前对全数据 step_normalize，对比正确做法的 test RMSE——量化泄漏带来的「乐观偏差」。

> [!TIP]
> 思路泄漏版 test 指标系统性偏好（尤其小样本）——因为 test 的统计信息已经渗入预处理。「泄漏是 ML 的 p-hacking」：结论美好但不可复制。

**4.** 对一个不平衡二分类问题（10:1）分别报告 accuracy 与 recall/PR-AUC——构造一个「全预测多数类」的基线模型，看它在 accuracy 上的欺骗性。

> [!TIP]
> 思路全猜多数类的 accuracy = 91% 但 recall(少数类) = 0——指标与业务成本（漏检代价）的匹配是分类评估的第一决策。

**5.** 把第 8 篇的 glm 逻辑回归放进 tidymodels 流程（logistic_reg + recipe 含 step_dummy），与手写 glm 的系数对比——确认两条路线殊途同归，体会「统计范式与 ML 范式」在 R 里的互操作。

> [!TIP]
> 思路系数一致（同一算法不同封装）——tidy(m) 与 tidy(fit_wf) 可逐项核对。两条范式的分野不在数学在流程：推理（诊断/推断）偏 base、预测管线偏 tidymodels。

**6.** 讨论：recipes 的「声明式预处理 + 按折拟合」为什么是防泄漏的正确架构？从「数据流的单一时间轴」角度分析，并对照 [sklearn Pipeline](../python/12-quality.md) 与 [dplyr 的管道](05-dplyr.md)——三种管线（ML 预处理/数据整理）的「顺序性」有什么共同约束？

> [!TIP]
> 思路共同约束：任何「从数据学参数」的步骤（均值/水平/特征选择）都必须只用「过去」的数据（训练折），评估只发生在「未来」。管线架构把时间轴编码进结构——结构防错优于纪律防错，与 [git 分支保护](../git/09-hooks-automation.md)的同款哲学。
