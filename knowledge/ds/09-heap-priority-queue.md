---
title: 堆与优先队列：不做全排序，也能反复取最值
order: 9
tags: 堆, 优先队列, TopK, 建堆, 延迟删除
summary: 一个只承诺堆顶、其余位置故意不排好的结构：两条性质、两个 sift 的不变式、建堆 O(n) 的推导，以及 TopK、对顶堆中位数、多路归并与延迟删除。
---

「反复取出当前最值」比它看起来普遍得多：操作系统挑下一个该运行的进程、Dijkstra 挑下一个该确定的节点、TopK 挑出最大的 K 个、定时器挑出最早到期的任务，都是同一个动作的变体。每次线性扫一遍是 O(n)，始终维持全序则插入也要 O(n)——都不便宜。堆走的是第三条路：只保证一个位置（堆顶）是对的，其余位置故意「不排好」，于是两者都落到 O(log n)。这是靠一条很窄的不变量做到的：父节点与两个孩子之间有序，兄弟之间无所谓。正因为窄，一次修改只需沿一条根到叶的路径修复，代价才压得住。这篇的重点不是堆的接口（一共只有三个函数），而是这条不变量与它撑起来的几个真实用法。

## 1. 优先队列：只关心「反复取当前最值」

优先队列（priority queue）是一个抽象数据类型（abstract data type，ADT），接口只有三件事：`push(x)` 插入、`peek()` 看最值、`pop()` 取出最值。它**不承诺**按序遍历、不承诺按键查找、不承诺「第 k 小」——需求只有一条：反复取当前最值。

### 1.1 三种朴素实现

| 实现 | push | peek | pop | 空间 | 适合什么 |
| --- | --- | --- | --- | --- | --- |
| 无序数组（追加到末尾） | 摊还 O(1) | O(n) | O(n)（扫一遍找最值，与末尾交换后删除） | O(n) | 只插入、极少取 |
| 有序数组（保持升序） | O(n)（插入要搬元素） | O(1) | O(1)（从一端弹出） | O(n) | 一次性建好、之后反复取 |
| 堆 | O(log n) | O(1) | O(log n) | O(n)，无指针 | 插入与取最值交替发生 |

三种结构都没有免费午餐，差别只在「把代价付在哪一步」：无序数组把代价推迟到 pop（插入时什么都不做，取最值时现场找），有序数组预先把信息量全部付清（插入移动 O(n) 个元素维持全序，换来 O(1) 取最值），堆只维持「半排序」，两头都是 O(log n)。具体量级：n = 10⁶ 个元素做 n 次 push 与 n 次 pop，前两者的操作总量在 10^12 量级，堆只有 4×10^7 步左右——四个数量级的差距，就是「选错结构」与「选对结构」的差距。

> [!NOTE]
> 堆不是「更快的排序」。如果需求是「一次性灌入全部数据，之后反复取最值且不再修改」，正确答案是排序一次（O(n log n) 加每次 O(1)），而不是建堆——堆只保证堆顶，其余部分无序，按顺序遍历堆得到的东西没有意义。堆的适用面是「插入与取最值交替发生」，也就是数据在动态变化。

## 2. 两条性质：形状与堆序

堆（binary heap）是「完全二叉树 + 堆序」的组合：形状管高度，堆序管顺序。

### 2.1 形状性质：完全二叉树

完全二叉树（complete binary tree）指：除最后一层外每层都填满，最后一层从左到右连续填、中间不留空位。它带来两个后果：**树高恰好是 ⌊log₂ n⌋**（不会像普通 BST 那样退化成链表，对比 [第 08 篇](08-bst-balanced-trees.md)），以及**可以用数组紧凑表示**（层序编号即下标，不需要任何指针）。

| 关系 | 公式 | 位运算写法 |
| --- | --- | --- |
| 节点 i 的左孩子 | 2i + 1 | (i << 1) + 1 |
| 节点 i 的右孩子 | 2i + 2 | (i << 1) + 2 |
| 节点 i 的父亲 | ⌊(i − 1) / 2⌋ | (i − 1) >> 1 |
| 最后一个非叶节点 | ⌊n / 2⌋ − 1 | n // 2 − 1 |

```text
下标:    0     1     2     3     4     5     6
数组: [ 10 | 20 | 30 | 40 | 50 | 60 | 70 ]

              10                 <- a[0]，堆顶
            /    \
          20      30             <- a[1] = 2*0+1, a[2] = 2*0+2
         /  \    /  \
       40    50 60    70         <- a[3] a[4] a[5] a[6]
i = 2（值 30）的孩子是 a[5] = 60 与 a[6] = 70；a[6] 的父亲是 (6-1) >> 1 = 2
```

「最后一个非叶节点是 ⌊n/2⌋ − 1」这条不显眼但很关键：它是自底向上建堆的循环起点（第 4 节）。

### 2.2 堆序性质：只约束父子

小顶堆（min-heap）里每个节点 ≤ 它的两个孩子，于是根是全局最小值；大顶堆（max-heap）反过来，根是全局最大值。关键在于这条约束有多窄：**只有父子之间有约定，兄弟之间、堂兄弟之间完全无序**。上面那棵树里 20 和 30 谁大谁小没有任何保证；把小顶堆的 `a[1]` 与 `a[2]` 整个交换，它仍是合法的小顶堆。为什么必须这么窄？因为「窄」才可能「局部修复」：插入一个元素时只有某条父子边可能违规，沿这条边交换一次就把违规点向上推一层，每层 O(1)，总共 O(log n)。任何更强的顺序承诺都会把修复范围扩大到别的子树——有序数组承诺全序，插入就得移动 O(n) 个元素；BST 承诺左右有序，删除就要旋转整条路径。

> [!IMPORTANT]
> 「堆顶是最小值」与「第二小在根的两个孩子里」是两个不同强度的结论。后者成立（证明见练习 2），但再往下就没有这种公式了：第 k 小的元素可能在堆的任意位置。所以「第 k 大」这类问题要么用堆维护 k 个候选（第 6 节），要么换别的结构，别指望从堆里「按顺序数」。

### 2.3 数组表示省掉了什么

指针版二叉树的每个节点要存左右两个指针（C 里 16 字节）加对象头，找父亲还得额外存父指针；数组版只有元素本身，找孩子是一次下标算术加一次数组读取，找父亲是 `(i-1)>>1`，遍历是顺序扫描而非指针追逐。n = 10⁶ 时的差距很具体：C 里指针版节点约 20~40 MB，数组版存 int32 只要 4 MB——这是「同一份数据能不能装进缓存」的区别（见 [第 02 篇](02-array-dynamic-array.md)）。代价是堆只能保持完全二叉树的形状，且容量需要连续内存。

## 3. 两个动作：sift-up 与 sift-down

堆的全部维护工作由两个十来行的循环完成。下面的实现直接操作 Python `list`，接口对齐标准库 `heapq`。

