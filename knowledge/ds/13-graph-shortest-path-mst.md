---
title: 图（下）：最短路与最小生成树
order: 13
tags: 图算法, 最短路, 最小生成树, Dijkstra, 动态规划
summary: 按特征查表选算法：「松弛」的六种调度派生出 Dijkstra、Bellman-Ford、Floyd 与 A*；最小生成树为何不是最短路；每个算法的代价与翻车点。
---

上篇解决了「谁和谁连着」（[第 12 篇](12-graph-representation-traversal.md)）；边一旦带上权，问题就变成「连着，但代价是多少」。此时 BFS 数步数的方法全部失效——步数最少的路可能贵得离谱，最便宜的路可能绕一大圈。最短路算法族阵容吓人，内核却只有一个动作：松弛（relax）。所有算法都在反复执行同一行 `if`，差别只是**按什么顺序松弛、松弛多少遍**；把调度方式想清楚，Dijkstra、Bellman-Ford、Floyd、A\* 就是同一件事的六种调度。这一篇还要澄清一个长得最像的冒名者：最小生成树（MST）。它和最短路树都输出一棵树，但一个优化「总连接代价」、一个优化「逐点距离」，在同一张图上可以给出完全不同的边集——分不清这两者是最常见的概念事故。

## 1. 先查表：你要的是哪一类问题

动手之前先对号入座。这张表是本篇的组织骨架，每一格对应一个算法：

| 问题形态              | 权值条件     | 图的形态         | 该用什么              | 复杂度                |
| ----------------- | -------- | ------------ | ----------------- | ------------------ |
| 单源（从一个点出发到全部）     | 无负权      | 稀疏（m 远小于 n²） | 堆优化 Dijkstra      | O((n + m) log n)   |
| 单源                | 无负权      | 稠密（m 接近 n²）  | 朴素 Dijkstra       | O(n²)              |
| 单源                | 只有 0 和 1 | 任意           | 0-1 BFS           | O(n + m)           |
| 单源                | 无权       | 任意           | BFS               | O(n + m)           |
| 多源（每个点到最近源点）      | 无权       | 任意           | 多源 BFS            | O(n + m)           |
| 单源                | 有负权、无负环  | 任意           | Bellman-Ford      | O(nm)              |
| 检测负环              | ——       | 任意           | Bellman-Ford      | O(nm)              |
| 全源（所有点对）          | 无负环      | n ≤ 500 的稠密图 | Floyd-Warshall    | O(n³)              |
| 全源                | 无负权、稀疏   | m 远小于 n²     | 每个点做一次源跑 Dijkstra | O(nm log n)        |
| 单对（s 到 t）+ 有便宜的估计 | 无负权      | 网格、地图        | A\*               | 取决于 h 的质量          |
| 把全部点连起来、总边权最小     | 一般为正     | 任意           | Kruskal 或 Prim    | O(m log m) 或 O(n²) |

三条横贯全表的注意事项：

- **负环让「最短路」本身失去定义**。只要存在从源点可达的负权环，就能绕环无限次把距离压向负无穷，任何距离都没有意义。此时算法的正确目标变成「检测并报告负环」，而不是算距离。
- **「只要距离」与「要完整路径」是正交的维度**。上面所有算法都能顺带维护路径：Dijkstra、Bellman-Ford 在松弛时记 `parent`，Floyd 记「下一跳」矩阵 `nxt`。只有距离规模大到内存吃紧时才省掉它们。

## 2. 松弛：所有最短路算法的同一个动作

设 `dist[v]` 是「目前已知从源点到 v 的最短距离」——它是一个只会缩小的上界。对边 `u → v`（权 `w`）做松弛就是：

```text
relax(u, v, w):
    if dist[u] + w < dist[v]:
        dist[v] = dist[u] + w
```

围绕这一行有两个关键事实。

**三角不等式**：真实最短距离 `δ` 天然满足 `δ(v) ≤ δ(u) + w(u, v)`——绕道 u 再去 v 不可能比直达更短，否则直达就不是最短路了。这是最短路问题的最优子结构，也是松弛这行代码的合法性来源：只要 `dist[u]` 还不低于 `δ(u)`，用它更新别人就永远不会把别人的上界压到真实值以下。

**松弛到不动点**：把所有边松弛到「没有任何一条边能再改进 dist」，即每条边都满足 `dist[v] ≤ dist[u] + w`。此时 dist 是一个「可行势」，配合另一条不变式——`dist[v]` 要么是无穷，要么等于某条真实路径的长度（每次松弛都由真实路径支撑）——可以推出：不动点处 `dist[v] = δ(v)` 对所有可达点成立。上界压不下去、下界有人撑着，正好夹住。

于是各算法的差异只剩一个维度——调度：

| 算法           | 松弛的调度策略                         |
| ------------ | ------------------------------- |
| Dijkstra     | 每次取「dist 最小且不可能再变小」的点，松弛它的出边    |
| 0-1 BFS      | 用双端队列维持距离档，等价于 0/1 权下的 Dijkstra |
| Bellman-Ford | 不挑不拣，每轮松弛全部边，共 n − 1 轮          |
| SPFA         | 只把「刚被改小」的点排进队列，按需松弛             |
| Floyd        | 按「允许中转的点集」分层，每层并入一个中转点          |
| A\*          | 松弛顺序按 `f = g + h` 排，h 提供方向感     |

> [!IMPORTANT]
> 判断一个最短路实现写得对不对，只需要问一句：它的松弛顺序能否保证「该处理的没漏、不该早处理的没早」？Dijkstra 用贪心保证，Bellman-Ford 用轮数上限保证，Floyd 用 DP 层次保证。调试时把每种算法还原成「松弛的调度策略」，比背模板可靠得多。

## 3. Dijkstra：贪心、堆与过期条目

### 3.1 为什么「边权非负」是成立的必要条件

Dijkstra 维护的不变式：**一个点从优先队列弹出（朴素版：被选中）时，`dist` 就等于真实最短距离 `δ`，此后不再变**。用归纳法证明，反证设 u 是第一个被「敲定」时 `dist[u] > δ(u)` 的点。取 u 的一条真实最短路径 P，P 从源点出发，必然离开已确定集合 S，把 P 上第一个不属于 S 的点记为 x（x 可能就是 u），它在 P 上的前驱 y 属于 S。y 被敲定时松弛过边 `y → x`，所以 `dist[x] ≤ dist[y] + w(y, x) = δ(y) + w(y, x)`。而 P 的后半段 `x → … → u` 的边权和非负——**非负性恰好在这里进场**：剩下的路只会更长，所以 `δ(y) + w(y, x) ≤ δ(u)`。调度器选了 dist 最小的未定点 u 而不是 x，说明 `dist[u] ≤ dist[x] ≤ δ(u)`；结合上界性质 `dist[u] ≥ δ(u)`，得到 `dist[u] = δ(u)`，矛盾。

直觉版：非负边权下「绕路不可能更短」。任何绕开已确定集合再回来的路径，走到第一个未确定点时就已不比当前最小值短，后面全是非负边，只会继续加长。

