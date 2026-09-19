---
title: 二叉搜索树与平衡树：把最坏情况钉在 O(log n)
order: 8
tags: 二叉搜索树, 平衡树, AVL, 红黑树, B+树
summary: 从一个不变式推出 BST 的五种操作与退化风险，讲透 AVL 旋转、红黑树的取舍、跳表的随机化，以及 B+ 树如何用树高换磁盘 I/O。
---

哈希表把查找压到了平均 O(1)，代价是丢掉了顺序：前驱后继、范围查询、按序遍历、第 k 小这四件事，在哈希表上要么 O(n) 全扫，要么得额外维护一个结构（[第 06 篇](06-hash-table.md) 第 10 节）。二叉搜索树（binary search tree, BST）换了个思路：把「比较」组织成一棵树的形状，让每个节点成为一条**分界线**，于是查找、插入、删除、前驱后继、范围查询全部变成「沿分界线走一条路径」。

这个设计的命门只有一个：树高。往一棵空 BST 里按顺序插入 10⁶ 个键，它会长成一条 10⁶ 层的链，所有操作退化成 O(n)。平衡树解决的就是这件事——用一组显式的不变式把树高钉在 O(log n)，把「平均很快」换成「最坏不超过多少」。

这一篇从 BST 的不变式出发，走完 AVL、红黑树、跳表，最后落到磁盘上的 B+ 树：在那里，「树高」这个词的含义不再是比较次数，而是 I/O 次数。

## 1. 一个不变式，五种操作

### 1.1 定义与「每个节点都是一道分界线」

BST 是二叉树，每个节点存一个键（key），并且对**每个**节点 v 都满足：

```text
v 的左子树里的所有键  <  v.key  <  v 的右子树里的所有键
```

这是整个结构唯一的约束，叫 BST 不变式。注意它的递归性：约束的是「子树里的所有键」，不是「两个孩子」。这个区别后面会用一段代码说明它有多重要。

它还有一个等价的**区间表述**，是理解一切操作的钥匙：对每个节点，存在一个开区间 (lo, hi)，使得它的整棵子树都落在区间内，而 v.key 把区间切成两半——左子树继承 (lo, v.key)，右子树继承 (v.key, hi)。根节点的区间是 (−∞, +∞)。

换成直觉：**每个节点都是一道分界线**。走到节点 v 时，你已经知道「要找的键如果存在，只可能在 v 的哪一侧」——一次比较排除的是一整棵子树，不是一半元素（这是它和数组二分查找在心智模型上的区别：二分靠下标折半，BST 靠分界线切分）。

全部五种操作都能从这个心智模型直接推出来：

| 操作         | 不变式怎么支撑它                        | 复杂度      |
| ---------- | ------------------------------- | -------- |
| 查找 key     | 比较一次就排除一整棵子树，一路收窄区间到空位即「不存在」    | O(h)     |
| 插入 key     | 沿收窄路径走到底，遇到的第一个空位就是 key 唯一合法的落点 | O(h)     |
| 删除 key     | 摘掉节点后，用它的中序邻居填坑，让剩下的键仍落在各自区间里   | O(h)     |
| 前驱 / 后继    | 路径上「最后一次向左转 / 向右转」的那个节点         | O(h)     |
| 范围 \[a, b] | 子树区间与 \[a, b] 不相交就整棵剪掉          | O(h + k) |
| 最小 / 最大    | 从根一路向左 / 向右                     | O(h)     |
| 按序遍历       | 中序递归即按分界线从左到右                   | O(n)     |

表里的 h 是树高。**所有操作都带这个因子，所以 BST 的全部性能问题都可以归结为一个问题：h 是多少。**

### 1.2 中序遍历得到升序序列

对树高做归纳：空树的中序序列是升序空序列。设节点 v 的左右子树都满足「中序 = 升序」，那么 v 的中序序列是「左子树序列 + v.key + 右子树序列」；由不变式，左子树所有键 < v.key < 右子树所有键，所以拼起来仍然升序。

这条性质把「有序」和「树形」绑在了一起，是后面所有「范围查询、排名、归并」的底层依据，也是第 8 节 B+ 树全部设计的起点（中序遍历的递归与迭代模板见 [第 07 篇](07-binary-tree-traversal.md)）。

### 1.3 不变式的第一个用处：用它当测试

写树的人最常写的错误校验，是「检查每个节点的左孩子比它小、右孩子比它大」。**这个检查是错的**——它漏掉了跨层的约束。正确的做法是把区间当成参数传下去，这正好就是不变式本身：

```python
class Node:
    def __init__(self, key, left=None, right=None):
        self.key, self.left, self.right = key, left, right


def check_bst(node, lo=None, hi=None):
    """把区间 (lo, hi) 一路传下去：这才是完整的不变式检查。"""
    if node is None:
        return
    assert lo is None or lo < node.key, f"{node.key} 不在 ({lo}, {hi}) 内"
    assert hi is None or node.key < hi, f"{node.key} 不在 ({lo}, {hi}) 内"
    check_bst(node.left, lo, node.key)
    check_bst(node.right, node.key, hi)


check_bst(Node(5, Node(3, Node(1)), Node(8)))          # 合法结构

try:
    # 4 是 5 的右孩子，单看「父子关系」没错，但它小于 5，破坏了根的分界线
    check_bst(Node(5, Node(3), Node(4)))
except AssertionError as e:
    print("检出坏树:", e)
```

这类「只比父子」的错误在真实代码里非常常见：非法数据能被插进去、能被查到，但前驱后继和范围查询会给出荒唐的答案。区间检查的价值在于它能同时覆盖「越过祖先的违规」。

## 2. 三个操作：完整实现

### 2.1 查找：迭代与递归是同一件事

查找的全部逻辑就是「比较一次，排除一整棵子树」：

```python
def search(node, key):
    """从 node 出发查找 key，命中返回节点，否则返回 None。"""
    while node is not None:
        if key == node.key:
            return node
        node = node.left if key < node.key else node.right
    return None
```

递归版把 while 换成调用栈，与上面逐行对应。两者的取舍不在「哪个更快」，而在代价结构：**递归版的空间复杂度是 O(h)，且受语言栈深限制**。Python 默认递归上限 1000 层、Linux 进程栈 8 MB，所以「按顺序插入 10⁵ 个键」这种操作在递归实现里会直接爆栈（[第 01 篇](01-complexity-analysis.md) 第 5 节）。工程实现里查找、遍历一律写迭代；插入删除因为要「把新子树挂回去」，递归写法最省事，把栈深交给 O(log n) 的平衡树来保证。

### 2.2 插入：走到空位，把新子树挂回去

递归插入的骨架是「返回新的子树根」，这个写法比维护父指针干净得多：

```python
def insert(node, key):
    if node is None:
        return Node(key)            # 空位：新节点在这里落地
    if key < node.key:
        node.left = insert(node.left, key)
    elif key > node.key:
        node.right = insert(node.right, key)
    # key == node.key：什么都不做，等于拒绝重复键
    return node
```

注意最后那句 `return node` 是必须的：节点没被替换，但父节点会用它覆盖自己的孩子指针，所以每次递归都要把（可能更新过的）子树根交回去。

重复键的处理有三种立得住的策略，必须挑一种并全局一致：

1. **拒绝**（`key == node.key` 时什么都不做）——映射（map）语义，最常用。
2. **计数**：节点上加一个 `count` 字段，重复插入只加计数。
3. **允许**：约定重复键固定在右侧（`key <= node.key` 往右走）。但这会让不变式变成「左子树 ≤ 节点 ≤ 右子树」，第 1.2 节的「中序严格升序」不再成立，前驱后继和删除的语义都要跟着改。

最糟糕的写法是两种混用：插入时用 `<=` 往左、查找时用 `<` 往右，于是树里堆着一批「插得进、查不到」的重复键（第 12 节）。

### 2.3 删除：三种情况，以及为什么后继能接替

设要删的节点是 z，分三种情况：

| 情况 | z 的孩子数 | 做法                          | 代价   |
| -- | ------ | --------------------------- | ---- |
| 1  | 0（叶子）  | 父节点对应的孩子指针置空，直接摘掉           | O(1) |
| 2  | 1      | 用那个孩子顶替 z 的位置               | O(1) |
| 3  | 2      | 用中序后继（或前驱）接替 z 的键，再删掉那个后继节点 | O(h) |

表里的代价指「摘除动作本身」，三种情况都还要先花 O(h) 找到 z。情况 1、2 没有讨论余地；情况 3 值得说清**为什么这么替换能保持有序性**。

z 有两个孩子时，要接替它位置的键 k 必须同时满足两条：大于左子树的所有键（否则左子树里会出现比它大的键），小于右子树的所有键。满足这两条的键只有两个：左子树的最大键（中序前驱）和右子树的最小键（中序后继）——**它们正是 z 在升序序列里的左右邻居**。用其中任何一个替换 z，剩下的键与 z 的左右子树的约束关系都不变。

选后继还有一个结构上的好处：右子树的**最小节点没有左孩子**（一路向左到底），所以摘掉它属于情况 1 或情况 2，是个 O(1) 就能处理的简单活。于是「删除一个双孩子节点」化归成了「替换键 + 删掉一个至多单孩子的节点」，后者再走一遍情况 1、2 的代码。

```python
def delete(node, key):
    """删除 key，返回新的子树根。"""
    if node is None:
        return None
    if key < node.key:
        node.left = delete(node.left, key)
    elif key > node.key:
        node.right = delete(node.right, key)
    else:
        if node.left is None:
            return node.right          # 情况 1、2：叶子，或只有右孩子
        if node.right is None:
            return node.left           # 情况 2：只有左孩子
        succ = node.right              # 情况 3：两个孩子
        while succ.left is not None:
            succ = succ.left           # 右子树一路向左 = 中序后继
        node.key = succ.key            # 后继的键接替位置
        node.right = del_min(node.right)   # 再把那个后继节点从右子树里摘掉
    return node


def del_min(node):
    """摘掉子树里的最小节点，返回新的子树根。"""
    if node.left is None:
        return node.right
    node.left = del_min(node.left)
    return node
```

C 里的版本要多做一件事：`del_min` 摘掉节点时必须 `free`——那个节点已经没有指针指向它了，不释放就是纯泄漏（第 12 节有完整例子）。另一种等价做法是**指针替换**：把后继整个节点从原位置摘下来，再用它替换 z 的位置，把 z 的左右子树挂到它身上。值替换和指针替换得到的树形不同、迭代器失效范围不同，但都满足不变式。

### 2.4 前驱后继与范围查询：分界线的直接产物

前驱 / 后继不需要父指针，也不需要中序遍历，一次下行就够：

```python
def successor(self, key):          # 大于 key 的最小键
    cur, ans = self.root, None
    while cur is not None:
        if key < cur.key:
            ans = cur.key          # 向左转：cur 是目前最小的「比 key 大」的候选
            cur = cur.left
        else:
            cur = cur.right        # 向右转：cur 不可能是答案，被排除掉
    return ans
```

