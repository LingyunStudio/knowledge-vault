---
title: 文件与 IO：编码是第一陷阱
order: 10
tags: open, encoding, pathlib, json, csv, struct
summary: 文本/二进制双模式与 newline 参数、显式 encoding 的纪律与跨平台事故、pathlib 的路径代数、json/csv/struct 的读写范式、大文件的流式处理，以及 atomic_write 等资源管理模式。
---

程序一半的时间在与「外面的世界」交换数据：文件、配置、序列化、网络字节流。Python 的 IO 接口简洁，但两个坑长期霸榜：**编码**（Windows 默认 GBK、Linux 默认 UTF-8——同一行代码换台机器就 UnicodeDecodeError）和**资源生命周期**（忘了 with）。本篇把文本/二进制双模式、pathlib、三大序列化格式（json/csv/struct）与流式处理一次讲清。

## 1. open 的双模式与必须显式的 encoding

```python
# 文本模式：str 进出，自动解码
with open("data.txt", "r", encoding="utf-8") as f:
    text = f.read()

# 二进制模式：bytes 进出，不碰解码
with open("img.png", "rb") as f:
    header = f.read(8)
```

| 模式  | 含义              | 模式  | 含义               |
| --- | --------------- | --- | ---------------- |
| `r` | 读（默认），文件必须存在    | `w` | 写（**清空！**），不存在则建 |
| `a` | 追加              | `x` | 排他创建（已存在则报错）     |
| `+` | 读写组合（`r+`/`w+`） | `b` | 二进制（与任意模式组合）     |

### 1.1 encoding 纪律

```python
open("f.txt", "r")                       # ❌ encoding 缺省 = locale 决定：
                                         #    Windows 上常是 cp936(gbk)，Linux 是 utf-8
open("f.txt", "r", encoding="utf-8")     # ✅ 同一段代码在所有平台行为一致
```

规则只有一条：**文本模式永远显式 encoding**（PEP 597 甚至提供了 `-X warn_default_encoding` 让缺省行为报警）。跨平台数据交换统一 UTF-8；处理历史遗留 GBK 文件时**显式声明 `encoding="gbk"`**——「声明事实」而不是「指望平台巧合」。

```python
# errors 参数：坏字节的处理策略
open("f", encoding="utf-8", errors="strict")      # 默认：抛 UnicodeDecodeError
open("f", encoding="utf-8", errors="replace")     # 坏字节 → U+FFFD（日志清洗常用）
open("f", encoding="utf-8", errors="ignore")      # 丢弃坏字节（会静默丢数据，慎用）
```

### 1.2 newline：换行符的暗流

```python
open("f", "r", newline="")            # 不做换行翻译：拿到原始的 \r\n
open("f", "r")                        # 默认：\r\n/\r 都翻译成 \n（universal newlines）
open("f", "w", newline="\n")          # 写入不翻译：CSV 模块强烈要求这个（否则 Windows 上多空行）
```

默认的「通用换行」对大多数场景友好，但**按字节比较文件、CSV 模块、二进制协议**场景必须控制 newline。CSV 的 `open(..., newline="")` 是官方文档明文要求，忘了它会产生 `"\r\r\n"` 级别的怪数据。

## 2. pathlib：路径的对象化

```python
from pathlib import Path

p = Path("data") / "raw" / "2024.csv"      # / 运算符拼路径：跨平台分隔符
p.name            # '2024.csv'
p.stem            # '2024'
p.suffix          # '.csv'
p.parent          # data/raw
p.parent.parent   # data

p.exists(); p.is_file(); p.is_dir()
p.resolve()       # 绝对路径 + 符号链接解析
list(Path("logs").glob("*.log"))           # glob 模式查找
list(Path("logs").rglob("*.log"))          # 递归 glob

p.read_text(encoding="utf-8")              # 小文件一步读写
p.write_text("hello", encoding="utf-8")
p.read_bytes()
p.mkdir(parents=True, exist_ok=True)       # 建目录（两级参数都要记）
```

pathlib 取代 `os.path` 的理由：路径是**对象**（方法即操作、/ 拼接可读）、与 `open`/`glob`/`shutil` 全生态兼容。两族 API 对照：`os.path.join(a, b)` → `Path(a) / b`；`os.path.splitext(p)` → `Path(p).stem/.suffix`。遗留代码里的 os.path 要能读懂，新代码用 pathlib。

## 3. 序列化三剑客：json、csv、struct

### 3.1 json：配置与数据交换的默认格式

