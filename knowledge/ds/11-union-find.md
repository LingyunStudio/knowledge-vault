---
title: 并查集：只回答一个问题，但答得极快
order: 11
tags: 并查集, 等价类, 路径压缩, 摊还分析, 连通分量
summary: 只维护「谁与谁同属一个集合」的最窄接口，如何在按秩合并与路径压缩后达到 O(α(n))，以及带权、种类、可撤销三种扩展与五大典型应用。
---

在只有一维数组可用的条件下回答「谁和谁是一伙的」——并查集（union-find，也叫不相交集合，disjoint set union，DSU）大概是所有数据结构里性价比最高的一个：十几行代码，每次操作均摊 O(α(n))，而 α(n) 在任何现实规模下都不超过 4。它的代价同样鲜明：接口窄到只剩 union 和 find 两个操作，不支持删除、不支持枚举成员、不支持方向和权重。这一篇要把两件事讲透：为什么「窄」恰恰是它快的根源，以及当问题稍微越界（要比例、要关系推理、要撤销）时，如何用三种标准扩展把并查集重新塞回问题的形状里。

## 1. 问题域：接口窄到只剩两个操作

### 1.1 两个操作与一份「不支持」清单

并查集维护的是一个集合的划分（partition）：n 个元素被切成若干互不相交的等价类，只提供两个操作——`union(a, b)` 声明 a 和 b 同类（传递地，两个类整个合并），`find(x)` 返回 x 所在类的「代表元」。代表元是哪个成员完全不重要，重要的是同一个类的任何成员调用 `find` 都返回同一个值；由此派生出最常用的判断 `connected(a, b)` 等价于 `find(a) == find(b)`。

同样重要的是它不提供什么：

| 想做的事            | 并查集的态度               | 替代方案                                                                          |
| --------------- | -------------------- | ----------------------------------------------------------------------------- |
| 删除一条关系、把一个类劈成两半 | 不支持，结构上无能为力          | 离线倒序处理或线段树分治（见 5.3 节）                                                         |
| 列出某个类的全部成员      | 不支持，结构里只有向上的父指针      | 在根上额外挂成员表，或查询时聚合（见 4.5 节）                                                     |
| 类内最小最大、排序、前驱后继  | 不支持，没有顺序信息           | 平衡树或堆（[第 08 篇](08-bst-balanced-trees.md)、[第 09 篇](09-heap-priority-queue.md)） |
| 表达方向、权重、比例      | 不支持，`union` 是无向的对称关系 | 带权并查集（见 5.1 节）                                                                |
| 表达「同类之外的多重身份」   | 不支持，一个元素同时只属于一个类     | 扩展域（见 5.2 节）                                                                  |

### 1.2 心智模型：一片森林与一条不变式

把每个元素看成一个节点，`parent[x]` 存它父节点的编号，根节点指向自己。于是整个结构是一片森林：每棵树是一个等价类，树根就是代表元。

```text
parent = [0, 0, 1, 3, 3, 5]

  0        3        5
  ↑        ↑        ↑
  1        4
  ↑
  2
（三个等价类：{0,1,2}、{3,4}、{5}，代表元分别为 0、3、5）
```

整个结构只依赖一条不变式：**从任意节点出发，沿 `parent` 走有限步必到达一个指向自己的根；两个节点在同一棵树上，当且仅当它们同根**。所有操作都围绕它展开：`find(x)` 沿父链爬到根；`union(a, b)` 只改一个指针——把一个根的 `parent` 指向另一个根。树的形状完全不重要，没有键序、没有平衡要求。这是并查集与二叉搜索树（[第 08 篇](08-bst-balanced-trees.md)）的根本区别：BST 需要「形状正确」才能回答问题，并查集只需要「根正确」。

### 1.3 为什么「窄」恰恰是快的根源

因为不需要维护成员列表、顺序和方向，全部状态可以塞进一个 `parent` 数组（连续内存，[第 02 篇](02-array-dynamic-array.md)），全部工作只是沿一条向上的路径走——每加一条它不必支持的能力，都是在给每次操作加成本。等价关系的三个性质（自反、对称、传递）里，前两个免费（自己和自己同根；同根对称成立），`union` 做的就是增量维护第三个性质——传递闭包。实战中大部分「连通、分组、判矛盾」的问题都能翻译成等价类：

| 现实问题               | 翻译成并查集              | 出处    |
| ------------------ | ------------------- | ----- |
| 图的连通性、连通分量计数       | 边即 `union`，同根即连通    | 4.1 节 |
| 最小生成树选边时判环         | 两端已同根的边会成环          | 4.2 节 |
| 等式 `a==b` 与 `a!=b` | `==` 合并，`!=` 检查是否同根 | 4.3 节 |
| 网格里的岛屿             | 相邻陆地合并              | 4.4 节 |
| 同一用户的多条记录          | 共享字段（邮箱、设备号）的记录合并   | 4.5 节 |
| 除法关系、汇率、比例账目       | 带权并查集               | 5.1 节 |
| 捕食环、敌友推理           | 扩展域                 | 5.2 节 |

## 2. 从朴素到 O(α(n))：两步优化

### 2.1 朴素版：顺序 union 会退化成一条链

最直接的实现：`find` 沿父链爬到根，`union` 把一个根挂到另一个根下面。

```python
def find_naive(parent, x):
    steps = 0
    while parent[x] != x:
        x = parent[x]
        steps += 1
    return x, steps


def union_naive(parent, a, b):
    parent[find_naive(parent, a)[0]] = find_naive(parent, b)[0]


if __name__ == "__main__":
    n = 8
    parent = list(range(n))
    for i in range(n - 1):            # 依次 union(i, i+1)
        union_naive(parent, i, i + 1)
    print(parent)                     # [1, 2, 3, 4, 5, 6, 7, 7]：一条链
    _, steps = find_naive(parent, 0)  # 从链底走到根
    print("find(0) walked", steps, "steps")   # 7 = n-1 步
    assert steps == n - 1
```

