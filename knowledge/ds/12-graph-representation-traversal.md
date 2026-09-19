---
title: 图（上）：表示方法与两种遍历
order: 12
tags: 图, 邻接表, DFS, BFS, 拓扑排序
summary: 图是最一般的结构：稀疏与稠密决定存储选型，DFS 与 BFS 两种 O(n+m) 遍历支撑判环、连通、无权最短路、多源与双向搜索、拓扑排序，以及「状态即节点」的通用搜索模板。
---

链表是一对一，树是一对多，图把最后这条限制也拆掉了：任何两个节点之间都可以有边，环、汇聚、双向依赖从此全部合法。凡是「关系」本身成为难点的问题——社交网络、任务依赖、地图导航、状态转移——图都是恰好合适的模型。但自由有代价：怎么存直接决定空间与速度，怎么走决定你能回答哪类问题。这一篇把两件事讲透：图的四种内存表示与取舍，以及 DFS 与 BFS 两种 O(n + m) 的遍历——判环、连通性、无权最短路、拓扑排序全是它们的副产品。带权最短路与最小生成树在[第 13 篇](13-graph-shortest-path-mst.md)。

## 1. 图：把「任意连接」也装进数据结构

### 1.1 线性表与树都是图的特例

把前几篇的结构放进同一张图里看：数组按位置相邻，链表串成一条线，树一对多且不许成环。换成图的术语，这些限制全部是对**度数**（degree，节点连出的边数）和**环**的限制：

```text
线性表:  A -- B -- C -- D      度 <= 2，一对一
树:           A                恰好 n-1 条边、无环、连通：一对多
            /   \
           B     C
图:      A --- B                度不限：有环 A-B-C-A，
         \   /                  有汇聚点 D、孤立点 E：多对多
          \ /
           C --- D        E
```

所以学图不是学全新结构，而是把限制逐条拿掉：树上根到每点路径唯一，树的遍历（[第 07 篇](07-binary-tree-traversal.md)）不需要访问标记；图里路径不唯一，`visited` 标记是第一件必须补上的事。同样，线性结构上「下一个是谁」是确定的，图上「下一步去哪」要靠遍历策略回答——DFS 和 BFS 就是仅有的两种基本回答。

### 1.2 术语一次说准

- **有向图**（directed graph）与**无向图**（undirected graph）：边有没有方向。关注是有向的，好友是无向的；有向图区分**入度**（in-degree）与**出度**（out-degree），无向图只说度。
- **握手定理**（handshake lemma）：无向图度数之和 = 2 倍边数，每条边给两个端点各贡献 1 度；有向图则是出度之和 = 入度之和 = 边数。这个等式是本篇两处关键论证的底座：边数上界、第 5 节的 O(n + m) 证明。
- **路径**（path）：节点序列 v0, v1, …, vk，相邻两点有边。**简单路径**（simple path）：不重复经过节点。**回路/环**（cycle）：起点终点相同的路径。两个麻烦制造者：**自环**（self-loop）与**重边**（parallel edges），它们决定输入有脏数据时各表示法的健壮性（2.6 节）。
- **连通**（connected）：无向图任意两点可达，极大连通子图叫**连通分量**（connected component）；有向图「互相可达」叫**强连通**，极大部分叫**强连通分量**（SCC）。**二分图**（bipartite graph）：节点分成两半、所有边跨半（用户—商品、演员—电影），判定用 BFS 交替染两色——图中有奇环就绝不是二分图。
- **DAG**（directed acyclic graph，有向无环图）：依赖、先修、构建顺序的天然形状，是拓扑排序（第 7 节）的前提。
- **带权图**（weighted graph）：边带数值。权的含义由问题给出：距离、代价、容量、相似度。注意「相似度越大越好」与「距离越小越好」方向相反，套最短路模板前必须先统一方向（如取倒数），否则推荐系统会推荐「最不受欢迎」的物品。

### 1.3 稀疏与稠密：一切存储决策的分水岭

n 个节点的无向图最多 `n(n-1)/2` 条边。**稠密图**（dense graph）指边数 m 逼近 n²，**稀疏图**（sparse graph）指 m 与 n 同阶。这个区分直接决定存储选型：邻接矩阵按 n² 付费，稀疏图上 99.9% 的格子是浪费；邻接表按 m 付费，稠密图上自己也会膨胀到 n²。拿到任何图问题，第一个要问的永远是「m 多大」。现实世界几乎全是稀疏图：10⁸ 用户的社交网络、人均好友几百，m 约 10¹⁰ 而 n² = 10¹⁶，差 6 个数量级；路网中路口的平均连接数不过 3\~4。所以**邻接表是默认，邻接矩阵是例外**。

## 2. 存储：四种表示，一张对照表

### 2.1 邻接矩阵：用 O(n²) 空间换 O(1) 判边

n×n 数组，`mat[u][v]` 存 1（无权）或权值，无边用特殊值。空间 Θ(n²) 与边数无关；判边 O(1)；遍历 u 的邻居要扫一整行，O(n)。

### 2.2 邻接表：三种子容器的取舍

每个节点挂一个「邻居容器」，容器类型是真实的工程决策：

| 子容器            | 判边     | 查权值    | 遇到重边     | 适用                  |
| -------------- | ------ | ------ | -------- | ------------------- |
| `list[(v, w)]` | O(deg) | O(deg) | 照单全收     | DFS/BFS/拓扑等遍历型算法的默认 |
| `set`          | O(1)   | 拿不到    | 吞掉（度数算错） | 只关心「有没有边」的判重型场景     |
| `dict {v: w}`  | O(1)   | O(1)   | 后到权值覆盖   | 判边同时要权值，如稀疏矩阵建表     |

```python
# 邻接矩阵 + 邻接表三种子容器。无向带权图：
edges = [(0, 1, 4), (0, 2, 1), (2, 3, 7), (1, 3, 2)]
n = 4
INF = float("inf")
mat = [[INF] * n for _ in range(n)]
for i in range(n): mat[i][i] = 0
for u, v, w in edges:
    mat[u][v] = w
    mat[v][u] = w                     # 无向图：两个方向都要写
assert mat[0][1] == 4 and mat[1][0] == 4 and mat[0][3] == INF

adj = [[] for _ in range(n)]          # 不能写成 [[]] * n（n 个引用指向同一个列表）
for u, v, w in edges:
    adj[u].append((v, w))
    adj[v].append((u, w))
assert sorted(adj[0]) == [(1, 4), (2, 1)]

adj_set = [set() for _ in range(n)]   # O(1) 判边，但重边被吞、权值拿不到
for u, v, _ in edges:
    adj_set[u].add(v)
    adj_set[v].add(u)
assert 2 in adj_set[0] and 3 not in adj_set[0]

adj_w = [dict() for _ in range(n)]    # 判边 + 权值一步到位，重边权值被覆盖
for u, v, w in edges:
    adj_w[u][v] = w
    adj_w[v][u] = w
assert adj_w[0][2] == 1
```

