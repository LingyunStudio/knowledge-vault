---
title: 预处理器：在编译之前的另一门语言
order: 11
tags: 宏, 条件编译, X-Macro, do-while(0), 字符串化
summary: 函数式宏的展开机制与括号纪律、双重求值的展开演示、多语句宏为什么要 do-while(0)、条件编译的四种用职责分离、以及 X-Macro 如何用一份列表生成枚举/字符串表/处理函数。
---

预处理器不是 C。它是一台**纯文本引擎**，在编译器看到代码之前完成替换：粘贴文件（`#include`）、替换记号（`#define`）、裁剪代码（`#if`）。它不理解类型、作用域、表达式——这既是它的问题根源（替换出来的东西类型对不对它不管），也是它的力量来源（C 类型系统做不到的「按文本生成代码」它能做）。

用对预处理器 = 把它限制在三类工作里：**条件编译、按文本生成重复结构（X-Macro）、编译期诊断**。把它当函数语言用（用宏写「函数」），每一处都在积累未来的事故。本篇先把宏的展开机制讲到底——理解了展开过程，所有宏陷阱都能自己推导，不需要背。

## 1. 宏展开的机械过程

### 1.1 括号纪律：三条规则与一次完整展开

函数式宏是**参数文本替换**，不是参数求值。展开规则决定了它的第一戒律：**每个参数出现处都加括号，整个替换体也加括号**：

```c
#define BAD_SQUARE(x)   x * x
#define GOOD_SQUARE(x)  ((x) * (x))

int r1 = BAD_SQUARE(2 + 3);
/* 展开：2 + 3 * 2 + 3   →  11   （乘法先于加法，参数裸奔被吃掉） */

int r2 = GOOD_SQUARE(2 + 3);
/* 展开：((2 + 3) * (2 + 3)) → 25 */
```

再看「整体括号」为什么也要：`#define NEG(x) -(x)` 遇到 `NEG(a) - b` 没问题，但 `#define HALF(x) (x) / 2` 遇到 `HALF(a) + b` 会展开成 `(a) / 2 + b`——如果本意是 `(a + b) / 2` 类似的嵌套场景，运算符优先级再次穿透。没有整体括号的宏，在任何「被更大表达式包围」的场合都是赌局。

### 1.2 双重求值：宏参数出现两次就求值两次

```c
#define MAX(a, b) ((a) > (b) ? (a) : (b))

int i = 3, j = 5;
int m = MAX(i++, j++);
/* 展开：((i++) > (j++) ? (i++) : (j++))
   ① 比较：i=4, j=6
   ② 取胜者：j 侧再自增一次 → j=7
   ③ 结果 m = 6，但 i、j 的最终值取决于实现选择的结果分支——修改了两次！ */
```

MAX 参数带副作用是**未定义行为级别的代码**（[第 3 篇](03-operators-control.md)的求值顺序问题 + 自增两次）。这个陷阱没有任何语法层面的防御，只有两条路：

```c
/* 路①：调用侧纪律——宏参数只传纯表达式 */
int m = (i > j) ? i : j;          /* 干脆手写 */

/* 路②：GCC/Clang 扩展（typeof）：每个参数只求值一次 */
#define MAX(a, b) ({          \
    __typeof__(a) _a = (a);   \
    __typeof__(b) _b = (b);   \
    _a > _b ? _a : _b;        \
})
```

语句表达式扩展（`({...})`）不可移植到 MSVC，Linux 内核与多数系统代码用得起；跨平台库老实用路①或写成 `static inline` 函数。

### 1.3 # 与 ##：字符串化与记号拼接

两个专属于宏的运算符，普通 C 语法里不存在：

```c
#define STR(x)   #x                  /* 参数变字符串字面量 */
#define XSTR(x)  STR(x)              /* 两层：先展开 x 再字符串化 */
#define CAT(a, b) a##b               /* 记号拼接 */

STR(abc)          → "abc"
XSTR(__LINE__)    → "42"（先展开成行号再字符串化——单层 STR 会得到 "__LINE__"）
CAT(var, 1)       → var1
```

`XSTR` 的两层结构是关键模式：**需要「先展开再处理」时必须经过中间宏**——单层宏的 `#` 会把参数当作字面文本。这个模式在诊断信息与 X-Macro（第 4 节）里都是承重墙：

