---
title: 异常与错误处理：EAFP 的哲学
order: 9
tags: 异常, EAFP, 异常链, contextlib, with
summary: 异常层次与该捕什么不该捕什么、try/except/else/finally 的完整语义、异常链的因果记录、EAFP 与 LBYL 的哲学对比（并发场景的决定性差异）、with 协议与 contextlib 的资源管理工具箱。
---

Python 把异常当作**正常的错误通道**，而不是 C++ 那种「例外性失败专用」的机制——标准库处处用异常表达「没有找到」（KeyError）、 「结束」（StopIteration）、「用完了」。配套的哲学叫 **EAFP**（Easier to Ask Forgiveness than Permission）：先做，出问题再处理——与 C/Java 式的 **LBYL**（Look Before You Leap：先检查再做）形成对照。

本篇按「异常层次 → try 完整语义 → 自定义异常 → EAFP 对比 → with 与 contextlib」展开，终点是一套可直接落地的异常处理纪律。

## 1. 异常层次：该捕什么、不该捕什么

```text
BaseException
├── SystemExit            ← sys.exit()：解释器退出流程
├── KeyboardInterrupt      ← Ctrl+C：用户中断
├── GeneratorExit          ← 生成器关闭（第 6 篇）
└── Exception              ← 你写的、你该捕的，全部在这棵子树里
    ├── ValueError / TypeError / KeyError / IndexError / AttributeError
    ├── OSError（IOError/ FileNotFoundError / PermissionError ...）
    ├── RuntimeError（RecursionError ...）
    ├── StopIteration / StopAsyncIteration
    └── （你的自定义异常树）
```

捕获的边界：

```python
try:
    risky()
except Exception:          # ✅ 捕 Exception：正常错误集合
    log(...)
except BaseException:      # ❌ 会吞掉 Ctrl+C 与 sys.exit —— 只在「绝对清理」层用
    ...
except:                    # ❌❌ 裸 except 等价于 BaseException，且连名字都拿不到 —— 禁止
    ...
```

「捕获层次精确」是一切异常规约的起点：**捕你预期的那一个类型**，让意外错误带着完整信息往上飞。

## 2. try 的完整语义

### 2.1 四个块各管一段

```python
def read_config(path):
    try:
        f = open(path, encoding="utf-8")        # 可能抛的代码
    except FileNotFoundError:
        return {}                                # 处理：这个预期错误
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise ConfigError(f"bad config: {path}") from e   # 翻译并链式上抛
    else:
        return json.load(f)                      # else：try 没抛才执行（放这里，避免把 load 的错算到 open 头上）
    finally:
        ...                                      # finally：无论如何都执行（清理）
```

| 块        | 何时执行            | 用途                        |
| --------- | ------------------- | --------------------------- |
| try       | —                   | 监视段                        |
| except    | 对应异常抛出时       | 处理 / 翻译 / 记录            |
| else      | try 无异常时         | 「成功路径」代码（不掺进 try） |
| finally   | 任何路径            | 清理（优先用 with 替代）       |

「else 块」的价值常被低估：把「成功后才做的转换」放进 else，try 的监视范围就缩小到真正可能抛的那几行——**except 捕到的错误类型因此更精确**（json.load 的错误不会被误当成 open 的错误处理）。

### 2.2 raise 的三种形态与异常链

```python
raise ValueError("msg")            # ① 抛新异常
raise                              # ② 裸 raise：在 except 块内原样重抛（保住栈）
raise NewError(...) from e         # ③ 链式：明确「由 e 引起」—— __cause__
```

异常链是 Python 3 的重要改进：`from e` 记录因果，traceback 会打印「The above exception was the direct cause of...」——两层现场都在。规约：**翻译异常（换类型换信息）一律 `from e`**，让因果链在日志里可见；「处理了就不用链」（信息已完整时直接处理不上抛）。

```python
# 典型的边界翻译
def load_users(path):
    try:
        with open(path, encoding="utf-8") as f:
            return [User(**json.loads(line)) for line in f]
    except OSError as e:
        raise DataError(f"无法读取用户文件 {path}") from e     # OSError → 领域错误
    except (KeyError, TypeError) as e:
        raise DataError(f"用户文件格式错误 {path}") from e
```

### 2.3 finally 的一个暗坑

```python
def bad():
    try:
        return compute()
    finally:
        return -1            # ❌ finally 的 return 会**吞掉** try 的返回与异常！
```

finally 的 `return`/`break` 会覆盖 try 的结果（包括正在传播的异常——异常无声消失）。finally 只做清理；现代代码里清理首选 with，finally 的使用频率已经很低。

## 3. 自定义异常：领域错误树

