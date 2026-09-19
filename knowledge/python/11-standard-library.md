---
title: 标准库地图：自带电池的全景
order: 11
tags: functools, re, datetime, logging, subprocess, concurrent.futures
summary: 按任务组织的标准库地图——heapq/bisect 的有序结构、functools 与 itertools 的函数式零件、re 的实用子集与贪婪陷阱、datetime 的时区纪律、logging 的正确配置、subprocess 的安全红线、concurrent.futures 的并行三层选择。
---

「Python 自带电池」名副其实：标准库覆盖数据结构、文本、时间、系统、并发、网络。本篇不是 API 手册，而是**按任务组织的地图**——每个模块给出「解决什么问题、核心 API、最容易踩的坑」，配合前面篇章的机制理解（迭代器、上下文管理、异常）串成整体。

## 1. 有序结构三件套：heapq、bisect、queue

```python
import heapq

# 堆：TopK / 优先级的 O(n log k) 答案（第 9 篇 C++ 对照）
nums = [5, 1, 8, 3, 9, 2]
heapq.nlargest(3, nums)                       # [9, 8, 5]
heapq.nsmallest(3, nums)

heap = []
for job in jobs:
    heapq.heappush(heap, (priority, job))     # 元组比较：priority 是首要键
priority, job = heapq.heappop(heap)           # 永远弹出最小

# bisect：已排序列表的二分插入（维护有序结构）
import bisect
scores = []
bisect.insort(scores, 88)                     # 插入后仍有序：O(n) 移动但二分找位
idx = bisect.bisect_left(scores, 90)          # 第一个 >= 90 的位置（C++ lower_bound 同语义）

# queue：线程安全队列（生产者消费者直接可用，不用自己锁）
from queue import Queue
q = Queue(maxsize=100)
q.put(item); item = q.get()                   # 内置锁 + 阻塞语义
```

选型口诀：**只要最大最小几个 → heapq；已有序列表动态插 → bisect；跨线程传递 → queue.Queue（自己用 list+锁是造轮子）**。

## 2. 函数式零件：functools 与 itertools

```python
from functools import cache, partial, reduce, wraps, singledispatch

@cache                              # 无限缓存（递归/纯函数）；带上限用 lru_cache(maxsize=)
def fib(n): ...

# partial：固定参数造新函数（第 4 篇闭包固定循环变量的另一种解）
int2 = partial(int, base=2)
int2("1010")                        # 10

# reduce：折叠（多数场景 sum/all/any 更直白，reduce 留给自定义结合）
total = reduce(lambda acc, x: acc + x["price"], items, 0)

# singledispatch：按第一个参数类型分派（面向对象的「重载」替代）
@singledispatch
def render(x): raise TypeError(type(x))
@render.register
def _(x: int): return str(x)
@render.register
def _(x: list): return ", ".join(map(str, x))
```

itertools 的地图在[第 6 篇](06-iterators-generators.md)；functools 的地图就这五件：**cache 记忆化、partial 偏应用、reduce 折叠、wraps 装饰器元信息、singledispatch 类型分派**。

## 3. re：正则的实用子集

```python
import re

# 核心三函数
re.findall(r"\d+", "a1 b22 c333")            # ['1', '22', '333']：全部匹配
m = re.search(r"(\w+)@(\w+\.com)", email)    # 第一个匹配（match 只锚定开头！）
if m:
    m.group(1), m.group(2)                   # 分组提取

text = re.sub(r"\s+", " ", text)             # 替换（清洗文本的主力）
parts = re.split(r"[,;]\s*", line)           # 切分

# 命名分组：可读性
m = re.search(r"(?P<year>\d{4})-(?P<month>\d{2})", date_str)
m["year"]

# 编译复用：循环里的正则先 compile（也缓存可读性）
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
DATE_RE.search(line)
```

三个高频坑：

1. **原始字符串**：正则永远写 `r"..."`——`\b`、`\d` 在普通字符串里要先过 Python 转义（`"\b"` 是退格符！）。
2. **贪婪 vs 惰性**：`<.*>` 吃到**最后一个** `>`；`<.*?>` 到第一个即止。HTML/标签类解析的翻车第一名。
3. **re 不适合嵌套结构**（HTML/JSON 用解析器）；「我有问题就用正则」与「两个问题就有两个问题」的梗有真实工程依据。

## 4. datetime：时间的类型化与时区纪律

```python
from datetime import datetime, date, timedelta, timezone

now = datetime.now(timezone.utc)             # ✅ 带时区的当前时间（aware）
naive = datetime.now()                       # ❌ 无时区（naive）——存储/比较的隐患源

deadline = now + timedelta(days=3, hours=2)  # timedelta：时长运算
(now - deadline).total_seconds()

iso = now.isoformat()                        # '2026-09-19T08:30:00.123456+00:00'：交换格式
parsed = datetime.fromisoformat(iso)         # 3.11 起几乎全格式可解析

# 转换纪律：naive ↔ aware 必须显式声明时区
dt = datetime(2026, 9, 19, 12, 0, tzinfo=timezone(timedelta(hours=8)))
utc = dt.astimezone(timezone.utc)            # 换算而不是重解释
```