邻接矩阵还有一层被低估的价值：**矩阵运算视角**。矩阵自乘 k 次后，`mat^k[u][v]` 是「从 u 走 k 步到 v 的走法数」；传递闭包（Warshall）与全源最短路（Floyd，[第 13 篇](13-graph-shortest-path-mst.md)）也以矩阵为底座——表示法与算法是配套的。

### 2.3 边集数组与复杂度对照表

只留一个数组 `edges = [(u, v, w), ...]`，不建「从点找边」的索引。空间 O(m) 最省，但找 u 的邻居要全扫 O(m)。价值在于算法本身要**按边处理**：Kruskal 把边排序后贪心，Bellman-Ford 每轮松弛全部边（都在[第 13 篇](13-graph-shortest-path-mst.md)），边集数组是它们的自然形态而非妥协；它也常作为输入格式，读进来再转成邻接表或 CSR。

| 维度        | 邻接矩阵          | 邻接表                          | 边集数组                      | CSR（2.4 节）              |
| --------- | ------------- | ---------------------------- | ------------------------- | ----------------------- |
| 空间        | O(n²)         | O(n + m)                     | O(m)                      | O(n + m)                |
| 判边 (u, v) | O(1)          | O(deg)（list）/ O(1)（set/dict） | O(m)                      | O(deg)，段内有序可 O(log deg) |
| 遍历 u 的邻居  | O(n)          | O(deg)                       | O(m) 全扫                   | O(deg)，连续内存             |
| 遍历全图      | O(n²)         | O(n + m)                     | O(m)（按边型算法）               | O(n + m)                |
| 加一条边      | O(1)          | O(1)                         | O(1) 摊还                   | 需整体重建                   |
| 适用场景      | 稠密图、频繁判边、矩阵视角 | 通用默认                         | Kruskal、Bellman-Ford、流式输入 | 静态图、性能敏感的分析引擎           |

### 2.4 CSR：把邻接表压平成两个数组

邻接表的软肋在内存布局：n 个独立容器散落在堆上，遍历时指针跳来跳去（[第 01 篇](01-complexity-analysis.md)第 3 节的访存分析）。**CSR**（compressed sparse row，压缩稀疏行）把所有邻居压进一个连续数组，另用偏移数组标记每段起点——节点 u 的邻居就是 `neighbor[offset[u]:offset[u+1]]`：

```python
def build_csr(n, edges):
    """两趟扫描把边列表压成 CSR：offset[n+1] 与 neighbor[2m] 两个数组。
    节点 u 的邻居存放在 neighbor[offset[u]:offset[u+1]] 这段连续区间。"""
    offset = [0] * (n + 1)
    for u, v in edges:
        offset[u + 1] += 1            # 第一趟：统计每个节点的度
        offset[v + 1] += 1            # 无向图：反向也计一次
    for u in range(n):
        offset[u + 1] += offset[u]    # 前缀和 → 每段的起始下标
    neighbor = [0] * (2 * len(edges))
    fill = offset[:]                  # fill[u]：u 的下一个写入位置
    for u, v in edges:
        neighbor[fill[u]] = v
        fill[u] += 1
        neighbor[fill[v]] = u
        fill[v] += 1
    return offset, neighbor

edges = [(0, 1), (0, 2), (2, 3), (1, 3)]
offset, neighbor = build_csr(4, edges)
assert offset == [0, 2, 4, 6, 8]
assert neighbor[offset[0]:offset[1]] == [1, 2]    # 节点 0 的邻居（按插入序）
assert neighbor[offset[3]:offset[4]] == [2, 1]    # 节点 3
```

两趟扫描（数度数 → 前缀和 → 填充）共 O(n + m)，本质是一次计数排序。换来三样对性能致命的东西：一次大分配替代 n 次小分配；遍历邻居变成顺序扫数组，缓存行次次命中；数据结构只有两个大数组，序列化、并行切片都容易。代价是**静态**——加边要整体重建，属于「建一次、查千万次」的离线场景。邻接表对 CSR 正是链表对数组的同款取舍（[第 02 篇](02-array-dynamic-array.md)、[第 03 篇](03-linked-list.md)）。

> [!NOTE]
> CSR 就是稀疏矩阵的标准格式：`scipy.sparse` 的 `csr_matrix`、图计算框架 GraphBLAS、多数高性能图引擎内部都是它。networkx 用 dict of dict 表示图，灵活但慢——原型用它，上规模导出边表转 CSR。

### 2.5 链式前向星：三个数组模拟链表

竞赛圈经典写法，介于邻接表与 CSR 之间：用 `head/nxt/to` 三个数组模拟「每个节点一条边链表」，既支持 O(1) 在线加边（CSR 做不到），又没有任何动态分配（邻接表做不到）：

```c
#include <stdio.h>
#include <assert.h>
#define NMAX 8
#define MMAX 16

/* 链式前向星：head/next/to 三个数组，模拟「每个节点一条边链表」 */
static int head[NMAX];   /* head[u]：u 的第一条边的下标，-1 表示无边 */
static int nxt[MMAX];    /* nxt[e]：与边 e 同起点的下一条边 */
static int to[MMAX];     /* to[e]：边 e 的终点 */
static int cnt;          /* 已用边数；成对加边时 e^1 恰为反向边 */

static void add_edge(int u, int v) {  /* 有向边 u -> v，头插 O(1) */
    to[cnt] = v;
    nxt[cnt] = head[u];
    head[u] = cnt++;
}
static void add_undirected(int u, int v) {
    add_edge(u, v);                   /* 两条有向边拼一条无向边 */
    add_edge(v, u);
}
int main(void) {
    for (int i = 0; i < NMAX; i++) head[i] = -1;
    add_undirected(0, 1);
    add_undirected(0, 2);
    add_undirected(2, 3);
    int deg0 = 0;                     /* 遍历 u 的邻居：沿 head -> nxt 走链 */
    for (int e = head[0]; e != -1; e = nxt[e]) {
        assert(to[e] == 1 || to[e] == 2);
        deg0++;
    }
    assert(deg0 == 2);
    assert(head[4] == -1);            /* 孤立节点没有边 */
    assert(cnt == 6);                 /* 3 条无向边 = 6 条有向边 */
    assert((0 ^ 1) == 1 && (2 ^ 1) == 3);  /* 成对加边：e 与 e^1 互为反向边 */
    printf("forward star ok, cnt=%d\n", cnt);
    return 0;
}
```

三个工程要点：加边是**头插**，同一起点的边按加入的逆序排列；整张图只有三个大数组，`MMAX` 开够（无向图乘 2）就永远不碰 malloc；从 0 开始成对加边时，第 e 号边与 `e^1` 号边互为反向边——这条位运算性质在需要「沿反向边回退」的算法（网络流的残量边）里是标准技巧。对 CSR 的优势是增量加边，劣势是同起点的边在内存中不相邻，遍历仍有下标跳转。

> [!WARNING]
> 前向星最常见的崩溃是边数组开小：无向图必须按 2m 开 `MMAX`，漏乘 2 就是越界写内存——C 里它往往不报错，而是默默破坏别的数组。CSR 的 `neighbor` 数组同理是 `2 * len(edges)`。

