---
title: RAII：资源管理的基石
order: 4
tags: RAII, 栈展开, lock_guard, unique_ptr, 异常安全
summary: RAII 的机制保证（构造获取、析构必达、逆序展开）、异常与栈展开的交互规则、标准库 RAII 设施全景、自定义 RAII 类的完整设计（含 noexcept 移动与构造抛异常语义），以及资源泄漏在 C++ 里的系统性根除方案。
---

[第 1 篇](01-cpp-model.md)说过，RAII 是理解 C++ 的透镜。本篇把它讲到底：机制上为什么「必定执行」，实战中怎么写自己的 RAII 类，以及它如何**系统性**地根除资源泄漏——不是靠程序员细心，而是靠语言保证。

先定义资源。C++ 语境的资源比「内存」宽得多：**一切「获取之后必须归还」的东西**——堆内存、文件句柄、socket、互斥锁、数据库事务、GPU 描述符、时间片。它们的共同点是：获取成功而归还失败，系统就缓慢损坏。RAII 的全部工作，就是让「归还」不可能被忘记。

## 1. 机制：为什么析构「必定执行」

RAII 的承诺建立在 C++ 的一条语言保证上：

> 对象离开作用域时（无论正常返回、break、continue 还是异常），其析构函数**必定**执行，且多个对象的析构**严格逆序**。

```cpp
#include <fstream>
#include <mutex>

std::mutex m;

void process(const std::string &path) {
    std::ifstream file(path);                  // 资源 1：文件
    if (!file) throw std::runtime_error("open failed");

    std::lock_guard lock(m);                   // 资源 2：锁
    std::string data(1 << 20, '\0');           // 资源 3：内存

    parse_and_save(file, data);
    // 任何路径离开这里 —— 正常 return、上面 throw、parse_and_save 内 throw ——
    // 析构逆序执行：data → lock（解锁）→ file（关文件）
}
```

「逆序」不是细节，是正确性：锁必须比文件先释放（文件操作在临界区内）；后构造的依赖先构造的。这与[第 3 篇](03-classes.md)构造顺序保证互为镜像。

与两种「前辈方案」的对比：

| 方案                 | 泄漏可能                          | 成本         |
| -------------------- | --------------------------------- | ------------ |
| 手动配对（C）         | 每个 return/throw 分支都可能漏      | 人工维护     |
| GC + finally（Java/Python） | finally 忘写、GC 不确定时机（文件/锁不该等 GC） | 运行时开销 + 时机不确定 |
| RAII（C++）          | 机制上不可能忘记（析构自动执行）     | 零运行时开销 |

GC 语言解决的是**内存**；文件句柄、锁这类**确定性资源**在 GC 世界里反而要靠 try-with-resources / with 语句——本质就是语法化的 RAII。C++ 的区别是把这个保证做进类型系统，没有运行时参与。

## 2. 异常与栈展开

异常是 RAII 承诺最严苛的考场：throw 发生时，从 throw 点到 catch 点之间**所有已构造完成的局部对象都要析构**——这个过程叫**栈展开**（stack unwinding）：

```cpp
void outer() {
    Widget w1;
    try {
        Widget w2;
        risky();                     // throw 发生在这里
        // w2 在展开时析构
    } catch (const std::exception &e) {
        log(e);                      // w1 仍然活着，w2 已析构
    }
}
```

栈展开带来两条设计铁律：

**铁律一：析构函数不抛异常。** 如果展开过程中某个析构又抛了，两个异常同时活跃 → `std::terminate` 直接杀进程。所以：

```cpp
~File() {
    if (f_) fclose(f_);              // fclose 可能返回错误——但我们「吞掉」它：
                                     // 释放阶段没有可恢复的出路，只能记录/忽略
}
```

析构里的失败只能记录（日志），不能上抛。这也解释了为什么「写文件失败」不该发生在析构里——**需要报告结果的关闭操作不该由析构承担**，提供显式 `close()` 让调用方在对象活着时处理错误，析构只兜底。

**铁律二：构造函数抛异常是安全的。** 对象「未构造完成」就没有析构责任——已构造完成的成员会按逆序析构，对象本体「从未存在」：