实跑输出：`parent` 变成了 `[1, 2, 3, 4, 5, 6, 7, 7]`，`find(0)` 走了 7 步。问题一目了然：`union_naive(i, i+1)` 每次都把「旧根」挂到「新元素」下面，n−1 次 union 之后整棵树退化成长度 n 的链，此后任何一次 `find` 最坏 O(n)——n 次 union 加 n 次 find 的总代价是 O(n²)。两个优化分别封死两个恶化方向。

### 2.2 优化一：按秩合并——把树高压到 O(log n)

恶化的第一个来源是「挂的方向」。改进：每次合并时把**矮的树挂到高的树下面**。为每棵树记一个「秩（rank）」——它是树高的上界（为什么是上界而不是高度，2.3 节与第 7 节会讲）：

```python
if __name__ == "__main__":
    n = 16
    parent = list(range(n))
    rank = [0] * n                    # rank[i]：i 所在树「高度的上界」

    for i in range(n - 1):            # 同样是依次 union(i, i+1)
        ra, rb = i, i + 1
        while parent[ra] != ra:       # find(ra)
            ra = parent[ra]
        while parent[rb] != rb:       # find(rb)
            rb = parent[rb]
        if rank[ra] < rank[rb]:       # 保证 ra 是较高的树的根
            ra, rb = rb, ra
        parent[rb] = ra               # 矮树挂到高树下
        if rank[ra] == rank[rb]:
            rank[ra] += 1             # 两棵等高树合并，秩才 +1

    print(parent)                     # [0, 0, 0, ..., 0]：全部挂在 0 下面，树是平的
    assert all(p == 0 for p in parent[1:])
```

同样的一串 union，这次树是平的。它为什么有效？两条归纳性质：rank 为 r 的树至少包含 `2^r` 个节点（rank 只在两棵等秩树合并时 +1，此时节点数翻倍）；树的真实高度永远不超过 rank（只有等秩合并才长高，长高量恰为 1）。联立立刻得到：含 n 个节点的树 rank ≤ `log₂n`，**任何一次 find 至多爬 `log₂n` 步**——这是无条件的保证，与操作顺序无关。

另一常见变体是**按大小合并（union by size）**：把元素少的树挂到元素多的树下，`size[ra] += size[rb]`。大小翻倍同样至多 `log₂n` 次，保证等价；当题目还要求「每个集合多大」时，按大小合并顺手把答案也维护了。

### 2.3 优化二：路径压缩——走过的路不再走

恶化的第二个来源是「重复爬同一条长链」。改进：既然 `find` 反正要走到根，回来的时候顺手把沿途节点**全部直接挂到根上**，此后再查这些节点一步到根。树的实际形状从此更无所谓——只有「同根」这件事有意义。

```python
if __name__ == "__main__":
    # 两遍法：先走到根，再回头把沿途节点全部挂到根上
    parent = [1, 2, 3, 4, 4]          # 一条 0→1→2→3→4 的链
    root = 0
    while parent[root] != root:
        root = parent[root]           # 第一遍：root = 4
    x = 0
    while parent[x] != root:
        parent[x], x = root, parent[x]   # 第二遍：顺手改写
    print(parent)                     # [4, 4, 4, 4, 4]：链被压平

    # 路径减半（path halving）：一步跳两格，把祖父顶替父亲
    parent = [1, 2, 3, 4, 4]
    x = 0
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    print(parent)                     # [2, 2, 4, 4, 4]：只走 0→2→4，路径减半而非压平
```

两种写法都常见：**两遍法**压得最平，逻辑最清楚；**路径减半**只需一个循环、常数更小，很多竞赛模板用它，均摊效果同级。还有递归一行版（`parent[x] = find(parent, parent[x])`），短但对每个节点先递归到根再回写，10⁶ 的长链会直接撞上 Python 默认 1000 层的递归上限（[第 01 篇](01-complexity-analysis.md) 第 5 节），生产代码用迭代版。

路径压缩有一个必须知道的副作用：**压缩之后 rank 不再是真实高度**（树被压平了，rank 却没动）。它仍是高度的上界，做合并决策没有问题；但它从此只是个「合并用的高度戳」。这也正是 5.3 节可撤销并查集放弃压缩的根源。

### 2.4 合体：O(α(n)) 与反阿克曼函数

两个优化合在一起，得到均摊 O(α(n))——其中 α 是反阿克曼函数（inverse Ackermann function）。定义看一眼就好：对阿克曼函数 `A`（一个增长快到不可理喻的函数）取反，`α(n)` 是最小的 k 使得 `A(k, k) ≥ n`。它的「增长速度」可以从这张表感受：

| k | A(k, k)  | α(n) = k 的 n 范围   |
| - | -------- | ----------------- |
| 1 | 3        | 1 ≤ n ≤ 3         |
| 2 | 7        | 4 ≤ n ≤ 7         |
| 3 | 61       | 8 ≤ n ≤ 61        |
| 4 | 一个四层的指数塔 | 62 ≤ n ≤ 天文数字     |
| 5 | …        | n 要超过上面那个天文数字才会出现 |

取常用定义时 `A(4, 4)` 是 `2^(2^(2^65536))` 量级——n 取到宇宙原子总量级（约 10⁸⁰）时 α(n) 依然是 4，离变成 5 还差得无法形容。所以「均摊 O(α(n))」在实践中就是「均摊不超过四次迭代」。（不同教材对阿克曼函数的定义相差常数平移，表里的分界点会移动，「实用范围内恒为常数」的结论不变。）

为什么单用任何一个优化只能到 O(log n)，合起来才能到 α？给一个不含证明的直觉：

- **只按秩**：树高被钉在 `log₂n` 后就停了。没有压缩，历史路径永远不会变短，反复 find 深叶子每次都是 `log₂n` 步。
- **只压缩**：没有按秩，union 依然可以把大树根挂到小树根下，不断造出新的长链——「修路」赶不上「毁路」。van Leeuwen 与 Tarjan 在 1984 年构造出了让均摊代价达到 Θ(log n) 的操作序列，证明这个上界是紧的。
- **合用**：按秩保证「新造的树不会高」，压缩保证「走过的路越来越短」，两个机制叠加后，势能分析的递归层数不再是 log 层而是 α 层。后续研究还证明，在标准的指针机模型下 α(n) 是这个问题不可再降的下界。

