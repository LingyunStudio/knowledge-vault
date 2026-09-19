---
title: 排序：一条下界与十几种取舍
order: 14
tags: 排序, 比较排序, 非比较排序, 稳定性, Timsort
summary: 从比较排序的 n log n 下界出发，拆解十个经典算法各自的取舍，揭开 Timsort、Introsort、pdqsort 的工程内幕，并覆盖比较器契约、部分排序与外部排序。
---

排序大概是被背诵得最多、也被理解得最浅的算法主题：人人知道「快排 O(n log n)」，却少有人能回答——为什么归并排序非要一块额外的内存、标准库为什么不直接用「最快」的快排、给十亿个取值只有一百种的整数排序为什么不该动用任何比较。同一个问题的解法超过十种，每一种都在「时间 × 空间 × 稳定性 × 适应性 × 实现复杂度」的多维空间里占据不同的点；没有全能冠军，只有「在你的输入分布与资源约束下最合适」的那个。把十几个算法串成一张地图的，是这样一句话：比较排序存在 Ω(n log n) 的下界，想突破它就必须放弃「只能比较」这个前提——理解了它，排序就不再是背诵清单，而是同一约束下的路线选择。

## 1. 为什么排序值得一整篇

排序值得用一整篇来写，不因为它常见，而因为它同时是三件事：

1. **复杂度与取舍的最好教材**。同一问题、十几种解法，每一种都在平均/最坏/最好时间、额外空间、稳定性、原地性、适应性、实现难度这六个轴上占据不同的点。把这张网格填满，[第 01 篇](01-complexity-analysis.md)讲的四种复杂度语义、常数与缓存的代价就有了完整的实战样本——学别的算法很难找到这么齐全的对照组。
2. **标准库中最常用的算法**。你写的多数排序调用都发生在别人写好的实现里：Python 的 `sorted`、C++ 的 `std::sort`、Rust 的 `sort`。理解它们的实现策略（第 5 节），才能解释「同一份数据为什么有时 30 毫秒、有时 300 毫秒」这类现象，才能知道什么时候标准库不是答案。
3. **理论结果最直观的展示舞台**。算法理论里少有「证明不可能更快」的时刻，比较排序的下界 Ω(n log n) 是最著名也最直观的一个——不需要高深数学，一棵二叉树就够了（第 2 节）。

此外，排序是半数以上算法的预处理步骤：去重（排完扫一遍）、中位数与分位数、TopK、区间合并、扫描线、二分查找的前置。「先排个序」经常是把 O(n²) 的想法变成 O(n log n) 的那一步。

> [!IMPORTANT]
> 心智模型：一次比较只产出 1 比特信息（「小于」或「不小于」），而区分 n! 种输入排列需要 log₂(n!) 比特。整个排序算法的设计空间由此分成两半：在「每次比较 1 比特」的模型内逼近下界（归并、快排、堆排，3.1~3.7 节），或者从键本身的结构里免费获取信息（计数、桶、基数，3.8~3.10 节）。

## 2. 比较排序的下界：Ω(n log n) 从哪来

### 2.1 决策树：把「排序」画成一棵树

任何只靠比较的排序算法，执行过程都可以画成一棵二叉决策树。以 n = 3 为例（a、b、c 互异）：

```text
                  a < b ?
                 /       \
              yes         no
              /             \
           b < c ?         a < c ?
           /     \         /     \
         yes     no      yes      no
          |       |       |       |
        a < c ?  cab    b < c ?   cba
        /    \           /    \
      abc    acb       bac    bca
```

- 每个内部节点是一次比较，两个分支对应两种结果；
- 每个叶子是一种确定的输出排列。算法必须对**每一种**输入排列给出正确输出，而不同排列的输出不同、不能共用叶子，所以 n! 种排列至少对应 n! 个叶子。

高度为 h 的二叉树最多 2^h 个叶子，于是 2^h ≥ n!，即比较次数 ≥ 树高：

```text
h ≥ log₂(n!) = log₂1 + log₂2 + … + log₂n ≈ n·log₂n − 1.443·n + O(log n)

n = 10⁶ 时约 1.85×10⁷ 次比较——这就是比较排序的「物理常数」。
```

这解释了两件事：归并排序与堆排序的 O(n log n) 不是可以再被聪明优化的浪费，而是**模型内的天花板**；快排的平均 O(n log n) 也贴着下界，剩下的改进空间只有常数倍。

> [!NOTE]
> 平均情形同样逃不掉：n! 种排列等概率出现时，期望比较次数 ≥ 输出的熵 = log₂(n!)。连「平均能更快」这条路也被堵死了。

### 2.2 下界拦住了谁，放过了谁

三个方向的推论：

1. **换比较方式没用**。三路比较一次得到「小于/等于/大于」，相当于每次拿 log₂3 ≈ 1.585 比特，下界变成 log₃(n!) = log₂(n!)/log₂3——量级不变，仍是 Ω(n log n)。
2. **重复元素降低了信息量**。输入只有 k 个不同值时，需要区分的排列数从 n! 降为多重集排列数，信息量约 n·log₂k。三路快排（3.6 节）正是利用这一点，在大量重复时逼近 O(n log k)。
3. **想更快，唯一的出路是放弃「只能比较」**。键若是取值范围小的整数（计数排序）、分布均匀的数（桶排序）、定长位串（基数排序），就可以「按键值直接算位置」而不是「比大小试探」。这是 3.8~3.10 节的主角，适用边界在第 7 节展开。

还有一个隐含前提值得点明：这一切建立在比较器满足**严格弱序（strict weak ordering）**之上，否则「每个叶子对应一种排列」的论证本身就不成立。这个契约在第 6 节展开——它是 C++ 排序崩溃事故的头号来源。

## 3. 十个算法，十种取舍

下面每个算法都按同一张清单解剖：核心思想、可运行实现（每个代码块独立可跑，并与内置 `sorted` 随机对拍）、复杂度、稳定性、原地性、适应性、什么时候用。冒泡/选择/插入/希尔/快排就地修改并返回原列表，归并/计数/桶/基数返回新列表。

### 3.1 冒泡排序：教学价值大于实用价值

核心思想：从头到尾扫描，相邻逆序就交换，一趟下来最大值「沉」到末尾，重复 n−1 趟。唯一值得记住的优化是**提前结束**：本趟一次交换都没发生，说明已经有序，直接收工——这让最好情况降到 O(n)。

```python
def bubble_sort(a):
    """冒泡排序：相邻逆序对交换；本趟无交换即提前结束。就地修改并返回 a。"""
    n = len(a)
    for end in range(n - 1, 0, -1):      # 每趟把未排序段的最大值沉到 end
        swapped = False
        for j in range(end):
            if a[j] > a[j + 1]:
                a[j], a[j + 1] = a[j + 1], a[j]
                swapped = True
        if not swapped:                  # 一趟无交换 ⇒ 已有序，提前结束
            break
    return a


if __name__ == "__main__":
    import random
    for _ in range(300):
        b = [random.randint(-99, 99) for _ in range(random.randint(0, 50))]
        assert bubble_sort(b[:]) == sorted(b)
    assert bubble_sort([1, 2, 3, 4]) == [1, 2, 3, 4]   # 一趟即止：最好 O(n)
    print("bubble_sort ok")
```

平均 O(n²)、最好 O(n)（提前结束）、最坏 O(n²)；空间 O(1)；稳定（只交换严格逆序对，等值元素不相邻交换）；原地；适应性好但每一趟的交换太多了。它还是「交换次数 = 逆序对数」的极端样本——每次交换恰好消掉一个逆序对，逆序对最多 n(n−1)/2 个，这就是 O(n²) 的另一种看法。

什么时候用它：几乎不用。同样的逆序对数，插入排序每步只做一次赋值，冒泡每步要做三次。留下它的理由是教学：提前结束是「适应性」概念的最低配版本。

### 3.2 选择排序：交换最少，其他都不占

