---
title: 函数指针：把行为变成数据
order: 9
tags: 函数指针, 回调, qsort, 函数表, void*上下文
summary: 函数指针的声明语法与类型精确匹配、qsort 比较函数的泛型实战、回调 + void* 上下文这一对惯用法如何替代闭包、函数表驱动的命令分发与状态机，以及间接调用的性能代价与函数指针的工程纪律。
---

函数指针做的事只有一件：**把「一段行为」变成可以存进变量、传进参数、放进数组的数据**。有了它，排序算法可以不关心「怎么比较两个元素」（调用者给），事件循环可以不关心「事件来了干什么」（注册者给），命令解释器可以不写 switch（查表跳转）。

C 没有闭包、没有接口、没有虚函数——但标准库的 `qsort`、libc 的信号处理、内核的驱动操作表、所有 C 写的框架，都在用同一个组合拳：**函数指针 + `void *` 上下文**。掌握这一对，你就掌握了 C 的全部「面向对象」。

## 1. 语法：读对声明，一切就好

函数指针声明的完整形态：

```c
int add(int a, int b) { return a + b; }

int (*fp)(int, int) = add;     /* fp 是指针，指向 int(int,int) 的函数 */
int r = fp(3, 4);              /* 通过指针调用：7 */
```

声明的读法与变量声明一致——**从名字出发，先看括号里的 `*`（它是指针），再看右侧参数表（指向函数），再看左侧返回类型**。三个容易混淆的近亲：

```c
int (*fp)(int);        /* 函数指针：指向 int(int) */
int *fn(int);          /* 普通函数：返回 int*（括号没包住名字） */
int (*arr[4])(int);    /* 函数指针数组：4 个函数指针 */
```

两个语法事实让日常书写减负：

1. **取址符可省**：`fp = add` 与 `fp = &add` 完全等价（函数名在表达式中自动退化成指针，和数组退化同款逻辑）。
2. **解引用可省**：`fp(3,4)` 与 `(*fp)(3,4)` 等价。惯用简写 `fp(...)`。

类型必须**精确匹配**——返回类型与每个参数都算数，`int (*)(long)` 与 `int (*)(int)` 是不同类型，隐式转换不存在。不匹配时编译器报错（或警告后运行时炸调用栈）——函数指针的类型安全是 C 里少有的严格检查，别用 cast 绕过它。

可读性的关键一步是 **typedef 掉语法噪音**：

```c
typedef int (*cmp_fn)(const void *, const void *);
typedef void (*event_fn)(void *ctx, int event);

cmp_fn  fp = my_compare;        /* 从此像普通类型一样读写 */
event_fn table[EVENT_MAX];
```

## 2. qsort：泛型编程的 C 形态

标准库最著名的函数指针用户，也是「回调 + 泛型指针」组合的教科书：

```c
void qsort(void *base, size_t nmemb, size_t size,
           int (*compar)(const void *, const void *));
```

四个参数的分工：数据首地址、元素个数、**单个元素的字节数**（泛型靠它计算步长）、比较函数。写一个比较器排序 int：

```c
#include <stdlib.h>

int cmp_int(const void *a, const void *b) {
    int x = *(const int *)a;            /* void* → 具体类型 → 解引用 */
    int y = *(const int *)b;
    return (x > y) - (x < y);           /* ✅ 规范写法：返回符号，避免减法溢出 */
}

int arr[] = {5, 2, 8, 1};
qsort(arr, 4, sizeof arr[0], cmp_int);
```

三个必须内化的细节：

1. **比较器返回「符号」而非差值**：`return x - y` 在 INT_MIN 到 INT_MAX 的边界处溢出（[第 2 篇](02-types.md)），`(x > y) - (x < y)` 永远返回 −1/0/1。
2. **排序稳定性**：qsort **不保证稳定**（相等元素的相对顺序可能变）。需要稳定排序用归并或给每个元素附加原始序号做次级键。
3. **每个元素两次函数调用**：比较器是间接调用且每次重转型——对千万级排序，比较器本身是热点。性能方案见第 6 节。

### 2.1 比较器需要额外数据怎么办：ctx 的诞生