```python
def sift_up(a, i):
    """把 a[i] 上浮到堆序正确的位置。前提：除 a[i] 外其余部分已是合法小顶堆。"""
    x = a[i]
    while i > 0:
        parent = (i - 1) >> 1
        if a[parent] <= x:
            break
        a[i] = a[parent]          # 父亲下移，空出父位
        i = parent
    a[i] = x                      # 把 x 填回空位


def sift_down(a, i, n):
    """把 a[i] 下沉，n 是堆的有效长度。前提：a[i] 两个孩子的子树都是合法小顶堆。"""
    x = a[i]
    while True:
        left = 2 * i + 1
        if left >= n:             # 没有孩子，到底了
            break
        child = left
        right = left + 1
        if right < n and a[right] < a[left]:
            child = right         # 较小的那个孩子
        if a[child] >= x:         # 两个孩子都不比 x 小，位置合适
            break
        a[i] = a[child]           # 孩子上移，空出它的位置
        i = child
    a[i] = x


def heapify(a):
    """自底向上建堆，原地，O(n)。"""
    for i in range(len(a) // 2 - 1, -1, -1):
        sift_down(a, i, len(a))


class MinHeap:
    def __init__(self, items=()):
        self._a = list(items)
        heapify(self._a)

    def push(self, x):
        self._a.append(x)                        # 新元素放末尾，形状性质不破
        sift_up(self._a, len(self._a) - 1)       # 只有它可能小于父亲

    def pop(self):
        a = self._a
        if not a:
            raise IndexError("pop from empty heap")
        top = a[0]                               # 1. 取出堆顶
        last = a.pop()                           # 2. 末尾元素摘下（形状仍合法）
        if a:                                    # 3. 它补到根，然后下沉
            a[0] = last
            sift_down(a, 0, len(a))
        return top                               # 4. 长度已减一

    def peek(self):
        return self._a[0]                        # 空堆时 list 自己抛 IndexError


if __name__ == "__main__":
    import random
    rng = random.Random(1)
    data = [rng.randrange(10 ** 6) for _ in range(2000)]
    h = MinHeap(data)                            # heapify 建堆
    assert h.peek() == min(data)                 # 堆顶是全局最小
    assert [h.pop() for _ in range(2000)] == sorted(data)   # 弹出序列必须升序
    h = MinHeap()
    for x in data:                               # 逐个 push 也要得到同样的结果
        h.push(x)
    assert [h.pop() for _ in range(2000)] == sorted(data)
    print("ok")
```

### 3.1 循环不变式：为什么这样写是对的

**sift-up** 的不变式：**每一步之后，唯一可能违反堆序的位置就是当前节点**。把 `a[i]` 与父亲交换后，父位上换成了较小的值——它与自己的父亲可能违规（下一轮处理），但与两个孩子一定不违规（值变小了，作为父亲只会更容易满足「父 ≤ 子」）；位置 i 上换来的旧父值 u 满足 `u ≤ 原 a[i] ≤ i 的两个孩子`（前一个不等号来自交换前的父子序，后一个来自位置 i 本来就合法），所以 i 处也不违规。违规点每轮上移一层，直到根或父亲已经足够小。

**sift-down** 用同一个套路，但前提必须写清楚：**每一步之后，除当前空位以外，其余部分都满足堆序**。前提是「整棵树除根（或位置 i）以外已经是合法堆」——这正是 `pop()` 之后的情形。每轮把较小的孩子搬进空位，该孩子上位后显然 ≤ 它的兄弟、≤ 它自己的孩子（它原本就是一棵合法堆的根），于是空位下移一层，唯一的不确定点跟着下移；最后把 x 填进空位，此时 x ≤ 空位的两个孩子，而空位的父亲是上一轮刚搬上去的值且小于 x，所以也合规。

> [!NOTE]
> 建堆用的是**更弱的前提**：只要求「i 的两个孩子的子树是合法堆」，不要求整棵树是堆。此时 sift_down 可能暂时破坏 i 与它父亲的关系——例如 `a = [5, 10, 6, 1, 7]` 对 i = 1 做 sift_down 得到 `[5, 1, 6, 10, 7]`：以 i = 1 为根的子树是合法堆，整棵树却不是（1 < 父亲 5）。这不影响正确性，因为 heapify **自底向上**：父亲总在子节点之后被处理，前面留下的违规恰好会被后面的 sift_down 修好。这也解释了为什么建堆必须从 ⌊n/2⌋ − 1 倒着走。

### 3.2 复杂度与「弹出堆顶」的细节

| 操作 | 最坏 | 平均（随机插入） | 说明 |
| --- | --- | --- | --- |
| push（sift_up） | O(log n) | 约 1.28 层 | 最多上浮 ⌊log₂ n⌋ 层，每层 1 次比较 |
| pop（取堆顶） | O(log n) | — | 下沉最多 ⌊log₂ n⌋ 层，每层 2 次比较 |
| peek | O(1) | O(1) | 就是 `a[0]` |
| heapify（建堆） | O(n) | O(n) | 见第 4 节 |
| 查找任意元素 | O(n) | O(n) | 堆序对搜索没有剪枝能力 |
| 删除任意元素 | O(n) | O(n) | 先线性找到，再删（工程做法见第 9 节） |

「平均」那一列是实测的：随机顺序插入 10⁶ 个元素平均只上浮 1.281 层（理论值 Σ 1/(2^k − 1) ≈ 1.264），按降序插入时平均上浮 14.7 层（log₂10⁵ ≈ 16.6）。**「上浮层数是常数」正是第 4 节结论的伏笔。**

`pop()` 的四步与「从有序数组里删元素」完全不同：取出 `a[0]`（O(1)）；把末尾元素摘下来——不能删根后整体前移，那会同时破坏形状与堆序且代价 O(n)，而摘末尾不影响任何人的父子关系；把末尾元素补到根，形状性质立刻恢复；从根下沉修复唯一的违规点。

> [!TIP]
> 两个 `sift` 都用了「挖空 + 最后填回」的写法，而不是朴素的 `a[i], a[p] = a[p], a[i]` 交换。区别在写入次数：交换是每层 3 次赋值，挖空是每层 1 次加最后一次填回。对 int 差别不大，对 `str`、大对象或 C++ 的 `std::string` 这类移动昂贵的元素，常数差异很明显。

## 4. 建堆为什么是 O(n)

「n 个元素、每个最多下沉 log n 层」推出的 O(n log n) 是个错误结论，它把上界当成了普遍情况——绝大多数节点根本没有 log n 层可以下沉。设树是满二叉树（n = 2^k − 1），高度为 h 的节点有 (n+1)/2^(h+1) 个：

```text
  高度 h   节点数      每个节点的下沉层数上限
  0        ≈ n/2       0              （叶子，占了一半以上的节点）
  1        ≈ n/4       1
  2        ≈ n/8       2
  …
  k−1      1           k−1 = log2(n)
总下沉层数 = Σ_h  h · n / 2^(h+1)
           = (n/2) · Σ_h h / 2^h
           = (n/2) · 2        因为 Σ_{h≥0} h/2^h = 0 + 1/2 + 2/4 + 3/8 + … = 2
           = n
```

关键是最后一行那个级数收敛：**层数越深的节点越多，而它们的下沉上限越小，两者相乘正好把 log n 因子消掉**。整个建堆的下沉层数总量是 n 而非 n log n，加上每层一次比较与一次赋值，总操作数 2n 量级——仍与 n 同阶，记为 O(n)（对非满二叉树，这个和 ≤ 2n）。