核心思想：每趟从未排序区间选出最小值，与区间头部交换。比较次数恒为 n(n−1)/2，与输入内容无关——毫无适应性；但**交换次数不超过 n−1**，是所有 O(n²) 算法里写入次数最少的。

为什么不稳定，看一个最小的反例 [5a, 5b, 2]（下标区分两个相等的 5）：

```text
第 1 趟：min = 2，与头部 5a 交换 → [2, 5b, 5a]
第 2 趟：无更小者，不动          → 5a 落到了 5b 后面：稳定性破坏
```

长距离交换会跨过中间的等值元素——这是选择排序不稳定的根源，后面希尔排序、堆排序的不稳定也是同一个原因。

```python
def selection_sort(a):
    """选择排序：每趟选出最小者放到前端；交换次数最多 n−1。"""
    n = len(a)
    for i in range(n - 1):
        m = i
        for j in range(i + 1, n):
            if a[j] < a[m]:
                m = j
        if m != i:
            a[i], a[m] = a[m], a[i]      # 长距离交换：跨过等值元素 ⇒ 不稳定
    return a


if __name__ == "__main__":
    import random
    for _ in range(300):
        b = [random.randint(-99, 99) for _ in range(random.randint(0, 50))]
        assert selection_sort(b[:]) == sorted(b)
    print("selection_sort ok")
```

什么时候用它：写入成本远高于比较成本的介质（对 Flash/EEPROM 的写入次数敏感的老场景），以及「跑 k 趟就停」能拿到前 k 小的部分结果的场合。通用场景被插入排序全面压制。

### 3.3 插入排序：小数组与近乎有序数据的赢家

核心思想：把 `a[i]` 插入左侧已有序的前缀，前缀中比它大的元素整体右移一格。

它有一个比 O(n²) 精确得多的刻画：**总移动次数恰为输入的逆序对数 I**——每次右移的元素都与 `a[i]` 构成一个逆序对，且每个逆序对恰好贡献一次移动。于是：

- 已有序：I = 0，只剩 n−1 次比较，O(n)；
- 逆序对数为 I 的输入：总代价 O(n + I)；
- 随机输入：期望 I ≈ n²/4，O(n²)。

「近乎有序」意味着 I 很小，插入排序几乎免费——这就是它成为 Timsort、Introsort、pdqsort 三家共同的小段处理器（第 5 节）的原因。常数同样占优：内层循环只有一次比较加一次赋值，顺序访存，近乎有序时分支几乎总是预测成功，还省掉了交换的第三次赋值。二分插入能把比较降到 O(n log n)，但移动次数不变——在移动主导成本的数组上没有意义。

```python
def insertion_sort(a):
    """插入排序：把 a[i] 插入左侧有序前缀；移动次数 = 逆序对数。"""
    for i in range(1, len(a)):
        x = a[i]                         # 挖坑法：取出待插元素，右侧整体右移
        j = i - 1
        while j >= 0 and a[j] > x:
            a[j + 1] = a[j]
            j -= 1
        a[j + 1] = x
    return a


if __name__ == "__main__":
    import random
    for _ in range(300):
        b = [random.randint(-99, 99) for _ in range(random.randint(0, 50))]
        assert insertion_sort(b[:]) == sorted(b)
    almost = list(range(1000))           # 近乎有序：10 处相邻扰动
    for _ in range(10):
        i = random.randrange(999)
        almost[i], almost[i + 1] = almost[i + 1], almost[i]
    assert insertion_sort(almost[:]) == sorted(almost)
    print("insertion_sort ok")
```

什么时候用它：n 小（十几到几十个元素，标准库的切换阈值通常在 16~64）；数据近乎有序；或者作为混合算法的底层零件。

### 3.4 希尔排序：给插入排序装上远距离搬运

插入排序的弱点是每次只把元素挪一格：逆序对多时，一个元素要被搬很多次。希尔排序（Shell sort）的观察是：**先用大步长把「隔很远」的子序列排好，元素就能一步跳过半个数组**；步长逐轮缩到 1 时，数组已近乎有序，最后一轮插入排序很便宜。

```python
def shell_sort(a):
    """希尔排序（Knuth 增量 1, 4, 13, 40, …, 3h+1）：先远距离粗排，再近距离细排。"""
    n = len(a)
    h = 1
    while h < n // 3:                    # 找到不超过 n/3 的最大增量
        h = 3 * h + 1
    while h >= 1:
        for i in range(h, n):            # 对所有间隔为 h 的子序列做插入排序
            x = a[i]
            j = i
            while j >= h and a[j - h] > x:
                a[j] = a[j - h]
                j -= h
            a[j] = x
        h //= 3
    return a


if __name__ == "__main__":
    import random
    for _ in range(300):
        b = [random.randint(-99, 99) for _ in range(random.randint(0, 50))]
        assert shell_sort(b[:]) == sorted(b)
    big = [random.randint(-10**6, 10**6) for _ in range(10000)]
    assert shell_sort(big[:]) == sorted(big)
    print("shell_sort ok")
```

**增量序列决定复杂度**——这是希尔排序最独特的一点，同一份代码换个增量就是不同的算法：

| 增量序列 | 最坏复杂度 | 备注 |
| --- | --- | --- |
| Shell 原始（n/2, n/4, …, 1） | O(n²) | 奇偶位置互不干扰，最坏退回平方 |
| Knuth（1, 4, 13, 40, …, 3h+1） | O(n^1.5) | 上面的代码所用 |
| Pratt（2^p·3^q） | O(n log² n) | 趟数太多，实测反而慢 |
| Ciura（1, 4, 10, 23, 57, 132, 301, 701） | 无证明，实测最快 | 更大的项按 ×2.25 外推 |

它为什么不稳定：大步长的搬运会跨过等值元素。反例 [5, 1₁, 1₂, 0] 按步长 2 分组：组一 (5, 1₂)、组二 (1₁, 0)，各组内排序后数组变成 [1₂, 0, 5, 1₁]——1₂ 已经越到了 1₁ 前面，后面的趟数不会再交换这两个相等的值。与选择排序同一根源：**长距离移动天然破坏稳定性**。

什么时候用它：嵌入式等「代码要小、不需要稳定、又想要亚平方复杂度」的场合；教学里「增量思想」的代表。通用库不会选它。

### 3.5 归并排序：用 O(n) 空间买稳定与可预测

核心思想：分成两半各自排好，再线性合并两个有序数组。递归式 `T(n) = 2T(n/2) + O(n)`，由主定理（[第 01 篇](01-complexity-analysis.md) 第 4 节）得 Θ(n log n)——**最好、平均、最坏完全一致**，不存在退化输入，这是快排用命换也换不来的性质。

稳定性从哪来：合并时两边相等就先取左边（代码里的 `<=`）。就这一处，但也只需这一处——归并的稳定性是「结构」给的，不像插入排序那样靠「不去动它」获得。

```python
def merge_sort(a):
    """自顶向下归并排序：返回新列表，稳定，O(n) 额外空间。"""
    if len(a) <= 1:
        return a[:]
    mid = len(a) // 2
    left = merge_sort(a[:mid])
    right = merge_sort(a[mid:])
    out, i, j = [], 0, 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:          # 相等取左：稳定性的全部来源
            out.append(left[i])
            i += 1
        else:
            out.append(right[j])
            j += 1
    out.extend(left[i:])
    out.extend(right[j:])
    return out


if __name__ == "__main__":
    import random
    for _ in range(300):
        b = [random.randint(-99, 99) for _ in range(random.randint(0, 50))]
        assert merge_sort(b) == sorted(b)
    print("merge_sort ok")
```

三个工程问题：