排序结构体数组，想按「到某点的距离」排——距离的原点不在参数里。qsort 没有上下文参数（历史接口），标准解法是**把上下文打包进全局或排序前的结构体**；带上下文的现代接口（如 `qsort_r`，GNU 扩展）长这样：

```c
typedef struct { double x, y; } vec_t;

typedef struct { vec_t origin; } dist_ctx_t;

int cmp_dist_r(const void *a, const void *b, void *ctx) {
    const dist_ctx_t *c = ctx;
    double da = dist2(*(const vec_t *)a, c->origin);
    double db = dist2(*(const vec_t *)b, c->origin);
    return (da > db) - (da < db);
}

dist_ctx_t ctx = {.origin = {0, 0}};
qsort_r(pts, n, sizeof pts[0], cmp_dist_r, &ctx);   /* 最后一个参数就是 ctx */
```

**`void *ctx` 是 C 的闭包**：函数指针提供「行为」，ctx 提供「行为需要的环境变量」。这个二件套在所有 C 框架里反复出现——记住它，读任何 C 代码都不再有秘密。

## 3. 回调设计：遍历器与事件系统

### 3.1 回调式遍历：把「对每个元素做什么」交给调用者

C 的容器没有迭代器抽象，惯用「回调遍历」：

```c
typedef int (*visit_fn)(void *ctx, int item);
/* 返回非 0 表示「停止遍历」——回调版的 break */

int list_foreach(const node_t *head, visit_fn visit, void *ctx) {
    for (const node_t *p = head; p; p = p->next)
        if (visit(ctx, p->val) != 0)
            return 1;
    return 0;
}

/* 用法一：求和 */
static int add_cb(void *ctx, int item) { *(int *)ctx += item; return 0; }
int sum = 0;
list_foreach(head, add_cb, &sum);

/* 用法二：找第一个负数（用返回值提前终止） */
static int find_neg_cb(void *ctx, int item) {
    if (item < 0) { *(const int **)ctx = &item; return 1; }
    return 0;
}
```

回调遍历比「暴露内部节点结构」的方案封装更好：容器可以换实现（链表换数组）而调用代码不动——**回调就是 C 的接口层**。

### 3.2 事件系统：注册、分发、注销

```c
#define EVENT_MAX 8

typedef void (*handler_fn)(void *ctx, int event);

typedef struct {
    handler_fn handlers[EVENT_MAX];
    void      *ctx[EVENT_MAX];
} emitter_t;

int emitter_on(emitter_t *e, int event, handler_fn h, void *ctx) {
    if (event < 0 || event >= EVENT_MAX || !h) return -1;
    e->handlers[event] = h;      /* 简化：每事件一个处理器 */
    e->ctx[event] = ctx;
    return 0;
}

void emitter_emit(const emitter_t *e, int event) {
    if (event < 0 || event >= EVENT_MAX) return;
    handler_fn h = e->handlers[event];
    if (h) h(e->ctx[event], event);          /* 调用前判空：空槽位是常态 */
}
```

这段骨架就是几乎所有 C 事件驱动系统（GUI 框架、内核驱动、Redis 的网络层）的形态。三个工程要点：

1. **ctx 与 handler 成对存取**——注册时把「行为和环境」绑在一起，分发时成对取出。
2. **调用前必须判空**：解引用空函数指针与解引用空数据指针一样是 UB。
3. **回调里不得注销自己所在的槽**（迭代中修改注册表）——与「遍历容器时修改容器」同构的约束（[ds 篇](../ds/06-hash-table.md)的遍历修改问题在回调世界的投影）。

## 4. 函数表：switch 的替代品与状态机

命令分发最朴素的写法是 switch，命令一多就变成 500 行的巨型分支。函数表把「opcode → 行为」从控制流变成**数据**：