严格证明超出本文范围，工程上需要记住的只有第 6 节那张对照表和它的结论：**两个优化必须都写**。

## 3. 完整实现

把两个优化组装起来，并额外维护一个「连通分量数」。这份实现是后面所有应用的底座：

```python
def find(parent, x):
    """数组版 find：两遍法，返回 x 所在集合的根。"""
    root = x
    while parent[root] != root:
        root = parent[root]
    while parent[x] != root:          # 第二遍：沿途节点直接挂到根
        parent[x], x = root, parent[x]
    return root


def union(parent, rank, a, b):
    """数组版 union。返回 True 表示真的合并了，False 表示原本就在同一集合。"""
    ra, rb = find(parent, a), find(parent, b)
    if ra == rb:
        return False
    if rank[ra] < rank[rb]:           # 矮树挂到高树下
        ra, rb = rb, ra
    parent[rb] = ra
    if rank[ra] == rank[rb]:
        rank[ra] += 1
    return True


class DSU:
    """类封装版：按秩合并 + 路径压缩 + 连通分量计数。"""

    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n
        self.count = n                # 连通分量数，随成功的 union 递减

    def find(self, x):
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False              # Kruskal 判环就靠这个返回值
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1
        self.count -= 1               # 每次真合并，分量数恰好减一
        return True

    def connected(self, a, b):
        return self.find(a) == self.find(b)


if __name__ == "__main__":
    # 数组版
    p, r = list(range(6)), [0] * 6
    assert union(p, r, 0, 1) is True
    assert union(p, r, 1, 0) is False          # 已在同一集合
    assert union(p, r, 0, 3) and find(p, 0) == find(p, 3)

    # 类封装版
    d = DSU(10)
    assert d.union(1, 2) and d.union(3, 4) and d.union(2, 1) is False
    assert d.union(2, 3) and d.connected(1, 4) and d.count == 7    # {1,2,3,4}

    # union 的返回值就是 Kruskal 的判环器
    d2 = DSU(6)
    picked = 0
    for a, b in [(0, 1), (1, 2), (2, 0), (3, 4)]:
        if d2.union(a, b):
            picked += 1
    assert picked == 3                          # (2,0) 被判为环
    assert d2.count == 3                        # {0,1,2} {3,4} {5}
    print("dsu ok")
```

几条刻意的设计决定：

- **`parent` 用数组不用字典**：下标访问 O(1) 且缓存友好。元素是字符串或稀疏 ID 时，先编号再建数组（[第 06 篇](06-hash-table.md)），第 4 节的应用会反复用到这一招。
- **`find` 用迭代不用递归**：两遍法对栈深免疫，递归版在长链上会爆 Python 的递归上限。
- **`union` 返回「是否真的合并了」**：调用方免费得到「成环检测 / 新增关系」的信号，4.2 节的 Kruskal 和 4.4 节的岛屿计数都直接吃这个返回值；`count` 的不变式是每次成功 union 恰好减一——合并只会让两个类变成一个。
- **复杂度**：`find`、`union`、`connected` 均摊 O(α(n))，单次最坏 O(log n)（树高上界还在），空间 O(n)。摊还语义的严格讨论见 [第 01 篇](01-complexity-analysis.md) 第 2 节。

题目给的编号从 1 开始时，把规模开成 `n + 1`，让下标 0 空着（混用 1-based 与 0-based 是高频事故，见第 7 节）。

## 4. 应用：把问题翻译成等价类

### 4.1 连通分量计数：动态加边的主场

连通分量数是 `count` 直接给出的答案；不用类的话，手工维护一个计数器也一样：

```python
def component_count(n, edges):
    """n 个节点、依次给出 edges，返回最终的连通分量数。"""
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]     # 路径减半
            x = parent[x]
        return x

    count = n
    for a, b in edges:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
            count -= 1                        # 每次真合并，分量数恰好减一
    return count


if __name__ == "__main__":
    assert component_count(8, [(0, 1), (1, 2), (3, 4), (5, 6), (6, 7)]) == 3
    assert component_count(5, []) == 5 and component_count(4, [(0, 1), (1, 2), (2, 3)]) == 1
    print("components ok")
```

同一个问题 DFS/BFS 也能做，怎么选取决于图的「时效性」：

| 场景                          | 选谁                                                      | 理由                     |
| --------------------------- | ------------------------------------------------------- | ---------------------- |
| 静态图，一次性统计，还要每个分量的成员列表       | DFS/BFS（[第 12 篇](12-graph-representation-traversal.md)） | 一遍 O(V+E) 扫描，天然按分量聚合成员 |
| 边陆续到达，边到边问「现在几个分量」「a、b 连通吗」 | 并查集                                                     | 每条边 O(α(n)) 增量更新，绝不重扫  |
| 边有加有删（动态连通性）                | 可撤销并查集 + 线段树分治                                          | 并查集本体不会删除，见 5.3 节      |

并查集拿不出「每个分量的成员」，这是 1.1 节那份清单的直接后果；4.5 节会演示补救办法——查询阶段额外做一趟聚合。

### 4.2 Kruskal 最小生成树：union 返回值就是判环器

Kruskal 把边按权重从小到大考察：一条边的两端如果已经连通，选它必然成环，跳过；否则选它。「两端是否已经连通」正是并查集的全部职责——整个算法不需要邻接表、不需要访问标记，图状态就是一个 `parent` 数组：