代码实测验证（n = 2²⁰ = 1048576）：按层求和得到 Σ h·(高度为 h 的节点数) = 1048575 = 1.000n，其中高度 19 有 1 个节点、高度 18 有 2 个、高度 17 有 4 个，都符合 n/2^(h+1)。用降序输入（自底向上建堆的最坏输入）实测操作数：**自底向上 2.000n**（下沉 n 层，每层比较与赋值各一次），**逐个插入 36.0n**（≈ 2·log₂n·n）。「自底向上」就是从最后一个非叶节点 ⌊n/2⌋ − 1 倒着走到根，代码就是前面那个三行的 `heapify`。

墙钟对比（n = 2²⁰，纯 Python 实测）：

| 输入顺序 | 自底向上建堆 | 逐个插入建堆 | 倍数 |
| --- | --- | --- | --- |
| 随机 | 0.33 s | 0.46 s | 1.4x |
| 升序 | 0.14 s | 0.25 s | 1.8x |
| 降序（最坏） | 0.33 s | 2.19 s | 6.6x |

随机输入下只差 1.4 倍，这件事值得解释而不是含糊过去：逐个插入时新元素放在末尾，**它比父亲小的概率随深度指数衰减**，平均只上浮 1.28 层（第 3.2 节实测），所以随机输入下的总量也是 O(n)。O(n log n) 是它的**最坏**界，而最坏在真实数据里很容易撞上：一份已经排好序或逆序的数据就能让每个新元素都上浮到根，差距立刻放大到 6.6 倍。

> [!IMPORTANT]
> 建堆是 O(n) 的前提是「自底向上」。把同一批元素用 `push` 逐个插进去是 O(n log n)，最坏输入下差一个 log 因子。所以标准库都提供批量建堆（`heapq.heapify`、`BinaryHeap::from`、`make_heap`），有现成的就别用循环 push。

## 5. 堆排序

把「建堆 + 反复取堆顶」翻译成原地算法就是堆排序（heap sort）：

```python
def sift_down_max(a, lo, hi):
    """大顶堆的下沉，作用区间是闭区间 a[lo..hi]。"""
    x = a[lo]
    i = lo
    while True:
        child = 2 * i + 1
        if child > hi:
            break
        if child + 1 <= hi and a[child + 1] > a[child]:
            child += 1                     # 挑较大的孩子（大顶堆）
        if a[child] <= x:
            break
        a[i] = a[child]
        i = child
    a[i] = x


def heap_sort(a):
    """原地堆排序（升序），Θ(n log n) 最坏保证，O(1) 额外空间。"""
    n = len(a)
    for i in range(n // 2 - 1, -1, -1):     # 1. 自底向上建大顶堆，O(n)
        sift_down_max(a, i, n - 1)
    for end in range(n - 1, 0, -1):         # 2. 堆顶换到末尾，堆收缩一格
        a[0], a[end] = a[end], a[0]
        sift_down_max(a, 0, end - 1)        #    在 a[0..end-1] 上修复堆序
    return a


if __name__ == "__main__":
    import random
    rng = random.Random(42)
    for case in ([], [1], [2, 1], list(range(50)), list(range(50, 0, -1)), [5] * 40):
        assert heap_sort(case[:]) == sorted(case)   # 空、单元素、升序、逆序、全相等
    arr = [rng.randrange(1000) for _ in range(1000)]
    assert heap_sort(arr[:]) == sorted(arr)
    print("ok")
```

第 1 步建大顶堆（升序排序要先把最大值送到末尾），第 2 步每轮把堆顶与当前末尾交换、堆的有效区间收缩一格，再让新堆顶下沉。共 n − 1 轮，每轮 O(log n)。三个排序的横向对比：堆排序最坏 Θ(n log n)、额外空间 O(1)、缓存不友好；快排平均 Θ(n log n)、最坏 Θ(n²)、额外空间 O(log n)；归并排序最坏 Θ(n log n)、额外空间 O(n)、稳定。

### 5.1 为什么它实测常输给快速排序

n = 10⁶ 个随机整数，纯 Python 实测：堆排序 5.42 s，随机 pivot 的原地快排 3.70 s（1.47 倍），内置 `sorted`（Timsort，C 实现）0.36 s。慢的原因不只是常数，有结构性来源：

- **跳跃式访存**。sift_down 每层访问的下标是 `2i+1`、`2i+2`，节点间距按指数拉开，上层比较落在相隔很远的内存上；快排的分区是顺序扫描，几乎每次都命中刚读进来的缓存行。
- **比较次数更多、分支更难预测**。快排每划分一次平均做 n 次比较并定下 O(log n) 个元素的位置；堆排序每取一个最值都要 2·log n 次比较，而且「哪个孩子更小」「要不要继续下沉」都依赖数据，不像分区循环那样大部分时间在做同一件事。

### 5.2 那为什么还值得知道它

三个理由，都不是「跑得快」：**最坏保证**（C++ `std::sort` 的 introsort 就是快排 + 堆排序兜底，递归过深时切换，平时用快排的常数、出事时用堆排序的保证）；**O(1) 额外空间**（对数级递归栈在嵌入式、实时系统里也要算账）；**它是外部排序的零件**（数据大到内存装不下时，堆只需保留 K 个候选就能丢掉其余，这是快排做不到的）。

## 6. TopK：容量 K 的小顶堆

从 n 个元素里取最大的 K 个，用**容量为 K 的小顶堆**。方向容易记反，所以先把不变量说透：

> [!IMPORTANT]
> 不变量：**堆里始终保存着「目前见过的元素中最大的 K 个」，堆顶是这 K 个里最小的那个，也就是入选门槛**。于是处理新元素 x 的规则只有一句：x 比门槛大就顶掉门槛，否则直接丢弃。一条不变量同时解决了两件事——既留住大的，又知道什么时候该丢。

```python
import heapq
from itertools import islice


def top_k_stream(nums, k):
    """流式求最大的 k 个：容量为 k 的小顶堆，堆顶就是入选门槛。

    不变量：处理完前 i 个元素后，堆里恰好是已见元素中最大的 min(i, k) 个。
    nums 可以是 list，也可以是一次性迭代器。
    """
    if k <= 0:
        return []
    it = iter(nums)
    heap = list(islice(it, k))             # 前 k 个作为初始候选
    heapq.heapify(heap)                    # O(min(n, k))
    for x in it:                           # 接着读剩下的，绝不重扫已读部分
        if x > heap[0]:                    # 门槛过滤：不超过堆顶的直接丢
            heapq.heapreplace(heap, x)     # 弹出堆顶并压入 x，一次 O(log k)
    return sorted(heap, reverse=True)      # 需要有序输出时才排这 k 个


if __name__ == "__main__":
    import random
    rng = random.Random(2026)
    for n, k in ((0, 3), (5, 5), (100, 3), (100, 50)):
        data = [rng.randrange(1000) for _ in range(n)]
        assert top_k_stream(data, k) == sorted(data, reverse=True)[:k]
    assert top_k_stream(iter([3, 1, 4, 1, 5, 9, 2, 6]), 3) == [9, 6, 5]
    print("ok")
```

复杂度 O(n log k)：前 k 个建堆 O(k)，之后每个元素一次门槛比较 O(1)，最坏情况每个都要下沉 O(log k)。空间是 O(k)，与 n 无关——这意味着 n 是一亿行日志时，只要 K = 100，内存里就只有 100 个元素。这正是「流式」两个字的含金量。

