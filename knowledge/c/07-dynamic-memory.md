---
title: 动态内存：malloc 的真相
order: 7
tags: malloc, realloc, 内存泄漏, use-after-free, 所有权, 分配器
summary: malloc 家族的精确语义与 realloc 的移动陷阱、一个约百行的空闲链表分配器实现、glibc 真实分配器的分层设计、五类内存错误的全景与修复、所有权设计的四种模式，以及从 Valgrind 到 ASan 的工具链用法。
---

栈上的内存自动随函数进出生灭，全局变量活到进程结束——只有堆要求你**亲手分配、亲手归还**。C 把堆交给你不信任你，而是因为它别无选择：分配器的策略必须由程序自己决定（池化？碎片优先还是速度优先？），操作系统无法替每个程序做这个决定。

这一篇从三个层面讲透堆：**接口层**（malloc 家族每个函数的精确语义，特别是 realloc 的隐藏陷阱）、**实现层**（亲手写一个最小分配器，再对照 glibc 的真实设计——理解「free 之后内存里还有旧数据」「小分配快大分配慢」这些现象的来源）、**设计层**（所有权：谁分配谁释放，这是 C 内存安全的唯一治本之策）。

## 1. 接口层：四个函数的精确契约

```c
#include <stdlib.h>

void *malloc(size_t size);                      /* 分配 size 字节，内容未定义 */
void *calloc(size_t nmemb, size_t size);        /* 分配 nmemb*size 字节并清零；乘法溢出会检查 */
void *realloc(void *p, size_t size);            /* 调整大小：可能搬移！ */
void  free(void *p);                            /* 归还；p 必须 malloc 家族原样返回的指针 */
```

### 1.1 每个函数的注意点

**malloc**：成功返回指向**至少** size 字节的指针（可能多给，分配器按块对齐）；失败返回 NULL——**判空不是可选礼仪**，是契约的一部分。分配的字节内容**未定义**，读它是 UB（不是「恰好是零」）。

**calloc**：与 `malloc(n*size)` 的两个差别——内存**清零**；`nmemb*size` 乘法**溢出时返回失败**而不是回绕出一个错误的小块。「`malloc(n * sizeof *p)` 在 n 来自外部时是溢出漏洞」正是 calloc 存在的理由：

```c
size_t n = get_count();               /* 外部输入，可能是 2^62 */
int *p = malloc(n * sizeof *p);       /* ❌ 乘法回绕：分配出极小块，随后越界写 */
int *q = calloc(n, sizeof *p);        /* ✅ 溢出时返回 NULL */
```

**realloc**：语义最微妙的一个。行为分三种情况：

```c
void *newp = realloc(p, new_size);
/* ① 原地扩：后面有空闲 → 返回 p 本身
   ② 搬移：新分配 new_size，拷贝旧内容，释放旧块 → 返回新指针，p 已失效！
   ③ 失败：返回 NULL，【旧块原封不动还活着】 */
```

由此得出两条铁律：

```c
p = realloc(p, n);        /* ❌ 经典错误：失败时返回 NULL 覆盖 p → 旧块泄漏 */
void *tmp = realloc(p, n);
if (!tmp) { /* 处理失败：p 仍然有效 */ }
p = tmp;                  /* ✅ 先接临时变量，成功才更新 */
```

**realloc(NULL, n) 等价于 malloc(n)**——这个特性让「首次分配」与「扩容」共用一条代码路径。而 `realloc(p, 0)` 的行为是**实现定义**（等价 free 或返回 NULL），别用；释放就写 free。

**free**：传 NULL 是安全的空操作（这让「路径上可能没分配」的清理代码不用判断）；**必须传 malloc 家族原样返回的指针**——`free(p + 1)` 是 UB（分配器按块头找不到元数据）；free 之后 p 变成悬垂指针（[第 4 篇](04-pointers.md)），惯例立刻置 NULL。

## 2. 实现层：亲手写一个分配器

「malloc 到底做了什么」用一百行代码就能看清骨架。下面是一个**空闲链表分配器**：每个已分配块的头部记录大小，空闲块串成链表，分配时找第一个放得下的块，必要时切开；释放时把块挂回链表并合并相邻空闲块。