**向左转就是「记下一个候选」的时刻**：当前节点比 key 大，而接下来要走的方向只可能遇到更小的键，所以这个节点是「比 key 大」的候选里最小的一个。走完路径，最后一个候选就是后继。这种「路径上最后一次转弯」的视角，正是分界线心智模型的直接推论。

范围查询则是「剪枝 + 中序」，关键在两句判断：

```python
def range_query(self, lo, hi):
    out = []

    def go(node):
        if node is None:
            return
        if node.key > lo:              # 左子树里可能有 ≥ lo 的键，才下去
            go(node.left)
        if lo <= node.key <= hi:
            out.append(node.key)
        if node.key < hi:              # 右子树里可能有 ≤ hi 的键，才下去
            go(node.right)

    go(self.root)
    return out
```

`node.key <= lo` 时整棵左子树都可以剪掉（它们全都 < node.key ≤ lo），`node.key >= hi` 时右子树同理。被真正访问的节点是「两条边界路径 + 区间内的 k 个键」，所以复杂度是 O(h + k)，而不是「无论取多少都全扫一遍」——这是哈希表给不了的能力。

### 2.5 完整实现与自检

下面是完整的、可直接运行的程序（标准库随机数生成测试数据）：

```python
"""二叉搜索树：查找、插入、删除、前驱后继、范围查询。仅用标准库。"""
import random


class Node:
    __slots__ = ("key", "left", "right")

    def __init__(self, key):
        self.key = key
        self.left = None
        self.right = None


class BST:
    """不含重复键：整棵树满足「左子树 < 节点 < 右子树」。"""

    def __init__(self):
        self.root = None
        self._size = 0

    def __len__(self):
        return self._size

    def __iter__(self):
        """中序遍历，按 key 升序产出（迭代版，显式栈）。"""
        stack, cur = [], self.root
        while stack or cur is not None:
            while cur is not None:
                stack.append(cur)
                cur = cur.left
            cur = stack.pop()
            yield cur.key
            cur = cur.right

    def search(self, key):
        cur = self.root
        while cur is not None:
            if key == cur.key:
                return cur
            cur = cur.left if key < cur.key else cur.right
        return None

    def search_rec(self, key):
        """递归版：与迭代版逐行对应，循环换成了调用栈。"""
        def go(node):
            if node is None or node.key == key:
                return node
            return go(node.left) if key < node.key else go(node.right)

        return go(self.root)

    def insert(self, key):
        inserted = False

        def go(node):
            nonlocal inserted
            if node is None:
                inserted = True
                return Node(key)
            if key < node.key:
                node.left = go(node.left)
            elif key > node.key:
                node.right = go(node.right)
            return node

        self.root = go(self.root)
        self._size += inserted
        return inserted

    def delete(self, key):
        removed = False

        def go(node):
            nonlocal removed
            if node is None:
                return None
            if key < node.key:
                node.left = go(node.left)
            elif key > node.key:
                node.right = go(node.right)
            else:
                removed = True
                if node.left is None:
                    return node.right
                if node.right is None:
                    return node.left
                succ = node.right
                while succ.left is not None:
                    succ = succ.left
                node.key = succ.key
                node.right = self._del_min(node.right)
            return node

        self.root = go(self.root)
        self._size -= removed
        return removed

    def _del_min(self, node):
        if node.left is None:
            return node.right
        node.left = self._del_min(node.left)
        return node

    def min(self):
        node = self.root
        while node is not None and node.left is not None:
            node = node.left
        return None if node is None else node.key

    def max(self):
        node = self.root
        while node is not None and node.right is not None:
            node = node.right
        return None if node is None else node.key

    def successor(self, key):
        cur, ans = self.root, None
        while cur is not None:
            if key < cur.key:
                ans = cur.key
                cur = cur.left
            else:
                cur = cur.right
        return ans

    def predecessor(self, key):
        cur, ans = self.root, None
        while cur is not None:
            if key > cur.key:
                ans = cur.key
                cur = cur.right
            else:
                cur = cur.left
        return ans

    def range_query(self, lo, hi):
        """返回 [lo, hi] 内的所有键（升序），只访问 O(h + k) 个节点。"""
        out = []

        def go(node):
            if node is None:
                return
            if node.key > lo:
                go(node.left)
            if lo <= node.key <= hi:
                out.append(node.key)
            if node.key < hi:
                go(node.right)

        go(self.root)
        return out


if __name__ == "__main__":
    random.seed(1)
    tree = BST()
    keys = list(range(20))
    random.shuffle(keys)
    for k in keys:
        assert tree.insert(k)
    assert not tree.insert(5)                      # 重复键被拒绝
    assert list(tree) == list(range(20))           # 中序 = 升序
    assert tree.search(13).key == 13 and tree.search(99) is None
    assert tree.search_rec(13).key == 13 and tree.search_rec(99) is None
    assert tree.min() == 0 and tree.max() == 19
    assert tree.successor(5) == 6 and tree.predecessor(5) == 4
    assert tree.successor(19) is None and tree.predecessor(0) is None
    assert tree.range_query(4, 9) == [4, 5, 6, 7, 8, 9]

    assert tree.delete(0)                          # 叶子
    assert tree.delete(1)                          # 只有一个孩子
    assert tree.delete(2)                          # 两个孩子
    assert not tree.delete(0)                      # 删不存在的键
    assert list(tree) == list(range(3, 20))

    # 与 set 做差分测试：随机混合三种操作，最后逐项对账
    rng = random.Random(42)
    tree, ref = BST(), set()
    for _ in range(3000):
        k = rng.randrange(300)
        p = rng.random()
        if p < 0.5:
            assert tree.insert(k) == (k not in ref)
            ref.add(k)
        elif p < 0.8:
            assert tree.delete(k) == (k in ref)
            ref.discard(k)
        else:
            assert (tree.search(k) is not None) == (k in ref)
    assert list(tree) == sorted(ref)
    print("BST ok：", len(tree), "个键")
```

这段 `__main__` 里的最后一段值得单独说：**拿一个 `set` 当对照组，随机混合三种操作，每步断言两边一致**。树结构最麻烦的 bug（删除时链断了、大小算错了、某个键「插进去查不到」）几乎都能被这种差分测试逼出来，而靠手写几个用例是碰不到的。

BST 各操作的复杂度（h 为树高）：

| 操作                | 平均（插入顺序随机）   | 最坏   | 摊还         |
| ----------------- | ------------ | ---- | ---------- |
| 查找 / 插入 / 删除      | O(log n)     | O(n) | 不适用（无摊还保证） |
| 最小 / 最大 / 前驱 / 后继 | O(log n)     | O(n) | 不适用        |
| 范围查询（k 个结果）       | O(log n + k) | O(n) | 不适用        |
| 中序遍历全部            | O(n)         | O(n) | 不适用        |

「平均」那一列有一个前提：**插入顺序是随机的**。这就是下一节要拆掉的东西。

## 3. 退化：概率承诺救不了工程

### 3.1 有序插入会长出一条链

如果插入的键已经有序（自增主键、时间戳、从文件里读出来的排好序的数据——现实里到处都是），每个新键都比已有的所有键大，于是一路走右孩子到底：树退化成一条单链，h = n，查找退化成线性扫描。实测（用第 2 节的插入逻辑统计高度，n = 10⁵，随机顺序取 5 次，另加一次升序和一次降序）：

```text
n = 100000：升序插入高度 = 100000，降序插入高度 = 100000
n = 100000：升序但有 100 处随机交换 → 高度 = 10449
```

最后一行是最容易被忽视的：**「几乎有序」和「完全有序」一样致命**。只把 100 个元素挪了位置，树高就是 10449——因为每个被挪动的键都会在后面造出一段长长的「右链」。

退化的代价不止于树高。按序插入 n 个键这个**建树过程本身就是 O(n²)**：第 k 个键要沿已有的 k 层链一路走到底才能找到空位，总步数是 n²/2。实测 n = 10⁵ 时，随机顺序建树是零点几秒，升序建树要几分钟；n = 10⁶ 时前者是几秒，后者是几小时——树还没建完，性能已经输掉了。

### 3.2 随机插入的期望高度：4.31·ln n

如果插入顺序真的是随机的（n 个键的 n! 种排列等概率），树高的期望有精确结果：

```text
E[高度] ≈ 4.311 · ln n = 2.99 · log2 n

n = 10^6 时：4.311 × ln(10^6) = 4.311 × 13.816 ≈ 59.6（主项 60 层）
```

注意这个常数：**期望高度是理想平衡高度 log₂ n 的约 3 倍**。n = 10⁶ 时理想是 20 层，随机 BST 的主项是 60 层——即使运气正常，也已经付出了 3 倍的访存代价。低阶修正项是负的，实测值比主项更低（下表的 10⁵ 一档是 37\~42，主项 49.6）。

| n       | 随机顺序实测高度（5 次） | 4.311·ln n 主项 | log₂ n（理想） |
| ------- | ------------- | ------------- | ---------- |
| 1000    | 18 \~ 23      | 29.8          | 10.0       |
| 10000   | 30 \~ 35      | 39.7          | 13.3       |
| 100000  | 37 \~ 42      | 49.6          | 16.6       |
| 1000000 | 47 \~ 51      | 59.6          | 19.9       |

顺带纠正一个常见的说法：「随机 BST 高度方差很大」并不准确——随机插入顺序下，高度其实是集中的（围绕 4.311·ln n，方差是常数级）。**真正脆弱的是「随机」这个前提本身**：它由数据决定，不由你决定。同一个 `insert` 函数，喂排好序的数据得到 n 层，喂随机数据得到约 60 层。

> [!WARNING]
> 「平均 O(log n)」这种表述里藏着一个未经确认的假设。哈希表的平均依赖「键分布均匀」，BST 的平均依赖「插入顺序随机」——两者都不是算法自身的性质，而是对输入的假设。写进接口文档时要么声明假设，要么换成有最坏保证的结构（下一节），绝不能默认它成立。

### 3.3 三个数字，一个结论

把 n = 10⁶ 的三种情形并排看：

| 情形         | 高度           | 一次查找的最坏比较次数 | 靠什么保证    |
| ---------- | ------------ | ----------- | -------- |
| 有序输入       | 10⁶          | 10⁶         | 无        |
| 随机插入顺序     | 47 \~ 51（实测） | 约 51        | 依赖输入分布   |
| 理想平衡 / 平衡树 | 20（AVL 实测）   | 20          | 结构自身的不变式 |

结论：**「平均好」不足以支撑工程承诺**。一个接口如果在 99% 的输入下是 O(log n)、在 1% 的输入下降级成 O(n)，那么这 1% 就是你的 P99 延迟、你的超时报警、你的线上事故。要让 O(log n) 成为承诺，必须把它维护成结构自身的不变式——也就是显式地平衡。

## 4. 平衡：把最坏情况拉回 O(log n)

### 4.1 平衡的定义与价值