1. **合并为什么需要额外空间**。合并同时从前端消费两个数组、从前端写入输出，输出区域必然覆盖尚未消费的输入——原地做会自我覆盖。原地归并算法存在（基于旋转/块归并），但要么常数大 2~3 倍，要么时间升到 O(n log n)，所以实践宁可给 O(n) 缓冲；`std::stable_sort` 在内存不足时才退到原地版本。
2. **自顶向下与自底向上**。上面的代码是自顶向下递归；自底向上（bottom-up）从「每个元素自成一个有序段」开始两两合并，用循环消除递归栈。外部排序（第 9 节）和链表排序都用自底向上形态。
3. **链表归并为什么只要 O(1) 额外空间**。链表上合并只改指针、不搬元素，没有「覆盖」问题——O(n) 空间是数组顺序存储的代价，不是归并思想本身的（[第 03 篇](03-linked-list.md)）。这也是链表排序首选归并的原因：快排在链表上分区要额外结构，堆排的跳跃访存在指针追逐下更糟。

什么时候用它：要稳定、要可预测的最坏 O(n log n)、外部数据、链表。追求平均速度或内存紧张时让位给快排家族。

### 3.6 快速排序：实测最快的通用方案是怎么炼成的

核心思想：选一个基准（pivot），把数组分成小于/等于/大于三段，基准段就位，两侧递归。它没有归并那种每步均衡的结构，靠的是**期望均衡 + 极低的每步常数**。

先看两个经典分区（partition）的差异与陷阱：

```python
def lomuto_partition(a, lo, hi):
    """Lomuto：单扫描指针。返回基准最终位置 p，[lo,p) 小于它，(p,hi] 不小于它。"""
    pivot = a[hi]                        # 陷阱：固定取末尾
    i = lo
    for j in range(lo, hi):
        if a[j] < pivot:
            a[i], a[j] = a[j], a[i]
            i += 1
    a[i], a[hi] = a[hi], a[i]
    return i


def hoare_partition(a, lo, hi):
    """Hoare：双指针对向扫描，交换更少。返回切分点 j——j 不是基准的最终位置！"""
    pivot = a[lo]                        # 取左端点：两个指针都会被它拦下
    i, j = lo - 1, hi + 1
    while True:
        i += 1
        while a[i] < pivot:
            i += 1
        j -= 1
        while a[j] > pivot:
            j -= 1
        if i >= j:
            return j                     # 划分为 [lo..j] 与 [j+1..hi]
        a[i], a[j] = a[j], a[i]


if __name__ == "__main__":
    import random
    for _ in range(2000):
        b = [random.randint(0, 9) for _ in range(random.randint(1, 40))]   # 故意含大量重复
        lo, hi = 0, len(b) - 1
        c = b[:]
        p = lomuto_partition(c, lo, hi)
        assert c[p] == b[hi]
        assert all(x < c[p] for x in c[:p]) and all(x >= c[p] for x in c[p + 1:])
        if hi > lo:                      # Hoare 分区只在至少两个元素时被调用
            d = b[:]
            j = hoare_partition(d, lo, hi)
            assert lo <= j < hi          # 保证两段都非空：递归必终止
            v = b[lo]
            assert all(x <= v for x in d[:j + 1]) and all(x >= v for x in d[j + 1:])
    print("partitions ok")               # 递归用法：quicksort_hoare(a, lo, j) + (a, j+1, hi)
```

- **Lomuto**：单指针，逻辑直白，教科书默认款。两个陷阱：基准固定取末尾，**已有序输入每次都分出 0 与 n−2 两段，O(n²)**——这是现实中最容易踩的退化（把已排好的数据再排一遍）；大量重复元素时 `a[j] < pivot` 长期为假，分区头重脚轻，同样 O(n²)。
- **Hoare**：双指针对向扫描，交换次数约为 Lomuto 的三分之一，对有序输入反而分得均衡。陷阱在返回值：**j 不是基准的最终位置**，递归必须写 `[lo..j]` 与 `[j+1..hi]`；照 Lomuto 的习惯写成 `[lo..j−1]` 与 `[j..hi]`，在全等元素上死循环。

基准选择的阶梯：

| 策略 | 效果 | 代价 |
| --- | --- | --- |
| 固定端点 | 有序输入 O(n²) | 零 |
| 随机化 | 任何固定输入都是期望 O(n log n)，攻击者无法预知 | 每层一次随机数 |
| 三数取中 | 有序/逆序自动均衡，常数改善 | 仍可被 med3-killer 构造打败 |
| 中位数的中位数（BFPRT） | 最坏 O(n) 的分区保证 | 常数太大，只用于第 8 节的确定性选择 |

**三路分区**（荷兰国旗问题）专治大量重复：一次扫描把数组切成小于/等于/大于三段，等于段直接就位、不再递归，全等输入从 O(n²) 变 O(n)。**尾递归消除**专治栈深：朴素递归最坏 O(n) 层会爆栈，改成「先递归较小的一侧、较大的一侧留在循环里」，栈深压到 O(log n)。最坏 O(n²) 的三种构造（固定基准 + 有序、两路分区 + 全等、med3-killer）分别被随机化、三路分区、深度超限转堆排序（5.2 节）防御。

为什么实测快：分区内层循环就是「顺序读内存 + 一次比较 + 下标递增」，没有间接访存；每层分出的区间互不相交，越到下层缓存越热。这些常数叠加，让快排平均比堆排快 2~4 倍——5.3 节的 pdqsort 会把剩下的数据依赖分支也消掉。

```python
import random


def quicksort3(a, lo=0, hi=None):
    """三路快排：随机基准 + 只递归较小一侧（尾递归消除）。就地排序并返回 a。"""
    if hi is None:
        hi = len(a) - 1
    while lo < hi:
        pivot = a[random.randint(lo, hi)]
        lt, i, gt = lo, lo, hi           # 不变式：[lo,lt) 小于，[lt,gt] 等于，(gt,hi] 大于
        while i <= gt:
            if a[i] < pivot:
                a[lt], a[i] = a[i], a[lt]
                lt += 1
                i += 1
            elif a[i] > pivot:
                a[i], a[gt] = a[gt], a[i]
                gt -= 1                  # 换来的 a[i] 未知，i 原地不动
            else:
                i += 1
        if (lt - lo) < (hi - gt):        # 先递归较小一侧，另一侧留在循环里
            quicksort3(a, lo, lt - 1)
            lo = gt + 1
        else:
            quicksort3(a, gt + 1, hi)
            hi = lt - 1
    return a


if __name__ == "__main__":
    for _ in range(300):
        b = [random.randint(-99, 99) for _ in range(random.randint(0, 50))]
        assert quicksort3(b[:]) == sorted(b)
    dup = [7] * 10000 + [3] * 10000      # 大量重复：三路分区的用武之地
    assert quicksort3(dup[:]) == sorted(dup)
    print("quicksort3 ok")
```

什么时候用它：通用内存排序的默认答案——不需要稳定、平均性能优先。需要稳定换归并，需要硬性最坏保证换 Introsort/堆排。

### 3.7 堆排序：最坏保证与 O(1) 空间的代价

堆排序把数组当完全二叉树用：O(n) 自底向上建最大堆，然后反复「堆顶与末尾交换 + 下沉恢复堆序」。堆的内部机制——数组表示、sift-up/sift-down、建堆为什么是 O(n)——在 [第 09 篇](09-heap-priority-queue.md) 第 3、4 节，堆排序本身在第 5 节。这里只从排序的视角看它的账本：

- 卖点是**唯一的「最坏 O(n log n) + O(1) 额外空间」组合**：归并要 O(n) 空间，快排最坏 O(n²) 且栈深需要处理，堆排两头都占。
- 代价一：不稳定。下沉是长距离交换，与选择排序同款问题。
- 代价二：实测慢。sift-down 从 i 跳到 2i+1 再跳到 4i+3，访存跨度每层翻倍，缓存行基本用不满，比较分支还不可预测（[第 02 篇](02-array-dynamic-array.md) 讲过跳跃访存的代价）。C 量级的实现里，堆排序通常比快排慢 2~4 倍。

什么时候用它：要最坏保证的实时场景；内存极紧；以及作为 Introsort 的兜底零件（5.2 节）——快排深处发现退化时转堆排序，把 O(n²) 压回 O(n log n)。