```c
#include <stddef.h>
#include <unistd.h>

typedef struct block {
    size_t size;             /* 数据区字节数（不含头部） */
    int    used;             /* 0 = 空闲，1 = 在用 */
    struct block *next;      /* 空闲链表的下一个节点 */
} block_t;

static block_t *heap_start = NULL;   /* 空闲链表头 */

#define ALIGN8(x)  (((x) + 7) & ~(size_t)7)
#define HDR_SIZE   ALIGN8(sizeof(block_t))

void *my_malloc(size_t size) {
    if (size == 0) return NULL;
    size = ALIGN8(size);

    /* 1. 先在现有空闲链表里找 first-fit */
    for (block_t *b = heap_start; b; b = b->next) {
        if (!b->used && b->size >= size) {
            /* 2. 剩余空间够再切一块就切（减少内部碎片） */
            if (b->size >= size + HDR_SIZE + 16) {
                block_t *rest = (block_t *)((char *)b + HDR_SIZE + size);
                rest->size = b->size - size - HDR_SIZE;
                rest->used = 0;
                rest->next = b->next;
                b->next = rest;
                b->size = size;
            }
            b->used = 1;
            return (char *)b + HDR_SIZE;      /* 返回跳过头部的数据区 */
        }
    }

    /* 3. 没找到：向内核要新内存（sbrk 移动堆顶） */
    block_t *b = sbrk((long)(HDR_SIZE + size));
    if (b == (block_t *)-1) return NULL;       /* 内核拒绝：OOM */
    b->size = size;
    b->used = 1;
    b->next = NULL;
    if (!heap_start) heap_start = b;
    else { block_t *t = heap_start; while (t->next) t = t->next; t->next = b; }
    return (char *)b + HDR_SIZE;
}

void my_free(void *p) {
    if (!p) return;
    block_t *b = (block_t *)((char *)p - HDR_SIZE);   /* 倒回头部 */
    b->used = 0;

    /* 4. 合并相邻空闲块，防止碎片化（只向后合并，简化版） */
    for (block_t *t = heap_start; t; t = t->next) {
        if (t->used) continue;
        block_t *n = t->next;
        if (n && !n->used && (char *)t + HDR_SIZE + t->size == (char *)n) {
            t->size += HDR_SIZE + n->size;
            t->next = n->next;
        }
    }
}
```

这个玩具已经解释了真实分配器的大部分可观测行为：

- **free 后内存里还有旧数据**：free 只是把块标记为空闲、挂回链表，**数据一个字节都没动**。直到这块被重新分配、写入新数据为止，旧内容还在——这就是 use-after-free 能「读到正确旧值」的假象来源。
- **每个分配有隐藏开销**：头部至少 8~16 字节 + 对齐填充。`malloc(1)` 实际可能吃掉 24~32 字节。海量小对象的空间放大率由此而来。
- **分配速度取决于「找块」**：first-fit 要扫链表；块越多越碎，扫描越长——「程序越跑越慢」的经典原因。
- **越界写会踩坏邻居的头部**：`p[size] = x` 覆盖的是**下一个块的元数据**，之后某次 free/malloc 才崩溃——堆溢出的崩溃点远离案发现场的原因。

### 2.1 glibc 的真实设计：玩具的三级进化

生产级分配器（glibc 的 ptmalloc、Google 的 tcmalloc、Facebook 的 jemalloc）在这个骨架上加了三层机制：

| 层       | 问题             | 方案                                       |
| ------- | -------------- | ---------------------------------------- |
| 线程缓存    | 多线程抢一把大锁        | 每线程一个小对象缓存（tcache），本地分配无锁；不够再向全局池要         |
| 大小分箱    | 链表扫描太慢          | 按大小分级（fastbin/smallbin/largebin），分配 O(1) 取出 |
| 内存池/arena | 频繁系统调用太贵       | 一次向内核要大块（如 64MB），内部切分出售                    |

这些设计共同指向一个结论：**malloc 不便宜也不昂贵，但高频小分配的累计成本可观**——每次调用是一条函数调用 + 锁竞争 + 链表操作。性能敏感路径的对策不是换分配器，而是**减少分配次数**（见第 4 节）。

## 3. 错误层：五类事故全景

### 3.1 泄漏：指针丢了，内存没还

```c
char *s = build_name(id);
if (id < 0) return -1;             /* ❌ 提前 return 路径漏 free(s) */
free(s);
```

「每个提前退出的分支都要释放已获得的资源」靠人肉维护必然漏。两个系统性解法：goto cleanup 模式（[第 3 篇](03-operators-control.md)第 3.3 节）统一出口；或者从设计上让函数不半路放弃（先验证所有前置条件，再开始分配）。

### 3.2 double free：同一个块还两次

```c
free(p);
...
free(p);                 /* ❌ 头部已破坏/已在空闲链表：堆损坏，崩溃或更糟 */
```

