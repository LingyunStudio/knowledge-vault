---
title: 预处理器
order: 8
tags: 基础, 宏, 条件编译
summary: #define 与带参宏的陷阱、条件编译、include guard，编译之前发生的事。
---

预处理器在编译之前运行，它不认识 C 语法，只做一件事：**对文本做机械替换**。宏没有类型检查、没有作用域，威力大而坑深——用它的正确姿势是「知道它什么时候会背叛你」。

## 只是文本替换

`#define` 定义的都是「记号替换」，编译器看到代码时，宏早已被换掉了：

```c
#include <stdio.h>

#define MAX_USERS 100
#define GREETING "hello"

int main(void) {
    int users[MAX_USERS];    // 展开后就是 int users[100];
    users[0] = 1;
    printf(GREETING " %d\n", users[0]);   // 展开后就是 printf("hello" " %d\n", users[0]);
    return 0;
}
```

宏从定义处生效，直到 `#undef` 或文件结束。惯例：宏名全大写，和变量一眼区分。宏常量没有类型、不能取地址、调试器里看不到名字——简单数值场景用宏还是 `const` 都行，但表达式宏的坑（下一节）必须门儿清。

## 带参宏：括号是保命的

```c
#define SQUARE(x) ((x) * (x))    // 每个参数、整个表达式都要加括号
```

不加括号的后果，是文本替换的经典惨案：

```c
#define BAD_SQUARE(x) x * x    // ❌ 没加括号

int r = BAD_SQUARE(1 + 2);     // 展开成 1 + 2 * 1 + 2 = 5，不是 9！
```

第二类陷阱：参数带副作用时会被求值多次：

```c
#define MAX(a, b) ((a) > (b) ? (a) : (b))

int i = 0;
int m = MAX(i++, 5);    // ❌ 展开后 i++ 出现两次，i 变成 2
```

函数调用只对参数求值一次；宏是把宏体复制粘贴几遍，就对参数求值几次。

```c
// 多语句宏的标准写法：do { } while (0)
#define LOG_ERR(msg) \
    do { fprintf(stderr, "[%s:%d] %s\n", __FILE__, __LINE__, msg); } while (0)

if (failed)
    LOG_ERR("disk");    // do{}while(0) 保证整体只算一条语句，不破坏 if-else
else
    retry();
```

> [!WARNING]
> 判断标准很简单：**宏参数在宏体里出现几次，就被求值几次**。出现超过一次就别用它接 `i++`、`f(x)` 这类有副作用的表达式；绕不开就改成真正的函数，或 `static inline`。现代 C 里带参宏的主阵地是「需要拿到类型」和「需要生成代码」的场景。

## 条件编译

同一份代码适配不同平台、不同配置，靠预处理指令：

```c
#include <stdio.h>

#define DEBUG 1

int main(void) {
#if defined(_WIN32)
    printf("Windows\n");
#elif defined(__linux__)
    printf("Linux\n");
#else
    printf("other\n");
#endif

#ifdef DEBUG
    printf("debug build\n");    // 没定义 DEBUG 时，这行根本不参与编译
#endif
    return 0;
}
```

`#ifdef X` 等价于 `#if defined(X)`；`#ifndef X` 是「没定义时」。调试时想临时禁用一段代码，用 `#if 0 ... #endif` 包起来，比删掉再贴回来文明得多。

## include guard：头文件的防重复外套

头文件可能被多个 .c 包含，也可能被另一个头文件间接包含两次——没有保护就会重复定义。标准姿势：

```c
// math_utils.h
#ifndef MATH_UTILS_H    // 没定义才进入第一次
#define MATH_UTILS_H    // 打上标记

double square(double x);

#endif                  // 第二次包含时宏已定义，整块被跳过
```

也可以用 `#pragma once`——不是标准，但 gcc / clang / MSVC 全支持，实际项目两种写法都很常见。

> [!TIP]
> guard 宏名按**文件路径风格**起（`MATH_UTILS_H`），全项目保持唯一。两个目录里各有一个 `utils.h` 都叫 `UTILS_H`，第二个头文件会被静默跳过，报错却出现在毫不相干的地方——这种 bug 能查半天。

## 预定义宏：免费的调试信息

编译器自带一批宏，是日志和断言的基本原料：

```c
#include <stdio.h>

void log_call(const char *msg) {
    printf("[%s:%d in %s] %s\n", __FILE__, __LINE__, __func__, msg);
}

int main(void) {
    log_call("start");    // [main.c:9 in main] start
    return 0;
}
```

| 宏 | 内容 |
| --- | --- |
| `__FILE__` | 当前文件名 |
| `__LINE__` | 当前行号 |
| `__func__` | 当前函数名（C99） |
| `__DATE__` / `__TIME__` | 编译日期 / 时间 |
| `__STDC_VERSION__` | C 标准版本（C17 是 201710L） |

标准库的 `assert` 宏就是靠它们实现的：断言失败时打印文件、行号、表达式然后 abort；定义 `NDEBUG` 后 assert 整体消失，零运行时开销。

相关阅读：[函数与作用域](07-functions-scope.md)