负权边为什么致命：绕行路径可以**前半段更长、后半段（负边）把总长拉回来**，「当前最小」不再等于「最终最小」，贪心的根基塌掉。具体的反例图与错误输出见第 10 节陷阱 1。A\* 能和 Dijkstra 共享这套论证，靠的是让排序键 `f = g + h` 代替 `g` 后依然单调（第 7 节）。

### 3.2 朴素版：O(n²)，稠密图更快

不借助堆，每轮线性扫描找出未确定点中 dist 最小者，松弛它的全部出边：

```python
INF = float("inf")

def dijkstra_naive(g, src):
    """邻接矩阵版 Dijkstra：O(n^2)。g[i][j] 为边权，无边为 INF，对角线为 0。"""
    n = len(g)
    dist = g[src][:]
    dist[src] = 0
    done = [False] * n
    for _ in range(n):                    # 每轮敲定一个点
        u = -1
        for v in range(n):                # 未确定的点里挑 dist 最小者
            if not done[v] and (u == -1 or dist[v] < dist[u]):
                u = v
        if dist[u] == INF:                # 剩下的点都不可达
            break
        done[u] = True                    # u 的真实最短路就此敲定
        for v in range(n):                # 用 u 松弛它的所有出边
            if g[u][v] != INF and dist[u] + g[u][v] < dist[v]:
                dist[v] = dist[u] + g[u][v]
    return dist

if __name__ == "__main__":
    g = [
        [0, 3, INF, 7],
        [3, 0, 4, 2],
        [INF, 4, 0, 5],
        [7, 2, 5, 0],
    ]
    print(dijkstra_naive(g, 0))           # [0, 3, 7, 5]
```

两个版本的对比：

| 实现       | 时间               | 空间       | 甜点区           |
| -------- | ---------------- | -------- | ------------- |
| 朴素（邻接矩阵） | O(n²)            | O(n²)    | m 接近 n² 的稠密图  |
| 堆优化（邻接表） | O((n + m) log n) | O(n + m) | m 远小于 n² 的稀疏图 |

稠密图上朴素版赢在两点：总操作次数 n²，而堆版要做 m ≈ n² 次入堆、每次带 log 因子；朴素版的内层是对连续数组的顺序扫描（缓存友好），堆版是随机访存的指针跳跃（[第 01 篇](01-complexity-analysis.md) 第 3 节的常数故事在这里重演）。一个诚实的补注：CPython 里 `heapq` 是 C 实现，朴素版的内层却是纯 Python 循环，稠密图上谁快要实测——上面的结论在 C/C++/Java 里严格成立。

### 3.3 堆优化：O((n + m) log n) 与过期条目

堆版的关键工程决策是**不实现 decrease-key**（[第 09 篇](09-heap-priority-queue.md) 第 9 节讲过：二叉堆改一个键要 O(n) 找到它，不值得）。替代方案是延迟删除：松弛成功就把新距离推入堆，旧条目留在堆里，等它弹出来时发现已经过期、直接跳过。堆里最多同时有 m + 1 个条目，总代价 O((n + m) log n)。

```python
import heapq

def dijkstra(n, edges, src):
    """邻接表 + 堆：O((n + m) log n)。edges: [(u, v, w)] 有向边。"""
    adj = [[] for _ in range(n)]
    for u, v, w in edges:
        adj[u].append((v, w))
    INF = float("inf")
    dist = [INF] * n
    parent = [-1] * n
    dist[src] = 0
    heap = [(0, src)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist[u]:            # 过期条目：u 后来又被更短的路径改进过
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist[v]:       # 松弛成功才入堆 = 廉价版的 decrease-key
                dist[v] = nd
                parent[v] = u      # 是谁把 v 改短的，路径就经过谁
                heapq.heappush(heap, (nd, v))
    return dist, parent

def path_to(parent, v):
    out = []
    while v != -1:
        out.append(v)
        v = parent[v]
    return out[::-1]

if __name__ == "__main__":
    edges = [(0, 1, 4), (0, 2, 1), (2, 1, 2), (1, 3, 5), (2, 3, 8), (3, 0, 3)]
    dist, parent = dijkstra(4, edges, 0)
    assert dist == [0, 3, 1, 8]           # 到 1 走 0->2->1（3），不是直连（4）
    assert path_to(parent, 3) == [0, 2, 1, 3]
    print("dist:", dist, "| 0->3:", path_to(parent, 3))
```

> [!WARNING]
> `if d > dist[u]: continue` 这一行就是「过期判断」，也是最短路实现里最高频的 bug 点：漏写它，堆被过期条目撑满、重复松弛；把 visited 标记放在入堆时（而不是弹出并检查之后），会直接算错。两种翻车写法见陷阱 2。另一个安心点：堆按 `(dist, node)` 排序，距离打平时谁先出都一样，平局不影响正确性。

### 3.4 用 parent 数组还原路径

`parent[v] = u` 记录的是「v 当前的上界是被 u 松弛出来的」。要在运行结束时还原 s 到 v 的路径，从 v 沿 `parent` 一路走回 s 再反转即可（上面 `path_to` 的实现）。

必须写对的一点：**parent 要在每一次松弛成功时更新，而不是只在第一次发现节点时记录**。BFS 里的习惯是「首次访问记 parent、之后不再动」，在无权图上这是对的，因为 BFS 第一次到达时步数就是最短；带权图上没有这个性质。反例：边 `0 → 1` 权 10、`0 → 2` 权 1、`2 → 1` 权 2。处理 0 时先发现 1，记 `parent[1] = 0`（上界 10）；随后经 2 松弛把上界压到 3——此时 parent 必须改写成 2。不改写的话，还原出的是那条长度 10 的直连边：路径存在，但不是最短的。顺带一提，只有 v 被弹出（敲定）之后 `parent[v]` 才最终可信；运行中途读未定点的 parent，可能得到一棵自相矛盾的树。

### 3.5 对拍：用随机图验证实现

对拍是竞赛工程的标准验证手段：写一个「慢但显然对」的参照实现，随机生成数据，断言两者输出一致。下面用 Floyd 当参照（它的正确性不依赖任何松弛顺序，第 6 节），检验堆版 Dijkstra：

```python
import heapq
import random

INF = float("inf")

def dijkstra_heap(n, adj, src):
    dist = [INF] * n
    dist[src] = 0
    heap = [(0, src)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist[u]:
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(heap, (nd, v))
    return dist

def floyd(n, edges):
    dist = [[INF] * n for _ in range(n)]
    for i in range(n):
        dist[i][i] = 0
    for u, v, w in edges:
        if w < dist[u][v]:            # 重边取最小
            dist[u][v] = w
    for k in range(n):
        for i in range(n):
            dik = dist[i][k]
            if dik == INF:
                continue
            di, dk = dist[i], dist[k]
            for j in range(n):
                if dik + dk[j] < di[j]:
                    di[j] = dik + dk[j]
    return dist

if __name__ == "__main__":
    random.seed(13)
    for case in range(300):
        n = random.randint(2, 12)
        m = random.randint(0, n * (n - 1))
        edges = [(random.randrange(n), random.randrange(n),
                  random.randint(1, 9)) for _ in range(m)]
        adj = [[] for _ in range(n)]
        for u, v, w in edges:
            adj[u].append((v, w))
        ref = floyd(n, edges)
        for s in range(n):
            assert dijkstra_heap(n, adj, s) == ref[s], (case, s)
    print("300 组随机图：堆版 Dijkstra 与 Floyd 的全部点对距离一致")
```

