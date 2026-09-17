---
title: 指针进阶
order: 9
tags: 核心, 函数指针, 回调
summary: 函数指针实现回调、void* 泛型传参、const 与指针的四种组合。
---

指针入门篇解决了「指向变量」，这一篇解决三个更实用的问题：怎么把**函数**当参数传、怎么写**不关心类型**的通用代码、const 放在声明的哪个位置到底有何区别。这三样是读懂一切 C 库源码的门票。

## 函数也有地址

函数编译后也躺在内存里，函数名就是它的地址。存函数地址的变量叫**函数指针**：

```c
#include <stdio.h>

int add(int a, int b) { return a + b; }
int mul(int a, int b) { return a * b; }

int main(void) {
    int (*op)(int, int);    // 声明：op 指向「int(int,int)」类型的函数

    op = add;                    // 函数名自动退化为地址，&add 也对但多余
    printf("%d\n", op(2, 3));    // 5：直接当函数调用
    printf("%d\n", (*op)(2, 3)); // 5：老式写法，等价

    op = mul;
    printf("%d\n", op(2, 3));    // 6：同一根指针指向另一个函数
    return 0;
}
```

声明 `int (*op)(int, int)` 的读法：`(*op)` 说明 op 是指针，外圈 `int (...)(int, int)` 描述指向的函数长什么样。

## 回调：把「做什么」留给调用方

qsort 是标准库里最经典的回调范例——排序算法它来写，**比较规则你来定**：

```c
#include <stdio.h>
#include <stdlib.h>

// 比较器：负数 = a 排前，正数 = b 排前，0 = 相等
int cmp_int(const void *a, const void *b) {
    int x = *(const int *)a;
    int y = *(const int *)b;
    return (x > y) - (x < y);    // 比 x - y 安全：不会溢出
}

int main(void) {
    int arr[] = {5, 2, 9, 1, 7};
    size_t n = sizeof arr / sizeof arr[0];

    qsort(arr, n, sizeof arr[0], cmp_int);    // 传入比较函数
    for (size_t i = 0; i < n; i++)
        printf("%d ", arr[i]);    // 1 2 5 7 9
    return 0;
}
```

`qsort` 最后一个参数的类型是 `int (*)(const void *, const void *)`——你传进一个函数，它内部反复调用。GUI 事件、线程入口、状态机跳转表，全是同一套思路。

> [!TIP]
> 比较器直接写 `return x - y;` 在两个大数一正一负时会溢出，`(x > y) - (x < y)` 永远安全。函数指针类型太长时用 typedef 起名，可读性立刻起飞：`typedef int (*Cmp)(const void *, const void *);`

## void*：不关心类型的指针

`void *` 是「指向未知类型」的指针。任何对象指针都能隐式转成 `void *`，再转回来——这正是 C 实现泛型的方式：

```c
#include <stdio.h>
#include <string.h>

// 通用交换：按字节搬内存，不关心元素是什么类型
// 演示用固定缓冲，size 超过 64 需换策略
void swap_bytes(void *a, void *b, size_t size) {
    unsigned char tmp[64];
    memcpy(tmp, a, size);
    memcpy(a, b, size);
    memcpy(b, tmp, size);
}

int main(void) {
    int x = 1, y = 2;
    swap_bytes(&x, &y, sizeof(int));
    printf("%d %d\n", x, y);    // 2 1

    double d1 = 3.5, d2 = 7.25;
    swap_bytes(&d1, &d2, sizeof(double));    // 同一个函数服务所有类型
    printf("%.1f %.1f\n", d1, d2);           // 7.2 3.5
    return 0;
}
```

`malloc` 返回 `void *` 也是同理：它不知道你要什么类型，C 里可以隐式转给任何对象指针（C++ 必须显式转换）。

> [!WARNING]
> `void *` 只有两件事不能做：解引用（不知道读几个字节）和算术运算（不知道跨多远）。使用前必须先转回具体类型——转错了类型编译器不会拦你，这是 C 泛型的全部代价。

## const 与指针：四种组合

const 写在 `*` 左边还是右边，效果完全不同。口诀：**const 修饰它左边的东西**（最左侧时修饰类型本身）：

```c
int main(void) {
    int x = 10, y = 20;

    const int *p1 = &x;         // 指向 const 的指针：*p1 不能改，p1 能改
    // *p1 = 1;                 // ❌ 编译错误
    p1 = &y;                    // ✅ 换个指向没问题

    int *const p2 = &x;         // const 指针：p2 不能改，*p2 能改
    *p2 = 1;                    // ✅ x 变成 1
    // p2 = &y;                 // ❌ 编译错误

    const int *const p3 = &x;   // 双重锁死：既不能改指向，也不能改值
    (void)p1; (void)p3;
    return 0;
}
```

`const int *p1` 与 `int const *p1` 是同一个意思。最实用的记忆：**函数签名里的 `const char *s` 是承诺「我不改你给我的字符串」**——调用方靠这个放心传只读数据，这是 C 里最重要的一种 const 用法。

## 二级指针：修改指针本身

想修改的如果是指针变量本身，就得传指针的地址——规律和普通出参一模一样：

```c
#include <stdio.h>
#include <stdlib.h>

int alloc_int(int **out) {
    int *p = malloc(sizeof *p);
    if (p == NULL) return -1;
    *p = 42;
    *out = p;       // 通过二级指针把地址「带出去」
    return 0;
}

int main(void) {
    int *v = NULL;
    if (alloc_int(&v) == 0) {
        printf("%d\n", *v);    // 42
        free(v);
    }
    return 0;
}
```

函数内要修改谁，就传谁的地址——这次「谁」恰好是一个指针。同理还有三级、四级指针，但见到三级就该怀疑设计了。

相关阅读：[常见错误与调试](10-common-pitfalls.md)
