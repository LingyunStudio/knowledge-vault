---
title: 引用、const 与类型推导：值与名的语法
order: 2
tags: 引用, const, auto, decltype, 悬垂引用
summary: 引用的契约与悬垂场景、const 的多层语义与 constexpr 的边界、auto 推导的精确规则（何时丢引用、何时丢 const）、统一初始化与窄化检查，以及「写 auto 之前必须能说出它的类型」的工程纪律。
---

C++ 的对象世界有两条并行的轨道：**值**（对象本身，拷贝产生独立副本）与**名**（指向对象的别名，操作别名就是操作本体）。引用就是「名」的语法化——它比 C 的指针承诺更强（必须指向有效对象），又比指针更透明（用起来像对象本身）。而 `auto` 是让编译器替你写类型的机制——方便的前提是你**必须知道**它推导出了什么。

这一篇把「名」的语法讲透：引用的契约与死亡方式、const 的多层结构、auto 推导的精确规则。它们是后面所有篇章的语法基础——STL 接口、智能指针、模板，全用这套词汇书写。

## 1. 引用：必须指向有效对象的「别名」

### 1.1 契约与行为

```cpp
#include <iostream>

int main() {
    int x = 42;
    int &r = x;              // r 是 x 的别名：从声明起 r 就是 x 的另一个名字

    r = 100;                 // 写 r 就是写 x
    std::cout << x << '\n';  // 100
    std::cout << &x << ' ' << &r << '\n';   // 同一个地址
}
```

与指针的三点关键差异：

| 维度     | 引用 `int&`            | 指针 `int*`            |
| -------- | ---------------------- | ---------------------- |
| 初始化   | 必须绑定，不能「先声明后绑」 | 可以为空、可以后赋          |
| 重新绑定 | **不能**：r 永远是 x 的别名 | 可以随时指向别处            |
| 解引用   | 直接用（透明）           | `*p` 显式操作             |
| 可空性   | 语言层面「不应存在空引用」 | NULL/nullptr 是合法状态     |

「不能为空、不能重绑」让引用成为**比指针更强的契约**：函数签名里写 `const std::string&`，调用方知道「这是个必填的、只读的、不产生拷贝的参数」；写 `const std::string*` 则还多一层「也许可以不传」的可能性（可空参数）。

### 1.2 参数传递的决策表

```cpp
void by_value(std::string s);          // 拷贝进函数：函数内可自由修改，成本 = 拷贝
void by_ref(std::string &s);           // 可修改本体：无拷贝
void by_cref(const std::string &s);    // 只读别名：无拷贝、不能改 —— 最常用
void by_ptr(std::string *s);           // 可空、可重绑、调用处要取址 —— 表达「可选」
```

| 意图                     | 用法                    |
| ------------------------ | ----------------------- |
| 只读大对象                 | `const T&`（默认姿势）    |
| 需要修改调用方的对象         | `T&`                     |
| 需要独立副本随意修改         | 传值 `T`（小型对象）       |
| 参数可选                   | `const T*`（可传 nullptr）|
| 输出参数（现代 C++）        | 返回值/结构体替代，`T*` 退居二线 |

小型可平凡拷贝的对象（int、double、指针、小结构体）**传值**反而最优：寄存器传递，比引用的间接寻址快。经验阈值（约 ≤ 16 字节或两个机器字）内传值，容器/字符串类一律 `const&`。

### 1.3 悬垂引用：引用的死亡方式

引用不为空、不重绑，但它指向的**对象**会死：

```cpp
const std::string &bad() {
    return std::string("temp");        // ❌ 返回对局部临时对象的引用
}

const std::string &worse(const std::string &s) {
    return s;                          // 这个本身合法……
}
// 但 worse(a + b) 会把临时对象绑定到形参，
// 返回值再指回那个已死的临时 —— 悬垂
```

悬垂引用的症状与悬垂指针相同：编译通过、运行随机。区别是引用的「无空性」让人**更容易忘记它也能悬垂**。编译器对 `bad()` 会告警（`-Wreturn-local-addr` 类），但 `worse` 这类经过转手的悬垂只能靠理解语义与工具（ASan）。