| 方法 | 时间 | 空间 | 会修改输入吗 | 支持流式 |
| --- | --- | --- | --- | --- |
| 容量 K 的小顶堆 | O(n log k) | O(k) | 否 | 是 |
| 全部排序后取前 K | O(n log n) | O(n) | 否（`sorted` 拷贝） | 否 |
| 快速选择（quickselect） | 平均 O(n)，最坏 O(n²) | O(1) | 是（原地分区） | 否 |

n = 10⁶、K = 100 的实测（纯 Python）：小顶堆 0.024 s，全排序 0.561 s，快速选择 0.294 s。堆快了 23 倍，原因不神秘：堆只维护 100 个候选，每来一个元素做一次比较；全排序要把 10⁶ 个元素排好，而其中绝大多数根本不需要有序。

选哪个看三条约束：**数据能不能一次拿到、要不要保留原数组**（快速选择会原地打乱数组，且形式上存在最坏 O(n²)）；**K 与 n 的比例**（K 与 n 同量级时堆退化成 O(n log n)，不如直接排序）；**数据是否流式**（数据一个一个来、不能回头时，另外两条路都断了，只能用堆）。这是 TopK 用堆的最硬理由，也是它在日志、监控、推荐场景里反复出现的原因。「数据流第 K 大」是它的同构问题：把返回值从 `sorted(heap, reverse=True)` 换成 `heap[0]`，堆顶就是答案，读满 K 个之前返回 `None`。

## 7. 多路归并：K 个有序序列合成一个

k 个各自有序的序列（大文件的一行行、k 个有序链表、k 个排好序的分片）要合成一个全局有序流。朴素做法每输出一个元素就扫一遍 k 个当前指针，总代价 O(N·K)；堆只用 k 个元素就够：

```python
import heapq


def merge_k(lists):
    """归并 k 个升序序列，返回升序生成器。堆里永远只有 k 个元素。"""
    iters = [iter(lst) for lst in lists]
    h = []
    for i, it in enumerate(iters):
        v = next(it, None)                  # 每路先取一个头元素
        if v is not None:
            h.append((v, i))                # (当前值, 路号)：路号保证元组可比较
    heapq.heapify(h)
    while h:
        val, i = heapq.heappop(h)           # 全局最小的那个出堆
        yield val
        nxt = next(iters[i], None)          # 同一路补上下一个
        if nxt is not None:
            heapq.heappush(h, (nxt, i))


if __name__ == "__main__":
    import random
    rng = random.Random(99)
    lists = [sorted(rng.randrange(100) for _ in range(rng.randrange(12)))
             for _ in range(6)]
    assert list(merge_k(lists)) == sorted(x for lst in lists for x in lst)
    assert list(merge_k([[1, 2], [], [3]])) == [1, 2, 3]
    print("ok")
```

每个元素进出堆各一次、每次 O(log k)，共 N 个元素，总计 O(N log K)，堆本身只占 O(k) 内存。堆里放 `(值, 路号)` 而不是裸值：路号既是「这个元素属于哪一路」的索引，也是打破平局的第二关键字。

实测（K = 1000 路、每路 1000 个元素，共 N = 10⁶）：堆 0.95 s，线性扫描 k 个指针 71.4 s，两两归并（每轮把 K 路合成 K/2 路）2.93 s。线性扫描慢了 75 倍，这正是 log K 与 K 的差别。两两归并与堆同阶但常数更大，而且堆是**流式**的：它不需要一次读入全部数据，只需每一路保持一个「下一个元素」。这一条决定了它的两个重量级用途：**外部排序**（内存装不下的大文件先分块排序写到磁盘，最后用 k 路归并合成一个有序输出流，归并阶段只需 O(k) 内存）与 **LSM 树（Log-Structured Merge tree）的合并**（写入攒成多个有序 SSTable，后台 compaction 就是不断把 k 个有序文件归并在一起，RocksDB、LevelDB、Cassandra 的读路径与 compaction 都建立在这个动作上，见 [第 16 篇](16-advanced-structures.md)）。

> [!NOTE]
> Python 标准库直接提供了 `heapq.merge(*iterables)`，实现与上面同构（内部用三元组延迟取下一元素，所以不必预先读完每一路）。自己写一遍的价值在于理解「堆里只放 k 个当前指针」这个不变式，生产代码直接用 `heapq.merge`。

## 8. 其他应用：为什么这些地方非堆不可

### 8.1 Dijkstra：取当前最近的未定节点

Dijkstra 的骨架是「每次从还没确定的节点里挑距离最小的那个」：用堆是 O(log V)，用线性扫描是 O(V)，整个算法从 O(V² + E) 变成 O((V + E) log V)（见 [第 13 篇](13-graph-shortest-path-mst.md)）。注意堆里存的是 `(距离, 节点)`，**同一个节点会被压入多次**（每次找到更短路径就压一次），靠「弹出时发现它不是最新版本」来跳过——这就是第 9 节的延迟删除，Dijkstra 是它最著名的用户。

### 8.2 任务调度与定时器

定时器的需求「找出最早到期的任务」与优先队列的定义完全重合：把 `(到期时刻, 任务)` 放进小顶堆，堆顶就是下一个该执行的任务。这类实现出现在事件循环（libuv）、任务队列（Celery、Redis 的延迟队列）、连接超时管理里。

```python
import heapq


class Scheduler:
    """堆 + 时间戳的定时器。取消任务用延迟删除：只记名字，不碰堆。"""

    def __init__(self):
        self._h, self._seq, self._canceled = [], 0, set()

    def schedule(self, when, name):
        self._seq += 1
        heapq.heappush(self._h, (when, self._seq, name))

    def run(self, until):                   # 取消：self._canceled.add(name) 即可，O(1)
        while self._h and self._h[0][0] <= until:
            when, _, name = heapq.heappop(self._h)
            if name in self._canceled:      # 延迟删除：出堆时才发现已取消
                self._canceled.discard(name)
                continue
            yield when, name


if __name__ == "__main__":
    s = Scheduler()
    for when, name in ((100, "report"), (30, "heartbeat"), (50, "cleanup")):
        s.schedule(when, name)
    s._canceled.add("cleanup")
    assert list(s.run(200)) == [(30, "heartbeat"), (100, "report")]
    print("ok")
```

两个工程细节：`_seq` 自增计数器保证「到期时刻相同」时元组比较不会落到任务名上（名字可能是不可比较的对象），同时让同刻任务的执行顺序稳定；取消任务不真的从堆里删除——定位任意元素是 O(n)，延迟删除把它变成 O(1)，代价是弹出时多做一次检查。

### 8.3 数据流中位数：对顶堆

「数据流中位数」看起来需要全序，实际上只需要两个最值。维护**两个堆**：大顶堆 `lo` 存较小的一半（堆顶是这一半的最大值），小顶堆 `hi` 存较大的一半（堆顶是这一半的最小值）。两条不变量：`max(lo) ≤ min(hi)`（值域不交叉）与 `len(lo) − len(hi) ∈ {0, 1}`（大小差不超过 1）。于是中位数只可能落在两个堆顶上。

