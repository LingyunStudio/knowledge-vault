---
title: 陷阱全景：一份代码审查清单
order: 14
tags: 代码审查, volatile, restrict, inline, 反模式
summary: volatile/restrict/inline 三个散点的精确语义，按七个类别组织全书事故的审查清单，一次 PR 审查的实操顺序，以及反模式速查表——把 1 到 13 篇的知识压缩成可执行的动作。
---

这是 C 篇章的收束。前十三篇每篇都在「讲透一类东西」，本篇做两件收尾的事：补齐三个一直没展开的散点（`volatile`、`restrict`、`inline`——它们是「看似简单、语义陷阱」的最后一批代表），然后把全书的事故汇编成**审查清单**——知识只有变成动作才有价值，这份清单就是那个动作。

## 1. 三个散点的精确语义

### 1.1 volatile：禁优化开关，不是线程同步

`volatile` 的语义只有一句话：**禁止编译器把这个变量的读写优化掉或重排到不可见**。它管的是编译器，不管 CPU、不管缓存一致性：

```c
volatile uint32_t *status_reg = (volatile uint32_t *)0x40000000;
while (*status_reg & BUSY) ;        /* ✅ 每次循环真的读寄存器：硬件状态会变 */

volatile int flag = 0;
/* 线程 A */ flag = 1;
/* 线程 B */ while (!flag) ;        /* ❌ volatile 不保证可见性、不保证顺序、更不原子 */
```

第一段是 volatile 的本职——**内存映射寄存器**：没有 volatile，编译器看到循环体没改 `*status_reg`，直接折叠成单次读。第二段是它最著名的滥用：多线程同步需要的是**原子操作与内存序**（C11 `<stdatomic.h>`），volatile 给不了。

volatile 的三个合法场景：MMIO 寄存器（嵌入式）、`setjmp` 之间的局部变量、信号处理器访问的 `volatile sig_atomic_t`。除此之外的现代代码里，看到 volatile 应先怀疑用错了。

### 1.2 restrict：把「不别名」的承诺交给编译器

`restrict`（C99）是性能关键字：**承诺本指针是指向对象的唯一访问通道**，编译器据此放手优化：

```c
/* 用户的 memcpy 版本：src 与 dst 不重叠时 memcpy 的语义才成立 */
void *memcpy(void *restrict dst, const void *restrict src, size_t n);

void add_arrays(double *restrict out, const double *restrict a,
                const double *restrict b, size_t n) {
    for (size_t i = 0; i < n; ++i)
        out[i] = a[i] + b[i];
    /* 有 restrict：编译器知道 out 与 a/b 无关，向量化、重排全放开。
       无 restrict：out 可能就是 a，每次写 out[i] 都可能改 a[i]，
       只能保守地逐元素读写。 */
}
```

违反 restrict 承诺（`add_arrays(x, x, y, n)`）是 UB。它典型用于数值循环与自写拷贝函数；代价是「承诺的责任在你」——调用方传入重叠指针时，锅不在编译器。

### 1.3 inline：请求，不是命令

C99 的 `inline` 语义出了名的绕（inline 定义与 external 定义的关系规则），实用结论两条：

1. **头文件里的小工具函数写 `static inline`**——每单元一份副本、无外部符号、无链接问题，这是 99% 场景的正确答案。
2. **inline 不保证内联**（`-O0` 下一切内联都被忽略），性能调优别依赖它；真正的热点内联看编译器报告（`-Winline`、`__attribute__((always_inline))` 是最后手段）。现代编译器对「该不该内联」的判断基本好于人类——把 inline 当「消除 static 函数放头文件的链接问题」的工具就好。

## 2. 审查清单：七个类别

审查一段 C 代码时，按下面的类别过一遍。每条都是前文某个事故的压缩形态，条目后括号标注展开篇目。

### 2.1 类型与算术

- [ ] 数组下标、长度、尺寸全是 `size_t`；比较双方同类型，无符号与有符号不混比（2）
- [ ] 倒数循环不用 `i >= 0` 配无符号（2）
- [ ] `(a + b) / 2` 类中间结果检查溢出（2）
- [ ] 外部输入解析用 strtol 系 + errno + end 指针，不用 atoi/scanf 返回值裸奔（2）
- [ ] 浮点不判等、金额不是浮点、大数组求和注意精度（2）
- [ ] 位运算与比较混排有括号（3）

### 2.2 指针与内存

