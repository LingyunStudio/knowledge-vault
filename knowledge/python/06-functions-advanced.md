---
title: 函数进阶与装饰器
order: 6
tags: 进阶, 闭包, 装饰器
summary: 闭包与作用域链、装饰器原理与带参装饰器、类型注解让 Python 长出静态检查。
---

函数定义过后还大有文章可做：变量如何被内层函数捕获、装饰器为什么能不侵入地增强函数、类型注解如何让动态语言获得静态检查。这三件事共享同一个地基——函数是一等对象。

## 作用域与闭包

Python 按 **LEGB** 顺序查找名字：Local（当前函数）→ Enclosing（外层函数）→ Global（模块）→ Builtin（内建）。内层函数引用外层变量，外层返回后引用仍然存活，这就是闭包：

```python
def make_counter():
    count = 0
    def inc():
        nonlocal count      # 声明改的是外层变量，否则视为新建局部变量
        count += 1
        return count
    return inc              # 返回的是函数对象，count 随之被捕获

c = make_counter()
print(c())    # 1
print(c())    # 2，状态活在内层函数里
```

去掉 `nonlocal` 会怎样？`count += 1` 等价于「读再写」，Python 一看函数里有对 count 的赋值，就把它当局部变量，读它时直接抛 `UnboundLocalError`。**读外层不需要声明，改外层必须 nonlocal**。

> [!WARNING]
> 闭包捕获的是**变量本身**而不是当时的值——循环变量是重灾区：

```python
funcs = [lambda: i for i in range(3)]
print([f() for f in funcs])     # [2, 2, 2]，三个 lambda 共享同一个 i

funcs = [lambda i=i: i for i in range(3)]   # ✅ 用默认参数在定义时冻结
print([f() for f in funcs])     # [0, 1, 2]
```

## 装饰器：不侵入地增强函数

装饰器就是「接收函数、返回新函数」的函数。语法糖 `@deco` 等价于 `func = deco(func)`：

```python
import functools, time

def timer(func):
    @functools.wraps(func)            # 保住原函数的 __name__ / __doc__
    def wrapper(*args, **kwargs):     # 用 *args/**kwargs 通吃任意签名
        start = time.perf_counter()
        result = func(*args, **kwargs)
        print(f"{func.__name__} 耗时 {time.perf_counter() - start:.3f}s")
        return result
    return wrapper

@timer
def work(n):
    return sum(i * i for i in range(n))

work(10 ** 6)     # 打印：work 耗时 0.032s
```

执行顺序值得想一遍：解释器读到 `@timer`，立刻用 `timer(work)` 的返回值顶替了名字 `work`。之后每次调用 `work(...)` 实际调用的是 `wrapper(...)`。

不写 `functools.wraps` 的代价：`wrapper` 会顶掉原函数的名字和文档字符串，调试与工具链都会受影响。写装饰器，`wraps` 永远第一行。

## 带参数的装饰器

`@retry(times=3)` 比裸装饰器多包一层——先调 `retry(3)` 拿到真正的装饰器：

```python
import functools

def retry(times):
    def deco(func):                      # 这一层才是装饰器
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(1, times + 1):
                try:
                    return func(*args, **kwargs)
                except Exception:
                    if attempt == times:
                        raise            # 最后一次失败，原样抛出
            # 不会到这里
        return wrapper
    return deco

@retry(times=3)
def fetch(url):
    ...
```

三层嵌套读法：`retry` 处理参数，`deco` 处理函数，`wrapper` 处理调用。类型注解可以分别标注，让 IDE 对每层都有提示。

> [!TIP]
> 一个函数可以叠多个装饰器，自下而上依次包裹：`@a` 在 `@b` 上面时，等价于 `a(b(func))`——最靠近函数的装饰器最先生效。

## 类型注解：动态语言的静态护栏

注解不是强制的、运行时不校验，但 mypy、pyright 等工具和 IDE 补全都依赖它。现代项目默认全注解：

```python
def greet(name: str, times: int = 1) -> list[str]:
    return [f"hi {name}"] * times

def find_user(key: str) -> dict[str, int] | None:   # 3.10+ 用 | 表示「或 None」
    ...

from collections.abc import Callable

def apply(f: Callable[[int], int], x: int) -> int:  # 参数与返回值都有类型
    return f(x)
```

要点：

- 内置类型直接当泛型用：`list[int]`、`dict[str, int]`（3.9+），不再需要 `typing.List`
- 可选值统一写 `X | None`，比旧写法 `Optional[X]` 直观
- 注解写错了运行时也不报错——**它是给检查器看的，别指望它拦运行时 bug**；真正拦截靠 CI 里跑 mypy

> [!NOTE]
> 「动态类型 + 类型注解」不是妥协，而是工程上的甜点位：小脚本零负担，大代码库逐步加注解、逐步收紧检查。这也正是大量 Python 开源项目的实际做法。

## 练习

- [ ] 写一个 `@count_calls` 装饰器，累计原函数被调用的次数，并用 `__name__` 验证 wraps 的作用
- [ ] 复现闭包迟绑定问题，再用默认参数修复它
- [ ] 给 `retry` 装饰器加上类型注解，用 `python -m mypy` 静态检查通过

相关阅读：[类与面向对象](07-classes-oop.md)