### 3.8 计数排序：用值域换比较

如果键是范围 [lo, hi] 内的整数，就不必比较：数一遍每个值出现的次数（O(n)），前缀和算出每个值的最终位置区间，逆序填充输出。复杂度 O(n + k)，k = hi − lo + 1——和 n log n 没有任何关系。

```python
def counting_sort(a):
    """稳定计数排序，值域 [min, max]。返回新列表。O(n + k)。"""
    if len(a) <= 1:
        return a[:]
    lo, hi = min(a), max(a)
    cnt = [0] * (hi - lo + 1)
    for x in a:
        cnt[x - lo] += 1
    for i in range(1, len(cnt)):         # 前缀和：cnt[v] = 值 ≤ v 的元素个数
        cnt[i] += cnt[i - 1]
    out = [0] * len(a)
    for x in reversed(a):                # 逆序填充：稳定性的全部来源
        cnt[x - lo] -= 1
        out[cnt[x - lo]] = x
    return out


if __name__ == "__main__":
    import random
    for _ in range(300):
        b = [random.randint(0, 30) for _ in range(random.randint(0, 60))]
        assert counting_sort(b) == sorted(b)
    print("counting_sort ok")
```

三个要点：

1. **稳定性依赖逆序填充**。前缀和之后 `cnt[v]` 是「值 ≤ v 的元素个数」，即值 v 占据的最后一个槽位。逆序遍历时，同值元素按原序从后往前落位，先出现的拿到更靠左的槽。这个稳定性不是装饰：它是基数排序每一趟的零件（3.10 节）。
2. **值域 k 是硬约束**。计数数组占 O(k) 内存、总代价 O(n + k)：k 与 n 同量级时是线性；k = 10⁹ 而 n = 10⁶ 时，光开数组就要 4 GB，而快排只要约 2×10⁷ 次比较。k 相当于「内存放大倍数」，第 7 节展开。
3. **为什么要求整数**。数组下标必须是整数，浮点与字符串要先离散化成稠密整数——离散化本身有代价也可能有精度问题。前提不成立时，轮到桶排序。

什么时候用它：整数键、值域与 n 同量级；或作为基数排序的单趟零件。

### 3.9 桶排序：把均匀分布变成线性时间

思想：把值域均匀切成 m 个桶，每个元素按值算出桶下标（O(n)），桶内用插入排序，按桶序拼接。若输入近似均匀分布，每桶期望 O(1) 个元素（桶数取 Θ(n)），总代价**期望 O(n)**——绕开比较下界的方式不是更聪明的比较，而是「直接算位置」，只是这个位置依赖分布假设。

```python
import random


def bucket_sort(a, n_buckets=64):
    """桶排序：假设输入近似均匀分布于 [min, max]。返回新列表。
    桶内排序的标准选择是插入排序（3.3 节），此处用内置 sorted 代替以保持简短。"""
    if len(a) <= 1:
        return a[:]
    lo, hi = min(a), max(a)
    if lo == hi:
        return a[:]
    span = hi - lo
    buckets = [[] for _ in range(n_buckets)]
    for x in a:
        idx = min(int((x - lo) / span * n_buckets), n_buckets - 1)
        buckets[idx].append(x)
    out = []
    for b in buckets:
        out.extend(sorted(b))            # 每桶期望 O(1) 个元素：期望 O(n) 的来源
    return out


if __name__ == "__main__":
    for _ in range(100):
        b = [random.random() for _ in range(random.randint(0, 500))]   # 均匀：理想输入
        assert bucket_sort(b) == sorted(b)
    skew = [x * x for x in [random.random() for _ in range(500)]]      # 平方分布：聚在低桶
    assert bucket_sort(skew) == sorted(skew)
    print("bucket_sort ok")
```

最坏情况：所有元素落进同一个桶，桶内插入排序 O(n²)——均匀假设被打破（上面测试里的 x² 分布就把多数元素挤进低号桶）就是这种情况。桶内改用 O(n log n) 排序能保住最坏界，但期望优势也随之消失。它与计数排序的关系：计数是「每个值一桶」的特例，桶是「每个区间一桶」的推广，所以能处理浮点。

什么时候用它：键在已知区间上近似均匀（典型：[0, 1) 的浮点、归一化的分数）。分布未知或聚集时，用快排家族。

### 3.10 基数排序：按位分桶，彻底绕开比较

思想：把键拆成 r 位一组的「数字」，从低位到高位（LSD，least significant digit）逐位做一趟**稳定的计数排序**，d 趟之后整体有序。复杂度 O(d·(n + 2^r))，比较次数为零。

为什么 LSD 的每一趟都必须稳定：高位相同元素的相对顺序由低位趟决定。用两位数 [21, 13, 22] 走一遍：

```text
按个位（稳定）：21(1) → 22(2) → 13(3)
按十位（稳定）：13 → 21 → 22   ✓

假如第一趟不稳定，22 越到了 21 前面：
按个位（不稳定）：22 → 21 → 13
按十位（稳定）  ：13 → 22 → 21   ✗ 错序
```

「低位趟的成果必须被高位趟完整保留」——这就是稳定性在此的全部含义，也是 3.8 节逆序填充存在的理由。

```python
def radix_sort_lsd(a, bits=8):
    """非负整数 LSD 基数排序，base = 2^bits。返回新列表。负数与浮点见第 10 节。"""
    if len(a) <= 1:
        return a[:]
    base = 1 << bits
    mask = base - 1
    buf = a[:]
    top = max(a)
    shift = 0
    while top >> shift:                  # 还有更高位就再来一趟
        cnt = [0] * base
        for x in buf:
            cnt[(x >> shift) & mask] += 1
        for i in range(1, base):
            cnt[i] += cnt[i - 1]
        out = [0] * len(buf)
        for x in reversed(buf):          # 逆序填充：每一趟都必须稳定
            d = (x >> shift) & mask
            cnt[d] -= 1
            out[cnt[d]] = x
        buf = out
        shift += bits
    return buf


if __name__ == "__main__":
    import random
    for _ in range(100):
        b = [random.randint(0, 10**9) for _ in range(random.randint(0, 300))]
        assert radix_sort_lsd(b) == sorted(b)
    print("radix_sort_lsd ok")
```

**基数与位数的选择**是趟数与计数数组的权衡：r 位数字 → 计数数组 2^r 项、趟数 ⌈位数/r⌉。理论最优 r ≈ log₂n（趟数 ≈ 总位数/log n），实践中 r = 8（字节）最常用：256 项的计数数组稳稳待在缓存里，32 位整数 4 趟搞定。MSD（most significant digit）变体从高位开始递归分桶，适合**变长字符串**（桶内元素唯一或共享前缀时提前终止）；LSD 要求键定长——定长键的适用性见第 7 节，字符串的更多细节见 [第 15 篇](15-strings.md)。

什么时候用它：定长键（整数、IP、日期、定长字符串）且 n 很大。n 在几万以下时，趟数的常数通常让位给 Timsort。

## 4. 全家福对照表

适应性（adaptive）：输入已有的有序性能否转化为更少的代价。「同平均」指最好、最坏与平均同阶，代价由 n 与键的形状决定，与输入顺序无关。