- [ ] 指针声明即初始化（NULL 或有效值）（4）
- [ ] 解引用前三问：非空？还在生命周期？在界内？（4）
- [ ] malloc 判空；calloc 用于外部可控的乘法（7）
- [ ] realloc 用临时变量接收（7）
- [ ] free 后置 NULL；同一内存只有一个所有者（7）
- [ ] 返回值不指向栈内存；出参缓冲区由调用方提供时带尺寸（4/7）
- [ ] 指针强转后解引用检查别名合法性：memcpy/union 是安全通道（8）

### 2.3 数组与字符串

- [ ] 函数签名带长度或用哨兵，二者必居其一且文档写明（5）
- [ ] 循环半开区间 `i < n`；边界条件「n=0」「n=1」专门想一遍（5）
- [ ] strcpy/sprintf/strcat/scanf %s/gets 一律替换为带界版本（5）
- [ ] strncpy 不再使用（装满不终止）；字符串构造用 snprintf 两遍法（5）
- [ ] strcmp 只判符号；循环外缓存 strlen（5）
- [ ] 二进制数据走 memcpy，不走 str 系（5）
- [ ] ctype 函数的参数先转 unsigned char（5）

### 2.4 结构与布局

- [ ] 结构体成员从大到小排；关键布局有 `_Static_assert` 锁定（8）
- [ ] 内含指针的结构体定义了拷贝策略（clone 或文档声明共享）（8）
- [ ] 大结构体传 const 指针（8）
- [ ] tagged union 的标签-数据同步由构造/设置函数保证（8）
- [ ] 协议/文件格式逐字段序列化，不用 packed 直接 cast（8）
- [ ] 变长对象用柔性数组成员一次分配（8）

### 2.5 错误处理

- [ ] API 形态：错误码返回 + 出参；失败路径不触碰出参（12）
- [ ] goto cleanup：默认错误值、标签阶梯与获取逆序对应、单出口（12）
- [ ] errno 只在失败后立即读；strtol 类哨兵 API 配 errno（12）
- [ ] assert 管契约、if 管输入，分界清晰；assert 内无副作用（12）
- [ ] 错误路径有注入测试（12）
- [ ] 资源交接有明确约定（接管或借用）且命名体现（12）

### 2.6 作用域、链接与并发

- [ ] 头文件自足、有 guard、只放声明（6/10）
- [ ] 每个 .c 首先包含自己的 .h（10）
- [ ] 全局可变状态过「重入、测试、并发」三问，不合理就显式传状态（6）
- [ ] static 划分接口与私有（6）
- [ ] 多线程共享数据用 C11 原子或锁，不用 volatile（13/本篇）
- [ ] 忙等待循环有 volatile/原子/阻塞原语（3）

### 2.7 工程与构建

- [ ] `-Wall -Wextra -Werror`（+ 渐进 `-Wconversion -Wshadow`）常开（13）
- [ ] 三套配置：debug(-O0/-g)、sanitized(-O1+ASan+UBSan)、release(-O2+加固)（10/13）
- [ ] CI 在 sanitized 配置下全绿（13）
- [ ] Makefile 有头文件依赖生成（-MMD -MP）（10）
- [ ] 崩溃现场有 core dump 配置（13）

## 3. 一次 PR 审查的实操顺序

拿到一个改动，按「从整体到细节」的顺序走：

1. **先看构建配置**：新文件进了构建吗？警告开了吗？有没有引入新的全局状态？
2. **看接口**：新函数的签名——错误如何返回？资源谁释放？参数类型（size_t？const？restrict 有没有正当理由）？接口形状决定后面所有代码的质量上限。
3. **看内存流**：每个 malloc 的对应 free 在哪个路径？goto cleanup 阶梯对不对？谁持有返回的指针？
4. **看边界**：所有循环的下标范围、所有 memcpy 的长度来源、所有字符串的终止符。
5. **跑 sanitized 构建**：合并前的最后一道闸，报告按三个坐标直接修。

一份好的审查意见引用清单编号（「这条违反 2.2 第 3 条」），让讨论聚焦于规则而不是口味——清单的隐藏价值是**把品味争议变成规则引用**。

## 4. 反模式速查

每条一句话，见到即改：

