---
title: 字符串：从内存表示到模式匹配
order: 15
tags: 字符串, Unicode, UTF-8, KMP, 模式匹配
summary: 从字符集与编码的三层歧义讲起，串起不可变设计的收益与代价、三种内存表示、KMP/Rabin-Karp/Boyer-Moore 的完整推导与实测对比，以及常用操作与 Unicode 规范化的真实代价。
---

字符串是大多数程序中出现频率最高的数据，也是「看起来最简单、实际最深」的一个：它的内容给人看，存储却是字节，中间隔着 Unicode 的三层抽象；它对外表现为「一个整体」，内存里却藏着 NUL 结尾、长度前缀、小字符串优化三种截然不同的表示。找一个子串，朴素算法 O(n·m)，KMP 用 O(n+m)，Boyer-Moore 在真实文本上甚至只看文本的一小部分——但工业标准库几乎不用其中任何一个教科书版本。这一篇把三件事拆开讲透：怎么表示（编码、可变性、内存布局），怎么匹配（四个算法各自的取舍），怎么用（每个常见操作背后的真实代价）。本文所有 Python 实测在 Python 3.13.3 / Windows x64 上运行，绝对数值会随机器变化，但比例关系是稳定的。

## 1. 字符集与编码：字符串的第一层

### 1.1 码点、编码单元与字素簇：三个必须分开的概念

「一个字符」在日常语言里只有一层，在 Unicode 里是三层：

| 概念 | 英文 | 定义 | 例子 |
| --- | --- | --- | --- |
| 码点 | code point | Unicode 给每个字符分配的编号，范围 U+0000 到 U+10FFFF | 「中」是 U+4E2D |
| 编码单元 | code unit | 具体编码方案里的最小存储单位：UTF-8 是 1 字节，UTF-16 是 2 字节，UTF-32 是 4 字节 | 「中」在 UTF-8 里占 3 个编码单元 |
| 字素簇 | grapheme cluster | 用户眼中「一个字符」，可能由多个码点组合而成 | e + 组合尖音符 = 人眼的一个 é |

它们之间的包含关系是不对齐的，这正是所有字符串 bug 的源头：

```text
心智模型：码点是「编号」，编码是「编号的写法」，字素是「人眼看到的字符」。
  一个字素可能占多个码点（组合序列：e + U+0301）；
  一个码点可能占多个编码单元（UTF-8 变长、UTF-16 代理对）；
  一个编码单元占多个字节（UTF-16/UTF-32 的多字节与字节序）。
  三层各管一层，把任何两层混着用都会出 bug。
```

ASCII 只覆盖 128 个码点，Latin-1（ISO-8859-1）扩展到 256 个——每码点恰好 1 字节，西欧文字够用，中文日文韩文完全放不下。Unicode 把全集扩到 1114112 个码点，于是「编号」和「字节」再也不能画等号，编码方案这个层才被迫登场。

### 1.2 五种编码与 UTF-8 的变长规则

同一个字符在各编码下的字节数（实测）：

```python
for ch in ["A", "é", "中", chr(0x1F600), chr(0x20000)]:
    u8 = ch.encode("utf-8")
    try:
        l1 = f"{len(ch.encode('latin-1'))} B"
    except UnicodeEncodeError:
        l1 = "无法表示"
    print(f"U+{ord(ch):05X}: len={len(ch)}  latin-1={l1:8s}"
          f"  utf-8={len(u8)} B {u8.hex(' '):12s}"
          f"  utf-16-le={len(ch.encode('utf-16-le'))} B"
          f"  utf-32-le=4 B")
```

```text
U+00041: len=1  latin-1=1 B       utf-8=1 B 41           utf-16-le=2 B  utf-32-le=4 B
U+000E9: len=1  latin-1=1 B       utf-8=2 B c3 a9        utf-16-le=2 B  utf-32-le=4 B
U+04E2D: len=1  latin-1=无法表示   utf-8=3 B e4 b8 ad     utf-16-le=2 B  utf-32-le=4 B
U+1F600: len=1  latin-1=无法表示   utf-8=4 B f0 9f 98 80  utf-16-le=4 B  utf-32-le=4 B
U+20000: len=1  latin-1=无法表示   utf-8=4 B f0 a0 80 80  utf-16-le=4 B  utf-32-le=4 B
```

UTF-8 是变长的，规则只有一张表：

| 码点范围 | 字节数 | 首字节模板 |
| --- | --- | --- |
| U+0000..U+007F | 1 | 0xxxxxxx |
| U+0080..U+07FF | 2 | 110xxxxx 10xxxxxx |
| U+0800..U+FFFF | 3 | 1110xxxx 10xxxxxx 10xxxxxx |
| U+10000..U+10FFFF | 4 | 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx |

「一个汉字 3 字节」的由来就藏在这张表里：常用汉字集中在 CJK 统一表意文字基本区 U+4E00..U+9FFF，整体落在 U+0800..U+FFFF 区间，恰好命中 3 字节模板。手工编码验证一遍（这段位运算可以照抄进任何语言）：

```python
cp = ord("中")                                # U+4E2D = 0b0100_1110_0010_1101
b1 = 0b1110_0000 | (cp >> 12)                 # 1110xxxx：高 4 位
b2 = 0b1000_0000 | ((cp >> 6) & 0b11_1111)    # 10xxxxxx：中间 6 位
b3 = 0b1000_0000 | (cp & 0b11_1111)           # 10xxxxxx：低 6 位
hand = bytes([b1, b2, b3])
print(hand.hex(" "), hand == "中".encode("utf-8"))
```

```text
e4 b8 ad True
```

UTF-8 赢得生态位不是偶然，它同时拿到了四个性质：ASCII 完全向后兼容（纯英文文本逐字节相同）；没有字节序问题（以字节为单位，天然可流式处理）；自同步（任意字节落在 10xxxxxx 都能立刻知道「我在字符中间」，从任意损坏点恢复只需丢一个字符）；无 NUL 字节（0x00 只编码 U+0000，C 字符串函数可以安全处理它）。UTF-16 是历史产物——Java、Windows、JavaScript 的字符串层定型于「16 位够用」的年代，码点超出 BMP 后被迫引入代理对（见 1.4 节）；它的体积优势只在大 CJK 文本上偶尔出现。UTF-32 用空间换「码点即下标」的 O(1) 随机访问，实际使用很少。

### 1.3 「字符串长度」在 Unicode 下是有歧义的

「这个字符串多长」有三种答案，实测（Python 3.13，`len()` 数码点）：

