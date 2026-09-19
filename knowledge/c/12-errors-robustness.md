---
title: 错误处理：在没有异常的世界里
order: 12
tags: 错误码, errno, goto cleanup, assert, 防御式编程
summary: 返回值与 errno 的精确语义、goto cleanup 模式的完整展开与变体、assert 与运行时检查的分界线、致命错误的处理决策，以及一套可直接落地的错误码 API 设计规约。
---

C 没有异常、没有 Result 类型、没有自动资源清理——错误处理完全靠**设计**。这带来一个常被低估的结论：C 程序的错误处理质量，几乎全部由 **API 形状**决定。一个「失败返回 NULL 但不说为什么」的接口，调用方注定写出一堆不检查的调用；一个错误码设计清晰的接口，调用方想写错都难。

本篇沿四个层次展开：**报告层**（返回值与 errno 的精确语义）、**传播层**（goto cleanup 与错误码传递）、**断言层**（assert 与运行时检查的分界）、**决策层**（什么时候崩、什么时候恢复）。每一层都给可直接套用的规约。

## 1. 报告层：三种错误返回形态

### 1.1 返回值的三种惯例

```c
/* 惯例①：状态码（0 = 成功——与 shell、main 返回值同源） */
int parse_config(const char *path);            /* 0 成功，负数错误码 */

/* 惯例②：指针 or NULL（分配/查找类） */
char *strdup(const char *s);                   /* NULL = 失败 */

/* 惯例③：哨兵值（结果本身就是 int/long 的函数） */
long strtol(const char *s, char **end, int base);  /* LONG_MIN + errno = ERANGE */
ssize_t read(int fd, void *buf, size_t n);     /* -1 = 失败，0 = EOF */
```

哨兵值形态（惯例③）有个绕不开的歧义：**「合法结果」与「错误」可能重叠**——`strtol` 解析失败和「真的解析到了 LONG_MIN」返回值相同，必须靠 errno 二次确认。这就是「错误码与结果分离」形态存在的原因：

```c
/* 惯例④：错误码出参 + 结果返回（结果任意复杂、错误信息不丢失） */
typedef struct { long value; } parse_result_t;
int parse_long(const char *s, long *out);      /* 0 成功（*out 有效），非 0 错误码 */

long v;
if (parse_long(input, &v) != 0) { /* 处理错误，out 未被触碰 */ }
```

出参形态是现代 C API 的推荐默认：**错误路径上不触碰输出参数**，调用方的分支逻辑最干净。`read` 返回 `ssize_t`（有符号）而不是 `size_t` 正是为了让 −1 能表示错误——[第 2 篇](02-types.md)的类型选择在这里直接变成 API 设计。

### 1.2 errno：为什么它必须存在

NULL 只说「失败了」，errno 回答「为什么」。精确语义：

```c
#include <errno.h>
#include <string.h>

errno = 0;                       /* ① errno 不会自动清零：主动清 */
FILE *f = fopen(path, "r");
if (!f) {
    perror(path);                /* ② "path: No such file or directory" */
    fprintf(stderr, "errno=%d (%s)\n", errno, strerror(errno));
}
```

- errno 是**线程局部**的全局变量（C11 起标准保证），多线程下每个线程独立——这是 errno 在多线程时代还能用的原因。
- **只有「调用报告失败」时读 errno 才有意义**：库函数成功时也可能顺手改了 errno（内部试探调用），「先调 f、再读 errno」之间隔了别的调用，errno 的值就不可信了。标准模式是 `errno = 0;` → 调用 → 立即检查。
- errno 的值是**全程序共享的编号空间**（POSIX 定义 EDOM/EILSEQ/ERANGE…），这也是它能横跨所有库传递错误信息的原因。

### 1.3 错误码设计：一份能活的枚举

自己的库要有自己的错误码，设计要点直接写成模板：

```c
typedef enum {
    E_OK = 0,                    /* 0 永远是成功：调用处 if (ret) 的直觉 */
    E_NOMEM = 1,
    E_IO,
    E_PARSE,
    E_RANGE,
} status_t;

const char *status_str(status_t s);   /* 用 X-Macro 生成（第 11 篇第 4 节） */
```

四条规约：**0 恒为成功**；错误码集中定义（不散落魔法数字）；提供 `status_str`（日志可读）；**每个公开函数的文档写明可能返回哪些码**（调用方据此决定处理哪些、跳过哪些）。

