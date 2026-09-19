---
title: 类与对象协议：魔术方法的系统
order: 7
tags: 类属性, property, MRO, dataclass, 魔术方法
summary: 实例与类属性的查找顺序、classmethod/staticmethod 的分工、property 与 __slots__、以 __repr__/__eq__/__hash__/容器协议为代表的魔术方法系统、super 的真实语义与 C3 线性化、Mixin 模式与 dataclass 的工程用法。
---

Python 的「面向对象」比 Java/C++ 的类更接近**协议系统**：`len(obj)` 不是调用方法，是调用 `obj.__len__()`；`obj + other` 是 `obj.__add__(other)`；`for x in obj` 是 `iter(obj)`。内置语法与运算符都是对**约定方法（魔术方法）**的分发——实现协议即可接入语言。理解这一点，Python 类设计就从「背语法」变成「选协议」。

本篇先讲属性系统（找名字的规则），再讲魔术方法主干，然后是继承与 MRO 的真实机制，最后是 dataclass 这个现代默认答案。

## 1. 属性系统：名字怎么找到值

### 1.1 实例属性与类属性

```python
class Dog:
    species = "犬科"                # 类属性：所有实例共享
    def __init__(self, name):
        self.name = name            # 实例属性：每个对象一份

d1, d2 = Dog("旺财"), Dog("小黑")
d1.species                          # '犬科' —— 实例没有 → 找到类的
d1.species = "猫科"                  # ⚠️ 这不是修改类属性！是给 d1 建了**实例属性**遮住它
Dog.species                         # 仍是 '犬科'
d2.species                          # '犬科' —— d2 不受影响
```

查找顺序：**实例 `__dict__` → 类 `__dict__` → 父类（MRO 链）**。「赋值」永远作用于实例（除非显式 `Dog.species = ...`）。可变类属性是经典事故：

```python
class Bag:
    items = []                      # ❌ 所有实例共享同一个 list
    def add(self, x): self.items.append(x)

a, b = Bag(), Bag()
a.add(1)
b.items                             # [1] —— b 也「有」了
# 正解：items 在 __init__ 里 self.items = []（与默认参数陷阱同根：定义时创建一次）
```

### 1.2 三种方法的分工

```python
class Temperature:
    def __init__(self, celsius): self.c = celsius

    @classmethod
    def from_f(cls, f):                      # cls 是类本身：备用构造器的主场
        return cls((f - 32) * 5 / 9)

    @staticmethod
    def is_valid(c):                         # 与类/实例都无关：纯函数收纳进命名空间
        return c >= -273.15

    def to_f(self):                          # 实例方法：操作实例状态（默认形态）
        return self.c * 9 / 5 + 32

Temperature.from_f(98.6)      # 工厂方法：多种构造方式的标准形态
Temperature.is_valid(-300)    # False
```

判据：**要操作实例状态 → 实例方法；要构造实例/操作类状态 → classmethod；两者都不沾（工具函数）→ staticmethod 或干脆模块级函数**。

### 1.3 property：把方法伪装成属性

```python
class Account:
    def __init__(self, balance=0): self._balance = balance   # 约定：_ 前缀 = 内部

    @property
    def balance(self):                       # 读：acc.balance 像属性
        return self._balance

    @balance.setter
    def balance(self, value):                # 写：acc.balance = x 走这里
        if value < 0:
            raise ValueError("余额不能为负")
        self._balance = value

acc = Account(100)
acc.balance = 50         # 走 setter 校验
acc.balance              # 50
```

property 让类可以**先提供裸属性、后无损升级为受控属性**（调用方代码不变）——这是 Python 没有 getter/setter 仪式的原因：**需要时再包装，且包装无感**。规约：公开属性直接写；一旦需要校验/计算/惰性求值，升级 property。

### 1.4 __slots__：轻量对象的开关

```python
class Point:
    __slots__ = ("x", "y")          # 放弃实例 __dict__，字段定死
    def __init__(self, x, y): self.x, self.y = x, y

import sys
sys.getsizeof(Point(1, 2)) < sys.getsizeof(type("P", (), {})(1, 2))   # 明显更小
# Point(1,2).z = 3        # AttributeError：不能动态加属性
```

