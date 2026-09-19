---
title: 内置数据结构深潜：实现决定行为
order: 5
tags: list, dict, set, tuple, 复杂度, collections
summary: list 的动态数组与摊还分析、Timsort、切片的浅拷贝语义、dict 的紧凑哈希表与保序实现、set 的集合代数、collections 四件套（Counter/defaultdict/deque/namedtuple），以及一张直接指导选型的复杂度对照表。
---

Python 的内置容器不是「都能用随便挑」——每个背后是一种确定的数据结构，行为差异（性能、保序、可哈希、迭代失效）全部由实现决定。本篇按「实现 → 行为 → 选型」讲四个核心容器，再用 collections 的标准扩展收尾。

## 1. list：动态数组的摊还分析

### 1.1 实现：连续指针数组 + 过量分配

```python
import sys
a = []
for i in range(20):
    a.append(i)
    if i in (0, 4, 8, 16):
        print(len(a), sys.getsizeof(a))
# 1 64 → 5 96 → 9 128 → 17 184
# 容量跳跃式增长：list 预留比 size 更多的槽位（over-allocation），
# 使 append 的摊还代价为 O(1)
```

list 底层是**指针的连续数组**（元素对象本身在堆上各处）——这就是为什么 `sys.getsizeof([1_000_000])` 与 `sys.getsizeof([1])` 差别巨大但都不是百万级：数组存的是 8 字节指针。由此推出完整复杂度表：

| 操作                    | 复杂度      | 原因                             |
| ----------------------- | ----------- | -------------------------------- |
| `a[i]` / `a[i] = x`     | O(1)        | 指针数组下标                      |
| `append` / `pop()`（尾）| O(1) 摊还   | 过量分配吸收扩容                  |
| `insert(0, x)` / `pop(0)` | **O(n)**  | 全体元素移动                      |
| `x in a`                | O(n)        | 线性扫描                          |
| `a.remove(x)`           | O(n)        | 找 + 移                           |

「队头操作多」是换 `collections.deque` 的明确信号（O(1) 两端）。

### 1.2 排序：Timsort 的实用特性

```python
data = [(3, "c"), (1, "a"), (2, "b")]
sorted(data)                          # 新列表；data.sort() 原地（返回 None！）
sorted(data, key=lambda t: t[0], reverse=True)    # 按字段排序

# 多级排序：key 返回元组（元组按位置比较）
sorted(people, key=lambda p: (-p.age, p.name))    # 年龄降序 + 同龄按名字升序
```

`sort`/`sorted` 用 **Timsort**：归并排序 + 插入排序混合，对**部分有序数据接近 O(n)**（现实数据大多部分有序），最坏 O(n log n)，**稳定**（相等元素保持原序——多级排序可以「先按次键排、再按主键稳定排」的组合技巧）。

### 1.3 切片：半开区间、浅拷贝、负步长

```python
a = [0, 1, 2, 3, 4, 5]
a[1:4]        # [1, 2, 3]    半开区间 [起, 止)
a[:3], a[3:]  # 头尾切片
a[-2:]        # [4, 5]       负索引：从尾数
a[::2]        # [0, 2, 4]    步长
a[::-1]       # 反转
a[:]          # 完整浅拷贝（惯用法）
a[1:4] = [9]  # 切片赋值：可以改变长度！
del a[1:3]    # 切片删除
```

切片返回**浅拷贝**（新列表、元素引用共享）——嵌套可变结构时与[第 2 篇](02-data-model.md)的浅拷贝规则一致。切片语义「越界不报错」（`a[10:20]` 得 `[]`）是宽容设计，但也会静默吞掉逻辑错误——严格校验用显式 len 判断。

## 2. tuple：不可变记录

```python
point = (3, 4)
single = (1,)          # 单元素元组：逗号才是元组的标志，括号不是
not_a_tuple = (1)      # 这只是 int 1！
x, y = point           # 解包；a, *rest = [1, 2, 3]
first, *mid, last = [1, 2, 3, 4]    # 星号解包：灵活收集

def minmax(xs):
    return min(xs), max(xs)     # 返回多值 = 返回元组

lo, hi = minmax([3, 1, 4])      # 调用侧解包 —— Python 函数「多返回值」的全部机制
```

**tuple 是记录（不同含义的字段），list 是收集（同质元素）**——这个语义分界决定选型：坐标、(键, 值) 对、函数多返回值用 tuple；待增删改的队列用 list。tuple 可哈希（内容不可变时），能当 dict key；tuple 更省内存（定长、无过量分配）。

带名字的 tuple：

```python
from collections import namedtuple
Point = namedtuple("Point", ["x", "y"])
p = Point(3, 4)
p.x, p[0]          # 字段名与下标双通道；仍可哈希、仍是元组

# 现代形态：dataclass（可变、类型化、可加方法）—— 见第 7 篇
```

## 3. dict：紧凑哈希表与保序

### 3.1 实现与保序的来历