平衡（balance）不是「树看起来对称」，而是一条可检验的不变式：**对树中每个节点，其左右子树的高度差（或规模比）被限制在一个常数以内**。一旦这条不变式被维持，数学上就能推出 h = O(log n)，于是所有操作的最坏情况都是 O(log n)。

把最坏情况从 O(n) 拉回 O(log n) 的价值，随 n 的增长迅速放大：

| n   | O(n) 的最坏操作   | O(log n) 的最坏操作 | 倍差    |
| --- | ------------ | -------------- | ----- |
| 10³ | 10³ 次比较      | 10 次           | 100   |
| 10⁶ | 10⁶ 次比较（毫秒级） | 20 次           | 5×10⁴ |
| 10⁹ | 10⁹ 次比较（秒级）  | 30 次           | 3×10⁷ |

而且这个代价在缓存时代还有一层放大：树每下沉一层就是一次指针跳转，多半是一次缓存缺失（约 100 纳秒，够 CPU 执行几百条指令，[第 01 篇](01-complexity-analysis.md) 第 3 节）。树高既是渐进复杂度，也是访存次数的直接系数。

### 4.2 高度平衡与重量平衡

「平衡」这个约束有好几种写法，代表两种流派：

- **高度平衡**：约束左右子树的**高度差**。AVL 树要求每个节点的高度差 ≤ 1，是最紧的写法，代价是插入删除后更容易被打破、修复更频繁。
- **重量平衡**：约束左右子树的**节点数之比**。替罪羊树要求 `size(left) ≤ α·size(node)`（α 常取 2/3）。它比高度约束宽松得多（高度差可以很大），换来的好处是：**大部分时候不用修**，只有当某个节点严重失衡时才把它整棵子树原地重建。代价被摊还掉了。
- 红黑树（第 6 节）走的是第三条路：不直接约束高度，而是约束「颜色」，由颜色性质间接推出高度上界 2·log₂ n。

### 4.3 三种保证，别混着说

平衡树给出的保证并不都是同一类，这一层区分要和 [第 01 篇](01-complexity-analysis.md) 第 2 节对齐：

| 保证类型 | 含义                    | 谁提供              |
| ---- | --------------------- | ---------------- |
| 最坏情况 | 任何输入、任何单次操作都不超过       | AVL、红黑树、B+ 树     |
| 期望   | 对结构内部的随机化取期望，不承诺单次    | 跳表、Treap         |
| 摊还   | 任意操作序列的总代价除以次数；单次可能很贵 | 替罪羊树、Splay、哈希表扩容 |

### 4.4 平衡是一种不变式，不是一种巧合

平衡结构最核心的设计思想是：**每一次修改之后，立刻检查并修复不变式**，而不是修改完祈祷它仍然成立。插入 10⁶ 个有序键对 AVL 毫无压力，因为「有序」在它的逻辑里根本不是一个特殊输入——不管什么顺序，修复动作都在每次插入的返回路上执行。

这与哈希表是同一个思想的两个实例：哈希表的健康指标是负载因子，超标就扩容；平衡树的健康指标是高度差或黑高，超标就旋转。区别只是度量指标和修复动作不同。

## 5. AVL 树：最紧的高度约束

### 5.1 平衡因子

AVL 树（1962 年，Adelson-Velsky 与 Landis，第一个自平衡搜索树）给每个节点定义平衡因子（balance factor）：

```text
bf(v) = height(v.left) − height(v.right)        空树高度记为 0
不变式：对每个节点，bf(v) ∈ {−1, 0, +1}
```

实现上不需要真的存「高度差」，存节点高度即可（`height = 1 + max(左高, 右高)`），`bf` 是现算的。

为什么阈值是 1 而不是 0？因为「所有节点左右完全等高」只有节点数恰好是 2^k − 1 时才可能，无法全局维持。差 1 是**能够对任意规模维持的最紧约束**：它让树高最接近 log₂ n（上界 1.44·log₂(n+2) − 0.33），同时把修复动作限制在局部。

### 5.2 四种失衡与两种旋转

插入一个键只会让它**路径上**的节点高度 +1，所以失衡必然出现在这条路径上，而且第一次遇到的失衡节点满足 |bf| = 2。按「新键落在哪一侧的哪一侧」分四类，两类由同一种旋转解决：

```text
LL：v 的平衡因子 +2，且 v.left 左边更高        RR：v 的平衡因子 −2，且 v.right 右边更高
（新键在 v 左孩子的左子树）                      （新键在 v 右孩子的右子树）

        v  (+2)              x                          v  (−2)               y
       /   \               /   \                       /   \               /   \
      x     D    右旋 v   A     v         左旋 v      A     y     ──>     v     C
     / \        ──────>       /   \         ──>           / \            / \
    A   B                    B     D                     B   C          A   B

LR：v 的平衡因子 +2，且 v.left 右边更高         RL：镜像（v.right 左边更高）
（先左旋 v.left，把它变成 LL 的形状，再右旋 v）

      v                    v                    y
     / \                  / \                  / \
    x   D      左旋 x    y   D      右旋 v    x   v
   / \        ─────>    / \        ─────>    / \ / \
  A   y                x   C                A  B C  D
     / \              / \
    B   C            A   B
```

四个图里最要紧的一句话是：**旋转不改变中序序列**。LL 图中序列始终是 A x B v D，LR 图中始终是 A x B y C v D，所以 BST 不变式自动保持——旋转只改变形状，不改变顺序。以 LL 为例，指针变化只有三条：

```text
x = v.left                  # 把左孩子提上来
v.left = x.right            # x 的右子树 B 换爹（它比 x 大、比 v 小，只能挂这里）
x.right = v                 # v 降下去当 x 的右孩子
```

LR 和 RL 是「先做一次反向旋转，把它化归成 LL 或 RR」，所以整个修复逻辑只需要两种基本旋转、四个分支。

### 5.3 回溯更新与旋转的代码要点

修复发生在**递归返回的路上**：子树插入完成后，`_insert` 调用 `_fix(node)`——先重算高度，再检查平衡因子，需要时旋转并返回新的子树根。三个必须记住的细节：

1. **高度必须在旋转时同步更新，顺序不能反**。`_rotate_right` 里 y 下沉成了 x 的孩子，所以必须先算 `y.height`（它依赖新的孩子），再算 `x.height`（依赖 y 的新高度）。写反了就会用到旧值，误差沿路径一层层放大。
2. **插入最多触发一次「旋转修复」**。以 LL 为例，旋转后子树的高度恰好回到插入之前的值，更高的祖先看到的子树高度没变，不可能继续失衡。本文代码为了简洁仍然一路回溯重算高度，代价只是 O(log n) 次加法和比较。
3. **删除不一样**：删掉一个节点会让子树**变矮**，高度变化会继续向上传播，所以一次删除可能沿路径一路修复到根，旋转次数是 O(log n)——这是 AVL 在写多的场景里最贵的部分。

顺带一条通用经验：**能存高度就不要存平衡因子**。存高度时每次现算 `bf`，旋转里只有「重算高度」一个动作；存平衡因子则要按四种情形分别推导新的取值，还要处理「子树变矮导致祖先平衡因子变化」的另一套规则，出错概率高得多。

### 5.4 完整实现与代价实测

下面这段完整实现是上面三个细节的落地：`_fix` 是回溯修复的入口，`_rotate_left` / `_rotate_right` 是两种基本旋转，`_delete` 与 `_pop_min` 演示了删除为什么会比插入贵。

```python
"""AVL 树：四种失衡与旋转、插入 / 删除、不变式自检。仅用标准库。"""
import random


class Node:
    __slots__ = ("key", "left", "right", "height")

    def __init__(self, key):
        self.key = key
        self.left = None
        self.right = None
        self.height = 1                     # 空树高 0，叶子高 1


def h(node):
    return node.height if node is not None else 0


def bf(node):
    """平衡因子（balance factor）= 左子树高 − 右子树高。"""
    return h(node.left) - h(node.right)


class AVL:
    def __init__(self):
        self.root = None
        self._size = 0
        self.rotations = 0                  # 旋转计数，用来验证代价

    def __len__(self):
        return self._size

    def insert(self, key):
        self.root = self._insert(self.root, key)

    def _insert(self, node, key):
        if node is None:
            self._size += 1
            return Node(key)
        if key < node.key:
            node.left = self._insert(node.left, key)
        elif key > node.key:
            node.right = self._insert(node.right, key)
        else:
            return node                     # 不插重复键
        return self._fix(node)

    def delete(self, key):
        self.root = self._delete(self.root, key)

    def _delete(self, node, key):
        if node is None:
            return None
        if key < node.key:
            node.left = self._delete(node.left, key)
        elif key > node.key:
            node.right = self._delete(node.right, key)
        else:
            self._size -= 1
            if node.left is None:
                return node.right
            if node.right is None:
                return node.left
            node.right, succ_key = self._pop_min(node.right)   # 中序后继接替
            node.key = succ_key
        return self._fix(node)

    def _pop_min(self, node):
        """摘掉子树里的最小节点，返回 (新的子树根, 被摘掉的键)。"""
        if node.left is None:
            return node.right, node.key
        new_left, key = self._pop_min(node.left)
        node.left = new_left
        return self._fix(node), key

    @staticmethod
    def _rotate_right(y):
        x = y.left
        y.left = x.right
        x.right = y
        y.height = 1 + max(h(y.left), h(y.right))
        x.height = 1 + max(h(x.left), h(x.right))
        return x

    @staticmethod
    def _rotate_left(x):
        y = x.right
        x.right = y.left
        y.left = x
        x.height = 1 + max(h(x.left), h(x.right))
        y.height = 1 + max(h(y.left), h(y.right))
        return y

    def _fix(self, node):
        """回溯到 node 时调用：先重算高度，再判断失衡并旋转。"""
        node.height = 1 + max(h(node.left), h(node.right))
        balance = bf(node)
        if balance > 1:
            if bf(node.left) < 0:
                node.left = self._rotate_left(node.left)
                self.rotations += 1
            self.rotations += 1
            return self._rotate_right(node)
        if balance < -1:
            if bf(node.right) > 0:
                node.right = self._rotate_right(node.right)
                self.rotations += 1
            self.rotations += 1
            return self._rotate_left(node)
        return node


def check(node):
    """自检：断言每个节点平衡因子不超过 1，且 height 字段与实际高度一致。"""
    if node is None:
        return 0
    lh, rh = check(node.left), check(node.right)
    assert abs(lh - rh) <= 1, f"{node.key} 处失衡：{lh} vs {rh}"
    assert node.height == 1 + max(lh, rh), f"{node.key} 的高度字段没更新"
    return node.height


def inorder(node):
    if node is None:
        return []
    return inorder(node.left) + [node.key] + inorder(node.right)


if __name__ == "__main__":
    # 四种失衡的最小复现：三个键就够
    for keys, case in [([3, 2, 1], "LL"), ([1, 2, 3], "RR"),
                       ([3, 1, 2], "LR"), ([1, 3, 2], "RL")]:
        t = AVL()
        for k in keys:
            t.insert(k)
        assert t.root.key == 2 and t.root.height == 2, case

    # 升序插入是最坏输入：朴素 BST 长成链，AVL 不会
    t = AVL()
    for k in range(1000):
        t.insert(k)
    check(t.root)
    print("升序插入 1000 个键：AVL 高度 =", t.root.height, "旋转 =", t.rotations)

    # 随机混合插入/删除 10 万次，与 set 对账
    t, rng, ref = AVL(), random.Random(7), set()
    for _ in range(100_000):
        k = rng.randrange(5000)
        if rng.random() < 0.6:
            t.insert(k)
            ref.add(k)
        else:
            t.delete(k)
            ref.discard(k)
    assert inorder(t.root) == sorted(ref)
    check(t.root)
    print("10 万次随机操作后：", len(t), "个键，高度 =", t.root.height,
          "，累计旋转 =", t.rotations)
```