| 反模式                                        | 一句话理由                    |
| ------------------------------------------- | -------------------------- |
| `#define` 当常量用                              | 无类型无作用域；enum/const 更好      |
| 用宏写「函数」                                     | 双重求值与无类型检查；static inline   |
| `printf(msg)` 直接打印变量                          | 格式化字符串漏洞；printf("%s", msg) |
| `while (1)` 忙等无 volatile/阻塞                   | 优化器会删空它                    |
| volatile 当线程同步                               | 它不保证原子性与可见性                |
| `p = realloc(p, n)`                          | 失败泄漏旧块                     |
| `if (x = 5)`                                  | 赋值当条件                      |
| 用 `atoi` 解析用户输入                               | 不报错；strtol                 |
| `strcpy` + 手动拼接                               | 无界；snprintf                |
| 全局变量当返回值                                      | 不可重入不可测试                   |
| 头文件里 `int x;`                                 | 定义进头文件；extern              |
| switch 穿透不标注                                  | 十年后没人敢动                    |
| `assert` 检查用户输入                               | NDEBUG 下裸奔                 |
| 对结果数组 `sizeof` 求长度（参数退化后）                     | 得到指针大小                     |
| 自写「优化版」memcpy/swap 位技巧                        | 别名 UB；编译器比你快               |

## 5. 小结

- volatile 只禁编译器优化，不给原子性、可见性与顺序——多线程同步用 C11 原子，volatile 留给 MMIO、setjmp、信号标志三个场景。
- restrict 是「不别名」的性能承诺，违反即 UB；static inline 是头文件小工具的标准形态，inline 不保证内联。
- 审查清单的价值在于把知识变成动作：七类条目覆盖全书事故，PR 审查按「构建 → 接口 → 内存流 → 边界 → sanitized」的顺序走。
- 反模式速查与清单互补：前者是「见到即改」的条件反射，后者是「逐项核对」的系统流程。
- C 的安全最终是流程：警告当错误、sanitizer 常驻、清单过 PR——「小心」本身不在任何环节里。

## 6. 练习

**1.** 找出一段真实代码里的 volatile 用法（或自己写三段），逐个判断属于三个合法场景（MMIO/setjmp/信号）还是滥用，滥用的换成正确设施。

> [!TIP]
> 思路常见滥用：多线程标志位（换 atomic_bool）、单线程「防止优化掉计算」（换成把结果用出去或 OpaqueSink 函数）。合法示例：嵌入式读状态寄存器、信号处理器写 `volatile sig_atomic_t got_signal`。

**2.** 给第 7 篇的 vec 实现加 restrict：哪些函数能加？加之前要向调用方承诺什么？

> [!TIP]
> 思路`vec_extend(vec_t *restrict v, const int *restrict src, size_t n)` 可以——src 是外部数组，v 的 data 不应与之重叠。承诺：调用方不得把 v 的 data 或其片段作为 src 传入。收益：拷贝循环可向量化。若 src 可能就是 v 的内部指针（自拷贝语义），不能加。

**3.** 用第 2 节清单审查你之前 13 篇练习里写过的任一段代码（比如环形缓冲区），逐类过一遍，统计发现的问题数。哪个类别问题最多？

> [!TIP]
> 思路多数人自查的分布：边界（2.3）与错误路径（2.5）问题最多，因为它们是「不执行就不暴露」的代码。这个练习的元目标：建立「先怀疑自己练过的代码」的审查直觉。

**4.** 把下面 20 行代码按清单过一遍，列出全部问题并修复。

```c
char *concat_path(const char *dir, const char *name) {
    char buf[256];
    strcpy(buf, dir);
    strcat(buf, "/");
    strcat(buf, name);
    char *out = malloc(strlen(buf));
    strcpy(out, buf);
    return out;
}
```

> [!TIP]
> 思路①strcpy/strcat 无界（256 上限形同虚设）；②malloc 少 1 字节装终止符；③malloc 未判空；④多次遍历低效（snprintf 两遍法一次搞定）；⑤dir/name 的 const 契约倒是有了——修复版用 snprintf(NULL,0) 量长度、malloc(len+1)、snprintf 写入、判空。六处问题集中在 2.2 与 2.3 两类。

**5.** 设计你所在团队（或假想的团队）的「C 代码准入规约」：从本篇清单中挑选强制项（CI 可自动验证的）与评审项（人工过的），各列五条以上。

> [!TIP]
> 思路强制项（CI 可查）：-Werror、sanitizer 全绿、-Wconversion 新代码零警告、clang-tidy 白名单、 forbidstrcpy（正则扫描）。评审项：所有权文档、错误路径测试、结构体布局锁定、全局状态三问、接口形状。强制项越多，评审项越能聚焦真正的设计问题——这是工具链与流程的分工。
