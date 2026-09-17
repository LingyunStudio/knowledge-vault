---
title: 树模型与集成学习
order: 4
tags: 核心, 决策树, 集成
summary: 决策树怎么长、随机森林与 GBDT 两种集成思路、表格数据任务的首选。
---

在表格数据（Excel 里那种行列结构）上，树模型至今是最强的通用解，多年来的 Kaggle 表格类比赛冠军方案基本都是它。本章先讲一棵树怎么长出来，再讲为什么把很多棵树组合起来反而更强——三种对象（单棵树、随机森林、GBDT）对应的是"从能用到好用"的演进。

## 决策树：一串自动生成的 if-else

决策树就是一串 if-else：每个节点问一个特征的问题（"面积 > 80 吗？"），按答案分流，叶子节点给出预测。

```python
from sklearn.tree import DecisionTreeClassifier, export_text

tree = DecisionTreeClassifier(max_depth=3, random_state=0).fit(X_train, y_train)
print(export_text(tree, feature_names=list(X.columns)))
# |--- 距地铁 <= 0.85
# |   |--- 面积 <= 55.00
# |   |   |--- class: 0
# ...整棵树可以直接当业务规则读出来
```

树的生长是**贪心**的：在每个节点上，遍历候选特征和切分点，选一个让"分裂后两边更纯"的——分类用基尼系数或信息增益，回归用方差下降。没有任何全局规划，所以单棵树长得好不好相当看运气。

树模型的先天优点：不需要特征缩放、天然处理混合类型、对异常值不敏感、输出人类可读。先天缺陷同样清楚——**一棵允许长到底的树会把每个训练样本都背下来**（每个叶子只剩一个样本），过拟合几乎是必然。

> [!WARNING]
> 不限制 `max_depth` 的决策树几乎必然过拟合。单棵树必须剪枝（限深度、限叶子数、限叶内最小样本数），但调起来很娇气——实践中单棵树很少直接用，它的价值要到"集成"里才真正释放。

## 集成学习：两种"多个弱合成一个强"的思路

集成（ensemble）把多个模型组合成一个。组合方式就两大流派：

| | Bagging（并行） | Boosting（串行） |
| --- | --- | --- |
| 训练方式 | 各棵树独立训练，互不知晓 | 一棵接一棵，每棵修正前面的错误 |
| 主攻什么 | **方差**（不稳定、过拟合） | **偏差**（学得不够准） |
| 能并行吗 | 天然可以，核越多越快 | 天生串行，只能靠单棵树内部的并行 |
| 代表 | 随机森林 | GBDT / XGBoost / LightGBM |
| 组合方式 | 投票 / 平均 | 累加 |

两条路线殊途同归：一棵树不可靠，就种一片林子。理解这对概念还有个附带好处——它们是第 9 章"过拟合对策"里"集成"一节的理论基础。

## 随机森林：让树互相不同

随机森林给每棵树注入两层随机：**bootstrap 采样**（每棵树用有放回抽样得到的不同子集训练）加**特征随机**（每次分裂只从随机抽出的一个特征子集里挑最优）。树与树因此各不相同、错误互相抵消，最后投票定案。

```python
from sklearn.ensemble import RandomForestClassifier

rf = RandomForestClassifier(n_estimators=200, n_jobs=-1, random_state=0)
rf.fit(X_train, y_train)     # n_jobs=-1 用满所有 CPU 核，树之间天然可并行
```

随机森林几乎"开箱即用"：默认参数就有体面的效果，不容易过拟合（树越多反而越稳），代价是可解释性下降——好在上它还自带特征重要性，能告诉你哪些特征说了算。

还有一个免费福利：**袋外（OOB）评估**。每棵树用有放回抽样训练，平均约三分之一的样本没被抽到——这些"袋外样本"可以顺手当验证集，不用单独划数据：

```python
rf = RandomForestClassifier(n_estimators=300, oob_score=True, n_jobs=-1)
rf.fit(X_train, y_train)
print(rf.oob_score_)   # 不占用验证集的"免费"评估，小数据集尤其好用
```