注意随机边权刻意只用正数——对拍数据必须尊重被测算法的前提假设，负权图不该进 Dijkstra 的对拍（想测 Bellman-Ford 又怕负环，只生成「编号从小指向大」的边即可，那样的图天然无环）。

## 4. 两个「免费」的特例：0-1 BFS 与多源 BFS

### 4.1 0-1 BFS：边权只有 0/1 时，堆可以扔掉

堆的作用是把「下一个该处理的点」排到最前。当边权只有 0 和 1 时，任何时刻队列里点的距离最多相差 1，一个双端队列（[第 05 篇](05-queue-deque.md)）就足以维持顺序：**0 边产生的新点与 u 同距离档，插队首；1 边产生的新点在下一档，插队尾**。队列从头到尾距离单调不减、最多两档，每次 `popleft` 拿到的都是当前最小——这正是 Dijkstra 的贪心序，只是省掉了堆的 log 因子，复杂度 O(n + m)。

```python
from collections import deque

def zero_one_bfs(n, edges, src):
    """边权只有 0/1 的最短路：双端队列替代堆，O(n + m)。"""
    adj = [[] for _ in range(n)]
    for u, v, w in edges:
        adj[u].append((v, w))
    INF = float("inf")
    dist = [INF] * n
    dist[src] = 0
    dq = deque([src])
    while dq:
        u = dq.popleft()
        for v, w in adj[u]:
            nd = dist[u] + w            # w 只会是 0 或 1
            if nd < dist[v]:
                dist[v] = nd
                if w == 0:
                    dq.appendleft(v)    # 距离没变，值得立刻看：插队首
                else:
                    dq.append(v)        # 距离加一：排到队尾
    return dist

if __name__ == "__main__":
    edges = [(0, 1, 0), (1, 2, 1), (0, 2, 1), (2, 3, 0), (1, 3, 1)]
    assert zero_one_bfs(4, edges, 0) == [0, 0, 1, 1]
    edges2 = [(0, 1, 1), (1, 2, 0), (0, 2, 1)]
    assert zero_one_bfs(3, edges2, 0) == [0, 1, 1]
    print("0-1 BFS 断言通过")
```

典型场景：网格上「走一格花 1、走传送门或冲刺花 0」、状态搜索里区分「普通操作」与「免费操作」。它还是 Dial 算法（按距离分桶）在权值集只有两个元素时的特例——如果权值是 {0, 1, 2}，双端队列的两个档位就装不下了，要么回到堆，要么用多桶结构。

### 4.2 多源 BFS：到「最近源点」的距离

另一个看似要堆、其实不用的问题：无权图上有若干源点，求每个点到**最近**源点的距离。把所有源点的距离置 0、一口气全部入队即可——等价于加一个虚拟超级源点 S，向每个源点连一条 0 边，然后跑普通 BFS。

```python
from collections import deque

def multi_source_bfs(n, edges, sources):
    """无权图：每个点到「最近源点」的距离。所有源点距离 0，一起入队。"""
    adj = [[] for _ in range(n)]
    for u, v in edges:
        adj[u].append(v)
        adj[v].append(u)
    dist = [None] * n                   # None = 还没被到达过
    dq = deque()
    for s in sources:
        dist[s] = 0
        dq.append(s)
    while dq:
        u = dq.popleft()
        for v in adj[u]:
            if dist[v] is None:
                dist[v] = dist[u] + 1
                dq.append(v)
    return dist

if __name__ == "__main__":
    assert multi_source_bfs(5, [(0, 1), (1, 2), (2, 3), (3, 4)], [0, 4]) == [0, 1, 2, 1, 0]
    assert multi_source_bfs(4, [(0, 1), (2, 3), (1, 2)], [0, 3]) == [0, 1, 1, 0]
    print("多源 BFS 断言通过")
```

最近出口、最近冷却塔、多服务中心覆盖，都是这个形状。注意边界：**多源 BFS 只对无权图成立**。如果各源点有不同的初始代价（比如救援队出发时间不同），FIFO 的层序性质被破坏，要老实用 Dijkstra（见练习 6）。

## 5. Bellman-Ford 与 SPFA：负权与负环

### 5.1 为什么恰好是 n − 1 轮

Bellman-Ford 把「调度」问题用最笨也最稳的方式解决：每轮无差别松弛全部 m 条边，重复 n − 1 轮。正确性的钥匙是一个归纳：**第 k 轮结束时，所有「边数 ≤ k」的最短路已经正确**。第 1 轮把源点的出边松弛到位（边数 1 的最短路）；第 2 轮松弛每条边时，等于把「正确性」沿路径再传播一跳……而无负环时最短路一定是简单路径（经过重复顶点就能去掉一个非负环变短），边数至多 n − 1，所以 n − 1 轮足够。`changed` 标志让收敛早的图提前收工。

```python
def bellman_ford(n, edges, src):
    """edges: [(u, v, w)] 有向边。返回 (dist, has_neg_cycle)。O(nm)。"""
    INF = float("inf")
    dist = [INF] * n
    dist[src] = 0
    for _ in range(n - 1):              # 最短路最多 n-1 条边，n-1 轮足够
        changed = False
        for u, v, w in edges:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                changed = True
        if not changed:                 # 提前收敛：后面不可能再有改进
            break
    for u, v, w in edges:               # 第 n 轮：还能松弛就说明有负环
        if dist[u] != INF and dist[u] + w < dist[v]:
            return dist, True
    return dist, False

if __name__ == "__main__":
    d, neg = bellman_ford(3, [(0, 1, 4), (0, 2, 5), (1, 2, -3)], 0)
    assert d == [0, 4, 1] and not neg   # 0->1->2 = 4-3 = 1，比直连的 5 短
    d, neg = bellman_ford(3, [(0, 1, 1), (1, 2, -3), (2, 1, 1)], 0)
    assert neg                          # 1<->2 的环权和 -2，是负环
    d, neg = bellman_ford(4, [(0, 1, 1), (2, 3, -5), (3, 2, -5)], 0)
    assert not neg                      # 负环存在但从 src 不可达，不误报
    print("Bellman-Ford 断言全部通过")
```

### 5.2 负环检测与适用边界

第 n 轮的松弛检查是负环检测的全部：如果一轮「应该已经收敛」的全量松弛还能改进某个 dist，说明存在边数 ≥ n 的更短路径，路径必然重复顶点，而重复顶点意味着环，环的权和必须为负才能继续压低距离。

两个工程细节：