```python
import unicodedata

def graphemes(s):
    """极简字素切分：组合标记粘到前一簇，ZWJ 把下一个字符粘进来。"""
    out, cur, zwj = [], "", False
    for ch in s:
        o = ord(ch)
        if not cur:
            cur = ch
        elif zwj:                                   # 上一字符是 ZWJ：强制粘连
            cur += ch
        elif (unicodedata.category(ch).startswith("M")
              or o == 0xFE0F or o == 0x200D
              or 0x1F3FB <= o <= 0x1F3FF):
            cur += ch                               # 组合标记/ZWJ/变体选择符/肤色修饰符
        else:
            out.append(cur)
            cur = ch
        zwj = (o == 0x200D)
    if cur:
        out.append(cur)
    return out

fam = "\U0001F468\u200D\U0001F469\u200D\U0001F467"   # 男人+女人+女孩，用 ZWJ 连接
for s, name in [("é", "é(NFC)"), ("e\u0301", "é(NFD)"), (fam, "家庭 emoji")]:
    print(f"{name}: len(码点)={len(s)}  字素簇={len(graphemes(s))}"
          f"  UTF-8={len(s.encode('utf-8'))} 字节")
```

```text
é(NFC): len(码点)=1  字素簇=1  UTF-8=2 字节
é(NFD): len(码点)=2  字素簇=1  UTF-8=3 字节
家庭 emoji: len(码点)=5  字素簇=1  UTF-8=18 字节
```

最后一条值得盯着看：那个「三人家庭」emoji 在人眼里是 1 个字符，Python 的 `len()` 说是 5，UTF-8 字节是 18。它由 3 个码点加 2 个零宽连接符（ZWJ，U+200D）组成。工程后果立即可见：

- 文本框「最多输入 20 个字符」的校验：按 `len()` 实现，用户输入一个家庭 emoji 就扣掉 5 个额度；
- 数据库 `VARCHAR(20)` 与 UI 限长的口径不一致，同一份数据在两层各超一次；
- 终端/日志按 `len()` 对齐，含 emoji 的行全部错位（`len()` 与显示宽度是两回事，wcwidth 类库专门处理这个）。

Python 的 `len()` 数码点，Java 的 `length()` 数 UTF-16 编码单元，Go 的 `len()` 数字节——同一个问题，三种语言的「正确答案」互不相同。处理用户生成内容（UGC）时，先想清楚你说的「长度」是哪一层，再写代码。

### 1.4 UTF-16 与代理对：为什么 Java 的 char 不是字符

UTF-16 用 2 字节编码单元表示码点，但码点最多到 U+10FFFF，2 字节只有 65536 种组合。Java 诞生时（1995）Unicode 还是 16 位，后来扩容了，UTF-16 的补救办法是**代理对（surrogate pair）**：把 U+D800..U+DFFF 这 2048 个编码位保留不对应任何字符，用「高代理 + 低代理」两个编码单元合成一个 U+10000 以上的码点：

```text
U+1F600 = 高代理 D83D + 低代理 DE00
还原公式：cp = 0x10000 + (hi - 0xD800) * 0x400 + (lo - 0xDC00)
```

```python
hi, lo = 0xD83D, 0xDE00
cp = 0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)
print(hex(cp), chr(cp) == chr(0x1F600))       # 0x1f600 True
try:
    chr(0xD83D).encode("utf-8")
except UnicodeEncodeError as e:
    print("孤立代理项不是合法字符:", e.reason)   # surrogates not allowed
```

```text
0x1f600 True
孤立代理项不是合法字符: surrogates not allowed
```

Java 的 `char` 是 16 位，即一个 UTF-16 编码单元，不是一个字符。`"😀".length()` 返回 2（两个代理项），`charAt(1)` 返回一个孤立的低代理项——打印出来通常是问号。要数「人看到的字符数」得用 `codePointCount(0, length())`，而那依然不是字素数。Python 内部不用 UTF-16 所以没有这个问题（`len(chr(0x1F600)) == 1`），但 CPython 的 str 按内容选用 1/2/4 字节的紧凑码元存储，实测 100 个字符的内存占用：`"a"*100` 占 141 B（每码点 1 字节），`"中"*100` 占 258 B（每码点 2 字节），emoji 串占 460 B（每码点 4 字节）。

> [!WARNING]
> 孤立代理项能存在于 Java/JavaScript 字符串和许多二进制协议里，但不是合法的 Unicode 码点。把它 `encode("utf-8")` 会直接抛异常（Python）、产生 U+FFFD（容错模式）或写出非法字节流（某些语言静默通过）。处理「来自外部、不可信」的文本，解码时显式决定错误策略（`errors="replace"` 或 `"strict"`），不要让脏数据流进下游。

## 2. 不可变还是可变：字符串的第一设计决策

### 2.1 不可变买到了什么

Python str、Java String、Rust &str、Go string、C++ `std::string_view` 都选择了不可变（immutable）：对象一旦创建，内容永不改变。这是一笔划算的交易，收益全部来自同一个不变式：

```text
不变式：内容不变 ⇒ 一切基于「当前内容」的结论永远有效。
  ① 哈希值可以缓存在对象里，算一次终身使用——dict 用字符串做键
     不必每次查找都重算哈希（见 [第 06 篇](06-hash-table.md) 的 SipHash 与键的契约）。
  ② 同一份数据可以无拷贝地到处传递、并发读，不需要锁。
  ③ 子串/视图可以共享底层字节（Rust &str、Go string 的切片是 O(1) 视图）。
  ④ 「相等」可以逐步降级为「指针相等」做快速路径（驻留 intern）。
```

代价同样明确：任何「修改」都是创建新对象。`s.replace(...)`、`s.strip()`、`s + t` 都要完整分配一份新串。最典型的是循环拼接，见下一节。

### 2.2 实测：`+=` 循环 vs `join` vs `StringIO`

不可变字符串的拼接，教科书结论是 O(n²)：每次 `s + p` 都要分配新串并复制旧串的全部内容。但 CPython 有一个著名的实现细节：`+=` 语句在左操作数**引用计数恰好为 1** 时，会尝试原地扩容（realloc 不搬家），把二次方行为抹成近似线性。这个细节 fragility 极高——只要存在第二个引用就失效：

```python
import timeit, io

def make(n):
    return [str(i % 10) for i in range(n)]      # 10 万片，每片 1 字符

def plus_op(pieces):
    s = ""
    for p in pieces:
        s += p                   # CPython 特例：引用计数为 1 时原地扩容
    return s

def plus_forced_copy(pieces):
    s = ""
    holder = [s]
    for p in pieces:
        holder[0] = s            # 制造第二个引用 -> 禁用原地扩容
        s += p
    return s

def with_join(pieces):
    return "".join(pieces)       # 先算总长，一次分配

def with_stringio(pieces):
    buf = io.StringIO()
    write = buf.write
    for p in pieces:
        write(p)
    return buf.getvalue()

pieces = make(100_000)
for name, f in [("s += p（优化生效）", plus_op),
                ("s += p（第二个引用存在）", plus_forced_copy),
                ('"".join', with_join),
                ("StringIO.write", with_stringio)]:
    t = min(timeit.repeat(lambda: f(pieces), number=1, repeat=5))
    print(f"{name:24s} {t*1000:9.2f} ms")
```

```text
s += p（优化生效）              5.65 ms
s += p（第二个引用存在）      113.48 ms
"".join                        0.47 ms
StringIO.write                 2.06 ms
```

差异不在算法上，而在**保证**上：