百万级小对象场景 `__slots__` 省一半以上内存（没有 `__dict__`），还顺带挡住拼写错误的属性赋值。代价：失去动态性（不能 monkey-patch 实例、与某些框架的反射不兼容）——**默认不用，数据量证明需要时再开**。

## 2. 魔术方法：接入语言的协议

### 2.1 表示与比较

```python
class Vector:
    def __init__(self, x, y): self.x, self.y = x, y

    def __repr__(self):                       # 开发者视角：repr(v)、REPL 显示
        return f"Vector({self.x!r}, {self.y!r})"
    def __str__(self):                        # 用户视角：print(v)、str(v)
        return f"({self.x}, {self.y})"        # 没写 __str__ 时回落 __repr__

    def __eq__(self, other):
        if not isinstance(other, Vector): return NotImplemented   # 不认识就交给对方/回落
        return (self.x, self.y) == (other.x, other.y)
    def __hash__(self):                       # __eq__ 定制后必须配 __hash__（否则变不可哈希）
        return hash((self.x, self.y))
```

三条硬规则：

1. **`__repr__` 为调试服务**（理想输出能 `eval` 回来），`__str__` 为用户服务；只写一个就写 `__repr__`。
2. **定制 `__eq__` 后 `__hash__` 变 None**（Python 显式置空防「相等对象哈希不同」）——需要进 set/dict 就必须补 `__hash__`，且规则与 ds 篇一致：**相等者哈希相等**（通常 `hash(元组 of 参与相等的字段)`）。
3. **`NotImplemented` 不是 NotImplementedError**：返回它表示「我不处理这种比较」，Python 会尝试对方的反向方法——二元运算符协议的正确配合方式。

### 2.2 容器协议：让你的对象支持 len/in/下标/迭代

```python
class Playlist:
    def __init__(self, songs): self._songs = list(songs)

    def __len__(self): return len(self._songs)
    def __getitem__(self, index): return self._songs[index]      # 顺带获得迭代与切片！
    def __contains__(self, song): return song in self._songs

pl = Playlist(["a", "b"])
len(pl); pl[0]; "a" in pl
for s in pl: ...              # 迭代自动可用：for 对没有 __iter__ 的对象回落到 __getitem__
```

「实现协议的一个子集就获得对应语法」——容器协议（`__len__/__getitem__/__setitem__/__contains__/__iter__`）、数值协议（`__add__/__mul__/__neg__`…）、上下文协议（`__enter__/__exit__`，[第 10 篇](10-files-context.md)）。设计新类时问的第一个问题因此变成：**它应该像什么协议的对象？**

### 2.3 __getattr__ 与动态属性

```python
class LazyAPI:
    def __getattr__(self, name):          # 只在「常规查找失败」时调用
        if name.startswith("api_"):
            return self._fetch(name[4:])   # 惰性/代理/动态生成属性
        raise AttributeError(name)

api = LazyAPI()
api.api_user          # 常规查找失败 → __getattr__ 接住
```

`__getattr__`（查找失败兜底）与 `__getattribute__`（**所有**属性访问都过它，慎用、极易无限递归）的分工：前者做惰性与代理，后者几乎只属于元编程框架。ORM 的动态字段、SDK 的动态端点都是 `__getattr__` 的正当用例。

## 3. 继承与 MRO：super 的真实语义

### 3.1 单继承与 super()

```python
class Base:
    def __init__(self, x): self.x = x
    def describe(self): return f"Base({self.x})"

class Child(Base):
    def __init__(self, x, y):
        super().__init__(x)             # 「沿 MRO 调下一个」——不只是父类
        self.y = y
    def describe(self):
        return f"Child({super().describe()})"     # 复用 + 扩展
```

super() 的准确含义是「**沿 MRO 找当前类的下一个**」，不是「父类」——这个差别只在多继承时显形。

### 3.2 多继承与 C3 线性化

```python
class A:
    def hello(self): return "A"
class B(A):
    def hello(self): return "B + " + super().hello()
class C(A):
    def hello(self): return "C + " + super().hello()
class D(B, C):
    pass

D().hello()          # 'B + C + A'  —— 不是 'B + A + C + A'！
D.__mro__            # (D, B, C, A, object) —— C3 线性化
```