```c
#define CHECK(cond) do { \
    if (!(cond)) fprintf(stderr, "%s:%d: check failed: %s\n", \
                         __FILE__, __LINE__, #cond); \
} while (0)
/* #cond 让断言失败信息自动携带表达式原文——这是字符串化的招牌用法 */
```

## 2. 多语句宏：do-while(0) 的两个理由

宏要包含多条语句时，「花括号包起来」不够：

```c
#define SWAP_INT(a, b) { int _t = (a); (a) = (b); (b) = _t; }

if (x > y)
    SWAP_INT(x, y);
else
    x = 0;
/* 展开后：
   if (x > y)
       { int _t = x; x = y; y = _t; };    ← 多出的分号！
   else                                    ← else 没有配对的 if：编译错误 */
```

多出的分号让 `if` 分支被空语句终结，`else` 悬空。标准解法：

```c
#define SWAP_INT(a, b) do { int _t = (a); (a) = (b); (b) = _t; } while (0)
```

`do { ... } while (0)` 的两个妙处：**整体是一条语句**（外层加分号合法、if/else 完好），且**强制宏调用写分号**（看起来像函数调用）。它不产生循环开销（编译器折叠常量条件），是所有标准库多语句宏的统一形态。

## 3. 条件编译：四种职责，不要混用

`#if` 家族在**预处理期**裁剪源代码，被裁掉的部分根本不进编译器——这是它与 `if (0)` 的本质区别（后者仍要语法正确）：

```c
/* 职责①：头文件保护（第 10 篇） */
#ifndef MYAPP_LIST_H
#define MYAPP_LIST_H
#endif

/* 职责②：平台分支 */
#ifdef _WIN32
#  include <windows.h>
#elif defined(__linux__)
#  include <unistd.h>
#endif

/* 职责③：特性开关（构建时决定功能存在与否） */
#ifdef HAVE_ZSTD
    ...zstd 压缩路径...
#else
    ...降级路径...
#endif

/* 职责④：调试断言（与 NDEBUG 配合，见第 10 篇三套配置） */
#ifndef NDEBUG
#  define DBG_LOG(...) fprintf(stderr, __VA_ARGS__)
#else
#  define DBG_LOG(...) ((void)0)      /* 发布版无声消失，调用处语法不变 */
#endif
```

三条纪律：

1. **平台/特性判断交给构建系统**，源码里只写「 HAVE_X 有没有」的结果，不写探测逻辑（`#if defined(__linux__) && !defined(__ANDROID__) && ...` 的嵌套地狱是可移植性的坟场——用 CMake/configure 生成一个 config.h 集中定义 HAVE_*）。
2. **发布消失的代码要保持可编译**：`#if 0` 屏蔽的代码块会腐烂成永久无效（语法都过不了），真正该删的代码进 git 历史，不该删的用特性开关。
3. **`#if` 里只做整型常量判断**，别用它做「宏版的模板」——那是 X-Macro 的领域（下节）。

## 4. X-Macro：一份列表，N 份产物

X-Macro 是 C 元编程的巅峰形态：**把「数据列表」定义成宏，每 include 一次就生成一份不同的产物**。典型场景：错误码需要「枚举、字符串表、有效性判断」三份同步的产物——手写三份必然漂移，X-Macro 永远一致：

```c
/* errors.def —— 唯一的真相源 */
#define ERROR_LIST(X)      \
    X(ERR_OK,      0, "ok") \
    X(ERR_NOMEM,   1, "out of memory") \
    X(ERR_IO,      2, "io error") \
    X(ERR_ARGS,    3, "bad argument")

/* 产物①：枚举 */
enum err_code {
#define X(name, num, str) name = num,
    ERROR_LIST(X)
#undef X
};

/* 产物②：字符串表 */
const char *err_str(enum err_code e) {
    static const char *tbl[] = {
#define X(name, num, str) str,
        ERROR_LIST(X)
#undef X
    };
    return tbl[e];
}

/* 产物③：合法性判断 */
int err_valid(int v) {
    switch (v) {
#define X(name, num, str) case num: return 1;
        ERROR_LIST(X)
#undef X
    default: return 0;
    }
}
```