- `"".join` 是语言规范层面的线性：先把所有片段的总长度算出来，一次分配、一次拷贝。0.47 ms，无论解释器版本、无论字符串有没有别的引用。
- `s += p` 的线性来自 CPython 的引用计数优化，是**实现细节不是语言保证**：字符串被另一个变量、容器、闭包、`self.x` 引用，或换 PyPy/JIT，二次方行为立刻回来。给 `plus_forced_copy` 做规模实验，n = 25k/50k/100k 时耗时 8.6/30.0/114.1 ms——每次翻倍耗时接近乘 4，教科书里的 O(n²) 就是这样长出来的。
- [第 01 篇](01-complexity-analysis.md) 7.2 节的警告正是这一条：「规范做法永远是 `"".join(pieces)`」。

`bytearray` 是 Python 里的可变序列（内容可原地修改，但不存「字符」，存字节），`io.StringIO` 则提供带写指针的可积累文本缓冲。需要频繁修改超大文本时，可变缓冲（`bytearray`/`StringIO`/C 层的 `char*`）比反复构造新 str 便宜一个量级。

## 3. 内存表示的三种方式

### 3.1 NUL 结尾：C 字符串

C 语言把字符串定义为「以 `'\0'` 结尾的字符数组」。这个设计在 1970 年代是合理的——内存以字节计，一个结尾标记零成本。它的三个结构性缺陷也由此而来：

1. **不能存 `\0`**。内容里出现 0x00 就等于提前结束。文本无所谓，二进制数据（图片、加密块、protobuf 帧）无法用 C 字符串承载，必须另外传长度参数。
2. **`strlen` 是 O(n)**。长度没有被存储，只能从头扫描到 NUL。把 `strlen(s)` 写进循环条件，就把 O(n) 放大成 O(n²)。
3. **缓冲区溢出**。NUL 结尾只告诉你「到哪结束」，不告诉你「能写多长」。`strcpy`、`strcat`、`gets` 都不知道目标缓冲区有多大，写超了就踩掉栈上相邻的内存——返回地址被覆盖，程序被劫持。这是几十年来安全漏洞最大的单一来源，也直接催生了 `strncpy`、`snprintf`、ASLR、栈保护这一整条防御技术线。

### 3.2 长度前缀：Pascal、std::string、Go、Redis SDS

另一种思路：把长度作为元数据显式存下来。Pascal 的短字符串用首字节存长度（上限 255）；现代实现演化为「长度 + 容量 + 数据指针」的结构。长度前缀一箭三雕：

- **O(1) 求长度**：读一个字段；
- **二进制安全（binary safe）**：内容里可以有 `\0`，长度不看 NUL；
- **边界可知**：容量字段让追加操作能在写入前检查并扩容，溢出类漏洞在结构上被消除。

Go string 是「(指针， 字节长度)」的极简版，不可变，切片 `s[i:j]` 是 O(1) 的新视图（共享底层字节，不拷贝）。Redis 的 SDS（Simple Dynamic Strings）是长度前缀设计的代表作：头部长度、已分配容量加一个 flags 字节选择头部大小（省内存），`buf` 尾部仍保留一个 NUL 用于兼容 C 工具，但语义完全由 `len` 决定。

### 3.3 小字符串优化（SSO）

C++ `std::string` 走了第三条路：对象本身留出一块内联缓冲，短字符串直接存在栈上的对象里，不碰堆。libstdc++ 的实现里 `sizeof(std::string) == 32` 字节，15 字节以内的字符串内联存储；libc++ 对象 24 字节，可内联 22 字节。收益是巨大的：绝大多数字符串（标识符、键名、URL 片段）都很短，SSO 让它们零堆分配、零间接寻址，缓存命中率高。代价是 `std::string` 对象很重（搬移虽便宜但拷贝不再只是拷指针），以及换实现时内联阈值不同——跨库传递 `const char*` 与 `data()` 的生命周期约定反而更微妙。

### 3.4 手写一个长度前缀字符串

下面是一个 SDS 风格的最小实现，把「长度 + 容量 + 数据」的所有设计点落实成代码（gcc 5.3，`-std=c11` 编译通过）：

```c
/* sds.c -- 手写一个 Redis SDS 风格的字符串：长度 + 容量 + 数据 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    size_t len;      /* 已用字节数：O(1) 求长度 */
    size_t cap;      /* 已分配容量（不含结尾保留的 NUL） */
    char   buf[];    /* 柔性数组，数据紧跟在结构体后面 */
} Sds;

static Sds *sds_new(const char *init, size_t n) {
    Sds *s = malloc(sizeof(Sds) + n + 1);   /* +1：始终保留一个 NUL，方便调试打印 */
    if (!s) return NULL;
    s->len = n;
    s->cap = n;
    memcpy(s->buf, init, n);
    s->buf[n] = '\0';
    return s;
}

/* 注意：data 不得与 s->buf 指向同一块内存（realloc 可能整体搬家） */
static Sds *sds_append(Sds *s, const void *data, size_t n, int *reallocs) {
    if (s->len + n > s->cap) {              /* 扩容：与动态数组同一套摊还策略 */
        size_t newcap = s->cap < 8 ? 8 : s->cap * 2;
        while (newcap < s->len + n) newcap *= 2;
        Sds *t = realloc(s, sizeof(Sds) + newcap + 1);
        if (!t) return NULL;
        s = t;
        s->cap = newcap;
        if (reallocs) (*reallocs)++;
    }
    memcpy(s->buf + s->len, data, n);
    s->len += n;
    s->buf[s->len] = '\0';                  /* NUL 只是兼容 C 工具，不是内容边界 */
    return s;
}

int main(void) {
    /* 1. 二进制安全：内容可以出现 NUL，长度来自 len 字段而不是扫描 */
    char payload[] = {'a', 'b', '\0', 'c', 'd'};      /* 5 个字节，中间有 NUL */
    Sds *s = sds_new(payload, 5);
    printf("sds len = %lu, strlen(buf) = %lu\n",
           (unsigned long)s->len, (unsigned long)strlen(s->buf));
    /* 输出 len=5, strlen=2：NUL 结尾约定把数据截断了 */

    /* 2. 追加的摊还 O(1)：1M 次单字节追加只发生 21 次 realloc 量级 */
    int reallocs = 0;
    Sds *big = sds_new("", 0);
    const char one = 'y';
    for (int i = 0; i < 1000000; i++) {
        Sds *t = sds_append(big, &one, 1, &reallocs);
        if (!t) { fprintf(stderr, "OOM\n"); return 1; }
        big = t;                        /* 必须接住返回值：realloc 可能整体搬家 */
    }
    printf("big len = %lu, cap = %lu, realloc 次数 = %d\n",
           (unsigned long)big->len, (unsigned long)big->cap, reallocs);

    /* 3. 追加一段再读回内容 */
    s = sds_append(s, "!", 1, NULL);
    printf("append 后 len = %lu, 字节 =", (unsigned long)s->len);
    for (size_t i = 0; i < s->len; i++) printf(" %02X", (unsigned char)s->buf[i]);
    printf("\n");

    free(s);
    free(big);
    return 0;
}
```