| 算法 | 平均 | 最好 | 最坏 | 额外空间 | 稳定 | 原地 | 适应性 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 冒泡 | O(n²) | O(n) | O(n²) | O(1) | 是 | 是 | 有（提前结束） |
| 选择 | O(n²) | O(n²) | O(n²) | O(1) | 否 | 是 | 无 |
| 插入 | O(n²) | O(n) | O(n²) | O(1) | 是 | 是 | 极好，O(n + 逆序对) |
| 希尔 | 依增量 | O(n log n) | 依增量，Knuth 序列为 O(n^1.5) | O(1) | 否 | 是 | 弱 |
| 归并 | O(n log n) | O(n log n) | O(n log n) | O(n) | 是 | 否 | 无 |
| 快排 | O(n log n) | O(n log n) | O(n²) | O(log n) 栈 | 否 | 是（含栈） | 无 |
| 堆排 | O(n log n) | O(n log n) | O(n log n) | O(1) | 否 | 是 | 无 |
| 计数 | O(n + k) | 同平均 | 同平均 | O(n + k) | 是 | 否 | 与分布无关 |
| 桶 | O(n) 期望 | O(n) | O(n²) | O(n) | 是（桶内稳定时） | 否 | 依赖均匀分布 |
| 基数 LSD | O(d(n + r)) | 同平均 | 同平均 | O(n + r) | 是 | 否 | 与分布无关 |
| Timsort | O(n log n) | O(n) | O(n log n) | O(n) | 是 | 否 | 极好，run 感知 |
| Introsort | O(n log n) | O(n log n) | O(n log n) | O(log n) | 否 | 是（含栈） | 小段感知 |

三行速读：要稳定 → 归并/Timsort/计数/基数；要最坏保证且省内存 → 堆排；要平均最快 → 快排家族（而且应该直接用标准库的 Introsort/pdqsort）。

## 5. 工程内幕：标准库的排序是怎么炼成的

### 5.1 Timsort：为真实数据而生

Python 的 `sorted`/`list.sort`、Java 的对象排序、Rust 1.81 之前的稳定排序，用的都是 Timsort（Tim Peters，2002）。出发点是一个实证观察：**真实数据几乎从不随机**——日志按时间近乎有序、导出文件按主键成段有序、列表按编辑时间聚簇。对这种数据做快排是浪费。

四个机制：

1. **识别自然 run**。扫描一遍，把连续的升序段（允许相等）与严格降序段识别出来，降序段原地翻转（必须严格降序才能翻，否则等值元素会乱序、稳定性被破坏）。每个 run 内部已经有序，不用再排。
2. **minrun 取 32~64**。自然 run 太短时，用二分插入排序把它强行补长到 minrun。取法：对 n ≥ 64，取 n 的二进制最高 6 位（低位有丢弃则进一），结果落在 [32, 64]。为什么是这个区间：插入排序的甜点区就在这个量级，数据稳稳待在 L1 缓存里；同时 run 数量接近 n/32 ~ n/64 且 n/minrun 接近 2 的幂，合并树接近满二叉树，每趟都在合并等长的段，比较次数最少。
3. **合并栈的不变式**。run 压栈，栈顶三段 X、Y、Z 必须满足 `X > Y + Z` 且 `Y > Z`，不满足就合并较小的段。这个不变式让段长像斐波那契数列一样增长，保证合并始终发生在近似等长的段之间，栈深 O(log n)，绝无退化。
4. **galloping mode（跃迁模式）**。合并时若一侧连续赢 7 次，说明两段长度悬殊，逐个比较太亏——切换到 gallop：指数步长（1, 2, 4, 8, …）在另一侧定位插入点，然后整块拷贝。随机数据上命中率低，阈值自动上调、退回普通合并；一段远长于另一段时，比较次数从 O(m + n) 降到 O(m·log(n/m))。

复杂度的答案随之而来：整段有序（一个 run）时 O(n)；真实数据约等于识别 run 的 O(n) 加上按信息熵计费的少量合并；最坏由归并兜底 O(n log n)。Python 3.11 起合并策略换成 powersort（更平滑的合并树），Rust 1.81 起稳定排序换成 driftsort（Timsort 的现代重写）——run 识别加归并的骨架没变。

### 5.2 Introsort：给快排上保险

C++ `std::sort`（libstdc++）用的是 Introsort（Musser，1997）：**快排起步，发现不对劲就换人**。

1. 正常路径：三数取中的快排，段长 ≤ 16 时停止递归；
2. **递归深度超过 2·log₂n：整段转堆排序**。正常快排的期望深度约 1.39·log₂n，两倍余量几乎从不触发；一旦触发，几乎必然是 med3-killer 之类的构造输入——用慢 2~4 倍的堆排把 O(n²) 压回 O(n log n)；
3. **收尾：对整个数组跑一遍插入排序**。前面的快排保证每个元素距最终位置不超过 16，插入排序的 O(n + I) 恰好在这种「全局近有序、局部小乱」的数组上接近 O(n)。

于是 `std::sort` 的承诺是：平均快排的速度、最坏 O(n log n)、**不稳定**（要稳定用 `std::stable_sort`，那是归并，内存不足时退原地归并）、O(log n) 栈。glibc 的 qsort 长期是「归并优先、内存不足退快排」，近年换成了不分配内存的 introsort——各家的 qsort 大多同构。

### 5.3 pdqsort：模式判定与分支预测

pdqsort（pattern-defeating quicksort，Orson Peters，2016）是 Introsort 的现代升级，被 Go 1.19 的 `sort`、Boost.Sort 采用，Rust 1.81 起的非稳定排序 ipnsort 也是它的直系后裔。它在 Introsort 骨架上加了三层模式判定：

1. **检测已有序/全相等**：入口先检查序列是否已升/降序（O(n)），命中直接返回或翻转——best case O(n) 的来源；
2. **检测大量相等元素**：分区中发现等值元素占比高，切换到三路化的分区（3.6 节）；
3. **检测坏分区并破坏模式**：分区严重失衡（基准落在靠近两端的位置）的次数超过 log₂n 时，先随机打乱少量元素、破坏攻击者构造的模式，再不行才转堆排序。

最后是**无分支（branchless）分区**：用 min/max 之类的无分支指令完成交换，内层循环不再有依赖数据的分支——一次分支预测失误约 15~20 个周期，这类失误从内循环里整个消失。随机数据上比传统 introsort 再快 20%~50%；「实测最快」的桂冠如今属于 pdqsort 家族，而不是教科书快排。

### 5.4 为什么标准库比手写快

把几家的共同点抽出来：

- **混合策略感知数据形态**：Timsort 感知 run，Introsort 感知递归深度，pdqsort 感知模式——都在用小开销检测输入长什么样，再决定用哪套武器；
- **特化**：Java 对基本类型用双轴快排（相等的基本类型值不可区分，稳定性没有意义）、对对象用 Timsort（比较昂贵且要求稳定）；Python 的 `sorted` 把 key 只计算一次（第 10 节）；C++ 按类型的可平凡移动性选择搬运路径；
- **无分支与批量搬运**：pdqsort 的 branchless 分区、Timsort 的整块 memcpy 拷贝；
- **实测调优**：16 元素切换插入排序、minrun 取 32~64、gallop 阈值 7——每个魔数背后都是几十年的基准测试。

结论：**手写排序几乎必然比标准库慢**。能赢它的唯一方式，是利用标准库不知道的信息——键是 0~100 的整数（改计数排序）、数据近乎有序（先检查一遍，O(n) 完事）、只要前 K 个（第 8 节）。

> [!WARNING]
> 教科书快排（固定端点基准 + 两路分区 + 朴素递归）同时踩了三个坑：有序输入 O(n²)、大量重复 O(n²)、深递归爆栈。生产代码里排序的第一选项永远是标准库；要手写，至少把这三个坑补上。

## 6. 比较器的契约：严格弱序

### 6.1 定义与违反的后果

排序要求比较器 `comp(a, b)` 满足**严格弱序（strict weak ordering）**：

1. 非自反：`comp(a, a)` 恒为 false；
2. 非对称：`comp(a, b)` 为 true 时 `comp(b, a)` 为 false；
3. 传递：`comp(a, b)` 且 `comp(b, c)`，则 `comp(a, c)`；
4. 等价的传递性：`comp(a, b)` 与 `comp(b, a)` 均为 false（称为 a 与 b「等价」）时，任何与 a 等价的 c 也与 b 等价。

