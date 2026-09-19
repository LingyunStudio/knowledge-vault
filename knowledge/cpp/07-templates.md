---
title: 模板：编译器替你写代码
order: 7
tags: 模板, 特化, constexpr, concepts, SFINAE
summary: 函数与类模板的实例化机制（为什么模板必须在头文件）、三种模板参数与特化/偏特化、constexpr 与 if constexpr 的编译期分支、C++20 concepts 对 SFINAE 的替代，以及编译时间与代码膨胀的工程账。
---

模板常被当成「高级特性」绕着走，但它其实是 C++ 零开销抽象的**核心机制**：`std::vector<int>` 之所以和手写的 int 数组容器一样快，正因为模板在编译期生成了一份专门为 int 优化的代码。理解模板不需要掌握模板元编程的黑魔法——需要的是三件事：**实例化机制**（编译器怎么生成代码）、**特化**（怎么给特定类型不同的实现）、**约束**（怎么让错误的调用在编译期报人话错误）。

## 1. 实例化：模板不是代码，是生成代码的配方

```cpp
template <typename T>
T max_of(T a, T b) {
    return a > b ? a : b;
}

int    x = max_of(3, 5);        // 编译器生成 max_of<int>
double y = max_of(1.5, 2.5);     // 编译器生成 max_of<double>
std::string s = max_of(std::string("a"), std::string("b"));  // max_of<std::string>
```

模板**本身不是代码**——它是给编译器的配方。每次用一组新类型调用，编译器现场生成一份「填好类型的函数」（实例化）。三个直接后果：

1. **模板必须放在头文件**：编译 .c/.cpp 时才实例化，配方必须可见——这就是 C++ 模板不能像普通函数一样「头文件声明、源文件定义」的原因（除非显式实例化，少见）。
2. **每个 T 一份机器码**：代码膨胀与编译时间的来源（第 7 节算账）。
3. **错误发生在实例化时**：`max_of(3, 1.5)` 报错点在使用处，错误信息带着模板栈——C++20 concepts 是解药（第 6 节）。

推导规则上记住一条与 auto 同款：**模板按值推导丢引用与顶层 const**——`template <typename T> void f(T t)` 里 t 永远是值；要引用写 `T&`，要「完美转发」写 `T&&`（[第 5 篇](05-copy-move.md)）。

## 2. 类模板：写一个能看清机制的 vector

手写一个骨架版容器，把类模板的关键机制装进几十行：

```cpp
template <typename T>
class MiniVec {
    T *data_ = nullptr;
    size_t size_ = 0, cap_ = 0;
public:
    MiniVec() = default;
    ~MiniVec() { clear(); ::operator delete(data_); }        // 析构：释放原始内存

    MiniVec(const MiniVec &other)                            // 拷贝：逐元素拷贝构造
        : size_(other.size_), cap_(other.size_) {
        data_ = static_cast<T *>(::operator new(cap_ * sizeof(T)));
        for (size_t i = 0; i < size_; ++i) new (&data_[i]) T(other.data_[i]);  // placement new
    }

    void push_back(const T &v) {
        if (size_ == cap_) grow();
        new (&data_[size_]) T(v);                            // 在原始内存上构造元素
        ++size_;
    }

    void clear() {                                           // 逆序析构元素
        for (size_t i = size_; i > 0; --i) data_[i - 1].~T();
        size_ = 0;
    }

    T &operator[](size_t i) { return data_[i]; }
    size_t size() const { return size_; }

private:
    void grow() {
        size_t ncap = cap_ ? cap_ * 2 : 8;
        T *nd = static_cast<T *>(::operator new(ncap * sizeof(T)));
        for (size_t i = 0; i < size_; ++i) {
            new (&nd[i]) T(std::move(data_[i]));             // 移动迁移（noexcept 时才高效，第 5 篇）
            data_[i].~T();
        }
        ::operator delete(data_);
        data_ = nd; cap_ = ncap;
    }
};
```

这段代码揭示了 `std::vector` 的三层结构，也是类模板的三个教学点：

