---
title: 常见错误与调试
order: 10
tags: 核心, 调试, UB
summary: 段错误从哪来：越界、未初始化、悬空指针；gdb/valgrind/sanitizer 排查法。
---

C 的新手错误高度集中：就那么几类，但每一类都可能在**错误的地方、错误的时间**爆炸。这一篇把它们列成清单，再配上标准排查工具——遇到崩溃不要慌，按流程抓它。

## 段错误是什么

段错误（SIGSEGV）= 程序访问了操作系统没授权的内存。它是**好消息**：硬件当场拦住了你。真正可怕的是踩了内存却没崩——数据悄悄坏掉，几分钟后在毫无关系的地方崩溃，甚至干脆不崩、只是算错数。

所以调试 C 的核心心态是：崩溃不可怕，不崩的内存错误才可怕。

## 错误清单：先对号入座

```c
int *p0 = NULL;
*p0 = 1;                  // ❌ 解引用空指针：当场段错误（好崩溃）

int *p1;                  // 里面是随机值
*p1 = 1;                  // ❌ 解引用未初始化指针：往随机地址写

int a[10];
a[10] = 0;                // ❌ 越界：合法下标是 0~9，C 不检查

int *p2 = malloc(sizeof *p2);
free(p2);
*p2 = 1;                  // ❌ use-after-free：悬空指针

int *bad(void) {
    int local = 1;
    return &local;        // ❌ 返回局部变量地址：栈帧已销毁
}

char s[3] = {'a', 'b', 'c'};
printf("%s\n", s);        // ❌ 没有 '\0' 结尾：越界读，直到碰巧遇到 0
```

还有一个不在指针里的经典：

```c
int x;
if (x == 0) { }           // ❌ 读未初始化的局部变量，值是随机的
```

> [!WARNING]
> 局部变量不初始化，值是**不确定的**——不是「一定是 0」。全局变量和 static 变量保证清零，局部变量没有任何保证。每一行局部变量要么初始化，要么赋值之后再读。

## 第一道防线：把警告开满

一大半错误编译器本来就能看见，前提是你开口问：

```bash
gcc -std=c17 -Wall -Wextra -g test.c -o test
```

```c
int x = 1;
if (x = 0) { }            // ❌ 赋值写成了比较：x 被改成 0，条件永远为假
                          // 开 -Wall 直接警告；惯用法把常量写左边：if (0 == x)
```

警告不要攒着，看到就修。「能编译通过」和「代码是对的」在 C 里是两件事。

## gdb：崩溃现场取证

带 `-g` 编译，崩溃后用 gdb 直接定位：

```bash
gcc -g test.c -o test
./test                    # Segmentation fault
gdb ./test
```

```bash
(gdb) run                 # 复现崩溃
(gdb) bt                  # 打印崩溃时的调用栈——90% 的问题到这步就解决了
(gdb) print p             # 看变量：p = 0x0 一眼锁定空指针
(gdb) frame 1             # 切到栈的上一层
(gdb) break main          # 设断点
(gdb) next / step         # 单步执行
```

核心动作就一个：崩溃 → `bt` → 查最上面几帧的变量值，多数段错误三十秒内定位。

## valgrind 与 sanitizer：抓「不崩」的错误

valgrind 用模拟 CPU 跑你的程序，能精确报告每一处非法访问、未初始化读取和内存泄漏：

```bash
valgrind --leak-check=full ./test
```

```text
==123== Invalid write of size 4         ← 越界 / use-after-free 的典型报告
==123==    at 0x...: main (test.c:12)   ← 直接给出文件和行号
==123== definitely lost: 100 bytes in 1 blocks    ← 内存泄漏
```

更快的方式是让编译器直接插桩——AddressSanitizer：

```bash
gcc -fsanitize=address -g test.c -o test
./test                    # 一踩到非法内存立刻崩溃并打印详细报告
```

错误现场和出错点重合，排查体验远好于「延迟爆炸」；再加 `,undefined`（`-fsanitize=address,undefined`）还能抓有符号溢出、越界位移等未定义行为。

> [!TIP]
> 日常组合拳：写代码时 `-Wall -Wextra`；测试时 `-fsanitize=address,undefined -g`；查泄漏用 valgrind。sanitizer 和 valgrind 都有明显性能开销，只用于开发调试，别带进生产环境。

## 防御性编程：少给错误机会

- 声明即初始化：指针给 `NULL`，整数给 0
- `malloc` 必判 `NULL`，`free` 后置空（见[内存管理](04-memory-management.md)）
- 数组边界用 `size_t` 配 `<` 写循环，别用 `<=`
- 优先选带边界的库函数：`snprintf`、`fgets`，而不是早已被标准移除的 `gets`
- 函数入口检查参数，尤其是外部传进来的指针

相关阅读：[内存管理](04-memory-management.md)