```python
# 每个库/应用一个根，业务错误挂在其下 —— 调用方可以「一把捕全」或精确分支
class AppError(Exception):
    """本应用所有错误的根"""

class ConfigError(AppError): ...
class ValidationError(AppError):
    def __init__(self, field, reason):
        super().__init__(f"{field}: {reason}")
        self.field = field

class PaymentError(AppError): ...
class InsufficientFunds(PaymentError): ...

# 使用侧
try:
    checkout(cart)
except InsufficientFunds:          # 精确分支：可恢复
    prompt_topup()
except PaymentError as e:          # 支付类错误：统一上报
    alert(str(e))
except AppError:                   # 兜底：本应用错误集中处理
    render_error_page()
```

规约：**库的公共 API 抛库自己的异常类型**（调用方不必知道你内部用了 requests 还是 sqlite）；层次两层为宜（根 + 分类 + 具体错误可合并为一到两层）；错误信息带上下文（哪个文件、哪个字段、什么值）。

## 4. EAFP vs LBYL：两种哲学的正面对比

```python
# 场景：读 dict 的嵌套键
# LBYL：先检查再取
if "user" in cfg and "email" in cfg["user"]:
    email = cfg["user"]["email"]

# EAFP：直接取，捕获失败
try:
    email = cfg["user"]["email"]
except KeyError:
    email = None

# 惯用法折中：.get
email = cfg.get("user", {}).get("email")
```

| 维度      | EAFP（try/except）            | LBYL（先检查）              |
| --------- | ----------------------------- | --------------------------- |
| 可读性    | 主路径无嵌套                   | 检查链越来越深               |
| 竞态安全  | ✅ 检查与使用之间无人插队       | ❌ TOCTOU：检查后状态可能变   |
| 性能      | 异常抛出贵（但零异常路径免费）  | 每次检查都付钱                |
| 语义      | 「失败是例外」                 | 「失败是常态」                |

两个工程结论：

1. **并发/IO 场景 EAFP 是唯一正确答案**：「检查文件存在再打开」在多进程下有 TOCTOU 竞态；`try: open(...) except FileNotFoundError` 检查与使用原子。字典属性场景同理（多线程修改时 LBYL 会翻车）。
2. **失败频率决定性能姿势**：高频命中失败（解析大量用户输入、逐行探测键）时异常的抛出成本（微秒级 + traceback 构造）不可忽略——用 `.get`/`in`/`defaultdict` 等「无异常 API」；低频失败时 try 的零成本路径更优雅。

## 5. with 与 contextlib：资源管理的工具箱

### 5.1 上下文管理器协议

```python
with open(path, encoding="utf-8") as f:      # __enter__ 返回值绑定给 f
    data = f.read()                          # 无论正常/异常，退出时调 __exit__（关文件）
```

`with` 的协议是 `__enter__`（进入，返回值交给 as）+ `__exit__(exc_type, exc, tb)`（退出，异常时收到异常信息、返回 True 表示「已处理」）——与 C++ RAII 同思想，Python 版多了「异常可见性」的参数。

### 5.2 contextmanager：把任意「前后动作」包成 with

```python
from contextlib import contextmanager, suppress, closing

@contextmanager
def timer(label):
    start = time.perf_counter()
    try:
        yield                                   # yield 前后 = __enter__/__exit__
    finally:
        print(f"{label}: {time.perf_counter() - start:.3f}s")

with timer("parse"):
    parse(data)

# suppress：精确吞掉某类异常（EAFP 的高频小场景）
with suppress(FileNotFoundError):
    os.remove("tmp.txt")                        # 不存在就算了

# closing：给只有 close() 没实现协议的对象补协议
with closing(urllib.request.urlopen(url)) as resp:
    ...
```

`@contextmanager` 是「资源模式」的量产工具：临时改工作目录、锁、事务、计时、标记——「前后成对的任意动作」都值得包成 contextmanager 复用，而不是在每个调用点重复 try/finally。

```python
# 实用模板：原子写文件（先写临时文件再改名 —— 崩溃不会留下半个文件）
@contextmanager
def atomic_write(path):
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            yield f
        os.replace(tmp, path)          # 原子改名
    except BaseException:
        with suppress(OSError):
            os.remove(tmp)             # 失败清理半成品
        raise
```

## 6. 异常处理纪律

1. **捕获要精确**：捕预期类型，不裸 except；`except Exception` 只出现在顶层兜底与边界翻译。
2. **要么处理、要么上抛、要么记录后再抛**——绝不静默吞（`except: pass` 是 bug 温床；真要吞用 `suppress(具体类型)` 并注明理由）。
3. **错误信息带上下文**：文件路径、字段名、实际值；`raise ... from e` 保住因果链。
4. **库边界翻译异常**：内部异常在 API 边界换成领域异常（调用方不依赖你的实现细节）。
5. **EAFP 为主**：主路径干净、竞态安全；高频失败路径选无异常 API（get/in/defaultdict）。
6. **资源一律 with**：文件、锁、连接、临时目录；「前后成对」的动作包 contextmanager。

