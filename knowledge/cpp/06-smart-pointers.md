---
title: 智能指针：把所有权写进类型
order: 6
tags: unique_ptr, shared_ptr, weak_ptr, 所有权, 循环引用
summary: unique_ptr 的零开销与移动语义、shared_ptr 的控制块机制与线程安全边界、weak_ptr 打破循环引用、所有权决策树（unique 默认、shared 需证明、裸指针即借用），以及与 C API 的删除器包装。
---

裸指针的致命问题不是危险，是**歧义**：拿到一个 `Widget*`，谁负责 delete？拷贝它算共享吗？这些问题在签名里看不出来，全靠注释与默契。智能指针的回答是把答案**编码进类型**：`unique_ptr` 说「我独占，转移必须显式」，`shared_ptr` 说「我们共享，最后一个走的人锁门」，裸指针则降级为「借用」——不拥有、只使用。

三个工具都是 RAII（[第 4 篇](04-raii.md)）的应用：析构函数释放资源。本篇讲清三者的机制、成本边界与选择标准，最后给出一个可执行的「所有权决策树」。

## 1. unique_ptr：独占所有权，默认选择

### 1.1 基本用法与零开销

```cpp
#include <memory>

auto w = std::make_unique<Widget>(arg1, arg2);   // 构造：优先用 make_*

w->method();                    // 像指针一样用
(*w).method();

// 不可拷贝（独占！），可移动（所有权转移）
auto w2 = w;                    // ❌ 编译错误：独占不允许共享
auto w3 = std::move(w);         // ✅ 所有权移交：w 变为空（nullptr）

w3.reset();                     // 显式释放（析构函数自动做）
Widget *raw = w3.get();         // 借用裸指针（不转移所有权、不延长生命周期）
```

「零开销」在 unique_ptr 上是字面意义的：**sizeof(unique_ptr<T>) == sizeof(T\*)**，析构就是内联的 delete。因为独占 + 不可拷贝，它不需要引用计数——编译器把整个包装优化到与手写 new/delete 完全相同的机器码。

### 1.2 为什么 make_unique 而不是 new

```cpp
// 风险写法：
process(std::unique_ptr<Widget>(new Widget), compute());  // C++17 前的隐患
// 计算顺序未定：compute() 可能抛在 new 之后、包装之前 → 泄漏

// 正确写法：
process(std::make_unique<Widget>(), compute());  // 异常安全，且一次表达
```

make 系列的收益：异常安全（new 与智能指针构造之间无窗口）、代码重复少（类型只写一次）、`make_shared` 还能把对象与控制块合并成一次分配（下节）。

### 1.3 数组与自定义删除器

```cpp
auto buf = std::make_unique<char[]>(4096);       // 数组特化：delete[] 语义
buf[0] = 'a';

// 包装 C 资源：自定义删除器（unique_ptr 的第二参数）
struct FileCloser {
    void operator()(FILE *f) const noexcept { if (f) fclose(f); }
};
using FilePtr = std::unique_ptr<FILE, FileCloser>;
FilePtr file{fopen("data.bin", "rb")};           // RAII 的 FILE*，异常安全
if (!file) throw std::runtime_error("open failed");
```

自定义删除器让 unique_ptr 能包住**一切 C 风格资源**（fd、句柄、malloc 内存配 free）——这常常比手写 RAII 类（[第 4 篇](04-raii.md) 3.1 节）更省事。注意：非默认删除器会让 unique_ptr 变大（要存删除器），独占语义不变。

## 2. shared_ptr：共享所有权的成本账

### 2.1 控制块机制

```cpp
auto a = std::make_shared<Widget>();
auto b = a;                    // 拷贝：引用计数 +1

std::cout << a.use_count();    // 2
```

每个 shared 管理的对象带一个**控制块**：强引用计数 + 弱引用计数 + 删除器等元数据。拷贝 shared_ptr 是一次**原子的**计数递增，析构是原子递减，减到 0 才 delete 对象。「最后一个走的人锁门」的实现就是原子计数。