### 2.6 建图的工程细节

1. **无向图要双向加边**。邻接表、CSR、前向星都把 (u, v) 与 (v, u) 各存一份，边数组按 2m 开。忘了就是「单向僵尸图」，连通性、度数全错。
2. **重边**。邻接表照单全收，多数算法天然正确（拓扑排序里入度加几次就减几次）；`set` 吞掉重边，度数随之出错；矩阵互相覆盖，需要时改存计数或最小权。最短路遇重边不必特判——松弛自动取更小的。
3. **自环**。无向图里自环给端点贡献 2 度（握手定理照常成立）；邻接表里 u 的邻居含 u 自己，`visited` 检查天然免疫；判环时先想清楚自环算不算环（通常算）。
4. **0-based 与 1-based**。题目常给 1..n，代码习惯 0..n−1。两种纪律二选一：读入统一减 1，或开 n+1 的数组放弃 0 号格子。都对，**混用必错**——图论题 off-by-one 的事故大户。
5. **权值与中间量用 64 位整数**。10⁵ 条边、单边权 10⁹ 的路径和能到 10¹⁴，远超 int32 的约 2.1×10⁹。C 里距离数组、优先队列 key、松弛中间量全部 `long long`；边数同理，`n(n-1)/2` 在 n = 10⁵ 时约 5×10⁹。Python 整数无此忧。

## 3. DFS：一条路走到底

**DFS**（depth-first search，深度优先搜索）：沿一条路不断深入，走不动了退回上个岔路口换条路。树的先序遍历就是 DFS 在树上的样子（[第 07 篇](07-binary-tree-traversal.md)）；图唯一的新麻烦是「会绕回来」，所以要有访问标记，每个节点一生只处理一次。

### 3.1 递归版、迭代版与标记时机

递归版把调用栈当栈，最短最好写；代价是递归深度等于最长简单路径，10⁵ 节点的链状图会爆栈（第 9 节）。显式栈版是工程默认。但迭代版藏着一个多数教程不讲的坑——**什么时候标记 visited**：

```python
def dfs_recursive(adj, s):
    """递归 DFS：调用栈就是那根「栈」，返回先序访问序列。"""
    visited = [False] * len(adj)
    order = []
    def go(u):
        visited[u] = True             # 进入即标记：每个点只进一次
        order.append(u)
        for v in adj[u]:
            if not visited[v]:
                go(v)
    go(s)
    return order

def dfs_iterative(adj, s):
    """迭代 DFS（显式栈，入栈时标记）。邻居逆序入栈，让先声明的邻居先被访问。"""
    visited = [False] * len(adj)
    order = []
    stack = [s]
    visited[s] = True                 # 入栈时标记：每个点最多进栈一次
    while stack:
        u = stack.pop()
        order.append(u)
        for v in reversed(adj[u]):
            if not visited[v]:
                visited[v] = True
                stack.append(v)
    return order

def dfs_two_phase(adj, s):
    """两阶段迭代 DFS：每个节点压栈两次（第二阶段是哨兵），
    精确复现递归版的先序与后序——pre 即发现时间，post 即完成时间。"""
    visited = [False] * len(adj)
    pre, post = [], []
    stack = [(s, False)]              # (节点, 邻居是否已全部处理)
    while stack:
        u, done = stack.pop()
        if done:
            post.append(u)            # 第二次出栈 = 完成时刻
            continue
        if visited[u]:
            continue                  # 同一节点可能被压多次，跳过
        visited[u] = True
        pre.append(u)                 # 第一次出栈 = 发现时刻
        stack.append((u, True))
        for v in reversed(adj[u]):
            if not visited[v]:
                stack.append((v, False))
    return pre, post

edges = [(0, 1), (0, 3), (1, 4), (3, 4), (4, 6), (3, 5)]
adj = [[] for _ in range(7)]
for u, v in edges:
    adj[u].append(v)
    adj[v].append(u)
rec = dfs_recursive(adj, 0)
it = dfs_iterative(adj, 0)
assert rec == [0, 1, 4, 3, 5, 6]      # 递归版的访问序
assert it == [0, 1, 4, 6, 3, 5]       # 入栈标记版：完整遍历但顺序不同！
assert rec != it
pre, post = dfs_two_phase(adj, 0)
assert pre == rec                     # 两阶段版精确复现递归先序
assert post == [5, 3, 6, 4, 1, 0]     # 后序：子树总是先于父节点完成
```

两种标记时机都是正确的完整遍历，区别在别处。**入栈时标记**（`dfs_iterative`）：每点最多进栈一次，栈深 O(n)；但访问顺序**可能与递归版不同**——上面的断言就是证明，因为入栈瞬间把邻居「预订」了，即使递归版会在更深处先访问到它。只做连通性、计数、洪泛时无妨；依赖精确 DFS 序的算法不能用这版。**出栈时标记**（`dfs_two_phase`）：入栈不查重，出栈时发现已访问就跳过；同一个点可能被压多次（最坏栈深 O(m)），换来的是能精确复现递归的先序与后序。

### 3.2 时间戳与边的四分类

DFS 给每个节点记两个时间：**发现时间** `pre[u]`（第一次进入）与**完成时间** `post[u]`（所有后代处理完毕），`dfs_two_phase` 的两个序列就是。核心性质：**u 是 v 的祖先，当且仅当区间 `[pre[v], post[v]]` 完整落在 `[pre[u], post[u]]` 内**；无祖先关系的两点区间互不相交——整棵 DFS 树可读成一串嵌套括号。有向图上，DFS 把所有边分成四类（对照时间戳即可判定）；无向图只有树边与后向边，因为每条无向边被两端各「看见」一次，从晚访问的一端看过去对方必然是祖先——这个不对称正是两类图判环方法不同的根源。四分类也不是理论装饰：拓扑排序的逆后序（7.2 节）、强连通分量、割点与桥，全部建立在「灰色 = 还在栈上」与后向边判定之上。

| 类型                | 判定               | 意义         |
| ----------------- | ---------------- | ---------- |
| 树边（tree edge）     | 邻居是白的，顺着它走下去     | DFS 树的骨架   |
| 后向边（back edge）    | 指向灰色的祖先（见 3.3 节） | 存在后向边 ⇔ 有环 |
| 前向边（forward edge） | 指向已完成的非直接后代      | 跨代捷径       |
| 横叉边（cross edge）   | 指向已完成的另一棵子树      | 子树间连接      |

### 3.3 判环：三色标记与 parent 的正确用法

「遇到访问过的节点就算有环」在**有向图上完全错误**：菱形 A→B、A→C、B→D、C→D 里 D 被到达两次，却没有环。正确条件是「指向**当前递归栈上**的节点」——三色标记法：白 0 未访问、灰 1 在递归栈上、黑 2 已完成，只有指向灰色的边（后向边）才成环。