## 2. 传播层：goto cleanup 与资源交接

### 2.1 完整模式：多资源、单出口

[第 3 篇](03-operators-control.md)给过骨架，这里展开成可复用的完整版——**按资源获取的逆序释放、每层 goto 只跳到它需要的那一档**：

```c
status_t process_file(const char *in_path, const char *out_path) {
    status_t st = E_IO;                        /* 默认错误：所有失败路径都有值 */
    FILE *in = fopen(in_path, "rb");
    if (!in) goto out;

    FILE *out = fopen(out_path, "wb");
    if (!out) goto close_in;                   /* 只需回收 in */

    char *buf = malloc(BUFSZ);
    if (!buf) { st = E_NOMEM; goto close_out; }

    st = transform(in, out, buf);              /* 核心逻辑；成功时 st 已是 E_OK */

    free(buf);                                 /* 成功路径的资源释放… */
close_out:
    fclose(out);
close_in:
    fclose(in);
out:
    return st;                                 /* 单一出口 */
}
```

模式的三条纪律：

1. **st 先给默认错误值**：任何 goto 路径都不会「忘写返回值」（编译器对未初始化返回值的检查不可靠）。
2. **标签阶梯与获取顺序逆对应**：新资源失败时 goto 到「刚好回收已有资源」的那一档，不多不少。
3. **失败路径不触碰输出参数**（上节惯例④的延续）。

### 2.2 资源交接：谁负责释放

错误处理最难的不是报告错误，而是**失败时已经分配的资源归谁**。两个可靠约定：

```c
/* 约定①：失败即自清（函数内部负责把一切都收干净再返回错误） */
char *read_all(FILE *f);        /* 失败返回 NULL，内部已 free 一切中间产物 */
/* 调用方：失败时只处理错误，无需关心内部 */

/* 约定②：资源随参数移交（被调函数接管所有权，无论成败） */
int db_insert(db_t *db, record_t *rec);   /* 成败都由 db_insert 最终 free(rec) */
/* 调用方：调用后立刻忘记 rec，不问成败 */
```

约定②（「接管」）能消灭一大类泄漏：调用方不需要为「成功走 A 路径、失败走 B 路径」写两份释放逻辑——**所有权单向流动**，永远只有一个持有者。这呼应[第 7 篇](07-dynamic-memory.md)的所有权四模式：错误处理与所有权是同一个设计问题的两面。

> [!WARNING]
> 错误路径的代码**极少被执行、几乎从不被测试**，却是 bug 密度最高的区域（资源泄漏、双重释放、状态不一致）。对策：让错误路径可注入（注入 fake malloc 返回 NULL、注入 IO 失败），在 sanitized 构建下把每条失败分支都跑一遍。第 10 篇的三套配置里，sanitized 配置的存在价值一半在这里。

## 3. 断言层：assert 与运行时检查的分界

### 3.1 两种检查，两种命运

| 维度   | `assert(cond)`              | 运行时检查（if + 错误码）        |
| ---- | --------------------------- | ---------------------- |
| 检测对象 | **程序员犯的错**（违反函数契约/内部不变量）     | **运行时遇到的问题**（坏输入、IO 失败、资源不足） |
| 发布行为 | `-DNDEBUG` 下**整体消失**         | 永远在                    |
| 失败动作 | 打印并 abort                    | 按错误处理策略走               |
| 典型用例 | `assert(idx < len)`（调用方违反约定） | `if (idx >= len) return E_RANGE;`（外部输入越界） |

分界线一句话：**用户的输入不可信（运行时检查），调用方代码可信（断言）**。把「外部输入检查」写成 assert，发布版（NDEBUG）里检查消失——输入直达 UB；把「内部不变量」写成运行时检查，正常路径背上永远用不到的错误处理代码。混淆两者的方向性事故：前者是安全漏洞，后者是代码噪音。

### 3.2 assert 的三个坑

```c
/* 坑①：assert 里的表达式带副作用 —— NDEBUG 下副作用整个消失 */
assert(list_remove(l, item) == 1);      /* ❌ 发布版里 remove 根本没执行！ */
int removed = list_remove(l, item);     /* ✅ 副作用放外面 */
assert(removed == 1);

/* 坑②：assert 失败信息只有文件与行号 */
assert(p != NULL && "p 来自上层调用，可能未初始化");
/* 字符串在布尔语境恒真：只是借 assert 的输出携带说明——合法且好用的惯用法 */

/* 坑③：以为 assert 会在发布版兜底 */
assert(sqrt_arg >= 0);                  /* ❌ 发布版没有这道检查 */
if (sqrt_arg < 0) return E_RANGE;       /* ✅ 对外函数：先检查后计算 */
```