```python
def kruskal_mst(n, edges):
    """edges: [(w, u, v), ...]。返回 (最小生成树总权重, 选中的边数)。"""
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    total, picked = 0, 0
    for w, u, v in sorted(edges):         # 按权重从小到大考察每条边
        ru, rv = find(u), find(v)
        if ru != rv:                      # 不连通：选它不会成环
            parent[ru] = rv
            total += w
            picked += 1
        # ru == rv：这条边的两端已经连通，选它必成环，跳过
    return total, picked


if __name__ == "__main__":
    edges = [(1, 0, 1), (4, 0, 2), (1, 1, 2), (5, 1, 3), (6, 2, 3)]
    total, picked = kruskal_mst(4, edges)
    assert (total, picked) == (7, 3)      # 选中 1+1+5，(4,0,2) 与 (6,2,3) 成环被弃
    print("kruskal ok")
```

时间主要花在排序上：O(E log E)；并查集部分是 O(E·α(V))，近似线性。当边不是排好序而是「流式地」从别处来（比如来自堆，[第 09 篇](09-heap-priority-queue.md)），并查集同样即插即用。Kruskal 的正确性证明与 Prim 的对比在 [第 13 篇](13-graph-shortest-path-mst.md)。顺带一提，「逐边 union、首个返回 False 的边就是环边」这个模式本身就是无向图判环的通用解法。

### 4.3 等式方程的可满足性

给定一组形如 `a==b`、`b!=c` 的方程，问它们能否同时成立。翻译：`==` 是传递的，全部合并；`!=` 是约束，要求两端**不同**根。顺序很关键——必须先处理完所有 `==`，再逐条检查 `!=`：

```python
def equations_possible(equations):
    """equations 形如 ["a==b", "b!=a"]。返回这些方程能否同时成立。"""
    idx = {}                                  # 变量名 → 下标（哈希映射，见第 06 篇）
    for eq in equations:
        idx.setdefault(eq[0], len(idx))
        idx.setdefault(eq[3], len(idx))
    parent = list(range(len(idx)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for eq in equations:                      # 第一遍：所有 == 无条件合并
        if eq[1] == "=":
            union(idx[eq[0]], idx[eq[3]])
    for eq in equations:                      # 第二遍：每个 != 都必须跨集合
        if eq[1] == "!" and find(idx[eq[0]]) == find(idx[eq[3]]):
            return False
    return True


if __name__ == "__main__":
    assert equations_possible(["a==b", "b!=a"]) is False
    assert equations_possible(["b==a", "a==b"]) is True
    assert equations_possible(["a==b", "b==c", "a!=c"]) is False
    assert equations_possible(["a!=a"]) is False
    print("equations ok")
```

两遍法不可颠倒：并查集只会长不会缩，如果先碰到 `a!=b` 就「记录矛盾」，随后才到达的 `a==c`、`b==c` 无从回头撤销。所以所有「无条件合并」的动作要全部先做，所有「检查」的动作全部后做——这个节奏适用于一切约束类问题。

### 4.4 岛屿数量：与 DFS 的正面对比

网格里相邻的 '1' 属于同一座岛。DFS 解法（[第 12 篇](12-graph-representation-traversal.md)）对每个未访问的陆地格子泛洪一遍，简单直接，一次性统计时是首选。并查集的解法是把每个格子看成一个元素（编号 `r * cols + c`），扫描时把每块陆地与它上方、左方的陆地合并，用 `union` 的返回值维护岛屿数：

```python
def num_islands(grid):
    """grid 是 '0'/'1' 组成的字符串列表，返回岛屿数量。"""
    rows, cols = len(grid), len(grid[0])
    parent = list(range(rows * cols))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
            return True               # 真的合并了，两个岛屿并成一个
        return False

    land = 0
    for r in range(rows):
        for c in range(cols):
            if grid[r][c] != "1":
                continue
            land += 1                 # 先按「独立岛屿」计数
            if r > 0 and grid[r - 1][c] == "1" and union(r * cols + c, (r - 1) * cols + c):
                land -= 1             # 与上方陆地合并，岛屿数减一
            if c > 0 and grid[r][c - 1] == "1" and union(r * cols + c, r * cols + c - 1):
                land -= 1             # 与左侧陆地合并
    return land


if __name__ == "__main__":
    grid = [
        "11000",
        "11000",
        "00100",
        "00011",
    ]
    assert num_islands(grid) == 3 and num_islands(["111", "111"]) == 1
    print("islands ok")
```

静态网格上并查集并不占优：同样是 O(R·C) 的扫描，DFS 代码更短、常数更小。并查集的胜利在**流式场景**：陆地一块一块地陆续出现，每出现一块就要回答当前岛屿数——DFS 每次都得重扫整张图（O(R·C)），并查集只处理新格子的至多 4 个邻居，每步 O(α(R·C))，答案随时可读。凡「数据分批到达、查询穿插其间」的连通问题，都是并查集的主场；反过来，场景若变成「陆地会消失」，并查集立刻回到 1.1 节那份不支持清单上——删除问题见 5.3 节。

### 4.5 账户合并：等价类聚合

把「同一实体的多条记录」聚成一类，是并查集在工业代码里最常见的形态。典型输入：每个账户是 `[姓名, 邮箱1, 邮箱2, …]`，共享任一邮箱的账户属于同一个人（传递地）。以邮箱为节点，同一账户内的邮箱两两合并：

```python
def merge_accounts(accounts):
    """accounts: [[姓名, 邮箱1, 邮箱2, ...], ...]。返回合并后的账户列表。"""
    email_id = {}                          # 邮箱 → 下标
    for acc in accounts:
        for email in acc[1:]:
            email_id.setdefault(email, len(email_id))
    parent = list(range(len(email_id)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    owner = {}                             # 邮箱 → 姓名
    for acc in accounts:
        for email in acc[1:]:
            owner[email] = acc[0]
            union(email_id[acc[1]], email_id[email])   # 同一账户的邮箱全并起来

    groups = {}                            # 根 → 邮箱列表（等价类聚合）
    for email, i in email_id.items():
        groups.setdefault(find(i), []).append(email)

    return [[owner[emails[0]]] + sorted(emails) for emails in groups.values()]


if __name__ == "__main__":
    accounts = [
        ["张三", "a@x.com", "b@x.com"],
        ["李四", "c@y.com"],
        ["张三", "b@x.com", "d@x.com"],    # 通过 b@x.com 与第一个张三合并
        ["李四", "e@y.com", "c@y.com"],    # 通过 c@y.com 与李四合并
    ]
    merged = merge_accounts(accounts)
    assert ["张三", "a@x.com", "b@x.com", "d@x.com"] in merged
    assert ["李四", "c@y.com", "e@y.com"] in merged
    assert len(merged) == 2
    print("accounts ok")
```