```text
sds len = 5, strlen(buf) = 2
big len = 1000000, cap = 1048576, realloc 次数 = 18
append 后 len = 6, 字节 = 61 62 00 63 64 21
```

三行输出对应三个设计点：`len=5` 而 `strlen=2` 证明二进制安全；100 万次追加只发生 18 次 realloc，证明倍增扩容的摊还 O(1)（与 [第 02 篇](02-array-dynamic-array.md) 动态数组完全同构）；`buf` 里的 `00` 原样保留。`sds_append` 必须返回新指针、调用方必须接住——realloc 搬家后旧指针全部失效，这是 C 里 `x = append(x, ...)` 惯用法的根源。

### 3.5 语言对照表

| 语言 / 类型 | 内存表示 | 可变性 | 长度语义 | 切片代价 |
| --- | --- | --- | --- | --- |
| C `char *` / `char[]` | NUL 结尾字节数组 | 可变（有越界风险） | O(n) 扫描（strlen） | 需手动 memcpy，O(k) |
| C++ `std::string` | 长度 + 容量 + 指针，短串内联（SSO） | 可变 | O(1)（字符数） | `substr` 拷贝，O(k) |
| Python `str` | 紧凑对象：头 + 1/2/4 字节码元数组 | 不可变 | O(1)（码点数） | 拷贝，O(k) |
| Java `String` | UTF-16 数组（9+ 起 Latin1 内容用 1 字节） | 不可变 | O(1)（UTF-16 编码单元数） | `substring` 拷贝，O(k) |
| Rust `String` / `&str` | UTF-8 字节数组 / (指针, 长度) 胖指针 | String 可变，&str 只读 | O(1)（字节数） | &str 切片 O(1) 视图，非字符边界 panic |
| Go `string` | (指针, 字节长度)，内容通常 UTF-8 | 不可变 | O(1)（字节数） | O(1) 视图，共享底层字节 |

注意「长度语义」一列：Java 数 UTF-16 编码单元（emoji 算 2），Python 数码点（emoji 算 1），Go 和 Rust 数字节（emoji 算 4）。同一个字符串，四种语言的 `len` 各不相同——跨语言对接口（签名、校验和、分页游标）时，「长度」必须约定口径。

## 4. 字符串匹配：从 O(n·m) 到 O(n+m)

在长度 n 的主串里找长度 m 的模式串。这是字符串领域最经典的问题，四个经典算法正好构成一条「从直觉到工业」的谱系。

### 4.1 朴素匹配：最坏情形与为什么它常常够用

朴素算法：主串每个位置都试着对齐模式串，逐字符比较。

```python
def naive_all(text, pat):
    n, m = len(text), len(pat)
    hits = []
    for i in range(n - m + 1):
        for j in range(m):
            if text[i + j] != pat[j]:
                break
        else:
            hits.append(i)
    return hits
```

最坏情形发生在「总差一步」的输入上：在 `"a"*n` 里找 `"a"*(m-1)+"b"`。每个起点都要比完整个模式串才失配，比较次数精确等于 `(n-m+1)·m`：

```text
n=1000,  m=50:  朴素 47550 次比较  = (n-m+1)·m
n=2000,  m=100: 朴素 190100 次比较 = (n-m+1)·m
```

但真实场景里朴素匹配极少真的慢，有两个原因。其一，自然文本的失配通常发生在第一个字符（比如在英文里找 `jumps over`，大多数起点的第一个字母就对不上），平均比较次数接近 O(n) 而不是 O(n·m)。其二，你在 Python 里写的 `in`、`find` 根本不是朴素匹配——CPython 3.10 起使用 Crochemore-Perrin two-way 算法的扩展版，最坏 O(n+m)，还有 memchr 式的快速跳过。实测同一段 22 万字符文本找 8 字符模式：`str.find` 0.006 ms，下面 4.2 节的纯 Python KMP 14.3 ms，内置快约 2300 倍。**结论：单模式匹配，先信标准库；手写 KMP 的价值在于最坏保证与嵌入式等无标准库场景。**

### 4.2 KMP：主串指针永不回退

朴素算法慢的根源：失配后主串指针回退重比。KMP（Knuth-Morris-Pratt）的洞察是——失配时，**已经匹配过的那部分模式串是已知的**，其中「相等的前后缀」信息可以用来少比。预处理先把每个前缀的「最长相等真前后缀」长度算成一张表：

```text
pi[i] = 子串 p[0..i] 的「最长相等真前后缀」长度
        （真 = 前缀不等于整个子串）

p = a b a b a c a
pi= 0 0 1 2 3 0 1
         ↑ p[0..4]="ababa" 的最长相等真前后缀是 "aba"（长度 3）
```

这张表在失配时的含义：已经匹配了 k 个字符，主串当前字符对不上 `p[k]`，那么模式串可以「自己往左缩」到 `pi[k-1]`——因为已匹配部分的后缀 `p[0..pi[k-1])` 恰好等于它的前缀，主串那些字符不用重比。整个算法的 O(n+m) 都压在一个不变式上：

```text
不变式（KMP）：主串指针 i 从不回退；失配时只把「已匹配长度 k」改成 pi[k-1]。
  k 在 while 循环里虽然会连续下降，但每次下降都对应一次「i 前进时的上升」，
  所以 k 的总上升次数 ≤ n，总下降次数 ≤ n，预处理同理 ≤ m —— 这就是
  均摊分析：两种指针运动都只会单向消耗各自的预算。
```

```python
def build_pi(p):
    """pi[i] = p[0..i] 的最长相等真前后缀长度。"""
    m = len(p)
    pi = [0] * m
    k = 0                       # 当前相等前后缀的长度
    for i in range(1, m):
        while k > 0 and p[i] != p[k]:
            k = pi[k - 1]       # 缩到次长的相等前后缀再试
        if p[i] == p[k]:
            k += 1
        pi[i] = k
    return pi

def kmp_all(text, pat):
    """返回 pat 在 text 中的全部出现位置。主串指针 i 永不回退。"""
    n, m = len(text), len(pat)
    if m == 0:
        return list(range(n + 1))
    pi = build_pi(pat)
    hits = []
    k = 0                       # 已匹配的模式串前缀长度
    for i in range(n):
        while k > 0 and text[i] != pat[k]:
            k = pi[k - 1]       # 模式串回退，i 不动
        if text[i] == pat[k]:
            k += 1
        if k == m:
            hits.append(i - m + 1)
            k = pi[k - 1]       # 命中后继续找下一个
    return hits
```

最坏输入上的实测对比（与朴素同款输入）：

```text
n=1000,  m=50:  朴素 47550 次 vs KMP 1951 次
n=2000,  m=100: 朴素 190100 次 vs KMP 3901 次
n=100000, m=100（全 a 主串）: KMP 比较次数 199901 ≤ 2n —— 上界的直观验证
```

正确性不能只靠几个用例，用朴素版做对拍（两种实现互为参照，随机小字符串轮轰炸）：

