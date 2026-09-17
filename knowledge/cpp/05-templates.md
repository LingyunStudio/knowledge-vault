---
title: 模板
order: 5
tags: 核心, template, 泛型
summary: 函数模板与类模板、实例化与推导、与宏和虚函数的取舍。
---

模板是 C++ 的泛型机制：写一份代码，编译器按用到的类型**现场生成**多份特化版本。它与 Rust 泛型同源——静态分发、零运行时开销——但语法更古老、错误信息更凶残。理解模板也是读懂 STL 的前提：整个 STL 就建立在模板之上。

## 函数模板

```cpp
template <typename T>
T max_of(const T& a, const T& b) {
    return a > b ? a : b;
}

int main() {
    max_of(1, 2);                    // T 推导为 int，编译器生成 int 版本
    max_of(1.5, 0.5);                // T 推导为 double
    max_of<std::string>("a", "b");   // 手动指定 T，实参隐式转换成 string
}
```

模板本身不是代码，是**生成代码的配方**。编译到 `max_of(1, 2)` 这一行时，编译器才实例化出 `int max_of<int>(const int&, const int&)`。没被用到的实例根本不存在——这一点与 C「所有函数都会编译」完全不同。

推导失败是编译期错误：

```cpp
max_of(1, 2.0);          // ❌ 编译错误：T 不能同时是 int 和 double
max_of<double>(1, 2.0);  // ✅ 手动指定 T 后，各自隐式转换
```

## 类模板

```cpp
#include <vector>

template <typename T>
class Stack {
public:
    void push(const T& v) { data_.push_back(v); }
    void pop() { data_.pop_back(); }
    const T& top() const { return data_.back(); }
    bool empty() const { return data_.empty(); }

private:
    std::vector<T> data_;
};

Stack<int> si;             // 实例化出 Stack<int>，一套完整代码
Stack<std::string> ss;     // 又一套
```

类模板的成员函数定义若放在类外，每个都要带 `template <typename T>` 前缀，语法噪音大——惯例是小型成员直接写在类内（隐式 inline）。

> [!NOTE]
> 模板**必须放在头文件里**。编译器在每个使用点都需要配方全文才能实例化，只有声明的 `.cpp` 文件会在链接时报 undefined reference。这不是风格偏好，是实例化模型决定的。

## 非类型模板参数

模板参数不一定是类型，编译期常量也可以：

```cpp
template <typename T, size_t N>
class FixedArray {
public:
    constexpr size_t size() const { return N; }
private:
    T data_[N];          // N 是编译期定死的长度
};

FixedArray<int, 16> a;   // 16 进入类型：<int, 16> 与 <int, 32> 是两个不同类型
```

`std::array<int, 16>` 就建立在这个机制上：长度是类型的一部分，错误在编译期或由工具暴露，而不是运行期越界。约束也明确：非类型参数必须是编译期常量——整数、枚举、指针等；浮点与字符串字面量在标准里长期不允许（C++20 起放宽了部分）。

> [!TIP]
> 模板递归曾是编译期计算的原始手段：`Pow<2, 10>::value` 靠一层层实例化展开求值。有了 constexpr 之后，这类计算大多应改写成 constexpr 函数，可读性高一个量级。

## 模板 vs 宏 vs 虚函数

三套方案解决「代码复用」的三个不同层次：

| 方案 | 生效时机 | 类型检查 | 运行时开销 | 适用 |
| --- | --- | --- | --- | --- |
| 宏 `#define` | 预处理，文本替换 | 无 | 零 | 几乎不用 |
| 虚函数 | 运行时 | 编译期（统一接口） | 一次间接跳转，阻止内联 | 运行时才确定类型 |
| 模板 | 编译期 | 实例化时逐个检查 | 零（静态分发） | 编译期知道类型 |

C 程序员熟悉的 `qsort` 用函数指针做比较，每次比较一次间接调用；C++ 的 `std::sort` 用模板，比较函数被内联展开，大数组排序常有数倍差距——这是模板静态分发的直接收益。

## 与 Rust 泛型的对照

心智模型几乎一致，约束的表达方式是主要差异：

```cpp
template <typename T>
T add(const T& a, const T& b) { return a + b; }
// C++17 及以前：约束不存在，a + b 不合法只在实例化时爆出
```

C++17 时代的约束只能靠「文档 + 用到才报错」：模板里写了一句 `a + b`，传入不支持的类型时，报错位置在**模板内部深处**而不是调用点。C++20 的 concepts 把约束提到接口上（详见[现代 C++ 精选](11-modern-features.md)），报错才变成人话——那时的心智模型就与 Rust 的 trait bound 基本对齐了。

> [!WARNING]
> 模板滥用会让编译时间爆炸、二进制膨胀：`Stack<int>`、`Stack<long>`、`Stack<unsigned>` 是三份独立代码。把与 T 无关的逻辑抽到普通函数或非模板基类，是控制膨胀的常规手法；接口稳定的模块，虚函数反而更划算。

## 实例化细节两则

- **显式实例化**：在 `.cpp` 里写 `template class Stack<int>;` 强制生成一份，配合头文件里的 `extern template class Stack<int>;` 声明，可以把实例化收敛到单个翻译单元，缩短全项目编译时间
- **两阶段检查**：模板定义先做一遍与 T 无关的语法检查，实例化时再做依赖 T 的检查。所以模板里依赖类型成员的名字写错了，爆雷时机是实例化那一刻

> [!TIP]
> 读模板报错的姿势：从**最里层**的错误看起，再沿 "required from here" 链回到自己的调用点。真正的问题几乎总在你的调用或类型定义上，别被第一屏模板签名吓退。

## 练习

- [ ] 写 `template <typename T, size_t N> constexpr size_t count_of(T (&)[N]) { return N; }`，用它获取 C 数组长度，体会模板的编译期计算
- [ ] 给 max_of 传一个没实现 `>` 的自定义类型，通读报错，找到 "required from here" 指向的行
- [ ] 在两个 `.cpp` 里分别实例化 `Stack<int>` 和 `Stack<double>`，用 `nm` 查看符号，确认生成了两份代码
- [ ] 用模板递归实现编译期整数幂 `Pow<2, 10>::value`，再用 constexpr 函数重写一遍，对比两者

相关阅读：[STL 容器](06-stl-containers.md)
