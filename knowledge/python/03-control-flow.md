---
title: 控制流与表达式：语法背后的协议
order: 3
tags: 推导式, walrus, match, for-else, 短路求值
summary: and/or 短路返回操作数的惯用法、海象运算符的场景边界、for-else 的真实语义、推导式的适用判据与生成器表达式的惰性、3.10 结构模式匹配的能力地图，以及「卫语句消除嵌套」的控制流整形。
---

Python 的控制流语法少得可疑——if、for、while、match，没了。但每个语法背后都藏着协议与惯用法：`and/or` 返回的是**操作数**不是布尔、`for` 有一个 `else`、推导式是一个独立作用域、`match` 能按结构解构。本篇把这些「第二层知识」讲透，重点是**什么时候用哪个**的表达力判断。

## 1. 条件与表达式化

### 1.1 and/or 的返回值：短路求值的隐藏馈送

Python 的 `and`/`or` 不返回布尔——它们**返回决定结果的那个操作数**：

```python
"a" and "b"        # 'b'   —— and：第一个假则返回它，否则返回第二个
"" and "b"         # ''    —— 空串是假值，短路返回它
0 or "default"     # 'default' —— or：第一个真则返回它，否则返回第二个
None or 42         # 42
```

由此诞生两个惯用法：

```python
# 惯用法①：默认值
name = user_input or "anonymous"        # 输入为空时取默认

# 惯用法②：短路守卫（避免属性错误）
if user and user.is_admin:
    grant_access()
```

边界同样要刻准：`x or default` 在 `x` 是**任何假值**时都取默认——`0`、`""`、`[]` 都会被替换。「0 是合法值」的场景（配置项、阈值）必须用 `is None` 检查而不是 `or`：

```python
timeout = config.get("timeout") or 30     # ❌ timeout=0 被吞
timeout = config.get("timeout")
if timeout is None:
    timeout = 30                          # ✅ 只有「没配置」才用默认
```

### 1.2 条件表达式与海象运算符

```python
# 条件表达式（三元）：
status = "adult" if age >= 18 else "minor"

# 海象运算符（:=，3.8）：赋值成为表达式，就地命名
if (n := len(data)) > 100:
    print(f"too big: {n}")               # len 只算一次，且 n 在条件外可用

while (chunk := f.read(8192)):
    process(chunk)                       # 「读到空为止」循环的经典形态

# 不该用的地方：为了 := 而 :=
if (x := compute()) > 0 and (y := x * 2) < 100: ...   # ❌ 可读性崩坏，拆成语句
```

海象的判断标准一句话：**它消除的是「重复计算」或「while 尾部重复」**，不是为了少一行。出现两个以上 `:=` 的条件句就该重构。

### 1.3 卫语句：用早返回整形控制流

```python
# ❌ 嵌套深渊
def process(order):
    if order is not None:
        if order.is_paid:
            if order.has_stock:
                ship(order)
            else:
                raise ValueError("no stock")
        else:
            raise ValueError("unpaid")

# ✅ 卫语句（guard clause）：先处理异常路径，主逻辑保持一级缩进
def process(order):
    if order is None:
        raise ValueError("no order")
    if not order.is_paid:
        raise ValueError("unpaid")
    if not order.has_stock:
        raise ValueError("no stock")
    ship(order)
```

「happy path 不缩进」是可读性红利最大、争议最小的重构——任何超过两层的 if 嵌套都值得用卫语句重写。

## 2. 循环：for 是协议，不是下标

### 2.1 for-in 与三大伴生工具

Python 的 for 永远遍历**可迭代对象**（协议见[第 6 篇](06-iterators-generators.md)），没有 C 式的三段循环。三个伴生函数覆盖了九成需求：

```python
for i, name in enumerate(names, start=1):     # 带下标（从 1 数）
    print(f"{i}. {name}")

for zh, en in zip(chinese, english):          # 平行遍历（短者截止）
    pair(zh, en)

for pair in zip_longest(a, b, fillvalue=0):   # 需要长者补齐时（itertools）
    ...

for i in range(5):            # 计数循环：range(起, 止, 步) 半开区间，与 C 的 [i, n) 一致
    ...

for x in reversed(sorted(data)):              # 组合可迭代工具
    ...
```

反模式：`for i in range(len(names)):` + `names[i]`——**需要下标时用 enumerate，不需要时直接遍历**。手工下标是 C 习惯的残留，既慢（每次下标访问走协议）又丑。

### 2.2 for-else：容易误读的语法

```python
def find_user(users, target):
    for u in users:
        if u.id == target:
            return u
    else:
        raise LookupError(f"{target} not found")   # 循环**没有 break** 时执行
```

`else` 属于 for：**循环正常跑完（没被 break 打断）时执行**——它的用途是「搜索-确认没找到」模式。容易误读成「循环为空时执行」，所以团队里可以不用它（写成标志变量或提取函数），但**读别人的代码必须懂**。等价的无 else 写法：