```c
typedef struct {
    const char *name;                         /* 命令名 */
    int        (*run)(int argc, char **argv); /* 行为 */
    const char *help;
} command_t;

static int cmd_add(int argc, char **argv)  { /* ... */ return 0; }
static int cmd_del(int argc, char **argv)  { /* ... */ return 0; }
static int cmd_list(int argc, char **argv) { /* ... */ return 0; }

static const command_t commands[] = {
    { "add",  cmd_add,  "add <item>    添加条目" },
    { "del",  cmd_del,  "del <id>      删除条目" },
    { "list", cmd_list, "list          列出全部" },
    { NULL, NULL, NULL },                     /* 哨兵：表结束 */
};

int dispatch(const char *name, int argc, char **argv) {
    for (const command_t *c = commands; c->name; ++c)
        if (strcmp(c->name, name) == 0)
            return c->run(argc, argv);
    return -1;                                /* 未知命令 */
}
```

「数据化的 switch」带来三个 switch 给不了的能力：**表可以运行时构建**（插件注册）、**元信息顺手可得**（help 直接遍历表生成）、**新增命令不碰分发器**（开闭原则的 C 版本）。函数指针数组做状态机同理——「状态 → 状态处理函数」一张表，状态迁移逻辑一目了然。

> [!TIP]
> 判断用 switch 还是函数表：分支固定且少（<10 个、纯跳转）→ switch（编译器能优化成跳转表）；分支会扩展、需要元数据、需要运行时注册 → 函数表。两者性能差距在现代 CPU 上通常无关紧要（间接分支预测很准），可读性与扩展性才是决策依据。

## 5. 细节与陷阱

**调用空函数指针 = UB**。所有回调入口判空（上节的 `if (h)`），所有赋值初始化为 NULL 或有效函数。

**函数指针之间只能比较相等**。`fp == cmp_int` 合法；`fp < fp2` 无意义（两个函数的地址顺序没有任何语义）。

**不同函数指针可以指向同一地址**——编译器可能把两个 identical 的函数合并（ICF 优化），所以「指针不等」不能证明「函数不同」。这个事实偶尔坑到「用函数指针当 map 键」的代码。

**typedef 是可读性的生死线**。裸写三层嵌套的函数指针类型（`int (*(*f)(int))(void)`）无人能读懂；一律 typedef。

**回调的错误处理没有标准答案**。回调返回错误码（调用方聚合）、回调内部自行处理、回调「永不失败」（纯函数）——在设计接口时**明说**选了哪种，混用是框架级混乱的源头。

## 6. 性能：间接调用的真实成本

函数指针调用的机器形态是 `call [寄存器/内存]`（间接调用），直接调用是 `call [相对偏移]`。差异有两层：

1. **内联被阻断**：直接调用编译器可以把被调函数内联进调用点消灭调用本身；间接调用不行——「每元素回调一次」的遍历在小数据量上比手写循环慢数倍。
2. **分支预测**：间接跳转若目标模式混乱（每次不同回调），预测失败惩罚 15~20 周期；目标固定（总是同一个函数）则几乎无惩罚。

所以性能敏感的**内层循环**（每迭代一次回调、数据量千万级）不用回调——qsort 慢于手写 int 排序 2~3 倍的原因主要就是这里。工程对策按优先级：

1. 外层分发用函数表（每次请求一次间接调用，无所谓），内层循环手写；
2. 热点排序用特化代码（radix sort、手写比较循环）而不是通用 qsort；
3. 真需要「泛型 + 快」：宏生成具体类型的代码（C 的泛型惯用法，`<bits/types.h>` 与内核的容器宏都这么干）。

## 7. 陷阱清单

- `int *fn(int)` 与 `int (*fp)(int)` 混淆：前者是返回指针的函数。
- 调用前不判空：空函数指针解引用 UB。
- 比较器 `return x - y`：减法溢出；用 `(x>y)-(x<y)`。
- 函数指针类型不匹配靠 cast 硬转：调用约定炸栈；类型必须精确一致。
- 回调里注销/重注册回调集合：迭代中修改；延后到分发结束。
- ctx 生命周期短于回调注册期：悬垂 ctx；注册表与 ctx 生命周期绑定。
- 用函数指针相等性判断「函数是否相同」：ICF 合并会让不同函数同地址。
- 排序依赖 qsort 稳定性：它不保证稳定；需要稳定就加次级键。
- 裸写复杂函数指针类型不用 typedef：可读性灾难。