1. **内存与对象分离**：`operator new` 拿原始字节，placement new 在字节上构造 T——「分配」与「构造」是两个独立步骤（vector 的真实实现），模板对 T 一无所知却能正确处理任意类型。
2. **成员函数按需实例化**：不用 `push_back` 的类型不会生成它的代码——`MiniVec<int>` 只实例化你用过的成员。
3. **对 T 的要求是隐式的**：T 必须可拷贝构造才能 push_back（const T& 版本）——没有 concepts 的年代，这个要求只能在报错信息里考古。

## 3. 模板参数：不只是类型

```cpp
// 类型参数
template <typename T> class Box;

// 非类型参数（编译期常量）：整数、枚举、指针、引用（C++20 起支持浮点与类类型）
template <typename T, size_t N>          // std::array 的形状
struct Array { T data[N]; constexpr size_t size() const { return N; } };

Array<double, 3> vec3;                   // 尺寸是类型的一部分：Array<double,3> 与 Array<double,4> 是不同类型！

// 默认模板参数
template <typename T, typename Compare = std::less<T>>
class sorted_vec { /* ... */ };

// 模板模板参数（高级）：参数本身是模板
template <template <typename> class Container, typename T>
class Adapter { Container<T> c; };
```

非类型参数把**编译期常量**编进类型——`std::array<int, 1000>` 与 `std::array<int, 1001>` 互不相容、各自生成代码。这是「尺寸已知时用 array、动态时用 vector」的类型学根据。

## 4. 特化：给特殊类型不同的配方

### 4.1 全特化与偏特化

```cpp
// 主模板
template <typename T>
struct Hash {
    size_t operator()(const T &v) const { return std::hash<T>{}(v); }
};

// 全特化：所有参数定死
template <>
struct Hash<std::string> {
    size_t operator()(const std::string &s) const { return fnv1a(s); }
};

// 偏特化：部分参数待定（只有类模板支持！）
template <typename T>
struct Hash<std::vector<T>> {                       // 「任意 vector」一个配方
    size_t operator()(const std::vector<T> &v) const { /* 组合各元素哈希 */ }
};
```

偏特化是模板的「重载」：编译器从最特化（最具体）的配方开始匹配。**函数模板没有偏特化**（语言设计问题），需要时用重载或类模板偏特化包装——这个限制被几乎所有新手撞过。

### 4.2 if constexpr：编译期分支（C++17）

「根据类型特性走不同代码」的现代写法：

```cpp
template <typename T>
std::string to_str(const T &v) {
    if constexpr (std::is_arithmetic_v<T>) {
        return std::to_string(v);                    // 数值：to_string
    } else if constexpr (requires { v.to_string(); }) {   // C++20 表达式约束
        return v.to_string();                        // 有 to_string 成员：调用它
    } else {
        static_assert(sizeof(T) == 0, "no to_str for this type");   // 都不是：明确的编译错误
    }
}
```

`if constexpr` 的分支在**编译期**被剪掉——不满足的分支根本不实例化（普通 `if` 要求两个分支都能编译）。它是 SFINAE/enable_if 时代所有「类型判断」技巧的合法继承人，可读性高一个数量级。

## 5. constexpr：把计算挪进编译期

```cpp
constexpr int fib(int n) {                    // C++14 起：循环、局部变量都允许
    return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

constexpr long long f40 = fib(40);            // 编译期算完，二进制里是常量
int lookup[fib(10)];                          // 编译期值当数组大小

// C++20：constexpr 走向全面——string/vector 可在编译期使用
constexpr std::string_view banner = [] {
    std::string s = "hello ";
    s += "constexpr";
    return std::string_view(s);               // 编译期构造字符串
}();
```

constexpr 函数是「编译期能跑、运行时也能跑」的普通函数——传入编译期常量就在编译期求值，传入运行期值就走普通调用。这消除了「写两遍」（宏/模板元编程版 + 运行时版）的历史需求。

## 6. Concepts：给模板参数立规矩（C++20）

### 6.1 没有 concepts 的年代