### 1.4 const 引用与临时对象的寿命延长

一个精妙且必须理解的语言规则：

```cpp
std::string make() { return "hello"; }

const std::string &r = make();     // 合法！临时对象寿命延长到 r 的作用域结束
std::string_view sv = make();      // ❌ string_view 只存指针：临时立即销毁，sv 悬垂
```

`const T&` 绑定临时对象时，标准规定临时对象**活到引用死为止**——这是「无拷贝传递临时对象」合法的根据（STL 接口大量依赖它）。而 `string_view`/`span` 这类**非拥有视图**没有延长机制，绑定临时是灾难的温床（[第 12 篇](12-modern-features.md)展开）。

## 2. const：从变量到成员的分层结构

### 2.1 const 的位置语法与顶层/底层之分

```cpp
const int *p;              // 底层 const：*p 只读（指向的对象 const）
int *const p = &x;         // 顶层 const：p 本身 const（不能重指向）
const int *const p = &x;   // 两层都有

// 读法技巧：从右往左读。
// int* const p：p is a const pointer to int
// const int* p：p is a pointer to const int
```

「顶层」= 对象本身是常量（拷贝时被忽略），「底层」= 指向的东西是常量（拷贝时被保留）。这个区分在模板与重载决议里都有实际意义，日常最重要的是记住：**函数参数追求最宽的 const**（能 `const T&` 就不 `T&`），让接口契约尽可能宽。

### 2.2 const 成员函数与 mutable

```cpp
class Playlist {
    std::vector<std::string> songs;
    mutable size_t play_count = 0;     // 「逻辑常量」的一部分

public:
    std::string first() const {        // 承诺不修改对象状态
        ++play_count;                  // mutable 成员例外：统计类副作用合法
        return songs.front();
    }
};
```

`const` 成员函数是接口契约的核心：**const 对象只能调 const 成员函数**。设计类的默认姿势——先写 const 成员函数（它们定义了「只读能力面」），再按需加非 const 版本。

### 2.3 constexpr 与 const 的本质区别

| 关键字       | 语义                        | 用途                       |
| ------------ | --------------------------- | -------------------------- |
| `const`      | 运行时只读（初始化之后不改）  | 接口契约、只读数据            |
| `constexpr`  | 编译期可求值                 | 数组大小、模板参数、编译期计算 |

```cpp
constexpr int square(int x) { return x * x; }   // 编译期可执行的函数

int a[10];
constexpr int n = sizeof(a) / sizeof(a[0]);
int b[square(3)];                  // 编译期求值：数组大小是常量表达式
```

`const` 说「我不会改」，`constexpr` 说「编译器你现在就算」。二者可以叠加（`constexpr` 变量天然 const）。规则：**能用 constexpr 就用**——数组大小、编译期常量、常量函数，把计算挪进编译期是免费性能。

## 3. auto：方便的前提是知道推导结果

### 3.1 auto 的推导规则：值语义默认

`auto` 按**传值**推导——这是它最常踩的坑：

```cpp
std::vector<std::string> v = {"a", "b"};

auto x = v[0];              // std::string —— 拷贝！
auto &r = v[0];             // std::string& —— 别名
const auto &cr = v[0];      // const std::string& —— 只读别名

auto w = v;                 // 拷贝整个 vector（隐藏的深拷贝！）
```

规则浓缩版：**auto 丢弃引用与顶层 const**；想要别名必须显式写 `auto&`；`auto&&` 是「万能引用」（转发引用，[第 5 篇](05-copy-move.md)展开）。由此得出 C++ 社区最重要的 auto 纪律：

> [!WARNING]
> **写 auto 之前必须能说出它的完整类型。** auto 的价值是省略冗长类型名，不是「懒得知道类型」。`auto x = v[0]` 写下的一瞬间你就应该知道「这是一次 string 拷贝」——说不出类型的 auto 是事故（大量拷贝、悬垂、类型不符），不是简洁。