模式有三步：**编号**（把字符串键映射成数组下标，[第 06 篇](06-hash-table.md)）、**合并**（共享字段即 `union`）、**聚合**（按根分组输出）。最后一步正是对「并查集不存成员」的补救：`find` 一趟把每个元素归到它的根下。风控里的用户归一（同一手机号、设备、收货地址的账号判同一人）、日志里同一实体的多条事件聚合，都是这个模式换皮。

## 5. 扩展形态：带权、种类、可撤销

### 5.1 带权并查集：路径上带一个「相对值」

标准并查集只知道「同不同根」。带权并查集（weighted DSU）给每条父指针附加一个权：`weight[x]` 表示 **x 相对其父节点**的某个量。不变式升级为：任意点到根的量 = 沿路径各段权的合成。以「除法求值」为例：`weight[x] = value(x) / value(parent(x))`，合成运算就是乘法，任意点到根的比值即路径连乘。`find` 压缩时必须同步换算权重——两遍法天然适合：第一遍累计出每个途经点到根的权，第二遍回写。挂接时的权重用代数推导：要把 ra 挂到 rb 下，需要 `weight[ra] = value(ra)/value(rb)`，而 `value(ra) = value(a)/wa`、`value(rb) = value(b)/wb`，代入即得。

```python
class WeightedDSU:
    """带权并查集：weight[x] = value(x) / value(parent[x])。
    union(a, b, r) 声明 value(a) / value(b) = r；
    ratio(a, b) 返回 value(a) / value(b)，无信息时返回 None。"""

    def __init__(self):
        self.parent = {}
        self.weight = {}

    def _ensure(self, x):
        if x not in self.parent:
            self.parent[x] = x
            self.weight[x] = 1.0

    def find(self, x):
        """返回 (根, x 相对根的权)。压缩时沿途权重同步换算成「到根」。"""
        path = []
        root = x
        while self.parent[root] != root:
            path.append(root)
            root = self.parent[root]
        acc = 1.0                          # 根相对根的权是 1
        for node in reversed(path):        # 从靠近根的一端往回累乘
            acc *= self.weight[node]       # node 到根 = node 到父 × 父到根
            self.parent[node] = root
            self.weight[node] = acc
        return root, acc

    def union(self, a, b, ratio):
        """声明 value(a)/value(b) = ratio。与已有声明矛盾时返回 False。"""
        self._ensure(a)
        self._ensure(b)
        ra, wa = self.find(a)
        rb, wb = self.find(b)
        if ra == rb:
            return abs(wa / wb - ratio) < 1e-9   # 已有关系：检查一致性
        # 挂 ra 到 rb 下：weight[ra] = value(ra)/value(rb) = ratio * wb / wa
        self.parent[ra] = rb
        self.weight[ra] = ratio * wb / wa
        return True

    def ratio(self, a, b):
        if a not in self.parent or b not in self.parent:
            return None
        ra, wa = self.find(a)
        rb, wb = self.find(b)
        if ra != rb:
            return None
        return wa / wb


if __name__ == "__main__":
    d = WeightedDSU()
    d.union("a", "b", 2.0)                 # a/b = 2
    d.union("b", "c", 3.0)                 # b/c = 3
    assert d.ratio("a", "c") == 6.0 and d.ratio("b", "a") == 0.5   # 传递闭包 + 自动取倒数
    assert d.ratio("a", "e") is None       # e 从未出现

    # 换一个皮就是「按比例的账目/汇率合并」：部分汇率已知，推任意两种货币
    d.union("USD", "CNY", 7.2)
    d.union("CNY", "JPY", 20.0)
    assert abs(d.ratio("USD", "JPY") - 144.0) < 1e-9
    assert abs(d.ratio("JPY", "USD") - 1 / 144.0) < 1e-9

    # 矛盾检测：a/b 已是 2，再声明 5 失败；一致的重复声明没问题
    assert d.union("a", "b", 5.0) is False and d.union("a", "b", 2.0) is True
    print("weighted dsu ok")
```

「除法求值」与「按比例的账目合并」其实是一回事：给定部分比值，推任意两者的比值——多仓库库存折算、多币种账目归一，就是 `ratio(x, 基准)` 的传递闭包；重复声明且数值冲突时 `union` 返回 False，对账逻辑可以直接拿去做矛盾检测。带权并查集的通用条件：权集合上有一个**可结合**的合成运算（半群），且挂接时能反推新边权——除法求值里是乘法群（有逆元，最舒服），5.2 节的食物链里是模 3 加法，「边权异或和」问题里是异或。本例挂接方向任意，单靠压缩均摊 O(log n)；要 α 级保证就把按秩合并与权重换算同时做。

### 5.2 种类并查集：扩展域与食物链

第二类扩展处理「一个元素有多种身份」的关系推理。经典问题**食物链**（洛谷 P2024，NOI 2001；POJ 1182）：三类动物 A、B、C 构成 A 吃 B、B 吃 C、C 吃 A 的环。给出两种话——「x 与 y 同类」「x 吃 y」，问有多少句是与已有真话矛盾的假话。难点在于「同类」和「吃」是两种关系，单一集合表达不了。**扩展域**的解法：每个动物开 3 个域——自身域 `i`、猎物域 `i+n`（i 吃的动物）、天敌域 `i+2n`（吃 i 的动物）。域之间画等号就能表达推理：若 1 吃 2、2 吃 3，则「3 的猎物域」与「1 的自身域」应连通——这正是三域合并后的结论。