```python
def has_cycle_directed(adj):
    """有向图判环：三色标记。指向「递归栈上的灰节点」的后向边 = 有环。"""
    WHITE, GRAY, BLACK = 0, 1, 2
    color = [WHITE] * len(adj)
    def go(u):
        color[u] = GRAY
        for v in adj[u]:
            if color[v] == GRAY:      # 指回递归栈上的祖先
                return True
            if color[v] == WHITE and go(v):
                return True
        color[u] = BLACK              # 所有后代处理完，u 出栈变黑
        return False
    return any(go(u) for u in range(len(adj)) if color[u] == WHITE)

def has_cycle_undirected(n, edges):
    """无向图判环：跳过「来时的那条边」（记边编号，不是记 parent 节点），
    遇到其他已访问邻居即为环。重边也能正确判出。"""
    adj = [[] for _ in range(n)]
    for i, (u, v) in enumerate(edges):
        adj[u].append((v, i))
        adj[v].append((u, i))
    visited = [False] * n
    for s in range(n):
        if visited[s]:
            continue
        visited[s] = True
        stack = [(s, -1)]             # (节点, 来时的边编号)
        while stack:
            u, in_edge = stack.pop()
            for v, eid in adj[u]:
                if eid == in_edge:
                    continue          # 只跳过来时那一条边，不是连向父节点的全部边
                if visited[v]:
                    return True
                visited[v] = True
                stack.append((v, eid))
    return False

diamond = [[1, 2], [3], [3], []]      # D 被看到两次，但没有环
assert not has_cycle_directed(diamond)
assert has_cycle_directed([[1], [2], [0]]) and has_cycle_directed([[0]])   # 环与自环
assert not has_cycle_undirected(4, [(0, 1), (1, 2), (2, 3)])
assert has_cycle_undirected(3, [(0, 1), (1, 2), (2, 0)])
assert has_cycle_undirected(2, [(0, 1), (0, 1)])      # 重边 = 2 元环，记 parent 节点会漏判
assert has_cycle_undirected(1, [(0, 0)])
```

无向图不需要三色：不存在前向边与横叉边，只需排除「来时那条边」。但排除的对象是**边**而不是 parent 节点——两条 u−v 平行边构成 2 元环，从 v 看 u 固然是 parent，可第二条边指向的还是 u，按节点跳过就漏判了。三色的迭代版也不难：把「（节点， 邻居迭代器）」压进显式栈，迭代器耗尽时出栈变黑，等价于递归的返回时刻——正是 3.1 节两阶段思路的变体，大图判环应当用它避免爆栈。

> [!CAUTION]
> 判环的双胞胎错误，方向相反：无向图判环**忘了排除 parent**——相邻两点互指对方是「已访问的邻居」，任何一条边都被误报成环；有向图判环**误用无向方法**——菱形里的汇聚点被误报成环。另外，只判断连通性这类不需要区分环的问题，用并查集（[第 11 篇](11-union-find.md)）逐边合并同样可行，且不用写遍历。

## 4. BFS：按层扩散

**BFS**（breadth-first search，广度优先搜索）把栈换成队列：先发现的先处理，遍历像水波从源点一圈圈往外推——第 0 层是源点，第 k 层是恰好 k 步可达的节点。

### 4.1 队列、层次与无权最短路

队列「先进先出」这个平淡的性质恰好给出无权图的最短路。`dist` 数组兼作访问标记，只在**首次入队**时写一次：

```python
from collections import deque

def bfs_shortest(adj, s):
    """无权图单源最短路。dist[v] 在 v 首次入队时写定，此后不再改；
    dist 同时充当访问标记。"""
    n = len(adj)
    dist = [-1] * n                   # -1 = 未到达
    parent = [-1] * n
    dist[s] = 0
    q = deque([s])
    while q:
        u = q.popleft()
        for v in adj[u]:
            if dist[v] == -1:         # 首次到达即最短
                dist[v] = dist[u] + 1
                parent[v] = u
                q.append(v)
    return dist, parent

adj = [[1, 2], [3], [3], [], []]      # 节点 4 孤立
dist, parent = bfs_shortest(adj, 0)
assert dist == [0, 1, 1, 2, -1]
assert parent[3] == 1                 # 3 是被 1 发现的，沿 parent 回溯即最短路径
```

`parent` 记下「我是被谁发现的」，从终点回溯就是一条具体的最短路径。队列用 `collections.deque`，`popleft()` 是 O(1)；用 `list.pop(0)` 当队列是每次 O(n) 的隐蔽灾难（[第 05 篇](05-queue-deque.md)）。

### 4.2 「首次到达即最短」的证明要点

这不是直觉，是可以三步证死的性质。记 `d*(x)` 为 s 到 x 的真实最短距离：

1. **不变式（队列单调性）**：任意时刻，队列中各节点的 dist 从头到尾非降，且首尾相差不超过 1。归纳可证：初始队列只有 s（dist 0）；此后每次操作要么出队 dist = d 的头部，要么向队尾追加 dist = d + 1 的新节点，都不破坏非降性与「差不超过 1」。
2. **推论（按层出队）**：出队序列的 dist 非降，所有 dist = d 的节点先于所有 dist = d+1 的出队；并且真实距离更小的节点一定更早入队、更早出队——否则队列会出现超过 1 的「断层」，与不变式矛盾。
3. **反证（写入值即真值）**：对每次「入队写入」做归纳。设 u 出队（归纳保证 `dist[u] = d*(u)`）并给未标记的 v 写入 `dist[u] + 1`。若这个值大于 `d*(v)`：沿 v 的最短路回退一步得 w，`d*(w) = d*(v) - 1 < d*(u)`；由第 2 步 w 比 u 先出队，而 w 出队时会扫描每个邻居——v 当时还未标记（否则轮不到 u 来写它）——所以 v 当时就会被以 `d*(w) + 1 = d*(v)` 写入，矛盾。

于是每个节点的 dist 恰在首次入队时被写成真实最短距离，此后不再改——「首次到达即最短」。注意两个前提：**每条边等价**（都是 1 步）与**先进先出**。破坏任何一个结论就失效：双向 BFS 要靠整层扩展把前提补回来（4.4 节），带权图则要换算法——第 13 篇的 Dijkstra 按「当前累计代价最小」出队，而不是按「步数最少」。

### 4.3 多源 BFS：把所有起点一起入队

「每个 1 到最近的 0 的距离」「每个格子到最近的出口」——对每个 1 单独跑 BFS 是 O((nm)²)。多源 BFS 的答案朴素得惊人：**把所有源点一起塞进初始队列**，其余一字不改：

```python
from collections import deque

def nearest_zero(grid):
    """多源 BFS：01 矩阵中每个格子到最近 0 的距离。
    所有 0 距离 0，一起入队——等价于加一个连向它们的超级源点。"""
    R, C = len(grid), len(grid[0])
    dist = [[-1] * C for _ in range(R)]
    q = deque()
    for r in range(R):
        for c in range(C):
            if grid[r][c] == 0:
                dist[r][c] = 0
                q.append((r, c))      # 所有源点同层入队
    while q:
        r, c = q.popleft()
        for nr, nc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
            if 0 <= nr < R and 0 <= nc < C and dist[nr][nc] == -1:
                dist[nr][nc] = dist[r][c] + 1
                q.append((nr, nc))
    return dist

grid = [[0, 0, 0],
        [0, 1, 0],
        [1, 1, 1]]
assert nearest_zero(grid) == [[0, 0, 0], [0, 1, 0], [1, 2, 1]]
assert nearest_zero([[1, 1], [1, 1]]) == [[-1, -1], [-1, -1]]   # 没有任何 0
```