- 检测到的是「**从源点可达**」的负环。不可达的负环里所有 dist 都是 INF，`dist[u] != INF` 的守卫让它们被跳过——这是特性（那些点本来就不受影响），也是坑（要检测全图负环，得把所有 dist 初始化为 0 或加一个连向所有点的超级源点，见练习 3）。
- 无向图上负权边要单独警惕：一条负边来回走两遍权和为负，**等价于负环**。所以「无向图 + 负权」基本直接判负环处理。

O(nm) 听起来很贵，但 Bellman-Ford 的适用场景恰恰是别的方法进不来的地方：有负权边、需要检测负环、或 m 很小（比如 m = O(n) 的稀疏图上它是 O(n²)）。它还有个学术上的延伸：把每条边 `(u, v, w)` 改写成 `dist[u] + w ≥ dist[v]` 的约束，就是差分约束系统求可行解的标准工具。

### 5.3 SPFA：队列优化、平均很快、最坏很惨

SPFA（队列优化的 Bellman-Ford）的改进思路很自然：第 k 轮里真正起作用的只有「上一轮刚被改小的点」，其余边的松弛是无效功。于是维护一个队列，只把刚被改小的点入队，出队时松弛它的出边。随机稀疏图上每个点平均入队约 2 次，实测常常比堆 Dijkstra 还快。

但它的最坏复杂度仍是 O(nm)，而且**这个最坏是可以被构造出来的**——这就是竞赛圈「卡 SPFA」的原理。机制是这样的：SPFA 的队列长度由「更新波」决定，出题人构造一张网格图，让更新一波从左上扫到右下，右下角的变化又触发一波横扫回来，如此往复；每个格子的距离被改小 Θ(n) 次，每次改小都重新入队并把邻居再松弛一遍。n × n 网格有 n² 个点、约 2n² 条边，总松弛次数冲到 O(n³) 量级；同一张图上堆 Dijkstra 只有 O(n² log n)。换句话说：Dijkstra 的 O((n + m) log n) 是**对一切输入成立的保证**，SPFA 的「平均 2 次」只是**对随机输入的运气**——出题人只要针对运气构造数据即可。工程上的对应结论：有负权才用 Bellman-Ford 系，无负权直接 Dijkstra，不要用 SPFA 赌输入的分布。

## 6. Floyd-Warshall：全源最短路是一层 DP

### 6.1 状态语义与循环顺序

前面所有算法都输出「单源」距离数组；要所有点对之间的距离，最直接的想法是每个点当一次源跑 Dijkstra。但在稠密图上有个更优雅的选择。Floyd-Warshall 定义：

```text
dp[k][i][j] = 只允许以点 1..k 为中转时，i 到 j 的最短距离
```

转移只有两种选择——路径要么不经过 k（继承 `dp[k-1][i][j]`），要么恰好经过一次 k（`dp[k-1][i][k] + dp[k-1][k][j]`）：

```text
dp[k][i][j] = min(dp[k-1][i][j], dp[k-1][i][k] + dp[k-1][k][j])
```

`k` 必须在最外层，因为 `dp[k][*][*]` 只依赖 `dp[k-1][*][*]`——中转点集合必须一层一层扩大。写错顺序会静默漏解，用一个 4 个点的反例验证：

```python
INF = float("inf")
n = 4
# 反例图：0->2(1), 2->1(1), 1->3(1)。真实最短路 0->3 = 3（0->2->1->3）。
edges = [(0, 2, 1), (2, 1, 1), (1, 3, 1)]

def floyd_order(order):
    dist = [[INF] * n for _ in range(n)]
    for i in range(n):
        dist[i][i] = 0
    for u, v, w in edges:
        dist[u][v] = w
    for a in range(n):
        for b in range(n):
            for c in range(n):
                if order == "ikj":      # 错误：k 夹在中间两层
                    i, k, j = a, b, c
                else:                   # 正确：k 在最外层
                    k, i, j = a, b, c
                if dist[i][k] + dist[k][j] < dist[i][j]:
                    dist[i][j] = dist[i][k] + dist[k][j]
    return dist

assert floyd_order("ikj")[0][3] == INF   # 漏解：i=0 那一轮消费 2->1->3 时它还不存在
assert floyd_order("kij")[0][3] == 3     # 正确
print("k 在中间层得到 INF（漏解），k 在最外层得到 3（正确）")
```

拆开看这个反例：`0 → 3` 的路径要拆在「最大中转点 2」处——前半 `0 → 2` 不需要中转，后半 `2 → 1 → 3` 的中转只有 1。k 最外层保证第 1 轮（k = 1）先算出 `2 → 3` 经 1 的距离 2，第 2 轮（k = 2）才有材料拼出 `0 → 3`。k 夹在中间时，i = 0 那一轮消费「2 作中转」的成果时它还没被算出来（i = 2 的轮次在后面），而循环不会回头重算。这个例子值得亲手跑一遍：三种嵌套顺序里只有一种对，错了不报错，只是安静地给错答案。

至于「滚动掉 k 维、原地更新是否安全」：第 k 轮内读到的 `dist[i][k]` 和 `dist[k][j]` 若被本轮更新，只会是被 k 自己更新——`dist[i][k] + dist[k][k] = dist[i][k] + 0` 不可能严格更小，所以读到的一定还是「k 并入前」的值，原地更新无损。

### 6.2 完整实现：距离 + 路径还原

```python
INF = float("inf")

def floyd(n, edges):
    """全源最短路：O(n^3)。返回 dist 与 nxt（nxt[i][j] = i→j 最短路上 i 的下一跳）。"""
    dist = [[INF] * n for _ in range(n)]
    nxt = [[-1] * n for _ in range(n)]
    for i in range(n):
        dist[i][i] = 0
    for u, v, w in edges:
        if w < dist[u][v]:              # 重边取最小；非负自环会被对角线的 0 压住
            dist[u][v] = w
            nxt[u][v] = v
    for k in range(n):                  # k 必须在最外层：中转点集合一层层扩大
        for i in range(n):
            dik = dist[i][k]
            if dik == INF:
                continue
            di, dk = dist[i], dist[k]
            for j in range(n):
                nd = dik + dk[j]
                if nd < di[j]:
                    di[j] = nd
                    nxt[i][j] = nxt[i][k]   # i→j 改道经 k：先抄 i→k 的第一步
    return dist, nxt

def floyd_path(nxt, i, j):
    if nxt[i][j] == -1:
        return []                       # 不可达
    path = [i]
    while i != j:
        i = nxt[i][j]
        path.append(i)
    return path

if __name__ == "__main__":
    edges = [(0, 1, 4), (0, 2, 1), (2, 1, 2), (1, 3, 5), (2, 3, 8)]
    dist, nxt = floyd(4, edges)
    assert dist[0][3] == 8              # 0->2->1->3 = 1+2+5，比 0->2->3 的 9 短
    assert floyd_path(nxt, 0, 3) == [0, 2, 1, 3]
    assert floyd_path(nxt, 1, 0) == []  # 没有回边，不可达
    print("Floyd 距离与路径还原断言通过")
```

Floyd 的路径还原不用 parent 而用 `nxt`（下一跳），因为全源问题存 n 棵 parent 树不如存一个 n × n 的下一跳矩阵：`i → j` 改道经过 k 时，`i` 的下一跳就是 `i → k` 的下一跳。