新增一种错误时，**只改 errors.def 一行**，三份产物同时更新——枚举、字符串、判断不可能漂移。GCC 内部、协议解析器、状态机实现里到处是它。理解三步就能读懂任何 X-Macro：**定义列表宏 → 以不同「X 的实现」展开 → #undef 清场**。

> [!TIP]
> X-Macro 的可调试性弱点：错误信息指向「展开处」而不是「列表项」。大型项目的折中：核心同步结构（错误码、寄存器名、opcode 表）用 X-Macro，日常代码不用。判断标准：**这个列表是否必须多处同步？** 是 → X-Macro 收益巨大；否 → 老实写普通代码。

## 5. 宏 vs 函数 vs 常量：一张决策表

现代 C 里，宏的「传统地盘」大部分该让给更安全的设施：

| 需求            | ❌ 旧写法（宏）                    | ✅ 现代写法                                    | 理由                    |
| ------------- | --------------------------- | ----------------------------------------- | --------------------- |
| 整型常量          | `#define SIZE 10`           | `enum { SIZE = 10 };`                     | enum 有作用域、进符号表、能调试     |
| 浮点/字符串常量      | `#define PI 3.14`           | `const double pi = 3.14;` / `static const char *` | 有类型、有作用域               |
| 简单函数          | `#define MAX(a,b) ...`      | `static inline int max(int a, int b)`     | 类型检查、单次求值、可调试          |
| 类型通用的简单操作     | 函数式宏                        | `_Generic`（C11）或宏 + 显式约定                    | `_Generic` 按类型分发，仍无类型检查 |
| 多语句组合         | 多条语句宏                       | `static inline` 函数                        | 完全消除 do-while(0) 问题     |
| 条件编译/平台分支     | （合理用途）                      | `#ifdef` + 构建系统生成 config.h                 | 预处理器的本职                |
| 重复结构生成        | （合理用途）                      | X-Macro                                    | 文本生成的不可替代场景            |
| 编译期断言         | 数组负尺寸黑科技                    | `_Static_assert(cond, "msg")`（C11）         | 标准化、错误信息清晰             |

`_Generic` 值得认识一下——C11 的「按表达式类型选择」，让类型安全的宏成为可能：

```c
#define type_name(x) _Generic((x),      \
    int:     "int",                     \
    double:  "double",                  \
    char *:  "char *",                  \
    default: "other")

type_name(3);        /* 展开为 "int"——编译期选择，零运行时成本 */
```

## 6. 陷阱清单

- 宏参数不加括号 / 整体不加括号：优先级穿透；三条括号纪律。
- 宏参数出现两次 + 带副作用：双重求值；MAX(i++, j++) 级别事故。
- 多语句宏不用 do-while(0)：if/else 悬空编译错或逻辑错。
- 用 `#define` 定义常量：无类型无作用域；enum（整型）与 const 变量（其他）。
- 单层 `#x` 想展开后再字符串化：需要 XSTR 两层结构。
- `#if 0` 屏蔽代码永久腐烂：删除或特性开关，别囤积死代码。
- 源码里写平台探测嵌套：交给构建系统生成 config.h。
- 宏名与函数名相同：宏在 include 之后定义会替换所有函数调用；宏名全大写是最后防线。
- `__FILE__/__LINE__` 用于日志很好，但别把行号写进持久化数据（代码一动就漂移）。
- 递归宏：预处理器不会无限展开自身（蓝色画笔规则），但间接递归同样受限——别指望宏做递归计算。

## 7. 小结

- 预处理器是编译前的文本引擎：粘贴、替换、裁剪；它不理解类型与作用域，力量与危险都来自「文本替换」。
- 函数式宏的展开机制推导出全部陷阱：括号纪律（参数与整体）、双重求值（参数出现两次且带副作用）、`#`/`##` 与两层展开（XSTR 模式）。
- 多语句宏的标准形态是 `do { ... } while (0)`：整体成为单条语句、强制调用处分号。
- 条件编译的四个正当职责（头保护、平台、特性、调试）各配一种纪律；探测逻辑归构建系统，死代码不留 `#if 0`。
- X-Macro 用一份列表生成枚举/字符串表/处理函数等多份产物，是「必须多处同步的列表」的终极解法；判断标准是「同步必要性」。
- 现代 C 里常量归 enum/const，简单函数归 static inline，类型分发归 `_Generic`，编译断言归 `_Static_assert`——宏的残余地盘是条件编译、X-Macro 与诊断字符串化。