### 2.2 成本：比直觉高

| 成本项          | 数量级                                    |
| --------------- | ----------------------------------------- |
| 大小            | 两个指针（对象指针 + 控制块指针），16 字节   |
| 拷贝/析构       | 原子操作（有锁前缀指令，比普通递增慢数倍）   |
| 内存            | 控制块约 16~32 字节/对象                    |
| make_shared 优化 | 对象与控制块**一次分配**（省一次 malloc、缓存友好） |

共享所有权不是免费的「保险」，是一笔真实的运行时税。这笔税买来的能力只有一个：**对象的生存期由「最后一个使用者」决定，且使用者集合动态变化**。

### 2.3 线程安全的精确边界

最常被误解的一条：**控制块（计数）是线程安全的，对象不是**。

```cpp
auto sp = std::make_shared<std::vector<int>>();

// ✅ 多线程同时拷贝/析构 sp 本身：计数原子，安全
// ❌ 多线程同时 sp->push_back(...)：对象操作无保护，数据竞争！
```

shared_ptr 不给对象加锁，它只保证「对象在你用的时候活着」。并发访问对象本身仍需 mutex/atomic（[第 13 篇](13-concurrency.md)）。

## 3. weak_ptr：观察者与循环引用的解药

### 3.1 循环引用：shared 的天然死穴

```cpp
struct Node {
    std::shared_ptr<Node> next;
    ~Node() { std::cout << "freed\n"; }
};

auto a = std::make_shared<Node>();
auto b = std::make_shared<Node>();
a->next = b;                    // b 的计数 2
b->next = a;                    // a 的计数 2
// a、b 离开作用域：计数各减 1 → 都还剩 1（对方持有）→ 谁也不会死 → 泄漏
```

两个 shared_ptr 互相引用 = 引用计数永不归零。GC 语言靠「可达性」回收没有这个问题；引用计数只认「谁还指着我」。

### 3.2 weak_ptr：不增加所有权计数

```cpp
struct Node {
    std::shared_ptr<Node> next;              // 拥有：链表向前的方向
    std::weak_ptr<Node> prev;                // 观察：反向引用不拥有
};

// 使用 weak 时必须「升级」为 shared（临时获得所有权）：
std::weak_ptr<Node> w = a;
if (auto locked = w.lock()) {                // 原子地「还活着就拿 shared」
    locked->next;                            // 使用
} else {
    // 对象已释放：观察者必须处理这个分支
}
```

weak_ptr 持有弱计数（控制块活着但对象可死）；`lock()` 原子地把 weak 升级为 shared——「还活着就给我一份所有权，死了就告诉我」。**用 weak 的地方就是「我需要访问但不需要负责」**：缓存、观察者、反向指针、父指针。

所有权形状的口诀：**树/链表向下用 shared（或 unique），向上用 weak；缓存用 weak；一切「回指」用 weak**。

## 4. 所有权决策树

拿到一个「需要堆对象」的场景，按顺序问：

```text
1. 对象生存期是否由作用域决定？
   → 是：直接建栈对象/容器成员，连指针都不需要 ✅（最常见的正确答案）

2. 确实需要堆/多态/延迟构造？
   → 有唯一明确的所有者吗？
     → 有：unique_ptr（默认答案）
     → 没有，多个使用者动态共享生存期：
       → shared_ptr，且「回指/观察」的位置用 weak_ptr

3. 只是用一下，不拥有？
   → 裸指针或引用（const T& / T*）——借用，不管理生存期
```

由此得到签名语义表：