free 后置 NULL 的惯例让第二次 free 变成无害空操作。但注意它只保护**这一个指针变量**——同一块内存的两个别名指针（`p` 和 `q = p`）free 两次，置空救不了：这是所有权设计的问题（第 4 节）。

### 3.3 use-after-free：悬垂指针的堆形态

```c
free(p);
p->next;                 /* ❌ 读的是空闲块——此刻它可能在空闲链表里存着链表指针 */
```

最阴险的场景：释放后重新分配同一块给别人，旧指针的写入污染**别人的数据**。glibc 的 tcache 让「小块释放后立刻复用」极其常见，所以 UAF 的影响范围比直觉大得多。

### 3.4 越界写：踩碎堆的元数据

```c
int *arr = malloc(n * sizeof *arr);
arr[n] = 7;              /* ❌ 踩的是下一个块的头部或本块的尾部填充 */
```

崩溃可能在之后**任何一次** malloc/free 里（分配器遍历链表发现结构坏了）——报错点与出错点相隔十万八千里。这种「堆损坏」类 bug 手工调试几乎无解，ASan 一击命中。

### 3.5 realloc 搬移后继续用旧指针

```c
int *p = malloc(10);
int *q = realloc(p, 100);
p[0] = 1;                /* ❌ p 可能已被释放（情况②搬移） */
```

realloc 之后**只有返回值是有效的**，旧指针一律作废。

> [!WARNING]
> 五类事故的共同特征：**故障点 ≠ 出错点**。泄漏不崩、UAF 读到旧值、堆溢出延迟崩溃——手工 printf 调试在它们面前全部失效。正确姿势是让专用工具在出错点当场报警：`-fsanitize=address,undefined` 贯穿开发全程，Valgrind 兜底（第 5 节）。

## 4. 设计层：所有权——C 内存安全的唯一治本之策

所有内存 bug 追到底都是一个所有权问题：**这块内存归谁管，谁负责释放**。C 语言没有强制所有权（那是 Rust 的工作），但成熟的 C 代码都在文档与命名上执行它。四种可执行的模式：

### 4.1 模式一：单一所有者 + 显式移交

每个堆块有唯一 owner；释放只由 owner 做；移交所有权时用约定签名：

```c
/* create_ 的返回值所有权归调用方（文档写明：caller frees） */
char *config_dup(const char *key);

/* consume_ / take_ 前缀：收走所有权，函数负责释放 */
void config_free(char *cfg);         /* 名字含 free：所有权进、生命周期出 */
```

### 4.2 模式二：调用方提供缓冲区（出参内嵌）

被调函数不分配，调用方决定内存的来源与寿命——栈上分配也能用上：

```c
/* 调用方拥有 buf：栈、静态、堆随你选 */
int format_name(char *buf, size_t bufsz, const person_t *p);

char name[64];
format_name(name, sizeof name, &me);      /* 零堆分配 */
```

C 标准库 overwhelmingly 采用这个模式（`snprintf`、`fgets`、`strtol` 的 end 参数），理由是**内存策略留在调用方手里**。

### 4.3 模式三：引用计数（共享所有权）

多个使用者共享一块内存时，手动数引用：

```c
typedef struct {
    int   refcnt;
    /* ... 数据 ... */
} obj_t;

obj_t *obj_ref(obj_t *o) { o->refcnt++; return o; }      /* 借用 +1 */
void   obj_unref(obj_t *o) { if (--o->refcnt == 0) free(o); }
```

refcnt 换来「最后一个使用者负责释放」，代价是每次传递一次原子加减（多线程）与循环引用风险（A 引 B、B 引 A，谁也不到 0——需要额外打破环的约定）。glib、CPython 的对象系统都是这条路。

### 4.4 模式四：区域分配（arena/池）

一批对象同生共死时，跳过逐对象 malloc/free：

```c
typedef struct { char *base; size_t used, cap; } arena_t;

void *arena_alloc(arena_t *a, size_t n) {
    n = (n + 15) & ~(size_t)15;                  /* 对齐到 16 */
    if (a->used + n > a->cap) return NULL;       /* 简化版：不自动扩 */
    void *p = a->base + a->used;
    a->used += n;
    return p;
}
/* 整个「请求处理期」用 arena 分配，结束时一次性归零 */
void arena_reset(arena_t *a) { a->used = 0; }    /* 不 free 任何单个对象！ */
```