### 6.3 适用边界与两个免费赠品

复杂度 O(n³)、空间 O(n²)（原地），边界就是 [第 01 篇](01-complexity-analysis.md) 数据范围表里的 n ≤ 500：n = 500 时约 1.25 × 10⁸ 次加法，C 里零点几秒，纯 Python 要靠耐心或 numpy。它的三个气质决定了什么时候选它：代码 15 行、没有数据结构、没有边界情况；查任意点对 O(1)（预处理完成后）；以及天然支持负权边（只要没有负环）。

**赠品一：传递闭包**。把「距离」换成「可达」，把 min 换成或、把加法换成与，同一套循环就是传递闭包：初始 `reach[u][v]` = 有边、`reach[i][i] = True`，转移写成 `reach[i][j] |= reach[i][k] and reach[k][j]`，跑完得到「i 能否到达 j」。用整数的位做行还能再快 64 倍——`reach[i] |= reach[k]` 一行顶一重内层循环。

**赠品二：最小环**。枚举环上编号最大的点 k，那么这个环一定可以拆成「边 (k, i) + 边 (k, j) + 一条不经过 k 的 i→j 最短路」。妙处在于时序：在「k 尚未作为中转并入」的那一刻，dist 矩阵恰好只允许前 k 个点做中转，正是我们要的「不经过 k」——所以查询和转移交织在同一层循环里。有向图的最小环要把 i、j 的两种顺序都枚举（环有方向），下面的版本是无向图的经典形式。

```python
INF = float("inf")

def min_cycle(n, edges):
    """无向图最小环：枚举环上最大编号点 k。
    环 = 边(k,i) + 边(k,j) + 「不经过 k 的 i→j 最短路」。
    在把 k 并入 Floyd 的那一刻查询，dist 恰好只允许前 k 个点做中转。"""
    g = [[INF] * n for _ in range(n)]
    for i in range(n):
        g[i][i] = 0
    for u, v, w in edges:
        if w < g[u][v]:
            g[u][v] = g[v][u] = w
    dist = [row[:] for row in g]
    best = INF
    for k in range(n):
        for i in range(k):
            for j in range(i + 1, k):
                if g[i][k] != INF and g[k][j] != INF:
                    best = min(best, dist[i][j] + g[i][k] + g[k][j])
        for i in range(n):              # 常规 Floyd 转移：把 k 作为中转并入
            dik = dist[i][k]
            if dik == INF:
                continue
            for j in range(n):
                if dik + dist[k][j] < dist[i][j]:
                    dist[i][j] = dik + dist[k][j]
    return best

if __name__ == "__main__":
    assert min_cycle(4, [(0, 1, 1), (1, 2, 2), (0, 2, 3), (2, 3, 1), (0, 3, 100)]) == 6
    assert min_cycle(4, [(0, 1, 1), (1, 2, 1), (2, 3, 1), (3, 0, 1), (0, 2, 100)]) == 4
    assert min_cycle(3, [(0, 1, 2), (1, 2, 2), (0, 2, 2)]) == 6
    print("最小环断言通过：含对角线的四边形取周长 4，不含 100 的对角边")
```

## 7. A\*：给 Dijkstra 一个方向感

Dijkstra 从源点向外**均匀**扩张：它对「离源点近」的所有点一视同仁，哪怕目标明明在东边，它也会先探索西边。A\*（A-star）的改动只有一处：给优先队列换一个排序键。设 `g(n)` 是已确定的「源点到 n 的距离」（就是 dist），`h(n)` 是对「n 到目标的剩余代价」的估计，堆改按 `f(n) = g(n) + h(n)` 排序。h 大方向上便宜又合理时，扩张前沿会朝着目标弯成一条走廊。

h 的质量由两条性质刻画：

- **可采纳（admissible）**：`0 ≤ h(n) ≤ 剩余真实代价`，即 h 永不夸大。这是最优性的底线。论证与 3.1 节同构：沿任一条最优路径，堆里总有该路径上的未定点 x，其 `f(x) = δ(s, x) + h(x) ≤ δ(s, x) + 剩余真实代价 = 最优总代价`，所以目标被弹出之前，任何 `f` 超过最优值的点都不会被弹出——目标的 g 弹出时就是最优距离。
- **一致（consistent / monotone）**：`h(u) ≤ w(u, v) + h(v)`，即 h 自己满足三角不等式。此时 f 沿任何边单调不减，每个点第一次被弹出时就已敲定，过期条目几乎不出现、不需要重开（reopen）。网格上四方向移动的曼哈顿距离 `|Δr| + |Δc|` 同时满足两条：每走一步最多消掉一行加一列的差距，所以是下界；且相邻格子间 h 的变化不超过步长，所以一致。

h = 0 时 A\* 精确退化为 Dijkstra；h 夸大（不可采纳）会更快但可能次优，工程上叫加权 A\*，用于「接受 10% 的次优换 5 倍速度」的游戏场景。典型应用：网格与导航网格（NavMesh）寻路、游戏 AI、15 数码这类拼图（h 取所有错位牌的曼哈顿距离之和）。

```python
import heapq

def grid_search(grid, start, goal, use_h):
    """网格寻路：use_h=False 即 Dijkstra（h 恒 0），True 即 A*（曼哈顿启发）。
    返回 (最短步数, 扩展节点数)。「扩展」= 从堆里弹出并真正处理的次数。"""
    R, C = len(grid), len(grid[0])
    gr, gc = goal

    def h(r, c):
        return abs(r - gr) + abs(c - gc) if use_h else 0

    dist = {start: 0}
    heap = [(h(*start), 0, start)]      # (f = g + h, g, 格子)
    expanded = 0
    while heap:
        f, d, (r, c) = heapq.heappop(heap)
        if (r, c) == goal:
            return d, expanded
        if d > dist[(r, c)]:            # 过期条目（h 一致时几乎不会遇到）
            continue
        expanded += 1
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < R and 0 <= nc < C and grid[nr][nc] != "#":
                nd = d + 1
                if nd < dist.get((nr, nc), float("inf")):
                    dist[(nr, nc)] = nd
                    heapq.heappush(heap, (nd + h(nr, nc), nd, (nr, nc)))
    return None, expanded

MAZE = [
    "S.....#......",
    "......#......",
    "......#...G..",
    "......#......",
    "......#......",
    ".............",
    "......#......",
    "......#......",
    "......#......",
    "......#......",
]

if __name__ == "__main__":
    start, goal = (0, 0), (2, 10)
    d0, e0 = grid_search(MAZE, start, goal, use_h=False)    # Dijkstra
    d1, e1 = grid_search(MAZE, start, goal, use_h=True)     # A*
    assert d0 == d1, "A* 必须与 Dijkstra 找到同样长的最短路"
    print(f"最短 {d0} 步 | 扩展节点数：Dijkstra {e0}，A* {e1}")
```