时区纪律三条：**存储一律 UTC aware、展示时才转本地时区、绝不用 naive datetime 存时间戳**。历史上夏令时与本地时区造成的「时间偏移 8 小时」事故，全部源于 naive datetime 穿过存储/比较层。`time.perf_counter()` 用于测耗时（单调钟，与[第 12 篇](../cpp/12-modern-features.md)的 steady_clock 同理念），`time.time()` 才是日历时间。

## 5. logging：配置一次，处处受益

```python
import logging

# 库内：只取 logger，绝不配置（配置是应用的事）
logger = logging.getLogger(__name__)

logger.debug("详细诊断 %s", var)       # %s 惰性格式化：级别不开时零开销
logger.info("正常流程")
logger.warning("可恢复异常")
logger.error("出错 %s", path, exc_info=True)   # 带完整 traceback
logger.exception("出错")                        # 在 except 块内 = error + traceback

# 应用入口：配置一次
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
```

两个纪律：**库代码只 getLogger 不配置**（print 出身的应用无法集中管日志）；**记录用惰性 %s 而不是 f-string**（f-string 在级别被过滤时也已求值）。`logger.exception` 在 except 块里自动携带 traceback——比手工 `str(e)` 信息量大一个量级（与[第 9 篇](09-errors-exceptions.md)的异常链配合）。

## 6. subprocess：调用外部程序的安全红线

```python
import subprocess

# ✅ 列表参数：不经 shell，无注入面
result = subprocess.run(
    ["ffmpeg", "-i", "in.mp4", "out.mp3"],
    capture_output=True, text=True, timeout=60, check=True,
)
result.stdout

# ❌ shell=True + 字符串拼接 = 命令注入
subprocess.run(f"convert {user_filename} out.png", shell=True)
# user_filename = "a.png; rm -rf /" —— 一行拆了服务器
```

红线一条：**shell=True 只用于确信参数完全可控的场景**；一切含用户输入的调用走列表参数。`check=True` 让非零退出码抛 CalledProcessError（与[第 9 篇](09-errors-exceptions.md)的 EAFP 衔接）、`timeout` 防挂死、`text=True` 直接拿 str。

## 7. 并发：三层工具的选择

```python
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, as_completed

# IO 密集（网络/磁盘）：线程池（GIL 在 IO 等待时释放）
with ThreadPoolExecutor(max_workers=20) as ex:
    futures = {ex.submit(fetch, url): url for url in urls}
    for fut in as_completed(futures):
        url = futures[fut]
        try:
            data = fut.result()          # 工作线程的异常在这里重抛（第 9 篇）
        except Exception as e:
            log.error("%s failed: %s", url, e)

# CPU 密集：进程池（绕过 GIL）
with ProcessPoolExecutor() as ex:
    results = list(ex.map(crunch, chunks))

# 异步 IO：asyncio（单线程事件循环，海量连接）—— 概览
import asyncio
async def fetch_all(urls):
    async with asyncio.TaskGroup() as tg:          # 3.11 结构化并发
        tasks = [tg.create_task(fetch(u)) for u in urls]
    return [t.result() for t in tasks]
```

| 工具                  | 适用                      | 机制                     |
| --------------------- | ------------------------- | ------------------------ |
| ThreadPoolExecutor    | IO 密集并发（几十~几百）   | 线程 + GIL 让路           |
| ProcessPoolExecutor   | CPU 密集并行（核数级）     | 多进程（开销大：序列化）   |
| asyncio               | 超高并发 IO（千级连接）    | 单线程事件循环 + 协程     |

选择由**瓶颈类型**决定（CPU 还是 IO）与**并发规模**决定；「多线程加速 CPU 代码」是 GIL 下的幻觉（[第 1 篇](01-python-model.md)）。

## 8. 其他常用模块速查

| 模块            | 任务                  | 关键点                                     |
| --------------- | --------------------- | ------------------------------------------ |
| `os` / `sys`    | 系统交互 / 解释器     | 环境变量 `os.environ`、argv、exit code      |
| `shutil`        | 文件级操作            | copy/copytree/rmtree/move（跨盘兜底）       |
| `uuid`          | 唯一标识              | `uuid.uuid4()`（随机）：分布式 ID 的默认     |
| `hashlib`       | 哈希指纹              | sha256 内容寻址；**密码用 bcrypt/argon2**   |
| `random`        | 模拟随机              | `random.seed` 可复现；**安全场景用 secrets** |
| `statistics`    | 简单统计              | mean/median/stdev（不装 numpy 的兜底）      |
| `argparse`      | CLI 参数              | 声明式定义 + 自动 help                      |
| `unittest.mock` | 测试替身              | patch 的作用域与顺序（第 12 篇配合）         |
| `timeit` / `cProfile` | 基准 / 剖析      | 先 profile 后优化（第 1 篇）                |
| `urllib.request`| 简单 HTTP             | 正式场景 requests/httpx（生态库）           |
| `tempfile`      | 临时文件              | 自动命名清理，比手写 .tmp 安全              |

## 9. 陷阱清单