```python
import heapq


class MedianFinder:
    """对顶堆（two heaps）：大顶堆存较小一半，小顶堆存较大一半。"""

    def __init__(self):
        self.lo = []      # 大顶堆：存负数
        self.hi = []      # 小顶堆：存原值

    def add(self, x):
        heapq.heappush(self.lo, -x)                       # 先无条件压入 lo
        heapq.heappush(self.hi, -heapq.heappop(self.lo))  # 再把 lo 最大值送给 hi
        if len(self.hi) > len(self.lo):                   # 平衡两堆大小
            heapq.heappush(self.lo, -heapq.heappop(self.hi))

    def median(self):
        if len(self.lo) > len(self.hi):
            return float(-self.lo[0])
        return (-self.lo[0] + self.hi[0]) / 2.0


if __name__ == "__main__":
    import random, statistics
    rng = random.Random(20260918)
    data = [rng.randrange(10 ** 6) for _ in range(2000)]
    mf = MedianFinder()
    for i, x in enumerate(data, 1):
        mf.add(x)
        assert len(mf.lo) - len(mf.hi) in (0, 1)         # 大小差不超过 1
        assert not mf.hi or -mf.lo[0] <= mf.hi[0]        # 值域不交叉
        assert mf.median() == statistics.median(data[:i])   # 与标准库中位数对照
    print("ok")
```

`add` 里「先压 lo 再转手」而不是「按大小决定放哪边」：任何新元素先进入 lo，lo 的最大值被推给 hi，此时 `max(lo) ≤ min(hi)` 自动成立，然后修大小。这样只需两条分支，比手写分类少一半边界情况。实测的意义：对顶堆 20000 次 `add` 用 0.019 s；而「每来一个数就整体排序」在 2000 个元素上就要 0.106 s——按 n² 量级外推，20000 个元素要 10 s 量级。**这是把全序需求降级为两个最值的典型回报。**

### 8.4 合并 K 个有序区间

给定 K 个「各自有序且互不重叠」的区间列表（例如 K 个分片的用户在线时间段），合成一个有序的不重叠区间列表：用第 7 节的 k 路归并（堆里放 `(起点, 哪一路, 路内下标)`）让区间按起点有序吐出，扫描时只需比较当前区间的起点与结果中最后一个区间的终点，重叠就合并。堆版本的优势是**不摊平**：K 个列表各自已经有序，不需要把 N 个区间搬进一个数组（N 可能是十亿条），只需要 K 个下标。本机实测 K = 500、N = 10⁶ 时堆版本 1.83 s、「摊平 + `sorted`」2.11 s——后者反而略快，因为 `sorted` 是 C 实现而堆循环在 Python 层。**复杂度只筛方案，常数才定胜负**，这一条在 [第 01 篇](01-complexity-analysis.md) 已经说过。

## 9. 延迟删除：不实现 decrease-key 也能改优先级

优先队列的教科书接口里常有一个 `decrease_key(x, k)`：把某元素的优先级调高。二叉堆实现它需要「元素到数组下标」的反向映射，元素每次移动都要同步更新映射——麻烦且容易出错（映射与数组不同步是这类代码的经典 bug 来源）。

工程上的标准做法是**根本不删、也不改，只压入新状态**：把 `(新优先级, 版本号, 键)` 压进堆，旧条目留着当垃圾；弹出时检查该条目是否仍然有效，过期就丢掉。这就是延迟删除（lazy deletion）。

```python
import heapq


class LazyMinHeap:
    """支持「删除任意键」与「修改优先级」的最小堆，靠延迟删除实现。堆里存
    (优先级, 版本号, 键)：版本号全局自增且唯一，元组比较永远不会落到「键」上。"""

    def __init__(self):
        self._h = []
        self._ver = {}          # 键 -> 当前有效条目的版本号
        self._next = 0          # 全局自增版本号
        self._size = 0          # 有效元素个数（不含垃圾条目）

    def push(self, key, priority):
        """插入；key 已在堆里时旧条目作废（等价于 decrease/increase-key）。"""
        self._next += 1
        if key not in self._ver:
            self._size += 1                 # 新键才计数，重复 push 算更新
        self._ver[key] = self._next
        heapq.heappush(self._h, (priority, self._next, key))

    def _prune(self):
        h, ver = self._h, self._ver
        while h:
            _, v, key = h[0]
            if ver.get(key) == v:           # 版本号对得上，是有效条目
                break
            heapq.heappop(h)                # 过期条目，丢掉

    def pop(self):
        self._prune()
        if not self._h:
            raise IndexError("pop from empty heap")
        prio, _, key = heapq.heappop(self._h)
        self._ver.pop(key, None)
        self._size -= 1
        return key, prio

    def discard(self, key):
        """删除任意键：只作废版本号，不碰堆里的物理位置。O(1)。"""
        if key in self._ver:
            del self._ver[key]
            self._size -= 1

    def __len__(self):
        return self._size


if __name__ == "__main__":
    h = LazyMinHeap()
    for p in range(100, 0, -1):
        h.push("task", p)                  # 同一个键插 100 次
    assert len(h) == 1 and h.pop() == ("task", 1)    # 堆里 100 条，99 条是垃圾
    h.push("a", 5)
    h.push("a", 0)                         # 改优先级：旧条目作废
    h.discard("a")                         # 删掉任意键也是 O(1)：作废版本号即可
    assert len(h) == 0
    print("ok")
```

版本号必须是**全局**自增，而不是每个键各自计数。考虑「键被删掉后重新插入」：如果版本号重置为 1，堆里残留的、版本号恰好也是 1 的旧条目就会被误判为有效，返回一个早就该丢的值。全局单调递增让「旧」和「新」的判断永远有效。

### 9.1 Dijkstra 的两种写法

延迟删除最著名的用户是 Dijkstra。两种写法效果相同，区别只在「垃圾由谁清理」：第一种什么也不删，靠 `done` 集合跳过旧条目；第二种把「校验」交给 `LazyMinHeap` 的版本号。

```python
import heapq


def dijkstra(graph, src):
    """堆 + 「弹出时检查是否已确定」：不做删除，旧条目出堆时跳过。"""
    dist = {src: 0}
    h = [(0, src)]
    done = set()
    while h:
        d, u = heapq.heappop(h)
        if u in done:                   # 迟到的旧条目，丢掉
            continue
        done.add(u)
        for v, w in graph.get(u, ()):
            nd = d + w
            if v not in dist or nd < dist[v]:
                dist[v] = nd            # 旧条目留在堆里，等它被弹出时丢弃
                heapq.heappush(h, (nd, v))
    return dist


def dijkstra_versioned(graph, src):
    """用 LazyMinHeap 的版本号做真正的「替换」：同键重复 push，旧版本自动作废。"""
    h = LazyMinHeap()
    dist = {src: 0}
    h.push(src, 0)
    while len(h):
        u, d = h.pop()
        if d > dist.get(u, float("inf")):   # 校验：不是最新的距离就跳过
            continue
        for v, w in graph.get(u, ()):
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                h.push(v, nd)
    return dist


if __name__ == "__main__":
    g = {0: [(1, 1), (2, 4)], 1: [(2, 2), (3, 6)], 2: [(3, 3)], 3: []}
    expect = {0: 0, 1: 1, 2: 3, 3: 6}
    assert dijkstra(g, 0) == expect
    assert {k: v for k, v in dijkstra_versioned(g, 0).items()
            if v < float("inf")} == expect
    print("ok")
```

### 9.2 垃圾的代价

延迟删除不是免费的：过期条目会在堆里积累，直到 `pop` 时才发现并丢弃。粗测一个量级：一张 V = 2000、E = 12000 的随机图，延迟删除版 Dijkstra 一共弹出 3122 次，其中有效 1998 次、垃圾 1124 次——**垃圾占总弹出次数的 36%**，时间和空间都多花了约五成。

