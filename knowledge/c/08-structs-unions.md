---
title: 结构体、联合体与对齐：布局即契约
order: 8
tags: 结构体, 对齐, 填充, 位域, 联合体, 严格别名
summary: 结构体的值语义与传参成本、对齐与填充的逐字节推演与成员排序优化、位域的可移植性边界、联合体与 tagged union 变体类型、严格别名规则的合法通道，以及 packed 结构体在协议场景的正确与错误用法。
---

C 只给了两种「把数据组合起来」的方式：结构体（都要）和联合体（择一）。但这个简单语法背后站着三件大事：**内存布局的完全控制权**（你决定每个字节放哪，或交给编译器优化）、**ABI 的边界**（结构体怎么传递决定了库与库、语言与语言能不能互操作）、**类型双关的合法性**（同一块内存的多种读法，规则极严格）。

「布局即契约」是本篇的主线：写出结构体的那一刻，你签下的契约包括对齐、填充、别名规则——它们决定了你的代码与文件格式、网络协议、第三方库能否对上。

## 1. 结构体基础：值语义是默认，指针才是工具

```c
#include <stddef.h>

typedef struct {
    int    id;
    double score;
    char   name[32];
} player_t;

player_t a = {1, 99.5, "alice"};              /* 按顺序初始化 */
player_t b = {.id = 2, .name = "bob"};        /* C99 指定初始化器：未提及的清零 */
player_t c = a;                               /* ✅ 整体赋值：逐成员拷贝（值语义） */
```

「结构体可以整体赋值」值得停一秒：数组不行，结构体行。赋值是**逐成员浅拷贝**——如果成员里有指针，拷贝的是指针值（两边指向同一块堆内存），这不是深拷贝：

```c
typedef struct { char *name; } person_t;      /* name 指向堆 */

person_t p1 = {strdup("alice")};
person_t p2 = p1;                             /* 浅拷贝：p2.name == p1.name */
free(p1.name);
p2.name[0];                                   /* ❌ use-after-free：两个结构体共享一块堆 */
```

内含指针的结构体，拷贝策略必须自己定义：要么文档规定「拷贝即共享，所有权归原主」，要么提供 `person_clone()` 显式深拷贝。这是[第 7 篇](07-dynamic-memory.md)所有权设计在结构体上的投影。

### 1.1 传参与返回：拷贝成本

结构体传参是**值传递**——整个结构体拷贝一份进函数：

```c
void by_value(player_t p);          /* 64 字节逐字节拷贝到栈 */
void by_pointer(const player_t *p); /* 8 字节指针，const 承诺只读 */
```

规约一目了然：**只读用 `const player_t *`，需要修改用 `player_t *`，只有小结构体（≤16 字节，两个寄存器能装下）才值得值传递**。返回结构体是合法且常用的小技巧——小型坐标、复数之类直接按值返回，编译器用寄存器传递，零成本：

```c
typedef struct { int x, y; } point_t;
point_t add(point_t a, point_t b) { return (point_t){a.x + b.x, a.y + b.y}; }
```

## 2. 对齐与填充：逐字节推演

### 2.1 对齐要求从哪来

硬件访问内存有「自然对齐」偏好：4 字节的 int 希望地址是 4 的倍数，8 字节的 double 希望 8 的倍数。x86 上未对齐访问只是变慢；某些 ARM 平台与多数 DSP 上**直接崩溃**。编译器据此给每个类型一个**对齐要求**（alignment），保证成员永远落在合法地址上——代价是插入**填充字节**（padding）。

### 2.2 推演规则：两条

1. 每个成员放在「自身对齐要求的倍数」地址上，放不下就先垫。
2. 结构体总大小对齐到**最大成员对齐**（因为数组里下一个元素的第一个成员也要对齐）。

逐字节推演一个经典例子：

```c
struct A {           /* 推演过程（8 字节对齐的 double） */
    char  c;         /* offset 0 */
                      /* 1~7：填充 7 字节（double 要求 8 对齐） */
    double d;        /* offset 8，占 8~15 */
    short s;         /* offset 16，占 16~17 */
                      /* 18~23：尾部填充 6 字节（总大小对齐到 8） */
};
/* sizeof(struct A) == 24，其中 13 字节是填充 */
```

只调整成员顺序，同一个信息量压到 16 字节：

```c
struct B {
    double d;        /* 0~7 */
    short s;         /* 8~9，10~11 填 2 字节 */
    char  c;         /* 12，13~15 填 3 字节 */
};
/* sizeof(struct B) == 16：从大到小排，填充最少 */
```

**成员从大到小排列**是 C 结构体的黄金法则。还有一个极限情况——全 char 结构体：

```c
struct AllChar { char a, b, c; };   /* 无对齐需求 → 无填充 → sizeof == 3 */
```

### 2.3 offsetof：结构体内部的坐标系统

