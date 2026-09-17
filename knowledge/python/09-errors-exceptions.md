---
title: 异常处理
order: 9
tags: 核心, try, 异常
summary: try/except/else/finally 全家桶、自定义异常、EAFP 风格与异常链 raise from。
---

Python 的错误处理与 C 的错误码、Go 的 `if err != nil` 都不同：错误以异常的形式沿调用栈向上抛，不接就一路炸到顶层。写对异常处理的关键就四条——精确捕获、别吞错误、用对 else/finally、理解异常链。

## try/except/else/finally 全家桶

```python
import json

def load_config(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}                     # 缺文件可预期，给默认配置即可
    except json.JSONDecodeError as e:
        raise                         # 配置坏了是大事，原样重抛（见下文）
    else:
        print("配置加载成功")         # 只在 try 没抛异常时执行
        return data
    finally:
        print("load_config 结束")     # 无论成败都执行
```

四个块各司其职：

- `try`：放可能出错的代码，越短越好，别把无关语句包进来
- `except`：接住指定类型的异常
- `else`：只在无异常时执行——把成功路径放这里，避免它被上面的 except 误伤
- `finally`：无论如何都执行，清理兜底（多数场景 with 语句已经够用）

## 精确捕获

异常是一个类体系：`FileNotFoundError`、`PermissionError` 都是 `OSError` 的子类，`json.JSONDecodeError` 是 `ValueError` 的子类。捕获时选最小够用的类型，多个类型用元组：

```python
try:
    n = int(text)
except (ValueError, TypeError) as e:   # 按元组捕获多种类型
    print(f"不是合法数字：{e}")
```

> [!WARNING]
> 裸 `except:` 会连 `KeyboardInterrupt`（Ctrl+C）和 `SystemExit` 一起吞掉，程序想停都停不下来；最低限度也要写 `except Exception:`，最好写具体类型。捕获后一句 `pass` 是制造隐形 bug 的头号手法——捕获了就要处理、记录或重抛。

## raise 与自定义异常

主动抛异常用 `raise`，能带消息就带消息：

```python
def withdraw(balance, amount):
    if amount > balance:
        raise ValueError(f"余额不足：{balance} < {amount}")
    return balance - amount
```

裸 `raise`（不带任何参数）只能出现在 except 块内，作用是**原样重抛**当前异常，调用栈完整保留。上文 `load_config` 里对 `JSONDecodeError` 的处理就是它：我只负责打日志，决定权交还上层。

项目里应该定义自己的异常体系，统一基类让调用方一次捕获：

```python
class AppError(Exception):
    """项目内异常的公共基类。"""

class PaymentDeclined(AppError):
    def __init__(self, order_id, reason):
        super().__init__(f"订单 {order_id} 被拒：{reason}")
        self.order_id = order_id

try:
    pay(order)
except AppError as e:        # 一网打尽所有业务异常
    log.error(str(e))
```

自定义异常继承 `Exception`，不要继承 `BaseException`——后者连 Ctrl+C 都会拦截。

## 异常链：raise ... from

在 except 块里抛新异常时，Python 自动把原异常挂到新异常的 `__context__` 上，输出会出现 "During handling of the above exception..."。想明确表达「转换」语义，用 `from`：

```python
def load_port(cfg):
    try:
        return int(cfg["port"])
    except (KeyError, ValueError) as e:
        raise AppError("端口配置非法") from e   # 显式声明因果：e 是根因
```

排查时两条栈都在，根因不丢。`raise AppError(...) from None` 则表示故意抹掉上下文，只在你确定根因对用户毫无意义时用。

> [!TIP]
> 在 except 块里抛任何新异常，都习惯性带上 `from e`。它不只是信息更全，语义上是在说「这个异常是我有意抛的，那个是根因」，而不是处理过程中意外引爆的另一场事故。

## EAFP：先斩后奏的风格

Python 社区推崇 **EAFP**（Easier to Ask Forgiveness than Permission）：直接做，出了异常再处理；而不是 **LBYL**（Look Before You Leap）：先检查条件再动手。

```python
# LBYL：三思而后行
if "key" in d:
    process(d["key"])

# EAFP：先干了再说 —— Python 更地道的写法
try:
    process(d["key"])
except KeyError:
    ...
```

EAFP 不只是风格：检查与使用之间存在时间差。`if os.path.exists(p): open(p)` 在两步之间文件可能被删，而 `try: open(p) except FileNotFoundError:` 天然没有这个竞态。代价是异常的抛出与捕获比 if 判断慢，所以高频路径上能便宜判断就便宜判断。

## 练习

- [ ] 写一个 `safe_div(a, b)`，除零时返回 None；再想想它为什么不适合放进库代码（调用方拿到 None 会把错误推迟到更远处）
- [ ] 定义 `ConfigError` 体系，在解析函数里用 `raise ... from` 转换 `JSONDecodeError`
- [ ] 复现「裸 except 吞掉 Ctrl+C」的现象：跑一个 while True 循环，裸 except 捕获后按 Ctrl+C 观察行为

相关阅读：[文件与上下文管理器](10-files-context.md)
