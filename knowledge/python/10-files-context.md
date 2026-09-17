---
title: 文件与上下文管理器
order: 10
tags: 基础, with, pathlib
summary: with 语句与上下文协议、文本/二进制读写、pathlib 路径操作、json/csv 处理。
---

文件操作的核心一句话：永远用 with 打开文件。它背后的上下文管理协议是 Python 资源管理的通用模式；路径操作早已交给 pathlib；json/csv 是最常见的两种文件格式。这一篇把这些日行动作全部过一遍。

## with 与文件读写

```python
with open("notes.txt", encoding="utf-8") as f:
    content = f.read()       # 一次读完，大文件慎用
# 离开 with 块文件自动关闭——哪怕中途抛了异常
```

不用 with，异常一抛文件句柄就漏了；靠 `f.close()` 手动兜底既啰嗦又不可靠。with 不是可选的美化，是正确性要求。

读法按需选择：

```python
with open("big.log", encoding="utf-8") as f:
    for line in f:              # 逐行迭代，内存友好，处理大文件首选
        if "ERROR" in line:
            print(line.rstrip())    # 行尾自带 \n，打印前去掉
```

`f.read()` 全文一个字符串；`list(f)` 全部行存进列表；`f.readline()` 一次一行（配合海象运算符的用法见[控制流](03-control-flow.md)）。

写文件用 `"w"`（覆盖）或 `"a"`（追加），二进制加 `b` 后缀：

```python
with open("out.txt", "w", encoding="utf-8") as f:
    f.write("第一行\n")             # write 不自动加换行
    f.writelines(["a\n", "b\n"])

with open("logo.png", "rb") as f:
    head = f.read(8)                # 二进制读的是 bytes
```

> [!WARNING]
> 文本模式不指定 encoding 时，Windows 默认 GBK、Linux 默认 UTF-8，同一份代码跨平台就出乱码。`encoding="utf-8"` 要形成肌肉记忆；读别人的 GBK 文件则显式写 `encoding="gbk"`。

## 上下文管理器协议

with 背后是两个方法：`__enter__` 进入时调用（返回值交给 as 变量），`__exit__` 离开时调用（负责清理）：

```python
import time

class Timer:
    def __enter__(self):
        self.start = time.perf_counter()
        return self                 # as 后面拿到的就是这个返回值

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.elapsed = time.perf_counter() - self.start
        return False                # False：异常继续传播；True：吞掉异常

with Timer() as t:
    sum(i * i for i in range(10 ** 6))
print(f"耗时 {t.elapsed:.3f}s")
```

手写两个类太重，`contextlib.contextmanager` 用生成器把协议压平：

```python
from contextlib import contextmanager
import time

@contextmanager
def timer():
    start = time.perf_counter()
    try:
        yield                       # yield 之前是 __enter__，之后是 __exit__
    finally:
        print(f"耗时 {time.perf_counter() - start:.3f}s")
```

凡是「先获取、后释放」的东西——文件、锁、数据库连接、临时改目录——都值得做成上下文管理器，yield 的机制详见[迭代器与生成器](11-iterators-generators.md)。

## pathlib：路径即对象

字符串拼路径已经过时。pathlib 用对象加 `/` 运算符，跨平台自动处理分隔符：

```python
from pathlib import Path

p = Path("data") / "raw" / "a.txt"    # 用 / 拼接，别再手写 "data/raw/a.txt"

p.name        # 'a.txt'，文件名
p.stem        # 'a'，去后缀的名字
p.suffix      # '.txt'
p.parent      # data/raw
p.resolve()   # 转绝对路径
p.exists()    # 是否存在
p.is_dir()

Path("data/raw").mkdir(parents=True, exist_ok=True)   # 递归建目录，已存在不报错
```

小文件的读写连 open 都可以省：

```python
text = Path("notes.txt").read_text(encoding="utf-8")
Path("out.txt").write_text("hello", encoding="utf-8")   # 返回写入的字符数
```

目录遍历与通配：

```python
for item in Path(".").iterdir():          # 当前目录下的所有条目
    print(item)

for md in Path("docs").glob("**/*.md"):   # ** 表示递归所有子目录
    print(md)
```

注意路径对象的判断和[异常处理](09-errors-exceptions.md)里的 EAFP 风格呼应：`exists()` 之后再 open 仍有竞态，直接 try/except FileNotFoundError 更稳。

## json 与 csv

json 模块负责 Python 对象与 JSON 文本的互转：

```python
import json

data = {"name": "Ada", "tags": ["python", "rust"]}
text = json.dumps(data, ensure_ascii=False, indent=2)   # 序列化成字符串
obj = json.loads(text)                                  # 从字符串解析回来

json.dump(data, open("a.json", "w", encoding="utf-8"), ensure_ascii=False)
data2 = json.load(open("a.json", encoding="utf-8"))
```

`ensure_ascii=False` 让中文直接可读，不加会把中文转成 \u 转义。JSON 只支持 str/int/float/bool/None/list/dict，datetime 之类的对象要先转字符串再存。

csv 模块逐行处理表格文本：

```python
import csv

with open("users.csv", encoding="utf-8", newline="") as f:
    for row in csv.DictReader(f):        # 每行一个 dict，表头做键
        print(row["name"])

with open("out.csv", "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(["name", "age"])
    w.writerow(["Ada", 36])
```

> [!TIP]
> open 时的 `newline=""` 是 csv 官方文档的要求：csv 模块自己管理换行，缺了这个参数在 Windows 上会多出空行。记住读 csv 的二件套——encoding 加 newline。

## 练习

- [ ] 写一个函数统计目录下各后缀文件的个数，返回 dict（pathlib + dict 推导式）
- [ ] 用 `@contextmanager` 实现临时切换工作目录的工具：进入 chdir，退出自动还原
- [ ] 读一个 JSON 配置文件并转存为 CSV，全程显式指定 encoding

相关阅读：[异常处理](09-errors-exceptions.md)