CPython 3.7 起（3.6 是实现细节）dict **保证插入顺序**——来自[紧凑布局实现](../ds/06-hash-table.md)（稀疏散引表 + 按插入序的紧凑条目数组）的副产品。这一保证写进了语言规范，所有依赖「键的顺序就是插入顺序」的代码（配置合并、JSON 序列化）因此成立。

复杂度：`d[k]`/`d[k]=v`/`del d[k]`/`k in d` 平均 O(1)（哈希表）；键必须可哈希（[第 2 篇](02-data-model.md)）。

### 3.2 方法全景与合并运算符

```python
d = {"a": 1, "b": 2}

d.get("c", 0)              # 取值带默认（不插入）
d.setdefault("c", []).append(1)    # 不存在才设默认并返回它（分组惯用法）
d.pop("c", None)           # 删除带默认
d.popitem()                # 弹出最后插入的键值对（LIFO，3.7+）

d.update({"b": 9})         # 批量更新
d |= {"e": 5}              # 原地合并（3.9）
merged = d1 | d2           # 新字典合并（3.9）：右侧优先

list(d.keys()), list(d.values()), list(d.items())
for k, v in d.items():     # 遍历的标准形态
    ...

# 字典视图是「动态窗口」：反映字典的实时状态
ks = d.keys()
d["f"] = 6
"f" in ks                  # True —— 视图跟着变
```

### 3.3 get / setdefault / defaultdict 的分工

```python
from collections import defaultdict

# 分组的三种写法：
groups.setdefault(key, []).append(item)      # 普通 dict：一次性写法
groups_dd[key].append(item)                  # defaultdict(list)：访问即创建（最简洁）
if key not in groups: groups[key] = []       # 手工判断（啰嗦）

# defaultdict 的暗面：只读访问也会插入默认值！
dd = defaultdict(list)
_ = dd["ghost"]               # dd 现在多了 "ghost" 键 —— 「查询」改变了容器
```

选择：一次性分组用 setdefault；全程构建用 defaultdict（但注意只读副作用）；计数用 Counter。

## 4. set 与 frozenset：集合代数

```python
a = {1, 2, 3}
b = {2, 3, 4}

a | b        # 并 {1,2,3,4}    a & b   交 {2,3}
a - b        # 差 {1}          a ^ b   对称差 {1,4}

a.add(5); a.discard(99)    # discard 不存在不报错（remove 会）
b <= a                     # 子集判断

# 高频用途：
unique = set(items)                            # 去重（但丢序；保序去重：dict.fromkeys(items)）
seen = set()
if x in seen: ...                              # O(1) 判重
common = set(file1_tags) & set(file2_tags)     # 集合运算表达业务逻辑
```

set 的元素必须可哈希；frozenset 是不可变版（可进另一个 set、可当 key）。set 无序——需要「去重且保序」时用 `list(dict.fromkeys(items))`（dict 保序 + 去重）。

## 5. collections 四件套

| 工具             | 是什么                     | 杀手级场景                       |
| ---------------- | -------------------------- | -------------------------------- |
| `Counter`        | 计数 dict                   | `Counter(words).most_common(3)`  |
| `defaultdict`    | 带工厂的 dict                | 分组、图邻接表、树                |
| `deque`          | 双端队列（双向链表块）        | 队列、滑动窗口（maxlen 参数）     |
| `namedtuple`     | 带字段名的 tuple             | 轻量记录、函数多返回值命名        |

```python
from collections import Counter, deque

Counter("mississippi").most_common(2)     # [('i', 4), ('s', 4)]
Counter(words1) + Counter(words2)         # 计数器支持算术！

window = deque(maxlen=5)                  # 定长滑动窗口：满了自动丢最旧
for price in prices:
    window.append(price)
    avg = sum(window) / len(window)
```

`OrderedDict` 在 3.7 后失去了「唯一保序」地位，剩余价值是 `move_to_end` 与相等性比较考虑顺序——普通需求用 dict。

## 6. 选型对照表

| 需求                          | 答案                  | 理由                             |
| ----------------------------- | --------------------- | -------------------------------- |
| 有序同质收集、频繁尾插         | list                  | 动态数组                          |
| 固定字段记录 / dict key        | tuple / namedtuple     | 不可变可哈希                      |
| 键值映射、快速查找             | dict                  | 哈希表 O(1) + 保序                |
| 去重、成员判断、集合运算        | set                   | 哈希 O(1)                         |
| 两端进出（队列/栈/窗口）        | deque                 | 两端 O(1)；list 头插 O(n)         |
| 计数                          | Counter               | 内置算术与 most_common            |
| 分组聚合                       | defaultdict(list)     | 访问即创建                        |
| 大数值矩阵                     | NumPy（不在本篇）      | 连续内存 + C 循环                 |

## 7. 陷阱清单

