---
title: Tokenizer 与 Embedding：模型眼里的文字
order: 2
tags: tokenizer, embedding, BPE
summary: BPE 分词、token 计费与长度估算、词向量与语义相似度——所有输入输出在模型眼里都是向量。
---

模型不能直接读文字。进入模型之前，文本先被 **Tokenizer** 切成 token、再查表变成向量（embedding）；输出时逆向走一遍。理解这两步，才能解释计费规则、上下文窗口长度、以及"为什么模型数不对 strawberry 里有几个 r"。

## Tokenizer：子词是折中的艺术

最早的方案各有痛点：按**单词**切，词表爆炸且处理不了新词（OOV）；按**字符**切，序列太长、丢语义。主流方案 **BPE（Byte Pair Encoding）**取中道：从字符开始，反复合并语料中最高频的相邻对，直到词表达到目标大小（如 10 万）：

```text
"unhappiness" → ["un", "happi", "ness"]     高频组合成为独立 token
"ChatGPT"     → ["Chat", "G", "PT"]          罕见词被拆碎
```

要点：

- **高频词整存、低频词拆碎**——模型从没见过"token"这个词也不要紧，它见过所有碎片
- 现代实现多基于**字节级 BPE**：任何 Unicode 文本都能表示，不会 OOV
- 不同家的词表不同（GPT 系 / Llama 系 / Qwen 系），**同一段文本的 token 数不同**，跨模型比较长度要各自数

### 实用：token 与成本

- 英文约 **1 token ≈ 0.75 个单词**；中文约 **1 个汉字 ≈ 0.6\~1 个 token**（取决于词表对中文的优化程度）
- API 按 token 计费，输入输出都算；上下文窗口（如 128K）也是 token 数
- 长文先估算 token 数再决定切分；对"省 token"敏感时，精炼提示词比换模型见效更快

> [!TIP]
> 模型对"字符级"操作（数字符、反转字符串、做字母谜题）不可靠，根源就在这里：它看到的不是字母，是 token。同理，大数字的乘法出错率高——token 边界切在数字中间会加剧这个问题。

## Embedding：语义的几何学

Token 经查表变成一个高维向量（如 4096 维），进入 Transformer 逐层变换。核心信念是：**语义相近的词，向量在空间中就相近**——"猫"和"狗"的向量夹角小，和"合同"的夹角大。

```python
# 用 embedding 模型把文本变向量，做语义相似度
from openai import OpenAI
client = OpenAI()
def embed(text: str) -> list[float]:
    return client.embeddings.create(
        model="text-embedding-3-small", input=text).data[0].embedding

def cos_sim(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    return dot / (norm(a) * norm(b))
# cos_sim(embed("小猫在睡觉"), embed("猫咪打盹"))   → 高
# cos_sim(embed("小猫在睡觉"), embed("股价上涨"))   → 低
```

Embedding 是一切**语义检索**的地基：

- **向量检索/RAG**：文档切块变向量存库，查询变向量找最近邻（第 08 篇）
- **聚类与去重**：相似语义的文本自然聚在一起
- **分类的零样本版**：比较文本与各标签描述的相似度

> [!NOTE]
> Embedding 模型也吃 token 上限。超长文本要先切块再嵌入；切块粒度是 RAG 效果的第一杠杆——切太碎丢上下文，切太稀稀释语义。

## 位置信息：向量还差最后一件事

注意力机制本身是"无序"的（集合运算），必须把**位置**注入向量——早期用正弦位置编码，主流已换成 **RoPE（旋转位置编码）**：按位置旋转向量，相对距离自然进入注意力打分。上下文窗口的长度、长文本外推能力，都卡在这一环。