```python
import json

data = {"name": "alice", "tags": ["admin"], "score": 91.5}
s = json.dumps(data, ensure_ascii=False, indent=2)     # 序列化（ensure_ascii=False 保留中文）
obj = json.loads(s)                                     # 反序列化

with open("cfg.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)    # 文件版（dumps→字符串，dump→文件）

# 类型对应与陷阱：
# Python dict/list/str/int/float/bool/None ←→ JSON object/array/string/number/bool/null
# tuple → array（读回来变 list！）；set/int64键 → 不支持，需转换
# NaN/Infinity 默认可写（非标准 JSON）；strict=False 才允许
```

json 的工程要点：**编码永远 UTF-8 + ensure\_ascii=False**（默认 True 会把中文转义成 \u 序列，文件不可读但合法）；JSON 的键必须是字符串（int 键序列化时被转成字符串，读回来类型变了）；配置文件解析失败的错误处理用 `json.JSONDecodeError`（[第 9 篇](09-errors-exceptions.md)）。

### 3.2 csv：表格数据的守门员

```python
import csv

with open("rows.csv", "w", newline="", encoding="utf-8") as f:   # newline="" 是官方要求！
    w = csv.writer(f)
    w.writerow(["name", "score"])
    w.writerows([["alice", 90], ["bob", 85]])

with open("rows.csv", newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):          # 用表头做键：row["name"]
        print(row)
```

手写 `",".join()` 处理 CSV 的失败模式：值里含逗号/引号/换行——csv 模块处理全部 RFC 规则。大数据集用 DictReader 流式逐行（[第 6 篇](06-iterators-generators.md)的惰性原则）；复杂表格（多表头、合并单元格）才轮到 pandas。

### 3.3 struct：二进制协议的字节级打包

```python
import struct

# 网络包：| type(1B) | seq(2B 大端) | len(2B 大端) |
header = struct.pack(">BHH", 1, 42, 7)       # '>BHH'：大端 + uint8 + uint16 + uint16
type_, seq, length = struct.unpack(">BHH", header[:5])

with open("data.bin", "rb") as f:
    magic = f.read(4)
    count, = struct.unpack("<I", f.read(4))   # 小端 uint32；尾随逗号解包出单个值
```

struct 的格式串是字节级契约：`>`/`<` 定字节序（网络协议大端、x86 小端）、字符定类型与宽度（[C 篇第 8 篇](../c/08-structs-unions.md)的「布局即契约」在 Python 的对应物）。解析不可信输入时**先验证长度再 unpack**（struct.error 或读不到位）。

pickle 是 Python 私有的对象序列化（能存任意对象图）——**绝不用它处理不可信来源的数据**（反序列化即代码执行）。跨语言/跨版本数据一律 json/msgpack，只有「Python 自己的缓存」才考虑 pickle。

## 4. 大文件与流式处理

```python
# ❌ 全量读：内存 = 文件大小 × 2~3（str 对象开销）
text = open("huge.log", encoding="utf-8").read()

# ✅ 逐行迭代：文件对象本身是惰性迭代器（O(1) 内存）
with open("huge.log", encoding="utf-8") as f:
    for line in f:
        process(line)

# ✅ 定长块：二进制/非行结构数据
with open("huge.bin", "rb") as f:
    while chunk := f.read(1024 * 1024):        # 1 MB 一块
        process(chunk)

# ✅ 大文件随机访问：seek/tell（二进制模式以字节计）
with open("data.bin", "rb") as f:
    f.seek(1024)            # 跳到 1024 字节处
    f.read(16)
    pos = f.tell()          # 当前位置
```

行迭代、分块读与生成器流水线（[第 6 篇](06-iterators-generators.md)）是同一套思想：**任何时刻只让「一个处理单元」占用内存**。`readlines()` 一次返回全部行——名字里的 s 让它看起来无害，实际是全量加载，大文件禁用。

## 5. 资源管理模式

```python
# 多资源 with：括号内逗号分隔（3.1+），逆序关闭
with open(src, "rb") as fin, open(dst, "wb") as fout:
    shutil.copyfileobj(fin, fout)

# 原子写（第 9 篇的模板落地）：写临时 + 原子改名，崩溃不留半个文件
from pathlib import Path
def atomic_write(path: Path, data: str):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(data, encoding="utf-8")
    tmp.replace(path)                      # 同文件系统内 rename 是原子的
```

文件系统的三个工程事实：**rename 在同一分区内原子**（数据落盘的标准做法——直接写目标文件，进程被杀就留下半个文件）；**写完要考虑 flush**（`f.flush()` + `os.fsync(f.fileno())` 才真正到盘，关键数据才需要）；**临时文件用 tempfile 模块**（自动命名、自动清理）。

## 6. 陷阱清单

