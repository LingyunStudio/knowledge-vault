---
title: 工具链地图：sklearn、PyTorch 与生态
order: 10
tags: sklearn, PyTorch, Pipeline, 工具生态
summary: ML 工具生态的地形图、scikit-learn 的 API 设计哲学（fit/transform/predict 与 Pipeline 防泄漏）、PyTorch 的核心抽象（tensor/autograd/nn.Module）、两阵营的分工边界，以及工具选型的决策框架。
---

ML 工具生态的两大支柱：**scikit-learn**（传统 ML 的瑞士军刀，API 设计的教科书）与 **PyTorch**（深度学习的研究与生产标准）。它们不是竞争关系而是**分层关系**——本篇讲清各自的抽象核心与衔接方式。

## 1. 生态地形图

```text
┌────────────────────────────────────────────┐
│ 应用层：LangChain/HF Hub/模型服务(Triton/vLLM)│
├────────────────────────────────────────────┤
│ 框架层：PyTorch（深度学习） | scikit-learn（传统ML）│
│          HF Transformers（预训练模型）        │
├────────────────────────────────────────────┤
│ 数据层：pandas/Polars（表格） NumPy（数组）    │
├────────────────────────────────────────────┤
│ 基础层：CUDA/ONNX Runtime/实验管理(W&B/MLflow) │
└────────────────────────────────────────────┘
```

分工地图：**表格/小数据 → sklearn；深度学习/非结构化 → PyTorch；预训练模型微调 → HF Transformers（PyTorch 之上）**。numpy 是所有层的公共货币（ndarray）。

## 2. scikit-learn：API 设计的教科书

```python
model.fit(X_train, y_train)        # 学习（从数据估计参数）
model.predict(X_test)              # 预测
transformer.transform(X)           # 变换（缩放/编码/降维）
```

sklearn 的伟大之处不在算法数量而在 **API 一致性**：所有 300+ 算法共享同一接口——学一个学所有。三个约定：**fit 学参数、transform/predict 应用、构造参数即超参**（fit 时不改超参）。

### 2.1 Pipeline：防泄漏的结构化方案

```python
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.linear_model import LogisticRegression

pipe = Pipeline([
    ("scale", StandardScaler()),        # 步骤按序执行
    ("pca", PCA(n_components=10)),
    ("clf", LogisticRegression()),
])
pipe.fit(X_train, y_train)              # ★ 每折的 fit 只用训练折
pipe.predict(X_test)                    # 全链自动 transform
cross_val_score(pipe, X, y, cv=5)       # ★ Pipeline 进 CV：转换在每折内重新 fit！
```

Pipeline 的核心价值：**把「预处理 + 模型」封装成一个可 fit 的对象**——交叉验证时每折的转换器独立拟合（[数据泄漏](../ai/01-ml-overview.md)的结构性杜绝——手工版必然出错）。调参也统一：`pipe.named_steps` 或 `param_grid = {"clf__C": [...]}`（双下划线访问子步骤）。

```python
from sklearn.compose import ColumnTransformer
pre = ColumnTransformer([
    ("num", StandardScaler(), num_cols),          # 数值列：缩放
    ("cat", OneHotEncoder(handle_unknown="ignore"), cat_cols),   # 类别列：独热
])
pipe = Pipeline([("pre", pre), ("clf", ...)])     # ★ 列级差异化处理（表格任务的标准形态）
```

ColumnTransformer 把「不同列不同变换」声明化——表格任务的标准开头。**手工版的「某列忘了缩放/编码」类 bug 在声明式结构下不可能发生**（[git 钩子的防线思想](../git/09-hooks-automation.md)：结构防错优于纪律防错）。

## 3. PyTorch：动态图的研究标准

```python
import torch
import torch.nn as nn

class Net(nn.Module):                        # 模型 = nn.Module 的子类
    def __init__(self):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Linear(784, 128), nn.ReLU(),
            nn.Linear(128, 10),
        )
    def forward(self, x):                    # 前向 = 普通 Python 代码（动态图！）
        return self.layers(x)

x = torch.randn(32, 784, requires_grad=False)
out = model(x)
loss = criterion(out, y)
loss.backward()                              # autograd：动态图自动微分
```

PyTorch 的三个核心抽象：

1. **Tensor**：带 GPU 能力与 autograd 记录的多维数组（numpy 的 GPU/微分版；[第 5 篇](05-nn-basics.md)的手写版的一切用 Tensor 重写）。
2. **autograd**：动态图自动微分——前向时记录操作图、backward 时反向求导（每步可打断可调试——动态图对研究者友好 vs TF1 的静态图编译）。
3. **nn.Module**：模型的容器（参数管理/嵌套/`state_dict` 存取）——[React 组合](../frontend/09-react.md)的思想（嵌套 Module 树）。

```python
model.train()        # 训练模式（BatchNorm/Dropout 生效）★ 忘切 = 经典 bug
model.eval()         # 推理模式
torch.no_grad():     # 推理不求梯度（省显存提速）
torch.compile(model) # PyTorch 2.x 的编译加速（[第 8 篇](08-training-practice.md)）
```

## 4. HF Transformers：预训练模型的标准化

```python
from transformers import AutoModel, AutoTokenizer
model = AutoModel.from_pretrained("bert-base-chinese")    # 一行加载预训练权重
tok = AutoTokenizer.from_pretrained("bert-base-chinese")

# 微调：Trainer API 管[训练循环/混合精度/分布式](08-training-practice.md)
from transformers import Trainer
trainer = Trainer(model=model, args=args, train_dataset=ds)
trainer.train()
```

HF Transformers 把「预训练模型的加载/微调/部署」标准化成 AutoClass 三件套——**LLM 时代的 pip**（[LLM 篇](../llm/01-what-is-llm.md)的基础设施层）。