arena 是 Web 服务器、游戏引擎、编译器的标配：**每次 HTTP 请求开一个 arena，请求结束整体 reset**——几万次分配压缩成一次系统调用级成本，且不存在逐对象泄漏（reset 即全清）。代价：单个对象无法提前释放，内存峰值等于峰值时刻的总用量。

| 模式     | 适用             | 成本                       |
| ------ | -------------- | ------------------------ |
| 单一所有者  | 默认选择           | 纪律成本：约定与评审               |
| 调用方缓冲区 | 短生命周期的中小数据     | 无堆开销；调用方要管尺寸             |
| 引用计数   | 生命周期交错的数据（缓存、树） | 计数开销 + 循环引用风险            |
| arena  | 同生共死的一批（请求、帧）   | 无法单独释放；峰值内存              |

## 5. 工具层：让机器抓内存 bug

| 工具                 | 原理                | 擅长                  | 代价              |
| ------------------ | ----------------- | ------------------- | --------------- |
| ASan（`-fsanitize=address`） | 编译期插桩 + 影子内存 | UAF、越界、double free——当场报错带调用栈 | 慢 2 倍、内存 2~3 倍；需重编译 |
| Valgrind memcheck  | 虚拟机解释执行           | 全套错误 + 泄漏报告；**无需重编译** | 慢 10~50 倍       |
| LSan（ASan 自带）      | 退出时扫描可达性          | 泄漏                  | 含在 ASan 里       |
| MSan / UBSan       | 插桩                | 未初始化读 / 其他 UB       | 同 ASan          |

ASan 的报告长这样，直接指出两个现场：

```text
==123==ERROR: AddressSanitizer: heap-use-after-free
READ of size 4 at 0x60200000eff1 thread T0
    #0 0x401146 in main use_after.c:9          ← 使用点
freed by thread T0 here:
    #0 free
    #1 0x401120 in main use_after.c:7          ← 释放点
previously allocated by thread T0 here:
    #0 malloc
    #1 0x40110c in main use_after.c:5          ← 分配点
```

工作流约定：**开发与 CI 用 `-O1 -fsanitize=address,undefined` 构建**（足够快到天天跑），发布版才去掉 sanitizer；Valgrind 用于「只有发布版二进制」的第三方程序排查。

## 6. 性能层：少分配比快分配重要

分配器已经很快，性能问题的根源几乎总是**分配次数**。按收益排序的手段：

1. **复用缓冲区**：循环里的临时缓冲区提出去，容量够就 reset 复用（`memset` 清零比重 malloc 便宜）。
2. **预估容量一次分配**：动态数组扩容用「增长因子」（如 1.5 倍）摊还，避免每次 append 一次 realloc。
3. **arena 处理同生共死**：见 4.4。
4. **小对象合并**：把大量小结构体放进一个大数组 + 下标引用（对象池），既省分配又优化缓存局部性（连续访问）。

```c
/* 动态数组的标准扩容骨架 */
typedef struct { int *data; size_t len, cap; } vec_t;

int vec_push(vec_t *v, int x) {
    if (v->len == v->cap) {
        size_t ncap = v->cap ? v->cap + v->cap / 2 : 16;    /* 1.5 倍：兼顾摊还与内存复用 */
        int *nd = realloc(v->data, ncap * sizeof *nd);
        if (!nd) return -1;
        v->data = nd;
        v->cap = ncap;
    }
    v->data[v->len++] = x;
    return 0;
}
```

> [!TIP]
> 1.5 倍而不是 2 倍的原因：2 倍增长让「新块 = 旧块 + 旧块之前所有释放块之和」，旧块永远装不下新块，内存无法复用；1.5 倍在若干次扩容后，新块尺寸会落入之前释放块的合并区间——glibc 的 Facebook 工程师 foobarqux 的经典分析结论（成长因子 1.5 时分配器对齐更好）。这是「性能设计影响内存布局」的小例子。

## 7. 陷阱清单

- `p = realloc(p, n)`：失败时旧块泄漏；先接临时变量。
- `malloc(n * m)` n、m 外部可控：溢出回绕出小块；用 calloc。
- malloc 后不判空：失败即空指针解引用。
- 读完忘了 free（所有提前 return 分支）：goto cleanup 或先验证后分配。
- double free：free 后置 NULL；根因是所有权混乱。
- UAF：free 后继续读写；ASan 全程盯防。
- 越界写踩堆元数据：崩溃远离现场；边界用 `n` 半开区间 + ASan。
- `free(p + k)`：必须传原样指针；偏移过的指针不可 free。
- free(NULL) 以外的「未初始化就 free」：野 free 等价 UB。
- `malloc(0)` 的返回值实现定义：避免依赖；写代码不分配零字节。
- 循环引用的引用计数：泄漏；设计上规定单向引用方向。
- 高频小对象裸 malloc：换 arena 或对象池。

