---
title: 类与面向对象
order: 7
tags: 进阶, class, dataclass
summary: __init__ 与实例方法、继承与 super、@dataclass 与常用魔术方法速览。
---

Python 是彻底的面向对象语言，但它不强迫你一切皆 class：脚本用函数就够，数据集合用 dataclass，真正有状态、有行为的东西才值得写类。这一篇覆盖类定义的主干，剩下的靠按需查文档。

## 类与实例

`__init__` 是初始化方法（不是构造，对象在它之前已创建），`self` 是实例本身，必须显式写成第一个参数：

```python
class Dog:
    species = "犬科"            # 类属性：所有实例共享

    def __init__(self, name, age):
        self.name = name        # 实例属性：每个实例一份
        self.age = age

    def bark(self, times=1):    # 实例方法第一个参数永远是 self
        return "汪" * times

d = Dog("旺财", 3)
print(d.name, d.bark(2))        # 旺财 汪汪
```

类属性放共享常量没问题，放可变对象就是事故现场：

```python
class Bad:
    items = []                  # ❌ 可变类属性，所有实例共享同一个列表

a, b = Bad(), Bad()
a.items.append(1)
print(b.items)                  # [1]，b 无辜中枪
```

正确做法：每个实例独有的数据一律放进 `__init__` 里用 `self.xxx` 赋值。

## 类方法与静态方法

```python
import datetime

class Date:
    def __init__(self, y, m, d):
        self.y, self.m, self.d = y, m, d

    @classmethod
    def today(cls):                  # cls 是类本身，常用作备用构造器
        t = datetime.date.today()
        return cls(t.year, t.month, t.day)

    @staticmethod
    def is_leap(year):               # 既不用 self 也不用 cls 的工具函数
        return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)

d = Date.today()
print(Date.is_leap(2024))            # True
```

判断口诀：碰实例属性用实例方法；要造实例用 classmethod；跟类只是逻辑相关的纯函数用 staticmethod。

## 继承与 super

```python
class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        return "..."

class Cat(Animal):
    def __init__(self, name, indoor):
        super().__init__(name)       # 公共初始化交给父类，别手抄
        self.indoor = indoor

    def speak(self):                 # 覆盖父类方法
        return "喵"

c = Cat("咪", True)
print(c.speak())                     # 喵
print(isinstance(c, Animal))         # True，继承关系成立
```

Python 支持多继承，方法查找顺序由 MRO（`Cat.__mro__` 可查）决定，实际项目里多继承慎用，混入（mixin）模式除外。

> [!TIP]
> Python 崇尚鸭子类型：「走起来像鸭子就叫鸭子」。多数函数参数不该声明成某个具体类，只要有需要的方法就行——`isinstance` 检查留给真正需要分支的边界处。

## @dataclass：数据类的快捷方式

只装数据的类，`@dataclass` 自动生成 `__init__`、`__repr__`、`__eq__`：

```python
from dataclasses import dataclass, field

@dataclass
class Student:
    name: str
    scores: list[int] = field(default_factory=list)   # 可变默认值的正确姿势
    grade: int = 1

s = Student("Ada")
print(s)          # Student(name='Ada', scores=[], grade=1)，repr 免费获得
```

注意 `default_factory=list`——`scores: list[int] = []` 会触发和[函数](04-functions.md)默认参数一模一样的共享大坑，dataclass 会直接拒绝这种写法。

字段不可变的场景加 `frozen=True`：赋值报错，同时对象变得可哈希、能进 set 和 dict 键：

```python
@dataclass(frozen=True)
class Config:
    host: str
    port: int = 8080
```

## 魔术方法：让对象接进语言

双下划线方法定义对象如何参与语言运算，常用就这几个：

```python
class Vector:
    def __init__(self, x, y):
        self.x, self.y = x, y

    def __repr__(self):                       # print / 调试时的显示
        return f"Vector({self.x}, {self.y})"

    def __eq__(self, other):                  # == 的行为
        return (self.x, self.y) == (other.x, other.y)

    def __add__(self, other):                 # + 的行为
        return Vector(self.x + other.x, self.y + other.y)

v1, v2 = Vector(1, 2), Vector(3, 4)
print(v1 + v2)     # Vector(4, 6)
```

> [!TIP]
> `__repr__` 面向调试（无歧义，最好能据此重建对象），`__str__` 面向用户（可读即可）。只写一个时写 `__repr__`——`str(obj)` 找不到 `__str__` 时会自动回退到它。

容器行为靠 `__len__` 和 `__getitem__`：

```python
class Playlist:
    def __init__(self, songs):
        self.songs = songs

    def __len__(self):
        return len(self.songs)

    def __getitem__(self, i):
        return self.songs[i]

p = Playlist(["a", "b"])
print(len(p), p[0])    # 2 a
for s in p:            # 实现 __getitem__ 就顺带获得了可迭代能力
    print(s)
```

`@property` 把方法伪装成属性，访问时不算括号：

```python
class Circle:
    def __init__(self, r):
        self.r = r

    @property
    def area(self):
        return 3.14159 * self.r ** 2

c = Circle(2)
print(c.area)      # 12.56636，而不是 c.area()
```

## 练习

- [ ] 给 `Vector` 加上 `__sub__` 和 `__mul__`（数乘），验证运算符重载的对称体验
- [ ] 用 `@dataclass` 建一个订单模型，包含可变字段 `items`，确认 frozen 模式下赋值会抛异常
- [ ] 解释 `Playlist` 为什么能被 for 遍历，再试试 `p[1:]`（提示：`__getitem__` 接收 slice 对象）

相关阅读：[函数进阶与装饰器](06-functions-advanced.md)