```python
found = next((u for u in users if u.id == target), None)   # 生成器 + 默认值，更声明式
if found is None:
    raise LookupError(...)
```

### 2.3 迭代中修改容器：一条硬规则

```python
nums = [1, 2, 3, 4]
for n in nums:
    if n % 2 == 0:
        nums.remove(n)        # ❌ 跳元素：remove 后迭代器不知道，下一位被跳过
# 结果 [1, 3]？实际 [1, 3] —— 但 [2, 4, 6] 这类连续偶数就会漏删
```

规则：**遍历时不要修改被遍历的容器**。正确姿势三选一：

```python
nums = [n for n in nums if n % 2]           # ① 构造新列表（首选）
nums[:] = (n for n in nums if n % 2)        # ② 原地替换（保持引用）
for n in [n for n in nums if n % 2 == 0]:   # ③ 遍历副本，修改原列表
    nums.remove(n)
```

## 3. 推导式：数据变换的母语

### 3.1 四种形态与完整语法

```python
# 列表推导：[表达式 for 元素 in 可迭代 if 条件]
squares = [x * x for x in range(10) if x % 2 == 0]

# 字典推导：{键表达式: 值表达式 for ...}
len_map = {word: len(word) for word in words}

# 集合推导：{表达式 for ...}
vowels = {c for c in text if c in "aeiou"}

# 生成器表达式：惰性，不建容器（注意：单独使用时圆括号可省）
total = sum(x * x for x in range(10))            # 传给函数时免括号

# 嵌套与多循环
pairs = [(x, y) for x in range(3) for y in range(x)]   # 后层可用前层变量
matrix_t = [[row[i] for row in matrix] for i in range(3)]   # 转置：先列后行读
```

### 3.2 判断标准：推导式还是循环？

| 用推导式                    | 用循环                          |
| --------------------------- | ------------------------------- |
| 「映射/过滤/收集」一个结果    | 有副作用的操作（写文件、打印、修改）|
| 一眼看懂的表达式             | 需要中间变量、try、多层逻辑      |
| 不需要错误处理               | 每个元素可能失败需要逐个处理     |

判据是**读起来像声明还是像过程**：`[x*x for x in xs if x > 0]` 是声明；两行以上的逻辑塞进推导式是炫技。map/filter 的函数式写法（`map(lambda x: x*2, xs)`）在「已有函数」时与推导式打平，需要 lambda 时推导式几乎总是更清晰——这是 Python 社区的成熟共识。

```python
# 推导式的独立作用域（Python 3）：不泄漏循环变量
x = "outer"
_ = [x for x in range(3)]
print(x)              # 'outer' —— 推导式内的 x 是局部名（Python 2 会泄漏，读老代码注意）
```

## 4. match：结构模式匹配（3.10+）

match 之上最容易被低估的能力是**解构**：它匹配的不是值相等，而是**形状**：

```python
def handle(command):
    match command.split():
        case ["quit"]:                       # 精确序列
            return "bye"
        case ["load", filename]:             # 捕获：第二项绑定为 filename
            return f"loading {filename}"
        case ["move", x, y] if x.isdigit():  # 守卫：额外条件
            return f"move to ({x},{y})"
        case ["--flag", *rest]:              # 星号收集剩余
            return f"flag with {rest}"
        case _:                              # 通配
            return "unknown"

# 映射模式：按字典结构匹配
match config:
    case {"debug": True, **rest}:
        enable_debug(rest)
    case {"debug": False} | {}:              # 或模式
        pass

# 类模式：按类型与属性解构
match point:
    case Point(x=0, y=0): print("origin")
    case Point(x=0, y=y): print(f"on y-axis at {y}")
    case Point(x=x, y=0): print(f"on x-axis at {x}")
    case Point():                         # 任意 Point
        ...
    case _:                               # 非_POINT 类型
        ...
```

选型判断：**「按结构分派 + 解构」用 match；简单值比较 if-elif 更直白**。match 不是 switch——它是给「数据形状不同」的场景（解析器、协议处理、AST）准备的；对「同一个变量比数值」的场景是杀鸡用牛刀。

## 5. 结构化控制的其他惯用法

```python
# 提前返回替代标志变量
def validate(user):
    if not user.name: return "no name"          # 卫语句链
    if not user.email: return "no email"
    return None                                  # ✅ 无 ok/fail 布尔纠缠

# next + 生成器替代「找到第一个」循环
first_even = next((x for x in nums if x % 2 == 0), None)

# any/all 替代存在性循环
if any(u.is_admin for u in users): grant()
if all(item.ready for item in batch): ship()

# 哨兵循环变量消除：for-else 的替代形态见 2.2
```

`any`/`all`/`next` + 生成器表达式这一组，几乎消灭了所有「遍历找东西」的手写循环——它们的共同模式是「谓词 + 序列 → 布尔/首个/全部」。

