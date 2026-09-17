---
title: 栈与队列：限制带来的力量
order: 3
tags: 栈, 队列, 单调栈
summary: LIFO/FIFO 的实现要点、单调栈与单调队列两个高频套路、循环队列的取模细节。
---

栈和队列都是"受限的线性表"：栈只从一端进出（LIFO，后进先出），队列一进一出（FIFO，先进先出）。限制越强，能保证的性质越多——它们的经典应用全是靠这种顺序保证换来的。

## 栈：函数调用、括号匹配、深度优先

栈的操作只有 push / pop / peek，全部 O(1)。用动态数组实现即可（尾部追加/弹出天然就是栈顶）。

```python
stack = []
stack.append(x)      # push
top = stack[-1]      # peek
x = stack.pop()      # pop
```

栈的三个招牌应用，共同点是**"最近处理的先了结"**：

1. **函数调用栈**：递归的每层调用就是一个栈帧，return 即出栈——所以递归太深会栈溢出
2. **括号匹配**：左括号入栈，右括号找栈顶配对，天然处理嵌套
3. **深度优先搜索 / 回溯**：走过的路压栈，走不通退回来重选

> [!NOTE]
> 递归本质就是隐式用栈。任何递归都能改写成显式栈的迭代版，代价是不再受调用栈大小限制。

## 单调栈：下一个更大元素

维护一个**值单调的栈**，新元素入栈前把破坏单调性的都弹掉。弹出的瞬间往往就是答案产生的瞬间：

```python
# 每个元素右边第一个比它大的数
def next_greater(nums):
    ans = [-1] * len(nums)
    st = []                      # 存下标，值从栈底到栈顶递减
    for i, x in enumerate(nums):
        while st and nums[st[-1]] < x:
            ans[st.pop()] = x    # 弹出的元素，答案就是 x
        st.append(i)
    return ans
```

每个元素最多入栈、出栈各一次，整体 O(n)。括号匹配、柱状图最大矩形、每日温度，全是这一个骨架。

## 队列：广度优先与生产者消费者

队列用"头出尾进"保证**先进来的先处理**：任务调度、消息队列、BFS 的待访问层，都靠它维持公平的顺序。

- 链表或带头尾指针的数组都可实现，enqueue/dequeue O(1)
- 语言标准库一般有现成的双端队列：Python `collections.deque`、C++ `std::deque`
- **别用动态数组当 FIFO 队列**：`pop(0)` 要整体搬移 O(n)；首指针后移的"假满"问题则用循环队列解决

### 循环队列的取模细节

用数组 + 首尾下标 + 取模让空间循环复用：

```c
// 容量 cap，用 size 区分空与满（否则 head == tail 二义）
q->head = (q->head + 1) % cap;
q->size--;
bool empty(Queue *q) { return q->size == 0; }
bool full(Queue *q)  { return q->size == q->cap; }
```

> [!WARNING]
> 经典坑：空队列和满队列时 head == tail 相同。要么留一个空位（满：`(tail+1)%cap == head`），要么像上面一样单独维护 size。

## 单调队列：滑动窗口最值

维护一个下标递增、对应值也单调的双端队列，队首永远是当前窗口的最值：

```python
# 长度 k 的滑动窗口最大值，O(n)
from collections import deque
def max_sliding_window(nums, k):
    dq, ans = deque(), []          # 存下标，值从队首到队尾递减
    for i, x in enumerate(nums):
        while dq and nums[dq[-1]] <= x: dq.pop()   # 比它小的永不当最大
        dq.append(i)
        if dq[0] <= i - k: dq.popleft()            # 队首滑出窗口
        if i >= k - 1: ans.append(nums[dq[0]])
    return ans
```

对比堆解法（O(n log n)），单调队列是严格 O(n)——滑动窗口最值的标准答案。

## 一句话记住

- 要"撤销/回退/最新优先" → 栈
- 要"公平排队/按层推进" → 队列
- 要"下一个更大/更小" → 单调栈
- 要"滑动窗口最值" → 单调队列
