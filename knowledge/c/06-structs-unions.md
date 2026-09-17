---
title: 结构体、联合与枚举
order: 6
tags: 基础, struct, 内存对齐
summary: struct 内存对齐、union 共享内存、enum 命名常量，组织复杂数据的三件工具。
---

C 的数据建模靠三件工具：struct 把相关字段打包、union 让多种类型共享一块内存、enum 给整数值起名字。它们都不带方法——C 的 struct 就是纯粹的数据布局，这也意味着每个字节都由你负责。

## struct：相关数据的打包

```c
#include <stdio.h>
#include <string.h>

typedef struct {          // typedef 之后直接写 Person，不用带 struct 关键字
    char name[32];
    int  age;
    double height;
} Person;

int main(void) {
    Person p1 = { "Ada", 36, 1.70 };               // 按字段顺序初始化
    Person p2 = { .name = "Alan", .age = 41 };     // 指定初始化器，其余清零

    p1.age += 1;                                   // 用 . 访问成员
    Person *pp = &p1;
    pp->age += 1;                                  // 指针访问用 ->，等价 (*pp).age

    Person p3 = p1;                                // 整体赋值 = 按成员拷贝
    strcpy(p3.name, "Copy");
    printf("%s vs %s\n", p1.name, p3.name);        // Ada vs Copy
    return 0;
}
```

两个高频细节：

- struct 赋值、传参、返回都是**整体拷贝**。小 struct 直接传值完全没问题，大的传指针
- struct 里套指针时，拷贝只复制指针本身（浅拷贝），两份 struct 会共享同一块堆内存

## 内存对齐：struct 会变胖

CPU 按对齐的地址读内存效率最高，所以编译器会在成员之间塞**填充字节**（padding）：

```c
struct A {
    char  c;    // 1 字节 + 3 字节填充
    int   i;    // 4 字节
    char  d;    // 1 字节 + 3 字节填充
};              // sizeof = 12

struct B {      // 同样的数据，大成员放前面
    int   i;    // 4 字节
    char  c;    // 1 字节
    char  d;    // 1 字节 + 2 字节填充
};              // sizeof = 8
```

规则只有两条：每个成员放在「自身对齐值」的整数倍地址上；整个 struct 的大小是最大成员对齐值的整数倍。字段重排是免费的优化——同样的数据，B 比 A 省 1/3 内存。

> [!TIP]
> 想验证每个成员的偏移，用 `offsetof`（`<stddef.h>`）：`offsetof(struct A, i)` 返回 4。struct 成员按大小从大到小排，是 C 代码的默认排版习惯。

## union：一块内存，多种解读

union 的所有成员**从同一个地址开始**，写一个成员会覆盖另一个：

```c
#include <stdio.h>

union Data {
    int   i;
    char  bytes[4];
};

int main(void) {
    union Data d = { .i = 0x41424344 };
    printf("%c%c%c%c\n", d.bytes[3], d.bytes[2], d.bytes[1], d.bytes[0]);
    // x86 小端输出：ABCD —— 低位字节存在低地址
    printf("%zu\n", sizeof d);    // 4：union 大小等于最大成员
    return 0;
}
```

union 常用来省内存（同一时刻只用一个成员）、拆解多字节数据（检查字节序）、解析协议。代价是**你写进的是 i，读出来的可能不是它**——读非活跃成员是实现定义行为，必须靠外部信息（tag）告诉你当前活跃的是谁。

## enum：会命名的整数

```c
enum Color { RED, GREEN, BLUE };                 // 0, 1, 2
enum Status { OK = 200, NOT_FOUND = 404 };       // 可以指定值
enum Flags { READ = 1 << 0, WRITE = 1 << 1 };    // 位标志惯用法

int main(void) {
    enum Color c = GREEN;
    if (c == GREEN) { /* 可读性远胜 if (c == 1) */ }
    return 0;
}
```

enum 的本质是 `int`：成员可以当 int 用，赋一个列表外的值编译器也拦不住（顶多警告）。它的价值全在可读性和常量集中定义。

## tagged union：C 的「多选一」

union 记不住当前存的是哪种类型，惯用解法是 struct + enum 打包——这就是 Rust enum 的原始形态：

```c
#include <stdio.h>

enum ShapeKind { SHAPE_CIRCLE, SHAPE_RECT };

struct Shape {
    enum ShapeKind kind;      // 标签：记录当前是哪种
    union {
        double radius;                   // SHAPE_CIRCLE 用
        struct { double w, h; } rect;    // SHAPE_RECT 用
    };
};

double area(const struct Shape *s) {
    switch (s->kind) {        // 先看标签，再取对应成员
    case SHAPE_CIRCLE: return 3.14159 * s->radius * s->radius;
    case SHAPE_RECT:   return s->rect.w * s->rect.h;
    }
    return 0;
}

int main(void) {
    struct Shape r = { .kind = SHAPE_RECT, .rect = { 3.0, 4.0 } };
    printf("%f\n", area(r));    // 12.0
    return 0;
}
```

> [!WARNING]
> 匿名 union 是 C11 的特性，老代码里常见「union 起名后 `s->u.radius` 访问」的写法。另外 C 的 switch 不强制穷尽：忘了处理某个 kind，编译器最多给个警告，不会像 Rust 的 match 那样拒绝编译。

相关阅读：[函数与作用域](07-functions-scope.md)