「等价」就是「这次排序里没被区分」——稳定性承诺的正是等价元素保持原序。违反契约的后果不是「结果有点怪」，而是标准库里那些依赖契约的**无守卫循环会冲出数组**：插入排序的最后一段不检查下标（契约保证哨兵在左边），分区循环不检查指针相遇（契约保证它一定相遇）。契约一破，全是未定义行为（UB）。

一个实测会出事的 C++ 写法：

```cpp
#include <algorithm>
#include <cstdio>
#include <vector>

int main() {
    std::vector<int> v(64, 7);           // 64 个相等的元素
    // 违反非自反性：相等的元素返回 true
    std::sort(v.begin(), v.end(), [](int a, int b) { return a <= b; });
    for (int x : v) std::printf("%d ", x);
    std::printf("\n");
    return 0;
}
```

实测结果（GCC 11.2，x86_64，`-O2`）：输入全是 7，stdout 吐出的却是 `0 0 7 7 7 …`——内存已经被写坏；同一程序换个运行时机，进程则以 0xC0000374（堆损坏）被系统直接终止。UB 就是这样：越界写落到哪里、进程是崩是活，每次运行都不一样。加 `-D_GLIBCXX_DEBUG` 重新编译，才能在第一次违规比较处得到干净精确的断言失败：

```text
Error: comparison doesn't meet irreflexive requirements, assert(!(a < a)).
```

罪魁是 `a <= b`：相等返回 true，违反第 1 条。另一类经典错误是**不一致比较器**：比较器读取外部可变状态（全局阈值、调用计数器），或被比较的字段在排序过程中变化——破坏第 3、4 条的传递性，结局同样是 UB，而且比 `a <= b` 更难排查，因为崩溃点离肇事点很远。

### 6.2 三路比较与 NaN

**Rust 的 `Ord::cmp` 返回 `Ordering`（`Less`/`Equal`/`Greater`）**，一次调用拿到全部三种关系，「`a <= b`」这种错误形态在类型上就写不出来。代价是 `f64` 因为 NaN 只实现 `PartialOrd` 不实现 `Ord`，对 `Vec<f64>` 调 `sort()` 直接编译失败，必须显式表态：`total_cmp`（把 NaN 归到固定一端）或 `partial_cmp().unwrap()`（遇 NaN panic）。C++20 的 `<=>`（三路比较运算符）同理。类型系统把 6.1 节的运行时崩溃变成编译期错误——这是 Rust 排序 API 最值得借鉴的设计。

Python 没有三路比较，NaN 以另一种方式展示契约的破坏：**它与任何值的比较都返回 false**。

```python
import math

vals = [3.0, float("nan"), 1.0, float("nan"), 2.0]
print(sorted(vals))      # 原样返回！所有比较都是 False，Timsort 判定「已有序」
print(sorted(vals, key=lambda x: (x != x, x)))   # 安全做法：NaN 归到固定一端
assert sorted(x for x in vals if x == x) == [1.0, 2.0, 3.0]
print("nan demo ok")
```

第一行不报错但毫无意义：1.0 排在了 3.0 后面。安全做法就是第二行的 key 技巧——先按「是否 NaN」分组（`x != x` 为真当且仅当 x 是 NaN），NaN 归到固定一端，正常值之间照常比较。

### 6.3 多关键字排序的两种做法

```python
from dataclasses import dataclass


@dataclass
class Record:
    score: int
    time: int
    name: str


records = [
    Record(80, 3, "a"), Record(90, 1, "b"),
    Record(80, 1, "c"), Record(90, 2, "d"),
]

# 做法 1：稳定排序串联——先排次关键字 time，再稳定排主关键字 score
chained = sorted(sorted(records, key=lambda r: r.time), key=lambda r: r.score)

# 做法 2：复合键——一趟完成
composite = sorted(records, key=lambda r: (r.score, r.time))

assert [(r.score, r.time) for r in chained] == [(r.score, r.time) for r in composite]
assert [r.name for r in composite] == ["c", "a", "b", "d"]

# 混合升降序：分数降序、时间升序——数值字段取负混进复合键
mixed = sorted(records, key=lambda r: (-r.score, r.time))
assert [r.name for r in mixed] == ["b", "d", "c", "a"]
print("multi-key ok")
```

两种做法结果一致，取舍不同：

- **稳定排序串联**：从次关键字到主关键字逐个稳定排序。每一趟可以换比较器、混用任意升降序（Python 的 `reverse=True` 不破坏稳定性——相等元素仍按原序）；代价是 N 趟 O(n log n)。3.10 节的基数排序就是它的极限形式：每个「位」一趟。
- **复合键**：一趟 O(n log n)，但所有关键字必须能放进同一个可比较的元组；混升降序靠数值取负（`-score`）这类技巧，字符串这类取不了负的字段只能回到串联法。

> [!TIP]
> 选择标准：关键字少且类型可比 → 复合键；关键字多、类型杂、或混升降序 → 串联。串联的顺序千万别反：**先排次关键字，最后排主关键字**——后一趟的稳定性保住前一趟的成果。

## 7. 非比较排序的适用边界

计数、桶、基数把时间压到线性，靠的是键的结构。一张决策清单：

1. **键的值域与位宽**。计数要 O(k) 内存：给 2³² 范围的 IPv4 地址做计数排序要 4 GB 计数数组，而基数排序 base 256 只要 4 趟、O(n) 缓冲。值域窄且稠密 → 计数；值域宽但定长 → 基数。
2. **内存放大**。计数数组 O(k)、基数缓冲 O(n + 2^r)：键很宽而 n 不大时（一百万个 64 位整数），比较排序的 O(1) 辅助空间可能反而赢——线性时间是用内存换的。
3. **稳定性**。LSD 基数与多级排序都需要稳定趟；不需要稳定时有更省内存的变体（不稳定的计数排序可以直接覆盖写、不用输出数组）。
4. **键是否定长**。LSD 要求所有键等长，不等长要补齐（padding），长度差异大时浪费明显；变长字符串走 MSD 基数或三向基数快排（[第 15 篇](15-strings.md)）。
5. **键是否可拆位**。整数天然可拆；浮点要按 IEEE 754 做位变换（第 10 节）；任意对象要先映射成整数（离散化），映射本身可能比排序还贵。

定长键的三个常见例子：IPv4 地址 = 32 位整数（base 256 四趟）；日期 `yyyymmdd` = 整数（或按年、月、日三个十进制段分桶）；定长编码串 = 每 r 个字符一趟。数据库与 GPU 的大规模整型排序大量使用基数排序，正因为键定长、n 大到趟数的常数可以忽略。

经验法则：k 与 n 同量级 → 计数；键 ≤ 8 字节且 n ≥ 10⁵ → 基数值得一试（与 Timsort 实测对比再定）；其余 → 比较排序家族。

## 8. 部分排序与选择：不必全排

需求经常只是「第 k 小」或「前 K 个」。全排序 O(n log n)，但这个问题本身只要 O(n)。

**快速选择（quickselect）**：快排只递归包含答案的那一侧，n + n/2 + n/4 + … < 2n——**平均 O(n)**。最坏 O(n²)（基准总选到极端值），随机化后攻击者无从构造；三路分区顺手处理重复元素：