## 8. 小结

- 函数指针把行为变成数据；声明从名字向外读，typedef 是可读性的必需品；`&` 与 `*` 在函数名/指针调用处都可省略。
- `qsort` 展示了 C 的泛型形态：`void*` + 元素尺寸 + 比较回调；比较器返回符号用 `(x>y)-(x<y)`，它不保证稳定。
- 「函数指针 + void* ctx」是 C 的闭包，遍历回调与事件系统是它的两个标准应用；调用前判空、ctx 与回调生命周期绑定是两条铁律。
- 函数表把 switch 变成数据：运行时可扩展、元信息免费、开闭原则；分支少而固定时 switch 仍是首选。
- 间接调用的成本主要是阻断内联；外层分发用回调、内层热点手写，是 C 的性能分层惯用法。

## 9. 练习

**1.** 声明一个「返回函数指针的函数」类型：`get_op(char c)` 返回接受两个 int 返回 int 的函数指针。先裸写声明，再用 typedef 重写，比较可读性。

> [!TIP]
> 思路裸声明 `int (*get_op(char c))(int, int);`（从 get_op 是函数开始，返回值是函数指针）。typedef 版：`typedef int (*binop)(int, int); binop get_op(char c);`。这个练习的真正目的是体会「从名字向外读」的声明解读法。

**2.** 实现 `int arr_count_if(const int *a, size_t n, int (*pred)(int))`，并用它分别统计偶数个数与绝对值大于 10 的个数。再回答：为什么 pred 不带 ctx？带 ctx 的版本签名该怎么改？

> [!TIP]
> 思路pred 只有 int 参数——判断逻辑需要的额外信息（阈值 10）只能写死或用全局。带上下文版本：`int (*pred)(const void *ctx, int item)`。这暴露了「无 ctx 回调」的能力天花板，也解释了 qsort_r 存在的原因。

**3.** 把第 3.1 节的回调遍历改成「生成器风格」：`node_t *list_next(iter_t *)`，比较两种遍历 API 的适用场景（回调式 vs 迭代器式）。

> [!TIP]
> 思路迭代器式把控制流还给调用者（可以在遍历中做任意事，包括删除节点、提前退出、嵌套遍历两个链表）；回调式封装强但控制流受限。需要交叉遍历、条件删除时迭代器胜出；纯只读操作回调更简洁。C 标准库偏回调式，内核链表（list_for_each）偏迭代器宏式。

**4.** 实现第 4 节的命令表并扩展：新增 help 命令（自动遍历 commands 表打印 help 字段）、以及「命令名前缀匹配」（输 `l` 也能命中 `list`）。扩展过程有没有改动 dispatch 核心？

> [!TIP]
> 思路没有——新能力全部加在表和数据结构上（help 就是遍历表元信息的函数；前缀匹配只改 strcmp 调用为 strncmp 或精确匹配失败后的第二遍扫描）。这就是「数据化控制流」的扩展性红利：核心不动，外围生长。

**5.** 基准测试：qsort 与手写插入排序对 10⁵ 个 int 的耗时对比（比较器相同），分别用 -O0 与 -O2 编译。解释差距的来源构成。

> [!TIP]
> 思路差距来源：①每元素两次间接调用（阻断内联、比较器无法展开）；②qsort 的字节级 swap（memcpy 按 size 移动）比 int 直接交换慢；③间接分支在随机数据上预测失败。-O2 下差距缩小但不消失；结论：泛型的代价在热点循环里必须用特化赎回。

**6.** 设计「带注销的事件系统」：emitter_off 移除注册，emitter_emit 时禁止回调内注销（返回错误码或标记延迟处理）。写出冲突场景的复现代码与你的解决方案。

> [!TIP]
> 思路冲突场景：事件 A 的处理器注销了事件 B 的处理器，而 emit 循环正拿着 B 的旧指针。方案①emit 前快照整个表（简单、O(n)）；②注销打标记、emit 后统一清理（延迟生效，语义是「本轮结束后生效」——Redis/UI 框架的常见选择）；③引用计数注册句柄。三者的复杂度与语义差异值得逐个想清楚。
