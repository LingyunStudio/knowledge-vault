---
title: 常用标准库
order: 12
tags: 进阶, 标准库, collections
summary: collections/functools/datetime/logging/argparse：电池自带的五件日用工具。
---

「batteries included」是 Python 的立身之本：不装任何第三方包，标准库已覆盖八成日常需求。这一篇挑五件出场率最高的工具，每个只讲最常用的那一层——够用，且知道去哪查剩下的。

## collections：容器增强包

```python
from collections import Counter, defaultdict, deque, namedtuple

print(Counter("mississippi").most_common(2))
# [('i', 4), ('s', 4)]：计数、取 Top N 一次完成

grouped = defaultdict(list)        # 键不存在时自动创建空列表
for name, dept in [("Ada", "dev"), ("Bob", "ops"), ("Cara", "dev")]:
    grouped[dept].append(name)     # 不用先判断键在不在
# {'dev': ['Ada', 'Cara'], 'ops': ['Bob']}

dq = deque([1, 2, 3], maxlen=5)    # 双端队列，maxlen 定长自动淘汰旧元素
dq.appendleft(0)                   # 两端增删 O(1)；list 的 insert(0, x) 是 O(n)
dq.popleft()

Point = namedtuple("Point", ["x", "y"])
p = Point(1, 2)
print(p.x)                         # 带名字的字段，比裸元组可读
```

Counter 统计频次、defaultdict 分组、deque 做 FIFO 队列——这三个几乎天天见。注意它们都在[内置数据结构](05-data-structures.md)的语义之上工作，dict 的规则对 defaultdict 依然成立。

## functools：函数工具包

```python
from functools import lru_cache, partial, reduce

@lru_cache(maxsize=None)           # 3.9+ 也可以直接写 @cache，两者等价
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)
# 朴素递归 fib 是指数级，加一行装饰器变成线性

int2 = partial(int, base=2)        # 固定部分参数，派生出专用函数
print(int2("1010"))                # 10

print(reduce(lambda a, b: a * b, range(1, 6), 1))   # 120
```

> [!NOTE]
> lru_cache 按参数（必须可哈希）缓存返回值，并持有参数引用。适合频繁调用、参数组合有限的纯函数；参数是每次都不同的大对象（比如整页 HTML）会撑爆缓存，别用。

## datetime：时间处理

```python
from datetime import datetime, date, timedelta

now = datetime.now()
today = date.today()

now.strftime("%Y-%m-%d %H:%M")     # 格式化：'2026-09-13 14:30'
dt = datetime.strptime("2026-09-13", "%Y-%m-%d")   # 解析，格式必须严格对应

deadline = dt + timedelta(days=7)              # 时间加减用 timedelta
delta = datetime(2026, 12, 31) - dt            # 两个 datetime 相减得 timedelta
print(delta.days)                              # 109
```

`strftime` 格式化输出、`strptime` 按格式解析，方向容易记反：**f = format，p = parse**。

> [!WARNING]
> `datetime.now()` 是 naive 时间——不带时区信息。涉及跨时区或入库持久化的时间，一律用 `datetime.now(timezone.utc)` 这类 aware 对象，否则部署到另一个时区，数据就对不上账了。

## logging：像样的日志

print 调试一时爽，但无法分级、无法关闭、没有时间戳。logging 十行配置全解决：

```python
import logging

logging.basicConfig(
    level=logging.INFO,              # 低于 INFO 的（如 DEBUG）不输出
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger(__name__)    # 每个模块一个，用模块名做 logger 名

log.debug("细节信息，默认不输出")
log.info("正常流程")
log.warning("有点不对劲")
log.error("请求失败：%s", url)       # 延迟格式化：不输出时不做字符串拼接
```

级别从低到高：DEBUG < INFO < WARNING < ERROR < CRITICAL。一条分界铁律：**库代码只 getLogger 不 basicConfig**，配置权留给最终应用，否则库一被导入就霸占全局日志配置。

## argparse：命令行参数

```python
import argparse

parser = argparse.ArgumentParser(description="文件搜索工具")
parser.add_argument("path", help="要搜索的目录")                  # 位置参数
parser.add_argument("-n", "--name", default="*", help="文件名模式")
parser.add_argument("--max-depth", type=int, default=3)           # 自动转 int
parser.add_argument("-v", "--verbose", action="store_true")       # 布尔开关
args = parser.parse_args()

print(args.path, args.name, args.max_depth, args.verbose)
```

```bash
python search.py ./src -n "*.py" -v
# args.path='./src', args.name='*.py', args.max_depth=3, args.verbose=True
```

自动获得 `--help`、类型转换与参数校验。脚本一超过 30 行，就值得用它替代手工解析 `sys.argv`。

## 练习

- [ ] 用 Counter 统计一段英文的词频，打印 Top 10（记得先统一小写再切分）
- [ ] 给朴素递归 fib 分别加上 `@lru_cache` 与不加，用 `time.perf_counter` 对比 fib(30) 的耗时
- [ ] 给前一篇的日志筛选器加 argparse：位置参数收日志路径，`--level` 指定要筛的级别

相关阅读：[函数进阶与装饰器](06-functions-advanced.md)