为什么对？想象虚拟的**超级源点** S 向所有真实源点各连一条代价为 0 的边——多源 BFS 就是从 S 出发的单源 BFS，而 4.2 节的证明不关心源点有几个，只关心队列单调性。复杂度 O(nm)，每个格子进出队列各一次。

### 4.4 双向 BFS：从两端向中间挖

最短路只问「s 到 t」一个对时，单向 BFS 会把以 s 为心、半径 d 的整个球扫一遍，约 `b^d` 个节点（b 平均分支数）。双向 BFS 从两端同时按层扩散，各扩约 d/2 层相遇：`O(b^d)` 降到 `O(2 * b^(d/2))`。b = 10、d = 6 时是 10⁶ 对 2×10³，500 倍；d = 10 时 5 万倍——单词接龙这类状态空间里，这就是「能跑」与「跑不完」的差距。

```python
from collections import deque

def bidirect_bfs(adj, s, t):
    """双向 BFS：返回 (最短距离, 两侧访问过的节点总数)，不可达距离为 -1。
    要点：①每次扩展较小的一侧；②整层扩展；③整层结束后取最小相遇和——
    同一层里先碰到的交汇点未必给出最短路。"""
    if s == t:
        return 0, 1
    dist = [{s: 0}, {t: 0}]           # 两侧各自的 dist（兼访问标记）
    qs, qt = deque([s]), deque([t])
    while qs and qt:
        if len(qs) <= len(qt):        # 扩展较小的一侧：复杂度保证的关键
            q, mine, other = qs, dist[0], dist[1]
        else:
            q, mine, other = qt, dist[1], dist[0]
        level = mine[q[0]]            # 队列里全是同一层的节点
        best = -1
        for _ in range(len(q)):
            u = q.popleft()
            for v in adj[u]:
                if v in mine:
                    continue
                mine[v] = level + 1
                if v in other:        # 与对侧相遇：记录候选
                    d = level + 1 + other[v]
                    if best == -1 or d < best:
                        best = d
                q.append(v)
        if best != -1:                # 整层扫完再返回
            return best, len(dist[0]) + len(dist[1])
    return -1, len(dist[0]) + len(dist[1])

# 深 12 的完全二叉树，从最左叶走到最右叶
DEPTH = 12
n = 2 ** (DEPTH + 1) - 1
tree = [[] for _ in range(n)]
for i in range(1, n):
    tree[(i - 1) // 2].append(i)
    tree[i].append((i - 1) // 2)      # 无向：两个方向都要加边
s, t = 2 ** DEPTH - 1, n - 1
d2, v2 = bidirect_bfs(tree, s, t)
assert d2 == 2 * DEPTH                # 路径经过根，长 24
assert v2 == 380                      # 双向只访问 380 个节点；单向 BFS 要访问全部 8191 个
```

三个实现要点都不能省。其一，**每次扩展较小的一侧**，两侧工作量才平衡，复杂度保证来自这里。其二，**整层扩展、整层结束后再检查相遇**：同一层里先碰到的交汇点未必给出最短路（同层不同交汇点的对侧距离可能不同），逐层取最小和才严格等于答案。其三，适用条件：**起终点都已知**；**转移可逆**（无向图，或像改字母那样可逆的状态转移——只能单向走的谜题对侧根本扩不动）；**每步等价**。三者缺一，退回单向。

## 5. 两种遍历对比：同一个 O(n + m)，不同的世界

DFS 与 BFS 是同一骨架换一个容器：维护容器，取出节点，放进未访问的邻居。全部区别就在那个容器：

| 维度    | DFS                                | BFS                             |
| ----- | ---------------------------------- | ------------------------------- |
| 容器    | 栈（递归调用栈或显式栈，[第 04 篇](04-stack.md)） | 队列（[第 05 篇](05-queue-deque.md)） |
| 扩散方式  | 一条路走到底，碰壁回退换路                      | 按层推进，波纹扩散                       |
| 顺序性质  | 先序/后序携带时间戳，祖先关系明确                  | 节点按 dist 严格分层出队                 |
| 擅长的任务 | 存在性、连通性、有向判环、拓扑序、回溯枚举              | 无权最短路、层次/直径、多源扩散、二分图判定          |
| 空间    | O(n)，递归版有爆栈风险                      | O(n)，峰值是最宽的一层                   |

两者都是 O(n + m)，而且**不是** O(n·m)——这笔账只靠握手定理：每个节点至多入容器一次（`visited` 在入之前就标记），出容器时扫一遍邻接表，扫邻居的总量是全部度数之和 `Σ deg = 2m`，加上每节点常数就是 O(n + m)。写成「每个节点全图找一遍邻居」（循环里对每个点 `v in 边列表`）才是 O(n·m)；用邻接矩阵遍历则是 O(n²)，对稀疏图是纯浪费。**复杂度结论与存储方式绑定**：O(n + m) 只属于邻接表与 CSR。

## 6. 状态即节点：一个模板打天下

### 6.1 把问题翻译成图

题目直接给「n 个点 m 条边」的是少数，更多的题把图藏起来了：**把一个「状态」当节点，把「一步操作」当边**——这是刷题与实战里最值钱的洞察。翻译一旦成立，最短操作次数就是无权最短路（BFS），可达性就是连通性（DFS/BFS），方案回溯就是 DFS。隐式图不建邻接表——用 `neighbors(state)` 现算邻居；`visited` 换成哈希集合（[第 06 篇](06-hash-table.md)），因为状态往往是字符串或元组。总复杂度 = 状态数 × 单状态转移代价，翻译完先估这两个数：

| 问题   | 节点（状态）     | 边（一步转移）    | 求什么      |
| ---- | ---------- | ---------- | -------- |
| 网格孤岛 | 格子 (r, c)  | 上下左右相邻格子   | 连通块个数    |
| 单词接龙 | 一个单词       | 改一个字母且仍在词典 | 最少变换步数   |
| 转盘锁  | 4 位拨号串     | 8 种拨动，避开死锁 | 最少步数     |
| 八数码  | 3×3 棋盘布局   | 空格与相邻交换    | 最少步数     |
| 状态压缩 | 位掩码（已访问集合） | 再选一个元素     | 可达性/最短步数 |

### 6.2 同一个模板的三个问题

一个 `bfs_steps` 模板加若干「邻居函数」，覆盖三类典型题。4.3 节的 `nearest_zero` 其实已经是模板的一次应用：网格就是「状态 = (r, c)、转移 = 四邻」的隐式图，把求距离换成洪泛计数就是孤岛问题。下面看两个字符串状态的例子，与网格共用同一个骨架：