什么时候必须换成真正的删除或重建？**内存敏感**时（垃圾一直占着内存，做法是定期 `heapify` 重建，或垃圾比例超过阈值就重建）；**键的更新极其频繁**时（每次更新都留一条垃圾，堆持续膨胀）。其余情况就用它——延迟删除的真正价值是**实现复杂度**：不需要反向映射，不需要在每次交换时同步映射，代码短一半、bug 少一半。

> [!CAUTION]
> 用延迟删除必须有一个**可靠的「过期判定」**。常见做法有三种：版本号（适合同键多次更新）、时间戳（适合缓存与定时器，`now > expire_at` 就丢）、状态标志（适合「已完成/已取消」，例如调度器里的 `_canceled` 集合）。判定条件写错的典型后果不是崩溃，而是静默返回已经作废的旧值。

## 10. 堆的变体：知道它们存在，知道什么时候用不上

| 变体 | 关键改动 | decrease-key | 现实处境 |
| --- | --- | --- | --- |
| 二叉堆 | 基准 | O(log n) | 标准库的选择，常数最小 |
| d 叉堆（d-ary heap） | 每个节点 d 个孩子 | O(log_d n) | 树高变矮，每层要比较 d 个孩子，d 常取 4 或 8 |
| 斐波那契堆 | 根链表 + 惰性合并 | 摊还 O(1) | 理论最优，实现复杂、常数极大，实践中几乎不用 |
| 配对堆（pairing heap） | 自调整的简单结构 | 摊还 O(log n) | 实现比斐波那契堆简单得多，某些场景可用 |
| 二项堆（binomial heap） | 二项树森林 + 合并 | O(log n) | 教学上的过渡形态，工程中基本被二叉堆替代 |

**d 叉堆**是唯一「工程上真的会调」的参数。d = 4 或 8 时树高从 log₂ n 降到 log_d n，每层要多比较 d − 1 次（线性扫描找最小孩子），但**层的访存位置更集中**（d 个孩子在数组里连续）。Python 里则是另一个机制在起作用：`min(a[first:last])` 能在 C 层完成 d 次比较，跳过解释器循环。实测（n = 10⁶，建堆 + 全部弹出）：d = 2 用时 6.74 s，d = 4 是 5.97 s，d = 8 是 5.68 s，d = 16 回落到 6.54 s；其中建堆阶段从 0.32 s 降到 0.12 s。d = 4~8 是这个实现里的甜点——**d 不是越大越好，比较次数与访存的权衡有最优点**。注意这测的是 Python；C 里常见的结论是 d = 4 附近、收益往往只是个位数百分比，所以「二叉堆够用」是大多数时候的正确答案。

**斐波那契堆与配对堆**的理论卖点是把 `decrease-key` 降到 O(1)（摊还），从而把 Dijkstra 从 O(E log V) 改进到 O(E + V log V)。但斐波那契堆每个操作的常数极大（指针多、缓存不友好），只有图非常稠密（E ≈ V²）时才可能追平二叉堆；而且第 9 节的延迟删除已经用另一种方式绕开了 decrease-key。**理论改进与实际收益之间的落差，是这个领域最著名的一课**：常数为 100 的 O(1) 打不过常数为 1 的 O(log n)，除非 n 大到 log n > 100。

## 11. 标准库对照

### 11.1 Python `heapq`：只有函数，没有类

`heapq` 是「算法作用于裸 list」的模块，**不提供堆类**：list 本身是堆的存储，你得自己保证不在堆里乱改元素。

| 函数 | 作用 | 什么时候用 |
| --- | --- | --- |
| `heapify(a)` | 原地建堆，O(n) | 一批数据一次性变成堆 |
| `heappush(h, x)` / `heappop(h)` | 插入 / 弹出堆顶，O(log n) | 单元素出入堆 |
| `heapreplace(h, x)` | 弹出堆顶并压入 x，返回被弹出的旧堆顶 | x 可能不属于堆（替换式场景） |
| `heappushpop(h, x)` | 压入 x 再弹出最小者，返回被弹出的值 | 保持数量不变；TopK 的标准写法 |
| `nlargest(k, it)` / `nsmallest(k, it)` | 取最大/最小的 k 个 | 一次性取 k 个，不必自己写 |

`heapreplace` 与 `heappushpop` 一字之差、语义相反，这是最容易记错的一对：

```python
import heapq

h = [1, 3, 5, 7]
heapq.heapify(h)
assert heapq.heapreplace(h, 0) == 1    # 先弹旧堆顶（1），再压入 0；返回 1
assert h[0] == 0                       # 0 确实进了堆

h = [1, 3, 5, 7]
heapq.heapify(h)
assert heapq.heappushpop(h, 0) == 0    # 先压 0，再弹最小者；0 被原样吐回
assert h[0] == 1                       # 堆内容不变
assert heapq.heappushpop(h, 100) == 1  # 旧堆顶被挤出去
# nlargest 的策略随 k 变化：k == 1 用 max()，k >= len(it) 用 sorted()，否则才是堆
assert heapq.nlargest(1, [7, 1, 9]) == [9]
assert heapq.nlargest(9, [7, 1, 9]) == [9, 7, 1]
assert heapq.nsmallest(2, [7, 1, 9]) == [1, 7]
```

实测一个常数差异：20 万次「替换堆顶」，`heappushpop` 用 0.021 s，`heappush` + `heappop` 用 0.054 s——2.5 倍，因为前者只走一次「下沉/上浮」，后者要走两次 O(log k) 路径。最大堆的两种常用做法：

```python
import heapq

h = [-x for x in (5, 1, 9, 3)]         # 做法一：存负数（数值专用）
heapq.heapify(h)
assert -heapq.heappop(h) == 9

h = []                                  # 做法二：元组取反（复合排序）
for name, prio in [("b", 2), ("a", 1), ("c", 2)]:
    heapq.heappush(h, (-prio, name))    # 优先级大的先出，同优先级按名字升序
assert [heapq.heappop(h) for _ in range(3)] == [(-2, "b"), (-2, "c"), (-1, "a")]
```

元素不可取负时还有第三种做法：包一层定义了 `__lt__` 反向比较的类，代价是每次比较多一层方法调用。

### 11.2 C++ `priority_queue`：默认大顶堆

```cpp
#include <algorithm>
#include <cstdio>
#include <functional>
#include <queue>
#include <vector>

int main() {
    std::priority_queue<int> maxq;                    // 默认大顶堆
    for (int x : {5, 1, 9, 3}) maxq.push(x);
    if (maxq.top() != 9) return 1;

    // 小顶堆：显式给出容器与比较器
    std::priority_queue<int, std::vector<int>, std::greater<int>> minq;
    for (int x : {5, 1, 9, 3}) minq.push(x);
    if (minq.top() != 1) return 1;

    // 自定义比较器：语义是「a 是否排在 b 前面」，堆顶是按这个序最大的元素
    auto cmp = [](auto a, auto b) { return a.second > b.second; };
    using P = std::pair<int, int>;
    std::priority_queue<P, std::vector<P>, decltype(cmp)> pq(cmp);
    pq.push({1, 30});
    pq.push({2, 10});
    if (pq.top().second != 10) return 1;              // second 小的先出

    // priority_queue 没有迭代器，就用 make_heap 系列操作裸 vector
    std::vector<int> v{5, 1, 9, 3, 7};
    std::make_heap(v.begin(), v.end());               // 建大顶堆，O(n)，同 heapify
    v.push_back(0);
    std::push_heap(v.begin(), v.end());               // 末尾元素上浮，O(log n)
    std::pop_heap(v.begin(), v.end());                // 堆顶挪到末尾，其余重新成堆
    if (v.back() != 9) return 1;
    v.pop_back();                                     // 把已归位的 9 摘掉
    std::sort_heap(v.begin(), v.end());               // 反复 pop_heap，得到升序
    if (!std::is_sorted(v.begin(), v.end())) return 1;
    std::printf("ok\n");
    return 0;
}
```

