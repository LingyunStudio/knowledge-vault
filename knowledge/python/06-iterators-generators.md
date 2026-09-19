---
title: 迭代器与生成器：惰性的力量
order: 6
tags: 迭代器协议, yield, 生成器, itertools, 惰性求值
summary: iterable 与 iterator 的协议分工、yield 的状态机本质、生成器的一次性与流水线组合、yield from 与 send 的双向通道、itertools 全景，以及「惰性换内存」的工程边界。
---

for 循环能遍历文件、列表、字典、生成器、网络流——它们类型各异，凭什么都能 for？答案是**迭代协议**：任何实现了 `__iter__`/`__next__` 的对象都能被遍历。而**生成器**是「用函数语法实现迭代协议」的机制——写个带 yield 的函数，Python 自动替你生成整个迭代器类。这一对组合是 Python 处理「任意序列、无限流、大文件」的地基。

## 1. 迭代协议：iterable 与 iterator 的分工

两个角色必须分清：

| 角色       | 协议                          | 职责                       | 例子                |
| ---------- | ----------------------------- | -------------------------- | ------------------- |
| 可迭代 iterable | `__iter__()` 返回迭代器   | 「我能被遍历」——可反复      | list、str、dict、文件 |
| 迭代器 iterator | `__iter__()` + `__next__()` | 「我在遍历中」——有位置、会耗尽 | 文件对象、生成器、zip 结果 |

for 循环的真实执行过程：

```python
for x in xs: ...

# 等价展开：
_it = iter(xs)            # ① 拿迭代器：xs.__iter__()
while True:
    try:
        x = next(_it)     # ② 取下一个：_it.__next__()
    except StopIteration: # ③ 耗尽信号
        break
    ...
```

两个由此推出的行为规则：

1. **可迭代对象可以重复遍历，迭代器是消耗品**。`list` 每次 for 都从 `__iter__` 领一个新迭代器（从头再来）；而 `zip(a, b)`、文件对象、生成器**本身是迭代器**——遍历一次就耗尽：

```python
g = (x * 2 for x in range(3))
list(g)        # [0, 2, 4]
list(g)        # [] ⚠️ 已耗尽 —— 第二次是空！

z = zip([1, 2], "ab")
list(z)        # [(1,'a'), (2,'b')]
list(z)        # [] —— zip 返回的也是一次性迭代器
```

2. **手动驱动**：`next(it, default)` 可以带默认值（耗尽不抛异常），是「从迭代器取一个」的标准工具。

```python
class Countdown:
    def __init__(self, n): self.n = n
    def __iter__(self): return self          # 自身就是迭代器
    def __next__(self):
        if self.n <= 0: raise StopIteration
        self.n -= 1
        return self.n + 1

list(Countdown(3))          # [3, 2, 1]
```

手写迭代器类是理解协议的方式；**实际写代码时，下面几乎所有场景都用生成器**——同样的逻辑，函数语法加一个 yield。

## 2. 生成器：yield 把函数变成状态机

```python
def countdown(n):
    while n > 0:
        yield n          # 执行到这里：交出值、暂停、保留全部局部状态
        n -= 1           # 下次 next() 从这里恢复

g = countdown(3)
next(g)      # 3   —— 函数体执行到 yield 暂停
next(g)      # 2   —— 从 yield 下一行恢复
next(g)      # 1
next(g)      # StopIteration —— 函数体走完
```

`yield` 的语义精确地说是：**函数不再「运行到返回」，而是「执行到让步，冻结现场，下次从冻结点恢复」**。局部变量、循环位置、执行点全部保存在生成器对象里——这就是「用函数语法写状态机」：

```python
# 对照：同一个 Countdown，生成器版 4 行 vs 类版 10 行
def countdown(n):
    while n > 0:
        yield n
        n -= 1
```

生成器函数与普通函数的判别：**函数体里出现 yield，它就是生成器函数**——调用它**不执行任何代码**，只返回生成器对象（首次 next 才开始执行）：

```python
def gen():
    print("start")      # 首次 next 时才打印！
    yield 1

g = gen()               # 无输出
next(g)                 # start / 1
```

## 3. 惰性流水线：内存与时间的双重收益

生成器的真正威力在**组合**：每个生成器逐元素处理、即取即用，整条流水线的内存占用是 O(1)（不管数据多大）：

```python
# 需求：10 GB 日志文件里，统计 ERROR 行的 IP 分布
def read_lines(path):
    with open(path, encoding="utf-8") as f:      # 文件本身就是惰性迭代器
        for line in f:
            yield line.rstrip("\n")

def error_lines(lines):
    for line in lines:
        if "ERROR" in line:
            yield line

def extract_ips(lines):
    for line in lines:
        yield line.split(" ip=")[1].split(" ")[0]

from collections import Counter
counts = Counter(extract_ips(error_lines(read_lines("huge.log"))))
# 全程 O(1) 内存：任何时刻只有一个"元素"在流水线中流动
```