```python
import random

random.seed(42)
bad = 0
for _ in range(5000):
    alpha = random.choice(["ab", "abc"])
    t = "".join(random.choice(alpha) for _ in range(random.randint(0, 60)))
    p = "".join(random.choice(alpha) for _ in range(random.randint(1, 6)))
    if len(t) < len(p):
        continue
    if kmp_all(t, p) != naive_all(t, p):
        bad += 1
print(f"5000 轮随机对拍，不一致 {bad} 轮")
```

```text
5000 轮随机对拍，不一致 0 轮
```

KMP 的适用边界：它的比较次数有 O(n+m) 的硬保证，适合流式输入（主串只能顺序读一遍）、以及必须防最坏情况的场合；但它的常数并不小（每个字符都要维护 k），在自然文本上通常输给 Boyer-Moore 的跳跃。

### 4.3 Rabin-Karp：滚动哈希

另一条路完全绕开逐字符比较：给每个长度为 m 的窗口算一个哈希值，哈希相等再逐字确认。关键在**滚动**——相邻窗口有 m-1 个字符重叠，哈希可以 O(1) 从上一个推出来：

```text
h(s[i..i+m)) = s[i]*base^(m-1) + s[i+1]*base^(m-2) + ... + s[i+m-1]    (mod p)

去掉最高位、左移、加上新低位：
h(i+1) = (h(i) - s[i]*base^(m-1)) * base + s[i+m]    (mod p)
```

这正是 [第 06 篇](06-hash-table.md) 2.2 节多项式哈希的用途（那篇的 WARNING 讲了它的可构造碰撞，此处直接复用结论）：

```python
def rabin_karp_all(text, pat, base=131, mod=(1 << 61) - 1):
    n, m = len(text), len(pat)
    if m == 0:
        return list(range(n + 1))
    if n < m:
        return []
    hp = 0
    for ch in pat:                          # 模式串哈希，O(m)
        hp = (hp * base + ord(ch)) % mod
    ht = 0
    for ch in text[:m]:                     # 第一个窗口，O(m)
        ht = (ht * base + ord(ch)) % mod
    top = pow(base, m - 1, mod)             # 最高位权重，O(log m)
    hits = []
    for i in range(n - m + 1):
        if ht == hp and text[i:i + m] == pat:   # 哈希相等仍需逐字确认
            hits.append(i)
        if i + m < n:                       # O(1) 滚动：去最高位，加新低位
            ht = ((ht - ord(text[i]) * top) * base + ord(text[i + m])) % mod
    return hits

assert rabin_karp_all("aabaabaab", "aab") == [0, 3, 6]
assert rabin_karp_all("aaaa", "aab") == []
```

两个实现要点决定它的实战价值：

1. **哈希相等必须逐字确认**。哈希只把「绝不相等」的窗口筛掉，相等只是候选。上面的实现每次命中候选都做一次 `==`（期望 O(1) 次候选，最坏 O(m)）。对抗性输入（有人故意构造碰撞）下可以改用双哈希（两组 base/mod 同时相等才确认）或随机化 base，把碰撞概率压到可忽略。
2. **它的优势在朴素/KMP 不擅长的形状**：多模式匹配（把 k 个长度为 m 的模式串的哈希放进一个集合，主串每个窗口 O(1) 查表，总代价 O(n + k·m)）；二维匹配（先把每列压成哈希，再对哈希矩阵做一维匹配）；抄袭检测/查重（对文档滑窗取指纹集合，比较指纹而非文本）。

期望时间 O(n+m)，最坏 O(n·m)（碰撞风暴时退化为逐字确认），空间 O(1)。

### 4.4 Boyer-Moore：从右往左，整段跳过

朴素和 KMP 都是「主串从左往右、窗口内从左往右」。Boyer-Moore 反其道而行：窗口内**从右往左**比。这个颠倒带来质变——失配发生在窗口右端，此时窗口左侧的 m-1 个字符根本没看过，可以整段跳过：