```cpp
// C++17 及以前的「约束」武器是 SFINAE（替换失败不算错误）——看懂这段需要耐心：
template <typename T,
          typename = std::enable_if_t<std::is_integral_v<T>>>   // 整型才参与重载
T twice(T v) { return v * 2; }

twice(21);          // ✅
twice(1.5);         // ❌ 报错 50 行，真相埋在模板栈深处
```

SFINAE 能干活，但写法晦涩、错误信息灾难。它解决的是「不满足条件的模板从重载集合里安静退出」，代价是把约束藏在签名第 N 行。

### 6.2 concepts：约束成为一等公民

```cpp
#include <concepts>

template <typename T>
concept Numeric = std::integral<T> || std::floating_point<T>;

template <Numeric T>                       // 方式①：约束模板参数
T twice(T v) { return v * 2; }

template <typename T>
requires std::copyable<T>                  // 方式②：requires 子句
class Buffer { /* ... */ };

template <typename T>
T normalize(T v) requires Numeric<T> { /* ... */ }   // 方式③：尾置 requires

// 标准库概念速查：same_as / derived_from / convertible_to /
//   movable / copyable / default_initializable / equality_comparable / ordered

twice(21);          // ✅
twice(1.5);         // ❌ "constraint not satisfied: Numeric<double> evaluated to false"
                    // 报错一句话说清 —— concepts 的核心价值
```

concept 是「类型的布尔谓词」，可以组合（`&&`、`||`）、可以用 `requires` 表达式检查「有没有这个成员/表达式合法」：

```cpp
template <typename T>
concept Printable = requires(const T &v, std::ostream &os) {
    { os << v } -> std::convertible_to<std::ostream &>;    // 「os << v 合法且返回 ostream」
};
```

规约：**C++20 起新模板一律用 concepts 表达对参数的要求**——约束即文档、错误即人话。老代码里的 enable_if 逐步替换为 if constexpr 或 concepts。

## 7. 模板的工程账：膨胀、编译时间与错误

| 代价           | 机理                                | 缓解                                   |
| -------------- | ----------------------------------- | -------------------------------------- |
| 代码膨胀       | 每个 (模板， 实参) 组合一份机器码       | 抽出非模板内核（vector<T*> 共享底层）；避免大组合爆炸 |
| 编译时间       | 头文件里的模板每个 TU 重新实例化       | 显式实例化声明（extern template）；Pimpl；C++20 模块 |
| 错误信息       | 模板栈 + 深层实例化失败               | concepts；static_assert 在模板内提前报错  |

`extern template` 值得认识：在一个 TU 里显式实例化、其他 TU 声明「别再实例化」，热点模板（如 `std::vector<std::string>` 被几百个文件使用）能砍掉可观的编译与代码体积。

```cpp
// a.cpp：真正实例化
template class MiniVec<int>;
// 其他文件：只声明（不重复生成）
extern template class MiniVec<int>;
```

> [!TIP]
> 「模板让编译错误不可读」的另一个自救手段：在模板内部用 `static_assert` 前置检查参数要求——错误在进入模板第一行就报，而不是在十层实例化深处。concepts 普及后它负责「更细粒度的语义检查」（如「T 的 size() 返回 size_t」）。

## 8. 陷阱清单

- 模板定义放 .cpp：其他 TU 实例化失败（undefined reference）；定义进头文件或显式实例化。
- 函数模板写偏特化：不存在；用重载或类模板偏特化。
- 普通 if 做类型分支：两个分支都要能编译；用 if constexpr。
- 模板内的 static_assert 缺位：类型错误在深处爆炸；进入处先验约束。
- 对每个类型盲目实例化：二进制膨胀；extern template + 内核抽取。
- 概念约束过松（只写 typename）：错误延迟到实例化深处；concepts 尽量细。
- `Array<double,3>` 与 `Array<double,4>` 当同类型：非类型参数是类型的一部分；运行期尺寸用 vector。
- 在头文件模板里包含重头：所有使用者陪绑编译时间；Pimpl/模块隔离。
- 忘了模板推导丢引用：泛型代码里意外拷贝；`T&`/`T&&`/`const T&` 按语义选。

## 9. 小结

