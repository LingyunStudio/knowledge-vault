---
title: Trie 与并查集：两个小而美的专用结构
order: 7
tags: Trie, 并查集, 前缀
summary: 前缀树的空间换时间、并查集的路径压缩与按秩合并——两个问题域极窄但无可替代的结构。
---

这两个结构不像数组、哈希那样通用，但在各自的问题域里没有像样的替代品：**Trie 专治前缀，并查集专治"连通性"**。它们也是"约束换效率"思想的极致样本。

## Trie（前缀树）：按字符逐层分叉

把每个字符串按字符插到树上，公共前缀共享路径：

```text
      root
     /    \
    a      b
   / \      \
  p  t:✓    y:✓     存了 "at", "ap", "app", "by"
 /
 p:✓
```

查找、插入、前缀匹配都只跟**字符串长度 L** 有关，与库里有多少词条无关——O(L)。哈希表查找单个键同样是 O(L)（要哈希整个键），但 **Trie 能回答哈希表答不了的问题**：

- 有没有以 "app" 开头的词？（前缀存在性，O(L)）
- 按字典序遍历所有词（中序即可）
- 自动补全：走到前缀节点，其子树就是候选集

```python
class Trie:
    def __init__(self):
        self.kids = {}          # 字符 → 子节点
        self.end = False        # 此处是否是词尾
    def insert(self, w):
        node = self
        for ch in w:
            node = node.kids.setdefault(ch, Trie())
        node.end = True
    def starts_with(self, p):
        node = self
        for ch in p:
            if ch not in node.kids: return False
            node = node.kids[ch]
        return True
```

> [!NOTE]
> 代价是空间：字符集大、词条前缀少重叠时，节点数可能远超总字符数。工程折中：限字符集的 256 叉数组、按需分配的哈希子节点、或压缩路径的 radix tree（Linux 内核路由表、Rust std 的 patricia 尝试都是这个思路）。

## 并查集：只回答"谁和谁是一伙的"

维护 n 个元素的分组关系，支持两个操作：

- **find(x)**：x 属于哪个组（返回组代表）
- **union(a, b)**：把两组合并

判断朋友圈、网络连通、最小生成树（Kruskal 判环）、等价类合并——凡是"只关心同不同伙、不关心内部结构"的场景都是它。

实现是简单的树：每个节点指向父节点，根就是组代表。朴素实现树会退化成链，两个优化把它救回来：

```python
class DSU:
    def __init__(self, n):
        self.p = list(range(n))     # 父指针
        self.r = [0] * n            # 秩（树高上界）
    def find(self, x):
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]   # 路径压缩：指到祖父
            x = self.p[x]
        return x
    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb: return False           # 已同组（Kruskal 判环就在这）
        if self.r[ra] < self.r[rb]: ra, rb = rb, ra
        self.p[rb] = ra                     # 矮树挂到高树下
        if self.r[ra] == self.r[rb]: self.r[ra] += 1
        return True
```

1. **路径压缩**：find 时顺手把沿途节点直接挂到根——越查越平
2. **按秩合并**：矮树挂到高树下，树高不失控

两者齐上后，单次操作均摊 O(α(n))，α 是反阿克曼函数——**n 到宇宙原子数那么大，α(n) 也不超过 4**，实践中就当常数，却不是真的 O(1)，这是数据结构里最优雅的一个复杂度。

> [!TIP]
> 动态加边问连通用并查集；边会删除（"断网"）则并查集无能为力，考虑离线倒着做（把删除倒放成添加）或用支持撤销/删边的 LCT 等高级结构。先想清楚操作集，再选结构。
