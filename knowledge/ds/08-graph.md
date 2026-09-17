---
title: 图：万物皆可连
order: 8
tags: 图, BFS, DFS, 最短路
summary: 邻接表与矩阵、BFS/DFS 的本质区别、拓扑排序、Dijkstra——图论四大件的工程骨架。
---

城市路网、社交关系、任务依赖、状态转移——凡是"东西之间存在任意连接"的世界，都是图。前面所有结构都在某一维度受限（线性、层次），图彻底放开：**任意节点之间都可以有边**。

## 先定存储：邻接表 vs 邻接矩阵

| <br />   | 邻接矩阵 n×n  | 邻接表             |
| -------- | --------- | --------------- |
| 空间       | O(n²)     | O(n + m)（m 是边数） |
| 查边 (u,v) | O(1)      | O(deg(u))       |
| 遍历 u 的邻居 | O(n)      | O(deg(u))       |
| 适用       | 稠密图、要快速判边 | 稀疏图（现实世界几乎都是）   |

工程默认邻接表；矩阵只在小而稠密、或频繁"查某条边是否存在"时用。

```python
# 邻接表：节点 → [(邻居, 边权)]
from collections import defaultdict
graph = defaultdict(list)
graph["A"].append(("B", 5))    # 无向图则双向都要加
```

## BFS 与 DFS：探索顺序即算法性格

两者都访问全部 n+m 范围内的节点，O(n + m)，差别在**待探索的容器**：

- **BFS 用队列**：先探索近处，按层扩散——所以**无权图最短路 = BFS**（第一次到达时层数即最短距离）
- **DFS 用栈**（递归即隐式栈）：一条路走到底再回头——擅长找"存在性"、拓扑结构、连通分量

```python
# BFS：最短步数模板
from collections import deque
def bfs(start, target):
    q, dist = deque([start]), {start: 0}
    while q:
        u = q.popleft()
        if u == target: return dist[u]
        for v in graph[u]:
            if v not in dist:
                dist[v] = dist[u] + 1
                q.append(v)
    return -1
```

> [!TIP]
> BFS/DFS 的正确性全在**"访问过"标记**：入队/入栈时立刻标记（不是出队时），否则同一节点重复入队，复杂度爆炸。状态爆炸的网格/字符串问题同理：把"状态"当节点，把"一步转移"当边，照样 BFS——这就是很多搜索题的万能壳。

## 拓扑排序：依赖关系的线性化

有向无环图（DAG）上，把所有节点排成一个序列，使每条边都从前面指向后面——课程先修、构建顺序、任务调度全靠它。Kahn 算法：

1. 统计每个节点的入度，入度为 0 的（无前置依赖）进队列
2. 逐个出队、记入结果，并把它指向的节点入度减 1，减到 0 就入队
3. 结束时若结果不足 n 个，**图中有环**——这也是"检测循环依赖"的标准做法

O(n + m)。注意拓扑序不唯一，需要字典序最小等额外约束时用小顶堆替换普通队列。

## 最短路：按"有没有负权"选算法

- **Dijkstra**：无负权边，单源最短路，贪心——每次从待定集取最近的节点确定下来（用小顶堆），O((n+m) log n)
- **Bellman-Ford**：允许负权边，n-1 轮松弛所有边，O(nm)；还能检测负环。边数少时也能用队列优化的 SPFA
- **多源/边权全 1**：直接 BFS；两两之间的最短路矩阵，Floyd O(n³)

```python
import heapq
def dijkstra(src, n):
    dist = [float("inf")] * n
    dist[src] = 0
    pq = [(0, src)]                     # (当前距离, 节点)
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]: continue        # 过期条目，跳过
        for v, w in graph[u]:
            if d + w < dist[v]:
                dist[v] = d + w
                heapq.heappush(pq, (dist[v], v))
    return dist
```

> [!NOTE]
> Dijkstra 的"确定最近节点"依赖一个前提：**边权非负，则已确定节点的距离不可能再被更新**。有负边这个前提崩塌，贪心就错——这不是实现问题，是算法正确性边界。