| 签名                       | 含义                                   |
| -------------------------- | -------------------------------------- |
| `f(Widget &w)` / `f(const Widget &w)` | 借用（引用必须非空）              |
| `f(Widget *w)`             | 借用，可空（先判空）                    |
| `f(std::unique_ptr<Widget> w)` | **接管所有权**（sink 参数）          |
| `f(std::shared_ptr<Widget> w)` | 共享所有权（成为共同持有者）          |
| `std::unique_ptr<Widget> f()` | 工厂：交出新建对象的所有权            |
| `std::shared_ptr<Widget> f()` | 工厂：交出共享句柄                    |

> [!WARNING]
> **接口里默认裸指针/引用（借用），智能指针只出现在所有权交接点。** `void f(std::unique_ptr<Widget>&)` 这类「借个 unique_ptr」的签名几乎是设计错误（既不能拷贝又强制堆分配）；`shared_ptr` 参数意味着「我要参与所有权」，调用方会付原子计数——不参与就别要。

## 5. 实战细节

### 5.1 enable_shared_from_this：对象要给自己发 shared

```cpp
class Session : public std::enable_shared_from_this<Session> {
public:
    void start() {
        // ❌ std::shared_ptr<Session>(this)：第二个所有者！双重释放
        auto self = shared_from_this();        // ✅ 与既有控制块共享计数
        async_op([self] { /* 捕获 shared：回调期间保证活着 */ });
    }
};
// 前提：对象已经由 shared_ptr 管理（栈对象调 shared_from_this 是 UB）
```

异步回调、注册到全局表——凡是「对象需要把自己的 shared 句柄交出去」的场景都需要它。

### 5.2 Pimpl：unique_ptr 的经典工程应用

```cpp
// widget.h —— 编译防火墙
#include <memory>
class Widget {
public:
    Widget();
    ~Widget();                    // Pimpl 需要手写析构（complete type 问题）
    Widget(Widget &&) noexcept;
    Widget &operator=(Widget &&) noexcept;
    void draw();
private:
    struct Impl;                  // 前置声明
    std::unique_ptr<Impl> impl_;  // 实现细节全部藏在 .cpp
};
// widget.cpp 里定义 Impl —— 修改实现不触发使用方重编
```

Pimpl 用 unique_ptr 把「实现细节」推出头文件：编译时间、ABI 稳定性、二进制兼容三收益（[C 篇不透明结构体](../c/06-scope-lifetime.md)的 C++ 版）。注意必须手写析构/移动（unique_ptr 析构需要完整类型的 Impl），这是 Rule of Five 的活案例。

## 6. 陷阱清单

- `shared_ptr` 当默认智能指针：原子计数税；先问「真的需要共享生存期吗」，unique 是默认。
- 循环引用泄漏：回指方向换 weak_ptr；新代码用 ASan/泄漏检测在 CI 抓。
- `shared_ptr<T>(raw)` 对已由别的 shared 管理的裸指针再包装：两个控制块双重释放；源头永远只有一个入口。
- 接口参数收 `shared_ptr` 却不存储：白付计数税；借用用 `const T&`/`T*`。
- 栈对象调 `shared_from_this()`：没有控制块，UB；对象必须由 make_shared 诞生。
- `get()` 的指针长期持有：所有权没转移，智能指针先析构就悬垂。
- unique_ptr 包数组用单对象形式：delete 语义不匹配；用 `T[]` 特化。
- `make_shared` 的大对象延迟释放：weak 持有时控制块与对象同一分配，对象内存直到弱计数归零才释放——内存敏感的大对象用 unique 或分开的 shared。
- 移动 unique_ptr 后继续用：moved-from 为空，解引用崩溃；用前判空或重新赋值。

## 7. 小结

