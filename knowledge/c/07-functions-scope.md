---
title: 函数与作用域
order: 7
tags: 基础, 函数, static
summary: 传值与传指针、栈帧生命周期、static 与作用域，头文件与声明定义分离。
---

C 程序 = 函数的集合。函数语法十分钟就能学完，真正的重点藏在三个问题里：参数怎么传、局部变量什么时候消失、声明和定义为什么要分开。

## 先声明，再使用

编译器从上往下读文件，调用函数前必须见过它的**声明**（原型），否则只能猜签名，后患无穷：

```c
#include <stdio.h>

int add(int a, int b);      // 声明：只有签名，不带函数体，结尾有分号

int main(void) {
    printf("%d\n", add(1, 2));    // 编译器知道 add 的签名，检查通过
    return 0;
}

int add(int a, int b) {     // 定义：有函数体
    return a + b;
}
```

声明的意义是让「调用」和「实现」解耦：调用方只需要签名（放头文件里），实现可以放在任何地方、任何文件。

## 传值：C 只有一种传参方式

C 的参数永远是**拷贝**。函数里改参数，改的只是副本：

```c
#include <stdio.h>

void set_to_zero(int n) { n = 0; }        // ❌ 改的是副本，调用方无感

void set_to_zero_ok(int *n) { *n = 0; }   // ✅ 传地址，通过地址改本体

int main(void) {
    int x = 5;
    set_to_zero(x);
    printf("%d\n", x);          // 5：原值没变
    set_to_zero_ok(&x);
    printf("%d\n", x);          // 0
    return 0;
}
```

推论很实用：想「输出」结果就传指针（出参）；大 struct 传指针避免整体拷贝；数组天然退化为指针且必须额外传长度——见[指针入门](03-pointers.md)。

## 栈帧：局部变量的生死

每次函数调用在栈上压一个**栈帧**，参数、局部变量、返回地址都住在里面；函数返回，栈帧弹出，里面的东西全部失效：

```c
#include <stdio.h>

int *bad(void) {
    int local = 42;
    return &local;    // ❌ 返回局部变量的地址
}                     // 栈帧销毁，这块内存随时被下次调用覆盖

int main(void) {
    int *p = bad();
    printf("%d\n", *p);    // 可能「碰巧」是 42，但这是未定义行为
    return 0;
}
```

`bad` 编译时通常有警告（`-Wreturn-local-addr`），运行时可能碰巧正确——直到下一次函数调用覆盖那块栈内存。这类错误讲究的就是一个「延迟爆炸」。

> [!WARNING]
> 「碰巧能跑」是 C 最危险的安慰剂。未定义行为没有保质期：换了优化等级、换了编译器版本就崩。看到警告，不要用「反正现在能运行」说服自己。

## static：一名字三含义

`static` 出现在不同位置含义完全不同，这是 C 初学者的经典混淆点：

```c
// 1. 函数内：static 局部变量——不存栈上，生命周期贯穿整个程序
int counter(void) {
    static int count = 0;    // 只在第一次调用前初始化一次
    return ++count;          // 每次调用 +1，返回后不清零
}

// 2. 全局变量前：内部链接——只在本文件可见
static int hidden = 0;       // 别的 .c 即使 extern 声明也链接不到它

// 3. 函数前：只在本文件可见——模块的「私有函数」
static void helper(void) { /* ... */ }
```

记法：**static 把东西关进当前文件**（全局变量、函数），或者**把局部变量从栈上捞出来**（局部）。全局变量不加 static 是外部链接，别的文件用 `extern` 声明后就能用——权力大，但谁都能改，慎用。

## 头文件：声明的集散地

多文件项目的标准结构是「头文件放声明，.c 文件放定义」：

```c
// person.h
#ifndef PERSON_H            // include guard，防重复包含（见[预处理器](08-preprocessor.md)）
#define PERSON_H

typedef struct Person Person;    // 前置声明：外界不知道 struct 的内容

Person *person_create(const char *name);
void    person_destroy(Person *p);

#endif
```

```c
// person.c
#include "person.h"
#include <stdlib.h>
#include <string.h>

struct Person {              // 完整定义只在本文件出现
    char *name;
};

Person *person_create(const char *name) {
    Person *p = malloc(sizeof *p);
    if (p == NULL) return NULL;
    p->name = malloc(strlen(name) + 1);    // name 也放堆上
    if (p->name == NULL) { free(p); return NULL; }
    strcpy(p->name, name);
    return p;
}

void person_destroy(Person *p) {
    if (p == NULL) return;
    free(p->name);
    free(p);
}
```

外界只见 `typedef struct Person Person` 这个不完整类型，**没法直接访问成员**，只能走提供的函数——这是 C 实现「封装」的标准手法。

> [!TIP]
> 头文件里只放声明（原型、类型、`#define`、`extern` 声明），**不要放函数体和变量定义**——多个 .c 包含它就会重复定义，链接报错。例外是 `static inline` 的小函数。

## 练习

- [ ] 写 `void split_time(int total_sec, int *h, int *m, int *s)`，用三个出参返回时分秒
- [ ] 用 static 局部变量实现一个只在奇数次调用返回 1 的函数
- [ ] 把上面的 person 拆成三个文件，用 gcc 分步编译并链接成可执行程序

相关阅读：[预处理器](08-preprocessor.md)