- groupby 不排序（[第 6 篇](06-iterators-generators.md)）与 bisect 插入无序表：有序前提要先满足。
- 正则不用 raw string：`\b` 变退格符；永远 `r"..."`。
- `.*` 贪婪吃过头：标签解析用 `.*?` 或排除字符类 `[^>]*`。
- naive datetime 存库/跨时区比较：全链路 UTC aware。
- 库代码里 `logging.basicConfig`：抢走应用的配置权；只 getLogger。
- 日志 f-string：被过滤级别也求值；惰性 %s。
- `shell=True` 拼用户输入：命令注入；列表参数。
- subprocess 不设 timeout/check：挂死与静默失败双风险。
- `random` 做令牌/密码：可预测；secrets。
- 密码直接 sha256：无盐无慢函数；bcrypt/argon2。
- CPU 任务用线程池：GIL 串行化；ProcessPoolExecutor。
- future.result() 不 try：工作线程异常在主线程爆；as_completed 循环内处理。

## 10. 小结

- 有序结构：heapq（TopK/优先级）、bisect（有序插入）、queue.Queue（线程安全）——先问操作模式再挑工具。
- functools 五件（cache/partial/reduce/wraps/singledispatch）+ itertools 是函数式零件库；singledispatch 是类型分派的轻量答案。
- re 三函数 + 命名分组覆盖文本处理；raw string、惰性量词、不解析嵌套结构是三铁律。
- datetime 的纪律：存储 UTC aware、展示才转本地、测耗时用 perf_counter。
- logging 的纪律：库只 getLogger、应用入口配置一次、惰性格式化、exception 带 traceback。
- subprocess 的红线：列表参数 + check + timeout，shell=True 只给完全可信输入。
- 并发三层按瓶颈选择：IO 线程池、CPU 进程池、海量连接 asyncio；future.result() 是异常的回收点。

## 11. 练习

**1.** 实现「合并 K 个已排序日志文件」（按时间戳归并输出）：用 heapq.merge 一行完成，再手写多路归并对拍验证，并说明「迭代器 + 堆」在这个问题里的分工。

> [!TIP]
> 思路`heapq.merge(*[iter_file(f) for f in files])`——每个文件是惰性迭代器，merge 用堆维护 K 路游标，O(N log K)。手写版练习「堆 + 迭代器」的组合；heapq.merge 内部正是这个结构。

**2.** 写一个日志分析 CLI：正则提取 ERROR 行的模块名与耗时，统计均值/最大值（statistics），支持 `--since` 时间过滤（datetime 比较）。综合 re/datetime/statistics/argparse。

> [!TIP]
> 思路`(?P<ts>\S+ \S+) (?P<level>\w+) (?P<mod>\[\w+\]) took (?P<ms>\d+)ms`；argparse 定义 --since；fromisoformat 解析后比较。这是标准库「电池组合」的典型小项目：无第三方依赖完成一个实用工具。

**3.** 把第 9 篇的 atomic_write 升级为「写临时文件 + fsync + replace + 记录日志」的完整版本，用 logging 记录每次落盘与失败，故意注入磁盘错误验证失败路径。

> [!TIP]
> 思路flush → os.fsync(fd) → Path.replace → logger.info；失败时 logger.exception + 清理 tmp。这个练习把[第 9 篇](09-errors-exceptions.md)异常、[第 10 篇](10-files-context.md)落盘、本篇 logging 三条线合到一个生产级函数里。

**4.** 用 ThreadPoolExecutor 并发下载 20 个 URL（mock 函数 sleep 模拟），统计加速比；改用 ProcessPoolExecutor 跑 CPU 密集任务（哈希大块数据）对比，验证「IO 用线程、CPU 用进程」。

> [!TIP]
> 思路IO 场景 20 线程 ≈ 15~20 倍加速（等待重叠）；CPU 场景线程池 ≈ 1 倍（GIL 串行），进程池 ≈ 核数倍。用 timeit/time 计时，实验结果直接印证[第 1 篇](01-python-model.md)的 GIL 结论。

**5.** 给第 8 篇的插件系统加「subprocess 插件」：插件声明一个外部命令，主程序以列表参数调用并解析 JSON 输出（json.loads(result.stdout)），超时与非零退出码都要有明确错误信息。

> [!TIP]
> 思路`subprocess.run([...], capture_output=True, text=True, timeout=10, check=True)` + try/except (CalledProcessError, TimeoutExpired, json.JSONDecodeError) 分支翻译成插件框架的错误类型。安全性（列表参数）、健壮性（超时/检查）、边界翻译三合一。

**6.** 讨论：一个「每秒处理 1000 个小 JSON 消息」的服务，标准库能做到什么程度？瓶颈会在哪（json 解析? 对象创建? GIL?），标准库内的优化顺序是什么，什么时候必须引第三方（orjson）?

> [!TIP]
> 思路标准库 json.loads 单条约微秒级——1000/s 完全可行；瓶颈更可能在消息分发与锁。优化顺序：批量解析、惰性字段提取（不全量 parse）、复用对象。到万级/秒才轮到 orjson（C 实现，快 3~10 倍）。「先测量、标准库优先、第三方兜底」是依赖决策的完整链条。
