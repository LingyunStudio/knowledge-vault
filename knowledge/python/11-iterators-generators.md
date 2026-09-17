---
title: 迭代器与生成器
order: 11
tags: 进阶, yield, itertools
summary: 迭代协议、yield 与惰性求值、生成器表达式，以及 itertools 精选工具。
---

for 循环之所以能遍历列表、字符串、文件，是因为背后有一套统一的迭代协议。生成器是这套协议的「低成本入场券」——用函数语法写出惰性序列，处理大数据流不爆内存。itertools 则是现成的迭代工具箱。

## 迭代协议

两个角色要分清：

- **可迭代对象**（iterable）：实现了 `__iter__`，能被 for 遍历——list、str、dict、文件都是
- **迭代器**（iterator）：在可迭代之上还实现了 `__next__`，是「游标」，一次性耗尽

for 循环本质上是这段协议代码的语法糖：

```python
seq = [1, 2, 3]
it = iter(seq)          # 第一步：向可迭代对象要一个迭代器
while True:
    try:
        x = next(it)    # 第二步：反复调 next 取值
    except StopIteration:
        break           # 取完即止，for 会安静结束
    print(x)
```

由此得出重要推论：**迭代器是一次性的**，取完就空。

```python
it = iter([1, 2, 3])
print(list(it))    # [1, 2, 3]
print(list(it))    # [] —— 已耗尽，不会重来
```

> [!WARNING]
> 文件对象、生成器、以及 `zip`/`enumerate`/`map` 的返回值都是迭代器，只能消费一次。「第一次循环有数据、第二次循环变空」的 bug，十有八九是迭代器被复用了。需要多次遍历就先存成 list。

## 生成器函数：yield

函数体里出现 `yield`，它就不再是普通函数，而是生成器工厂：调用时不执行函数体，返回一个生成器对象；每次 `next()` 执行到下一个 yield 处暂停，交出一个值，状态就地冻结。

```python
def fibonacci(limit):
    a, b = 0, 1
    for _ in range(limit):
        yield a             # 交出一个值，暂停在这里
        a, b = b, a + b     # 下次 next() 从这里继续

for n in fibonacci(8):
    print(n)                # 0 1 1 2 3 5 8 13
```

两个关键特征：**惰性**（不调 next 一行都不执行）和**省内存**（任一时刻只有一个值活着）。处理大文件的典型写法：

```python
def error_lines(path):
    """惰性筛出日志中的错误行，整条流水线占内存 O(1)。"""
    with open(path, encoding="utf-8") as f:
        for line in f:              # 文件本身就是惰性逐行迭代
            if "ERROR" in line:
                yield line.strip()

for line in error_lines("server.log"):
    alert(line)                     # 上游逐行产出，下游逐行消费
```

对比「读进列表再过滤」：文件 10 GB，生成器方案的内存几乎不涨。

## 生成器表达式

把列表推导式的方括号换成圆括号，就得到了惰性版本：

```python
squares = (x * x for x in range(10))   # <generator object>，此刻还没算任何数
total = sum(squares)                   # 聚合时才逐个产出
```

作为函数唯一参数时外层括号可省，这是惯用的聚合写法：

```python
total = sum(x * x for x in range(1_000_000))     # 不建中间列表
has_pass = any(u["score"] > 90 for u in users)
names = ", ".join(u["name"] for u in users)
```

需要多次遍历、下标、len 就老实建 list；只要一遍聚合，生成器表达式永远更省。

## yield from：委托子生成器

```python
def flatten(nested):
    for item in nested:
        if isinstance(item, list):
            yield from item       # 逐个转发子序列/子生成器的值
        else:
            yield item

print(list(flatten([1, [2, [3]], 4])))    # [1, 2, 3, 4]
```

`yield from iterable` 相当于「for v in iterable: yield v」的精简写法，同时打通了双向通信与异常传播（那是协程话题，日常记住转发语义即可）。

## itertools 精选

标准库 itertools 是迭代器界的瑞士军刀，全部惰性、全部与生成器无缝组合。最常用的几个：

```python
from itertools import count, islice, chain, product, pairwise, accumulate, groupby

list(islice(count(10), 3))       # [10, 11, 12]：无限计数器配切片取前几个
list(chain([1, 2], "ab"))        # [1, 2, 'a', 'b']：多个可迭代串成一条
list(product("AB", "12"))        # [('A','1'),('A','2'),('B','1'),('B','2')]：笛卡尔积
list(pairwise([1, 4, 9]))        # [(1, 4), (4, 9)]：相邻配对（3.10+）
list(accumulate([1, 2, 3, 4]))   # [1, 3, 6, 10]：前缀累积
```

`groupby` 按键分组，但有个前提必须刻在脑子里：**先按同一个键排序**，否则分组支离破碎：

```python
words = ["apple", "banana", "avocado", "blueberry"]
data = sorted(words, key=lambda w: w[0])     # 先排序！
for letter, group in groupby(data, key=lambda w: w[0]):
    print(letter, list(group))
# a ['apple', 'avocado']    b ['banana', 'blueberry']
```

> [!NOTE]
> itertools 的函数返回的都是迭代器，串起来就是零拷贝流水线：`sum(len(w) for w in chain(words1, words2))` 不产生任何中间列表——这是它比手写循环更省的根本原因。

## 练习

- [ ] 用生成器写一个无限的素数序列，配合 `islice` 取前 10 个
- [ ] 复现「迭代器耗尽」：同一个生成器循环两次，第二次打印出空列表
- [ ] 用 `chain` 把两个目录下的文件名串成一条流，统计以 `test_` 开头的数量

相关阅读：[常用标准库](12-standard-library.md)
