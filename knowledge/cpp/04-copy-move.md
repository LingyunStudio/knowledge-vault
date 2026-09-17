---
title: 拷贝控制与移动语义
order: 4
tags: 核心, 移动语义, 法则
summary: 拷贝构造/赋值、移动语义与右值引用、三/五/零法则一次讲清。
---

C++ 对象默认按值拷贝，这是与 Rust 最刺眼的差异：Rust 赋值默认 move，C++ 默认 copy。拷贝一个自己管资源的类（如上一章的 Buffer），浅拷贝会让两个对象共享同一块堆内存，析构两次。拷贝控制就是围绕这个问题的整套规则，也是 C++ 面试的必考区——因为它定义了这个语言的对象模型。

## 拷贝构造与拷贝赋值

拷贝构造：用已有对象初始化新对象。拷贝赋值：把已有对象赋给已存在对象。不写的话编译器自动生成——逐成员拷贝，也就是**浅拷贝**：

```cpp
class Buffer {
public:
    Buffer(size_t n) : size_(n), data_(new char[n]) {}
    ~Buffer() { delete[] data_; }

private:
    size_t size_;
    char* data_;
};

void f() {
    Buffer a(16);
    Buffer b = a;        // 编译器生成的拷贝构造：只拷贝指针本身
}                        // ❌ a、b 各析构一次，delete[] 同一块内存 → 未定义行为
```

修法是手写**深拷贝**：

```cpp
Buffer(const Buffer& other) : size_(other.size_), data_(new char[other.size_]) {
    std::copy(other.data_, other.data_ + size_, data_);
}

Buffer& operator=(const Buffer& other) {    // 赋值还要处理自我赋值 a = a
    if (this != &other) {
        char* nd = new char[other.size_];   // 先分配再释放：new 抛异常时对象仍完好
        std::copy(other.data_, other.data_ + other.size_, nd);
        delete[] data_;
        data_ = nd;
        size_ = other.size_;
    }
    return *this;
}
```

注意拷贝构造的参数是 `const Buffer&`，不能是 `Buffer`——传值本身就要拷贝，会无限递归。

## 三法则 → 五法则 → 零法则

C++11 加入移动语义后，「特殊成员函数」一共五个：

| 函数 | 签名 | 何时调用 |
| --- | --- | --- |
| 析构 | `~T()` | 对象死亡 |
| 拷贝构造 | `T(const T&)` | 用旧对象初始化新对象 |
| 拷贝赋值 | `T& operator=(const T&)` | 给已存在对象赋值 |
| 移动构造 | `T(T&&)` | 用右值初始化新对象 |
| 移动赋值 | `T& operator=(T&&)` | 右值赋给已存在对象 |

- **三法则**（C++98）：写了析构、拷贝构造、拷贝赋值之一，三个都得写
- **五法则**（C++11）：再补上移动构造/移动赋值。规则还有联动：声明了移动操作，拷贝操作会被隐式 `delete`；声明了析构函数，移动操作不会再自动生成
- **零法则**（现代首选）：一个都不写，资源全部交给 `std::string`、`std::vector`、智能指针这类现成 RAII 成员——它们自己把五个函数都写对了

> [!WARNING]
> 一旦手写了析构函数（意味着类在管资源），编译器生成的浅拷贝就是大坑。反过来，编译器不会因为你写了析构就停止生成拷贝——它照生成、照浅拷贝、照崩溃，只是会发一条弃用警告。判断责任在你：写析构，就必须同时想清楚拷贝。

> [!TIP]
> 零法则是正解：与其手写五个特殊函数（每一个都可能写错），不如让成员自己管资源。上一章的 FileGuard，生产级写法其实是 `std::unique_ptr<FILE, decltype(&fclose)>`，五个特殊函数瞬间归零。

## 移动语义：把资源「偷」过来

拷贝是复制内容，移动是**接管内部资源**。临时对象（右值）反正马上要死，把资源送给新对象正合适：

```cpp
Buffer(Buffer&& other) noexcept             // 右值引用 && 绑定「即将消亡」的对象
    : size_(other.size_), data_(other.data_) {
    other.data_ = nullptr;                  // 关键：把源置空。delete[] nullptr 是安全的
    other.size_ = 0;
}

Buffer make() { return Buffer(1024); }

Buffer a = make();          // C++17 保证：返回对象直接构造在 a 的位置，连移动都不发生
Buffer b = a;               // 拷贝构造：a 之后还要用，不能偷
Buffer c = std::move(a);    // 移动构造：std::move 把 a 当右值，资源被 c 接管
```

`std::move` 的真面目：它**不移动任何东西**，只是一个转换成右值引用的 cast，表达「我授权你偷我」的意图。真正搬运资源的是移动构造函数。这也解释了 std::string、vector「拷贝贵、移动贱」的普遍规律——移动只是几个指针换手。

## 被移动后的对象：有效但未指定

Rust 直接让被 move 的变量失效，编译器盯着。C++ 被移动的对象**仍然活着**，处于「有效但未指定」状态：

```cpp
std::string s1 = "hello";
std::string s2 = std::move(s1);
// s1 仍是合法的 string，内容未指定（通常是空，但标准不承诺）
s1 = "world";              // ✅ 重新赋值后照常使用
// s1[0]                   // ⚠️ 不读移动后的值：内容是什么全看实现
```

纪律只有一条：移动后**不读它的值**，只重新赋值或销毁。这比 Rust 宽松得多，也危险得多——Rust 在编译期拦下的事，C++ 全靠自觉。

> [!NOTE]
> 移动构造/移动赋值标 noexcept 不是洁癖：vector 扩容搬移元素时，只在移动操作是 noexcept 的前提下才用移动（`std::move_if_noexcept`），否则退回拷贝以保证异常安全。移动构造不写 noexcept，容器性能可能悄悄变慢。

## 移动语义的日常用法

日常业务代码很少手写移动构造，但「用 std::move 把对象搬进容器」每天都在发生：

```cpp
std::vector<std::string> v;
std::string s = "a fairly long log message ...";
v.push_back(s);               // 拷贝：s 还要用，内容复制一份进容器
v.push_back(std::move(s));    // 移动：s 不要了，内部指针直接移交
```

判断标准与 Rust 一致：**之后还要用就拷贝，确定不再用就 move**。区别是 C++ 编译器不拦截你 move 之后再读 s——「有效但未指定」的后果自己承担。另一个高频场景是「按值传参再转存」：构造函数接收 `std::string` 存进成员时，在初始化列表里 `std::move(title)` 给成员，能省一次深拷贝；代价与收益都在[引用与类基础](02-references-classes.md)讲的传参礼仪之上。

## 练习

- [ ] 给 Buffer 补上移动赋值运算符，想清楚如何处理 `b = std::move(b)` 这种自移动
- [ ] 用 `static_assert(std::is_nothrow_move_constructible_v<Buffer>)` 验证你的移动构造是否 noexcept
- [ ] 解释：为什么拷贝构造参数是 `const T&` 而不能是 `T`？写个反例看编译器的递归报错

相关阅读：[智能指针](08-smart-pointers.md)