```python
from collections import deque
import string

def bfs_steps(start, goal, neighbors, blocked=frozenset()):
    """状态搜索模板：状态是节点，neighbors(state) 现算一步转移。
    返回最少步数，不可达返回 -1。起点被封死也算失败。"""
    if start in blocked:
        return -1
    if start == goal:
        return 0
    visited = {start}                 # 入队即标记（6.3 节的反例说明为什么）
    q = deque([start])
    steps = 0
    while q:
        steps += 1
        for _ in range(len(q)):       # 一次处理一整层
            u = q.popleft()
            for v in neighbors(u):
                if v in visited or v in blocked:
                    continue
                if v == goal:
                    return steps
                visited.add(v)        # 标记发生在入队时，不是出队时
                q.append(v)
    return -1

# 例一：单词接龙——状态 = 单词，转移 = 改一个字母（隐式建图，不存任何边）
def word_ladder(begin, end, words):
    words = set(words)
    def nbr(w):
        for i in range(len(w)):
            for ch in string.ascii_lowercase:
                if ch != w[i]:
                    x = w[:i] + ch + w[i + 1:]
                    if x in words:
                        yield x
    return bfs_steps(begin, end, nbr)

# 例二：转盘锁——状态 = 4 位拨号串，转移 = 8 种拨动，死锁状态不可进入
def open_lock(deadends, target):
    def nbr(s):
        for i in range(4):
            for d in (-1, 1):
                x = (int(s[i]) + d) % 10
                yield s[:i] + str(x) + s[i + 1:]
    return bfs_steps("0000", target, nbr, blocked=set(deadends))

assert word_ladder("hit", "cog", ["hot", "dot", "dog", "lot", "log", "cog"]) == 4   # hit→hot→dot→dog→cog 共 4 步转移（LeetCode 127 按单词个数口径报 5）
assert word_ladder("hit", "cog", ["hot", "dot", "dog", "lot", "log"]) == -1
assert open_lock(["0201", "0101", "0102", "1212", "2002"], "0202") == 6
assert open_lock(["0000"], "8888") == -1           # 起点本身是死锁
```

两个例子都是「状态串当节点、转移现算、根本不建图」；转盘锁的 `blocked` 是「死锁状态等价于删点」，模板一个参数就吸收了。数网格连通块（洪泛填充）则是把模板的队列换成栈：同一个骨架，DFS 版只做存在性、BFS 版才能按层求最短——6.3 节马上解释为什么。

### 6.3 入队即标记：一个指数爆炸的反例

`visited.add(v)` 与 `q.append(v)` 紧挨着写，不是代码洁癖。用分层 DAG 精确量化三种写法：s 出发，经 k 层、每层 2 个节点（相邻层完全连接）到 t，路径恰好 2^k 条：

```python
from collections import deque

def layered(k):
    """分层 DAG：s → k 层、每层 2 个节点（相邻层完全连接）→ t，路径 2^k 条。"""
    n = 2 * k + 2
    s, t = 0, n - 1
    adj = [[] for _ in range(n)]
    adj[s] = [1, 2]
    for i in range(1, k + 1):
        a, b = 2 * i - 1, 2 * i
        nxt = [t] if i == k else [2 * i + 1, 2 * i + 2]
        adj[a] = list(nxt)
        adj[b] = list(nxt)
    return adj, s, t

def bfs_enqueue_count(adj, s, mode):
    """统计三种标记时机的总入队次数。"push"：入队即标记；
    "pop"：入队不查、出队才查；"none"：完全不查（带环图会死循环）。"""
    visited = {s} if mode == "push" else set()
    q = deque([s])
    enqueues = 1
    while q:
        u = q.popleft()
        if mode == "pop":
            if u in visited:
                continue
            visited.add(u)
        for v in adj[u]:
            if mode == "push":
                if v not in visited:
                    visited.add(v)
                    q.append(v)
                    enqueues += 1
            else:
                q.append(v)
                enqueues += 1
    return enqueues

adj, s, t = layered(14)
push = bfs_enqueue_count(adj, s, "push")
pop = bfs_enqueue_count(adj, s, "pop")
none_ = bfs_enqueue_count(adj, s, "none")
assert push == 2 * 14 + 2                    # 每个状态只入队一次
assert pop == 1 + 4 * 14                     # 每条边触发一次入队，队列里躺着重复状态
assert none_ == 2 ** 15 + 2 ** 14 - 1        # 正比于「路径条数 × 路径长度」：指数爆炸
```

同一张 30 个节点的图，三种写法的入队次数是 30、57、49151。出队时才检查（pop）结果仍正确，但「被发现过多次」的状态都会重复入队，队列里躺着成批重复状态——隐式图上每个重复状态还要再付一次「现算邻居」的钱。完全不查（none）则入队次数正比于**路径条数**：这张图是 2^k，指数级；带环图上更糟——直接死循环。纪律只有一条：**生成邻居、入队、标记在同一处完成，标记永远发生在入队时**。

> [!CAUTION]
> 「入队即标记」在 DFS 显式栈版里同样适用（3.1 节的 `dfs_iterative`），但那里它还会改变访问顺序。两条纪律对应两种遍历：BFS 求最短路必须入队即标记，否则重复状态冲垮队列；DFS 需要精确先序/后序时必须出栈时检查并用两阶段写法。把一边的纪律原样搬到另一边，是另一类常见 bug。

## 7. 拓扑排序：给依赖排队

**拓扑排序**（topological sort）针对 DAG：把所有节点排成一行，使每条边 u→v 都满足 u 在 v 前。「先修课在专业课之前」「库 A 依赖 B 则 B 先装」——凡是 DAG 依赖，排序是唯一的自动化答案。拓扑序存在当且仅当图无环，所以**排序过程同时就是判环过程**。

### 7.1 Kahn 算法：入度表 + 队列 + 计数判环

反复摘取「没有未完成前置」的节点：入度为 0 的进队列，取出一个就把所有后继的入度减 1，减到 0 的后继入队。结束时若输出个数小于 n，剩下的节点全卡在环上——入度永远减不到 0，这就是**计数判环**：

