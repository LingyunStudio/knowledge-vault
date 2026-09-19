---
title: 数据类型与可变性：值的真相
order: 2
tags: 可变性, 哈希, 拷贝, 字符串, 假值
summary: int 任意精度与地板除的符号规则、str 的 Unicode 码点模型与拼接性能、假值表与 __bool__ 协议、可变/不可变的哈希学、浅拷贝与深拷贝的别名陷阱，以及「每行代码先问可变还是不可变」的习惯。
---

Python 没有声明类型，但每个对象都有实打实的类型，而且**可变性**这个属性决定了对象在共享场景下的全部行为。上一章建立了「名字绑定对象」的模型；本篇按数值、字符串、None、可变性、拷贝五条线，把常用类型的真实机制讲清——重点是那些「行为反直觉、bug 高频」的精确规则。

## 1. 数值类型：int 的任意精度与除法的符号陷阱

### 1.1 int：没有溢出的整数

```python
2 ** 100                       # 1267650600228229401496703205376 —— 31 位数，随手可得
import math
math.factorial(100)            # 158 位整数：int 是任意精度（内部是数字数组）

0x1F, 0o17, 0b1010             # 十六/八/二进制字面量
1_000_000                      # 下划线分隔：可读性
```

Python 的 `int` 没有位宽上限（内部按需扩展），溢出问题不存在——但**精度换速度**：大整数运算是真计算而不是单条 CPU 指令。哈希、加密、大数计算因此很顺手；性能敏感的大数组计算照旧下沉 NumPy（那是定宽 int64 的世界，两边转换时有精度/范围契约要过脑子）。

### 1.2 除法的两套语义与 % 的符号规则

```python
7 / 2          # 3.5  —— 真除法：int/int 永远得 float（Python 3 与 2 的重大差异）
7 // 2         # 3    —— 地板除：向负无穷取整
7 % 2          # 1    —— 取模

-7 // 2        # -4   ⚠️ 不是 -3！地板除向下（负无穷方向）取整
-7 % 2         # 1    ⚠️ 结果符号跟随除数，不是被除数
-7 % -2        # -1
```

「`%` 的符号跟随除数」与 C 的「跟随被除数」（[C 篇第 2 篇](../c/02-types.md)）相反——这个设计让 `%` 在循环与分桶时表现一致（`x % 60` 对负数也落在 0~59），但「从 C/Java 转来的直觉」必须重装。`divmod(x, y)` 一次拿商和余，两者永远满足 `x == y * 商 + 余`。

### 1.3 float 与十进制的正确工具

float 就是 IEEE 754 双精度（[C 篇第 2 篇](../c/02-types.md)的全部结论原样适用：`0.1 + 0.2 != 0.3`、不用 == 比钱）。Python 的特殊之处是**标准库直接提供替代品**：

```python
# 金额：Decimal（十进制，无二进制表示误差）
from decimal import Decimal
Decimal("0.1") + Decimal("0.2") == Decimal("0.3")    # True —— 注意必须传字符串！
Decimal(0.1)    # 0.1000000000000000055511151231257827... —— 从 float 构造已经带着误差

# 精确分数：Fraction
from fractions import Fraction
Fraction(1, 3) * 3 == 1          # True

# math.isclose：浮点比较的标准姿势
import math
math.isclose(0.1 + 0.2, 0.3)     # True
```

规约：**金额 Decimal（字符串构造）、比例 Fraction、物理量 float + isclose**。

## 2. 字符串：不可变的码点序列

### 2.1 Unicode 模型：str 数的是码点

```python
s = "你好"
len(s)                # 2 —— str 是「码点序列」，数的是字符不是字节
s.encode("utf-8")     # b'\xe4\xbd\xa0\xe5\xa5\xbd' —— 6 字节：编码后才谈字节

b = "你好".encode("utf-8")
b.decode("utf-8")     # '你好' —— bytes ↔ str 的边界永远显式
len(b)                # 6 —— bytes 数的是字节
```

| 类型    | 内容           | 典型场景                       |
| ------- | -------------- | ------------------------------ |
| `str`   | Unicode 码点    | 程序内一切文本                  |
| `bytes` | 原始字节        | 文件/网络 IO、二进制协议、编码后 |
| `bytearray` | 可变字节     | 需要原地修改的二进制缓冲        |