- open 不写 encoding：跨平台编码漂移；永远显式 utf-8（或声明真实的遗留编码）。
- `open("f", "w")` 覆盖已有文件不自知：w 即清空；追加用 a、防覆盖用 x。
- csv 不加 `newline=""`：Windows 写出 \r\r\n；官方要求背下来。
- 手拼 CSV 字符串：逗号/引号/换行全部翻车；csv 模块。
- json.dumps 默认 ensure\_ascii=True：中文变 \u 转义；False + utf-8。
- pickle 反序列化不可信数据：任意代码执行；交换格式用 json。
- readlines()/read() 处理大文件：全量进内存；逐行/分块/生成器。
- struct.unpack 前不验长度：不可信输入直接崩；先 len 检查。
- 忘记 with 或半途 return 依赖 finally：文件句柄泄漏（Windows 上锁文件）；with 全覆盖。
- Path 与 str 混拼：TypeError；统一 pathlib 后再进 open。
- 写关键文件不留后路：原子写（tmp + replace）。

## 7. 小结

- open 双模式：文本（str + 编码）与二进制（bytes）；encoding 永远显式、newline 按需控制（CSV 的 newline="" 是官方要求）。
- pathlib 用对象与 `/` 运算统一路径操作；name/stem/suffix/glob 覆盖日常九成需求，遗留 os.path 要能读。
- json（ensure\_ascii=False + utf-8）、csv（模块守 RFC、DictReader 流式）、struct（字节级契约，先验长度）覆盖三类序列化；pickle 只信任自己的进程。
- 大文件的唯一正确姿势是流式：行迭代、定长块、生成器流水线；readlines 是全量加载的伪装。
- 资源管理：with 全覆盖、原子写（tmp+replace）保证崩溃安全、关键数据 flush+fsync。

## 8. 练习

**1.** 构造一个 GBK 编码文件，分别在 `encoding="utf-8"`（strict/replace/ignore）、`encoding="gbk"` 下读取，记录四种结果——总结 errors 参数的适用边界。

> [!TIP]
> 思路strict 抛 UnicodeDecodeError；replace 得 U+FFFD（能继续但内容受损）；ignore 丢字节；gbk 正确。errors 是「降级阅读」工具（日志排查），不是「修编码」工具——知道真实编码就声明真实编码。

**2.** 用 pathlib 实现日志轮转清理：`logs/` 下超过 7 天的 `.log` 文件移到 `logs/archive/`（目录不存在则创建），打印移动清单。要求全 pathlib、无字符串路径拼接。

> [!TIP]
> 思路`p.stat().st_mtime` + time.time() 比较；`p.rename(archive / p.name)`；mkdir(parents=True, exist\_ok=True)。考点：rglob 过滤、Path 的 rename 语义（跨盘会失败——讨论 shutil.move 的兜底）。

**3.** 实现一个「配置读写」模块：JSON 格式、原子写、损坏文件时返回默认配置并备份坏文件。综合第 9 篇异常翻译与本章原子写。

> [!TIP]
> 思路try: json.loads(read\_text) except JSONDecodeError → rename 成 .corrupt 返回默认；写用 tmp+replace。「备份坏文件」让排查成为可能——配置系统的可靠性一半在损坏路径。

**4.** 解析一个二进制格式（自定义：magic "MYPK" + uint32 计数 + N 条 `uint16 长度 + utf-8 字符串`），实现读取与写入函数，全部带边界校验。

> [!TIP]
> 思路struct ">I" 读计数 → 循环 ">H" 读长度 → read(len) 解 utf-8。校验：magic 匹配、count 合理上限（防恶意值吃内存）、read 返回长度核对。这是 struct + 流式 + 防御校验的综合体。

**5.** 把 1 GB CSV 的「按列求和」写成流式版本（csv.DictReader + 累加），与 pandas.read\_csv 全量版对比内存（任务管理器/times 工具），说明两者的适用分界。

> [!TIP]
> 思路流式版 O(1) 内存、慢但稳；pandas 版全量内存换向量化速度。分界线在「单机内存能否装下 + 是否需要复杂列运算」——能装下且要算力用 pandas，装不下或只要简单聚合用流式。

**6.** 讨论：为什么「写文件先 f.write 再 f.close」在脚本里经常「碰巧正确」，在服务里经常丢数据？从缓冲与 fsync 的角度给出关键数据的落盘流程。

> [!TIP]
> 思路CPython 的 with/引用计数让 close 尽早发生（flush 随之），脚本正常退出「碰巧」不丢；但进程崩溃/断电时，OS 页缓存里的数据未落盘。关键流程：write → flush → os.fsync(fd) →（可选）rename 原子提交。可靠性等级（能重算 vs 不可丢）决定要不要 fsync。