```python
import heapq
import random
import time


def quickselect(a, k):
    """返回第 k 小（k 从 0 计）的值；平均 O(n)。就地打乱 a 的顺序。"""
    lo, hi = 0, len(a) - 1
    while True:
        pivot = a[random.randint(lo, hi)]
        lt, i, gt = lo, lo, hi
        while i <= gt:                   # 三路分区：等值区间一次定型
            if a[i] < pivot:
                a[lt], a[i] = a[i], a[lt]
                lt += 1
                i += 1
            elif a[i] > pivot:
                a[i], a[gt] = a[gt], a[i]
                gt -= 1
            else:
                i += 1
        if k < lt:
            hi = lt - 1                  # 只收缩包含 k 的那一侧
        elif k > gt:
            lo = gt + 1
        else:
            return a[k]                  # k 落在等值区间 [lt, gt]


if __name__ == "__main__":
    for _ in range(300):                 # 先对拍：正确性
        b = [random.randint(-999, 999) for _ in range(random.randint(1, 60))]
        k = random.randrange(len(b))
        assert quickselect(b[:], k) == sorted(b)[k]

    n = 1_000_000                        # 再实测：全排序 vs 部分排序
    random.seed(42)
    a = [random.random() for _ in range(n)]
    t0 = time.perf_counter()
    by_sorted = sorted(a)[:10]
    t1 = time.perf_counter()
    by_heap = heapq.nsmallest(10, a)
    t2 = time.perf_counter()
    kth = quickselect(a[:], 9)
    t3 = time.perf_counter()
    assert by_sorted == by_heap and kth == by_sorted[-1]
    print(f"sorted(a)[:10]          : {t1 - t0:.3f} s")
    print(f"heapq.nsmallest(10, a)  : {t2 - t1:.3f} s")
    print(f"quickselect（纯 Python） : {t3 - t2:.3f} s")
```

工程形态：C++ 的 `std::nth_element` 就是 introselect（快选 + 深度超限转堆选择），平均 O(n)、就地完成——求中位数、分位数都该用它而不是 `sort`。Python 没有内置快选，等价物是 `heapq.nsmallest(k, it)`：内部维护一个大小 k 的堆，O(n log k)，流式 TopK 的堆机制见 [第 09 篇](09-heap-priority-queue.md) 第 6 节。确定性的 **BFPRT**（中位数的中位数：5 个一组取中、再对中位数递归取中）保证最坏 O(n)，但常数是随机快选的数倍，实践中只在「必须给出最坏承诺」时用。

上面实测的输出（本机，Python 3.13，n = 10⁶ 个随机浮点、取前 10）：

| 方法 | 复杂度 | 实测 |
| --- | --- | --- |
| `sorted(a)[:10]` | O(n log n) | 0.33 s |
| `heapq.nsmallest(10, a)` | O(n log k) | 0.015 s |
| 纯 Python 快选取第 10 小 | O(n) 期望 | 0.36 s |

三行里两条教训：`nsmallest` 比 `sorted` 快约 22 倍——**部分排序的渐进优势是真的**；但纯 Python 的 O(n) 快选反而输给 C 实现的全排序——**实现语言的常数能吃掉一个量级的渐进优势**（[第 01 篇](01-complexity-analysis.md) 第 3 节的结论在此应验）。在 C++ 里用 `nth_element` 对照 `sort`，差距才会如实反映复杂度。

> [!IMPORTANT]
> 只要前 K 个（K ≪ n）：静态数据用 `nth_element`/快选（O(n)），流式数据用大小 K 的堆（O(n log K) 时间、O(K) 内存）。全排序是把 O(n log n) 的时间花在了一个不需要完整顺序的问题上。

## 9. 外部排序：内存装不下的时候

10 GB 的日志、1 GB 的内存——排序在内存装不下时改变性质：**比较的代价不再主导，I/O 才是**。两步走：

1. **分段排序成 run**：每次读入一块装得下的数据，内部排序（还是那套快排/Timsort），写成临时文件。10 GB / 1 GB = 10 个有序 run；
2. **K 路归并**：同时打开 K 个 run，每个维护一个读缓冲，用堆装「（当前元素，路号）」反复取全局最小写输出——堆的机制见 [第 09 篇](09-heap-priority-queue.md) 第 7 节。10 路、每路 1 GB，一趟归并完成。

Python 的 `heapq.merge` 就是现成的 K 路归并（支持 `key`）：

```python
import heapq
import random


def external_sort(items, run_size):
    """外部排序骨架：分段排序成 run（真实场景写临时文件），再 K 路归并。
    run_size 由内存决定；K = run 数，受内存里放得下的缓冲数限制。"""
    runs = []
    for i in range(0, len(items), run_size):
        runs.append(sorted(items[i:i + run_size]))   # ① 排序一段，写一个 run
    return list(heapq.merge(*runs))                  # ② 堆实现的 K 路归并


if __name__ == "__main__":
    data = [random.randint(0, 10**6) for _ in range(10000)]
    for run_size in (1, 17, 1000, 10000):
        assert external_sort(data, run_size) == sorted(data)
    print("external_sort ok")
```

三个工程要点：

1. **归并路数 K 受内存限制**。K 路 = K 个读缓冲 + 1 个输出缓冲 + 堆。缓冲越大，顺序 I/O 越充分，K 就越小；run 数超过 K 时只能**多趟归并**（每趟把 run 数除以 K），而每趟都要把全部数据读一遍写一遍——总 I/O = 数据大小 × 趟数。所以外部排序的全部优化方向就是：首趟 run 尽量大、归并趟数尽量少，再用双缓冲（一块在读、一块在算）把 I/O 与计算重叠。
2. **内部排序选型不变**。每一段仍是 Timsort/快排的逻辑，唯一区别是产出写回文件而不是内存。
3. **它无处不在**。LSM 树（LevelDB/RocksDB）的 memtable 写满后落盘成一个有序段（SSTable），后台 compaction 就是把若干有序段 K 路归并；数据库的 `ORDER BY` 内存不够时同样 spill 到磁盘、分段排序再归并；「`ORDER BY x LIMIT 10`」的优化就是把第 8 节的 TopK 堆放进这个流程。外部排序不是冷门知识，是存储引擎的日常。

## 10. 陷阱清单

- **key 与比较器的成本模型搞反**。Python 的 `sorted` 只调用 key 函数 n 次（decorate-sort-undecorate：先给每个元素算出键、排键、再还原），但比较发生 O(n log n) 次。把昂贵的提取逻辑放进 key 是对的——只算 n 次；用 `functools.cmp_to_key` 把同样的逻辑写进比较器，就会被执行 O(n log n) 次。能搬进 key 的逻辑一律搬进 key。
- **对不可比较类型排序**。`sorted([1, "a"])` 抛 `TypeError: '<' not supported between instances of 'int' and 'str'`；混入 `None` 同样炸。Rust 在编译期拒绝；C++ 大多也能在编译期查出，但 lambda 参数类型写错就是 UB。
- **`sort` 与 `sorted` 的副作用差异**。`list.sort()` 原地修改、返回 `None`——`a = a.sort()` 把列表变成 `None` 是经典事故；`sorted()` 返回新列表、接受任何可迭代。原地排序会波及共享同一列表的其他引用，团队代码里优先考虑无副作用的 `sorted`。
- **稳定性被忽视**。C++ 的 `std::sort` **不稳定**：按分数排序后，同分记录的相对顺序会被打乱——多级排序必须用 `std::stable_sort` 或复合键。Python 的排序稳定，但稳定只保证「等价元素保序」：串联顺序排反了（先主后次）照样乱（6.3 节）。
- **基数排序的负数与小数**。直接取字节对负数是错的（补码的符号位在最高位）。整数解法：整体平移到非负（平移保序），排完平移回来；浮点解法：按 IEEE 754 位变换——符号位为 0 的（非负数）翻转符号位、为 1 的（负数）全部取反，得到与浮点值同序的无符号整数；NaN 先剔除。
- **排序过程中修改数据或让比较器抛异常**。key/比较器中途抛异常会让 C++ 容器处于损坏状态；排序时其他线程改列表、或 key 函数带副作用，行为不可预期。

含负数与浮点的基数排序，可运行：

