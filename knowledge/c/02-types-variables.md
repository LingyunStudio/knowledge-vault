---
title: 基本类型与变量
order: 2
tags: 基础, 类型, 内存
summary: int 家族的宽度与符号、浮点的精度陷阱、sizeof 与溢出，C 类型系统的地基。
---

C 的类型系统很薄：类型只回答「这块内存多大、按什么格式解读、能做哪些运算」三个问题，其余检查全靠你自己。类型用错，编译器多半只给个警告——所以这些地基必须自己打牢。

## 整数家族

C 的整数按「宽度 + 符号」组合，但标准只保证**最小宽度**，具体宽度由平台决定：

| 类型             | 典型宽度（字节）                   | 典型范围                   |
| -------------- | -------------------------- | ---------------------- |
| `char`         | 1                          | -128 \~ 127 或 0 \~ 255 |
| `short`        | 2                          | 约 ±3.2 万               |
| `int`          | 4                          | 约 ±21 亿                |
| `long`         | 4（Windows）/ 8（Linux、macOS） | 随宽度                    |
| `long long`    | 8                          | 约 ±9.2×10¹⁸            |
| `unsigned int` | 4                          | 0 \~ 约 42.9 亿          |

最常见的坑在 `long`：Windows 上是 4 字节，Linux/macOS 上是 8 字节。每个 signed 类型都有对应的 unsigned 版本，默认全是有符号（`char` 是否有符号由实现定义）。

> [!TIP]
> 涉及协议、文件格式等需要精确宽度的场合，用 `<stdint.h>` 的 `int32_t`、`uint64_t`，别赌 `long` 的宽度。日常计数、循环下标，`int` 和 `size_t` 就够。

声明与初始化的规矩很朴素：

```c
int count = 0;               // 定义时顺手给初值
const double PI = 3.14159;   // const：不许再改，比 #define 多一层类型检查
unsigned level = 0;          // 局部变量不初始化值是随机的，定义时就给 0
```

## sizeof：直接问内存

`sizeof` 返回类型或表达式占的字节数，结果类型是 `size_t`（用 `%zu` 打印）：

```C
#include <stdio.h>

int main(void) {
    printf("char=%zu short=%zu int=%zu long=%zu\n",
           sizeof(char), sizeof(short), sizeof(int), sizeof(long));
    printf("double=%zu, 指针=%zu\n", sizeof(double), sizeof(void *));
    // 64 位 Linux/macOS 典型输出：char=1 short=2 int=4 long=8
    return 0;
}
```

两个细节：`sizeof` 是编译期求值的运算符，不是函数（变长数组是唯一例外）；字符常量在 C 里是 `int` 类型，所以 `sizeof('a')` 是 4 不是 1——C 和 C++ 的著名差异。

## 浮点：快，但不精确

`float`（约 7 位有效数字）和 `double`（约 15\~16 位）都是 IEEE 754 二进制浮点。二进制表示不了很多十进制小数，就像十进制写不尽 1/3：

```c
#include <stdio.h>

int main(void) {
    printf("%.17f\n", 0.1 + 0.2);        // 0.30000000000000004
    printf("%d\n", 0.1 + 0.2 == 0.3);    // 0：不相等！

    double price = 19.99;
    printf("%.17f\n", price * 100);      // 1998.99999999999982
    return 0;
}
```

三条纪律足够应付大多数场景：

1. 比较浮点用误差范围，别用 `==`
2. 金额用整数（以分为单位）算，天然精确
3. 默认用 `double`；`float` 只在数据量大、明确要省内存带宽时用

```c
#include <math.h>

// ✅ 浮点比较的正确姿势
int nearly_equal(double a, double b) {
    return fabs(a - b) < 1e-9;    // 差值小于阈值即视为相等
}
```

## 溢出：unsigned 回绕，signed 是 UB

这是 C 和 Rust 分歧最大的地方之一：**unsigned 溢出有明确定义，按 2^N 取模回绕；signed 溢出是未定义行为**：

```c
#include <limits.h>
#include <stdio.h>

int main(void) {
    unsigned int u = 0;
    u--;                       // ✅ 合法：回绕成 4294967295
    printf("%u\n", u);

    int i = INT_MAX;           // 2147483647
    i = i + 1;                 // ❌ signed 溢出，未定义行为
    return 0;
}
```

unsigned 回绕最常见的翻车现场是循环：

```c
#include <stdio.h>

int main(void) {
    // ❌ 死循环：n 是 unsigned，减到 0 后变成巨大正数，n >= 0 永远成立
    // for (unsigned n = 10; n >= 0; n--) { /* ... */ }

    // ✅ n-- > 0 惯用法：循环 10 次，n 依次是 9,8,...,0
    int times = 0;
    for (unsigned n = 10; n-- > 0;) times++;
    printf("%d\n", times);    // 10
    return 0;
}
```

> [!WARNING]
> signed 溢出不是「变成负数」这么简单：gcc 在 `-O2` 下会假设它不发生，并据此删除依赖它的判断代码。`limits.h` 里有 `INT_MAX` 等边界，加法可能越界就先判断。

## 隐式转换：编译器自作主张的地方

混合类型运算时 C 会悄悄转换，两条关键规则：比 `int` 窄的类型先提升为 `int`；`int` 遇上 `unsigned int`，一律转成 `unsigned`：

```c
#include <stdio.h>

int main(void) {
    int a = -1;
    unsigned b = 1;
    if (a < b) {
        printf("less\n");    // 永远不会执行！
    }
    // a 被转成 unsigned：4294967295，比 1 大
    return 0;
}
```

整数除法同样悄悄丢掉小数：

```c
double half = 1 / 2;     // 0.0：先做整数除法得 0，再转 double
double ok   = 1.0 / 2;   // 0.5：只要有一个操作数是浮点就行
```

> [!NOTE]
> `-Wextra` 自带的 `-Wsign-compare` 能抓出有符号/无符号比较问题。看到 `comparison of integer expressions of different signedness` 这类警告，别忽略——它在替你挡掉真实的 bug。

相关阅读：[指针入门](03-pointers.md)