C3 规则保证：**子类在前、父类在后、每个类只出现一次、局部顺序保持**。每个类的 super() 都指向 MRO 中的下一个——所以 B 的 super 走到 C 而不是 A。这就是**协作式多继承**：每个 Mixin 都写 `super().method()` 并信任链条，整个体系像接力赛。

```python
# Mixin 模式：能力的小块组合，不承载构造状态
class JSONMixin:
    def to_json(self):
        return json.dumps(self.__dict__)

class LogMixin:
    def log(self, msg): print(f"[{type(self).__name__}] {msg}")

class User(JSONMixin, LogMixin):        # 组合能力
    def __init__(self, name): self.name = name

User("alice").to_json()
```

Mixin 设计纪律：每个 Mixin 单一职责、不定义 `__init__`（或协作调用）、抽象方法用 `NotImplemented` 或 ABC 声明。

## 4. dataclass：现代类的默认答案

```python
from dataclasses import dataclass, field

@dataclass
class Order:
    id: int
    items: list[str] = field(default_factory=list)     # 可变默认值的安全形态！
    status: str = "pending"
    tags: set = field(default_factory=set, compare=False)   # 参与比较的控制

    def total(self): ...                                # 正常方法照写

Order(1)                          # 自动生成 __init__
Order(1) == Order(1)              # True：自动 __eq__（按字段）
repr(Order(1))                    # "Order(id=1, items=[], status='pending')"：自动 __repr__

@dataclass(frozen=True)
class Config:                     # 不可变 + 可哈希：值对象的形态
    host: str
    port: int
```

dataclass 自动生成 `__init__`、`__repr__`、`__eq__`（可选 `__hash__`），把「纯数据载体」的样板代码清零。三个要点：

1. **可变默认值必须 `field(default_factory=list)`**——它把「默认值」从「定义时一个对象」改成「每次实例化调用工厂」，正是[第 4 篇](04-functions.md) None 哨兵的机制化。
2. `frozen=True` 得到不可变值对象（可哈希、可安全共享）。
3. `slots=True`（3.10+）一行接上 `__slots__`。

选择：**纯数据 → dataclass；少量字段 + 不可变 → frozen dataclass 或 NamedTuple；行为复杂/需要协议控制 → 手写类**。

## 5. 设计规约

1. **先想协议**：这个对象要支持什么语法（len？in？迭代？加法？with？），按需实现协议，不实现不用的。
2. **公开属性 + property 升级**，不用 getter/setter 仪式；内部状态 `_` 前缀。
3. **可变状态一律在 `__init__` 里创建**，类属性只放真常量。
4. **多继承只用于 Mixin**（无状态、协作 super）；继承树两层以内，深了先想组合。
5. **`__eq__` 必配 `__hash__`**（除非刻意要不可哈希）；`__repr__` 是最低成本的调试投资。

## 6. 陷阱清单

- 类属性可变对象被实例「共享修改」：状态在 `__init__` 建。
- `d1.species = x` 以为改了类属性：创建的是实例属性遮蔽。
- 定制 `__eq__` 忘 `__hash__`：对象进 set/dict 直接 TypeError。
- `__repr__` 缺失：调试时打印出 `<object at 0x...>`；dataclass 自动救场。
- 多继承里假设 super 是「父类」：它沿 MRO 走下一个；Mixin 链要协作设计。
- Mixin 定义 `__init__` 不调 super：链条断，兄弟 Mixin 初始化丢失。
- `__getattribute__` 里递归读属性：无限递归；用 `object.__getattribute__` 或改用 `__getattr__`。
- 可变默认参数进 dataclass：field(default_factory=)。
- property setter 里再赋同名属性：无限递归；操作 `_` 前缀的真存储。
- 滥用 `__slots__`：与动态属性/框架反射冲突；按需开启。

## 7. 小结