- **坏字符规则**：主串中失配的那个字符 c，在模式串里最后一次出现的位置是 j'，就把窗口右移 `j - j'`（c 不在模式串里则跳过整个前缀）。跳过的长度取决于「失配字符在模式串里的位置」，与已匹配多少无关。
- **好后缀规则**：窗口尾部已匹配的那段（好后缀），在模式串其他位置出现过的，对齐到那个位置；没出现过则寻找「模式串前缀 == 好后缀后缀」的最长对齐。两规则取较大移动量。

对自然文本的实测（仅用坏字符规则，统计字符比较次数；文本 88000 字符的英文，模式在文中不出现）：

```text
模式 'syzygy'        (m=6):  朴素 89995 次 (102% of n) | BM 17995 次 (20.4% of n) | 5.0 倍
模式 'lazy dogs'     (m=9):  朴素 103992 次        | BM 14000 次 (15.9% of n) | 7.4 倍
模式 'syzygy program'(m=14): 朴素 89987 次 (102% of n) | BM 7002 次 (8.0% of n)  | 12.9 倍
```

模式越长、失配字符越少出现在模式串里，跳得越远——m=14 时 BM 只检查了文本的 8%，这就是「接近 O(n/m) 亚线性」的含义：很多字符从未被读入过比较器。代价与边界同样清楚：预处理 O(m + 字符集大小)；坏字符规则单独使用最坏仍是 O(n·m)（`"a"*n` 里找 `"ba"*k` 这类会让每窗口只挪一步），完整算法靠好后缀规则把最坏拉回线性；模式串很短时（m=2、3）跳跃能力有限，这时朴素的缓存友好性反而占优。**Boyer-Moore 适合「长模式 + 大字母表 + 文本远大于模式」的场景**（grep 类工具的经典选择）。

### 4.5 标准库的真实做法，与更高的台阶

工业实现比任何一个教科书算法都复杂，因为它们在优化**常数**而不是量级：CPython 3.10+ 的 `find`/`in` 用 two-way（Crochemore-Perrin）算法的扩展版，最坏 O(n+m) 且带 memchr 风格的快速跳过；glibc 的 `memmem`、Rust 的 `str::find` 同属 two-way 家族，配合 SIMD 一次比较几十个字节。教科书算法给的是「比较次数的量级」，工业算法还要回答「一次比较多少字节、缓存行是否命中、分支预测是否友好」——这就是为什么 4.2 节纯 Python KMP 会输给 `str.find` 两千多倍：量级相同的两个实现，常数可以差三个数量级。

再往上是两个专用结构：**后缀数组/后缀自动机**把「在固定大文本上反复查任意子串」变成 O(m log n) 甚至 O(m)（构建 O(n)，适合搜索引擎的索引层）；**AC 自动机**把「一次扫描匹配上万条模式」变成 O(n + 命中数)——两者都是 Trie 的近亲，见 [第 10 篇](10-trie.md)。

四个算法的总账：

| 算法 | 预处理 | 平均 | 最坏 | 额外空间 | 适用场景 |
| --- | --- | --- | --- | --- | --- |
| 朴素 | O(m) | 接近 O(n)（自然文本） | O(n·m) | O(1) | 短模式、常数最小 |
| KMP | O(m) | O(n+m) | O(n+m) | O(m) | 流式、防最坏 |
| Rabin-Karp | O(m) | O(n+m) 期望 | O(n·m)（碰撞风暴） | O(1) | 多模式、二维、指纹 |
| Boyer-Moore | O(m+字符集) | 亚线性（自然文本） | O(n·m)（仅坏字符）/ 线性（完整版） | O(m+字符集) | 长模式、大字母表 |

## 5. 常用操作的真实代价

先给结论表（Python 3.13 实测，1 MB 文本 / 常规大小字符串）：

| 操作 | 实测 | 复杂度 | 说明 |
| --- | --- | --- | --- |
| `sub in s` / `s.find(sub)` | 约 0.47~0.51 ms | 最坏 O(n+m) | two-way + 快速跳过，找不到也要扫完 |
| `s.startswith(p)` | 31.8 ns | O(len(p)) | 只比前缀，零分配 |
| `s[:len(p)] == p` | 62.9 ns | O(len(p)) | 切片先分配拷贝，再比较 |
| `s.split(sep)` | O(n) | O(n) 时间 | 结果对象数影响内存，见下 |
| `s.strip()` | 0.4 µs（16 KB 串） | O(n)（拷贝结果） | 只需检查两端 |
| `s.lower()` | 5.9 µs（16 KB 串） | O(n) | 全扫描 + 新分配 |
| `s.replace(a, b)` x1 | 0.02 ms（100 KB 串） | O(n) | 单次全扫描 |
| `re.match(r"(a+)+b", "a"*24)` | 约 473 ms | 指数 | 灾难性回溯，见下 |

几个值得展开的点。

**`startswith` 为什么便宜**：它最多比较 `len(p)` 个字符就返回，且不分配任何新对象。`s[:len(p)] == p` 先构造一个 k 字符的新串再比较——功能等价，白付一次分配加拷贝。判断前缀用 `startswith`，判断「在中间还是开头」才用 `find`。

**`split` 的内存放大**：`split` 本身是 O(n) 的，但它把一个对象变成 k 个对象，每个 str 都有固定对象头。实测 `"apple,banana,...,grape"`（45 字符）split 出 7 段，总内存从 86 B 涨到 478 B（5.6 倍）；100 KB 的 CSV 行拆 1000 段，从 101040 B 涨到 149888 B（1.5 倍）。短字符串占大头时放大最狠（对象头淹没内容）——这也是 [第 10 篇](10-trie.md) Trie 与「把大量短字符串塞进哈希表」内存翻车的共同根源。

**大小写转换的语义比性能深**：`lower` 是「显示层」的小写，`casefold` 是「比较层」的折叠——后者会把 `ß` 折成 `ss`、把 `İ`（土耳其语带点大写 I，U+0130）折成 `i` + 组合点（长度 2）。实测：`"ß" == "ss"` 是 False，但 `"ß".casefold() == "ss".casefold()` 是 True。大小写转换还是语言相关的：Python 的 `"I".lower()` 永远返回 `"i"`，而土耳其语环境期望 `"ı"`（无点 i）——标准库不做 locale 感知的大小写转换，需要时用专门的库或自建映射表。**做「忽略大小写的比较」用 `casefold`，做「给人看的小写」用 `lower`。**

**`replace` 的线性放大**：每次 `replace` 都是全扫描加全量新分配。实测 100 KB 串：1 次 0.02 ms，链式 4 次 0.11 ms，8 次 0.30 ms——成本随链长线性累加。清理逻辑里几十个 `.replace().replace()...` 串起来，就是几十遍全文扫描；多模式替换考虑正则一次编译、一次替换，或查表 + `translate`。

**正则的灾难性回溯（catastrophic backtracking）**：Python 的 `re` 是回溯型引擎，嵌套量词会让回溯路径指数爆炸：

```python
import re, time

pat = re.compile(r"(a+)+b")       # (a+)+ 是经典的指数回溯结构
for k in (18, 20, 22, 24):
    t0 = time.perf_counter()
    pat.match("a" * k)            # 没有 b，引擎要穷举所有分组方式
    dt = time.perf_counter() - t0
    print(f"k={k:2d}: {dt*1000:9.2f} ms")
```

```text
k=18:     7.59 ms
k=20:    30.17 ms
k=22:   117.74 ms
k=24:   472.70 ms
```

每多 2 个 `a`，耗时约乘 4——指数级。这是真实的安全漏洞（ReDoS）：用户输入喂给一个写着 `(a+)+` 的校验正则，一个 30 字符的请求就能占住一个 worker 几秒钟。规避方式三条：嵌套量词旁路（`(a|a)*`、`(a+)+` 这类「同一字符可被两组量词分别消费」的结构是雷区，改写成 `(a+)` 单层）；Python 3.11 起可以用原子组 `(?>...)` 和占有量词 `a++`、`*+` 直接禁止回溯；高并发入口的正则用 RE2 系引擎（线性时间、无回溯语义）。写完正则，用一个「不匹配的最坏输入」测一次耗时，是比 code review 更可靠的验收。

## 6. Unicode 规范化：看起来一样，== 却是 False

同一个字形在 Unicode 里经常有多种码点序列，而 `==` 比较的是码点序列：

```python
import unicodedata

s1 = "café"          # NFC：é 是单个码点 U+00E9
s2 = "cafe\u0301"    # NFD：e + 组合尖音符 U+0301
print(s1 == s2, len(s1), len(s2))                       # False 4 5
print(unicodedata.normalize("NFC", s2) == s1)           # True
print(s1.encode("utf-8").hex(" "))
print(s2.encode("utf-8").hex(" "))                      # 字节序列不同
```

```text
False 4 5
True
63 61 66 c3 a9
63 61 66 65 cc 81
```

四种规范形式，管两件不同的事：

| 形式 | 全称 | 做什么 | 例子 |
| --- | --- | --- | --- |
| NFC | Canonical Composition | 分解后重新组合，倾向单码点 | e+U+0301 → é |
| NFD | Canonical Decomposition | 规范分解，倾向基字符+组合标记 | é → e+U+0301 |
| NFKC | Compatibility Composition | 兼容分解后组合，抹掉「样式差异」 | 全角Ａ → A，① → 1，㍿ → 株式会社 |
| NFKD | Compatibility Decomposition | 兼容分解，不重组 | ﬁ → f+i |

NFC/NFD 处理「同一字形的不同编码路径」；NFKC/NFKD 额外抹掉兼容字符——上标、全半角、连字、带圈数字这些「视觉变体」。实测：

```python
import unicodedata

print(unicodedata.normalize("NFKC", "ＡＢＣ１２３（株）"))   # ABC123(株)
print(unicodedata.normalize("NFKC", "①") == "1")           # True
print(unicodedata.normalize("NFKC", "㍿"))                 # 株式会社