### 3.2 三个必会的推导场景

```cpp
// ① 范围 for：拷贝还是引用？
for (auto s : v) ...          // 每个元素拷贝一次（string 时代价可观）
for (auto &s : v) ...         // 可修改元素本体
for (const auto &s : v) ...   // 只读遍历 —— 默认写法

// ② 迭代器与范围表达式
auto it = std::find(v.begin(), v.end(), 42);   // vector<int>::iterator：auto 的正当领地

// ③ 结构化绑定（C++17）：拆开 pair/struct/map 的项
std::map<std::string, int> scores;
for (const auto &[name, score] : scores)      // name、score 绑定到 pair 成员
    std::cout << name << ' ' << score << '\n';
```

### 3.3 decltype 与后置返回类型

`auto` 按「像传值一样」规则推导，`decltype` 按**表达式的声明类型**原样保留（含引用与 const）：

```cpp
int x = 0;
int &rx = x;
decltype(x)  a = 1;     // int
decltype(rx) b = x;     // int&（引用被保留！）

// 后置返回类型：返回类型依赖参数类型的场景
template <typename A, typename B>
auto add(A a, B b) -> decltype(a + b) { return a + b; }
// C++14 起可直接 auto 返回值推导；C++20 起多数场景被简写
```

`decltype(auto)` 是两者的合体：按 decltype 规则推导返回类型（保留引用）——「返回引用的函数模板」需要它，日常代码记住存在即可。

## 4. 统一初始化：花括号的时代

C++11 用花括号统一了初始化语法，并附带一个重要保护——**窄化检查**：

```cpp
int a = 3.14;             // 合法但丢精度（C 遗产）
int b{3.14};              // ❌ 编译错误：窄化转换
int c{(int)3.14};         // 合法：显式转换表达了意图

std::vector<int> v{1, 2, 3};      // 列表初始化
std::string s{"hello"};
struct Point { int x, y; };
Point p{1, 2};                    // 聚合初始化

auto d{10};               // int —— 花括号对 auto 有特殊规则（禁止 auto+列表推断成 initializer_list）
```

工程规约：**新代码默认花括号初始化**（窄化保护 + 统一语法 + 无「最令人头疼的解析」问题），但注意两个例外：`std::vector<int> v(10)` 是 10 个元素、`v{10}` 是含一个 10 的 vector——构造函数重载决议在花括号下有差异，容器尺寸初始化保持圆括号。

## 5. 陷阱清单

- 返回局部对象的引用/引用形参再返回：悬垂；返回值或按值返回。
- `auto x = v[0]` 隐藏拷贝：知道类型再写 auto；只读遍历用 `const auto&`。
- `for (auto x : 大容器)`：每元素一次拷贝；`const auto&`。
- `string_view sv = func_returning_string()`：临时对象销毁视图悬垂；先存具名变量。
- 忽略顶层/底层 const 差异：指针的 const 语义写反。
- `constexpr` 只当 `const` 用：它是编译期求值标记；数组尺寸、模板参数尽量 constexpr。
- 花括号与圆括号的容器初始化歧义：`v(10)` vs `v{10}`；尺寸用圆括号。
- 可空性表达错误：用 `T&` 表达「可选参数」（它不可空）；可选用指针或 `std::optional`。
- 引用成员让类不可赋值（拷贝赋值被删）：设计类时慎用引用成员。
- 说出不出类型的 auto：要么查要么改显式类型，别赌。

## 6. 小结

- 引用是「必须指向有效对象、不可重绑」的别名；与指针共同构成 C++ 的参数传递词汇表——只读大对象 `const T&`、修改本体 `T&`、可选 `T*`/`optional`、小对象传值。
- 悬垂引用与悬垂指针同罪：引用不为空不等于不悬垂；`const T&` 延长临时对象寿命是语言规则，`string_view` 等视图类型没有此机制。
- const 分顶层（对象自身）与底层（指向物）；const 成员函数定义类的只读能力面；constexpr 是「编译期算」而 const 是「运行时只读」，能 constexpr 则 constexpr。
- auto 按传值规则推导（丢引用丢顶层 const），纪律是「写下 auto 时必须能说出完整类型」；范围 for 默认 `const auto&`；结构化绑定拆 pair/map 项。
- 花括号初始化统一语法 + 窄化检查；容器尺寸语义（`v(10)`）保留圆括号。