```cpp
class Session {
    Connection conn_;                // 假设已构造完成
public:
    Session() : conn_(...) {
        if (!auth()) throw std::runtime_error("auth failed");
        // 抛出时：conn_ 已析构；Session 本体从未诞生 → ~Session 不会被调用
    }
};
```

这条规则让「构造函数里做一切初始化（包括可能失败的部分）」成为干净的设计：**要么完整构造成功，要么什么都没发生**——没有「半成品对象」状态。

### 2.1 noexcept：给优化器和调用方的承诺

```cpp
void swap(X &a, X &b) noexcept;      // 承诺：不抛

std::vector<X> v;
v.push_back(x);       // vector 扩容搬移元素时：若移动构造是 noexcept 用移动，
                      // 否则为了强异常保证只能用拷贝！
```

`noexcept` 不是文档装饰——它参与**库的行为选择**：vector 扩容在移动构造 noexcept 时用移动（快），否则退化为拷贝（慢但安全）。规约：**移动构造、移动赋值、swap 一律 noexcept**；普通成员函数不乱标（承诺不抛就要真不抛，违反即 terminate）。

## 3. 自定义 RAII 类：从 unique_fd 到 ScopeGuard

### 3.1 完整范例：文件描述符包装

```cpp
#include <unistd.h>
#include <utility>

class UniqueFd {
    int fd_ = -1;                              // -1 表示「无资源」：合法的空状态
public:
    UniqueFd() = default;                      // 空对象：RAII 类必须有「空」状态
    explicit UniqueFd(int fd) : fd_(fd) { if (fd < 0) throw std::runtime_error("bad fd"); }

    ~UniqueFd() { reset(); }

    UniqueFd(const UniqueFd &) = delete;            // 句柄唯一所有：禁拷贝
    UniqueFd &operator=(const UniqueFd &) = delete;

    UniqueFd(UniqueFd &&other) noexcept            // 移动：所有权转移
        : fd_(std::exchange(other.fd_, -1)) {}
    UniqueFd &operator=(UniqueFd &&other) noexcept {
        if (this != &other) { reset(); fd_ = std::exchange(other.fd_, -1); }
        return *this;
    }

    void reset(int new_fd = -1) {                  // 显式释放 + 可复用
        if (fd_ >= 0) ::close(fd_);
        fd_ = new_fd;
    }
    int get() const { return fd_; }                // 裸句柄：借用，不交出所有权
    explicit operator bool() const { return fd_ >= 0; }
};
```

五条设计要点，全部是通用的：

1. **必须有「空」状态**：移动之后、默认构造之后，对象存在但无资源——析构要能处理它。
2. **拷贝语义由资源的共享性质决定**：fd 是独占资源 → 拷贝 delete；引用计数资源（连接池）→ 拷贝 = 增计数。
3. **移动 noexcept + 转移后置空**：`std::exchange(old, empty)` 一行完成「取走并置空」。
4. **`get()` 是借用出口**：与 C API 交互时交出裸句柄，但文档写明「只借不还（不负责释放）」。
5. **释放失败只能记录**：析构不抛（铁律一）。

### 3.2 ScopeGuard：把「任意动作」变成 RAII

不是所有资源都有包装类。ScopeGuard 把**任意清理动作**绑到作用域：

```cpp
#include <functional>

class ScopeGuard {
    std::function<void()> f_;
    bool active_ = true;
public:
    explicit ScopeGuard(std::function<void()> f) : f_(std::move(f)) {}
    ~ScopeGuard() { if (active_) f_(); }
    void dismiss() { active_ = false; }          // 成功路径上取消清理

    ScopeGuard(const ScopeGuard &) = delete;
    ScopeGuard &operator=(const ScopeGuard &) = delete;
};

// 用法：临时修改全局状态，离开作用域自动还原
void hot_path() {
    static thread_local int verbosity = 0;
    struct Restore {
        int old_;
        ~Restore() { verbosity = old_; }
    } guard{verbosity};                          // 更朴素的等价写法：局部类

    verbosity = 3;
    run_with_debug();
}                                                // 还原 verbosity
```

标准库的对应物是 `std::unique_lock`（锁）、事务类（数据库）等；scope guard 模式在需要「一次性、自定义」清理时补位。C++23 无标准的 `std::scope_exit`（Boost.ScopeExit、GSL 的 final_action 可用），自己写十几行也完全可行。