运行输出：最短 18 步，Dijkstra 扩展 98 个节点，A\* 扩展 52 个——两者找到**同样长**的最短路（断言保证），但 A\* 只碰了不到六成的格子。墙强迫路径先南下绕行，曼哈顿 h 对绕行段的估计偏乐观，这正是它「可采纳但不精确」的常态：h 永远不许说谎，但允许说得太保守。格子总数 156，h 越贴近真实（障碍感知的启发、动态加权的 h），省得越多；地图大、目标远时，这个差距是「能跑」与「不能跑」的区别。

## 8. 最小生成树：连起来，而不是走过去

问题换了个问法。最短路问「从 s 到每个点各要多久」；最小生成树（Minimum Spanning Tree，MST）问「**选 n − 1 条边把所有点连起来，总权最小是多少**」。输入同样是无向带权图，输出同样是一棵树，但优化目标完全不同——这一节先证一条定理，再看两个都建立在它之上的算法，最后正面拆掉「MST 就是最短路树」这个误解。

### 8.1 切分定理：便宜的桥没有理由不用

把点集切成两部分 S 与 V ∖ S，**横跨切分的边中权最小的那条 e，必属于某棵 MST**。证明用交换法：任取一棵不含 e 的生成树 T，把 e 加进 T 会形成一个环；环从 S 出发又回到 S，必然还横跨切分至少另一条边 f。e 是横跨最小，所以 `w(f) ≥ w(e)`，于是 `T + e − f` 仍是生成树且总权不增：若 `w(f) > w(e)`，T 就不是最小，矛盾；若相等，交换后得到一棵含 e 的最小生成树。无论哪种情况，「存在一棵包含 e 的 MST」都成立——贪心地拿 e 永远安全。

### 8.2 Kruskal：把边从小到大排队

Kruskal 直接把切分定理用到极致：所有边按权从小到大排序（[第 14 篇](14-sorting.md)），逐条尝试加入，**两端已连通就跳过**（加了必成环），否则收入树中。连通判断用并查集（[第 11 篇](11-union-find.md)），几乎均摊 O(1)。正确性一句话：边 e 被接受时，所有更小的、当前横跨「u 所在连通块 | 其余」这条切分的边都已被处理掉（否则 e 两端早已连通），所以 e 恰是该切分的最小横跨边，切分定理保证它安全。

```python
def kruskal(n, edges):
    """edges: [(w, u, v)] 无向边。返回 (总权, 树边)。O(m log m)。"""
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]   # 路径减半
            x = parent[x]
        return x

    total, tree = 0, []
    for w, u, v in sorted(edges):           # 从小到大试每条边
        ru, rv = find(u), find(v)
        if ru != rv:                        # 两端不在同一棵树 → 加上不成环
            parent[ru] = rv
            total += w
            tree.append((u, v, w))
            if len(tree) == n - 1:          # 提前收工
                break
    return total, tree

if __name__ == "__main__":
    edges = [(0, 1, 1), (1, 2, 2), (0, 2, 3), (2, 3, 5), (1, 3, 4)]
    total, tree = kruskal(4, [(w, u, v) for u, v, w in edges])
    assert total == 7 and sorted(tree) == [(0, 1, 1), (1, 2, 2), (1, 3, 4)]
    print("MST 总权:", total, "树边:", sorted(tree))
```

### 8.3 Prim：一圈一圈往外长

Prim 从任意一个点出发，维护「已选集合」，每一步取**横跨「树内 | 树外」切分的最小边**，把对面那个点接进来。每一步都是切分定理的直接应用，所以贪心成立。它的实现与 Dijkstra 几乎逐行相同，唯一的本质差别是 **dist 的语义**：Dijkstra 的 `dist[v]` 是「v 到源点的路径长度」，Prim 的 `dist[v]` 是「把 v 接进已选集合的那条最便宜的边」。

```python
import heapq

INF = float("inf")

def prim_heap(n, edges):
    """堆优化 Prim：O(m log n)。与 Dijkstra 只差一处：dist 是「到已选集合的最小边权」。"""
    adj = [[] for _ in range(n)]
    for u, v, w in edges:
        adj[u].append((w, v))
        adj[v].append((w, u))
    dist = [INF] * n                        # dist[v] = 把 v 接进树的 cheapest 边
    dist[0] = 0
    heap = [(0, 0)]
    taken = [False] * n
    total = 0
    while heap:
        d, u = heapq.heappop(heap)
        if taken[u]:
            continue
        taken[u] = True
        total += d
        for w, v in adj[u]:
            if not taken[v] and w < dist[v]:
                dist[v] = w
                heapq.heappush(heap, (w, v))
    return total

def prim_naive(n, edges):
    """朴素 Prim：O(n^2)，稠密图首选。"""
    g = [[INF] * n for _ in range(n)]
    for u, v, w in edges:
        if w < g[u][v]:
            g[u][v] = g[v][u] = w
    dist = g[0][:]                          # 各点到已选集合的最小边权
    dist[0] = 0
    taken = [False] * n
    total = 0
    for _ in range(n):
        u = -1
        for v in range(n):
            if not taken[v] and (u == -1 or dist[v] < dist[u]):
                u = v
        taken[u] = True
        total += dist[u]
        for v in range(n):
            if g[u][v] < dist[v]:           # 松弛的是「到集合的距离」，不是路径长
                dist[v] = g[u][v]
    return total

if __name__ == "__main__":
    edges = [(0, 1, 1), (1, 2, 2), (0, 2, 3), (2, 3, 5), (1, 3, 4)]
    assert prim_heap(4, edges) == prim_naive(4, edges) == 7
    # 随机连通图对拍：两个 Prim 给出的 MST 总权必须一致
    import random
    random.seed(7)
    for case in range(300):
        n = random.randint(2, 12)
        edges = []
        for v in range(1, n):                       # 先造一棵随机生成树保连通
            edges.append((random.randrange(v), v, random.randint(1, 50)))
        for _ in range(random.randint(0, n)):       # 再补随机边（天然含重边）
            u, v = random.sample(range(n), 2)
            edges.append((min(u, v), max(u, v), random.randint(1, 50)))
        assert prim_heap(n, edges) == prim_naive(n, edges), (case, edges)
    print("固定图断言 + 300 组随机连通图对拍全部通过")
```

两者的选择与 Dijkstra 同构：**稀疏图用 Kruskal**（排序 m 条边 O(m log m)，代码最短，边集适合流式/外部给出）；**稠密图用朴素 Prim**（m ≈ n² 时，n² 的扫描轻松压过给 n² 条边排序的 n² log n）。堆版 Prim O(m log n) 介于中间，适合中庸密度。

### 8.4 MST 的性质，以及它与最短路树是两回事

三条值得记住的性质：

- **环性质（切分定理的对偶）**：任何环上权最大的边（若最大权唯一）绝不在 MST 中——否则删掉它，生成树裂成两半，环上必另有一条横跨裂口的边，交换后更便宜。
- **瓶颈性质**：MST 是「最小化最大边权」的生成树；且树上任意两点路径的最大边权，等于全图两点间所有路径的最小可能最大边权。「尽量平稳的通信网」「容量下限最大的路径」都直接用它。
- **唯一性**：边权互不相同时 MST 唯一（切分定理的横跨最小边只剩一个候选）。