`_Static_assert(cond, "msg")`（C11）是编译期兄弟：布局、枚举数、版本号这类「必须恒真」的条件在编译期钉死，零运行时成本（[第 8 篇](08-structs-unions.md)已用于布局锁定）。

## 4. 决策层：崩，还是恢复？

### 4.1 三种失败，三种策略

1. **可恢复（输入错、IO 错）**：报告给调用方，调用方决定重试/跳过/上报。绝大多数错误属于此类。
2. **不可恢复但可记录（内部不变量被破坏）**：abort 前打印现场（assert 的行为），修复靠开发流程。继续跑只会把损坏扩散。
3. **OOM 这类「系统级耗尽」**：分层决策——库层只报告（E_NOMEM），应用层决定「降级/重试/退出」。库函数悄悄 abort 是灾难（第 7 篇的玩具 malloc 也是这么处理的：返回 NULL，决策权上交）。

`exit` 与 `abort` 的分工：`exit` 走正常清理（atexit 注册的回调按注册逆序执行、刷新 stdio 缓冲），`abort` 立即杀进程（不清理——留给核心转储）。`assert` 失败用 abort 的原因正是「现场已被破坏，清理本身可能二次踩踏」。

### 4.2 信号：崩溃时能做的很少

SIGSEGV 到达时，进程处于未定义状态——**信号处理器里能安全做的事屈指可数**（写一个 `volatile sig_atomic_t` 标志、`_exit`）。在 SIGSEGV 处理器里打日志、free 内存、回滚事务，全部是二次 UB。「崩溃时保存现场」的正确姿势是**事前**布置：core dump（`ulimit -c unlimited`）+ 事后 gdb 分析，而不是临场发挥。

## 5. 一套可直接落地的规约

1. **API 默认形态**：`status_t fn(输入..., 输出*...)`——错误码返回 + 出参结果；失败路径不触碰出参。
2. **资源交接默认「接管」**：参数带进来的堆资源，被调函数负责释放（或文档明确「借用」语义）。
3. **每层只处理自己能处理的错误**：库层报告不决策，应用层决策。禁止「错误打到一半返回成功」与「吞掉错误码返回 0」。
4. **assert 管契约、if 管输入**：两者边界清晰，NDEBUG 才不会拆掉安全网。
5. **错误路径注入测试**：sanitized 构建 + fake 分配器，每条失败分支至少跑一次。
6. **日志与错误码双轨**：errno/strerror 给运维（strerror 是线程安全的 `strerror_r`/C11 `strerror` 行为注意版本），错误码给程序分支。

## 6. 陷阱清单

- 读 errno 前不清零、中间隔了别的调用：errno 语义只在「失败后立即读」成立。
- `strtol` 只看返回值：哨兵值歧义；errno + end 指针一起用（[第 2 篇](02-types.md)）。
- goto cleanup 的标签档位与资源获取顺序错配：漏释放或重复释放。
- 默认返回值忘设（所有 goto 路径）：st 初始化为错误值。
- assert 里放副作用：NDEBUG 下消失；先求值再断言。
- 对外部输入用 assert：发布版检查消失，输入直达 UB。
- 库函数里 abort 处理可恢复错误：决策权上交，返回错误码。
- SIGSEGV 处理器里做复杂事：二次 UB；事前布置 core dump。
- 失败路径不释放已获取资源（约定①）或调用方仍持有已移交资源（约定②）：所有权文档化。
- 错误信息丢失（层层返回 E_FAIL）：每层补充上下文（包装错误码 + 记录现场）再上抛。

## 7. 小结

- C 的错误处理质量由 API 形状决定：错误码 + 出参是默认推荐形态，哨兵值形态必须配 errno 消歧。
- errno 是线程局部的「失败原因」存储，只在「失败后立即读」有意义；库层用它对齐全系统的错误编号空间。
- goto cleanup 的完整纪律：默认错误值、标签阶梯与获取逆序对应、失败路径不碰出参；资源交接优先「接管」约定，让所有权单向流动。
- assert 检测程序员错误（发布消失），运行时检查检测运行时问题（永远在）——边界画在「调用方代码 vs 外部输入」上。
- 失败分三策：可恢复的交调用方、不变量破坏的 abort、系统级耗尽分层决策；SIGSEGV 处理器里几乎什么都做不了，现场保存靠事前的 core dump。
- 错误路径是测试盲区与 bug 密集区：注入式失败测试 + sanitized 构建是把错误路径纳入日常验证的唯一办法。