## 7. 练习

**1.** 写三个函数签名：`grow(int)`、`grow_ref(int&)`、`grow_ptr(int*)`，分别在调用后打印实参的值，验证「值拷贝、引用别名、指针显式间接」三种行为；再解释为什么 `grow_ref(2+3)` 编译不过而 `grow_ptr(&(2+3))` 同样不行（临时对象的语义差异）。

> [!TIP]
> 思路非 const 引用不能绑定临时对象（`2+3` 是右值），这是语言对「修改临时毫无意义」的防护；`int*` 同样不能取临时地址。`const int&` 才能绑临时（寿命延长）。这个练习直接暴露了「左值/右值」概念的入口（[第 5 篇](05-copy-move.md)展开）。

**2.** 解释下面四行的类型与行为差异：

```cpp
std::vector<std::string> v{"a", "b", "c"};
auto a = v[0];
auto &b = v[0];
const auto &c = v[0];
auto d = v;
```

> [!TIP]
> 思路a：string 拷贝（一次堆分配）；b：string&（写 b 改 v[0]）；c：const string&（只读别名）；d：整个 vector 深拷贝（n 次堆分配 + 元素拷贝）。性能敏感代码里 a/d 的拷贝经常是意外。

**3.** `const std::string &s = std::string("hi") + "!"` 合法且安全，`std::string_view sv = 同样的表达式` 危险。用寿命规则解释两者的差别，并写代码验证 sv 的悬垂。

> [!TIP]
> 思路const 引用绑定临时 → 临时寿命延长到引用作用域结束（语言保证）；string_view 是纯视图（存指针+长度），绑定后临时立即析构 → sv 指向已释放内存。验证：sv 之后读取输出乱码或崩溃，ASan 报 heap-use-after-free（栈上则报 stack-use-after-scope）。

**4.** 用 `constexpr` 写一个编译期斐波那契（`constexpr long long fib(int n)`），验证 `fib(40)` 在编译期完成（静态断言或数组大小触发），并说明「编译期算完」与「运行时算完」在二进制产物上的区别。

> [!TIP]
> 思路`static_assert(fib(40) == 102334155)`：断言在编译期通过说明 fib(40) 是编译期常量。二进制上编译期版本直接内联出常量 102334155，运行时版本是一条调用链。C++20 的 `consteval` 可以强制「必须编译期」。

**5.** 设计一个函数 `int find_index(const std::vector<int>&, int target)` 找不到时怎么办？讨论四种方案（哨兵 -1、异常、`std::optional`、改写成迭代器返回），说明每种在调用方的分支形态。

> [!TIP]
> 思路哨兵：`if (idx < 0)`（但 -1 可能是合法下标的歧义需要文档）；异常：控制流跳转，成本高且「找不到」不算异常场景；optional：`if (auto idx = find_index(v, 7)) use(*idx)`——类型系统表达「可能没有」，现代首选；迭代器：`if (it != v.end())`，STL 风格。这是引出词汇类型（[第 12 篇](12-modern-features.md)）的绝佳案例。

**6.** 解释为什么「引用数据成员让类不可赋值」，并给出替代设计（指针成员、值成员、optional）。

> [!TIP]
> 思路引用不可重绑：拷贝赋值需要「改指向」，语义上不可能 → 编译器删除赋值运算符（类变成不可赋值类型），放进容器（要求可赋值）会编译失败。替代：`T*`（可空可重绑，语义是「关联对象可能换」）、值成员（独立副本）、`std::optional<T>`。引用成员的正确用武之地极少——需要「必绑且不可换」时，通常说明这个关系应该是构造时的绑定（如基类子对象）。
