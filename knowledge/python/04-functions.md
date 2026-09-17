---
title: 函数
order: 4
tags: 基础, 函数, 参数
summary: 默认参数的可变对象大坑、*args/**kwargs、仅关键字参数，把函数参数玩明白。
---

函数是组织代码的基本单元，语法本身五分钟就能学会——真正的分水岭在参数系统：默认值何时求值、`*args` 与 `**kwargs` 如何协作、哪些参数只能按关键字传。这一篇把 Python 函数参数一次讲透。

## 定义与返回值

```python
def area(w: float, h: float) -> float:
    """计算矩形面积，参数为负时抛 ValueError。"""
    if w < 0 or h < 0:
        raise ValueError("边长不能为负")
    return w * h
```

没有 `return` 或写了裸 `return` 的函数返回 `None`。需要返回多个值时，返回的是元组，调用方直接解包：

```python
def min_max(nums):
    return min(nums), max(nums)      # 实际返回一个 tuple

lo, hi = min_max([3, 1, 4])          # 解包接收
```

文档字符串（docstring）写在函数体第一行，`help(area)` 和 IDE 提示都靠它。类型注解不是强制的，但现代项目默认都写，详见[函数进阶与装饰器](06-functions-advanced.md)。

## 默认参数的大坑：只在定义时求值一次

默认值在 `def` 执行时求值**一次**，之后每次调用共享同一个对象——默认值是函数对象的属性，不是每次调用的新建物：

```python
def append_to(item, lst=[]):     # ❌ 默认列表只创建一次
    lst.append(item)
    return lst

append_to(1)    # [1]
append_to(2)    # [1, 2]  —— 不是 [2]！两次调用共享同一个列表
```

正确姿势是 `None` 哨兵：

```python
def append_to(item, lst=None):
    if lst is None:
        lst = []                 # ✅ 每次调用都创建新列表
    lst.append(item)
    return lst
```

不可变的默认值（数字、字符串、`None`、元组）没有这个问题；凡是可变类型（list、dict、set）做默认值，一律用 `None` 哨兵。

> [!WARNING]
> 这个坑的一个「妙用」是做备忘缓存——但不值得。可读性代价远大于收益，需要缓存就用 functools.lru_cache（见[常用标准库](12-standard-library.md)）。

## 参数的五种形态

一个函数的参数从左到右只能按这个顺序排列：

```python
def f(pos_only, /, normal, *args, kw_only, **kwargs):
    ...

f(1, 2, 3, 4, kw_only=5, extra=6)
# pos_only=1, normal=2, args=(3, 4), kw_only=5, kwargs={'extra': 6}
```

| 形态 | 传参方式 | 典型用途 |
| --- | --- | --- |
| `x, /` 之前 | 仅位置 | 参数名是实现细节，避免耦合（3.8+） |
| 中间普通参数 | 位置或关键字都行 | 常规参数 |
| `*args` | 收集多余的位置参数成元组 | 透传、变长参数 |
| 裸 `*` 之后 | 仅关键字 | 强制调用方写清含义 |
| `**kwargs` | 收集多余的关键字参数成字典 | 透传配置项 |

仅关键字参数是 API 设计利器——布尔值按位置传毫无可读性：

```python
def create_user(name, *, admin=False):
    ...

create_user("ada", admin=True)    # ✅ 一眼看清含义
create_user("ada", True)          # ❌ TypeError：admin 只能按关键字传
```

仅位置参数则反过来，常见于包装内建函数的签名：

```python
def repeat(msg, /, times=1):
    return msg * times

repeat("ha", 3)                   # ✅
repeat(msg="ha", times=2)         # ❌ TypeError：msg 仅限位置
```

## 调用侧的解包

`*` 和 `**` 在调用处是「拆开」：把序列拆成一串位置参数、把字典拆成一串关键字参数：

```python
def area(w, h):
    return w * h

box = (3, 4)
area(*box)                 # 等价 area(3, 4)

opts = {"w": 3, "h": 4}
area(**opts)               # 等价 area(w=3, h=4)
```

定义处的 `*` 是「收拢」，调用处的 `*` 是「拆开」——同一个符号，方向相反，这是理解参数系统的关键。

> [!TIP]
> 拆包还能直接用在字面量里：`merged = [*a, *b]` 合并序列、`combined = {**d1, **d2}` 合并字典（右侧优先）。比 `+` 和 `update` 更灵活，也是现代 Python 的惯用法。

## 函数是一等对象

函数可以赋值给变量、存进列表、作为参数传递——这是后面装饰器的地基：

```python
def shout(s):
    return s.upper()

ops = [shout, len]           # 函数名不带括号，传的是函数本身
print(ops[0]("hey"))         # HEY
```

`def` 本质是执行了一条赋值语句：把函数对象绑定到名字上。记住这一点，[函数进阶与装饰器](06-functions-advanced.md)里的闭包和装饰器就没有神秘感了。

## 练习

- [ ] 复现可变默认参数的坑，打印 `append_to.__defaults__` 看看默认值被改成了什么
- [ ] 写一个 `send(to, /, *, retries=3, timeout=5)`，验证两种非法传参都会报 TypeError
- [ ] 写一个 `merge(*dicts, strict=False)`，把多个字典合并，strict=True 时键冲突抛异常

相关阅读：[函数进阶与装饰器](06-functions-advanced.md)