铁律只有一条：**str 与 bytes 之间永远显式 encode/decode，默认 utf-8**。「UnicodeDecodeError」类事故几乎都来自隐式编码假设——读写文件时显式 `encoding="utf-8"`（[第 10 篇](10-files-context.md)）。

### 2.2 构造与格式化：f-string 是终点

```python
name, score = "alice", 91.456

f"{name}: {score:.1f}"          # 'alice: 91.5' —— 表达式 + 格式说明符
f"{score=}"                     # "score=91.456" —— 调试神器：名字=值
f"{1234567:,}"                  # '1,234,567'
f"{0.25:.0%}"                   # '25%'

# 旧写法对比（读老代码要认识，新代码不写）：
"%s: %.1f" % (name, score)      # printf 风格
"{}: {:.1f}".format(name, score) # format 方法
```

### 2.3 拼接性能：join 的真相

```python
parts = ["a", "b", "c"]
"".join(parts)        # ✅ 一次分配，O(总长)

s = ""
for p in parts:
    s += p            # ⚠️ 理论 O(n²)：每次 += 造新字符串（不可变！）
```

字符串不可变，`+=` 理论上每次都全量拷贝。CPython 有一个**实现层优化**：当引用计数为 1 时原地扩展——但这个优化依赖「没有别的名字共享它」，换个写法（比如循环里 `s = prefix + s`）就失效。**不要依赖实现细节**：多次拼接一律 join，单次拼接随意。

常用方法速记（全部返回新对象，不改原串）：

```python
"  hi  ".strip()                       # 两端空白
"a,b,c".split(",")                     # 切分；"".splitlines()
"-".join(["a", "b"])                   # 拼接
"hello".replace("l", "L")
"abc".startswith("a")                  # endswith
"ab1".isdigit()                        # isalpha/isspace/...（注意：isdigit 对 ² 也 True，严格判断用 isdecimal）
"Hello".lower()                        # upper/title/casefold（casefold 更适合比较）
"hello world".count("l") / .find("o")  # find 找不到返回 -1；index 抛异常
```

## 3. None、假值与 bool 协议

### 3.1 None 的正确用法

```python
x = None
if x is None: ...          # ✅ 单例比较用 is（None 是全局唯一对象）
if not x: ...              # ❌ 语义完全不同：会同时吞掉 0、""、[]、False！
```

「`is None`」不是风格洁癖：`if not x` 把「没有值」与「值为假」混为一谈——`count=0`、`name=""`、`items=[]` 都会被误判为「没值」。**「有没有」用 `is None`，「是真是假」才用真值判断**。

### 3.2 假值表与 __bool__ 协议

所有「假」的对象：

```python
False, None, 0, 0.0, 0j, "", [], {}, set(), (), range(0), b""
# 以及自定义对象：__bool__ 返回 False 或 __len__ 返回 0 的
# 其余一切为真（包括 -1、" "、"False"）
```

自定义类实现 `__bool__` 或 `__len__` 即可参与真值判断——这是 Python 协议式设计的第一课：**内置语法（if/for/len/in）背后是约定的方法**（协议），实现协议即可接入语言（[第 7 篇](07-classes.md)系统展开）。

```python
class Stack:
    def __init__(self): self._items = []
    def push(self, x): self._items.append(x)
    def __len__(self): return len(self._items)     # 有了它：if stack: / len(stack) / not stack 全部可用
```

## 4. 可变性的深水区：哈希、别名与默认参数

### 4.1 可哈希性：dict/set key 的入场券

「可哈希」的实用定义：**不可变**（int、str、tuple、frozenset）且内容不变则哈希不变。dict/set 的 key 必须可哈希——理由与[ds 篇哈希表](../ds/06-hash-table.md)完全一致：key 变了就找不到了。

```python
{[1, 2]: "x"}        # TypeError: unhashable type: 'list'
{(1, 2): "ok"}       # ✅ tuple 可哈希
{(1, [2]): "x"}      # TypeError：tuple 含可变元素 → 整体不可哈希
```

「tuple 含可变元素就不可哈希」是常见误区点：**可哈希性看的是内容而非类型标签**——`(1, [2])` 的哈希会随内部 list 变化，所以 Python 直接禁止它做 key。

### 4.2 默认参数陷阱：绑定模型最著名的案例