## 8. 练习

**1.** 手动展开 `MUL(a + 1, b) * MUL(2, 3)`，其中 `#define MUL(x, y) x * y`，写出完整展开文本与最终值；再写出正确版本宏的定义。

> [!TIP]
> 思路展开：`a + 1 * b * 2 * 3` = `a + 6b`——乘法优先级把一切改写。正确版本 `#define MUL(x, y) ((x) * (y))` 展开为 `((a + 1) * (b)) * ((2) * (3))`。这道题是括号纪律的完整推演：所有括号缺一不可。

**2.** 实现 `LOG(fmt, ...)` 宏：带 `__FILE__`、`__LINE__`、函数名前缀，DEBUG 构建输出到 stderr、发布版完全消失。解释 `__VA_ARGS__` 与空参数的一个坑（`##__VA_ARGS__` 的作用）。

> [!TIP]
> 思路 `#define LOG(fmt, ...) fprintf(stderr, "[%s:%d %s] " fmt, __FILE__, __LINE__, __func__, ##__VA_ARGS__)`。坑：调用 `LOG("hi")` 时可变参数为空，严格语法要求 `fmt` 后必须还有参数——GNU 的 `##__VA_ARGS__` 吃掉多余逗号；C23 起标准 `__VA_OPT__` 是可移植方案。

**3.** 用 X-Macro 实现状态机：状态列表（IDLE/RUNNING/DONE）同时生成枚举、状态名表、以及「状态 → 处理函数」的表。新增一个状态，数一数要改几处。

> [!TIP]
> 思路列表宏 `#define STATE_LIST(X) X(IDLE, idle_fn) X(RUNNING, run_fn) X(DONE, done_fn)`，三份产物如第 4 节展开。新增状态只改列表一行——三个产物同步。对比手写三份的版本（漏一处就是「状态跑着名字却显示 UNKNOWN」级别的 bug）。

**4.** 把下面的宏全部替换为更安全的设施，并说明每一处的收益。

```c
#define PI 3.14159
#define ABS(x) ((x) < 0 ? -(x) : (x))
#define ARRAY_LEN(a) (sizeof(a) / sizeof((a)[0]))
#define DEBUG_DUMP(x) printf("%s = %d\n", #x, (int)(x))
```

> [!TIP]
> 思路 PI → `static const double pi = 3.14159;`（类型与作用域）。ABS → `static inline int abs_i(int)` 或对浮点 `_Generic` 分发（单次求值、类型安全）。ARRAY_LEN 是宏的合理残留（sizeof 无法写成函数），但加 `_Static_assert` 变体或对指针告警（GCC 的 `__builtin_types_compatible_p` 技巧）。DEBUG_DUMP 保留宏（需要 # 字符串化与 NDEBUG 消失），这正是宏不可替代的场景——答案不是「消灭所有宏」，是「用对工具」。

**5.** 解释 do-while(0) 宏在 `if (c) SWAP(a,b); else x=1;` 中为什么安全，并写出它的完整展开。

> [!TIP]
> 思路展开为 `if (c) do { ... } while (0); else x = 1;`——do-while 是一条完整语句，后面分号是它的终结符，else 与 if 正常配对。对比花括号版本多出的空语句导致的 else 悬空（第 2 节例）。这也说明「宏应该是表达式或单条语句」的深层原因：调用处不知道宏内部有几条语句。

**6.** 用 `_Generic` 实现类型安全的 `PRINT(x)`：int 用 %d、double 用 %g、字符串用 %s。说明它相比函数式宏的类型安全增益在哪里。

> [!TIP]
> 思路 `#define PRINT(x) _Generic((x), int: print_int, double: print_dbl, char*: print_str)(x)`——编译期按类型选中具体函数再调用。增益：传错类型时是**编译错误**（没有匹配分支）或落到正确分支，而不是 printf 格式串的运行时垃圾。`_Generic` 是 C 里最接近重载的设施，但选择发生在编译期、零开销。