`offsetof(type, member)` 返回成员的字节偏移，是写通用容器、序列化代码的尺子：

```c
#include <stddef.h>
printf("%zu %zu %zu\n",
       offsetof(struct B, d), offsetof(struct B, s), offsetof(struct B, c));
/* 0 8 12 —— 与手推一致 */
```

尾部填充为什么必须算进 sizeof？反证：如果 `sizeof(struct A)` 是 18（不含尾部填充），那么 `struct A arr[10]` 里 `arr[1]` 的地址 = 首地址 + 18，d 的偏移 8 落在 18+8=26，不是 8 的倍数——对齐被数组破坏。**尾部填充是数组正确性的代价**。

> [!TIP]
> 内存敏感的大数组场景（百万级元素），成员排序可省 30%+ 内存，而且省的是**缓存占用**——间接优化了访问速度。顺手用 `_Static_assert(sizeof(struct B) == 16, "layout changed")` 把布局钉死在编译期（C11）。

## 3. 位域：以位为单位的成员

```c
struct flags {
    unsigned int visible : 1;
    unsigned int editable : 1;
    unsigned int level   : 3;      /* 0~7 */
    unsigned int          : 0;     /* 匿名零宽位域：对齐到下一个 unsigned 边界 */
    unsigned int extra   : 2;
};
```

位域 vs 手工位运算（`x & MASK`、`x >> shift`）的取舍：位域可读性好、由编译器管偏移；但**布局完全由实现定义**（位的顺序、跨字节行为、有符号位域的符号性都不可移植），且不能取地址。结论：**内部状态标志用位域，二进制协议/文件格式用显式位运算**——后者必须精确到比特，不能交给实现自由发挥。

## 4. 联合体：同一块内存的多种读法

union 的所有成员**共享同一块存储**，大小等于最大成员：

```c
union word {
    uint32_t u32;
    uint16_t u16[2];
    uint8_t  u8[4];
};   /* sizeof == 4 */

union word w = {.u32 = 0x11223344};
w.u8[0];                      /* 小端机器上是 0x44：最低字节在最低地址 */
```

这正是[第 1 篇](01-c-model.md)字节序观察的标准姿势。但要理解它的合法边界：**读非活跃成员在 C 里是「实现定义」**（多数编译器按「读那几个字节的当前值」处理，但严格按标准这是灰色地带；C++ 则明确非法）。安全且可移植的类型双关只有两条通道：

```c
/* 通道①：memcpy —— 编译器认识它，优化后无拷贝开销 */
double d = 1.5;
uint64_t bits;
memcpy(&bits, &d, sizeof bits);        /* 看浮点的位模式 */

/* 通道②：union 读写「活跃成员」再换活跃成员（写后读合法，读后直接读另一成员是实现定义） */
```

「strict aliasing」规则（下节）禁止的是**第三条路**——用裸指针强转去读另一种类型，union 和 memcpy 正是为此存在的合法通道。

### 4.1 tagged union：C 的「多态」结构

联合体最常见的用途是**变体类型**：一个类型标签 + 共享存储，这是 C 表达「这个值是几种形状之一」的唯一手段——JSON 值、编译器 AST、状态机事件，全是它：

```c
typedef enum { V_INT, V_STR, V_ARR } vtype_t;

typedef struct value {
    vtype_t type;                    /* 标签： Discriminator */
    union {
        long   i;
        char  *s;
        struct value **arr;          /* 数组：指针数组 */
    } as;
} value_t;

void value_free(value_t *v) {
    switch (v->type) {               /* 标签决定如何解读与释放 */
    case V_INT:                                  break;
    case V_STR: free(v->as.s);                   break;
    case V_ARR:
        for (value_t **p = v->as.arr; *p; ++p) value_free(*p);
        free(v->as.arr);                          break;
    }
}
```

「先读标签、再按标签读联合体」是 tagged union 的全部纪律——**标签与数据必须同时更新、永远一致**。漏更新标签的后果：V_STR 的标签配着 int 的数据，`value_free` 去 free 一个整数——随机崩溃。

## 5. 严格别名：指针强转的红线

编译器有权假设：**一个 `double*` 和一个 `int*` 不会指向同一块内存**（它们是不同类型，「别名」不成立）。基于这个假设它能放手优化——把通过 `double*` 的写入推迟、把通过 `int*` 的读取提前、直接缓存进寄存器。你用强转破坏这个假设，优化后代码的语义就碎了：

```c
float f = 1.0f;
uint32_t bits = *(uint32_t *)&f;    /* ❌ 经典「指针强转读位模式」：违反严格别名 */
/* -O2 下这条读可能拿到寄存器里的旧值——不是 float 的位模式 */
```

合法通道总结：

