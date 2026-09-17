---
title: 内存管理
order: 4
tags: 核心, malloc, 堆
summary: 栈与堆的分工、malloc/free 配对、泄漏与悬空指针，手动内存管理的纪律。
---

Rust 用所有权让编译器替你插入 free，C 把这件事完整交给你：malloc 申请、free 释放，配对出错就是泄漏、悬空或崩溃。好消息是规则不多，纪律性比智商重要。

## 栈与堆的分工

局部变量住栈上，函数返回自动回收，快但生命周期受限于作用域；堆由你手动管理，能跨函数存活，代价是必须自己释放：

| | 栈 | 堆 |
| --- | --- | --- |
| 分配/释放 | 自动 | 手动 malloc / free |
| 速度 | 极快（挪一下栈指针） | 相对慢 |
| 大小 | 默认只有几 MB | 受限于实际内存 |
| 生命周期 | 函数返回即失效 | 从 malloc 到 free |

结论很直接：**只在函数内用的小对象放栈上；要跨函数存活、大小运行时才知道、体积很大的数据放堆上**。

```c
#include <stdlib.h>

int main(void) {
    int local[100] = {0};                      // 栈：函数返回自动消失
    local[0] = 1;
    int *heap = malloc(100 * sizeof *heap);    // 堆：必须记得 free
    heap[0] = local[0];
    free(heap);
    return 0;
}
```

## malloc / free 配对

```c
#include <stdlib.h>
#include <stdio.h>

int main(void) {
    size_t n = 10;
    int *a = malloc(n * sizeof *a);    // 申请未初始化的内存
    if (a == NULL) {                   // 分配可能失败，必须检查
        perror("malloc");
        return 1;
    }

    for (size_t i = 0; i < n; i++) a[i] = (int)i;
    free(a);                           // 用完必须还
    return 0;
}
```

家族函数各有分工：

| 函数 | 行为 |
| --- | --- |
| `malloc(n)` | 申请 n 字节，内容未初始化 |
| `calloc(cnt, size)` | 申请并清零 |
| `realloc(p, n)` | 扩大/缩小已分配的块 |
| `free(p)` | 释放；`free(NULL)` 合法且无事发生 |

> [!WARNING]
> `malloc` 返回的内存内容是**未定义的**——可能是垃圾值，也可能碰巧全是 0，但「这次碰巧为 0」不代表下次还是。要么先填充再读，要么直接用 `calloc`。

## realloc 的正确姿势

扩容时 realloc 可能原地扩展，也可能另找新址并把旧数据搬过去。新手常犯的错误是用原指针接返回值——一旦返回 NULL，旧内存泄漏且原指针被覆盖：

```c
// ❌ 失败时 a 变 NULL，原来那块内存再也找不回来
a = realloc(a, new_size);

// ✅ 用临时变量接，失败时旧指针安然无恙
int *tmp = realloc(a, new_size);
if (tmp == NULL) {
    free(a);          // 旧内存还在，按需处理
    return -1;
}
a = tmp;
```

## 三种经典死法

```c
int *p = malloc(100);

p = malloc(200);            // ❌ 泄漏：第一块的地址被覆盖，成了孤儿

free(p);
printf("%d\n", *p);         // ❌ 悬空指针（use-after-free）：未定义行为

free(p);
free(p);                    // ❌ 双重释放：直接破坏堆结构
```

泄漏不崩溃，只让内存占用持续上涨——长驻进程（服务、编辑器）的慢性病。悬空和双重释放是未定义行为，可能当时没事，换个编译器、换个优化等级就炸。

## 所有权：C 的土办法

没有编译器盯着，就得靠约定。实践中的纪律：

1. **谁 malloc 谁负责 free**：函数文档写清楚返回的内存归谁释放
2. **配对写在最近的地方**：malloc 和 free 尽量放同一层，别 A 函数申请 B 函数释放
3. **free 后立刻置 NULL**，杜绝悬空
4. 数据结构成对提供 `xxx_create` / `xxx_destroy`，把配对包进接口

```c
#include <stdlib.h>
#include <string.h>

typedef struct {
    char *name;
    int   age;
} Person;

Person *person_create(const char *name, int age) {
    Person *p = malloc(sizeof *p);
    if (p == NULL) return NULL;
    p->name = strdup(name);       // 指针成员也要单独申请
    if (p->name == NULL) { free(p); return NULL; }
    p->age = age;
    return p;
}

void person_destroy(Person *p) {  // 释放顺序：先成员，后 struct 本体
    if (p == NULL) return;
    free(p->name);
    free(p);
}
```

> [!TIP]
> `sizeof *p` 比 `sizeof(Person)` 更抗修改——类型变了这行代码不用动。另外 `strdup` 是 POSIX 函数，MSVC 下叫 `_strdup`，C23 起才进入标准库；严格移植场景可以自己写 malloc + strcpy 代替。

## 练习

- [ ] 写一个动态 int 数组三件套：`arr_new` / `arr_push`（内部 realloc）/ `arr_free`
- [ ] 故意写一个泄漏循环，用 valgrind 报告确认泄漏字节数
- [ ] 解释：`person_destroy` 为什么先 `free(p->name)` 再 `free(p)`？反过来会怎样？

相关阅读：[字符串](05-strings.md)