```python
def food_chain_fake_count(n, statements):
    """食物链（洛谷 P2024 / POJ 1188）：三类动物 A、B、C 构成 A 吃 B、B 吃 C、C 吃 A 的环。
    statements: (kind, x, y)，kind=1 表示「x 与 y 同类」，kind=2 表示「x 吃 y」。
    动物编号 1..n；编号越界或与已有真话矛盾的算假话。返回假话条数。
    每个动物开 3 个域：i（自身）、i+n（猎物域）、i+2n（天敌域）。"""
    parent = list(range(3 * n + 1))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    fake = 0
    for kind, x, y in statements:
        if not (1 <= x <= n and 1 <= y <= n):
            fake += 1
            continue
        if kind == 1:                              # 声称 x 与 y 同类
            if find(x + n) == find(y) or find(x + 2 * n) == find(y):
                fake += 1                          # 但已知 x 吃 y，或 y 吃 x
            else:
                union(x, y)                        # 三个域对应合并
                union(x + n, y + n)
                union(x + 2 * n, y + 2 * n)
        else:                                      # 声称 x 吃 y
            if x == y or find(x) == find(y) or find(x) == find(y + n):
                fake += 1                          # 自己吃自己 / 同类 / y 吃 x
            else:
                union(x + n, y)                    # y 属于 x 的猎物域
                union(y + 2 * n, x)                # x 属于 y 的天敌域
                union(x + 2 * n, y + n)            # x 的天敌域 = y 的猎物域
    return fake


if __name__ == "__main__":
    n, k = 100, 7
    st = [
        (1, 101, 1), (2, 1, 2), (2, 2, 3), (2, 3, 3),  # 越界假；1吃2、2吃3真；自己吃自己假
        (1, 1, 3), (2, 3, 1), (1, 5, 5),               # 1与3同类假（可推出3吃1）；3吃1真；5与5同类真
    ]
    assert food_chain_fake_count(n, st) == 3
    print("food chain ok")
```

检查条件的由来：声称「x 与 y 同类」为假，当且仅当已推出的关系是 x 吃 y（y 与 x 的猎物域同根）或 y 吃 x（y 与 x 的天敌域同根）；声称「x 吃 y」为假，当且仅当 x 与 y 同类、自己吃自己、或 y 吃 x（x 与 y 的猎物域同根）。「x 吃 y」成立时的三个 union，分别固化「y 是 x 的猎物」「x 是 y 的天敌」「x 的天敌同时是 y 的猎物」三条推理。另一种等价写法是**维护到根的相对种类**：`rel[x]` 记录 x 与根的种类差（模 3），路径压缩时同步换算——本质就是 5.1 节的带权并查集，权重换成模 3 剩余类、合成换成模 3 加法。规律：环长为 k 的关系系统，就开 k 个域，或把权取模 k。

### 5.3 可撤销并查集：放弃压缩换取回滚

最后一类扩展来自一个工程问题：**并查集不会删除**。离线场景下有一批边、一批带时间戳的查询，边在时刻 l 出现、时刻 r 消失——需要支持「撤销最近一次合并」的并查集。

先想清楚为什么路径压缩与撤销不兼容。撤销要求状态可以被精确还原，而路径压缩在**每一次 find** 里改写树形：这些改写不属于任何一次 union，自然不在合并日志里。理论上可以把 find 的每次指针改写也记进日志、撤销时逐条恢复，但日志量会与被压缩路径的长度同阶，压缩省下的时间原路还回去；更糟的是回滚会「复活」旧的长链，2.4 节那份摊还分析整体失效。所以标准做法只有一种：**放弃压缩，只保留按秩合并，并把每次 union 写过的变量记进日志**。按秩合并保证树高 O(log n)（单次操作有界），每次 union 只写一个父指针、至多再把一个 rank 加一，撤销一次 union 就是恢复这两个值，O(1)：

```python
class RollbackDSU:
    """可撤销并查集：只按秩合并 + union 日志，绝不路径压缩。
    undo 必须与 union 严格按 LIFO 配对。"""

    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n
        self.count = n
        self.log = []                    # 每条记录：None（没发生合并）或 (被挂的根, rank 是否因此 +1)

    def find(self, x):
        while self.parent[x] != x:       # 只爬链，不压缩
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            self.log.append(None)        # 占位：撤销时要与之配对
            return False
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        grew = self.rank[ra] == self.rank[rb]
        self.parent[rb] = ra
        if grew:
            self.rank[ra] += 1
        self.count -= 1
        self.log.append((rb, grew))
        return True

    def undo(self):
        """撤销最近一次 union，恢复到它之前的状态。O(1)。"""
        rec = self.log.pop()
        if rec is None:
            return False
        rb, grew = rec
        ra = self.parent[rb]
        self.parent[rb] = rb             # 只需要恢复这一条父指针
        if grew:
            self.rank[ra] -= 1
        self.count += 1
        return True

    def checkpoint(self):
        """记下当前状态的位置，之后可一次性回滚到这里。"""
        return len(self.log)

    def rollback_to(self, mark):
        while len(self.log) > mark:
            self.undo()

    def connected(self, a, b):
        return self.find(a) == self.find(b)


if __name__ == "__main__":
    r = RollbackDSU(6)
    assert r.union(0, 1) and r.union(1, 2) and r.union(3, 4)
    assert r.connected(0, 2) and r.count == 3
    mark = r.checkpoint()
    assert r.union(2, 3) and r.count == 2 and r.connected(0, 4)   # 临时把两团连起来
    r.rollback_to(mark)                  # 回滚：连边「消失」
    assert r.count == 3 and not r.connected(0, 4) and r.connected(0, 2)
    r.undo()                             # 逐条撤销也行（LIFO）
    assert r.count == 4 and r.connected(0, 2) and not r.connected(3, 4)
    r2 = RollbackDSU(2)
    assert r2.union(0, 0) is False and r2.undo() is False   # 占位与撤销配对，状态不变
    print("rollback dsu ok")
```

> [!WARNING]
> 可撤销并查集里绝不能混入路径压缩版 `find`——压缩改写的指针不在撤销日志里，症状是「回滚之后仍然连通」「count 恢复了但连通关系不对」，而且小数据测试全部通过、数据量一大才偶发。规则一句话：可撤销 DSU 的 `find` 只读不改。

