---
title: 工具生态
order: 11
tags: 进阶, PyTorch, sklearn
summary: numpy 的向量思维、sklearn 与 PyTorch 的分工、常用数据集资源与算力常识。
---

算法论文年年换血，Python 工具链的格局却相当稳定：**numpy** 管数组，**sklearn** 管经典机器学习，**PyTorch** 管深度学习。本章把三件套的定位、常用数据集资源和算力常识过一遍，作为整个板块的收尾。

## numpy：向量思维是一切的底座

深度学习的本质运算是矩阵乘法，numpy 的核心价值是让你用**向量思维**写代码：把"对每个元素做循环"替换成"对整个数组做一次运算"，执行交给底层的 C。

```python
import numpy as np

X = np.random.rand(10000, 128)               # 一万个 128 维向量

# 慢：Python 循环逐行算
dists = [np.sqrt(((x - X[0]) ** 2).sum()) for x in X]

# 快：一行向量化，运算整体下推到底层
dists = np.linalg.norm(X - X[0], axis=1)     # 一万个距离一次算完
```

两种写法结果相同，速度差上百倍。**广播**（broadcasting）是配套机制：形状不同的数组运算时自动对齐——`(10000, 128) - (128,)` 自动把后者复制到每一行，省去显式循环和复制内存。

> [!TIP]
> 判断代码有没有"numpy 化"：看到对数组的 for 循环就停下来，想想能不能换成整体运算。PyTorch 的张量（tensor）API 与 numpy 几乎同构，这里练出的直觉可以原样迁移过去。

## sklearn 与 PyTorch 的分工

两个库覆盖不同的问题域，接口哲学也不同：

| | sklearn | PyTorch |
| --- | --- | --- |
| 地盘 | 经典 ML：线性模型、树、聚类、预处理 | 深度学习：神经网络 |
| 接口风格 | `fit` / `predict`，高度封装 | 自己写训练循环，`nn.Module` 自由组装 |
| 梯度 | 内置，多数模型不用关心 | autograd 自动求导 |
| 硬件 | CPU 为主 | GPU 一等公民 |
| 典型数据 | 表格、中小规模 | 图像 / 文本 / 语音、大规模 |

sklearn 的精华是**统一接口**：所有模型都是 `fit`、`predict`、`score` 三板斧，换模型只换类名；**Pipeline** 把预处理和模型串成一条链：

```python
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression

pipe = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000))
pipe.fit(X_train, y_train)   # 预处理+训练一步到位，交叉验证时也不会泄漏
```

PyTorch 的哲学相反：不封装训练过程，前向、反向、更新全摆在你面前——啰嗦，但透明可控，做研究和非主流结构时无所不能。

```python
import torch

device = "cuda" if torch.cuda.is_available() else "cpu"
model.to(device)                                     # 模型和数据必须在同一设备
x_batch, y_batch = x_batch.to(device), y_batch.to(device)
```

> [!NOTE]
> 两者不冲突，很多真实项目是混搭：sklearn 做数据清洗和特征工程，PyTorch 训模型，sklearn 的 metrics 算评估。此外 HuggingFace 的 `transformers` 库是第三个必知成员——上万现成的预训练模型（BERT、各类 LLM、图像模型），几行代码就能加载微调。

## 一份可复制的最小工作流

把前十章的知识压进十行代码——这就是一份能跑的表格任务基线：

```python
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import classification_report

X_tr, X_te, y_tr, y_te = train_test_split(
    X, y, test_size=0.2, stratify=y, random_state=42)   # 分层抽样保住类别比例
pipe = make_pipeline(StandardScaler(), GradientBoostingClassifier(random_state=42))
pipe.fit(X_tr, y_tr)
print(classification_report(y_te, pipe.predict(X_te)))   # 精确率/召回率/F1 一次看全
```

先让这十行跑通，再谈改进——这比"从零手写神经网络"快得多的入门路径，也符合第 2 章强调的"基线先行"。

## 环境与复现

AI 代码对版本意外地敏感：numpy 新版本可能改变默认行为，torch 版本决定某些算子能不能用。最低限度的卫生习惯：

- 用虚拟环境（venv / conda / uv 任选其一）隔离每个项目
- 用 `requirements.txt` 或锁文件固定依赖版本
- 固定随机种子，连同库版本号一起记进实验记录（第 10 章的原则：不可复现等于没做）

## 数据集资源

练手数据按阶段选：

| 数据集 | 内容 | 适合练什么 |
| --- | --- | --- |
| MNIST / Fashion-MNIST | 28×28 灰度小图 | 第一个分类器、第一个神经网络 |
| CIFAR-10 / CIFAR-100 | 32×32 彩色小图 | CNN、数据增强 |
| UCI 机器学习库 | 各类表格数据 | 特征工程、树模型 |
| HuggingFace Hub | 文本与多模态海量数据集 | NLP、微调预训练模型 |
| Kaggle | 竞赛 + 社区 + 真实脏数据 | 全流程，还能看别人的解法 |

## 算力常识

最后是工程师绕不开的硬件现实：

- **GPU 为什么快**：神经网络的核心是大矩阵乘法，GPU 用几千个小核心并行计算，比 CPU 快一到两个数量级
- **显存是硬约束**：batch size、模型大小、序列长度都受显存限制，`CUDA out of memory` 是每个人的第一课
- **训练比推理贵好几倍**：训练要同时保存参数、梯度和优化器状态，显存占用是推理的数倍；推理可以量化压缩后再部署
- **入门不需要买卡**：本地 CPU 跑 sklearn 和小网络绰绰有余；深度学习练手用免费或低价的云端 GPU；等真有持续需求再考虑租卡或购卡

> [!WARNING]
> 粗估显存的经验法则：参数量 × 每参数字节数（fp32 为 4，fp16 为 2），再乘 3~4 倍余量覆盖梯度和优化器状态。数十亿参数起步的大模型训练另当别论——那是系统工程的领域，入门阶段通过 API 调用即可，不必执着于自训。

工具会继续演化，但"数据 → 特征 → 模型 → 评估"这个循环不会变。回到第 1 章那张地图，你现在应该能把每一个术语放进它该在的位置了。

相关阅读：[AI 与机器学习全景](01-overview.md)，[训练实践](09-training-practice.md)