实测（同一份代码，加大 n）：

| 输入 | n     | AVL 高度 | 旋转次数   | 朴素 BST 高度 |
| -- | ----- | ------ | ------ | --------- |
| 升序 | 10³   | 10     | 990    | 1000      |
| 升序 | 10⁵   | 17     | 99983  | 100000    |
| 升序 | 10⁶   | 20     | 999980 | 1000000   |
| 随机 | 2×10⁵ | 21     | 139264 | 44        |

三件事值得注意。第一，**升序输入下 AVL 的高度几乎正好等于 log₂ n**（10⁵ → 17 vs 16.6，10⁶ → 20 vs 19.9），完全不受输入顺序影响。第二，**旋转次数接近 n**：升序插入几乎每次都要转一次——「插入最多一次旋转修复」说的是每次插入的常数上界，不是总量很小。第三，**随机插入的高度反而比升序插入略高**（2×10⁵ 随机 → 21 层），因为顺序插入恰好每次都对称地长高；1.44·log₂ n 那个上界要刻意构造（斐波那契树）才碰得到，日常输入下 AVL 在 1.0 \~ 1.2·log₂ n 之间。

> [!NOTE]
> AVL 的取舍很清晰：它给出最紧的高度上界（查询最快），代价是删除时可能沿着路径一路旋转回根。**读远多于写**的场景（静态字典、只建一次查很多次的路由表、需要极致查询延迟的索引）它是最优解；读写混杂的通用容器则用红黑树——这就是下一节。

## 6. 红黑树：工程界的默认选择

### 6.1 五条性质

红黑树（red-black tree）不直接约束高度，而是给节点染色，用五条性质间接控制树形：

1. 每个节点要么是红色，要么是黑色。
2. 根节点是黑色。
3. 每个叶子节点（NIL，即空指针哨兵）是黑色。
4. 红色节点的两个孩子都是黑色——等价说法：**路径上不出现两个相邻的红节点**。
5. 从任意节点出发，到它所有后代 NIL 的路径上黑色节点数相同。这个数目称为该节点的**黑高（black-height）**。

新插入的节点一律染成红色，这是唯一不会立刻破坏性质 5 的选择：加一个红节点不改变任何路径的黑节点计数，可能被破坏的只有性质 4（父节点也是红）。于是修复动作被压缩成「变色 + 极少量旋转」——这是红黑树写代价低的根源。

### 6.2 从性质推出高度上界

「最长路径不超过最短路径的两倍」这个说法可以两句话推出来：

- 由性质 4，任一路径上没有相邻的红节点，所以红节点数 ≤ 黑节点数，路径总长 ≤ 2 × 黑高。
- 由性质 5，所有路径的黑节点数都等于黑高 bh，所以最短路径的长度至少是 bh。

合起来：最长路径 ≤ 2·bh ≤ 2 × 最短路径。

再把它变成对节点数 n 的界。**引理**：黑高为 bh 的子树至少有 2^bh − 1 个内部节点。归纳证明：黑高为 0 时子树为空；对黑高 bh 的节点，从它到任一 NIL 的路径上下一个节点要么是黑孩子（其子树黑高 bh−1），要么是红孩子（性质 4 保证红孩子的孩子必须是黑的，那些黑孩子的子树黑高也是 bh−1）。所以每个黑高 bh 的节点都向下展开出两棵黑高至少 bh−1 的子树：`N(bh) ≥ 2·N(bh−1) + 1 ≥ 2^bh − 1`。

于是 `n ≥ 2^bh − 1`，即 `bh ≤ log₂(n+1)`，代入高度上界 h ≤ 2·bh 得到：

```text
红黑树高度 ≤ 2 · log2(n + 1)
n = 10^6 时：≤ 2 × 20 = 40 层（AVL 是 29 层上界，实测 20 层）
```

### 6.3 为什么通用库选红黑树而不是 AVL

两者都是最坏 O(log n)，高度上界只差 1.44 与 2.0 的系数。真正决定选型的是**修改操作的代价结构**：

| <br />   | AVL 树                    | 红黑树                        |
| -------- | ------------------------ | -------------------------- |
| 高度上界     | 1.44·log₂(n+2)           | 2·log₂(n+1)                |
| 查询       | 树更矮，比较次数更少（略快）           | 最多 2 倍路径长，同阶               |
| 插入修复     | 最多一次旋转，但高度字段要沿路径回溯更新     | 最多 2 次旋转 + 若干次变色，修复常在几层内结束 |
| 删除修复     | 可能沿路径一路旋转到根，O(log n) 次旋转 | 最多 3 次旋转 + 变色              |
| 每个节点额外存储 | 高度或平衡因子                  | 1 bit 颜色                   |

结论：**用一点查询常数（最多 2 倍的层数）换大量写入成本（旋转次数从 O(log n) 降到 O(1)）**。通用容器（C++ `map`、Java `TreeMap`）无法假设读写比例，而写操作更贵——旋转要改多个指针、破坏缓存局部性，所以业界统一选择红黑树。反过来，如果数据以读为主（建一次、查千万次），AVL 或「排序数组 + 二分」会比红黑树更合适。

### 6.4 与 2-3-4 树的关系

红黑树是 **2-3-4 树**的二叉表示。2-3-4 树是每个节点有 2~~4 个孩子、1~~3 个键的多路平衡树，它维持平衡靠「节点上溢时分裂、把中间键提升给父节点」。对应关系是：

```text
2-3-4 树的 2-节点（1 个键、2 个孩子）  =  一个黑节点
2-3-4 树的 3-节点（2 个键、3 个孩子）  =  一个黑节点 + 一个红孩子
2-3-4 树的 4-节点（3 个键、4 个孩子）  =  一个黑节点 + 两个红孩子
```

于是「分裂 4-节点、把中间键上提」在红黑树里表现为「变色 + 旋转」。这就是为什么红黑树只需要 1 bit 的额外信息（颜色）就能维持那么强的平衡性：**它把多路节点里「这几个键挤在一个节点中」的信息编码进了红链接**。想真正理解红黑树，先写一棵 2-3-4 树会容易得多。

### 6.5 本文不教你手写红黑树

> [!IMPORTANT]
> 这一篇不会给出红黑树的实现代码，这是刻意的取舍。三条理由：① 工程上不需要——C++ 的 `map`/`set`、Java 的 `TreeMap`、Linux 内核的 CFS 调度器与 epoll、ext4 的目录索引，实现都是现成且经过千万次验证的；② 手写正确性几乎无法自查——插入修复 3 种情形、删除修复 4 种情形，外加「根变红」「兄弟为红」「黑高失衡」等边界，漏掉任何一个都会在特定操作序列下悄悄破坏结构，而这种 bug 用手写用例极难触发；③ 真正需要自定义语义时（排名、区间、增强字段），基于现成实现加字段比自己从头写更安全。
>
> 要动手练，建议两条路：先写 2-3-4 树（case 少、逻辑直白），再按 6.4 的对应关系转成红黑树；或者直接写左倾红黑树（left-leaning red-black tree, LLRB，2008 年 Sedgewick 提出），它强制红链接只向左倾斜，把插入的 case 从 7 种压缩到 2 种，代码量约为标准红黑树的三分之一。

## 7. 跳表：用随机化替代旋转

### 7.1 结构：多层索引

跳表（skip list）的核心想法是给有序链表加索引层：第 0 层是完整的有序链表，第 1 层是第 0 层的稀疏索引，第 2 层又是第 1 层的稀疏索引，依此类推。查找时从最高层开始，能向右走就向右走，走不动就下降一层。

```text
lvl 3:                         50
lvl 2:       20                50
lvl 1: 10    20    30          50    60
lvl 0: 10    20    30    40    50    60    70
```

这张图里，键 50 出现在 4 个层（塔高 4），20 有 3 层，30 和 60 有 2 层，其余只有 1 层。**每个键的塔高由抛硬币决定**，与它的值、插入顺序都无关。

```text
查找 45 的路径：从 lvl 3 出发 → 50 大于 45，停在 head 降一层
                lvl 2：20 < 45，向右走到 20；下一个 50 > 45，降一层
                lvl 1：从 20 向右到 30；下一个 50 > 45，降一层
                lvl 0：从 30 向右到 40；40 的后继是 50 ≠ 45 → 不存在
共 6 步（朴素链表要 5 步，n = 200 平均要 100 步）
```

### 7.2 抛硬币：为什么期望是 O(log n)

插入时用一段循环模拟抛硬币：正面就升一层，直到反面或到达层数上限。每个节点独立地做这件事，于是：

```text
P(节点的塔高 ≥ i) = p^(i-1)           p = 0.5 时：塔高 ≥ 1 的概率 1，≥ 2 的概率 0.5，≥ 3 的概率 0.25
第 i 层的期望节点数 = n · p^(i-1)
层数达到约 log_(1/p) n 时，高层的期望节点数降到 1 以下 → 最大层数 ≈ log_(1/p) n
```

查找代价的论证分两步：**每层向右的期望步数与 n 无关**——在某一层向右走时遇到的每个节点，其塔高「恰好停在当前层」的概率是(1−p)（否则它的塔更高，你在更上层就遇到过它了），所以每层向右的期望步数约 (1−p)/p，是常数；**层数约 log\_(1/p) n**。乘起来：

```text
E[查找代价] ≈ (1/p) · log_(1/p) n        p = 0.5 时约 2·log2 n（n = 10^6 约 40 步）
```

代价与空间的权衡由 p 决定：每个节点的期望指针数是 `1/(1−p)`，p = 0.5 是 2 个、p = 0.25 是 1.33 个；而期望查找代价 `(1/p)·log_(1/p) n` 在 p = 1/e ≈ 0.37 处取最小值，所以 0.5 与 0.25 都接近最优，剩下的就是「省内存」还是「省比较」的选择。