`priority_queue` 是**容器适配器**（默认套在 `vector` 上），接口只有 `push`、`pop`、`top`、`size`、`empty`——没有迭代器、没有 `decrease-key`、不能删任意元素；要这些能力就用 `make_heap` 系列直接操作 `vector`，或者在它上面套延迟删除。

### 11.3 Rust `BinaryHeap`：最大堆，`Reverse` 翻转为最小堆

```rust
use std::cmp::Reverse;
use std::collections::BinaryHeap;

fn main() {
    let mut h: BinaryHeap<i32> = BinaryHeap::new();   // 默认最大堆
    for x in [5, 1, 9, 3] { h.push(x); }
    assert_eq!(h.peek(), Some(&9));

    let mut minh: BinaryHeap<Reverse<i32>> = BinaryHeap::new();   // 最小堆
    for x in [5, 1, 9, 3] { minh.push(Reverse(x)); }
    assert_eq!(minh.pop(), Some(Reverse(1)));         // Reverse 是零成本的比较翻转

    // from(vec) 是 O(n) 建堆；into_sorted_vec 直接给出升序（内部就是堆排序）
    let h = BinaryHeap::from(vec![5, 1, 9, 3, 7, 2]);
    assert_eq!(h.into_sorted_vec(), vec![1, 2, 3, 5, 7, 9]);

    // TopK 惯用法：容量 k 的最小堆，多了就弹掉最小的那个
    fn top_k(nums: &[i32], k: usize) -> Vec<i32> {
        let mut heap: BinaryHeap<Reverse<i32>> = BinaryHeap::with_capacity(k + 1);
        for &x in nums {
            heap.push(Reverse(x));
            if heap.len() > k { let _ = heap.pop(); }
        }
        let mut out: Vec<i32> = heap.into_iter().map(|Reverse(x)| x).collect();
        out.sort_unstable_by(|a, b| b.cmp(a));
        out
    }
    assert_eq!(top_k(&[3, 1, 4, 1, 5, 9, 2, 6], 3), vec![9, 6, 5]);
    println!("ok");
}
```

`BinaryHeap` 要求元素实现 `Ord`，自定义类型必须显式实现它。三种标准库的共同点在这里很清楚：都只提供「插入、看堆顶、弹堆顶」加一个批量建堆，**都没有删除任意元素或修改优先级的能力**——那些需求一律靠第 9 节的延迟删除在应用层解决。

## 12. 陷阱清单

- **堆的内部数组不是有序数组**。`heapify(a)` 之后 `a[0]` 是最小值，但 `a[1:]` 不是有序的，遍历堆得到的是「堆顺序」。要输出有序结果必须自己排（`sorted(h)`、`nlargest`），或用「反复 pop」的堆排序。
- **直接修改堆里的元素会破坏堆序**。`h[3] = 小值` 之后堆顶可能不再是全局最小，而所有后续操作都会给出错误结果。要改就「弹出后重插」，或用第 9 节的延迟删除。Python 的 `heapq` 根本不知道你改过什么——它只是几个操作 list 的函数。
- **`(priority, item)` 在优先级相同时会抛 `TypeError`**。优先级相等时元组比较会继续比较 `item`，若 `item` 不可比较（自定义对象、dict）就崩。解法是插入自增计数器：`(priority, next(counter), item)`——标准库自己在 `nsmallest` 内部就是这样装饰元素的。另外元组元素的类型必须自洽：`(0, "a")` 与 `(1, 2)` 放同一个堆里也会抛 `TypeError`（`int` 与 `str` 不能比较）。
- **`heapreplace` 和 `heappushpop` 别记混**。`heappushpop` 返回的是「x 与旧堆顶中较小的那个」，可能把 x 原样吐回来；`heapreplace` 一定丢掉旧堆顶、一定留下 x。TopK 用 `heappushpop`，替换式场景用 `heapreplace`。
- **`queue.PriorityQueue` 有锁开销**。它是线程安全版（内部一把 `threading.Lock` 加条件变量），单线程用它是纯浪费：实测 20 万次 push + pop，`heapq` 0.28 s，`PriorityQueue` 0.56 s，**约 2 倍**。多线程下也别指望它高效——真要用，考虑每线程一个 `heapq` 再做合并。
- **最大堆用「取负」的边界**。Python 的 `int` 不会溢出，可以放心取负；但 `float` 要注意 `-0.0` 与 `0.0` 相等、`NaN` 与任何值比较都是 `False`——NaN 一旦进堆，堆序的所有判断都会失效（`heapify([1.0, 2.0, nan, 0.5])` 之后堆顶可能是 `nan`）且不报错。跨语言更危险：NumPy 的 `np.int64(-2**63)` 取负会溢出（`overflow encountered in scalar negative`）并静默给出错误值。
- **把堆当有序结构用，或拿它做「全序」**。堆不提供「第 k 小的元素」、前驱后继、范围查询（那些属于平衡树或排序数组，见 [第 08 篇](08-bst-balanced-trees.md)、[第 17 篇](17-choosing-structures.md)）；需要按顺序处理全部元素时应排序一次，用堆反复 pop 虽然也是 O(n log n)，但常数更大、访存更差。堆的价值只在「只取一部分」或「边来边取」。
- **忘记 `heapify` 而用循环 `heappush`**。一批已知数据建堆是 O(n)，逐个插入是 O(n log n)，最坏输入下差 6 倍以上（第 4 节实测）。
- **空堆操作**。`heappop` 空堆抛 `IndexError`；C++ 里对空 `priority_queue` 调 `top()`/`pop()` 是未定义行为。事件循环、Dijkstra 这类「取到空为止」的代码应写成 `while h:`，而不是先 pop 再检查。

## 13. 小结