然后是必须拆掉的误解——**MST 不是最短路树**。MST 最小化「边的总权」，最短路树最小化「源点到各点的路径长」；前者不在乎任何一对点之间绕多远。一张三顶点的图就把两者分开：

```text
          4         2
    s(0) --- a(1) --- b(2)
      \               /
       \----- 5 -----/
```

```python
import heapq

INF = float("inf")

def kruskal_tree(n, weighted):
    parent = list(range(n))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    tree = []
    for w, u, v in sorted(weighted):
        if find(u) != find(v):
            parent[find(u)] = find(v)
            tree.append((u, v, w))
    return tree

def spt(n, edges, src):
    adj = [[] for _ in range(n)]
    for u, v, w in edges:
        adj[u].append((v, w))
        adj[v].append((u, w))
    dist, parent = [INF] * n, [-1] * n
    dist[src] = 0
    heap = [(0, src)]
    while heap:
        d, u = heapq.heappop(heap)
        if d == dist[u]:
            for v, w in adj[u]:
                if d + w < dist[v]:
                    dist[v] = d + w
                    parent[v] = u
                    heapq.heappush(heap, (d + w, v))
    return dist, parent

edges = [(0, 1, 4), (1, 2, 2), (0, 2, 5)]
tree = kruskal_tree(3, [(w, u, v) for u, v, w in edges])
dist, parent = spt(3, edges, 0)
assert sorted(tree) == [(0, 1, 4), (1, 2, 2)]        # MST 总权 6，直连边 5 落选
assert dist == [0, 4, 5] and parent == [-1, 0, 0]    # 最短路树恰恰取那条直连边
print("MST 树边:", tree, "| 最短路树父数组:", parent, "| dist:", dist)
```

MST 取了 `s-a` 和 `a-b`（总权 6，丢弃了权 5 的直连边）；从 s 出发的最短路树却取 `s-a` 和 `s-b`——因为 b 的最短距离是直连的 5，不是 MST 树上绕经 a 的 4 + 2 = 6。**MST 总权最小，但不保证树上任意两点的路径是最短路；最短路树保证逐点距离最优，但总权可以很大**。两者都问「一棵树」，答案却由不同的目标函数决定——选型时先问清自己优化的是哪一个。

## 9. 选型速查，与图论的下一层

把本篇的内容压缩成一张决策表（详表见第 1 节，这里只留最常纠结的几行）：

| 你要回答的问题             | 用什么                            |
| ------------------- | ------------------------------ |
| 从 s 到每个点各要多久（无负权）   | 堆 Dijkstra（稀疏）或朴素 Dijkstra（稠密） |
| 同上，但有负权、无负环         | Bellman-Ford                   |
| 所有点对之间的距离           | Floyd-Warshall（n ≤ 500）        |
| 把所有点连通，总权最小         | Kruskal（稀疏）或朴素 Prim（稠密）        |
| 地图上从 A 走到 B，且有便宜的估计 | A\*                            |

最短路回答「逐点代价」，MST 回答「整体连接代价」——问清自己要哪一个，选型就完成了一半。图上还有一整层同样经典的问题，这里只给一句话定位，留待后续篇章：**拓扑排序**——DAG 上的依赖顺序，DFS/BFS 的直接应用（[第 12 篇](12-graph-representation-traversal.md)）；**强连通分量**（Tarjan/Kosaraju）——「互相可达」的等价类，缩点后有向图变成 DAG；**割点与桥**——删掉谁会让连通图断开，DFS 的 lowlink 数组；**二分图匹配**——最多能配成多少对，匈牙利算法或网络流；**网络流**——带容量约束的最大运输，最大流等于最小割（[第 16 篇](16-advanced-structures.md)）；**旅行商**——n ≤ 20 时状态压缩 DP，复杂度 `O(n²·2ⁿ)`，正是[第 01 篇](01-complexity-analysis.md)数据范围表第一行的地盘。

## 10. 陷阱清单

### 10.1 负权边用 Dijkstra：具体反例与错误结果

```text
        3        1
  s ------> a ------> c
   \       ^
    \ 4   / -2
     v   /
      b
```

边：`s→a` 权 3、`s→b` 权 4、`b→a` 权 −2、`a→c` 权 1。真实最短距离：`δ(a) = 2`（走 `s→b→a`，4 − 2），`δ(c) = 3`。朴素 Dijkstra 的执行过程：先敲定 a（3），顺手把 c 松弛成 4；再敲定 b（4），把 a 的 dist 改成 2——**但 a 已被 `done` 封印，不会再扩展它的出边**；最后敲定 c（4）。输出 `dist = [0, 2, 4, 4]`，其中 `dist[c] = 4` 是错的，正确答案是 3。注意错误藏在下游：a 自己的上界碰巧被改对了，但它改进的消息永远传不出去。带「弹出即标记 done」的堆版同样中招。

> [!CAUTION]
> 不带 done、只有过期判断的惰性堆版在这个例子里碰巧能改对（负边触发重开、重开再传播），但复杂度保证全部失效——负边可以被构造成指数级的重复松弛。所以结论不是「换个写法就能容忍负权」，而是 **Dijkstra 根本不该出现在负权图上**，负权场景属于 Bellman-Ford。

### 10.2 过期判断的两个翻车写法

堆版 Dijkstra 的高频 bug 都出在「弹出的条目还是不是最新的」这个判断上：

- **漏写 `if d > dist[u]: continue`**：算法仍正确（旧 d 只会做出更弱的松弛），但堆被过期条目撑大、重复松弛，复杂度从 O((n + m) log n) 劣化到接近 O(m log m) 的常数灾难。
- **入堆时就标记 visited**：这是真正的正确性 bug。点第一次入堆时带着的可能还是次优距离，标记了 visited 它就永远不会被更优的距离重新处理。标记时机必须放在弹出且通过过期检查之后。

### 10.3 无穷大的选取与整数溢出

Python 里 `float("inf")` 与整数比较无碍，但注意它会污染类型：一旦 dist 混入 inf，后续都是浮点比较，超过 2⁵³ 的整数距离会丢精度——大规模数据用大整数哨兵（如 `10**18`）保持纯 int 运算更稳，且哨兵要大到「两倍相加、加边权都不会被真实路径达到」。C/C++ 里 `INT_MAX + w` 是有符号溢出（未定义行为），松弛前必须判断 `dist[u] != INF`，或用 `long long`，或选 `0x3f3f3f3f` 这类「自身相加不溢出 int」的传统哨兵。Bellman-Ford 里的 `dist[u] != INF` 守卫同时承担两个职责：跳过不可达点，防止 `INF + w` 产生「伪可达」。

### 10.4 重边与自环

邻接矩阵初始化时重边要**取最小**（`g[u][v] = min(g[u][v], w)`），本篇 Floyd 与朴素 Prim 的代码都做了；邻接表无所谓，松弛天然选最小。非负自环对所有算法都是无害空转；Floyd 里对角线必须初始化为 0，否则自环会把 `dist[i][i]` 变成正数。**无向图的负边等价于负环**（来回走两遍权和为负），遇到直接按负环处理。Kruskal 对重边无感（排序后第一条连通、后面判环跳过），MST 问题里自环永远不会入选。