| 通道                        | 合法性          |
| ------------------------- | ------------ |
| `memcpy` 进出（编译器内联优化掉）     | ✅ 唯一全场景安全     |
| 通过 `unsigned char*`/`char*` 访问任意对象 | ✅ 标准明文豁免 |
| union 成员间访问（写活跃成员后读另一个）   | ⚠️ C 实现普遍支持，标准灰色 |
| 相同类型 / 有符号无符号对应类型间         | ✅             |
| **不同对象类型指针强转后解引用**         | ❌ UB，`-O2` 必炸 |

工程结论：代码里有 `*(T*)&x` 这种写法，一律换成 memcpy 或 union；大型项目（内核、旧游戏引擎）常常干脆 `-fno-strict-aliasing` 放弃这个优化——那是历史包袱的妥协，新代码不要依赖它。

## 6. 不透明结构体与柔性数组成员

### 6.1 不透明指针：C 的「类」

[第 6 篇](06-scope-lifetime.md)的环形缓冲区示例已经用了这个模式：头文件里只有 `typedef struct ring ring;`，结构的完整定义锁在 .c 里。调用方拿着指针操作，永远看不见内部字段——修改实现不用重编调用方，封装强度堪比面向对象的 private。这是 C 设计模块接口的首选形态。

### 6.2 柔性数组成员：一次分配装下「头 + 数据」

```c
typedef struct {
    size_t len;
    char   data[];              /* 柔性数组成员（C99）：不占 sizeof 空间 */
} strbuf_t;

strbuf_t *sb = malloc(sizeof(strbuf_t) + n + 1);   /* 头 + 数据一次分配 */
sb->len = n;
memcpy(sb->data, src, n + 1);
```

相比「结构体里放 `char *data` 再分两次 malloc」，柔性数组的优势：**一次分配一次释放**（不会忘释放数据区）、数据紧贴头部（缓存友好）、没有第二个指针的 8 字节开销。这是 C 里实现「变长对象」（动态字符串、变长包、AST 节点）的标准结构——`struct sockaddr`、内核的许多结构都这么设计。

## 7. 与外部世界对齐：packed 的正确与错误

把 C 结构体直接映射到**文件格式或网络协议**时，填充字节是灾难——协议里的字段是紧凑的，你的结构体却有洞。两种做法的对照：

```c
/* ❌ 错误做法：packed 后直接把 recv 的字节流 cast 成结构体 */
#pragma pack(push, 1)
typedef struct {
    uint8_t  type;
    uint32_t length;      /* packed：紧贴 type，offset 1 —— 未对齐！ */
    uint16_t flags;
} msg_hdr_t;
#pragma pack(pop)

msg_hdr_t *h = (msg_hdr_t *)buf;      /* buf 来自网络 */
h->length;                            /* 未对齐读：x86 变慢，部分 ARM 崩溃 */
/* 还有个更深的坑：length 是本机字节序，网络字节序是大端！ */
```

packed 结构体的三个问题：**未对齐访问**（可移植性/性能）、**字节序**（协议是大端、你是小端）、**隐藏填充假设**（不同编译器对 packed 的实现细节有差）。**正确做法是逐字段序列化**——这是所有健壮网络代码的实际写法：

```c
/* 逐字段编码/解码：不依赖结构体布局，字节序显式处理 */
void encode_hdr(uint8_t *out, const msg_hdr_t *h) {
    out[0] = h->type;
    out[1] = (uint8_t)(h->length >> 24);   /* 大端：高字节在前 */
    out[2] = (uint8_t)(h->length >> 16);
    out[3] = (uint8_t)(h->length >> 8);
    out[4] = (uint8_t)(h->length);
    out[5] = (uint8_t)(h->flags >> 8);
    out[6] = (uint8_t)(h->flags);
}
```

packed 结构体**合法的使用场景**：与既有硬件寄存器映射（嵌入式 MMIO）、读取只在本机处理的缓存文件、以及性能敏感但已确认平台行为的内部数据。跨机器的协议，永远逐字段。

## 8. 陷阱清单

- 结构体浅拷贝共享堆指针：定义 clone 或文档声明所有权。
- 大结构体按值传参：整体拷贝；const 指针是默认姿势。
- 成员乱序造成 padding 膨胀：从大到小排列；`_Static_assert` 钉住关键布局。
- 以为 `sizeof` 不含尾部填充：数组布局要求总大小对齐。
- 位域用于协议/文件格式：布局实现定义；协议用显式位运算。
- 读 union 非活跃成员（C 标准灰色地带）：跨类型观察用 memcpy。
- `*(uint32_t*)&float_var`：违反严格别名，`-O2` 下错值；memcpy/union。
- tagged union 的标签与数据不同步：封装「设置」函数，一处更新。
- packed 结构体 cast 网络缓冲区：未对齐 + 字节序双重错误；逐字段序列化。
- 柔性数组成员 `sizeof` 忘了加数据区：`malloc(sizeof(*p) + n)`。
- 取位域地址或对 union 成员取地址后再偏移：非法或破坏对齐。

