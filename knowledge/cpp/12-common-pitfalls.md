---
title: 常见陷阱与工具
order: 12
tags: 核心, 调试, sanitizers
summary: 悬空引用、迭代器失效、未定义行为；asan/valgrind 与编译器警告体系。
---

C++ 的错误分两类：会当场崩溃的（好事），和不崩溃、悄悄改内存、换个时间在无关地点崩溃的（坏事）。后者的根源几乎都是未定义行为（UB）。好消息是工具链已经很强：编译器警告、sanitizer、valgrind 能把大多数阴险错误变成「当场报错的低级错误」——前提是你真的开着它们。

## 悬空引用：最常见的生命周期错误

```cpp
const std::string& bad() {
    std::string local = "temp";
    return local;              // ❌ 返回局部变量的引用
}                              // local 析构，引用悬空

auto s = bad();                // s 从悬空引用拷贝：未定义行为
```

变体不计其数：返回局部对象的指针、string_view 绑到临时 string、lambda 按引用捕获局部变量后异步执行、vector 扩容后还握着旧引用。共同模式只有一个：**引用/指针/视图的生命周期超过了被指对象**。Rust 用借用检查器在编译期拦这类事，C++ 靠纪律加工具。

## 迭代器失效的真实事故

容器篇给过失效规则表，这里是一个高频事故模板：

```cpp
std::vector<Session> sessions;
for (auto& s : sessions) {
    if (s.expired())
        sessions.erase(/* 指向 s 的迭代器 */);   // ❌ 范围 for 中修改容器
}   // 编译器不报错，行为未定义
```

正确写法是 remove-erase，或用 erase 返回值的手动循环：

```cpp
sessions.erase(std::remove_if(sessions.begin(), sessions.end(),
                              [](const Session& s){ return s.expired(); }),
               sessions.end());
```

纪律一句话：**范围 for 的循环体内绝不修改容器的结构**。

## 未定义行为：编译器假设你不会犯

UB 不是「运行时可能出错」，而是「标准不定义任何行为，编译器可以任意假设」。有符号溢出是最迷惑的例子：

```cpp
bool would_overflow(int a, int b) {
    return a + b < 0;                 // 意图：检测溢出。❌ 但有符号溢出本身就是 UB
}                                     // 编译器有权假设它不溢出 → 直接优化成 return false

bool would_overflow_ok(int a, int b) {
    return b > 0 && a > INT_MAX - b;  // ✅ 先排除会让计算溢出的组合
}
```

同一张暗坑清单：数组越界读写、解引用空/野指针、读未初始化变量、移位越界、生命周期结束后继续使用、数据竞争。它们的表现形式很统一：Release 下「优化坏了」、换台机器就复现不了、调试器单步是对的——因为 UB 剥夺了编译器和你之间的共同前提。

> [!WARNING]
> 不要用「能跑」判断 C++ 代码的正确性。UB 代码可以稳定运行一年，然后在编译器升级后开始崩溃。正确性要靠工具和推理证明，不是靠运行结果祈祷。

## Sanitizer：把 UB 变成当场崩溃

AddressSanitizer（asan）+ UBSan 是日常开发的标配：

```bash
g++ -std=c++17 -g -fsanitize=address,undefined -fno-omit-frame-pointer app.cpp -o app
./app
```

崩溃报告长这样：

```text
==12345==ERROR: AddressSanitizer: heap-use-after-free on address 0x60200000eff1
READ of size 4 at 0x60200000eff1 thread T0
    #0 0x1085f in main app.cpp:12          ← 哪一行读的
freed by thread T0 here:
    #0 0x10330 in operator delete
    #1 0x1084a in main app.cpp:9           ← 哪一行释放的
```

asan 直接报出**哪一行读**了已释放内存、**哪一行释放**的——人工查这种问题要以小时计。代价是内存约 2-3 倍、速度约 2 倍慢，所以它用于开发与测试，不进生产。UBSan 检查有符号溢出、错位转换等，开销更小，可以常开。

valgrind 是另一条路：不改编译参数直接跑现成二进制，抓内存错误与泄漏；比 asan 慢一个数量级，但没有重编译门槛，适合排查拿不到构建环境的程序。

```bash
valgrind --leak-check=full ./app    # 逐行报告泄漏的分配栈
```

多线程程序还有专属工具：`-fsanitize=thread`（TSan）专抓数据竞争——它是另一套运行时，不能与 asan 同时开，按需分别构建。

| 工具 | 编译 | 速度代价 | 强项 |
| --- | --- | --- | --- |
| ASan / UBSan | 需重编 | 约 2x | 报错现场精准，易集成进 CI |
| Valgrind | 无需重编 | 约 20x | 泄漏检测、无源码的二进制 |
| 静态分析 | 编译期 | 无运行时代价 | 跨函数推断，问题提前到编译期 |

## 警告体系：把纪律交给编译器

```bash
g++ -std=c++17 -Wall -Wextra -Wpedantic -Werror -Wshadow -Wconversion
```

- `-Wall -Wextra` 是底线；新项目直接 `-Werror`，警告即错误，警告就不会堆积
- `-Wshadow` 抓变量遮蔽，`-Wconversion` 抓隐式窄化转换（严格，按项目接受度开）
- `clang-tidy` 是静态分析集大成者：能查「析构非虚但类有虚函数」「被移动后使用」等模式，与编译器警告互补
- CMake 里一行接入：`add_compile_options(-Wall -Wextra -Wpedantic -Werror)`

> [!TIP]
> 工具采用顺序：先开 asan 跑测试（抓内存错误），再叠 UBSan（抓算术与类型），静态分析进 CI 慢慢扫。抓到的问题里，悬空引用与迭代器失效占了初学者 bug 的大半——它们也正是 RAII、智能指针、容器规则那几章反复强调的机制问题，工具只是兜底。

## 练习

- [ ] 写一个包含 use-after-free 的小程序，分别在普通编译、asan、valgrind 下运行，对比错误信息质量
- [ ] 制造有符号溢出，用 `-O0` 与 `-O2` 分别编译运行，观察行为差异，体会 UB 的「优化敏感」
- [ ] 给旧项目开 `-Wshadow -Wconversion`，逐条判断新冒出的警告哪些是真 bug
- [ ] 写一个多线程计数器，不开与开 TSan 各跑一次，观察数据竞争的报告

相关阅读：[STL 容器](06-stl-containers.md)
