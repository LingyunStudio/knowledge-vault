---
title: 现代 C++ 精选
order: 11
tags: 进阶, C++17, C++20
summary: auto/constexpr/结构化绑定/指定初始化/concepts：更安全更短的现代写法。
---

C++11 之后语言演进只有一条主线：让编译器替人做更多事——推类型、算数值、查约束。本篇挑出性价比最高的几件：auto、constexpr、string_view、指定初始化、concepts。它们不改心智模型，只让代码更短、更安全；学完可以直接替换掉旧式的啰嗦写法。

## auto：让编译器写类型

```cpp
auto it = m.begin();                     // unordered_map<std::string,int>::iterator，手写一遍试试
auto n = v.size();                       // size_t
for (const auto& [k, val] : m) { ... }   // 配结构化绑定，遍历零噪音
```

auto 的推导规则要心里有数：**按值推导会丢掉引用和顶层 const**：

```cpp
const std::string& config = get_config();
auto s = config;           // s 是 std::string：拷贝了一份，引用和 const 都被剥掉
const auto& s2 = config;   // 想保留就得自己补上
```

使用判断：类型冗长或显而易见（迭代器、lambda、范围 for 元素）用 auto；类型本身是文档（`int retry_count` 比 `auto` 可读）就写全。

## constexpr：把计算搬到编译期

`const` 是「运行期只读」，`constexpr` 是「编译期算出」：

```cpp
constexpr int square(int x) { return x * x; }    // C++14/17 放宽后函数体几乎随意

constexpr int N = square(8);     // 编译期算出 64
std::array<int, N> buf;          // 能当数组大小、模板实参

int x = read_input();
int y = square(x);               // 运行期也能调，同一个函数两用
```

编译期能做的检查就别留给运行期：查表、单位换算、配置常量的合法性，全部 constexpr 化后，错误在编译时爆而不是上线后爆。Rust 的 `const fn` 是同一思想。

它的近亲 `if constexpr`（C++17）把「编译期选分支」用进模板：不成立的分支不参与实例化，比老式模板特化轻得多：

```cpp
template <typename T>
auto twice(T x) {
    if constexpr (std::is_integral_v<T>)
        return x * 2;          // 整数走这里
    else
        return x + x;          // 浮点走这里；另一支不编译，不报错
}
```

> [!TIP]
> constexpr 是「可以」不是「必须」：参数是常量表达式才在编译期算，否则就是普通函数。想强制「必须编译期」，用 `constexpr` 变量接结果，或加 `static_assert` 验证。

## string_view：不拥有的字符串

C++17 的 string_view 是「`const char*` + 长度」的包装：不分配、不拷贝、不拥有：

```cpp
#include <string_view>

void greet(std::string_view name) {    // string、char*、字面量全能传，零拷贝
    std::cout << "hi, " << name << "\n";
}

greet(std::string("tmp"));             // ✅ 传什么都不会拷贝出新的字符串
```

它取代了 C 时代 `const char*` 参数的大部分场景，还带 `substr`、`starts_with` 式的现代接口，且与 std::string 互转无摩擦。

> [!WARNING]
> string_view 不延长底层数据的生命周期。返回指向局部 string 的 view、把 view 绑到临时对象上存起来，都是悬空陷阱。它是「借用」的语义——和 Rust 的 `&str` 同构，借用规则同样得靠人守（或靠 asan 抓）。

## 指定初始化与 if 初始化（C++17/20）

```cpp
struct Options {
    int retries = 3;
    std::string host = "localhost";
    bool tls = false;
};

Options o{.host = "kb.local", .tls = true};    // C++20 指定初始化：跳过的字段用默认值
```

字段名写进初始化语句：漏字段、错序（必须按声明顺序）编译器都查，比传一串位置参数可靠得多。配上 C++17 的 if 初始化语句，作用域管理也更干净：

```cpp
if (auto it = m.find(key); it != m.end()) {    // it 只在 if/else 里可见
    use(it->second);
}   // 不会泄漏到外面的作用域
```

## concepts（C++20）：给模板装上类型约束

模板篇说过，C++17 及以前的模板报错是「实例化深处」的天书。concepts 把约束写进签名：

```cpp
#include <concepts>

template <typename T>
concept Numeric = std::integral<T> || std::floating_point<T>;

template <Numeric T>
T half(T x) { return x / 2; }

half(42);          // ✅ int 满足 Numeric
half("str");       // ❌ 报错直接指到调用点：参数不满足 Numeric
```

标准库备好了 `std::integral`、`std::convertible_to`、`std::same_as` 等常用 concept，`requires` 子句还能写任意表达式约束。这基本对齐了 Rust trait bound 的体验（静态分发层面）——约束在接口上，报错在调用点。

> [!NOTE]
> 特性采用优先级：先全量用 C++11 的（auto、范围 for、智能指针、override）；再顺手用 C++17 的（结构化绑定、if 初始化、string_view、optional、filesystem）；C++20 的（concepts、指定初始化、span）按编译器支持逐步引入。新代码没有理由不用 C++17 基线，旧代码不必为现代化而现代化。

## 练习

- [ ] 写 constexpr 斐波那契，用 `static_assert(fib(10) == 55)` 验证它真的在编译期完成
- [ ] 构造 string_view 悬空：函数返回局部 string 的 view，开 asan 观察报错
- [ ] 把一个无约束模板函数改成 concepts 版本，故意传错类型，对比两种报错信息

相关阅读：[模板](05-templates.md)