## 5. 选型决策框架

| 问题                     | 答案                                   |
| ------------------------ | -------------------------------------- |
| 表格、样本 < 百万、要快出结果 | sklearn（GBDT [第 3 篇](03-trees-ensembles.md)）|
| 图像/语音/文本/序列        | PyTorch（+ HF Transformers 处理 NLP）   |
| 需要微调预训练模型         | HF Transformers                         |
| 部署环境多样/无 GPU 依赖   | ONNX Runtime（[第 9 篇](09-deployment.md)）|
| 实验可追溯                | W&B/MLflow（[第 8 篇](08-training-practice.md)）|

工具学习的优先级：**sklearn 的 API 哲学与 Pipeline**（用得最久）→ **PyTorch 的三抽象**（深度学习入门）→ **HF 生态**（预训练时代）——「先地基后框架」的 [前端同款路线](../frontend/01-web-model.md)。

## 6. 陷阱清单

- 手工串步骤绕开 Pipeline：CV 泄漏；声明式结构（第 2 节）。
- sklearn 模型 pickle 跨版本加载：版本兼容性脆；连 sklearn 版本一起记录（[第 9 篇](09-deployment.md)）。
- PyTorch 忘 model.train()/eval() 切换：BatchNorm/Dropout 状态错（推理指标诡异）。
- tensor 在 GPU 与 CPU 间反复搬运：性能杀手；pipeline 内数据常驻 GPU。
- `torch.no_grad()` 忘加：推理时梯度图累积、显存爆。
- HF 的 AutoTokenizer 与模型不匹配（不同预训练版本的词表）：tokenizer 与 model 同源加载。
- 把 pandas 的链式赋值当可靠操作（SettingWithCopyWarning）：数据处理的静默失效。

## 7. 小结

- 生态分层：numpy 货币层 → sklearn/PyTorch 框架层 → HF/部署应用层；表格 vs 深度学习的分治。
- sklearn 的遗产是 **API 设计**（fit/transform/predict 一致性）与 **Pipeline/ColumnTransformer** 的防泄漏结构——「声明式管道」是 ML 工程的结构化防线。
- PyTorch 三抽象：Tensor（GPU+autograd）、动态图自动微分、nn.Module 组合——「train/eval 切换与 no_grad」是两大高频坑。
- HF Transformers 是预训练时代的标准化层：AutoClass + Trainer 把微调变成配置。
- 工具学习路线：sklearn 哲学 → PyTorch 抽象 → HF 生态——与领域（表格/深度/预训练）的匹配。

## 8. 练习

**1.** Pipeline 防泄漏实证：用「缩放泄漏版」与 Pipeline 版各跑 5 折 CV，对比指标差——再把 Pipeline 存成 pickle 部署，验证「预处理随管道一起走」。

> [!TIP]
> 思路泄漏的量化（[第 2 篇练习 5](02-linear-models.md)）+ 部署一致性（[第 9 篇](09-deployment.md)）在 Pipeline 上汇合——「一个结构解决两个问题」是优秀抽象的标志。

**2.** ColumnTransformer 练习：对一个混合列数据集（数值/类别/文本列）声明完整的预处理管道——数值缩放、类别独热、文本 TF-IDF——并在网格搜索中同时调「分类编码策略」与「模型超参」。

> [!TIP]
> 思路`param_grid = {"pre__cat__strategy": [...], "clf__C": [...]}` 的跨层调参——Pipeline 的统一调参面。表格任务的标准起点模板。

**3.** PyTorch 三抽象触摸：手写一个带 BatchNorm 的小网络，实验「忘 eval 的推理指标异常」「忘 no_grad 的显存增长」——把两大高频坑变成肌肉记忆。

> [!TIP]
> 思路两个 bug 的指纹：eval 缺失→「训练好推理怪」、no_grad 缺失→「推理越跑显存越高」。打印 `model.training` 状态与显存曲线可自证。

**4.** 自定义 Dataset 与 DataLoader：把一个 CSV 数据集包装成 PyTorch Dataset（含预处理与增强），跑通训练循环——理解「数据管道」在 PyTorch 的形态（[第 8 篇](08-training-practice.md)的 batch 肉眼检查在这里做）。

> [!TIP]
> 思路Dataset 的 `__getitem__` 与 DataLoader 的 collate（批处理）分层——增强放 Dataset（训练时）不放验证集。「训练/验证 Dataset 的差异」就是预处理一致性的事前设计。

**5.** HF 微调最小流程：加载一个中文 BERT，用 Trainer 在一个文本分类小数据集上微调，评估 F1——完整走一遍「AutoClass 加载 → 数据 tokenize → Trainer 训练 → 保存」。

> [!TIP]
> 思路HF 把「预训练+微调」压缩到 ~30 行——预训练时代的入口范式（[LLM 篇](../llm/04-pretrain-sft-rlhf.md)的全流程从这里起步）。Tokenizer 的 padding/truncation 参数是首个细节坑。

**6.** 讨论：为什么 sklearn 的「fit/transform 一致性」被称为 ML 界最好的 API 设计之一？从「认知负荷（学一次用所有）」「组合性（Pipeline 可能的原因）」「防错（fit 的边界清晰）」三个角度分析，对照 [PyTorch 的灵活性优先]（每层自定义 forward）——**一致性与表达力**在 API 设计光谱上的取舍。

> [!TIP]
> 思路sklearn 用「约束表达力」换「零认知负荷与防泄漏结构」——传统 ML 的算法同质性让这成为可能；深度学习的研究需求逼 PyTorch 选择灵活性。API 设计的第一问：**用户的多样性与错误成本**——sklearn 面向「应用者」、PyTorch 面向「研究者」。