代价与用途：`find`、`union` 均 O(log n)（树高上界仍成立），`undo` O(1)，回滚一段 k 条操作的序列 O(k)。撤销必须严格 LIFO——这正是它适配的场景：

- **离线倒序处理删边**：如果操作流里只有删边没有加边，把时间轴整个翻过来，删边全部变成加边，普通并查集就够了；真正需要可撤销的是加删混合。
- **线段树分治**：每条边有存活区间 \[l, r]。对时间轴建线段树，把这条边挂到 O(log T) 个完全覆盖 \[l, r] 的节点上；然后 DFS 这棵树，**进入节点时 union 挂在其上的边，离开节点时逐条 undo**——走到每个叶子时，并查集里恰好是「该时刻存活的全部边」，在叶子上回答查询。总代价 O((E + Q)·log T·log n)，是动态连通性离线问题的标准解法。

再往前还有带时间戳与持久化的变体：给每次合并记时间戳，查询「a、b 在时刻 t 是否连通」时对根上记录的合并时间二分，或用 Kruskal 重构树把合并时刻写到内部节点上（两点连通时刻即它们最近公共祖先的时间戳）。完全持久化（保留所有历史版本可查）可以实现但工程复杂度陡增，实践中通常用离线手段绕开。

## 6. 复杂度对照与实测

先把三种优化组合的理论值钉死（n 个元素、m 次操作）：

| 组合        | 单次最坏     | 平均（实测跳转/次） | 均摊             | 备注                           |
| --------- | -------- | ---------- | -------------- | ---------------------------- |
| 只按秩（或按大小） | O(log n) | ≈ 2        | O(log n)       | 树高上界 `log₂n`，不会更坏，也不会更好      |
| 只路径压缩     | O(n)     | ≈ 1.4      | O(log n)（紧）    | 单次可能踩到刚造好的链；对抗序列下均摊 Θ(log n) |
| 按秩 + 路径压缩 | O(log n) | ≈ 1        | O(α(n)) ≈ O(4) | 理论极限；实测平均每次 find 只跳 1 步      |

理论之外补两个实测。第一个是第 2 节那个退化的极端版：在 10⁶ 个元素上依次 `union(i, i+1)`，只要不按秩，这条 10⁶ 长的链就真的会造出来（压缩也拦不住 union 造链，只能事后压）。实测结果：不按秩时从链底出发的第一次 `find` 要爬满 999,999 步；按秩合并的同一序列里 `find(0)` 只需 0 步——链根本无法形成，整棵树没有任何元素深过一层。这就是「单次最坏 O(n) 对 O(log n)」的实物演示。

第二个实验更接近日常：10⁶ 个元素、10⁶ 次随机 union，再 10⁶ 次随机 find，统计 find 阶段的父指针跳转总次数与耗时（CPython 3.13，普通笔记本，单次运行；复现脚本只需在第 3 节的 DSU 上给 find 加一个跳转计数器）：

```text
rank-only :  1,945,339 hops    0.66 s
compress  :  1,413,901 hops    0.91 s
both      :  1,012,548 hops    0.76 s
```

这张表呈现了一个诚实且重要的现象：**随机负载下，三种组合的差距不大**——随机数据太善良，压缩总是顺手把树越压越平。差距藏在理论保证里：只压缩的均摊 O(log n) 是「存在对抗序列能让它长期保持」的紧界，只按秩的单次 find 永远要爬满树高，而两者都用才有 O(α(n))。为这 3 行代码的差价，换来一个对所有输入序列无条件成立的常数级保证——工程上没有任何理由只写一个。同时注意，摊还复杂度是对操作序列的记账、不是单次承诺，讨论「最坏一次操作多快」时要分清最坏语义与摊还语义（[第 01 篇](01-complexity-analysis.md) 第 2 节）。

## 7. 陷阱清单

**find 写错会死循环。** 不变式要求根自指、其余节点指向根方向。任何绕过 find 的赋值都可能造出「指向别人却回不到根」的环：

```python
parent = [0, 1, 2]
parent[0] = 1                    # 0 的根挂到 1 —— 这步没错
parent[1] = 0                    # 反过来又挂一次：0 → 1 → 0 成环
# 此时 find(0) 会无限循环：while parent[x] != x 永远找不到自指的根
```

> [!CAUTION]
> 死循环的通用来源只有一个：写了 `parent[x] = y` 而 x 不是根。纪律是——union 里**只允许出现 `parent[根] = 根`** 这一形式，根必须来自 `find` 的返回值。`parent[x] = x`（自指）是根的合法状态，不要当成 bug 修掉。

**union 前必须先 find 两个参数。** 正确写法是 `parent[find(a)] = find(b)`。直接写 `parent[a] = b`，等于把一棵子树整棵切下来挂到另一棵树上：连通性悄悄破坏，还可能像上面那样成环。一行之差，症状却是「明明 union 过却查不连通」这类诡异结果。同理，`count` 只能在 union 确认合并成功时减一，忘了先判 `ra == rb` 就减，分量数会一路减成负数。

**rank 是高度上界，不是高度。** 路径压缩之后真实高度大幅下降，rank 不随之更新（更新它既费时又无必要）。两个后果：rank 只能用于合并决策，不能当深度、层数用在别的逻辑里；需要「集合大小」时维护 `size` 数组而不是推算 rank。

**1-based 与 0-based 混用。** 题目编号 1..n，数组却开 `range(n)`，于是 `find(n)` 越界或元素 0 被闲置造成「永远查不通」。约定一个习惯：题目 1-based 就 `parent = list(range(n + 1))`，下标 0 弃用；网格题统一用 `idx = r * cols + c` 编号，绝不再手工加减一。

**可撤销场景误用路径压缩。** 这是 5.3 节 WARNING 的主题：压缩改写的指针不在撤销日志里，回滚后状态悄悄漂移。规则一句话：可撤销 DSU 的 `find` 只读不改。