> [!CAUTION]
> 跳表的 O(log n) 是**期望**，不是最坏情况保证：理论上存在（概率极低的）输入让所有节点都只有 1 层，退化成 O(n)。这与随机化快排是同一类保证——它把最坏情况交给随机数，而不是交给输入分布，比 BST 的「依赖输入顺序」强得多，但对需要硬延迟承诺的场景仍然不够（那种场景用红黑树或 B+ 树）。

### 7.3 与平衡树的对比：实现与范围查询

跳表真正的优势不在渐近复杂度（它和平衡树同阶），而在于三件事：

1. **实现简单得多**。没有旋转、没有颜色、没有平衡因子，插入只需「找到每层的前驱，然后接线」，删除只需「逐层摘链」。要维护排名（第 k 小）时，在每层指针上加一个「跨度（span）」计数即可，这在平衡树里要把子树大小和旋转绑在一起维护。
2. **范围查询天然**。定位到起点之后，遍历就是沿第 0 层链表一直走 `nxt[0]`，O(1) 拿到下一个元素，代码里就是一个 `while` 循环。平衡树要做同样的事就得实现迭代器的 `++`：中序后继需要向上回溯到「最后一次向左转」的祖先，红黑树/LRB 树的迭代器实现要处理回溯与状态。跳表把「按序遍历」写成了物理上的链表遍历。
3. **无旋转，写操作只影响局部指针**，对并发和缓存都更友好：加锁时锁的是一小段前驱链，没有「旋转导致大面积指针重排」的问题。

### 7.4 完整实现

```python
"""跳表（skip list）：有序集合，插入/删除/查找/范围查询。仅用标准库。"""
import random


class SkipList:
    """第 0 层是完整的有序链表，第 i 层是第 i−1 层的稀疏索引。"""

    def __init__(self, p=0.5, max_level=32):
        self.p = p                      # 每一层向上晋升的概率
        self.max_level = max_level
        self.head = self._Node(None, max_level)   # 头节点：占满所有层
        self.level = 1                  # 当前实际最高层数（1 起）
        self._size = 0

    class _Node:
        __slots__ = ("key", "nxt")

        def __init__(self, key, nlevels):
            self.key = key
            self.nxt = [None] * nlevels   # nxt[i] 是第 i 层的后继

    def __len__(self):
        return self._size

    def __iter__(self):
        """沿第 0 层链表遍历 = 升序遍历。"""
        cur = self.head.nxt[0]
        while cur is not None:
            yield cur.key
            cur = cur.nxt[0]

    def _random_level(self):
        """抛硬币决定层数：连续正面就升一层，期望层数 1/p = 2。"""
        lvl = 1
        while lvl < self.max_level and random.random() < self.p:
            lvl += 1
        return lvl

    def search(self, key):
        cur = self.head
        for i in range(self.level - 1, -1, -1):
            while cur.nxt[i] is not None and cur.nxt[i].key < key:
                cur = cur.nxt[i]
        cur = cur.nxt[0]
        return cur is not None and cur.key == key

    def insert(self, key):
        # update[i]：第 i 层里最后一个键小于 key 的节点，新节点接在它后面
        update = [self.head] * self.max_level
        cur = self.head
        for i in range(self.level - 1, -1, -1):
            while cur.nxt[i] is not None and cur.nxt[i].key < key:
                cur = cur.nxt[i]
            update[i] = cur
        nxt = cur.nxt[0]
        if nxt is not None and nxt.key == key:
            return False                       # 不插重复键
        lvl = self._random_level()
        if lvl > self.level:
            self.level = lvl                   # update 里超出旧层数的位置已经是 head
        node = self._Node(key, lvl)
        for i in range(lvl):
            node.nxt[i] = update[i].nxt[i]
            update[i].nxt[i] = node
        self._size += 1
        return True

    def delete(self, key):
        update = [self.head] * self.max_level
        cur = self.head
        for i in range(self.level - 1, -1, -1):
            while cur.nxt[i] is not None and cur.nxt[i].key < key:
                cur = cur.nxt[i]
            update[i] = cur
        target = cur.nxt[0]
        if target is None or target.key != key:
            return False
        for i in range(self.level):
            if update[i].nxt[i] is not target:
                break                          # 更高层没有这个节点，摘链到此为止
            update[i].nxt[i] = target.nxt[i]
        while self.level > 1 and self.head.nxt[self.level - 1] is None:
            self.level -= 1                    # 顶层空了就降层
        self._size -= 1
        return True

    def range_query(self, lo, hi):
        """[lo, hi] 内的所有键（升序）：先跳到 lo 附近，再沿底层链表走。"""
        out = []
        cur = self.head
        for i in range(self.level - 1, -1, -1):
            while cur.nxt[i] is not None and cur.nxt[i].key < lo:
                cur = cur.nxt[i]
        cur = cur.nxt[0]                       # 第一个 ≥ lo 的节点
        while cur is not None and cur.key <= hi:
            out.append(cur.key)
            cur = cur.nxt[0]
        return out


if __name__ == "__main__":
    random.seed(2024)
    sl = SkipList()
    keys = list(range(200))
    random.shuffle(keys)
    for k in keys:
        assert sl.insert(k)
    assert not sl.insert(100)                       # 重复键
    assert sl.search(0) and sl.search(199) and not sl.search(200)
    assert list(sl) == list(range(200))             # 底层链表 = 升序
    assert sl.range_query(50, 59) == list(range(50, 60))
    assert sl.range_query(-5, 2) == [0, 1, 2]
    assert sl.range_query(500, 600) == []

    # 与 set 做差分测试
    sl, rng, ref = SkipList(), random.Random(3), set()
    for _ in range(5000):
        k = rng.randrange(400)
        p = rng.random()
        if p < 0.5:
            assert sl.insert(k) == (k not in ref)
            ref.add(k)
        elif p < 0.8:
            assert sl.delete(k) == (k in ref)
            ref.discard(k)
        else:
            assert sl.search(k) == (k in ref)
    assert list(sl) == sorted(ref)
    print("跳表 ok：", len(sl), "个键，当前层数 =", sl.level)
```

注意 `insert` 与 `delete` 里那个 `update` 数组：它是每层「最后一个键小于 key 的节点」。插入就是把新节点接在每一层的 `update[i]` 后面，删除就是从每一层摘掉它。跳表没有旋转，全部操作都是**在若干条链表的固定位置上接线**——这就是它比平衡树好写的原因。

### 7.5 为什么 Redis 的 zset 选了跳表

Redis 的有序集合（zset）同时维护一个哈希表（member → score，O(1) 查分数）和一个跳表（按 score 排序，同 score 按 member 字典序）。选跳表而不是平衡树的理由，作者 antirez 给过完整说明，可以归成三条：

- **范围操作是 zset 的核心**：`ZRANGE`、`ZRANGEBYSCORE`、`ZREVRANGE` 全都要「定位起点 + 顺序遍历」，跳表的底层链表直接满足，平衡树需要维护迭代器。
- **排名（rank）实现简单**：`ZRANK`/`ZREVRANGE` 要求 O(log n) 算出「第 k 小」。跳表在每层指针上加一个 span 字段，下行的同时累加跨度就得到排名；平衡树要在旋转时同步维护子树大小，属于「每一处旋转代码都不能漏」的负担。
- **可调、可控、好维护**：Redis 用 p = 0.25（省内存）和 `max_level = 32`（支持 2³² 级别的元素数）；没有旋转意味着写操作只影响局部指针，调试和并发设计都更简单。

代价是内存：每个节点平均 1.33 个指针（p = 0.25）用于索引，而平衡树每个节点固定两个指针加颜色位。对 Redis 的数据规模，这个交换是划算的。

## 8. B 树与 B+ 树：把树高当成 I/O 次数

### 8.1 内存与磁盘的鸿沟

前面所有分析都隐含一个假设：比较的代价是均匀的。这个假设只在数据装得进内存时成立。数据一旦落到磁盘，代价结构就完全变了：

| 操作               | 典型延迟           | 与主存访问的倍差 |
| ---------------- | -------------- | -------- |
| L1 缓存命中          | 约 1 ns         | 1/100    |
| 主存访问（缓存缺失）       | 约 100 ns       | 1        |
| SSD 随机读 4 KB     | 约 50 \~ 100 μs | 约 1000   |
| 机械硬盘随机读（寻道 + 旋转） | 约 8 \~ 10 ms   | 约 10⁵    |

把一次机械硬盘的随机读换算成 CPU 周期（3 GHz），是 3×10⁷ 个周期——**「百万倍」这个说法就是这么来的**（拿磁盘 I/O 和 CPU 执行一条指令比，差距是千万倍量级）。

这带来的结论非常干脆：**如果数据在磁盘上，比较次数一点都不重要，I/O 次数才是唯一的成本**。平衡树的 O(log n) 在这个新模型下变成了「O(log n) 次随机 I/O」，而这个常数是几十毫秒。B 树（B-tree）的存在意义就是把「树高」优化成 I/O 次数——方法不是让树更平衡，而是**让每个节点装下尽可能多的键**。

### 8.2 扇出与高度：一个页装几百个键

磁盘的最小读写单位是**页（page）**，常见大小 4 KB。B 树的节点大小就取一个页，把「键 + 子节点指针」塞满：

```text
页大小 4096 字节，每个索引项 = 8 字节键（bigint）+ 8 字节子页号 = 16 字节
  4096 / 16 = 256 项/页  → 扇出（fanout）约 250

高度 h 对应的记录数（B+ 树，每层按扇出计）：
  h = 1（单个叶子）   : 250 行
  h = 2               : 250 × 250        = 6.3 × 10^4（6 万）
  h = 3               : 250 × 250 × 250  = 1.6 × 10^7（1600 万）
  h = 4               : 250^4            = 3.9 × 10^9（39 亿）

键压到 4 字节（int）+ 4 字节页号 = 8 字节/项：
  4096 / 8 = 512 项/页 → 扇出 512
  h = 3 : 512^3 = 1.34 × 10^8（1.3 亿）      h = 4 : 512^4 = 6.9 × 10^10（690 亿）
```

对照二叉搜索树：每个节点只放 1 个键，一个 4 KB 页里 99% 的空间被浪费，1 亿行需要 `log2(10^8) ≈ 27` 次 I/O，每次只带回 1 个有用的键。B+ 树索引 1 亿行只要 3 次 I/O，每次带回几百个键。**这就是数据库索引用 B+ 树不用二叉树的全部理由。**

实测（本文第 8.4 节的 B+ 树实现，同一份 10⁶ 个键的数据）：

```text
MAX_KEYS = 3    （节点容量 3，扇出 ≤ 4）    → 树高 13
MAX_KEYS = 1023 （节点容量 1023，扇出 ≤ 1024）→ 树高 3
```

同一个数据集，仅仅把节点容量从 3 提到 1023，树高从 13 层降到 3 层——**扇出是高度的杠杆**，而扇出由「页里能装多少键」决定。