## 7. 陷阱清单

- 裸 except / `except Exception` 乱捕：吞 KeyboardInterrupt 与意外错误；捕精确类型。
- `except: pass` 静默吞：至少 logging.exception 或 suppress(具体) + 注释。
- 翻译异常不 `from e`：因果链断裂；raise New from old。
- finally 里 return：吞返回值与异常；finally 只清理。
- LBYL 的 TOCTOU：检查与使用之间状态可变；并发/IO 用 EAFP。
- 高频失败路径用异常：性能税；get/in/defaultdict。
- 捕获块里再抛同类型不带上下文：日志只见最后一场雪；包装信息或链式。
- with 之外持有文件对象继续读：已关闭 ValueError；资源的作用域与用法匹配。
- 自定义异常继承太深/太浅：两层为宜，根类统一。
- 把 AssertionError 当业务异常：-O 下消失（同[第 12 篇](12-quality.md)的测试纪律）。

## 8. 小结

- 捕获边界：Exception 子树是正常错误集合，BaseException 级别（SystemExit/KeyboardInterrupt）属于解释器流程；精确捕获是第一纪律。
- try 的四块分工：else 隔离成功路径缩小监视范围、finally 只清理；raise 三形态（新抛/裸重抛/链式）中 `from e` 保住因果。
- 自定义异常树（根 + 分类）让调用方按粒度捕获；库在 API 边界翻译内部异常。
- EAFP 是 Python 的默认哲学：主路径干净、竞态安全；失败高频时切换无异常 API；finally 不放 return。
- with 协议 + contextlib（contextmanager/suppress/closing）是资源与「前后成对动作」的量产工具；原子写模板是综合应用。

## 9. 练习

**1.** 解释下面的输出为什么是 `B A final`，并指出其中的两个坏味道（吞异常 + finally 覆盖）。

```python
def f():
    try:
        raise ValueError("inner")
    except ValueError:
        print("B")
        raise
    finally:
        print("final")

def g():
    try:
        f()
    except ValueError:
        print("A")
```

> [!TIP]
> 思路except 打印 B 后裸 raise 继续传播，finally 先执行（打印 final），异常再到 g 的 except（A）。坏味道其实在正确代码里不构成 bug——把 raise 删掉、finally 加 return，再观察异常如何无声消失。实验是理解「finally 优先于传播」的最快路径。

**2.** 实现 `chunk_read(path, size)`：用生成器 + try/finally 保证「异常发生时也能正确处理已读块的边界」，对比 contextmanager 实现版本。

> [!TIP]
> 思路生成器内 `try: yield from iter(...) finally: cleanup`；contextmanager 版把「打开-清理」对打包。两个版本考察[第 6 篇](06-iterators-generators.md)的生成器清理与本章的 with 协议如何协同。

**3.** 给一个「三层调用栈」（main → load → parse）设计异常策略：parse 抛 ParseError（带行号），load 翻译成 DataError（带文件名），main 统一记录。用异常链保证三层现场都在 traceback 里。

> [!TIP]
> 思路`raise DataError(f"{path}:{lineno}") from e` 每层补上下文；main 的 `logging.exception` 打印完整链。「洋葱式错误信息」与 C 篇错误处理的层次原则完全同构。

**4.** 把 LBYL 版代码改为 EAFP 并说明并发下原版的竞态窗口：

```python
if os.path.exists(path):
    with open(path) as f: process(f)
```

> [!TIP]
> 思路exists 与 open 之间文件可能被删（TOCTOU）——多进程/多线程下不是理论风险。`try: open except FileNotFoundError` 检查与使用原子。顺带讨论 PermissionError 是否也要捕（取决于业务语义：存在但打不开要不要单独处理）。

**5.** 实现三个 contextmanager：临时切换工作目录、临时修改环境变量、数据库事务（异常回滚正常提交）。全部用 @contextmanager，并测试异常路径的正确性。

> [!TIP]
> 思路模板都是「保存旧状态 → yield → finally 恢复」；事务版 yield 前开事务、yield 后 commit、except rollback + raise。测试异常路径：with 块里故意 raise，验证状态还原——contextmanager 的价值一半在异常路径的行为正确。

**6.** 讨论：`except Exception: log(...)` 出现在「后台任务调度器」里是否合理？边界在哪？给出调度器、库函数、CLI 入口三处的异常策略表。

> [!TIP]
> 思路调度器/顶层入口：兜底合理（任务是插件代码，不能让一个坏任务杀死调度循环），但必须记录完整 traceback 并继续。库函数：绝不兜底——把错误交给调用方。CLI 入口：catch-all 翻译成退出码。「层级决定兜底权」是异常策略的元规则。