## 6. 陷阱清单

- `x or default` 吞掉 0/""/[]：「缺省值」语义用 `is None` 检查。
- `if not x` 与 `is None` 混用：两套语义（[第 2 篇](02-data-model.md)假值表）。
- 遍历时修改容器：跳元素；新列表或遍历副本。
- `for i in range(len(xs))` + 下标访问：enumerate 或直接遍历。
- for-else 误读：else 是「没 break」不是「循环为空」。
- 推导式塞复杂逻辑：超过一个条件+一个表达式的推导式改循环。
- 海象滥用：一个条件句两个以上 := 即重构。
- zip 的静默截断：长度不等时短者截止；需要严格等长用 `zip(a, b, strict=True)`（3.10）。
- match 滥用：简单值比较用 if-elif；match 的主场是结构。
- 循环变量在外层复用（for 后仍引用最后一项）：初始化新名或重命名。

## 7. 小结

- and/or 返回操作数：`or` 做默认值、短路做守卫，但「合法假值」场景必须 `is None`。
- for 是迭代协议的消费者：enumerate/zip/range 覆盖下标、平行、计数三种需求；for-else 服务「搜索未果」；遍历中不改容器。
- 推导式是数据变换的母语：一个表达式 + 一个条件的映射/过滤用推导式，有副作用或复杂逻辑用循环；生成器表达式把同样的语法惰性化。
- match 匹配结构不匹配值：序列/映射/类模式 + 捕获 + 守卫，主场是解析器与协议分派。
- 卫语句早返回、any/all/next 替代搜索循环——控制流的整形方向永远是「happy path 不缩进、意图在前」。

## 8. 练习

**1.** 把下面的嵌套 if 重写为卫语句风格，并说明每一步改变了什么可读性。

```python
def grade(score, attendance):
    if score is not None:
        if 0 <= score <= 100:
            if attendance >= 0.8:
                return "pass" if score >= 60 else "fail"
            else:
                return "attendance too low"
        else:
            raise ValueError("score out of range")
    else:
        raise ValueError("no score")
```

> [!TIP]
> 思路三个卫语句提前抛错（参数校验在前），主路径「评分」保持一级缩进。修改前后数一数「理解 pass/fail 逻辑需要的缩进深度」：4 层 → 1 层。这就是卫语句的全部收益。

**2.** 找出下面代码的两个 bug 并修复：配置 timeout=0 时行为错误；循环中删除元素漏删。

```python
def clean(cfg, items):
    timeout = cfg.get("timeout") or 30
    for item in items:
        if item.expired:
            items.remove(item)
    return timeout
```

> [!TIP]
> 思路①`or` 吞掉 0：改 `is None` 检查。②边遍历边 remove 跳元素：`items[:] = [i for i in items if not i.expired]`。两个 bug 恰好是本章两个陷阱的实战形态。

**3.** 用 match 重写一个「HTTP 路由分发」：路径段列表匹配 `/users/<id>/posts`、`/users/<id>`、`/health`，未匹配返回 404；再讨论什么场景下字典路由表更好。

> [!TIP]
> 思路`match path.split("/")`：`case ["users", uid, "posts"]`、`case ["users", uid]`、`case ["health"]`、`case _`。字典路由表适合「静态路径 → 处理函数」；带参数段的动态路径才是 match 的主场——两者组合（先静态表、miss 后 match）是常见架构。

**4.** 实现 `chunked(iterable, n)`：把序列切成 n 大小的块。写推导式版与生成器版，讨论输入是「惰性大文件」时哪个是唯一正确选择。

> [!TIP]
> 思路`[xs[i:i+n] for i in range(0, len(xs), n)]` 需要可下标 + 全量内存；itertools.islice 的生成器版对任意可迭代惰性工作。考点：生成器表达式的「不建容器」特性在流式场景不是优化而是必需。

**5.** `zip(a, b)` 在 a、b 长度不等时静默截断。找出你项目里可能因它丢数据的地方，并用 `strict=True`（3.10）改造，解释「显式失败优于静默正确」在这里的含义。

> [!TIP]
> 思路数据对账、行列平行的场景里截断 = 丢数据但无报错。strict=True 让长度不符立刻 ValueError。原则呼应[第 9 篇](09-errors-exceptions.md)：错误要fail loud——「静默截断」把数据完整性问题推迟到下游更难定位的地方。

**6.** 把 while True + break 的输入读取循环改写成 walrus 形态，讨论两种写法的可读性差异与「什么时候 while True 更合适」。

> [!TIP]
> 思路`while (line := input()): process(line)` vs `while True: line = input(); if not line: break`。walrus 版把「读-判-用」压成一行，意图直读；while True 版在「退出条件复杂（多个 or）」时更清晰。惯用法服务于意图，不是越短越好。