- 模板是生成代码的配方：每个实参组合实例化一份专用代码——零开销的来源，也是膨胀与编译时间的来源；定义必须在头文件（或显式实例化）。
- 类模板的内核是「内存与对象分离」：原始分配 + placement new + 逆序析构，对任意 T 正确工作；成员函数按需实例化。
- 特化给特殊类型换配方：类模板可偏特化，函数模板用重载替代；if constexpr 是编译期分支，未选中的分支不实例化。
- constexpr 把计算挪进编译期且运行时同一份代码；C++20 后编译期可用 string/vector。
- concepts 让约束成为签名的一部分：报错从模板栈考古变成一句「constraint not satisfied」；SFINAE/enable_if 是历史武器，新代码不再手写。
- 工程账：膨胀靠内核抽取与 extern template，编译时间靠 Pimpl 与模块，错误靠 concepts 与模板内 static_assert。

## 10. 练习

**1.** 手写 `MiniVec`（第 2 节骨架）补全 pop_back、operator=（拷贝/移动），用第 5 篇的计数类验证扩容时移动 vs 拷贝的次数随 noexcept 的变化。

> [!TIP]
> 思路扩容用 `std::move_if_noexcept`——noexcept 移动类型走移动，否则拷贝（强保证）。计数类实验直接复现 std::vector 行为，同时检验你写的 Rule of Five 是否完整（漏移动成员时扩容全拷贝）。

**2.** 写一个 `template <size_t N> struct Matrix`（N×N 定长方阵），提供 operator*、transpose（constexpr），并说明 `Matrix<3>` 与 `Matrix<4>` 为什么互不兼容、这个「不相容」对数值代码是保护还是负担。

> [!TIP]
> 思路不相容因为 N 是类型一部分：把「3×3 乘 4×4」挡在编译期（保护）；代价是每种 N 一份代码（膨胀）与接口泛型化需要模板。运行期尺寸变化用 vector 的动态矩阵。固定小尺寸（2/3/4）的图形学矩阵是 non-type parameter 的教科书场景。

**3.** 用 concepts 写 `template <typename T> concept Stack = requires(...) {...}`（push/pop/top/empty），再写一个基于 deque 与基于 vector 的两个实现，用同一个函数模板消费两种栈。

> [!TIP]
> 思路concept 表达「接口形状」：`requires(T t) { t.push(declval<typename T::value_type>()); { t.top() } -> ...; t.pop(); }`。消费函数对两种实现零修改——concept 版的「接口继承」，无虚函数开销。对比 Java 接口：编译期鸭子类型 + 显式约束。

**4.** 把第 1 节的 `max_of` 加上 concepts 约束（要求 ordered），分别观察「错误类型调用」在有/无 concept 时的报错信息差异。

> [!TIP]
> 思路无约束：错误在 `a > b` 实例化深处，几行模板栈；有约束：`constraint not satisfied: ordered<std::thread>` 一行。这个对比是向团队推广 concepts 的最好素材——约束的价值在错误路径上兑现。

**5.** 用 if constexpr 写一个 `deep_size<T>`（计算对象的「深」内存占用：基础类型算 sizeof，string/vector 算堆内数据，容器递归元素），说明普通 if 为什么写不了。

> [!TIP]
> 思路分支：is_arithmetic → sizeof；string → sizeof + capacity；vector → sizeof + 递归元素深和；其他 → sizeof。普通 if 要求所有分支对 T 都编译（vector 分支对 int 不合法）→ 必须 if constexpr。递归用「编译期类型递归」，这就是最朴素的模板元编程。

**6.** 讨论：`std::vector<std::vector<int>>` 与 `std::vector<std::string>` 各实例化几份代码？什么时候值得 extern template？给出你的项目判断标准。

> [!TIP]
> 思路每类一份（vector< vector<int> > 内部还有嵌套实例化链）。判断标准：①同一实例化被 ≥N 个 TU 使用（编译时间）；②二进制体积敏感（膨胀）；③热点路径（初始化开销）。典型收益场景：解析器/游戏引擎里被全项目使用的十来个容器实例。