## 8. 练习

**1.** 实现第 1.3 节的 `status_str`（用第 11 篇的 X-Macro），并写一个测试把每个错误码的字符串打印出来。新增一个错误码时需要改几处？

> [!TIP]
> 思路列表宏一处 + 新增使用方分支处。X-Macro 保证枚举与字符串同步；「需要改几处」的答案暴露设计质量：好设计里新增错误码只碰列表。反例：错误码散在各 .c 的 #define 里——新增时字符串表漏改，日志打出乱码。

**2.** 把下面函数改造成 goto cleanup 模式，并指出原版的三个泄漏路径。

```c
int load_level(const char *path, level_t **out) {
    FILE *f = fopen(path, "r");
    char *buf = malloc(4096);
    level_t *lv = malloc(sizeof *lv);
    if (!f || !buf || !lv) return -1;
    if (fread(buf, 1, 4096, f) == 0) return -1;
    if (!parse(buf, lv)) return -1;
    *out = lv;
    return 0;
}
```

> [!TIP]
> 思路三个 return -1 各漏不同资源（第一个漏全部、第二个漏 buf+lv+f、第三个漏 buf+f）；fopen 失败时后续 malloc 仍会执行（顺序浪费）。改造：阶梯标签 + st 默认值 + 逆序释放；顺手把资源获取排序为「可能失败的尽快失败」（先分配再打开，或反之统一）。

**3.** 设计「接管所有权」的队列 API：`queue_push(q, item)` 接管 item 的所有权，`queue_pop(q, &item)` 移交所有权。写出 push/pop/destroy，并论证「调用方调用 push 后不再使用 item」如何被文档与命名强化。

> [!TIP]
> 思路命名带语义：`queue_take(q, item_t *out)`（take = 移交进来）、`queue_give(q, item_t *out)`（give = 移交出去）。destroy 遍历 free 全部节点（队列是最后一任持有者）。文档用一句话钉死：「push 之后 item 的生命周期归队列」。命名即文档是 C 里最低成本的契约手段。

**4.** 分辨下面四处检查该用 assert 还是运行时检查，并说明理由。

```c
/* A */ assert(user_input_len < MAX);
/* B */ assert(node->left == NULL || node->left->parent == node);
/* C */ if (conn == NULL) return E_CLOSED;
/* D */ assert(sizeof(packet_t) == 16);
```

> [!TIP]
> 思路A 错——外部输入必须运行时检查（发布版不能裸奔）。B 对——树结构不变量，违反即代码 bug，assert 合适。C 对——连接关闭是运行时事件。D 应改为 `_Static_assert`（编译期钉死布局，不用等运行）。这组对比就是「契约 vs 输入」分界线的具体化。

**5.** 写一个「故障注入」malloc（环境变量 FAIL_AT=N 时第 N 次 malloc 返回 NULL），用它把第 2 题改造后的函数的所有失败路径跑一遍（sanitized 构建）。

> [!TIP]
> 思路封装 `xmalloc`：计数器 + `getenv("FAIL_AT")`，命中即返回 NULL。测试循环 FAIL_AT=1..k 逐次命中不同分配点，ASan 检查每条路径无泄漏。这套脚手架一次编写，所有带分配的函数终身受益——错误路径测试的门槛从「没做过」降到「跑个循环」。

**6.** 讨论：`fopen` 失败后调用 `perror(path)` 的输出为什么比 `strerror(errno)` 多了上下文？在多层调用栈里（main → load → parse → fopen），错误信息应该在哪一层被补充？

> [!TIP]
> 思路perror 把「哪个文件失败」拼进信息——上下文（path）只在调用点可得，errno 只有「为什么」。多层栈的答案：**在错误首次产生层记录精确现场（文件名+操作），在每层上抛时补充本层上下文（哪个环节），在最顶层统一决策与汇报**。错误信息像洋葱一样层层包裹，比「一路返回 -1」可诊断性高一个量级。