- 优先队列是「反复取当前最值」的 ADT。三种朴素实现各有取舍：无序数组把代价压在 pop（O(n)），有序数组压在 push（O(n)），堆把两头都压到 O(log n)，代价是放弃全序——堆只承诺堆顶。
- 堆 = 完全二叉树（形状，保证 O(log n) 高度且能用数组紧凑存储）+ 堆序（父 ≤ 子或父 ≥ 子，兄弟无序）。数组下标：孩子 `2i+1`/`2i+2`，父亲 `(i-1)>>1`。
- 两个 sift 的循环不变式：sift_up 每步之后「除当前节点外堆序成立」；sift_down 每步之后「除当前空位外堆序成立」（前提是整棵树除该位置外已是合法堆）。建堆用的前提更弱，必须自底向上才能保证正确。
- 建堆是 O(n) 而不是 O(n log n)：高度为 h 的节点约 n/2^(h+1) 个，总下沉层数 Σ h·n/2^(h+1) = n，log 因子被级数收敛消掉。实测 n = 2²⁰ 时总操作数 2.000n，逐个插入的最坏输入是 36n。
- 堆排序是「建堆 + 反复交换堆顶与末尾 + 收缩堆」，原地、Θ(n log n) 最坏保证、O(1) 额外空间；实测慢于快排（访存跳跃、比较次数多、分支难预测），但它是 `std::sort` 这类混合算法里「保底」的那一层。
- TopK 用容量 K 的小顶堆：不变量是「堆里是已见元素中最大的 K 个，堆顶是入选门槛」，O(n log k)、O(k) 空间、支持流式。「求最大的 K 个用小顶堆」这个方向必须记牢。
- 多路归并用 O(K) 的堆把 O(N·K) 变成 O(N log K)，是外部排序与 LSM 树 compaction 的骨架；对顶堆把中位数的全序需求降级成两个最值；定时器、Dijkstra、数据流第 K 大都是同一不变量的变体。
- 需要删除任意元素或改优先级时，工程标准做法是延迟删除（压入新状态 + 版本号/时间戳校验），而不是实现 decrease-key。代价是垃圾条目（实测随机图上约占弹出次数的 36%），收益是实现复杂度大幅下降。
- 变体里只有 d 叉堆值得调参（d = 4~8，收益是常数级）；斐波那契堆/配对堆的 O(1) decrease-key 理论上漂亮，但常数与实现复杂度让它在工程中几乎用不上——「理论改进」与「实际收益」的经典落差。

## 14. 练习

**1.** 一个长度为 n 的数组，要「反复取出当前最小值，并且随时可能插入新元素」，共做 m 次混合操作。分别用无序数组、有序数组、堆实现，写出总复杂度并说明 m 与 n 的比值如何影响选择。

> [!TIP] 思路
> 无序数组：插入摊还 O(1)、取最值 O(n)，总量 O(m·n)。有序数组：插入 O(n)、取最值 O(1)，总量 O(m·n)。堆：两者都是 O(log n)，总量 O(m log n)。所以只要 m 达到 log n 量级堆就赢，只有 m 极小时才该用无序数组。另有一种情形值得单独算：所有元素一开始就已知，建堆 O(n) 之后每次取 O(log n)，在「只取少量」时比先排序 O(n log n) 更划算。

**2.** 证明：小顶堆中第 2 小的元素一定在根的两个孩子里。

> [!TIP] 思路
> 设第 2 小的元素 v 位于 i ≠ 0。堆序给出 `a[parent(i)] ≤ v`；只要 parent(i) 不是根，`a[parent(i)] ≥ v` 也成立（根以外的元素都不小于 v），于是 `a[parent(i)] = v`。反复这个论证，可以沿路径上移到某个「父亲就是根」的节点，它的值仍是 v——所以 v 一定在根的两个孩子之一。注意有重复值时，第 2 小可能等于最小值。

**3.** 用聚合法解释：为什么自底向上建堆是 O(n)，而逐个插入建堆是 O(n log n)？

> [!TIP] 思路
> 自底向上：总代价 = Σ（每个节点实际下沉的层数）。高度为 h 的节点有约 n/2^(h+1) 个、最多下沉 h 层，所以总层数 ≤ Σ_h h·n/2^(h+1) = (n/2)·Σ_h h/2^h = (n/2)·2 = n。逐个插入：第 i 次插入最多上浮 log i 层，且最坏输入（降序数据）下真的上浮到这个量级，总代价 ≈ Σ log i = Θ(n log n)。区别在于前者是「多数节点在底层且下沉很少」，后者是「每次插入都可能上浮到根」。

**4.** n = 10⁷ 的日志里要实时给出「出现次数最多的 10 个 IP」，内存只有几 MB。给出方案、复杂度，并说明真正的瓶颈在哪。

> [!TIP] 思路
> 两段式：哈希表统计每个 IP 的计数；容量 10 的小顶堆维护「计数最大的 10 个」，每更新一个计数就与堆顶比较，O(log 10) = O(1)。总时间 O(n)（哈希 + 少量堆操作），堆空间 O(10)。与「统计完再全量 `sorted`」相比：全量排序是 O(U log U)（U 为不同 IP 数）且要保存全部条目，堆版只需「一遍流式 + 10 个候选」。**真正的瓶颈在第 ①步的内存**：U 可能远大于 10⁷/10 的直觉估计，需要用近似计数（Count-Min Sketch）或按哈希分片到多个文件分别处理再合并。

**5.** 下面的代码想把任务按优先级取出，但偶尔抛 `TypeError`，找出原因并修正。

```python
import heapq

class Task:
    def __init__(self, name):
        self.name = name

def schedule(tasks):
    h = []
    for name, prio in tasks:
        heapq.heappush(h, (prio, Task(name)))
    return [heapq.heappop(h)[1].name for _ in range(len(h))]
```

> [!TIP] 思路
> 元组比较在 `prio` 相等时会继续比较 `Task` 对象，而 `Task` 没有定义 `__lt__`，于是抛 `TypeError: '<' not supported between instances of 'Task' and 'Task'`。这个 bug 的特征是「大多数时候正常，一旦出现两个同优先级的任务就崩」。修正：加一个全局自增计数器作为第二关键字，`(prio, next(counter), Task(name))`，比较在第二项就分出胜负，永远不会碰到 `Task`。另一种修法是给 `Task` 实现 `__lt__`，但那要求同类对象可比较，且会破坏「同优先级按插入顺序」的稳定性。

**6.** 实现 LRU 缓存的淘汰顺序时，能不能只用堆？为什么？

> [!TIP] 思路
> 不能。堆维护的是「按插入时间/优先级的最值」，但 LRU 有一个堆做不到的操作：**每次访问都要把某个已存在元素的优先级提升为「最新」**。在堆里定位该元素是 O(n)，提升优先级又会破坏堆序（第 9 节的延迟删除可以绕过：每次访问压入一个新的时间戳条目，弹出时校验是否最新，代价是堆会膨胀到「访问次数」的量级）。经典解法是哈希表 + 双向链表：哈希表 O(1) 找到节点，双向链表 O(1) 把节点移到头部、O(1) 从尾部淘汰（对应 [第 06 篇](06-hash-table.md) 练习 7 提到的「哈希表 + 双向链表」组合）。堆只在淘汰依据是固定优先级、不需要每次访问更新时才合适。

**7.** 一个 O(1) decrease-key 的斐波那契堆把 Dijkstra 从 O(E log V) 改进到 O(E + V log V)。什么情况下这个改进是真实的？为什么实践中还是用二叉堆？

> [!TIP] 思路
> 改进只在 E 远大于 V（稠密图，E ≈ V²）时才可能显现，因为只有那时 log V 因子相对 E 的规模才显著；稀疏图 E ≈ V 时两者都是 O(V log V)。实践中不用它有三个原因：常数极大（指针操作多、访存随机，要 n 很大才摊平）；实现复杂（`decrease-key` 需要元素到节点的句柄，代码量是二叉堆的数倍且难调试）；延迟删除已经用另一种方式绕开了 decrease-key，代价只是堆里多出一些垃圾条目。结论：理论界的改进要经过「常数 × 实现成本」的折算才谈得上值不值。