## GBDT：每棵树都在补前面的错

Boosting 的思路相反：树是串行的，第 n 棵树专门去拟合前面所有树加起来**还剩下的错误**——回归场景下就是拟合残差，一般形式是拟合损失的负梯度，所以叫"梯度提升"。所有树按小步长累加，逐步逼近正确答案。

```python
from sklearn.ensemble import GradientBoostingClassifier

# 工业级实现 XGBoost / LightGBM 接口类似，速度快得多，通常优先选它们
gbdt = GradientBoostingClassifier(n_estimators=300, learning_rate=0.1)
gbdt.fit(X_train, y_train)
```

两个关键超参数绑在一起：`learning_rate` 越小步子越稳，就需要越多的 `n_estimators` 补足。GBDT 的拟合能力通常强于随机森林，是当前表格数据任务的默认首选；XGBoost、LightGBM 是它的高性能工业实现——工程细节不同（直方图加速、按叶子生长等），核心思想一致。调参起点可以记三个数：`learning_rate` 0.05-0.1、树深 4-8（或叶子数 31 附近）、行/列采样 0.8 上下，再用早停自动定树的数量。

> [!NOTE]
> XGBoost/LightGBM 都支持**早停**：预留一小部分训练数据当验证集，验证指标连续若干轮不再提升就自动停止加树。配合给足 `n_estimators` 使用，比手调树的数量省心得多——第 9 章的早停对策在这里同样适用。

## 解释模型：特征重要性与局限

树集成自带一种粗粒度的解释：哪个特征被用来分裂的次数多、带来的不纯度下降大，哪个就重要。

```python
import pandas as pd

importances = pd.Series(rf.feature_importances_, index=X.columns)
print(importances.sort_values(ascending=False).head())
```

两个提醒：一是重要性高不等于"因果"，只说明模型**依赖**它做分裂；二是高基数特征（取值特别多，如用户 ID）的重要性天然虚高，别被误导。要严谨的归因，用 permutation importance 或 SHAP 值。

## 表格实战的三个常客问题

- **类别特征**：树模型不能直接吃字符串。低基数用 one-hot，高基数用目标编码或 LightGBM 原生的类别类型（`categorical_feature`）
- **缺失值**：LightGBM/XGBoost 可以原生处理 NaN（自动学习缺失样本往哪边分），sklearn 的树需要先填充
- **类别不平衡**：别急着上采样，先给 `class_weight="balanced"` 或 `scale_pos_weight` 调整损失权重，再配合第 10 章的指标选择
- **时间特征**：日历位、滞后值、滑动统计——表格任务里最容易白捡的提升，但构造时要当心第 10 章的数据泄漏（比如用了"未来"的统计量）

这三个问题处理得好不好，往往比换模型本身影响更大。

## 怎么选

| 场景 | 建议 |
| --- | --- |
| 表格数据、中等以上规模 | GBDT 系（XGBoost / LightGBM）打基线 |
| 想省事、怕过拟合、核多 | 随机森林 |
| 需要业务可读的规则 | 单棵限深的树或线性模型 |
| 图像 / 文本 / 语音 | 都别用，交给神经网络（第 5 章起） |
| 超大规模（亿级行） | LightGBM + 特征筛选；再不够转分布式方案 |

为什么神经网络没拿下表格数据？普遍的解释：表格特征之间的关系以"条件判断"为主而非"空间组合"，树的结构天然匹配；且表格数据量通常不足以喂饱大网络。承认这一点，能省下大量无效的建模时间。

> [!TIP]
> 拿到新的表格数据集，第一件事是用 LightGBM/XGBoost 跑一个基线，半小时内你就有了一个"很难被打败"的参照。如果后面精心搭的神经网络没有明显赢过它，问题多半在数据而不在模型——先回去看第 2 章的流程。

相关阅读：[神经网络基础](05-neural-networks.md)，[机器学习基本流程](02-ml-workflow.md)