- 属性查找「实例 → 类 → MRO」；赋值永远落实例；可变类属性是共享状态事故；方法三分：实例态用实例方法、构造走 classmethod、纯函数 staticmethod。
- property 提供无损的属性→受控属性升级；`__slots__` 用动态性换内存。
- 魔术方法是把类接入语言协议的插座：repr/str、eq/hash（定制 eq 必配 hash）、容器协议（getitem 顺带送迭代与切片）、`__getattr__` 兜底动态属性。
- super 沿 MRO 找下一个（不是「父类」）；C3 线性化让协作多继承成立；Mixin 是多继承的正当形态（无状态 + 协作 super）。
- dataclass 是数据类的默认答案：自动 init/repr/eq、default_factory 解可变默认、frozen/slots 一行开关。
- 类设计的第一问是「它该实现什么协议」，第二问是「状态放哪、谁能改」。

## 8. 练习

**1.** 给第 5 篇练习的 LRU 缓存包装成类：实现 `__len__`、`__getitem__`/`__setitem__`、`__contains__`，并说明为什么 `__getitem__` 一实现，`for key in cache` 就自动可用。

> [!TIP]
> 思路for 对无 `__iter__` 对象回落 `__getitem__`（从 0 数到 IndexError）——旧式序列协议。但显式实现 `__iter__`（产 keys）更清晰且支持无下标语义的容器。「回落是兼容，不是设计目标」。

**2.** 解释下面输出，修复 bug 并总结「类属性 vs 实例属性」的检查清单。

```python
class Team:
    members = []
    def __init__(self, name): self.name = name

t1, t2 = Team("A"), Team("B")
t1.members.append("alice")
print(t2.members)      # ?
Team.members = ["bob"]
print(t1.members)      # ?
```

> [!TIP]
> 思路第一个打印 `['alice']`（append 是原地改共享 list）；第二个打印 `['bob']`（类属性赋值后，t1 没有实例属性 members，跟随类的新值）。清单：状态进 `__init__`、类属性只放常量、想改「全体共享的默认」时显式改类并知道它影响已存在实例。

**3.** 设计一个 `Money` 类：金额 + 币种，支持 `+`（同币种）、`==`、可哈希、frozen 语义；用 dataclass(frozen) 与手写各实现一遍，对比工作量与控制力。

> [!TIP]
> 思路dataclass(frozen=True, order=True)：`__add__` 仍手写（跨币种抛 ValueError）。手写版要补 `__hash__/__eq__/__repr__` 全套。结论：值对象（value object）是 dataclass+frozen 的教科书场景；运算符语义无论如何都要自己定义。

**4.** 用协作多继承实现「可序列化 + 可验证 + 时间戳」三个 Mixin，组装出一个 Model 类；故意打乱 MRO 观察 `__mro__` 与行为变化，总结「写 Mixin 的三纪律」。

> [!TIP]
> 思路每个 Mixin 的 to_dict/save 方法内 `super().save()` 传递；MRO 用 `cls.__mro__` 检查。三纪律：不定义 `__init__`（或显式 `super().__init__(*a, **kw)`）、单一职责、方法名约定前缀防撞。打乱顺序的实验展示 C3 对「局部顺序保持」的遵守。

**5.** 用 `__getattr__` 实现一个「惰性加载的配置对象」：首次访问任意属性时从文件加载并缓存，之后走实例 `__dict__`。解释为什么第二次访问不再进 `__getattr__`。

> [!TIP]
> 思路首次：实例 `__dict__` 没有 → `__getattr__` 接住 → `self.__dict__[name] = loaded` 缓存；第二次：常规查找命中缓存，`__getattr__` 不再触发（它只在失败时调用）。注意加载失败应抛 AttributeError 而不是静默 None——属性协议对错误语义有期待。

**6.** 讨论：一个「用户会话」类需要计数器（实例级）、配置常量（类级）、可校验的过期时间（受控）。分别用实例属性、类属性、property 实现，并说明哪些场景该让位给 dataclass。

> [!TIP]
> 思路计数器 `__init__` 建；常量类属性（全大写约定）；过期时间 property + setter 校验。当「类只是数据 + 少量派生」时 dataclass 收编样板；出现协议校验与不变量时手写类开始值得。「数据类起步，长出行为时再手写」是健康的演进方向。
