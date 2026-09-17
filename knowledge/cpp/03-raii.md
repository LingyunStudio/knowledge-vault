---
title: RAII 与资源管理
order: 3
tags: 核心, RAII, 析构
summary: 构造即获取、析构即释放：让栈上对象的生命周期替你管理堆资源。
---

C 程序员的日常是在每个出口前检查该释放的东西，漏一条路径就漏一次泄漏。C++ 的答案是把「释放」写进析构函数，让语言保证它在正确的时机、所有路径上自动执行——这就是 RAII（Resource Acquisition Is Initialization，资源获取即初始化）。名字唬人，思想极简：**构造时获取，析构时释放**。

## 先看 C 的困境

```c
int process(FILE *log, FILE *cfg) {
    if (parse(cfg) != 0) { fclose(cfg); fclose(log); return -1; }   // 每个出口都要收尾
    if (validate(log) != 0) { fclose(cfg); fclose(log); return -1; }
    /* ... 更多出口，更多重复的 fclose */
    return 0;
}
```

出口一多，`fclose` 就开始复制粘贴；中途加一个 `return` 忘了写收尾，句柄泄漏。C 里靠 `goto cleanup` 集中清理，能用，但全靠纪律维持。读过 Rust 板块的话你会眼熟：Drop trait 是同一思想的强制版——区别在于 C++ 靠约定写出 RAII，Rust 的所有权系统直接内置了它。

## RAII：把资源和栈变量绑死

```cpp
#include <cstdio>
#include <stdexcept>

class FileGuard {
public:
    explicit FileGuard(const char* path) : f_(std::fopen(path, "r")) {
        if (!f_) throw std::runtime_error("open failed");   // 拿不到资源 = 构造失败
    }
    ~FileGuard() { if (f_) std::fclose(f_); }               // 无论怎么离开作用域都会执行

    FileGuard(const FileGuard&) = delete;             // 禁止拷贝：两个对象管一个句柄必出事
    FileGuard& operator=(const FileGuard&) = delete;

    FILE* get() const { return f_; }

private:
    FILE* f_;
};
```

用起来没有任何收尾代码：

```cpp
void process(const char* path) {
    FileGuard f(path);            // 打开
    if (early_exit()) return;     // ✅ 提前返回，析构自动执行，不漏
    use(f.get());
}                                 // ✅ 正常离开同样自动关闭
```

资源的获取时机与对象生命周期重合了。`FILE*` 换成锁、socket、数据库连接，模式完全一样。

> [!NOTE]
> `= delete` 显式禁止拷贝是 RAII 类的常见动作：资源句柄唯一，拷贝对象却共享句柄 = 双重释放。C++11 起 `= delete` 是标准写法，比老式的「声明为 private 且不实现」清晰得多。为什么移动可以而拷贝不行，见[拷贝控制与移动语义](04-copy-move.md)。

## 析构的确定性

和 GC 语言对比：Java 的 finalize 时机由 GC 说了算，Go 的 defer 要手动写一行。C++ 析构是**确定性的**——离开作用域那一行就执行，而且顺序是构造的逆序：

```cpp
std::ofstream out("log.txt");       // 后声明
std::lock_guard<std::mutex> lk(m);  // 先声明
// 离开作用域：先解锁，后关文件——声明顺序决定析构顺序
```

逆序保证了依赖正确：还在写文件的时候，锁是持有的；文件关掉之后，锁才释放。多个资源之间的先后关系用声明顺序就能表达。

## 异常来了也不怕：栈展开

RAII 的另一半价值在异常场景。异常从 throw 点向外传播时，沿途局部对象依次析构，这叫**栈展开**（stack unwinding）：

```cpp
void f() {
    FileGuard f("a.txt");
    std::vector<int> v(1000);
    throw std::runtime_error("boom");   // 异常从这里向上飞
}   // f 与 v 的析构仍然执行，句柄与内存都不漏
```

没有 RAII 的语言处理异常，要么 try/finally 手动收尾，要么泄漏。C++ 里**只要资源挂在 RAII 对象上，异常安全就是白送的**：正常路径和错误路径共用同一份清理代码。这也是本库把 RAII 放在[异常与错误处理](10-errors-exceptions.md)之前讲的原因。

> [!WARNING]
> 析构函数不要让异常逃出去。栈展开过程中再抛出第二个异常，程序直接 `std::terminate`。析构里的清理操作（close、flush）可能失败时，吞掉异常或记日志，别往外扔。

## 标准库自带的 RAII

日常根本不用自己写类，标准库全是现成的 RAII：

| 类型 | 管理的资源 | 头文件 |
| --- | --- | --- |
| `std::string` / `std::vector` | 动态内存 | `<string>` `<vector>` |
| `std::unique_ptr` / `shared_ptr` | 任意堆对象 | `<memory>` |
| `std::lock_guard` / `unique_lock` | 互斥锁 | `<mutex>` |
| `std::fstream` / `ofstream` | 文件 | `<fstream>` |

```cpp
#include <mutex>

void with_lock(std::mutex& m) {
    std::lock_guard<std::mutex> lk(m);   // 构造即上锁
    // ... 临界区，随便 return / throw
}                                        // 析构解锁，物理上不可能忘记
```

C 里 `pthread_mutex_lock` 与 `unlock` 之间任何提前 return 都是死锁隐患；lock_guard 把成对操作折叠进一个作用域。内存方面标准库最核心的 RAII 工具是智能指针，专篇见[智能指针](08-smart-pointers.md)。

> [!TIP]
> 判断一段 C++ 代码健壮与否，先找「谁在析构函数里释放资源」。裸 `new/delete`、裸 `fopen/fclose` 散落在函数体里，几乎总意味着某条错误路径会漏。看到成对的手动调用，第一反应就该是「能不能包一层类」。

## 练习

- [ ] 给 FileGuard 补一个移动构造函数实现「句柄转移」，并解释为什么移动安全、拷贝不安全
- [ ] 写一个作用域计时器 `Timer`：构造记起点，析构打印耗时，用它测量一段排序代码
- [ ] 在 throw 前后各放一个带输出语句的对象，观察栈展开时的析构顺序

相关阅读：[拷贝控制与移动语义](04-copy-move.md)