# 组合标记的顺序也不唯一，NFD 会做规范排序
a, b = "q\u0327\u0307", "q\u0307\u0327"    # 下加符与上加点两种排列
print(a == b)                                              # False
print(unicodedata.normalize("NFD", a)
      == unicodedata.normalize("NFD", b))                  # True
```

工程建议，按风险从高到低：

1. **用户输入在系统边界先规范化**。表单、API、消息队列的入口处统一 `normalize("NFC", s)`（通用文本）或 `NFKC`（需要全半角归一的场合），让下游永远只见到一种形式。
2. **比较/去重/唯一键前先折叠**。统一用「NFKC + casefold」的组合做比较键：实测 `"STRASSE"` 与 `"straße"`、全角 `"Ｋ"` 与 `"k"`、`"①"` 与 `"1"`，原始 `==` 全是 False，折叠后全是 True。
3. **文件名与 URL 的坑**。macOS 的文件系统历史上存 NFD，Linux 常见 NFC：同一个 `résumé.txt` 在两边是不同的字节序列，scp/同步盘之后「文件明明在却打不开」。实测 NFC 版 UTF-8 是 `72 c3 a9 ...`，NFD 版是 `72 65 cc 81 ...`——文件名比较、zip 包跨平台、路径去重都要先 normalize。URL 里非 ASCII 部分在做 percent-encoding 前也应统一 NFC。
4. **数据库唯一索引同理**：唯一约束建立在原始字节上，「Café」的两种写法会插成两行。要么入库前规范化，要么在生成列/函数索引上套 normalize。

## 7. 更多字符串问题的定位

这些主题在别处或后续有主场，这里只给「问题形状」与入口：

- **最长公共前缀**：一组串的最长公共前缀。横向逐位扫 O(总字符数)；或利用「排序后首尾两串的公共前缀就是全体的答案」（排序 O(n log n · L)，串数极大时慢）。
- **最长回文子串**：中心扩展 O(n²) 最坏（`"aaaa..."`），实现简单、自然文本上常够用；Manacher 算法 O(n)，用已算出的回文半径镜像复用，竞赛与卡时限场景。工程上多数需求其实是「前缀回文」（KMP 对 `s + 分隔符 + reverse(s)` 跑一遍 pi 数组）。
- **编辑距离**：两个串的最少插入/删除/替换次数，DP 递推 `dp[i][j] = min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1] + (a[i]!=b[j]))`，时间 O(n·m)，滚动数组把空间压到 O(min(n, m))。Trie 上的模糊匹配（把 DP 行沿着 Trie 边下推）能一次算出词表里所有距离 ≤ k 的词，是拼写纠正的标准做法，见 [第 10 篇](10-trie.md)。
- **字符串哈希的工程位**：内容寻址（Git 的对象名、Docker 层的 sha256）、缓存键（请求参数规范化后哈希）、分块去重。注意 [第 06 篇](06-hash-table.md) 的警告：Python 内置 `hash()` 有随机盐、不能持久化；跨进程/跨语言要用显式算法（sha256、MurmurHash）。
- **字符串排序**：比较排序每次比较 O(L)，总代价 O(n·L·log n)；基数排序（LSD 按字节、MSD 按字符分桶）做到 O(n·L)，多关键字（年月日、主机名段）本质就是多轮基数排序，见 [第 14 篇](14-sorting.md)。
- **压缩的定位**：RLE 行程编码适合连续重复（简单日志、位图）；Huffman 用变长前缀码压字符频率差异；通用压缩（gzip/zstd）= LZ77 字典去重 + 熵编码。字符串去重的极端形式是布隆过滤器（可能误判、绝不漏判），见 [第 16 篇](16-advanced-structures.md)。

## 8. 陷阱清单

- **按字节切片切坏多字节字符**。`"中文".encode("utf-8")[:1]` 是 `b'\xe4'`，半个「中」，decode 直接 `UnicodeDecodeError`。Python 的 str 按码点索引所以 str 切片安全；危险的是 bytes 层（网络帧、文件偏移）与 Go/Rust 的字节语义——按字节下刀前先确认边界，Rust 直接 panic，Go 和 Python 静默产出坏数据。
- **`len()` 与显示宽度不等**。`len("家庭emoji")` 是 5，终端显示 1 格；对齐、截断、限长都要用显示宽度（wcwidth 类）而不是码点数。CJK 全角字符也占 2 格而不是 1 格。
- **读文件必须显式指定编码**。`open(path)` 用 `locale.getpreferredencoding()`：这台机器恰好返回 `utf-8`，换一台 GBK 区域设置的 Windows 就是 `gbk`——同一份代码在这台跑得好好的，在同事机器上 `UnicodeDecodeError`。永远写 `open(path, encoding="utf-8")`；对外部数据再加 `errors=` 策略（`strict` 保正确性，`replace` 保可用性，选哪个要想清楚）。
- **BOM 导致比较失败**。带 BOM 的 UTF-8 文件读出来首字符是 U+FEFF：`raw.decode("utf-8") == "hello"` 是 False，`raw.decode("utf-8-sig")` 才是 True。实测：

```python
raw = b"\xef\xbb\xbfhello"
print(raw.decode("utf-8") == "hello")        # False：开头混进 U+FEFF
print(raw.decode("utf-8-sig") == "hello")    # True：utf-8-sig 自动剥 BOM
```

- **大小写折叠的语言依赖**。`"I".lower()` 在任何 locale 下都是 `"i"`，但土耳其语期望 `"ı"`；`"İ".casefold()` 长度是 2。跨语言产品里「忽略大小写」必须指定折叠规则，否则同一份数据在不同区域设置的机器上比较结果不同。
- **用 str 当二进制容器**。`b"ab" == "ab"` 是 False，两者类型不同；图片、压缩流、二进制协议用 bytes/`bytearray`，文本用 str，边界处显式 `encode`/`decode`。拿 str 存二进制会隐性走一次 UTF-8 编码，数据先膨胀再损坏。孤立代理项（`chr(0xD83D)`）能进入 str 却无法 `encode("utf-8")`——外部脏数据要在解码边界拦住。
- **规范形式不统一**。同一视觉内容的 NFC/NFD 两种写法 `==` 为 False（见第 6 节），哈希、唯一键、URL 签名全部跟着错。任何「以字符串为键」的持久化（数据库、缓存、文件名）都要先定规范形式。

## 9. 小结

- 码点、编码单元、字素簇是三层不同的东西：`len()` 数码点，Java `length()` 数 UTF-16 编码单元，Go/Rust `len()` 数字节，人眼数字素——「长度」必须先约定口径。
- UTF-8 的变长规则是一张位模板表：U+0800..U+FFFF 用 3 字节，CJK 基本区恰好全在此段，所以「一个汉字 3 字节」；ASCII 兼容、无字节序、自同步是它胜出的结构性原因。
- 不可变字符串用「拼接要重建」换来哈希缓存、无锁共享与 O(1) 视图；CPython 的 `+=` 原地优化只在引用计数为 1 时生效，是细节不是保证——拼接永远 `"".join`。
- NUL 结尾的 C 字符串买到了零空间，付出 O(n) 的 `strlen`、存不了 `\0`、缓冲区溢出三大代价；长度前缀（Pascal/SDS/Go）用几个字节换回 O(1) 长度与二进制安全；SSO 让短字符串零堆分配。
- 朴素匹配最坏 O(n·m) 但自然文本上常数极小；KMP 靠 pi 数组做到主串指针永不回退，O(n+m) 是硬保证；Rabin-Karp 用滚动哈希换多模式与二维匹配的能力；Boyer-Moore 从右往左比，自然文本上接近亚线性。单模式先信标准库（two-way + SIMD）。
- `startswith` 便宜是因为零分配零多余比较；`split` 的内存放大来自对象头；`replace` 链式调用线性放大；嵌套量词正则的回溯是指数级，ReDoS 是真实漏洞类别。
- 「看起来一样」不代表码点序列一样：NFC/NFD 两种写法 `==` 为 False，NFKC/NFKD 再抹掉全半角与兼容字形。用户输入先规范化，比较键统一 NFKC + casefold。
- 编码问题几乎都出在边界上：读文件显式 encoding、BOM 用 utf-8-sig、二进制用 bytes、孤立代理项在解码层拦截。

## 10. 练习

**1.** 手算 `p = "aabaaab"` 的 pi 数组，逐步写出每一步的 k 变化，并用 `build_pi` 验证。

> [!TIP]
> 思路结果是 `[0, 1, 0, 1, 2, 2, 3]`。以 i=5（第二个 `a`）为例：此时 p[0..4]="aabaa"，k 从 2 开始，p[5]='a' 与 p[2]='b' 失配，k=pi[1]=1，p[5]='a' 与 p[1]='a' 相等，k=2，故 pi[5]=2。i=6 时 p[6]='b' 与 p[2]='b' 相等，k=3。验证：`build_pi("aabaaab")` 返回 `[0, 1, 0, 1, 2, 2, 3]`。

**2.** 证明 KMP 预处理 build_pi 是 O(m)。while 循环里 k 会回退，为什么总代价仍是线性的？

> [!TIP]
> 思路摊还论证：k 在每次 for 迭代中至多 +1（`k += 1` 一行），全程最多上升 m 次；while 里每轮 `k = pi[k-1]` 使 k 严格下降且 k 恒 ≥ 0，所以下降总次数 ≤ 上升总次数 ≤ m。总操作 ≤ 2m。这与主循环 O(n) 的论证完全同构——是「指针单向预算」的两次应用。

**3.** Rabin-Karp 若取 mod 为 2 的幂（如 2^32）会出什么问题？给出两种缓解办法。

> [!TIP]
> 思路取 2 的幂时取模只保留哈希低位（模运算变成位掩码），而多项式哈希的低位恰好由输入的低位以简单线性方式决定，构造碰撞只需找低 32 位相同的窗口，难度大幅下降。缓解：①用大质数 mod（如 2^61−1）；②双哈希——两组独立 (base, mod) 同时相等才算候选，碰撞概率是两者乘积；③随机化 base（每次运行随机），让离线构造失效（同 [第 06 篇](06-hash-table.md) HashDoS 的对策）。

**4.** `"😀"` 在 Java 里 `length()` 返回多少？`charAt(0)` 返回什么？分别给出「数人眼字符」「数码点」的 Java 写法或思路。

> [!TIP]
> 思路`length()` 返回 2（U+1F600 需要 UTF-16 代理对 D83D DE00，Java 数编码单元）；`charAt(0)` 返回孤立高代理项（打印通常是问号，参与编码会出错）。数码点：`s.codePointCount(0, s.length())` 返回 1，或按 `codePointAt` 迭代跳过代理对。数字素簇：标准库没有，需要按 UAX #29 规则（或第三方库）处理组合标记与 ZWJ——码点数也不等于字素数。

**5.** 一段「逐行读 UTF-8 日志、按 `line == "ERROR"` 过滤」的代码，在同事的 Windows 机器上永远匹配不到任何行。日志文件由另一工具生成，带 BOM。列出所有可能的原因与修复。

> [!TIP]
> 思路至少三层：①`open(path)` 未显式 encoding，默认编码随机器 locale 变化（GBK 机器上直接 UnicodeDecodeError 或乱码）；②首行是 `\ufeffERROR`，`== "ERROR"` 为 False——用 `encoding="utf-8-sig"` 或读入后 `normalize`/去 BOM；③行尾 `\r\n` 未 strip，`"ERROR\r" == "ERROR"` 为 False——用 `line.rstrip("\r\n")` 或 splitlines。修复版：`open(path, encoding="utf-8-sig")` + `line.rstrip()` 再比较。

**6.** 设计「用户昵称唯一性」校验：两个用户分别输入了全角 `ＫＥＶＩＮ` 和半角 `kevin`，如何判定占用？给出比较函数并说明在哪一层做。

> [!TIP]
> 思路比较键函数 `unicodedata.normalize("NFKC", unicodedata.normalize("NFKC", s).casefold())`：NFKC 把全角折叠成半角，casefold 统一大小写（ß→ss、İ→i+组合点）。实测两者折叠后都是 `"kevin"`，判为冲突。要在「写入前的规范化 + 唯一索引建立在折叠键上」两层做：只在校验时折叠、存储原文，会出现「检索时大小写不敏感但唯一约束已经放了两个 K」的分裂。业务上若昵称显示必须保留原样，存原值 + 存折叠键两列。

**7.** C 字符串与长度前缀字符串（如 SDS）都执行「截断到前 10 个字节」，各自的复杂度是多少？为什么 Redis 选择 SDS 而不是直接用 `char*`？

> [!TIP]
> 思路SDS：O(1)——改 `len` 字段（若截断发生在头部则再挪一次内存，仍是 O(1) 元数据操作）；C 字符串：O(n)——要找到第 10 个字节后写入 NUL，n 是原长（`strlen` 本身 O(n)）。Redis 选 SDS 的三个理由：O(1) 长度（LEN 命令、追加前检查）、二进制安全（值可以是任何字节，包括序列化对象）、容量字段让 append/appendRange 能预检查扩容，结构上消除缓冲区溢出。

**8.** 检测这段代码的性能风险并修复：`for tag in tags: if line.startswith(tag) or tag in line: ...`，其中 `line` 约 1 KB、`tags` 约一万个短串。

> [!TIP]
> 思路一万个 tag 逐个 startswith/in，每个 tag 是 O(len(tag)) 与一次哈希/扫描，总代价 O(10000 × 1 KB) 每行——朴素多模式匹配。修复：把 tag 集合建成 AC 自动机（Trie + 失配指针），一次扫描 O(len(line) + 命中数) 处理全部一万条模式（见 [第 10 篇](10-trie.md)）；模式全是固定串时也可以用正则引擎一次编译成 `\b(tag1|tag2|...)\b`（仍是回溯引擎，注意备择数量），或 Rabin-Karp 风格的多模式哈希。核心判断：多模式匹配的量级赢在「一次扫描」而不是「更快的单次查找」。