- 智能指针把「谁负责释放」编码进类型：unique_ptr 独占（零开销、移动转移）、shared_ptr 共享（控制块 + 原子计数）、weak_ptr 观察（不持有，lock 升级）。
- unique_ptr 是默认答案：sizeof 等于裸指针、可自定义删除器包装一切 C 资源、Pimpl 与工厂返回的标准载体。
- shared_ptr 的成本账：16 字节对象 + 原子计数税 + 控制块内存；make_shared 一次分配；线程安全只覆盖控制块不覆盖对象。
- 循环引用是引用计数的结构性死穴：所有权方向单向（shared），反向与观察用 weak_ptr。
- 所有权决策树：作用域能解决就不上指针；unique 默认；shared 需要证明；借用用裸指针/引用——接口签名因此获得可读的所有权语义。
- make 系列优先于裸 new：异常安全 + 类型不重复 + make_shared 的一次分配。

## 8. 练习

**1.** 把[第 4 篇](04-raii.md)的 UniqueFd 改用 unique_ptr + 自定义删除器实现，对比代码行数与表现力差异。

> [!TIP]
> 思路`using FdPtr = std::unique_ptr<int, decltype([](int *fd){ if (fd) close(*fd); delete fd; })>;` 或更地道的用删除器包 int 值对象。对比：手写版五件套约 30 行；unique_ptr 版删除器之外全免。结论：机制型 RAII（行为复杂：延迟释放、复用）手写，包装型 RAII 一律 unique_ptr。

**2.** 用 weak_ptr 实现一个「对象缓存」：`std::map<Key, std::weak_ptr<Obj>>`，get 时 lock 成功复用、失败重建并写入。分析缓存命中/失效两条路径的所有权流。

> [!TIP]
> 思路缓存放 weak（不延长对象生命），使用者持 shared（负责生存期）。命中：lock 得 shared；失效：新建 shared 存入 weak。这是 weak_ptr 的教科书场景：缓存不拥有，对象死了缓存自动「知道」（lock 返回空）。注意并发下 get 的竞争（锁或并发 map，[第 13 篇](13-concurrency.md)）。

**3.** 构造三层循环引用（A→B→C→A 全 shared），用 ASan 泄漏检测验证；把中间一条边换成 weak_ptr 修复，说明「所有权必须成 DAG（有向无环）」的原则。

> [!TIP]
> 思路三个对象互相持有时计数各为 2，作用域退出各剩 1，全部泄漏（LSan 报告三个泄露点）。修法：保留一个方向（树形/链形），其余换 weak。原则：shared 边构成有向无环图；任何「环」都意味着某条边实际是观察不是拥有。

**4.** 解释 `void set(std::shared_ptr<Callback> cb)` 与 `void set(Callback *cb)` 在「回调生命周期」上的语义差异，以及第三种 `void set(std::weak_ptr<Callback> cb)` 何时正确。

> [!TIP]
> 思路shared 参数：注册方参与所有权——回调绝不悬垂，但调用方也失去了「回调随我死」的控制（适合：回调独立生存）。裸指针：注册方不拥有——调用方必须保证回调活得比触发久（C 风格监听器），悬垂风险在调用方。weak：注册方观察——触发时 lock，死了就跳过；适合「回调可能先死」的事件系统。三种签名是三种生命周期契约。

**5.** 用 Pimpl 重构一个头文件臃肿的类（把 `<vector> <string> <map>` 等包含全部推到 .cpp），测量改动前后 include 该头文件的编译时间变化。

> [!TIP]
> 思路Impl 结构持有全部复杂成员；头文件只剩 unique_ptr + 前置声明。编译时间改善与「包含此头的 TU 数」成正比——依赖隔离的价值随项目规模放大。别忘了 Rule of Five（析构/移动在 .cpp 定义）。

**6.** 讨论：为什么标准库提供 `make_shared` 却没有 `make_unique` 直到 C++14？这个「缺失的四年」造成了什么生态习惯，正确姿势是什么？

> [!TIP]
> 思路C++11 漏掉了 make_unique（委员会疏漏），社区用裸 new + unique_ptr 构造，异常安全窗口期成为经典 bug 来源（Herb Sutter 的著名文章）。C++14 补上。教训沉淀：**任何堆分配的第一选择都是 make_*，裸 new 在应用代码里应视为错误**（库内部实现除外）。
