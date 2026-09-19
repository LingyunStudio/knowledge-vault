---
title: 函数与作用域：参数的完整规则
order: 4
tags: 作用域, LEGB, 闭包, 参数解包, 装饰器
summary: 参数的完整语法（位置专属 /、关键字专属 *、*args/**kwargs 与解包调用）、LEGB 作用域规则与 global/nonlocal 的边界、闭包的惰性绑定陷阱、装饰器的完整机制与 functools.wraps，以及函数设计的行为契约。
---

Python 函数是**一等对象**——可以赋值、传参、放进容器、在运行时检查。这个身份加上完整的参数语法，构成了 Python 表达力的一半：装饰器、回调、策略模式、partial 应用，全都是「函数作为值」的推论。本篇把「参数怎么传、名字怎么找、函数怎么包装」三条线讲透，终点是你能读懂任何装饰器并写出正确的。

## 1. 一等函数：函数就是值

```python
def shout(text): return text.upper()
def whisper(text): return text.lower()

speak = shout            # 函数赋给名字：没有括号 = 传递函数本身
speak("hi")              # 'HI'

handlers = {"shout": shout, "whisper": whisper}    # 函数进字典：分发表
handlers["whisper"]("HEY")                          # 'hey'

def apply(fn, x): return fn(x)          # 函数作参数
apply(shout, "hi")                      # 'HI'

shout.__name__                          # 'shout'：函数对象自带元信息
```

「没有括号」是传递，「有括号」是调用——这个区分在回调、事件注册、策略模式的代码里无处不在。看懂任何 Python 框架的第一步都是认出「这里传的是函数还是调用结果」。

## 2. 参数：完整语法与传参规则

### 2.1 五类参数与完整签名

```python
def create(pos_only, /, normal, *args, kw_only="d", **kwargs):
    #    └位置专属      └普通          └多余位置  └关键字专属      └多余关键字
    ...
```

| 类别            | 语法        | 调用方式           | 例子                     |
| --------------- | ----------- | ------------------ | ------------------------ |
| 位置专属        | `/` 之前     | 只能按位置          | `f(1)`（`f(pos_only=1)` 报错）|
| 普通参数        | `name`      | 位置或关键字均可     | `f(1)` / `f(normal=1)`   |
| 可变位置收集    | `*args`     | 多余位置参数进元组   | `f(1, 2, 3)` → args=(2,3) |
| 关键字专属      | `*` 或 `*args` 之后 | 只能按关键字    | `f(kw_only=1)`（`f(1,1)` 报错）|
| 可变关键字收集  | `**kwargs`  | 多余关键字进字典     | `f(x=1)` → kwargs={'x':1}|

两类「专属」的工程价值：

- **位置专属 `/`**：参数名是纯实现细节（如 `len(obj)` 的 obj），改名字不破坏调用方。标准库大量使用。
- **关键字专属 `*`**：布尔/可选参数强制写名字，调用处自文档——`connect(host, port, *, timeout=5, retry=True)` 比 `connect(h, p, 5, True)` 可读且防错位。

### 2.2 解包调用：* 与 ** 的另一面

```python
def point(x, y, z=0): ...

args = (1, 2)
point(*args)                  # 位置解包：point(1, 2)
kw = {"z": 9, "y": 3}
point(1, **kw)                # 关键字解包：point(1, y=3, z=9)

def log(*args, sep=" | "):
    print(sep.join(map(str, args)))     # 接收-转发模式（包装函数的标配）

log(1, 2, 3)                  # 1 | 2 | 3
```

「收集」（定义处）与「解包」（调用处）是同一个星号的两面。包装/转发函数（装饰器、代理）的标准签名就是 `def wrapper(*args, **kwargs): return f(*args, **kwargs)`——「无论你传什么都原样转交」。

### 2.3 默认值：定义时求值（回顾与延伸）

```python
import time
def log(msg, ts=time.time()):     # ❌ ts 是**模块导入时**的时间——所有调用共享
    ...

def log(msg, ts=None):
    if ts is None: ts = time.time()   # ✅ 每次调用时求值
```

可变默认参数（`=[]`）的陷阱在[第 2 篇](02-data-model.md)已讲；这里补全规则：**默认值在 def 执行时求值一次**，存进函数对象（`f.__defaults__` 可见）。所以时间戳、随机数、任何「每次应不同」的默认都必须用 None 哨兵。

## 3. 作用域：LEGB 与名字查找

### 3.1 四层规则

名字查找按 **L**ocal → **E**nclosing（外层函数）→ **G**lobal（模块）→ **B**uiltins 顺序，找到即停：

```python
x = "global"
def outer():
    x = "enclosing"
    def inner():
        x = "local"          # inner 里读 x → local
        print(x)
    inner()
outer()                      # local

def reader():
    print(x)                 # 读 outer 的 x → enclosing（内层没绑定）
```

关键规则是**赋值即本地**：函数内任何 `x = ...` 都让 x 成为本地名——除非显式声明。这就是经典 bug 的根源：

```python
count = 0
def increment():
    count = count + 1        # ❌ UnboundLocalError：赋值让 count 变本地，
                             #    但本地 count 还没值就先读了
```

### 3.2 global 与 nonlocal：声明「我不是本地」

```python
count = 0
def increment():
    global count             # 声明操作模块级名字
    count += 1               # ✅

def counter():
    n = 0
    def step():
        nonlocal n           # 声明操作外层函数的名字
        n += 1
        return n
    return step

c = counter()
c(); c()                     # 1, 2 —— n 活在闭包里
```

工程立场：`global` 几乎总是设计问题（可变全局状态——[第 1 篇](01-python-model.md)的三问：重入、测试、并发）；`nonlocal` 是闭包状态的正当通道（计数器、缓存、装饰器），但也提醒你「这个函数不是纯函数」。

### 3.3 闭包：函数记住了定义时的环境

```python
def make_multiplier(k):
    def multiply(x):
        return x * k          # k 不在本地、不在全局 —— 从 enclosing 抓住
    return multiply

double = make_multiplier(2)
triple = make_multiplier(3)
double(10)                    # 20 —— double 闭包里存着自己的 k=2
```

闭包 = 函数 + 它抓住的外层变量。两个进阶事实：

**① 惰性绑定**：闭包记住的是**变量名**，不是值——循环里造闭包的经典陷阱：

```python
funcs = [lambda: i for i in range(3)]
[f() for f in funcs]          # [2, 2, 2] —— 三个 lambda 共享同一个 i（循环结束时 i=2）

funcs = [lambda i=i: i for i in range(3)]   # ✅ 默认参数在定义时求值，各存一份
[f() for f in funcs]                        # [0, 1, 2]
```

**② 延伸阅读**：闭包状态可以用 `cell_contents` 查看（`double.__closure__[0].cell_contents`）——调试闭包行为的后门。

## 4. 装饰器：包装函数的语法化

### 4.1 机制拆解

```python
import functools

def log_calls(func):
    @functools.wraps(func)                      # 保住被包装函数的 __name__/__doc__
    def wrapper(*args, **kwargs):
        print(f"call {func.__name__}({args}, {kwargs})")
        result = func(*args, **kwargs)          # 原样转发
        print(f"-> {result!r}")
        return result
    return wrapper

@log_calls                     # 语法糖：add = log_calls(add)
def add(a, b):
    return a + b

add(1, 2)                      # 打印调用日志后返回 3
```

装饰器是「接收函数、返回（通常是包装后的）函数」的高阶函数；`@` 语法只是把 `f = deco(f)` 写得更醒目。它的全部机制就是[第 1 篇](01-python-model.md)的绑定模型：**名字 add 被重新绑定到 wrapper**——而 wrapper 通过闭包抓住了原函数。

`@functools.wraps` 不是装饰：没有它，wrapper 会遮住原函数的名字与文档（`add.__name__` 变成 'wrapper'），调试、文档、序列化全部遭殃。**写装饰器必带 wraps**。

### 4.2 带参数的装饰器：三层套娃

```python
def retry(times=3, delay=1.0):                 # 第一层：收装饰器参数
    def decorator(func):                       # 第二层：收函数
        @functools.wraps(func)
        def wrapper(*args, **kwargs):          # 第三层：真正执行
            for attempt in range(1, times + 1):
                try:
                    return func(*args, **kwargs)
                except Exception:
                    if attempt == times:
                        raise
                    time.sleep(delay)
        return wrapper
    return decorator

@retry(times=5, delay=0.5)     # 注意：带参数的装饰器调用后返回真正的装饰器
def flaky_call(): ...
```

「`@retry(times=5)` 先调用 retry 拿到装饰器再应用」——记住这个执行顺序，任何装饰器代码都能读。常用装饰器清单：`functools.cache/lru_cache`（记忆化）、`staticmethod/classmethod/property`、`dataclass`、pytest 的 fixture——它们全是本节机制的应用。

## 5. 函数设计的行为契约

1. **参数尽量少、语义清楚**：超过 4~5 个参数考虑 dataclass 聚合（`**kwargs` 接口需要文档保证契约）。
2. **可选参数关键字专属**：`def f(a, b, *, timeout=None, strict=False)`——布尔旗标绝不裸传。
3. **纯函数倾向**：不修改参数（可变参数对象就地修改是隐形副作用）、不依赖全局；副作用集中且显式。
4. **返回 None 还是抛异常**：「找不到/不适用」返回 None（或 optional 语义）、「契约被违反」抛异常（[第 9 篇](09-errors-exceptions.md)的 EAFP 哲学）。
5. **lambda 只写单表达式**：需要语句、文档、名字的函数用 def；lambda 的主场是 sorted 的 key 参数。

## 6. 陷阱清单

- `count = count + 1` 的 UnboundLocalError：赋值即本地；需要外层就 nonlocal/global。
- 闭包的惰性绑定：循环里的 lambda 共享循环变量；`i=i` 默认参数或 functools.partial 固定。
- 装饰器忘 functools.wraps：原函数名字/文档丢失。
- 可变默认参数：定义时求值一次；None 哨兵。
- `*args, **kwargs` 转发时漏一个：包装层签名失真；标准转发形制背熟。
- 位置/关键字混用错位：布尔旗标裸传（`f(1, 2, True, False)`）；关键参数关键字专属。
- global 修改全局状态：可重入性与可测试性双杀；显式传参或闭包/类状态。
- lambda 塞逻辑：单表达式之外用 def。
- 默认参数是「每次调用重算」的误解：`__defaults__` 里看得见那次求值的结果。

## 7. 小结

- 函数是一等对象：赋值、传参、进容器、运行时元信息——「无括号传递、有括号调用」是读框架代码的分水岭。
- 参数完整语法五段式（`/`、普通、`*args`、关键字专属、`**kwargs`）：位置专属保护实现细节、关键字专属强制自文档、收集-解包是包装函数的标配。
- 作用域 LEGB + 「赋值即本地」：global/nonlocal 是显式声明不是逃生门；闭包记住变量名而非值——循环闭包陷阱用默认参数固定。
- 装饰器 = 高阶函数 + @ 语法糖 + 闭包：wraps 保元信息、带参装饰器三层套娃；functools.cache 等全是这套机制的应用。
- 函数设计契约：少参数、关键字专属可选参、纯函数倾向、「没有」与「违约」分清 None 与异常。

## 8. 练习

**1.** 实现 `memoize` 装饰器（不用 functools.cache，手写缓存字典 + wraps），处理不可哈希参数时的合理行为，并与 `functools.lru_cache(maxsize=None)` 对比正确性。

> [!TIP]
> 思路缓存 key 用 `(args, tuple(sorted(kwargs.items())))`——kwargs 顺序不敏感；不可哈希参数（list）要么抛 TypeError 要么禁用缓存并注明。对比验证：递归 fib 计数调用次数，两者应完全一致；lru_cache 还提供统计与上限淘汰。

**2.** 解释下面的输出为什么是 [2, 2, 2]，给出三种修复（默认参数、partial、闭包工厂），并说明哪种在「循环变量是可变对象」时仍安全。

```python
callbacks = [lambda: print(i) for i in range(3)]
for cb in callbacks: cb()
```

> [!TIP]
> 思路惰性绑定：三个 lambda 共享循环变量 i（结束时为 2）。修复①`lambda i=i: print(i)`；②`functools.partial(print, i)`（partial 在创建时求值）；③闭包工厂 `def make(i): return lambda: print(i)`。可变对象场景①的「默认参数」同样只固定引用——三种修法都固定的是**绑定**，可变内容仍共享，深拷贝才彻底隔离。

**3.** 写一个 `@deprecated(reason)` 装饰器：调用时打印弃用警告（warnings.warn）、保留原函数行为与元信息，并支持叠加在其他装饰器之上（讨论装饰顺序的影响）。

> [!TIP]
> 思路三层结构 + `warnings.warn(reason, DeprecationWarning, stacklevel=2)`（stacklevel 指向调用方）。顺序影响：`@log @deprecated @cache` 的执行链从下往上包——cache 在最内层（缓存命中则 deprecated 不再警告），顺序即语义，审查装饰器栈时要读成洋葱。

**4.** 用 `/` 与 `*` 设计一个 `plot(x, y, /, *, color="k", label=None, **style)` 风格的绘图接口：x/y 位置专属（参数名是实现细节），样式全关键字。写出「合法调用」与「三种会被挡下的错误调用」。

> [!TIP]
> 思路合法：`plot(xs, ys, color="r")`。挡下：`plot(x=xs, y=ys)`（位置专属）、`plot(xs, ys, "r")`（color 关键字专属）、`plot(xs, ys, linestyle=1)`？——进 **kwargs 时是允许的，讨论：**kwargs 是「透传底层」还是「失控面」，库的取舍（校验白名单 vs 透传文档）。

**5.** 实现「计数器工厂」：`make_counter()` 返回函数，每次调用递增并返回，支持 `reset()`——讨论为什么返回单一函数不够，给出闭包+nonlocal 与类两种实现。

> [!TIP]
> 思路两个操作（inc/reset）无法由单一函数对象承载——闭包版返回「函数 + 附加方法」（`counter.reset = reset_fn` 的技巧）或直接类。这个练习的边界恰好演示「什么时候闭包该让位给类」：多于一个操作或状态复杂时，类是更好的状态载体。

**6.** 阅读并解释这段代码的输出与机制（涉及 LEGB、闭包、装饰器顺序）：

```python
def deco(f):
    calls = 0
    def w(*a, **k):
        nonlocal calls
        calls += 1
        print(f"#{calls}")
        return f(*a, **k)
    return w

@deco
def g(): pass

g(); g()
h = deco(g)
h()
```

> [!TIP]
> 思路输出 1、2、3：每次调用 deco 产生**独立的** calls 闭包变量——g 的包装器计数到 2，h 是 g（已包装版）再包一层，独立计数从 1 开始，且调用链是 h→w_h→w_g→g。这个实验验证「装饰器状态在闭包里，每次应用一份」。
