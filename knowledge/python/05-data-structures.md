---
title: 内置数据结构
order: 5
tags: 基础, list, dict
summary: list/tuple/dict/set 四件套与推导式，切片语法的一次讲透。
---

日常 Python 编程 90% 的数据组织靠四个内置类型：list（有序可变）、tuple（有序不可变）、dict（键值映射）、set（去重集合）。它们全是引用的容器，操作手法相似又各有脾气，切片语法更是 Python 的招牌。

## list：有序可变序列

```python
nums = [3, 1, 2]
nums.append(4)          # 尾部追加
nums.extend([5, 6])     # 拼接另一个可迭代对象（append([5,6]) 会把整个列表塞进去）
nums.insert(0, 0)       # 指定位置插入，O(n) 操作
nums.remove(2)          # 按值删除第一个匹配项
last = nums.pop()       # 弹出并返回末尾元素
print(nums, last)
```

排序是新手高频踩坑点：`sorted()` 返回新列表，`list.sort()` 原地修改并返回 `None`：

```python
nums = [3, 1, 2]
print(sorted(nums))     # [1, 2, 3]，nums 不变
nums.sort(reverse=True) # 原地排序，nums 变成 [3, 2, 1]
# nums = nums.sort()    # ❌ 得到 None，sort 返回值不能用
```

## tuple：不可变序列

```python
point = (3, 4)
single = (42,)          # 单元素元组必须带逗号，(42) 只是 int
x, y = point            # 解包
a, b = b, a             # 交换两个变量，本质是元组打包再解包
first, *rest = [1, 2, 3, 4]   # first=1, rest=[2, 3, 4]
```

元组不可变，适合表达「固定结构」：坐标、数据库行、函数多返回值。dict 的键必须是可哈希的，所以元组能当键，列表不能。

## dict：键值映射

```python
user = {"name": "Ada", "age": 36}
user["name"]                 # 取值，键不存在抛 KeyError
user.get("email")            # None，不抛异常
user.get("email", "-")       # 带默认值
user["email"] = "a@x.com"    # 新增或覆盖
del user["age"]
merged = user | {"age": 37}  # 3.9+ 合并运算符，右侧优先
```

遍历用 `items()`，三个视图配套：

```python
for key, value in user.items():
    print(key, value)
# 单独用 user.keys() / user.values()，且都是动态视图
```

两个必须记住的特性：

- **字典保序**：3.7 起插入顺序是语言保证，遍历顺序可预期
- **键必须可哈希**：str、int、tuple 都行，list 不行

> [!TIP]
> `user.get("email", "-")` 只在**读**时给默认值；想「没有就建」用 `setdefault`，或者更顺手的 `collections.defaultdict`（见[常用标准库](12-standard-library.md)）。

## set：去重与集合运算

```python
tags = {"python", "rust", "python"}    # 自动去重，{"python", "rust"}
empty = set()                          # 空集合必须写 set()，{} 是空字典

a, b = {1, 2, 3}, {3, 4, 5}
a | b    # 并集 {1, 2, 3, 4, 5}
a & b    # 交集 {3}
a - b    # 差集 {1, 2}
a ^ b    # 对称差 {1, 2, 4, 5}
```

集合成员测试 `x in s` 是 O(1)，列表是 O(n)——大数据量查存在性，永远用 set 或 dict。

## 切片：一次讲透

切片适用于 list、tuple、str 等所有序列，语法 `seq[start:stop:step]`，**含头不含尾**：

```python
s = "abcdefgh"
s[2]      # 'c'，下标从 0 开始
s[-1]     # 'h'，负下标从尾部数
s[2:5]    # 'cde'，含 2 不含 5
s[:3]     # 'abc'，省略 start 从头开始
s[5:]     # 'fgh'，省略 stop 到结尾
s[::2]    # 'aceg'，步长 2
s[::-1]   # 'hgfedcb'，步长 -1 即整个反转
```

切片比下标宽容：下标越界抛 IndexError，切片越界自动截断：

```python
lst = [1, 2, 3]
# lst[10]        # ❌ IndexError
lst[1:100]       # ✅ [2, 3]，静默截断
```

切片是浅拷贝，`lst[:]` 是复制整个列表的惯用写法——但只复制外层引用：

```python
a = [[1, 2], [3, 4]]
b = a[:]              # 浅拷贝
b[0].append(99)
print(a)              # [[1, 2, 99], [3, 4]]，内层是同一个对象
```

> [!WARNING]
> 嵌套结构要完整复制请用 `copy.deepcopy(a)`。浅拷贝只复制一层引用，这条规则同样适用于 `list.copy()`、`dict.copy()` 和 `a[:]`。

## 推导式：声明式造容器

推导式是 Python 的招牌语法，一行完成「遍历 + 过滤 + 变换」：

```python
squares = [x * x for x in range(10) if x % 2 == 0]   # [0, 4, 16, 36, 64]
lengths = {w: len(w) for w in ["ada", "bob"]}        # {'ada': 3, 'bob': 3}
uniq = {c.lower() for c in "Hello World"}            # 字母集合，自动去重
total = sum(x * x for x in range(10 ** 6))           # 生成器表达式，不建中间列表
```

最后一种是生成器表达式（圆括号），惰性产出，适合喂给 `sum`、`max`、`any` 这类聚合函数，详见[迭代器与生成器](11-iterators-generators.md)。

推导式嵌套两层是可读性极限，再多就老老实实写 for 循环。

## 练习

- [ ] 用一行推导式把 `["a.txt", "b.md", "c.txt"]` 里所有 `.txt` 文件名转大写
- [ ] 验证 `lst[:]` 是浅拷贝：嵌套列表改内层，两边同时变化
- [ ] 用 dict 推导式统计字符串里每个字符的出现次数（先试试，再对比 `Counter`）

相关阅读：[迭代器与生成器](11-iterators-generators.md)