```python
def add_item(item, items=[]):        # ❌ 默认值在**函数定义时**求值一次！
    items.append(item)
    return items

add_item(1)       # [1]
add_item(2)       # [1, 2]  ⚠️ 共享同一个默认列表——所有调用共享一个对象

# 正确模式：哨兵 None + 函数体内创建
def add_item(item, items=None):
    if items is None:
        items = []
    items.append(item)
    return items
```

机制在[第 1 篇](01-python-model.md)已备齐：默认值是**定义时**求值并绑定到函数对象的一个固定对象，不是每次调用重算。规则：**可变默认值永远不写**，用 `None` 哨兵。

### 4.3 别名问题实战：共享可变状态的三个现场

```python
# 现场①：二维「矩阵」的初始化
grid = [[0] * 3] * 3          # ❌ 三行是**同一个**列表的三个引用！
grid[0][0] = 1                # grid[1][0]、grid[2][0] 全变成 1
grid = [[0] * 3 for _ in range(3)]   # ✅ 每行独立

# 现场②：函数返回共享内部状态
def get_config():
    return self._items        # 调用方拿到的是内部对象的引用，改它 = 改内部
                              # 防御：返回 copy 或只读视图（tuple/frozendict）

# 现场③：循环变量与容器的别名
rows = [{}] * 10              # ❌ 十个引用同一个 dict
rows = [{} for _ in range(10)]  # ✅
```

## 5. 拷贝语义：浅拷贝、深拷贝与选择

```python
import copy

a = [[1, 2], [3, 4]]
b = a                       # 不是拷贝：同一对象
c = a.copy()                # 浅拷贝（或 list(a)、a[:]）：新外层，内层仍是共享引用
d = copy.deepcopy(a)        # 深拷贝：递归复制全部层级

a[0].append(99)
print(c)                    # [[1, 2, 99], [3, 4]] —— 浅拷贝的内层被波及
print(d)                    # [[1, 2], [3, 4]] —— 深拷贝完全独立
```

| 层级     | 手段                           | 内层共享？   | 适用                       |
| -------- | ------------------------------ | ------------ | -------------------------- |
| 绑定     | `b = a`                        | 全共享       | 就是要别名                  |
| 浅拷贝   | `a.copy()` / `list(a)` / `a[:]` | 内层共享     | 一维不可变元素（数字/字符串）|
| 深拷贝   | `copy.deepcopy(a)`             | 完全独立     | 嵌套结构、真正隔离           |

决策口诀：**元素全是不可变 → 浅拷贝等于深拷贝，用浅的（便宜）；有嵌套可变 → 问自己要不要隔离，要就 deepcopy**。deepcopy 有成本（递归 + 记忆已拷贝对象防环），热路径上别滥用——先想清楚共享是不是本来就是设计意图。

## 6. 类型检查与鸭子类型

```python
isinstance(x, int)                 # 标准检查：认子类
isinstance(x, (int, float))        # 多类型
type(x) is int                     # 精确匹配（罕见需求：排除子类时）
```

Python 的哲学是**鸭子类型**：「走起来像鸭子叫起来像鸭子，那它就是鸭子」——关心对象**能不能做这件事**（有这个方法/协议），而不是它的血统。所以接口层的正确姿势是「调用并容忍」或按协议检查（`isinstance(x, collections.abc.Sequence)`），而不是 `type(x) == list` 排除一切等价物。[第 12 篇](12-quality.md)的静态类型注解是鸭子类型之上的「渐进式约束」——两者是互补而非对立。

## 7. 陷阱清单

- `if not x` 判「没值」：吞掉 0/""/[]；「没有」用 `is None`。
- `-7 // 2 == -4`、`-7 % 2 == 1`：地板除与「符号随除数」的模——与 C 直觉相反。
- `Decimal(0.1)`：从 float 构造已带误差；金额 Decimal 必须字符串构造。
- `[[0]*3]*3`：乘法复制引用不复制内容；嵌套结构用推导式逐层构造。
- 可变默认参数：定义时求值一次、全调用共享；None 哨兵模式。
- `"".join` vs 循环 `+=`：多次拼接必须 join。
- 浅拷贝的嵌套共享：`a.copy()` 只拷外层；嵌套可变要 deepcopy。
- tuple 含 list 就不可哈希：可哈希性看内容可变性。
- `s.isdigit()` 对特殊数字字符返回 True：严格数字用 `isdecimal()` 或正则。
- str/bytes 隐混：接口边界显式 encode/decode，默认 utf-8。
- `type(x) == list`：挡死子类与等价容器；isinstance + 协议。