**并查集不能删除，也不能分裂。** 删边场景用 5.3 节的离线手段；「把一个集合劈成两半」连离线技巧都难覆盖，需要时考虑整体重建或换成真正支持分裂的结构，不要试图在 DSU 里硬做。

## 8. 小结

- 并查集只维护等价类：`union` 声明同类，`find` 返回代表元；删除、枚举成员、顺序、方向、权重都不在接口里——这不全是局限，更是它快的根源：状态只有一个父指针数组，工作只是沿一条向上的路径。
- 心智模型是一片森林，不变式只有一条：沿 `parent` 必达自指的根，同根当且仅当同类；`union` 永远只改根的指针。
- 两个优化封死两个恶化方向：按秩（或按大小）合并把树高钉在 `log₂n`，与输入顺序无关；路径压缩让走过的路不再走。合体后均摊 O(α(n))——实用范围内 α(n) ≤ 4，且已证明不可再降。
- 单用任何一个优化只能停 O(log n)：按秩不缩短历史路径，压缩拦不住 union 造新链。工程结论：两个都写，只差 3 行。
- `union` 返回「是否真的合并了」，这一个布尔值支撑起 Kruskal 判环、岛屿计数、成环检测一整类应用。
- 应用翻译的核心是「编号 + 合并 + （聚合）」：字符串先映射成下标，等价关系翻译成 union；要成员列表就在查询阶段按根聚合一趟。
- 带权并查集给父指针挂相对权（压缩时同步换算），处理除法、汇率、比例账目；扩展域（或模 k 权）处理环状关系推理；可撤销并查集放弃压缩换取 O(1) 回滚，服务离线删边与线段树分治。
- 高频陷阱都源于绕过不变式：赋值前不 find、rank 当真高度、1-based 与 0-based 混用、可撤销里压缩、把 DSU 硬掰去做删除与分裂。

## 9. 练习

**1.** 下面这行 union 错在哪？推演一个具体的执行序列，说明它如何破坏连通性或制造死循环，并给出正确写法。

```python
def union(parent, a, b):
    parent[a] = b
```

> [!TIP]
> 思路`a` 几乎从来不是根。执行 union(1, 2)、union(3, 4) 之后，若再来一次 union(4, 1)：`parent[4] = 1` 把 4 挂到 1 下，而 4 是 {3,4} 的根——{3,4} 整团被改挂在 1 的树下，这部分还算「碰巧连上」；但若随后 union(3, 1) 先 find 得到根 4 再执行 `parent[4] = 1` 尚可，而两次直接赋值 `parent[1] = 3`、`parent[3] = 1` 就会得到 1→3→1 的环，find 永不终止。正确写法 `parent[find(a)] = find(b)`：只动根、根必自指，环在结构上不可能出现。

**2.** 网格 R×C 中，陆地格子分 k 批陆续出现，每批出现后都要回答当前岛屿数。分别估算 DFS 重扫方案与并查集方案的总复杂度，并指出 n = R·C = 10⁶、k = 10⁵ 时两者的差距量级。

> [!TIP]
> 思路DFS 方案：每批到达后重新泛洪统计，O(k·R·C) = 10¹¹ 量级，完全不可行。并查集方案：每块新陆地只与已存在的至多 4 个邻居各做一次 union，总计 O(k·α(R·C)) ≈ 常数倍 k = 10⁵ 量级。差距约 6 个数量级，且并查集代码不比 DFS 长。注意：如果陆地还会消失，两个方案都不行，回到 5.3 节。

**3.** 把食物链问题改成四类动物构成的四元环（A 吃 B、B 吃 C、C 吃 D、D 吃 A）。给出两种实现思路的核心修改，并说明内存倍数。

> [!TIP]
> 思路环长从 3 变 4：方案一，每元素开 4 个域（自身、下一环、跨环、上一环），「x 吃 y」固化 4 条域合并，检查条件同构推广；方案二，带权并查集把权定义为「到根的种类差模 4」，合成运算换成模 4 加法，「x 吃 y」即 species(x) = species(y)+1 (mod 4)。两种方案的内存都是 4n（方案二同 n，但概念上每元素携带一个权值）。核心规律：k 元环关系系统 → k 个域或模 k 权。

**4.** 判断并说明理由：「路径压缩之后必须把 rank 重算成真实高度，否则按秩合并会失效。」

> [!TIP]
> 思路错。按秩合并需要的只是「高度的上界」：压缩只会让真实高度变小，rank 这个旧上界依然成立，等秩合并才 +1 的决策依据不受任何影响。反而重算真实高度需要每次压缩后自底向上修正，代价 O(路径长)，把压缩赚的时间全部还回去。正确认知：rank 在压缩启用后是「合并用的高度戳」，仅此而已。

**5.** 无向图给出 n 个节点和按顺序排列的边列表，要求找出「加入后第一次形成环的那条边」。用并查集写解题思路，并给出复杂度。

> [!TIP]
> 思路逐条边做 `union(u, v)`：首次返回 False 的那条边，它的两端在加入前就已连通，正是第一条成环边，直接返回。复杂度 O(E·α(E)) ≈ O(E)。这个模式就是 4.2 节 Kruskal 跳环逻辑的独立用法：union 的返回值是免费的判环器。

**6.** 线段树分治（5.3 节）中，为什么每条存活期为 \[l, r] 的边只会被挂到 O(log T) 个线段树节点上？据此推导整个算法的总复杂度。

> [!TIP]
> 思路线段树的标准性质：任意区间可以分解为 O(log T) 个互不重叠的节点的并（递归分解 \[l, r] 时每层至多产生 2 个「部分覆盖」的分段）。每条边挂到这些节点上，进入节点时 union 一次、离开时 undo 一次，故 union/undo 总次数 O(E·log T)，单次 O(log n)（无压缩按秩 DSU）；叶子上的查询共 Q 次，每次 O(α(n))。总计 O((E·log T + Q)·log n)。这就是「删除不便 → 让删除在回溯时自动发生」的离线范式。