## 4. 标准库 RAII 设施全景

| 设施                          | 管理的资源        | 备注                              |
| ----------------------------- | ----------------- | --------------------------------- |
| `std::unique_ptr<T>`          | 堆对象（独占）    | [第 6 篇](06-smart-pointers.md)；可自定义删除器 |
| `std::shared_ptr<T>` / `weak_ptr` | 堆对象（共享） | 同上                              |
| `std::vector` / `std::string` | 内部缓冲区        | 值类型自带 RAII                   |
| `std::fstream` / `ifstream`   | 文件              | 析构 close                        |
| `std::lock_guard` / `unique_lock` / `scoped_lock` | 互斥锁 | [第 13 篇](13-concurrency.md) |
| `std::jthread`（C++20）       | 线程              | 析构自动 join（thread 需手动）    |
| `std::future`                 | 异步结果          | [第 13 篇](13-concurrency.md)     |
| 自定义                        | fd、事务、GPU 句柄 | 本篇 3.1 的模板                   |

规约：**碰到任何「手动 acquire/release」的 API，第一反应是找/写 RAII 包装**。项目里允许裸 `new/delete`、裸 `fopen/fclose` 的唯一位置是 RAII 包装类的内部——之外的出现一律是审查意见。

## 5. RAII 与异常安全等级

RAII 落地后，函数的异常安全可以分级承诺：

| 等级     | 承诺                                       | RAII 的角色                 |
| -------- | ------------------------------------------ | --------------------------- |
| 基本保证 | 异常后对象仍处于有效状态，无泄漏             | 自动达成（析构清理一切）     |
| 强保证   | 异常后状态完全回滚（事务式）                 | 需要「先做副本再提交」模式    |
| 不抛保证 | 函数 noexcept 且确实不抛                     | 析构、移动、swap 的目标等级  |

```cpp
// 强保证的经典模式：copy-and-swap（第 5 篇展开）
Text &operator=(const Text &other) {
    Text tmp(other);            // 先在副本上做全部可能失败的工作
    swap(tmp);                  // 提交：只做 noexcept 的交换
    return *this;
}
```

基本保证在「全员 RAII」的代码里是免费的；强保证需要显式设计（副本-提交模式）。规约：库代码默认承诺基本保证，关键状态修改提供强保证，并**在文档里写明承诺等级**——「异常安全」不写明等级等于没承诺。

## 6. 反模式：RAII 世界的违规者

1. **裸 new / 裸 delete**：`auto *p = new T; ... delete p;`——异常路径必然泄漏（throw 在 new 与 delete 之间）。用 `make_unique`（[第 6 篇](06-smart-pointers.md)）。
2. **`ptr.get()` 存进裸指针长期持有**：借出引用却当所有权用；unique_ptr 析构后裸指针悬垂。
3. **析构里做「需要报告结果的清理」**：关闭要回执的事务、要 flush 的日志——提供显式 close，析构只兜底。
4. **RAII 类禁拷贝却没禁**：编译器生成浅拷贝 → double free（[第 3 篇](03-classes.md)的 Connection 案例）。
5. **手动 lock/unlock 配对**：`m.lock(); ... m.unlock();`——中间 throw 就死锁；用 lock_guard。
6. **「先 new 后放进容器」的两步式初始化**：容器构造直接收值或 in-place emplace，中间不留裸指针。

## 7. 陷阱清单

- 析构抛异常：栈展开中二次异常 → terminate；析构只记录不抛。
- 构造「成功一半」的对象再手工清理：构造抛异常时成员自动析构，本体无析构责任——不要自己模仿。
- 移动构造不 noexcept：vector 扩容退化为拷贝；移动三件套全部 noexcept。
- RAII 类有「空状态」却没处理：移动后 reset/析构崩溃。
- 借出的 get() 被当所有权：文档标注借用语义；持久持有用容器或第二智能指针。
- 手动配对 lock/unlock、fopen/fclose、new/delete：全部找 RAII 替代。
- 强保证想当然：copy-and-swap 或显式回滚；「基本保证」要靠全员 RAII 维持。
- 临时对象绑定 string_view/span：视图类无寿命延长（[第 2 篇](02-references-auto.md)）。

## 8. 小结