```python
import struct


def _radix_uint(a, bits=8):
    """非负整数 LSD 基数排序（内部零件，同 3.10 节）。"""
    if len(a) <= 1:
        return a[:]
    base = 1 << bits
    mask = base - 1
    buf = a[:]
    shift = 0
    while max(buf) >> shift:
        cnt = [0] * base
        for x in buf:
            cnt[(x >> shift) & mask] += 1
        for i in range(1, base):
            cnt[i] += cnt[i - 1]
        out = [0] * len(buf)
        for x in reversed(buf):
            d = (x >> shift) & mask
            cnt[d] -= 1
            out[cnt[d]] = x
        buf = out
        shift += bits
    return buf


def radix_sort_int(a, bits=8):
    """含负整数的 LSD 基数排序：整体平移到非负——平移保序——排完平移回来。"""
    if len(a) <= 1:
        return a[:]
    m = min(a)
    return [x + m for x in _radix_uint([x - m for x in a], bits)]


def float_to_uint(x):
    """IEEE 754 double → 同序的无符号整数（NaN 必须先剔除）。
    非负数：置符号位；负数：全部取反。两者都保序且负数整体落在非负数之前。"""
    (u,) = struct.unpack("Q", struct.pack("d", x))
    return u | (1 << 63) if u >> 63 == 0 else u ^ ((1 << 64) - 1)


def radix_sort_float(a, bits=8):
    """含负浮点的 LSD 基数排序：位变换映射成非负整数再排，排完映射回去。"""
    ks = _radix_uint([float_to_uint(x) for x in a], bits)
    out = []
    for u in ks:
        bits64 = u ^ ((1 << 64) - 1) if u >> 63 == 0 else u & ((1 << 63) - 1)
        out.append(struct.unpack("d", struct.pack("Q", bits64))[0])
    return out


if __name__ == "__main__":
    import random
    ints = [random.randint(-10**9, 10**9) for _ in range(500)]
    assert radix_sort_int(ints) == sorted(ints)
    fs = [random.uniform(-1000, 1000) for _ in range(500)] + [0.0, -0.0]
    assert radix_sort_float(fs) == sorted(fs)
    print("signed radix ok")
```

## 11. 小结

- 比较排序的下界 log₂(n!) ≈ n·log₂n − 1.44n 来自决策树论证：n! 种排列需要 n! 个叶子。想突破它，唯一出路是放弃「只能比较」。
- 没有全能冠军：插入统治小数组与近乎有序数据（O(n + 逆序对)），归并用 O(n) 空间买稳定与可预测，快排赢平均实测，堆排兜底最坏情况与内存，计数/桶/基数在键有结构时降到线性。
- 稳定性是「等价元素相对序不变」的承诺，来源是合并（相等取左）而非交换；长距离移动（选择、希尔、堆）天然破坏它；LSD 基数与多级排序都建立在稳定性之上。
- 标准库是混合策略的产物：Timsort 感知 run、Introsort 用 2·log₂n 深度保险、pdqsort 靠模式判定与 branchless 分区。手写几乎必然更慢，能赢的只有「利用标准库不知道的信息」。
- 比较器的契约是严格弱序；违反它的 `return a <= b;` 在 C++ 里实测会写坏内存或以堆损坏崩溃。三路比较（Rust 的 `Ord`、C++20 的 `<=>`）从类型上消灭这类错误；NaN 必须显式归位。
- 只要第 k 小/前 K 个就不要全排：快选平均 O(n)，`nth_element` 是它的工程形态，流式 TopK 用大小 K 的堆（第 09 篇）。
- 内存装不下时分段排序成 run、再用堆做 K 路归并；路数受内存限制，趟数决定 I/O。LSM 树与数据库排序是同一套机制换了个名字。

## 12. 练习

**1.** 证明：插入排序的总移动次数恰等于输入的逆序对数 I，并据此解释「近乎有序的数组上它是 O(n)」。

> [!TIP]
> 思路处理 `a[i]` 时，内层循环每右移一个元素，那个元素就与 `a[i]` 构成一个逆序对；插入完成后这个逆序对被消除且不会再产生。所以每个逆序对恰好贡献一次移动，总数 = I。已有序时 I = 0，只剩每轮一次的比较，共 n − 1 次 → O(n)。可检验：对随机数组统计移动次数，与暴力数逆序对的结果一致。

**2.** Python 的 `list.sort(reverse=True)` 对相等元素保序吗？这个性质对多级排序意味着什么？

> [!TIP]
> 思路保序。`reverse=True` 等价于「比较时反转结果」，而不是「排完再整体翻转」，相等元素仍按原序（官方文档明确保证）。因此「部门内按工资降序」可以直接：先 `sorted(员工, key=工资, reverse=True)`，再稳定 `sorted(·, key=部门)`——不需要给工资取负。

**3.** 构造一个让「固定取末尾为基准的 Lomuto 快排」退化为 O(n²) 的输入；再说明随机化防御住了什么、防不住什么。

> [!TIP]
> 思路任何已有序（或逆序）数组：每次分区分出 0 与 n−2 两段，递归深度 n。随机化基准后，任何**固定**输入的每个分区都是期望均衡的，攻击者无法预知随机数；但随机化防不住两路分区在全等元素上的退化（需要三路分区），也防不住比较器本身违反严格弱序（那是 UB，见第 6 节）。

**4.** 把计数排序的填充循环从 `for x in reversed(a)` 改成 `for x in a`（正序），结果还正确吗？还稳定吗？如何用实验验证？

> [!TIP]
> 思路仍正确：前缀和的含义没变，同值元素仍会填进属于自己的槽位区间，只是顺序颠倒——先出现的元素拿到区间最右的槽，同值元素整体逆序，稳定性没了。验证：用 `(值, 原下标)` 的二元组做输入，排序后检查原下标在等值段内是否仍递增；正序版会递减。

**5.** 给 10⁶ 个 IPv4 地址（32 位整数）排序：内存够放 4 MB 数据时怎么做？如果只有 64 KB 呢？

> [!TIP]
> 思路4 MB 恰好装下：数据在内存里，计数排序不可行（2³² 项计数数组约 16 GB），但基数排序 base 256 只要 4 趟、计数数组 256 项，O(n) 时间；原地快排也可以。64 KB 装不下：外部排序——每次读约 16 K 个元素（64 KB / 4 B），排序写成一个 run；归并时每路缓冲约 8 KB，可开 6~8 路，10⁶ 个元素约 61 个 run，需要 2 趟归并（61 ÷ 8 ≈ 8 个中间 run，再归并一次）。

**6.** 为什么 `sorted(rows, key=lambda r: expensive(r))` 里 `expensive` 只执行 n 次，而 `sorted(rows, key=cmp_to_key(lambda a, b: expensive(a) - expensive(b)))` 里的提取逻辑会执行 O(n log n) 次？把后者改写成前者。

> [!TIP]
> 思路CPython 的排序先对每个元素调用一次 key、把 `(key, 原元素)` 成对放好，再只比较键（decorate-sort-undecorate），所以 key 是 n 次；`cmp_to_key` 的函数在每次比较时执行，共 O(n log n) 次。改写：`sorted(rows, key=lambda r: expensive(r))`——比较逻辑变成键之间的 `<`，昂贵部分只算一次。

**7.** `sorted([3.0, float("nan"), 1.0])` 不抛异常但结果无意义，为什么？给出两种安全处理方式。

> [!TIP]
> 思路NaN 与任何值的比较都返回 false，严格弱序的非自反与传递性同时被破坏，排序决策树失效（实测这组输入被 Timsort 判定为「已有序」原样返回）。处理：①先分离——`sorted(x for x in vals if x == x)`，NaN 单独处理；②归位——`sorted(vals, key=lambda x: (x != x, x))`，把 NaN 稳定排到固定一端；Rust 里对应 `f64::total_cmp`。

**8.** K 路归并的 K 由什么决定？内存 1 GB、每路读缓冲 8 MB，最多多少路？如果 run 数超过 K 会发生什么？

> [!TIP]
> 思路K ≤ (可用内存 − 输出缓冲 − 堆) ÷ 每路缓冲，1 GB / 8 MB ≈ 125 路（留出输出缓冲取 120 左右）。run 数超过 K 时做**多趟归并**：每趟把 run 数除以 K，直到剩 1 个；总 I/O = 数据大小 × 趟数。所以增大 K（减小缓冲）和增大首趟 run（换更大内存或先压缩）是仅有的两个方向，二选一时优先保证顺序 I/O 的缓冲不至于小到退化成随机读。
