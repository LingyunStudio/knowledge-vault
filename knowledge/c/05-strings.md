---
title: 字符串
order: 5
tags: 基础, 字符数组, str 函数
summary: C 字符串就是带 \0 结尾的字符数组：常用 str 函数、缓冲区溢出与安全写法。
---

C 没有字符串类型。所谓字符串，只是一段以 `'\0'` 结尾的 `char` 数组——这个设计简单高效，也直接催生了缓冲区溢出这个几十年的安全头号话题。理解「内存里到底存了什么」，比背函数列表重要。

## 一切从 '\0' 开始

`'\0'` 是值为 0 的字符（NUL），标记字符串结束，所有标准库函数都靠它找终点：

```c
#include <stdio.h>
#include <string.h>

int main(void) {
    char s[] = "hi";                 // 实际存 3 个字节：'h' 'i' '\0'
    char t[3] = {'h', 'i', '\0'};    // 与上面完全等价

    printf("%zu %zu\n", sizeof s, strlen(s));    // 3 2
    printf("%s=%s\n", s, t);                     // hi=hi
    return 0;
}
```

`sizeof` 是数组的总字节数（含 `'\0'`），`strlen` 是到 `'\0'` 为止的字符数（不含）。差的那 1 个结尾字节，就是无数溢出事故的来源。

## 字面量 ≠ 字符数组

```c
char *a = "hello";          // a 指向只读区里的字符串字面量
char b[] = "hello";         // b 是栈上的一份副本

a[0] = 'H';                 // ❌ 未定义行为：字面量区不可写
b[0] = 'H';                 // ✅ 副本随便改
```

判断标准就一条：**你要不要改它**。只读就用 `const char *` 接字面量；要改就用数组复制一份。

> [!NOTE]
> 字面量 `"hello"` 在程序整个运行期都存在，且两个相同字面量可能共享同一份存储。所以返回字面量的函数是安全的——返回局部数组则不是，那是悬空指针。

## 常用函数速查

都在 `<string.h>`：

| 函数 | 用途 | 注意 |
| --- | --- | --- |
| `strlen(s)` | 长度（不含 `\0`） | O(n)，别放循环条件里反复算 |
| `strcpy(dst, src)` | 拷贝 | 不查边界，dst 不够就溢出 |
| `strncpy(dst, src, n)` | 最多拷 n 字节 | src 太长时**不写 `\0`**，坑 |
| `strcmp(a, b)` | 比较，相等返回 0 | 返回负/零/正，不是布尔 |
| `strcat(dst, src)` | 追加 | 同样不查边界 |
| `strchr(s, c)` | 找字符，返回指针 | 找不到返回 NULL |
| `strstr(s, sub)` | 找子串 | 同上 |
| `snprintf(dst, n, ...)` | 格式化写入 | **推荐**：保证截断、保证 `\0` |

## 缓冲区溢出：错误示范

```c
char buf[8];
strcpy(buf, "hello world");    // ❌ 12 字节写进 8 字节的数组
// 后 4 字节踩了栈上其他数据：轻则逻辑错乱，重则被注入代码
```

`strcpy` 不可能知道 `buf` 有多大——它只看得到起点地址。长度信息在你脑子里，而不是在类型里。

`strncpy` 名字看着安全，其实有陷阱：

```c
char buf[8];
strncpy(buf, "hello world", sizeof buf);   // 拷满 8 字节，没有 '\0'！
printf("%s\n", buf);                       // ❌ 越界读，读到哪算哪
```

## 安全写法

现代 C 的共识：**优先 `snprintf`，它保证截断且必定补 `\0`**：

```c
#include <stdio.h>
#include <string.h>

int main(void) {
    char buf[8];
    snprintf(buf, sizeof buf, "%s", "hello world");
    printf("[%s]\n", buf);    // [hello w]：截断但安全，永远以 '\0' 结尾

    char msg[32] = "abc";     // 拼接：先看剩余空间，再追加
    size_t used = strlen(msg);
    if (used < sizeof msg) {
        snprintf(msg + used, sizeof msg - used, "%s", "def");
    }
    printf("%s\n", msg);      // abcdef
    return 0;
}
```

> [!TIP]
> `sizeof buf` 只在 buf 是**真数组**的作用域里有效；数组传进函数退化为指针后，`sizeof` 得到的是 8。所以处理字符串的函数一律带长度参数 `size_t n`，内部用 n 判界，不要指望 sizeof。

## 遍历的惯用法

```c
#include <stdio.h>
#include <string.h>

int count_vowels(const char *s) {
    int count = 0;
    for (const char *p = s; *p != '\0'; p++) {   // '\0' 即假，循环自然停
        if (strchr("aeiouAEIOU", *p) != NULL)
            count++;
    }
    return count;
}

int main(void) {
    printf("%d\n", count_vowels("hello world"));    // 3
    return 0;
}
```

C 字符串没有长度前缀，`strlen` 是 O(n) 的——把它写进循环条件意味着每轮重算一遍，长字符串下性能肉眼可见地差。需要多次用长度，就先存进变量。

相关阅读：[结构体、联合与枚举](06-structs-unions.md)