> [!IMPORTANT]
> 这里有一个抽象层面的教训：BST 与 B 树面对的是同一个问题（有序查找），但它们的形状由**存储介质的物理粒度**决定。内存的粒度是「一次访存 8 字节」，所以两叉、每节点一个键是合理的；磁盘的粒度是「一次 I/O 一个页」，所以几百叉、每节点几百个键才是合理的。数据结构的设计目标不是「比较次数最少」，而是「让代价最大的那个操作次数最少」。

### 8.3 从 B 树到 B+ 树

B 树（1970 年，Bayer 与 McCreight）在所有节点里都存数据；B+ 树是它最重要的变体，做了两处改动：

1. **数据全部放在叶子层**，内部节点只存「分隔键 + 子页号」。内部节点的条目变小了，同样的页能装更多分隔键，扇出更大、树更矮；同时每次查找的路径长度完全一致（都到叶子），延迟更稳定。
2. **叶子之间用链表相连**（实现里通常是双向）。范围查询和全表顺序扫描于是变成「定位到起点叶子，然后沿链表一路读」——纯粹的**顺序 I/O**。

第 2 条是 B+ 树在数据库里胜出的真正原因。机械硬盘的顺序读比随机读快两个数量级（100+ MB/s vs 每秒几百次寻道），所以：

- `SELECT * FROM t WHERE id BETWEEN 1000 AND 2000`：定位到 id = 1000 的叶子，然后沿链表顺序读若干页。
- `SELECT * FROM t ORDER BY id`：沿叶子链表从第一个叶子读到最后一个，天然有序，无需排序。
- `COUNT(*)`、全表扫描、归并连接的大表侧：都是沿叶子链表流式读取。

B 树做同样的事要在内部节点和叶子之间反复跳转，I/O 模式是「半随机的」。

### 8.4 一个可运行的 B+ 树

下面是一个完整的 B+ 树实现（插入、分裂、查找、范围查询、叶子链表遍历）。节点容量取 3 是为了在文章里能手工推演分裂过程——真实实现取几百，代码逻辑完全一样：

```python
"""B+ 树：数据只在叶子层、叶子用链表相连、内部节点只存分隔键。仅用标准库。"""
import bisect
import random


class BPlusTree:
    MAX_KEYS = 3                    # 每个节点最多几个键；内部节点最多 MAX_KEYS+1 个孩子

    class Leaf:
        __slots__ = ("keys", "vals", "nxt")

        def __init__(self):
            self.keys = []
            self.vals = []
            self.nxt = None         # 指向右邻叶子，范围查询靠它

    class Internal:
        __slots__ = ("keys", "children")

        def __init__(self):
            # 不变式：keys[i] = children[i+1] 子树里的最小键
            self.keys = []
            self.children = []

    def __init__(self):
        self.root = None
        self._size = 0
        self._MISSING = object()

    def __len__(self):
        return self._size

    def _find_leaf(self, key):
        node = self.root
        while isinstance(node, BPlusTree.Internal):
            node = node.children[bisect.bisect_right(node.keys, key)]
        return node

    def search(self, key, default=None):
        node = self._find_leaf(key)
        i = bisect.bisect_left(node.keys, key)
        if i < len(node.keys) and node.keys[i] == key:
            return node.vals[i]
        return default

    def insert(self, key, val=None):
        """插入键值对；键已存在则覆盖值（唯一键语义）。"""
        if self.root is None:
            self.root = BPlusTree.Leaf()
        existed = self.search(key, self._MISSING) is not self._MISSING
        split = self._ins(self.root, key, val)
        if split is not None:                       # 根分裂：树长高一层
            sep, right = split
            new_root = BPlusTree.Internal()
            new_root.keys = [sep]
            new_root.children = [self.root, right]
            self.root = new_root
        if not existed:
            self._size += 1

    def _ins(self, node, key, val):
        """把键值插进 node 子树；返回 None，或分裂产生的 (提升键, 新右节点)。"""
        if isinstance(node, BPlusTree.Leaf):
            i = bisect.bisect_left(node.keys, key)
            if i < len(node.keys) and node.keys[i] == key:
                node.vals[i] = val                  # 覆盖已存在的键
                return None
            node.keys.insert(i, key)
            node.vals.insert(i, val)
            if len(node.keys) <= self.MAX_KEYS:
                return None
            mid = len(node.keys) // 2               # 叶子分裂：右半搬到新叶子
            right = BPlusTree.Leaf()
            right.keys = node.keys[mid:]
            right.vals = node.vals[mid:]
            right.nxt = node.nxt                    # 先接好后继
            node.keys = node.keys[:mid]
            node.vals = node.vals[:mid]
            node.nxt = right                        # 再改前驱的指针，顺序不能反
            return right.keys[0], right             # 新叶子的最小键提升给父节点

        i = bisect.bisect_right(node.keys, key)
        split = self._ins(node.children[i], key, val)
        if split is None:
            return None
        sep, new_child = split
        node.keys.insert(i, sep)
        node.children.insert(i + 1, new_child)
        if len(node.keys) <= self.MAX_KEYS:
            return None
        mid = len(node.keys) // 2                   # 内部节点分裂：中间键提升走人
        up = node.keys[mid]
        right = BPlusTree.Internal()
        right.keys = node.keys[mid + 1:]
        right.children = node.children[mid + 1:]
        node.keys = node.keys[:mid]
        node.children = node.children[:mid + 1]
        return up, right

    def keys(self):
        """沿叶子链表升序遍历全部键。"""
        node = self.root
        while isinstance(node, BPlusTree.Internal):
            node = node.children[0]
        while node is not None:
            yield from node.keys
            node = node.nxt

    def range_query(self, lo, hi):
        """[lo, hi] 内的键值对：定位到 lo 所在叶子，然后顺着链表走。"""
        out = []
        node = self._find_leaf(lo)
        while node is not None:
            for k, v in zip(node.keys, node.vals):
                if k > hi:
                    return out
                if k >= lo:
                    out.append((k, v))
            node = node.nxt
        return out

    def height(self):
        """从根走到最左叶子，层数就是「磁盘 I/O 次数」的量级。"""
        node, depth = self.root, 0
        while node is not None:
            depth += 1
            node = node.children[0] if isinstance(node, BPlusTree.Internal) else None
        return depth


if __name__ == "__main__":
    random.seed(0)
    t = BPlusTree()
    for k in [10, 20, 30, 40, 50, 60, 70, 80, 90, 5, 15, 25]:
        t.insert(k, f"v{k}")
    t.insert(30, "覆盖")                            # 唯一键：覆盖而不是新增
    assert len(t) == 12 and t.search(30) == "覆盖" and t.search(31) is None
    assert list(t.keys()) == [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90]
    assert t.range_query(15, 40) == [(15, "v15"), (20, "v20"), (25, "v25"),
                                     (30, "覆盖"), (40, "v40")]

    # 随机顺序插入 1000 个键：叶子链表本身就是升序
    t = BPlusTree()
    for k in random.sample(range(1000), 1000):
        t.insert(k, k * k)
    assert list(t.keys()) == list(range(1000))
    assert t.range_query(500, 509) == [(k, k * k) for k in range(500, 510)]
    print("MAX_KEYS =", BPlusTree.MAX_KEYS, "：1000 个键的树高 =", t.height())

    # 扇出决定高度：把节点容量提到 1023（一个 4KB 页的规模），100 万键只要 3 层
    BPlusTree.MAX_KEYS = 1023
    big = BPlusTree()
    for k in range(1_000_000):
        big.insert(k, k)
    assert big.search(999_999) == 999_999 and big.search(0) == 0
    print("MAX_KEYS =", BPlusTree.MAX_KEYS, "：100 万个键的树高 =", big.height())
```

三个必须理解的实现细节：

- **分裂的接线顺序**：先 `right.nxt = node.nxt`，再 `node.nxt = right`。写反了会把 `right` 指向自己（成环），范围查询直接死循环——这是 B+ 树最经典的 bug（第 12 节）。
- **内部节点只提升键、不留键**：内部节点分裂时，中间那个键被「提升」到父节点，自己**不在**任何节点里保留副本；而叶子分裂时新叶子的第一个键是**复制**上去当分隔键的（它仍留在叶子里）。这两处的差异是 B+ 树实现的常见困惑点。
- **查找走两次**：插入时先 `search` 判断键是否存在（为了维护 `_size`），真实实现只走一次。用一次下行换取代码清晰，在这里是值得的。

## 9. B+ 树在数据库里的样子

### 9.1 聚簇索引与二级索引

在 InnoDB 里，主键索引的**叶子节点直接存整行数据**，这棵树就是表本身（术语叫索引组织表，index-organized table），这种索引叫聚簇索引（clustered index）：

```sql
CREATE TABLE orders (
  id      BIGINT PRIMARY KEY,     -- 聚簇索引：叶子存整行
  user_id BIGINT,
  status  VARCHAR(16),
  amount  DECIMAL(10,2)
);
CREATE INDEX idx_user ON orders(user_id);   -- 二级索引：叶子存 (user_id, id)
```

两类查询的区别就在「要不要回表」：

| 查询                                             | 走哪棵树                | I/O 特征                             |
| ---------------------------------------------- | ------------------- | ---------------------------------- |
| `WHERE id BETWEEN 1000 AND 2000`               | 聚簇索引，定位后沿叶子链表顺序读    | 顺序 I/O，无需回表                        |
| `SELECT id FROM orders WHERE user_id = 42`     | 二级索引，叶子里已有 id       | 覆盖索引（covering index），免回表           |
| `SELECT amount FROM orders WHERE user_id = 42` | 先二级索引拿到主键，再回聚簇索引取整行 | **回表（bookmark lookup）**：每行一次随机 I/O |

二级索引的叶子为什么存主键而不是行地址？两个原因：① **行会移动**——页分裂、更新导致行长变化、行迁移都会改变物理位置，存地址就要在每次行移动时更新所有二级索引；② **主键稳定且紧凑**，而且它是 InnoDB 里唯一的全局定位方式。

> [!TIP]
> 「二级索引的叶子存主键」有一个容易被忽略的推论：**主键越长，所有二级索引就越大**。用 36 字节的 UUID 当主键，每个二级索引的每个叶子条目都多背 36 字节，而且页的扇出变小、树变高。这就是「主键要短、要单调递增」这两条经验的由来——单调递增还额外带来写入的局部性：自增主键的插入永远落在最右叶子上，页分裂集中在尾部（甚至能靠填充因子完全避免分裂）；随机 UUID 则会让插入均匀散落到所有叶子，造成大量随机 I/O 和页分裂。

### 9.2 联合索引与最左前缀

联合索引 `(a, b, c)` 就是一棵按 `(a, b, c)` 字典序排序的 B+ 树：叶子链表上的键元组先按 a 排序，a 相同的按 b 排，再按 c。**「最左前缀」规则完全来自这条有序性**，不需要额外记忆：