### 10.5 heapq 元组里的 node 不可比较

`heapq.heappush(heap, (dist, node))` 在距离打平时会去比较 `node`。格子坐标、整数都可比；一旦 node 是自定义对象（没有 `__lt__`）就当场 `TypeError`，而且只在「恰好平局」时炸——测试环境遇不到，上线遇到。标准解法是塞一个单调递增的序号当第二关键字：`heapq.heappush(heap, (d, next(counter), node))`，既避免比较 node，又保证同距离按插入序稳定出堆。

### 10.6 稠密图上用堆反而更慢

m ≈ n² 时，堆版要做 n² 次 log 因子的入堆出堆（随机访存），朴素版是 n² 次连续数组扫描（顺序访存）。C/C++ 里朴素版在稠密图上通常快 2 到 5 倍。CPython 是例外：`heapq` 是 C 写的，朴素版的内层循环是纯 Python，实测稠密图上堆版反而常常更快——老话重提，先分清「结论属于算法还是属于语言实现」（[第 01 篇](01-complexity-analysis.md) 第 3 节）。同理，n 很小（几十个点）时两个版本都毫无压力，选代码短的。

## 11. 小结

- 所有最短路算法共享同一个动作「松弛」与同一组不变式（dist 是由真实路径支撑的上界、收敛时满足三角不等式），差异只在松弛的调度顺序；调试时先还原「调度策略」，再谈实现。
- Dijkstra 的正确性等价于「非负边权下绕路不更短」：贪心敲定的点不可能被绕行路径超越。负边摧毁的正是这半步，具体反例见陷阱 1。
- 朴素 Dijkstra O(n²) 赢在稠密图（无 log、顺序访存），堆版 O((n + m) log n) 赢在稀疏图；堆版靠「松弛成功才入堆 + 弹出时过期判断」替代 decrease-key，parent 数组每次松弛成功都要更新。
- 0-1 BFS 用双端队列的两档距离序替代堆，O(n + m)；多源 BFS 靠「所有源点一起入队」回答「到最近源点」，但只对无权图成立。
- Bellman-Ford 用 n − 1 轮全量松弛覆盖一切简单路径，第 n 轮仍能松弛即存在从源可达的负环；SPFA 是它的队列加速版，平均快但最坏可被网格图构造到 O(nm)。
- Floyd 是按中转点集合分层的 DP，k 必须在最外层（反例可验证）；n ≤ 500 以内是首选，同一套循环免费给出传递闭包与最小环。
- A\* 把 Dijkstra 的排序键换成 `g + h`：h 可采纳保最优、一致免重开；h = 0 退化为 Dijkstra，h 夸大换速度牺牲最优。
- MST 的地基是切分定理：Kruskal 排边 + 并查集判环，Prim 据点扩张 + 堆找桥，稠密图用朴素 Prim O(n²)；MST 最小化总边权、最短路树最小化逐点距离，同一张图可以给出不同的边集。

## 12. 练习

**1.** 用「松弛第 k 轮后的不变量」解释：为什么 Bellman-Ford 能处理负权边而 Dijkstra 不能？

> [!TIP]
> 思路Bellman-Ford 的不变量是「第 k 轮后，边数 ≤ k 的最短路全部正确」，它对边的处理顺序没有任何要求，只靠轮数上限覆盖所有简单路径——负权边只是让「更短的路」可能边数更多，轮数够了就能追上。Dijkstra 的不变量是「弹出即敲定」，依赖「绕路不更短」这个贪心前提，负权边让绕路的后半段可能变短，前提失效（反例见 10.1：a 在 3 被敲定时，经过 b 的 2 长度路径还没浮出水面）。

**2.** 0-1 BFS 为什么敢用双端队列替代堆？队列内部满足什么不变式？如果边权是 {0, 1, 2} 还能这么干吗？

> [!TIP]
> 思路不变式：队列从头到尾距离单调不减，且任意时刻只含两个相邻的距离档 d 与 d + 1。0 边产生的新点属于档 d（插队首），1 边产生的属于档 d + 1（插队尾），两档结构永不破坏，队首永远是最小档的成员——这正是 Dijkstra 需要的弹出序。{0, 1, 2} 会产生三个档位，双端队列只有两头可插，装不下；改用按距离分桶的 Dial 算法，或直接堆 Dijkstra。

**3.** 把 Bellman-Ford 的 dist 全部初始化为 0（而不是只有源点为 0、其余为 INF），跑完 n − 1 轮后再做第 n 轮检查，能检测到什么？

> [!TIP]
> 思路等价于添加一个「连向所有点、权 0」的虚拟超级源点：所有点从一开始就可达，于是第 n 轮的检查针对**全图任意负环**，而不是「从某个特定源点可达」的负环。这是 Johnson 全源最短路算法的第一步（用检测到的负环给所有边重赋权，消除负边后再对每个点跑 Dijkstra）。

**4.** 证明：MST 上 u 到 v 的路径，其最大边权不超过图中 u 到 v 任何路径的最大边权。

> [!TIP]
> 思路跑 Kruskal，u 与 v 首次连通发生在权 w\* 的那条边加入时；MST 树上 u→v 路径的每条边权都 ≤ w*（它们都加入于 w* 之前或就是它）。反设存在一条 u-v 路径的最大边权 w' < w*：该路径所有边都排在 w* 之前被处理，处理完它们时 u、v 已经连通，与「u、v 到 w\* 那条边才首次连通」矛盾。所以 w\* 是下界，MST 路径恰好达到它——这就是「瓶颈路径」问题的 MST 解法。

**5.** 把 A\* 的 h 从曼哈顿距离改成「2 × 曼哈顿距离」，会发生什么？最优性还保得住吗？

> [!TIP]
> 思路h 被放大后可能超过真实剩余代价（可采纳性被破坏），A\* 变成加权 A\*：扩展节点数明显减少、速度更快，但找到的可能不是最短路。可以证明解的代价不超过最优的 2 倍（h ≤ 2 × 真实值 ⇒ 夸大倍数为 2 的界）。工程上的取法：对延迟敏感、允许小幅次优的游戏 AI 用 1.5 × h 或动态加权 h；要求严格最优（机器人规划、解谜）必须保持可采纳。

**6.** 多源 BFS 要求所有源点「同时出发」。如果每个源点有自己的初始代价（比如救援站 sᵢ 在时刻 tᵢ 才开始行动），逐层 BFS 还成立吗？怎么改？

> [!TIP]
> 思路不成立：初始值不同时，队列里的距离不再按层单调，FIFO 出队顺序失去「当前最小」的保证，先出队的点可能被后出队的点改进。改法：把初始入队的键从 0 换成 tᵢ，并用小顶堆按距离出队——这就是「多源 Dijkstra」，与多源 BFS 的关系和单源两算法的关系同构。若所有 tᵢ 相等，退化为普通多源 BFS。