对照「先把全部行读进 list」的版本：10 GB 数据要 10+ GB 内存。**惰性流水线不是优化技巧，是处理流式数据的唯一可行方式**（与 Unix 管道的哲学同构：`grep ERROR | awk | sort | uniq -c`）。

生成器表达式是流水线的轻量语法：

```python
total = sum(len(l) for l in error_lines(read_lines("huge.log")))
# 传给函数时无需括号；独立使用写成 (x for x in xs)
```

> [!WARNING]
> 惰性也有代价：**结果不在调用时产生**。两类陷阱——①生成器被消费一次后为空（「为什么第二次循环没数据」）；②延迟执行叠加外部状态变化（生成器 finally 执行时文件已关闭、变量已变）。需要「可重复遍历的数据」就老实用 list；需要「一次性流」才用生成器。

## 4. 生成器的进阶面：send、close 与 yield from

### 4.1 双向通信：send

```python
def averager():
    total = 0.0
    count = 0
    average = None
    while True:
        value = yield average          # yield 既是「交出」也是「接收」
        total += value
        count += 1
        average = total / count

avg = averager()
next(avg)                # 先推进到第一个 yield（预热，必须！）
avg.send(10)             # 10.0
avg.send(20)             # 15.0
avg.send(30)             # 20.0
```

`yield` 左侧接住 `send()` 传入的值——生成器从「数据源」升级为「有状态的协处理器」。这条路线的历史终点是 async/await 协程（[第 11 篇](11-standard-library.md)）：`await` 本质上是「让出控制权并等待恢复」的 yield 语义后代。日常数据处理用不到 send，但读懂它就读懂了协程的史前史。

### 4.2 yield from：委托与返回值

```python
def inner():
    yield 1
    yield 2
    return "done"                  # 生成器的 return 值放进 StopIteration

def outer():
    result = yield from inner()    # 逐项转发 inner 的产出，并把它的返回值接住
    print(result)                  # done
    yield 99

list(outer())      # [1, 2, 99]
```

`yield from` 建立「生成器调用生成器」的透明委托：外层自动转发内层的产出（还能转发 send/throw）。它也是 Python 3.3~3.9 时代协程的底层通道（`await` 的前身）。

### 4.3 close 与清理

```python
g = countdown(3)
g.close()          # 在当前 yield 处抛 GeneratorExit —— 生成器可在此清理资源
# 生成器被 GC 时也会自动 close：with 块写在生成器里能正确执行
```

## 5. itertools：迭代器的标准库军火库

| 工具                                    | 作用                    | 例子                              |
| --------------------------------------- | ----------------------- | --------------------------------- |
| `count(start, step)`                    | 无限计数                 | `zip(count(1), items)` 自动编号    |
| `cycle(iterable)`                       | 无限循环                 | 轮询调度                           |
| `chain(a, b, c)`                        | 串联多个可迭代           | 多源合并                           |
| `islice(it, stop)`                      | 切片（对迭代器）          | `islice(count(1), 5)` → 1~5        |
| `groupby(it, key)`                      | **相邻**分组             | 需先按 key 排序！                   |
| `product/ combinations/ permutations`   | 笛卡尔积/组合/排列       | 搜索空间枚举                        |
| `accumulate(it, func)`                  | 前缀聚合                 | `accumulate([1,2,3])` → 1,3,6      |
| `pairwise(it)`（3.10）                   | 相邻对                   | `pairwise("abc")` → ab, bc         |

```python
from itertools import groupby, count, islice

# groupby 的两个使用要点：先排序（分组只对相邻生效）+ 迭代器组也是一次性的
data = sorted(people, key=lambda p: p.city)
for city, group in groupby(data, key=lambda p: p.city):
    print(city, [p.name for p in group])

# 无限流的安全采样：islice 是消费无限迭代器的刹车
first_100_primes = list(islice(prime_gen(), 100))
```

itertools 的所有函数都是 C 实现的惰性迭代器——「流式思维」的标准零件库。

## 6. 自定义迭代器的两条路线

| 路线           | 适用                                   | 成本               |
| -------------- | -------------------------------------- | ------------------ |
| 生成器函数      | 绝大多数：转换、过滤、无限流            | 极低（yield 即协议） |
| 迭代器类        | 需要类状态/被外部反复驱动/协议完整公开   | 高（全协议手写）    |

还有一条「兼容路线」：只实现 `__getitem__`（老式序列协议）的对象也能被 for 遍历（从 0 开始下标直到 IndexError）——读老代码时可能遇到。

```python
# 实用模板：把任何「拉取逻辑」包成生成器（重试、分页）
def fetch_all_pages(fetch_page):
    page = 1
    while True:
        items = fetch_page(page)
        if not items:
            return
        yield from items
        page += 1

for item in fetch_all_pages(lambda p: api.list(page=p)):
    process(item)          # 分页细节被生成器吸收 —— 调用方只见「一条流」
```

## 7. 陷阱清单