```sql
CREATE INDEX idx_user_status ON orders(user_id, status);

EXPLAIN QUERY PLAN SELECT * FROM orders WHERE user_id = 42;
EXPLAIN QUERY PLAN SELECT * FROM orders WHERE user_id = 42 AND status = 'paid';
EXPLAIN QUERY PLAN SELECT * FROM orders WHERE user_id = 42 ORDER BY status;
EXPLAIN QUERY PLAN SELECT * FROM orders WHERE status = 'paid';
```

（SQLite 的执行计划，与其它数据库的结论一致）：

```text
EXPLAIN QUERY PLAN SELECT * FROM orders WHERE user_id = 42;
  SEARCH orders USING INDEX idx_user_status (user_id=?)
EXPLAIN QUERY PLAN SELECT * FROM orders WHERE user_id = 42 AND status = 'paid';
  SEARCH orders USING INDEX idx_user_status (user_id=? AND status=?)
EXPLAIN QUERY PLAN SELECT * FROM orders WHERE user_id = 42 ORDER BY status;
  SEARCH orders USING INDEX idx_user_status (user_id=?)
EXPLAIN QUERY PLAN SELECT * FROM orders WHERE status = 'paid';
  SCAN orders
```

逐条读：

- `WHERE user_id = 42`：能定位。因为按 user\_id 排序的叶子链表上，所有 `user_id = 42` 的记录是**连续的一段**，一次二分就能收敛到起点。
- `WHERE user_id = 42 AND status = 'paid'`：两列都能用于定位。在「user\_id = 42 的那一段」内部，记录按 status 有序，所以第二列也能二分。
- `WHERE user_id = 42 ORDER BY status`：能用索引，而且**不需要额外排序**（计划里没有 `USE TEMP B-TREE FOR ORDER BY`）——因为 a 相同的那一段里 b 天然有序。这正是「联合索引可以顶替 order by」的原理。
- `WHERE status = 'paid'`：**只能全表扫描**。同一个 status 值在叶子链表上不是连续的：它分散在每一个 user\_id 段里，无法用一次二分定位。这就是「跳过最左列会失效」的全部原因。

同理可以推出索引设计的几条硬规则：

| 规则                   | 依据                                                    |
| -------------------- | ----------------------------------------------------- |
| 等值条件列放前面，范围条件列放后面    | 一旦某列用了范围（`>`、`BETWEEN`、`LIKE 'x%'`），后续列虽然局部有序但无法再二分收敛 |
| 等值列里区分度高的放前面         | 二分匹配的候选段更短，过滤掉更多数据                                    |
| 尽量让查询涉及的列都在索引里（覆盖索引） | 免回表，省掉每行一次随机 I/O                                      |
| 联合索引列不要过多            | 每列都让索引变大、让写入维护成本上升                                    |
| 索引不是免费的              | 每个索引都是一棵额外维护的 B+ 树：写入要同步更新所有索引，写放大                    |

## 10. 其他平衡树速览

| 结构              | 平衡方式                                 | 保证          | 一句话定位                                                                         |
| --------------- | ------------------------------------ | ----------- | ----------------------------------------------------------------------------- |
| Treap（树堆）       | 每个节点带随机优先级，同时满足按 key 的 BST 序与按优先级的堆序 | 期望 O(log n) | 树形等价于随机 BST，但随机性来自优先级字段，**与插入顺序彻底无关**——排序输入也不会退化。比 AVL 好写，删除用「旋转下沉」，擅长分裂 / 合并 |
| Splay（伸展树）      | 每次访问把节点旋转到根（自调整）                     | 摊还 O(log n) | 不需要任何额外字段；反复访问热点键会形成缓存友好的形态。代价是读操作也会改结构，不适合并发只读场景，且摊还不承诺单次延迟                  |
| 替罪羊树（scapegoat） | 重量平衡：`size(left) ≤ α·size(node)`     | 摊还 O(log n) | 平时完全不修，只在某个祖先「超重」时把它整棵子树原地重建（α 常取 2/3）。实现比旋转类平衡树简单得多，且节点只需子树大小（顺便白送排名功能）      |
| 2-3-4 树         | 多路平衡（每节点 2\~4 个孩子）                   | 最坏 O(log n) | 它的二叉表示就是红黑树（6.4 节）；理解红黑树的最佳跳板                                                 |
| AA 树            | 红黑树 + 「红链接只能向右倾斜」的限制                 | 最坏 O(log n) | 把红黑树的 case 从 7 种压到 2 种，代码量约为三分之一。要自己动手实现平衡树时，从它开始最合适                          |

选型经验：要最紧的查询延迟选 AVL；要通用容器选红黑树（或直接用标准库）；要可分裂可合并、要简单实现选 Treap 或跳表；要摊还性能且访问有局部性选 Splay；要少写代码又要平衡树选 AA 树。

## 11. 标准库对照与选型清单

### 11.1 各语言的有序结构

| 语言     | 有序映射 / 集合               | 底层结构             | 关键细节                                                                                        |
| ------ | ----------------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| C++    | `std::map` / `std::set` | 红黑树              | 节点独立分配、指针追逐；删除只失效被删元素的迭代器；提供 `lower_bound` / `upper_bound` / `equal_range`                  |
| Java   | `TreeMap` / `TreeSet`   | 红黑树              | `NavigableMap` 接口：`floorKey` / `ceilingKey` / `firstKey` / `subMap` / `headMap` / `tailMap` |
| Rust   | `BTreeMap` / `BTreeSet` | B 树（每节点最多 11 个键） | 见下                                                                                          |
| Python | 无内置                     | —                | 需要第三方 `sortedcontainers` 的 `SortedList` / `SortedDict` / `SortedSet`                        |

**Rust 为什么用 B 树而不是红黑树**：B 树的节点里连续存放多个键，一次缓存行（64 字节）就能装下若干个键和指针，二分比较发生在缓存内部——指针追逐的次数比红黑树少一个数量级；节点内也不需要颜色位和额外的平衡字段，每个元素的内存开销更低；迭代时顺着节点内部和兄弟指针走，是接近顺序的访存模式。Rust 的实现把每个节点控制在约一个缓存行到一页的规模（默认最多 11 个元素），要的是「缓存友好」而不是「比较次数最少」——和 B+ 树面对磁盘时的取舍是同一个逻辑，只是这里的「页」是缓存行。

**Python 的替代方案**：`sortedcontainers.SortedList` 用「分块有序数组」实现——把一个有序序列切成约 1000 个元素一块，块内有序、块之间用块首元素维护一个有序索引。查找是两次二分（O(log n)），插入删除是「二分定位 + 块内搬移」，搬移是千元素级的 `memmove`（纳秒到微秒量级，理论上块大小与 n 同阶时是 O(√n)）。它比手写平衡树省事得多，代价是插入删除不是严格的 O(log n)：对百万级以下、且插入删除不在最热路径上的场景完全够用。

### 11.2 什么时候该用有序结构

| 需求                   | 有序结构的代价                         | 哈希表的代价            |
| -------------------- | ------------------------------- | ----------------- |
| 前驱 / 后继（「比 x 小的最大键」） | O(log n)（`lower_bound` 后移位）     | 只能 O(n) 全扫        |
| 范围查询 \[a, b]         | O(log n + k)                    | O(n) 全扫           |
| 按序输出 / 归并 / 归并连接     | O(n) 中序遍历                       | 需要 O(n log n) 先排序 |
| 排名 / 第 k 小           | O(log n)（需子树大小或 span 字段）        | 做不了               |
| 区间重叠查询（时间窗、地理范围）     | O(log n + k)（区间树 / 线段树，骨架是 BST） | 做不了               |
| 最大 / 最小值             | O(log n) 或 O(1)（跳表首尾节点）         | O(n)              |
| 稳定的最坏情况保证            | 最坏 O(log n)                     | 最坏 O(n)           |

反过来，这些情况下不该用有序结构：n 很小（线性扫描更快，见 [第 01 篇](01-complexity-analysis.md) 第 3 节）；只需要等值查找（哈希表更快且更省内存）；插入远多于查询且完全不需要顺序（哈希表或尾部追加）；内存极度受限（树的每个节点都有指针/颜色开销）。

需要「等值 O(1) + 有序遍历」两种能力时，标准做法是**双结构**：哈希表负责定位，有序结构负责顺序（Redis 的 zset 就是哈希表 + 跳表），代价是两份内存和写入时的一致性维护（[第 17 篇](17-choosing-structures.md)）。

## 12. 陷阱清单

**1. C 里删除只替换值、不摘链或忘记 free。** 把后继的键抄到目标节点后，必须真的把后继节点从树上摘下来并释放。下面这段是第一版 C 实现（摘链 + `free` 都做对了）：

```c
/* 摘掉子树里的最小节点，把它的键交回 *out，并释放这个节点。 */
static Node *delete_min(Node *t, int *out)
{
    if (t->left == NULL) {
        Node *right = t->right;
        *out = t->key;
        free(t);                       /* 摘链 + 释放，两个动作都不能省 */
        return right;
    }
    t->left = delete_min(t->left, out);
    return t;
}
```

漏掉 `free(t)` 的实现有两个后果：树上留着一个与被删键相同的节点（于是「删了还在」，而且这个节点再也删不掉），以及那块内存永远回收不了。如果实现方式是「复制节点内容」（比如把 payload 指针换过去而不是换键），漏掉 `free` 就只剩内存泄漏——它不会立刻报错，只会在长时间运行的服务里慢慢吃掉内存。

**2. 用「小于等于」写插入却用「严格小于」写查找。** `if key <= node.key: go left` 会把重复键塞进左子树，此时树里出现了等于根节点的键，中序不再是严格升序，前驱后继/范围查询会返回重复值，删除只删掉其中一个。要么统一拒绝重复键（本文做法），要么给节点加计数，要么明确规定重复键固定在右侧并且全部操作遵循同一约定。

**3. 比较函数不满足严格弱序（strict weak ordering）。** C++ 的 `std::map`/`std::sort` 要求比较器满足「`comp(x, x)` 为假」且传递。写成 `return a <= b;`（把相等也算「小于」）或 `return a.x - b.x;`（差值溢出、或不同元素差值恰为 0 时被判等）都会破坏它；后果是未定义行为，典型表现是元素插进去查不到、迭代器越界、死循环。正确写法是按字段短路：

```cpp
struct Item { int x; int y; };
struct Cmp {
    bool operator()(const Item &a, const Item &b) const {
        if (a.x != b.x) return a.x < b.x;   // 先用 <，不用 <=
        return a.y < b.y;                   // 平局字段继续用 <，给出全序
    }
};
```

Java 的 `Comparator` 契约类似：`compare(x, y)` 与 `compare(y, x)` 必须符号相反，且必须传递；返回 0 被当作「同一个键」，契约被破坏时 `TreeMap` 会静默丢元素。

**4. 在有序结构里存可变键。** 树的位置是按插入那一刻的键值算出来的，之后修改键的值不会移动节点，于是有序性被破坏：查找开始不命中（走的路径和实际位置对不上），范围查询漏数据，删除可能删错或删不掉。Python 里把 `list`、可变对象当键，或者在对象被用作键之后修改参与比较的字段，都会踩到这条。规则很简单：**进入有序结构的键必须不可变**；Rust 的 `Ord` 契约同理（内部可变性是唯一的例外，也是唯一的陷阱）。