## 8. 小结

- int 任意精度无溢出；`/` 永远真除、`//` 地板除、`%` 符号随除数——负数运算先算一遍再写代码。
- str 是不可变码点序列（len 数码点），bytes 是字节序列，边界显式编码；多次拼接用 join。
- 「有没有」用 `is None`，真值判断遵循假值表；自定义类实现 `__bool__`/`__len__` 接入真值协议。
- 可哈希 = 不可变，dict/set key 的入场券看内容不看标签；可变默认参数是绑定模型的最著名陷阱，None 哨兵是标准解。
- 拷贝三级：绑定（别名）、浅拷贝（外层新内层共享）、深拷贝（完全独立）；元素全不可变时浅拷贝即可。
- 鸭子类型关心能力不关心血统：isinstance + 协议是标准检查姿势。

## 9. 练习

**1.** 不运行代码，写出以下表达式的值，然后验证：`-9 // 4`、`-9 % 4`、`9 // -4`、`9 % -4`、`divmod(-9, 4)`，并用 `x == y * (x//y) + x%y` 检验一致性。

> [!TIP]
> 思路−9//4 = −3（地板：−2.25 向负无穷取整 −3）、−9%4 = 3（余数符号随 4）；9//−4 = −3、9%−4 = −3。恒等式永远成立——「商向负无穷取整 + 余数符号随除数」是同一枚硬币的两面。

**2.** 写一个 `safe_div(a, b)`，分别处理：除零（返回 None 还是抛异常？论证）、float 溢出（inf）、结果是否应保留 Fraction 语义。给出你的设计决策与理由。

> [!TIP]
> 思路除零是「真错误」应抛 ZeroDivisionError（调用方大多无法有意义地继续）；inf 是 float 的正常值（[C 篇第 2 篇](../c/02-types.md)：浮点除零是 inf 不是错误）。设计讨论：参数可能是 Fraction 时统一升宽还是保持原类型——「精度策略」是这类函数真正的接口设计点。

**3.** 实现词频统计 `count_words(text)`，处理大小写归一、标点剥离、空白切分；用纯 str 方法链与 `collections.Counter` 各写一版，对比可读性。

> [!TIP]
> 思路`Counter(re.findall(r"[a-z']+", text.lower()))` 一行；纯 str 版 `text.lower().translate(str.maketrans("", "", punctuation)).split()`。考点：链式不可变操作「每步新对象」的心智负担 vs 正则一步到位。

**4.** 构造「浅拷贝不够用」的最小案例：函数接收矩阵并就地修改副本，验证共享内层 bug；给出三种隔离方案（推导式、deepcopy、不可变化）并比较成本。

> [!TIP]
> 思路`rows = [[1,2],[3,4]]; rows.copy()` 后修改内层仍波及原矩阵。方案①`[row[:] for row in rows]`（浅两层）；②deepcopy（任意深、慢）；③返回新矩阵不改原（函数式、最安全）。热路径且矩阵大时 ① 明显快于 ②。

**5.** 解释为什么 `bool` 是 `int` 的子类（`True + True == 2`），这个设计带来了什么便利与陷阱（如 dict 里 True/1 的键冲突）。

> [!TIP]
> 思路历史设计（Python 3 才有独立 bool 类型但仍继承 int）：数值上下文直接可用（sum(bool_list) 数 True 个数）。陷阱：`{True: "a", 1: "b"}` 是一个键（True == 1 且同哈希）；`isinstance(True, int)` 为 True 会让「只想要 int」的检查误收 bool。

**6.** 设计一个 `Config` 类：内部 dict 存储，要求「外部拿到的视图不可修改内部」。给出三种方案（返回 deepcopy、MappingProxyType、冻结 dataclass），比较防御强度与易用性。

> [!TIP]
> 思路deepcopy：完全隔离但每次拷贝昂贵；`types.MappingProxyType(self._data)`：只读视图、零拷贝（但内层可变对象仍可变）；frozen dataclass：类型级不可变 + 结构清晰。嵌套配置的正确组合通常是 proxy + 值全部不可变化。