```python
import heapq
from collections import deque

def topo_sort_kahn(n, edges):
    """Kahn 拓扑排序：入度表 + 队列 + 计数判环。有环返回 None。"""
    adj = [[] for _ in range(n)]
    indeg = [0] * n
    for u, v in edges:                # 边 u → v：u 是 v 的前置
        adj[u].append(v)
        indeg[v] += 1
    q = deque(u for u in range(n) if indeg[u] == 0)
    order = []
    while q:
        u = q.popleft()
        order.append(u)
        for v in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0:         # 前置全部完成，就绪
                q.append(v)
    return order if len(order) == n else None   # 计数判环

def topo_sort_dfs(n, edges):
    """DFS 逆后序拓扑排序。判环必须依赖三色标记（灰 = 递归栈上）。"""
    adj = [[] for _ in range(n)]
    for u, v in edges:
        adj[u].append(v)
    WHITE, GRAY, BLACK = 0, 1, 2
    color = [WHITE] * n
    post = []
    def go(u):
        color[u] = GRAY
        for v in adj[u]:
            if color[v] == GRAY:      # 后向边 → 有环
                return False
            if color[v] == WHITE and not go(v):
                return False
        color[u] = BLACK
        post.append(u)                # 完成时刻记录 → 后序
        return True
    for u in range(n):
        if color[u] == WHITE and not go(u):
            return None
    return post[::-1]                 # 逆后序 = 拓扑序

def topo_sort_lexico(n, edges):
    """字典序最小的拓扑序：把 Kahn 的队列换成小顶堆。"""
    adj = [[] for _ in range(n)]
    indeg = [0] * n
    for u, v in edges:
        adj[u].append(v)
        indeg[v] += 1
    heap = [u for u in range(n) if indeg[u] == 0]
    heapq.heapify(heap)
    order = []
    while heap:
        u = heapq.heappop(heap)       # 可用节点里总拿编号最小的
        order.append(u)
        for v in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                heapq.heappush(heap, v)
    return order if len(order) == n else None

edges = [(1, 0), (2, 1), (2, 3), (3, 0)]        # 2→1→0 与 2→3→0
for order in (topo_sort_kahn(4, edges), topo_sort_dfs(4, edges),
              topo_sort_lexico(4, edges)):
    assert order is not None
    pos = {u: i for i, u in enumerate(order)}
    assert all(pos[u] < pos[v] for u, v in edges)   # 每条边都从左指向右
cyc = [(0, 1), (1, 2), (2, 0)]
assert topo_sort_kahn(3, cyc) is None and topo_sort_dfs(3, cyc) is None   # 有环
assert topo_sort_lexico(4, [(3, 0), (1, 0), (2, 1), (2, 3)]) == [2, 1, 3, 0]
```

时间 O(n + m)——还是「每点一次、每边看一次」的账。正确性只需一句不变式：**任何时刻队列里的节点，其全部前置都已输出**，输出序列天然满足所有约束；初始只有入度为 0 的节点满足，之后每输出一个点恰是把它从后继的前置里划掉。

### 7.2 DFS 逆后序：另一条路

对图跑三色 DFS，把**完成顺序**倒过来就是一组合法拓扑序。理由藏在完成时间定义里：DAG 的任意边 u→v，当 u 完成时 v 必然已完成——若 v 还是灰色，u→v 指回递归栈是后向边，与无环矛盾。它与 Kahn 的差异值得对比着记：

- **判环机制不同**：Kahn 靠输出计数，环上的节点留在队列之外；DFS 版必须依赖三色标记，因为逆后序本身不报错——有环时它照样输出一个序列，只是非法。
- **处理时机与形态不同**：Kahn 是「就绪即处理」，前置满足的任务立刻出队，构建系统借此边满足边开工，可用集合就是可并行的任务池；DFS 版要先整体遍历完才给得出序，适合本来就要做时间戳分析的算法（强连通分量等）顺手得到逆后序。只要一个拓扑序的场景，Kahn 代码更短、判环更直接。

### 7.3 字典序最小的拓扑序

拓扑序不唯一，题目有时点名要**字典序最小**。做法极简：Kahn 的队列换成小顶堆（[第 09 篇](09-heap-priority-queue.md)），每次从「当前可用」里拿编号最小的，O((n + m) log n)。贪心正确性是交换论证：若某合法序第一位不是当前最小可用节点 x，把 x 提到第一位仍合法且更小，对剩余部分归纳同理。注意措辞：是「**可用节点中**编号最小」，不是「把全图最小节点尽量提前」——后者是另一类问题，两者不要混。

### 7.4 应用清单

- **课程表/培养方案**：先修关系建边，拓扑序 = 可行修课顺序；`None` 意味着培养方案自相矛盾（循环先修）。
- **构建系统**：make/ninja/Bazel 的目标依赖图，拓扑序决定编译顺序；Kahn 的可用队列就是 `-j 8` 并行编译的任务池，环 = 依赖死锁直接报错。
- **包管理器**：pip/apt 的依赖解析是同一件事；「装 A 前先装 B」的链是拓扑序，circular dependency 报错就是判环。
- **AOE 网络**：边带工期的 DAG 上，「事件最早发生时间」是从源点出发的最长路，最长的链（关键路径）决定项目最短总工期；最长路在一般图上是 NP 难的，在 DAG 上靠拓扑序线性完成。

## 8. 什么问题该想到图

判断标准一句话：出现「A 依赖 B」「A 连着 B」「从 A 能到 B」「A 变一步成 B」，就先想图。

| 场景           | 节点与边          | 图为什么合适                                 |
| ------------ | ------------- | -------------------------------------- |
| 社交网络         | 用户；关注/好友      | 六度分隔就是 BFS 的层次数；社区检测近似找连通分量与密集子图       |
| 路由与导航        | 路口/路由器；道路/链路  | 导航 = 带权最短路；Internet 路由协议的核心是全网周期性重算最短路 |
| 任务调度         | 任务；先后约束       | DAG + 拓扑序；就绪队列天然表达可并行集合                |
| 编译器          | 函数/变量；调用/使用   | 从入口做可达性，不可达即死代码；链接顺序是拓扑问题              |
| 网页与 PageRank | 网页；超链接        | 链接 = 投票；随机游走的平稳分布靠「沿边反复扩散」算出           |
| 推荐系统         | 用户与物品构成二部图；交互 | 协同过滤 = 在二部图上找两跳邻居或做随机游走                |
| 状态机与正则引擎     | 状态；转移         | 正则匹配 = 在 NFA 上按字符沿边走；BFS 给最短触发序列       |
| 数据流分析        | 程序点；控制流       | 「变量是否存活」等事实沿边传播到不动点，与 BFS 扩散同构         |

这些系统的图几乎都不止算一次——路由表随时延刷新、依赖随版本变化，「重建表示 + 重跑遍历」的 O(n + m) 低到可以周期性执行，这正是图 + 遍历成为基础设施的原因。

## 9. 陷阱清单

- **递归深度爆栈**：Python 默认递归上限 1000，链长 10⁵ 的图直接 `RecursionError`；C 的进程栈通常几 MB（Linux 默认 8 MB，Windows 常见 1 MB）。改显式栈（3.1 节两阶段版）治本；`sys.setrecursionlimit` 配大线程栈只是续命。
- **忘了访问标记**：带环图死循环。标记、入队、入栈三行绑在一起（6.3 节）。
- **BFS 出队时才标记**：结果碰巧正确，但重复入队让队列膨胀到 O(m)，隐式图上退化明显；完全不查则在环图死循环、无环图指数爆炸。
- **判环的两个方向性错误**：无向图漏 parent——每条边被两个方向各看一次，不跳过来时的边就把无环图报成有环（有重边时要记边编号而不是 parent 节点）；有向图误用无向方法——菱形汇聚被误报成环，必须三色标记区分「访问过」与「在递归栈上」。
- **`list.pop(0)` 当队列**：每次 O(n)，BFS 整体退化到 O(n²) 量级；用 `collections.deque`。
- **邻接表用 set 的隐性代价**：每节点一个哈希表的内存与常数，且吞重边、拿不到权值——默认 list，要权值用 dict。
- **超大图的邻接矩阵**：n = 10⁵ 时矩阵 10¹⁰ 格，每格 1 字节也是 10 GB 量级，直接内存爆炸；稀疏图一律邻接表/CSR。
- **输入含重边与自环**：度数按原始边表统计（重边算多条、自环算 2 度）；用去重后的容器统计会错；矩阵被重边覆盖权值。
- **1-based 输入配 0-based 代码**：读入减 1 或数组开 n+1，二选一全篇一致；权值求和与 `n(n-1)/2` 可能超 int32，C 里一律 `long long`。