- `insert(0, x)` / `pop(0)` 热路径：O(n) 全移；deque。
- `[[0]*n]*m`：乘法复制引用；推导式逐层。
- 切片是浅拷贝：嵌套可变元素共享。
- `d[k]` 当查询：不存在时插入（[第 8 篇](../cpp/08-stl-containers.md)同款陷阱的 Python 版）；查询用 `get`/`in`。
- defaultdict 只读访问也插键：查询路径改普通 dict 或先 `in`。
- 迭代 dict 时增删键：RuntimeError；`list(d.items())` 快照或收集后删。
- set/dict 键用可变对象：unhashable 或「存了找不到」；key 用不可变内容。
- sort 返回 None：原地；要新列表用 sorted。
- Counter 的算术丢非正计数（`+`/`-` 会过滤 ≤0）：需要保留用 update/手动。
- 遍历 list 时 append：循环不终止（增长源）；新列表收集。

## 8. 小结

- list 是指针数组 + 过量分配：尾操作摊还 O(1)、头操作 O(n)（换 deque）、Timsort 稳定且对部分有序接近线性；切片半开、浅拷贝、可赋值。
- tuple 是记录不是收集：单元素靠逗号、解包是「多返回值」的全部机制、namedtuple 加名字。
- dict 是紧凑哈希表，3.7 起保序是语言承诺；get/setdefault/defaultdict 的分工是「取、建、组」三种意图；视图是动态窗口。
- set 提供集合代数与 O(1) 判重；保序去重用 `dict.fromkeys`。
- collections 四件套各司其职：Counter 计数、defaultdict 分组、deque 两端与滑动窗口、namedtuple 轻记录。
- 选型先问操作模式（头尾？键查？去重？计数？），再对照复杂度表——Python 容器的性能差异几乎全部来自数据结构而非解释器。

## 9. 练习

**1.** 用 `timeit` 实测 `list.append`（10⁶ 次）与 `list.insert(0, x)`（10⁵ 次）、`deque.appendleft`（10⁶ 次），解释量级差异与摊还分析在这里的角色。

> [!TIP]
> 思路append 摊还 O(1)（偶尔 O(n) 扩容被摊平）；insert(0) 每次 O(n) 全移，10⁵ 次已是秒级；deque 两端真 O(1)（块链表）。实验直观呈现「摊还 vs 每次」的区别。

**2.** 实现 LRU 缓存（容量 N，get/put O(1)）：先讲思路（dict + 双向链表？），再用 `OrderedDict.move_to_end` 三行实现核心，最后对比 `functools.lru_cache` 的装饰器形态。

> [!TIP]
> 思路OrderedDict 版：get 时 `move_to_end(key)`，淘汰 `popitem(last=False)`；普通 dict + deque 也可（3.7 保序）。这个练习同时复习 dict 保序、popitem 语义与 functools（第 4 篇装饰器）。

**3.** 给定日志列表 `[(time, user, action), ...]`，用推导式与 defaultdict 完成：按 user 分组、统计 action 频次、找出「连续三次登录失败」的用户（滑动思路）。

> [!TIP]
> 思路分组 `defaultdict(list)`；频次 `Counter(action for _,_,a in logs if ...)`；连续失败按时间序窗口扫每个用户的序列。考点：多容器组合（dict 套 list 套 Counter）是真实数据处理的基本形态。

**4.** 解释为什么 `t = (1, [2, 3]); d = {t: "x"}` 抛 TypeError，而 `t[1].append(4)` 却合法——从「可哈希性看内容」推导正确做法（frozenset？tuple 全量不可变？）。

> [!TIP]
> 思路tuple 的哈希在创建时基于内容计算，内部 list 一变哈希就「过期」，所以含可变元素的 tuple 直接禁止做 key。合法的「记录含集合」场景用 frozenset 或全标量 tuple。「不可变类型含可变字段」是 Python 可变性模型最细的一层缝。

**5.** 把一个 JSON 风格的嵌套 dict（含列表与子 dict）实现「深合并」：`merge(a, b)` 中 b 的值覆盖 a，子 dict 递归合并、列表替换。写出实现并讨论循环引用的防御。

> [!TIP]
> 思路递归：`for k, v in b.items(): if isinstance(v, dict) and isinstance(a.get(k), dict): merge(a[k], v) else: a[k] = v`。防御：visited 集合或直接文档声明「不支持环」——配置合并场景环不合法，显式禁止比防御性拷贝简单。

**6.** 你要实现「最近联系人列表」：去重、最近使用的在前、最多保留 20 个。给出实现并说明每一步用了哪个容器的哪个特性。

> [!TIP]
> 思路`contacts.remove(user) if user in contacts` 或 `deque`：`try: d.remove(u) except ValueError: pass; d.appendleft(u); 截断到 20`。或 `OrderedDict.move_to_end(last=False)`。三个方案分别用 list 删除、deque 两端、OrderedDict 重排——同一个需求三种容器语义的组合，选型依据是操作频率（联系人列表小，list 足够）。