## 8. 小结

- malloc 家族的契约：malloc 未清零、calloc 清零且乘法防溢出、realloc 可能搬移（旧指针随即失效，失败不破坏旧块）、free(NULL) 安全。
- 百行空闲链表分配器解释了全部可观测现象：free 不清数据（UAF 假象来源）、头部开销（小对象放大率）、first-fit 扫描（碎片拖慢）、越界踩头（堆损坏延迟崩溃）。
- glibc 真实设计 = 线程缓存（无锁）+ 大小分箱（O(1)）+ arena（摊还系统调用）；生产代码的优化重点是减少分配次数而不是更换分配器。
- 五类错误（泄漏、double free、UAF、越界、realloc 误用）的共性是故障点远离出错点——手工调试无解，ASan/Valgrind 是流程的一部分而不是救火工具。
- 所有权是唯一治本之策：单一所有者、调用方缓冲区、引用计数、arena 四种模式覆盖所有场景；C 语言的「安全」最终是设计与约定。
- 性能排序：复用 > 预估容量 > arena > 对象池 > 换分配器。

## 9. 练习

**1.** 把第 2 节的玩具分配器补上「向前合并」（free 时合并前一个相邻空闲块）。提示：单链表如何找前驱？改成双向链表值得吗？

> [!TIP]
> 思路单链表找前驱要从头扫——O(n)；双向链表 O(1)（free 的真实实现都需要它）。写完后用压力测试验证：交替 malloc/free 一万次，打印空闲块数量与最大块尺寸，观察合并前后的碎片差异。

**2.** 用 ASan 找出下面函数的全部问题并修复。

```c
char *dup_upper(const char *s) {
    char *out = malloc(strlen(s));
    for (size_t i = 0; i <= strlen(s); i++)
        out[i] = toupper(s[i]);
    return out;
}
```

> [!TIP]
> 思路三处：①`malloc(strlen(s))` 少 1 字节装终止符——分配长度应为 `strlen(s)+1`；②循环条件 `<=` 越界写 1 字节（踩堆元数据）；③malloc 未判空。修复后 ASan 的报错会精确指向 out[i] 的越界写。

**3.** 实现第 4.2 节的 `format_name`（选一种数据结构：姓名+年龄），并分别用栈缓冲区与堆缓冲区调用它，体会「调用方提供缓冲区」模式的内存策略灵活性。

> [!TIP]
> 思路签名 `int format_name(char *buf, size_t bufsz, const person_t *p)`，返回 0 或负错误码（放不下返回需要的长度，调用方可重试堆分配——snprintf 的两遍法思想）。栈版零分配，堆版全控制。这就是标准库无处不在的模式。

**4.** 给 4.4 的 arena 加上「自动扩容」（当前块满了就 malloc 新块串起来），并说明为什么 arena 的块可以 free 而「单个对象」永远不能。

> [!TIP]
> 思路块结构 `{arena_block *next; size_t used, cap;}`，分配不足时开新块头插链表；reset 保留第一块、free 其余（或全保留做池化）。单个对象「不能 free」是因为它的地址在块内部，free 需要块首地址——这正说明 arena 的所有权单位是「区域」而不是对象。

**5.** 写一个必然 double free 的小程序，分别在普通编译、ASan、Valgrind 下运行，记录三种输出并比较定位能力。

> [!TIP]
> 思路普通版大概率「可能崩可能不崩」（glibc 会报 `double free or corruption` abort，但依赖版本与块大小）；ASan 版报告精确到两次 free 的行号与分配点；Valgrind 版给出 invalid free 报告。结论：工具的报警能力 = 插桩深度 × 运行成本，开发期用 ASan（快），离线深度检查用 Valgrind（不用重编译）。

**6.** 解释为什么「free 之后立刻置 NULL」对 `int *q = p; free(p); p = NULL;` 的情况无效，并设计一个能防住这种情况的接口约定。

> [!TIP]
> 思路 q 是另一个别名指针，置空 p 不影响 q——q 变悬垂。防法：所有权约定「任何时刻只有一份拥有者指针」，别名一律视为借用（借用者不得 free、不得长期持有跨过拥有者的生命周期），移交用显式函数。这正是 4.1 模式的内容；C++ 用 unique_ptr 在类型上强制了它，C 只能靠约定 + 评审。