- RAII 的机制保证：作用域退出（含异常路径）析构必达且严格逆序——资源归还从纪律升级为语言保证。
- 栈展开的两条铁律：析构不抛（二次异常即 terminate）；构造抛异常安全（成员自动析构、本体未诞生）——「构造即有效，否则不存在」。
- 自定义 RAII 类的五要点：空状态、拷贝语义随资源性质、移动 noexcept + 置空、get() 借用语义、析构只记录不抛。
- 标准 RAII 设施覆盖内存/文件/锁/线程；裸 acquire/release 只允许存在于包装类内部。
- 异常安全分级：全员 RAII 免费获得基本保证；强保证用 copy-and-swap；noexcept 给库的行为选择（vector 扩容）提供依据。

## 9. 练习

**1.** 写一个 `TempDir` RAII 类：构造时创建临时目录，析构时递归删除。处理「删除失败」（只记录）、拷贝（delete）、移动（noexcept）三件事。

> [!TIP]
> 思路成员 `std::filesystem::path path_`；析构调 `std::filesystem::remove_all` 包 try-catch 记录；拷贝 delete；移动 exchange 路径并置空。注意递归删除可能失败（文件被占用）——这正演示「清理不可靠时析构只兜底」：需要可靠删除的路径提供显式 `cleanup()` 返回错误码。

**2.** 用栈展开验证第 2 节：写两个带日志析构的类 A、B，B 的构造函数抛异常，观察 A 的析构执行而 B 的「构造函数体未完成」。

> [!TIP]
> 思路成员顺序 A 在前、B 在后：B 抛出时 A 已构造完成 → A 析构执行；B 自身从未构造完成 → ~B 不会调用（B 的成员若已构造也会析构）。输出顺序是理解「构造完成才有析构责任」的最好材料。

**3.** 解释 `std::lock_guard` 与 `std::unique_lock` 的取舍：前者零开销但不可解锁，后者灵活但有状态。写一个「条件变量等待」必须用 unique_lock 的例子。

> [!TIP]
> 思路condition_variable::wait 需要在等待时**解锁、唤醒后重加锁**——lock_guard 全程持锁做不到；unique_lock 提供所有权转移与手动 unlock。选择：简单临界区 lock_guard（零状态、最快）；需要 wait/超时/提前解锁用 unique_lock。

**4.** 给第 3 篇练习 2 的 Connection 写「强保证」版本的 send：失败时连接状态回滚到 send 前。

> [!TIP]
> 思路强保证 = 事务式：先把要改的状态（发送缓冲、重试计数）在局部副本上修改，最后一步 noexcept 提交；或记录「undo 动作」用 ScopeGuard 在异常时回滚。讨论：网络发送本身不可回滚——真正的强保证边界是「本地状态」，这暴露了强保证的适用边界（有真实外部副作用时只能基本保证 + 幂等设计）。

**5.** 审查下面的代码，列出所有异常路径上的资源问题，并用 RAII 改写。

```cpp
void render(const std::string &path) {
    FILE *f = fopen(path.c_str(), "rb");
    if (!f) throw std::runtime_error("open");
    auto *img = new Image();
    load(*img, f);                       // 可能 throw
    m.lock();
    draw(*img);                          // 可能 throw
    m.unlock();
    delete img;
    fclose(f);
}
```

> [!TIP]
> 思路五处：load 抛 → img 泄漏 + f 泄漏；draw 抛 → img/f 泄漏 + 锁死锁。改写：UniqueFd 包 f、unique_ptr<Image> 包 img、lock_guard 包锁——函数体只剩业务逻辑，所有清理自动执行。改写前后行数对比直观展示 RAII 的表达力。

**6.** 讨论题：为什么 `std::thread` 在 C++20 之前析构不 join（terminate），`std::jthread` 改为自动 join？从 RAII 语义角度分析「资源释放该做什么」的设计分歧。

> [!TIP]
> 思路thread 的「释放」有歧义：join（等完成）还是 detach（放手）？自动 join 可能死等、自动 detach 可能访问失效数据——C++11 选择「必须显式表态，否则 terminate」（避免静默选错）；jthread 默认 join + cooperative cancellation 是对常见意图的倾斜。教训：RAII 的「释放动作」必须无歧义才能自动执行——定义不清的资源先定义语义再谈 RAII。