## 10. 小结

- 图是最一般的结构：线性表是「度 ≤ 2 的连通无环图」，树是「n−1 条边的无环连通图」。树上成立的一切先验（路径唯一、无环）在图上失效，`visited` 与判环是必须补的第一课。
- 握手定理 `Σ deg = 2m` 出现两次：一次约束度数统计，一次证明遍历复杂度——每点入容器一次、每边至多看两次，所以是 O(n + m) 而非 O(n·m)。
- 存储跟着稀疏性走：邻接表是默认；矩阵只值稠密小图、频繁判边、矩阵视角；边集数组服务按边处理的算法；CSR 用两个数组换缓存友好；链式前向星用三个数组换 O(1) 在线加边。
- DFS 与 BFS 是同一骨架换一个容器：栈走向深处、携带先序/后序与时间戳；队列按层扩散、给出无权最短路。选哪个看问题问的是「存在性与结构」还是「步数与层次」。
- 判环分场景：有向图三色标记（灰 = 递归栈上），无向图排除来时的边（重边记边编号）；时间戳区间嵌套是背后统一的理论。「首次到达即最短」由队列单调性加归纳反证支撑，前提是等步长；多源 BFS 等价于超级源点；双向 BFS 用 `O(b^(d/2))` 替代 `O(b^d)`，要求起终点已知且转移可逆。
- 状态即节点、转移即边：网格、单词、拨盘、棋盘是同一个模板；入队即标记是模板的复杂度底线，违反的代价从翻倍到指数爆炸。
- 拓扑排序 = 依赖问题的通用解：Kahn 适合流式与并行；DFS 逆后序顺手但判环靠三色；字典序最小换小顶堆。

## 11. 练习

**1.** 无向图所有节点的度数之和为什么一定是偶数？度数之和为 100 的图有多少条边？度数之和为 99 的图存在吗？

> [!TIP]
> 思路每条边给两个端点各贡献 1 度，度数之和 = 2m 恒为偶数（握手定理）。100/2 = 50 条边。99 是奇数，这样的图不存在——问出「度数之和为奇数」，答案一律是「输入有错」。

**2.** 要处理 n = 10⁵、m = 3×10⁵ 的稀疏图，算法中频繁需要判断「u 和 v 有没有边」。估算邻接矩阵的内存，给出两个可行方案。

> [!TIP]
> 思路矩阵 10¹⁰ 格：bool 约 10 GB、int32 约 40 GB，不可行。方案一：dict 邻接表（`adj[u]` 是 `{v: w}`），判边 O(1)，空间 O(n + m)；方案二：list 邻接表 + 全局边哈希集合判边。能接受 O(log deg) 的话，CSR 每段排序后二分也行。

**3.** 构造一个带权图，使 BFS 沿「首次到达」给出的路径不是权值和最小的路径，并说明这暴露了 BFS 的哪个前提。

> [!TIP]
> 思路设 s→t 权 10，s→a 权 1，a→t 权 1。BFS 第一层就把 t 标为距离 1（一条边到达），但代价 10；经 a 的路径两步、代价 2。暴露的前提是「每条边等价」：按层扩散最小化边数不是权值和。带权时按「当前累计代价最小」出队，即 Dijkstra（[第 13 篇](13-graph-shortest-path-mst.md)）。

**4.** 有向图 A→B、B→C、A→C、C→D 无环，但朴素「遇到已访问节点就算环」会报环。指出它错在哪一步，并说明三色标记为什么正确。

> [!TIP]
> 思路错在把「第二次被到达」当成环：C 被 A、B 两条路各到达一次，第二次到达时 C 早已完成（黑色）。三色把「访问过」拆成「灰色：还在递归栈上」与「黑色：已完成」；只有指向灰色的边才意味着从当前节点有一条路回到自己。C 第二次被指向时是黑色，不构成环。

**5.** 分支因子 b = 4、答案深度 d = 8 的状态空间：单向与双向 BFS 各约访问多少节点？后者快多少倍？为什么「只能单向走」的转移（如只许递减的谜题）不能直接用双向 BFS？

> [!TIP]
> 思路单向约 4⁸ = 65536；双向约 2×4⁴ = 512，约 128 倍。双向的前提是两侧都能按层扩展——转移不可逆时，从终点一侧无法「逆着走」，队列扩不动，两侧永不相遇；必须显式构造逆转移，否则退回单向。

**6.** n×m 网格上有若干起火点（火每秒向四邻蔓延一格），求每个格子最早几秒起火。为什么「对每个格子跑一次 BFS」不可取？给出正确算法与复杂度。

> [!TIP]
> 思路每个格子各跑一次是 O((nm)²)。正确做法是多源 BFS：所有起火点 dist = 0 一起入队，其余与普通 BFS 相同；等价于加超级源点，4.2 节的证明原样适用。复杂度 O(nm)。

**7.** 课程依赖：0 依赖 1（边 1→0）、1 依赖 2、3 依赖 2、0 依赖 3。手工执行 Kahn 算法，写出每步队列内容与最终拓扑序；再说明构建系统为什么偏爱 Kahn 而不是 DFS 逆后序。

> [!TIP]
> 思路入度：0:2、1:1、3:1、2:0。初始队列 \[2]；出 2 后 1、3 入度归零，队列 \[1, 3]；出 1（0 的入度剩 1）、出 3（0 归零入队），队列 \[0]；出 0。拓扑序 2, 1, 3, 0（2, 3, 1, 0 也合法）。构建系统偏爱 Kahn 因为「就绪即处理」：可用集合就是可并行开工的任务池，不必等全图遍历完。

**8.** 把「2×3 滑动谜题」（6 格、5 块滑块加 1 个空格，求还原的最少步数）翻译成图问题：状态是什么？边是什么？最坏搜索多少状态？为什么 `visited` 用字符串或元组作哈希键？

> [!TIP]
> 思路状态 = 6 格排列（如 "123450"），边 = 空格与上下左右相邻格交换，最多 4 条。状态总数至多 6! = 720，其中一半因奇偶性不可达，实际约 360；BFS 一次覆盖。排列不能作数组下标，但可哈希（[第 06 篇](06-hash-table.md)）——字符串/元组键的哈希集合就是隐式图的 visited 数组。