- 生成器/zip/文件对象重复遍历：已耗尽返回空；需要多次遍历先 list()。
- 生成器函数调用不执行：body 里没有 print 输出是正常的（未 next）。
- groupby 不排序：分组按「相邻」；先 sorted。
- 惰性求值撞上外部状态变化：生成器执行时变量已变（与闭包惰性绑定同族）；及时物化。
- 大文件 `f.read()`：内存爆炸；逐行 for 或 read(chunk)。
- 生成器里吞异常：throw 进来时清理不干净；try/finally 包 yield。
- `sum(gen)` 之后再用 gen：为空；算两遍要重建。
- 无限迭代器（count/cycle）直接 list：死循环爆内存；必须 islice/zip 截断。
- yield from 的返回值语义：return 值在 StopIteration.value——读老协程代码的前提。

## 8. 小结

- 协议分工：iterable 可反复（`__iter__` 给新迭代器）、iterator 有位置会耗尽（`__next__` + StopIteration）；for/zip/map 的消费行为全由此推出。
- 生成器 = yield 状态机：函数语法实现迭代协议、惰性执行（首次 next 才动）、冻结恢复现场。
- 惰性流水线的价值是 O(1) 内存处理流式数据（大文件、无限流、分页 API），组合即管道；代价是「一次性」与「延迟执行」——可重复遍历的数据老实用 list。
- send/yield from 是生成器的双向通信与委托，协程的历史地基；close 提供清理钩子。
- itertools 是流式处理的标准零件库：groupby 先排序、无限流必须刹车（islice/zip）。
- 路线选择：默认生成器函数；需要类级状态与完整协议控制才手写迭代器类。

## 9. 练习

**1.** 解释下面输出为什么是 `[0, 2, 4]` 与 `[0, 2, 4, 6, 8]`，并给出「两段都要消费」的正确写法。

```python
g = (x * 2 for x in range(5))
print(list(g))          # A
print(list(g[:3]))      # ❌ 生成器不可下标 —— 修正后正确输出什么？
h = (x * 2 for x in range(5))
print(list(h), list(islice(h, 3)))
```

> [!TIP]
> 思路生成器无 `__getitem__`，`g[:3]` 抛 TypeError。正确：先 `data = list(g)` 再切片。最后一行验证「迭代器一旦消费不可回退」：h 先 list 全消费（0~8），islice 只能拿到空。一次性是迭代器的本质，不是 bug。

**2.** 用生成器实现 `read_csv_rows(path)`：逐行读、按逗号切、跳过注释与空行、产出 dict 行（首行为表头）。与「先全量读入列表」版本对比处理 1 GB 文件的内存表现。

> [!TIP]
> 思路生成器版 O(1) 内存（一行一批）；全量版内存 = 文件大小 × 2~3（str 对象开销，[第 1 篇](01-python-model.md)）。注意 with 放生成器**内**（文件生命周期跟随生成器），不要在生成器外打开后传进去——那是「资源生命周期」的常见错位。

**3.** 实现 Fibonacci 无限生成器，分别用 `islice` 取前 10 个、`takewhile(lambda x: x < 100, fib())` 取小于 100 的、`zip(range(10), fib())` 编号消费——总结「消费无限流的三种刹车」。

> [!TIP]
> 思路islice（按个数）、takewhile（按条件）、zip(有限, 无限)（配对有限方）。三者的共同点：刹车器本身是惰性的，链条上任何一环都不能是 eager 的 list()。

**4.** 用 groupby 实现「数据分桶」：把传感器读数按分钟分桶（不排序会怎样？），对比 defaultdict 分桶方案——groupby 与 defaultdict 各自适合什么数据形态？

> [!TIP]
> 思路groupby 需要先按 key 排序（O(n log n)），适合「数据已按 key 有序（日志流）」——此时 O(n) 且可流式；defaultdict 无序数据直接 O(n) 但要求全量内存。数据的时间顺序特性决定工具。

**5.** 写一个「分页拉取」生成器 `fetch_all(fetch, start_page=1)`：每页调 fetch(page)，产出条目，遇到空页停止，页与页之间 sleep。再用它跑一个 mock API，验证「调用方代码完全不知道分页的存在」。

> [!TIP]
> 思路yield from items + 页间逻辑全部封装。这个模式是生成器「吸收协议复杂性」的典型——分页、重试、限速、游标都被藏进迭代协议之下，调用方拿到的永远是「一条干净的流」。

**6.** 解释 `value = yield x` 中 value 何时有值：写出「用 send 驱动」与「用 for 驱动」两种调用方式下 value 的取值，说明为什么 for 驱动时 value 恒为 None。

> [!TIP]
> 思路send(v) 让 yield 表达式的值为 v；next()/for 驱动等价于 send(None)。所以「双向生成器」必须先 next() 预热（首个 yield 没有可接收的值）再用 send。这也是协程「必须先 priming」的历史原因，理解它就能读懂 3.8 前 asyncio 的很多怪异约定。