**5. 忘记回溯更新高度 / 颜色，或者更新顺序写反。** AVL 只更新旋转处的两个节点、忘了更新祖先的高度，平衡因子就会失真——树不会立刻坏掉，只是会慢慢歪下去，表现为「性能随时间退化」而不是报错。旋转里的顺序同样关键：先更新下沉的节点、再更新升上来的节点（后者的高度依赖前者）；写反了会用到旧值，误差会一层层放大。

**6. B+ 树叶子链表断裂。** 分裂时必须 `right.nxt = node.nxt` 在前、`node.nxt = right` 在后；删除或合并节点时忘了改前驱的 `nxt`，范围查询就会漏数据或者死循环。这类 bug 的可怕之处在于测试很难覆盖——要恰好触发一次分裂/合并才暴露。真实数据库在这层写大量断言与页校验和（checksum），正是因为「链表断了」是最难在事后定位的一类损坏。

**7. 用递归实现 BST，然后在退化输入上爆栈。** `import sys; sys.setrecursionlimit(...)` 只是把崩溃点往后推（C 栈先爆）。查找和遍历写迭代；插入删除要么写迭代（带父指针或显式栈），要么保证树是平衡的（h = O(log n)），让递归深度可控。

> [!CAUTION]
> 上面第 2、3、4 条有一个共同特征：**它们都不会让程序崩溃，只会让数据结构静默地给出错误的答案**——查不到明明存在的键、范围查询少返回几行、删除删不掉。这类问题的排查成本远高于崩溃。防御手段是「用对照组做差分测试」（第 2.5 节）和「把不变式写成断言」（第 1.3 节的 `check_bst`），而不是靠肉眼审查代码。

## 13. 小结

- BST 的全部内容是一个不变式：左子树 < 每个节点 < 右子树。它的区间表述「每个节点把区间切成两半」直接解释了查找、插入、删除、前驱后继、范围查询的实现与复杂度——所有操作的复杂度都带一个共同因子 h（树高）。
- 三个操作里只有删除需要技巧：双孩子节点用中序后继（或前驱）的键接替，因为只有这两个键同时大于左子树、小于右子树；而右子树的最小节点必然没有左孩子，所以摘掉它总是简单情形。
- 树高是唯一的命门。有序插入得到 h = n；随机插入的期望是 4.31·ln n（约 3 倍于 log₂ n，n = 10⁶ 时 60 层）；「几乎有序」和「完全有序」一样致命（10⁵ 个键里挪动 100 个 → 高度 10449）。把最坏情况交给输入顺序，等于没有承诺。
- 平衡的本质是「把树高维护成不变式」：AVL 约束高度差 ≤ 1（上界 1.44·log₂ n），红黑树约束颜色（上界 2·log₂ n），替罪羊树约束重量比。保证的类型要分清：AVL/红黑树/B+ 树是最坏情况保证，跳表/Treap 是期望保证，Splay/替罪羊是摊还保证。
- AVL 用最紧的高度换查询速度，代价是删除时可能沿路径一路旋转（O(log n) 次）；红黑树允许 2 倍的高度差，换来插入 ≤ 2 次、删除 ≤ 3 次旋转且修复局部化——通用容器选后者的原因就在这。红黑树是 2-3-4 树的二叉表示，五条性质推出的高度上界是 2·log₂(n+1)。
- 跳表用「插入时抛硬币决定层数」替代旋转：随机性来自结构内部而非输入顺序，所以期望 O(log n) 与数据无关；范围查询是纯链表遍历，实现比平衡树简单一个量级。Redis 的 zset 选它，是为了范围操作、排名（span 字段）和实现简单。
- 数据落到磁盘后，成本的度量从「比较次数」变成「I/O 次数」。B 树把节点做成一个页，4 KB 页装 250\~500 个键，扇出 500 时三层就能索引上亿行；B+ 树把数据全部下放到叶子并用链表连接叶子，范围查询和全表扫描变成顺序 I/O。数据库索引、聚簇与二级索引、联合索引的最左前缀，都是这棵树有序性的直接推论。
- 该用有序结构的信号：前驱后继、范围查询、按序遍历、排名 / 第 k 小、区间重叠、需要最坏情况保证。不该用的信号：只需要等值查找、n 很小、写多读少且不需要顺序。

## 14. 练习

**1.** 依次插入 `[5, 3, 8, 1, 4, 7, 9]`，画出最终的树，写出中序序列。然后删除 5：哪些键可以接替它的位置？分别画出两种替换后的树形，并验证中序序列不变。

> [!TIP]
> 思路插入顺序无关，最终树形是 `5(3(1, 4), 8(7, 9))`，中序为 `1 3 4 5 7 8 9`。删除 5 时，右子树是 `8(7, 9)`：中序后继是 7（右子树最左下的节点），中序前驱是 4（左子树最右下的节点），只有这两个键满足「大于左子树全部、小于右子树全部」。用 7 接替得到 `7(3(1, 4), 8(-, 9))`；用 4 接替得到 `4(3(1, -), 8(7, 9))`。两棵树的中序都是 `1 3 4 7 8 9`（删掉 5 之后），因为替换只是把「中序序列里相邻的键挪进了被删位置」。

**2.** 为什么「随机插入的期望高度是 O(log n)」不能作为生产环境的性能承诺？举两种现实中常见的插入顺序，说明它们如何把高度推高。

> [!TIP]
> 思路因为它是对输入分布的假设，不是结构自身的性质。两种典型输入：① 完全有序（自增主键、时间戳、从有序文件读入）→ 每次插入都走最右侧到底，树退化成链，h = n；② 几乎有序（10⁵ 个键里只挪动 100 个）→ 每个被挪动的键都会在其后造出一段长链，实测高度 10449。第二类最危险，因为「看起来是随机的」输入经常是这种形态。结论：要么用有最坏保证的结构（AVL/红黑树），要么在接口文档里明确声明假设。

**3.** 用本文的 AVL 代码验证：依次插入 `3, 2, 1` 会触发哪种失衡、旋转后根是谁；继续插入 `0` 和 `5`，还需要旋转吗？为什么？

> [!TIP]
> 思路插入 3、2、1 后节点 3 的 bf = +2 且左孩子 2 的 bf = +1 → LL，右旋后根是 2，树形 `2(1, 3)`。再插入 0：走 2 → 1 → 左，1 的左孩子是 0，此时 1 的 bf = +1、2 的 bf = +1，全树仍满足 |bf| ≤ 1，不旋转。再插入 5：走 2 → 3 → 右，3 的 bf = −1、2 的 bf = 0，同样合法。这说明**旋转只在首次出现 |bf| = 2 时触发**，插入的键落在「较高那侧的同向子树」里才构成失衡——这也正是插入最多只需要一次修复的原因。

**4.** 从红黑树的五条性质出发，证明高度上界是 2·log₂(n+1)。

> [!TIP]
> 思路由性质 4，任一路径上没有相邻红节点，所以红节点数 ≤ 黑节点数，路径长度 ≤ 2 × 黑高 bh。由性质 5，所有路径的黑节点数都等于 bh，所以最短路径长度 ≥ bh，于是最长路径 ≤ 2 × 最短路径。再用归纳证明「黑高为 bh 的子树至少有 2^bh − 1 个内部节点」：从黑高 bh 的黑节点出发，它的每个孩子要么是黑的（子树黑高 bh−1），要么是红的（性质 4 保证红孩子的孩子是黑的，其子树黑高也是 bh−1），所以 N(bh) ≥ 2·N(bh−1) + 1。于是 n ≥ 2^bh − 1 → bh ≤ log₂(n+1) → h ≤ 2·log₂(n+1)。

**5.** 跳表把 p 从 0.5 改成 0.25，空间和查找代价各有什么变化？为什么 Redis 选 0.25？

> [!TIP]
> 思路空间：每个节点的期望指针数 = 1/(1−p)，从 2 降到 1.33（这是最主要的收益）。层次：最大层数 ≈ log\_(1/p) n，从 log₂ n 降到 log₄ n（n = 10⁶ 时从约 20 层降到约 10 层）；但每层需要向右走的期望步数 ≈ (1−p)/p，从 1 涨到 3。两边的乘积基本不变——总期望代价 (1/p)·log\_(1/p) n 在 p = 1/e ≈ 0.37 处最小，p 取 0.5 和 0.25 时 n = 10⁶ 都约 40 步。Redis 在「都接近最优」的两个点里选了更省内存的 0.25，并配 max\_level = 32 兜住上限。

**6.** 一个 4 KB 的页，每个索引项 8 字节。扇出是多少？高度 3 的 B+ 树能索引多少行？如果每项因为行内数据膨胀到 256 字节，高度 3 又能索引多少行？这个对比说明什么？

> [!TIP]
> 思路4096 / 8 = 512 项/页 → 扇出 512，高度 3 的容量是 512³ ≈ 1.34×10⁸ 行（1.3 亿）。若每项 256 字节，一页只能放 16 项，高度 3 只能索引 16³ = 4096 行——相差约 3 万倍。结论：**扇出是树高的唯一杠杆**，所以 B+ 树必须把数据从内部节点挪到叶子层（内部节点只留分隔键和页号），这正是 B+ 树相对 B 树的核心改动。

**7.** 二级索引的叶子节点为什么存主键值，而不是直接存数据行的物理地址？

> [!TIP]
> 思路① 行会移动：页分裂、更新导致行长变化、行迁移都会改变物理位置，存地址意味着每次移动都要回头更新所有二级索引，代价与索引数量成正比；② 主键稳定且紧凑，是 InnoDB 里唯一的全局定位方式，回表就是「用主键再查一次聚簇索引」。副作用是主键的长度会摊到所有二级索引上（主键越长，二级索引越大、扇出越小），所以主键要短。若查询的列都能在二级索引里找到（覆盖索引），就连回表都省了。

**8.** 联合索引 `(a, b)` 上，下面哪些查询能用索引定位：① `WHERE a = 1`；② `WHERE b = 2`；③ `WHERE a > 1 AND b = 2`；④ `WHERE a = 1 ORDER BY b`。

> [!TIP]
> 思路① 能：a 相同的记录在叶子链表上是连续的一段，一次二分收敛。② 不能：同一个 b 值分散在每一个 a 段里，不连续，只能全扫（或数据库的 skip scan 优化）。③ 部分能用：可以用 a 做范围扫描，但 b 在每个 a 段里虽然有序，跨段不全局有序，无法用一次二分同时约束，只能在扫描时逐行过滤 b。④ 能，且不需要额外排序：a 相同的那一段内 b 天然有序，索引直接满足 ORDER BY（执行计划里不会出现额外的排序步骤）。共同的判据只有一条：**条件对应的键元组在叶子链表上是否是连续或分段连续的有序区间**。
