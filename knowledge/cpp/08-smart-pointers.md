---
title: 智能指针
order: 8
tags: 核心, unique_ptr, shared_ptr
summary: unique_ptr 独占、shared_ptr 引用计数与循环引用、weak_ptr 破环。
---

C 里 malloc 与 free 的配对靠人脑，Rust 里 Box/Rc/Arc 的所有权编译器盯着。C++ 的智能指针站在中间：所有权语义由库表达，释放由 RAII 保证，编译器负责大部分检查（unique_ptr 不可拷贝是编译期错误）。现代 C++ 代码里，裸 `new/delete` 应当几乎绝迹。

## unique_ptr：独占所有权

```cpp
#include <memory>

auto up = std::make_unique<Article>("raii");   // C++14 起，优先用 make_ 系列
up->title;                    // 和裸指针一样用 -> 和 *

auto up2 = std::move(up);     // ✅ 转移所有权，up 变为空
// auto up3 = up2;            // ❌ 编译错误：unique_ptr 不可拷贝
```

独占意味着：同一时刻只有一个 unique_ptr 拥有对象，销毁时自动 delete。零运行时开销——大小就是裸指针、解引用无额外成本，所有权检查发生在编译期（禁止拷贝）。它就是 C++ 版的 Rust `Box<T>`：**move 是唯一的所有权转移方式**。

转移后源指针为空（不是「有效但未指定」，就是 nullptr），判空即可：

```cpp
if (up) { /* up 已是 nullptr，不会进来 */ }
up.reset(new Article("x"));   // reset：换对象（旧的先析构）
Article* raw = up.get();      // get：借出裸指针，不转移所有权
up = nullptr;                 // 也可以直接置空，旧的立即析构
```

unique_ptr 还能自定义删除器，把 RAII 套在任意 C 资源上：

```cpp
struct FileCloser {
    void operator()(FILE* f) const { if (f) std::fclose(f); }
};

std::unique_ptr<FILE, FileCloser> f(std::fopen("a.txt", "r"));   // C 句柄也有了自动释放
```

无状态的删除器（如函数指针经 decltype 折叠、空结构体）不增加 unique_ptr 的体积。

> [!TIP]
> 函数签名怎么选：参数只是「用一下」→ 传 `T&` 或 `T*`，别传智能指针；函数要「接管」对象 → 按 `unique_ptr<T>` 值收，调用方必须显式 `std::move`。所有权写进签名，正是 Rust 风格的参数纪律。

## shared_ptr：引用计数

多个所有者并存时用 shared_ptr——它额外维护一个引用计数（控制块），拷贝加一、析构减一，归零释放：

```cpp
auto sp1 = std::make_shared<Article>("stl");   // 对象与控制块一次分配
auto sp2 = sp1;                                // 计数 2
sp2.reset();                                   // 计数 1
// sp1 析构时计数归零，对象释放
```

代价真实存在：

- 计数增减是**原子操作**，多线程下有同步开销，高频拷贝 shared_ptr 相当可观
- 控制块额外占内存；make_shared 把对象和控制块合成一次分配，既省一次 malloc 又对缓存友好
- **线程安全只到计数为止**：多线程各持自己的 shared_ptr 拷贝是安全的（计数原子），多线程同时读写**同一个** shared_ptr 对象、或读写所指对象本身，都要另加锁

优先用 make_shared/make_unique 还有异常安全的老账：C++17 之前，`f(std::shared_ptr<T>(new T), g())` 里 g() 若在 new 之后、shared_ptr 构造之前抛异常，对象就泄漏了；make_ 系列把分配与包装绑死在一个函数里，无此窗口。

## 循环引用：引用计数的天生缺陷

计数到零才释放，于是互相引用的结构永远到不了零：

```cpp
struct Person {
    std::string name;
    std::shared_ptr<Person> partner;    // ❌ 用 shared 表达双向关系就是环
    ~Person() { std::cout << name << " released\n"; }
};

int main() {
    auto a = std::make_shared<Person>("A");
    auto b = std::make_shared<Person>("B");
    a->partner = b;                     // b 计数 2
    b->partner = a;                     // a 计数 2
}   // a、b 局部变量析构后计数各剩 1（被对方持有）→ 谁也不释放 → 内存泄漏
```

解法是把「不拥有」的那条边改成 weak_ptr——指向对象但不增加计数：

```cpp
struct Person {
    std::string name;
    std::shared_ptr<Person> partner;    // 一条边拥有
    std::weak_ptr<Person>   back;       // 反向边只观察
};

// 使用时 lock() 临时升级成 shared_ptr；拿不到说明对象已释放
if (auto p = a->back.lock()) use(*p);
else { /* 对方已死，安全降级 */ }
```

语义对照：shared_ptr ≈ Rust 的 `Rc`/`Arc`，weak_ptr ≈ `Weak`，破环的方法两边一模一样——**所有权有向，环上必有一条边是弱引用**。

> [!WARNING]
> shared_ptr 解决的是「谁来释放」，不是「对象是否还有效」。多线程里先 lock weak_ptr 再访问、访问共享对象本身加锁，这两件事智能指针都不替你做——它只管计数和释放。

## 选型速查

| 场景 | 选择 |
| --- | --- |
| 独占一个堆对象（绝大多数情况） | `unique_ptr` |
| 多个所有者共享、生命周期难以确定 | `shared_ptr` |
| 观察对象但不参与所有权（缓存、回指、破环） | `weak_ptr` |
| 不拥有对象，只是访问 | 裸指针或引用（`T&` / `T*`） |

注意最后一行：**裸指针没有被废除，而是被降级为「非拥有」的观察工具**。参数传递的默认仍是引用和裸指针，智能指针只在需要表达所有权时出场——这也是它与 Rust 引用规则最大的不同：借用不出错靠的是约定加工具，不是编译器。

## 练习

- [ ] 把 [RAII 与资源管理](03-raii.md)的 FileGuard 改写成 `std::unique_ptr<FILE, decltype(&fclose)>`，对比两种写法的代码量
- [ ] 构造循环引用，用 `-fsanitize=address` 观察泄漏报告，再改 weak_ptr 修复
- [ ] 打印 `sizeof(std::unique_ptr<T>)` 与 `sizeof(T*)`，验证 unique_ptr 的零开销说法

相关阅读：[RAII 与资源管理](03-raii.md)