## 9. 小结

- 结构体是值语义的聚合：整体赋值是浅拷贝，内含指针时所有权必须显式设计；传参默认 const 指针，小结构体才按值。
- 对齐与填充的两条规则（成员对齐、总大小对齐到最大成员）可以推导一切布局问题；成员从大到小排是黄金法则；offsetof 与 `_Static_assert(sizeof==)` 是布局的尺子与锁。
- 位域适合内部标志（可读性），不适合协议布局（可移植性）；后者用显式位运算。
- union 的本分是 tagged union（变体类型）与字节级观察；跨类型双关的合法通道只有 memcpy 与「union 写活跃成员」；裸指针强转是严格别名红线。
- 不透明结构体是 C 的类封装；柔性数组成员让「头 + 变长数据」一次分配，是变长对象的标准结构。
- 与外部格式交互时，packed 直接 cast 是「未对齐 + 字节序」双重错误的来源；逐字段序列化才是正确姿势。

## 10. 练习

**1.** 手推下列结构体的 sizeof 与每个成员的 offsetof（64 位平台），然后用程序验证。

```c
struct A { char c; int i; char c2; };
struct B { int i; char c; char c2; };
struct C { char c; double d; short s; };
struct D { double d; short s; char c; };
```

> [!TIP]
> 思路 A：c@0，填 3，i@4，c2@8，尾填 3 → 12。B：i@0，c@4，c2@5，尾填 2 → 8。C：c@0，填 7，d@8，s@16，尾填 6 → 24。D：d@0，s@8，c@10，尾填 5 → 16。B 与 D 是「从大到小」的反例与正例对照：同样三个成员，8 字节 vs 16/12 字节。

**2.** 实现一个 tagged union 的 JSON 子集（int/double/string/bool/null 五种），提供构造、打印、释放三个函数。重点：构造函数如何保证「标签-数据」一致性？

> [!TIP]
> 思路每个构造函数（`jv_int(long)`、`jv_str(const char*)`）各自负责填标签和对应成员，外部无法直接构造（不透明？或至少文档约定）。释放用 switch。一致性来自「构造入口唯一」——这就是把不变量锁进模块边界的思想。

**3.** 用 memcpy 实现安全快速平方根的位技巧（快速逆平方根的现代正确写法）：把 float 的位模式当整数做近似，再牛顿迭代。对照原始雷神之锤代码 `*(long*)&f` 指出违反别名之处。

> [!TIP]
> 思路 `uint32_t i; memcpy(&i, &f, 4); i = 0x5f3759df - (i >> 1); memcpy(&f, &i, 4);` 三次近似迭代。原代码的两个 UB：严格别名违反 + 读未初始化成员/有效类型问题。数学结论不变，合法性由 memcpy 恢复——现代编译器会把 memcpy 优化成零成本的寄存器移动。

**4.** 一个「玩家」结构体含：`bool alive`、`int hp`、`char name[16]`、`double x, y`。排出最优成员顺序，计算 sizeof，并说明省了多少内存（与声明顺序版本对比）。

> [!TIP]
> 思路按从大到小：x, y（各 8）、hp（4）、alive（1）、name[16]（1 对齐，char 数组无需对齐）→ 8+8+4+1+16 = 37，总大小对齐到 8 → 40。原始顺序（alive@0，填 3，hp@4，name@8，x@24，y@32）→ 40，恰好相同？验证：name 结束于 24，已 8 对齐 → 也是 40。结论：**排序不是万能，推演才是**——先算再排，别背规则。

**5.** 设计一个「协议帧」的编解码器：`| type(1) | seq(2, 大端) | len(2, 大端) | payload(len 字节) |`，给出 encode/decode 函数与全部边界检查（长度不足、len 与实际不符）。

> [!TIP]
> 思路 decode 签名 `int decode(const uint8_t *buf, size_t buflen, frame_t *out)`：先检查 buflen ≥ 5（固定头），再读 len 检查 `buflen - 5 >= len`，逐字段 `buf[1]<<8 | buf[2]` 拼大端。要点：两段长度检查（头、体）各自独立，绝不信包内长度而不对照实际收到的长度——这是协议解析的安全基线（防「声明长度」攻击）。

**6.** 解释为什么 `struct { char *data; }` + 两次 malloc 的方案在「分配失败中途」会产生不一致，而柔性数组成员方案不会。

> [!TIP]
> 思路两步分配：第一步成功、第二步失败 → 结构体里 data 指针悬空/未设置，错误处理路径要「回滚已分配的部分」。柔性数组一次分配：要么全成要么全败，失败时只有一个 free(NULL) 级别的操作。原子性是「一次分配」的隐藏优点——错误路径的复杂度减半。
