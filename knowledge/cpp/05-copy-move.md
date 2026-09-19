---
title: 拷贝与移动：值类别与移动语义
order: 5
tags: 移动语义, std::move, RVO, 完美转发, 值类别
summary: 值类别的精确含义、std::move 只是转换不移动任何东西的机制真相、RVO 让返回值不发生拷贝/移动、moved-from 状态的规约、完美转发与 emplace 的零拷贝路径，以及 noexcept 如何决定 vector 扩容的性能。
---

「移动语义」这个词有个误导：它听起来像「把内存搬到新地址」。实际的机制平淡得多——**移动 = 把资源的所有权从旧对象转给新对象，旧对象回到空状态**。`std::string` 的移动只是把三根指针（数据、长度、容量）从 a 复制到 b、再把 a 的指针清空，几条指令的事；而拷贝要做一次堆分配加整块内存复制。

本篇按「为什么会需要移动 → 机制是什么 → 编译器什么时候自动移动 → 转发怎么不丢类别」展开。先立一个心法：**移动语义是性能优化，不是新的语义模型**——写对拷贝语义的类（[第 3 篇](03-classes.md)），移动语义就是拷贝语义的廉价版本。

## 1. 值类别：左值与右值

每个表达式有**类型**（type），也有**值类别**（value category）。实用上只需两分：

```cpp
int x = 42;            // x 是左值：有名字、能取地址、生命周期由作用域管
int y = x + 1;         // x + 1 是右值：临时的、没有名字、本行结束后即亡
                       // y = 42 也是右值
```

| 维度   | 左值（lvalue）          | 右值（rvalue）                |
| ------ | ----------------------- | ----------------------------- |
| 身份   | 有名字/有地址           | 匿名临时                       |
| 生命周期 | 作用域                | 本表达式的末尾                 |
| 出现处 | 具名变量、函数返回引用    | 字面量、算术结果、函数按值返回、make 函数 |

为什么这个区分重要？**右值是「即将销毁的对象」**——从它身上「偷」资源是安全的（它马上就没了），这就是移动语义的合法性来源：

```cpp
std::string a = "hello";
std::string b = a;               // a 是左值：不知道你以后还用不用 → 必须拷贝
std::string c = std::move(a);    // std::move(a) 是右值：明确表示「a 我不要了」→ 移动
// 此后 a 处于 moved-from 状态（见第 3.3 节）
```

## 2. 拷贝语义：移动语义的地基

拷贝构造与拷贝赋值在[第 3 篇](03-classes.md)的 Rule of Five 里已定位，这里补足成本视角：

```cpp
class Text {
    char *data_;
    size_t len_;
public:
    Text(const Text &other)                       // 拷贝构造：深拷贝
        : len_(other.len_), data_(new char[other.len_]) {
        std::memcpy(data_, other.data_, len_);    // O(len)：一次分配 + 一次复制
    }
    Text &operator=(const Text &other) {          // 拷贝赋值：处理自赋值！
        if (this != &other) {
            char *nd = new char[other.len_];      // 先分配新的（强保证：失败不影响*this）
            std::memcpy(nd, other.data_, other.len_);
            delete[] data_;
            data_ = nd;
            len_ = other.len_;
        }
        return *this;
    }
};
```

拷贝的成本分三档：**平凡拷贝**（memcpy 整块，如 POD 结构体——编译器自动生成即可）、**深拷贝**（分配 + 复制，如上述 Text）、**禁拷贝**（独占资源）。移动语义的收益恰好集中在第二档：深拷贝类把「分配+复制」换成「转移指针」。

## 3. 移动语义：机制与规约

### 3.1 std::move 不移动任何东西

初学者最大的误解先拆掉：`std::move` **是类型转换，不是操作**。运行期它什么都不做：

```cpp
template <typename T>
constexpr std::remove_reference_t<T> &&move(T &&t) noexcept {
    return static_cast<std::remove_reference_t<T> &&>(t);
}
// 本质：把左值 cast 成右值引用 —— 改变的是表达式的值类别，不是内存
```

`std::move(a)` 的意思读作：**「请把 a 当作右值处理」**——即「授权接受方从 a 偷资源」。真正执行移动的是**移动构造函数/移动赋值运算符**：

```cpp
class Text {
    char *data_ = nullptr;
    size_t len_ = 0;
public:
    Text(Text &&other) noexcept                       // 移动构造
        : data_(std::exchange(other.data_, nullptr)), // 偷指针 + 原对象置空
          len_(std::exchange(other.len_, 0)) {}

    Text &operator=(Text &&other) noexcept {          // 移动赋值
        if (this != &other) {
            delete[] data_;                           // 释放自己现有的
            data_ = std::exchange(other.data_, nullptr);
            len_ = std::exchange(other.len_, 0);
        }
        return *this;
    }
    ~Text() { delete[] data_; }
    // 拷贝成员与默认构造略（Rule of Five 全套，见第 3 篇）
};
```

### 3.2 自动移动的触发点

什么时候编译器**自动**移动（不需要你写 std::move）？

```cpp
// ① 传临时对象：实参是右值 → 自动移动
std::vector<std::string> v;
v.push_back(std::string(1000, 'x'));       // 临时 string：移动进容器
std::string s = make_string();             // make_string() 返回值：移动进 s（也可能被 RVO 消除，见下）

// ② vector 扩容：元素搬家用移动（若移动构造 noexcept，见 5.1）
v.push_back(another);                      // 扩容时旧元素的迁移

// ③ 返回局部对象：见 RVO —— 通常连移动都没有
```

什么时候**必须显式** std::move？只有一个典型场景：**你确实不再需要这个具名对象**：

```cpp
void sink(std::string s);

std::string config = read_config();
use(config);                     // 还要用
sink(std::move(config));         // 最后一次使用：显式移交
// 此后 config 不要再读（moved-from 状态）
```

「最后一次使用处加 std::move」是性能代码的标准手法。

### 3.3 moved-from 状态：移动后的对象是什么

标准只保证 moved-from 对象**可以被析构、可以被赋新值**，其他状态取决于类的设计。社区规约：**moved-from = 有效但未指定的状态**——像默认构造但没有任何值承诺：

```cpp
std::string a = "hello";
std::string b = std::move(a);
// a 现在是「有效但未指定」：可能是空串（多数实现），但标准不承诺
a.clear();                       // ✅ 合法：可以重置
a = "world";                     // ✅ 合法：可以赋新值
a.size();                        // ⚠️ 合法但值未指定 —— 别依赖
```

工程规约：**移动之后到赋新值之前，不读它的值**。这规约的另一个推论：移动不该出现在「对象还有语义职责」的位置上——它是所有权移交，不是「用完扔」的花哨写法。

### 3.4 内置类型与「移动等于拷贝」

`std::move(int)`、移动一个 `std::array`、移动没有任何堆资源的类——都退化为普通拷贝（没有资源可偷）。所以移动语义**不伤害**泛型代码：对平凡类型它自动无害。这保证了容器、算法可以无脑用 move 而不需要特判。

## 4. RVO：连移动都省掉的优化

比移动更快的答案是**不移动**。C++17 起，返回「纯右值」的表达式**保证**不会发生拷贝/移动——对象直接在调用方的存储位置上构造：

```cpp
std::vector<int> make_data() {
    std::vector<int> v(1000000);
    // ... 填充 ...
    return v;                    // C++17 起保证：v 就在调用方的存储上构造，零拷贝零移动
}

auto data = make_data();         // 没有任何拷贝/移动发生
```

这是 **RVO**（返回值优化）：具名局部变量按值返回时的消除叫 NRVO（绝大多数编译器在 -O1+ 都做，但标准不强制）；无名临时（`return Widget{};`）C++17 起**语言保证**消除。

两个工程结论：

1. **按值返回 vector/string 不再可怕**——「返回大对象怕拷贝」是 C++98 的过时恐惧，现代写法大方按值返回（也比 out 参数干净）。
2. **返回时不要画蛇添足写 `return std::move(v);`**——它把 NRVO 变成显式移动（更慢），还会触发警告。局部变量直接 return，编译器先尝试消除、失败才移动，自动是最优路径。

> [!TIP]
> 「按值返回 vs 出参」的决策在新标准下翻转了：以前 `void fill(std::vector<int> &out)` 更快，现在 `std::vector<int> make()` 同样快且可读。唯一仍用出参的场景：复用调用方的已分配缓冲（避免重新分配）。

## 5. 完美转发：泛型代码里的类别保持

### 5.1 万能引用与引用折叠

```cpp
template <typename T>
void wrapper(T &&arg);        // 注意：T&& 在模板推导语境下是「万能引用」，不是右值引用
```

模板参数推导时，`T&&` 能同时绑定左值与右值：传左值时 T 推导为 `X&`（引用折叠 `X& &&` → `X&`），传右值时 T 为 `X`（→ `X&&`）。这叫**转发引用**。

### 5.2 std::forward：按原类别转发

包装函数要把参数「原封不动」（保持左值性/右值性）转给内层：

```cpp
template <typename... Args>
std::unique_ptr<Widget> make_widget(Args &&...args) {
    return std::make_unique<Widget>(std::forward<Args>(args)...);
    // 左值实参 → forward 转成左值（拷贝构造）
    // 右值实参 → forward 转成右值（移动构造）
}

make_widget(Text("hi"));        // 右值：Widget 内部移动接管
make_widget(text);              // 左值：Widget 内部拷贝
```

`std::forward<T>` 只在转发引用语境下使用（与 std::move 的区别：move 无条件转右值，forward 按原始类别恢复）。三者分工记牢：

| 工具              | 语义                                 | 使用场景             |
| ----------------- | ------------------------------------ | -------------------- |
| `std::move(x)`    | 无条件转为右值：「我不要了」           | 最后一次使用具名对象   |
| `std::forward<T>` | 恢复原始类别：「照原样转交」           | 转发引用形参的再传递   |
| 直接使用          | 什么都不转：「普通读写」               | 其余一切场合          |

### 5.3 emplace 与转发的合流：零拷贝路径

完美转发的标准库受益者是 `emplace_back`/`emplace`：

```cpp
std::vector<std::string> v;
v.push_back(s);                       // 拷贝现有对象
v.push_back(std::move(s));            // 移动现有对象
v.push_back("hello");                 // 隐式构造 string 再移动
v.emplace_back("hello");              // ✅ 直接在容器内存上构造 string，零拷贝零移动

v.emplace_back(1000, 'x');            // 构造参数原样转发给 string(1000,'x')
```

emplace 的收益与对象构造成本成正比：string/vector 等重型类型收益明显，int 级别无所谓。规约：**容器里放「就地构造」的新元素用 emplace**，传递已有对象用 push_back + move。

## 6. 性能拼图：noexcept、扩容与移动的联动

[第 4 篇](04-raii.md)埋的伏笔在这里闭环：vector 扩容要搬运全部旧元素到新内存。搬运用移动还是拷贝？标准库的选择规则：**移动构造是 noexcept → 用移动；否则为保强异常保证退回拷贝**。

```cpp
class Bad {
    std::string data_;
public:
    Bad(Bad &&other) : data_(std::move(other.data_)) {}   // ❌ 忘了 noexcept！
};

std::vector<Bad> v(1000);
v.push_back(Bad{});        // 扩容：1000 个元素全部深拷贝 string —— 移动形同虚设
```

一行 `noexcept` 的差距是整个扩容的 O(n) 拷贝。这也是「移动三件套（构造/赋值/swap）必须 noexcept」的最硬理由。

## 7. 陷阱清单

- 以为 std::move 会移动：它是 cast；真正的移动发生在移动构造/赋值里。
- 对要继续使用的对象 std::move：moved-from 之后值未指定；只在最后一次使用处 move。
- 移动构造/赋值不标 noexcept：容器扩容退化为拷贝。
- `return std::move(local)`：阻止 NRVO，更慢；直接 return。
- moved-from 对象的值被依赖：只保证可析构可赋值；用前先赋新值或重置。
- 转发引用形参用 std::move 而不是 std::forward：包装层把左值也偷走了。
- emplace 收到的参数是「构造实参」不是对象：`v.emplace_back(s)` 若本意是放一份拷贝，会引用构造吗——emplace 把 s 转发为拷贝构造参数，语义与 push_back(s) 相同；歧义场景写 push_back 更清晰。
- 拷贝赋值忘处理自赋值：先 delete 再 memcpy 的顺序会自毁；copy-and-swap 免疫。
- 对平凡类型疯狂 move：无收益无伤害，但代码噪音；move 只在资源型类型上有意义。

## 8. 小结

- 值类别区分「有名字的左值」与「临时的右值」；右值「即将销毁」的属性是移动合法性的来源。
- std::move 是值类别转换不是移动操作；移动 = 转移资源所有权 + 原对象置空；moved-from 状态规约为「有效但未指定，只可析构可赋值」。
- 自动移动的触发：临时实参、容器扩容（noexcept 前提）、按值返回（多数被 RVO 直接消除）。
- RVO/NRVO 让按值返回零拷贝：`return std::move(local)` 是反优化；「返回大对象怕拷贝」已成历史。
- 完美转发 = 万能引用 + std::forward，让包装函数保持实参的值类别；emplace 系列借转发实现就地构造。
- noexcept 参与库的行为决策：移动三件套不 noexcept，vector 扩容退化为深拷贝——一行标注决定 O(n) 的拷贝成本。

## 9. 练习

**1.** 用 Compiler Explorer 对比 `std::string b = a;`（左值）与 `std::string c = std::move(a);`（右值）生成的调用，指出一个调用了拷贝构造、一个调用了移动构造的证据。

> [!TIP]
> 思路汇编里分别看到 `std::string::string(const std::string&)` 与 `std::string::string(std::string&&)` 的调用（libstdc++ 下展开为 memcpy vs 三条指针搬运）。这就是「std::move 不移动，构造函数的选择才是移动」的机器级证据。

**2.** 写一个带计数的类（构造/拷贝/移动/析构各打印一行），用它做 `std::vector` 的 push_back 与 emplace_back 实验，统计两种方式的总构造次数，并解释emplace 省了什么。

> [!TIP]
> 思路`v.push_back(Text(100,'x'))`：临时构造 1 + 移动 1 + 扩容迁移 N；`v.emplace_back(100,'x')`：就地构造 1 + 迁移 N。emplace 消除的是「临时对象构造 + 移动」整条链。扩容迁移次数由容量策略决定（第 8 篇）。

**3.** 实现 copy-and-swap 赋值运算符，论证它为什么同时提供强异常保证与自赋值安全，并说明「传值参数」版本的额外收益。

> [!TIP]
> 思路`Text& operator=(Text other) { swap(*this, other); return *this; }`：实参拷贝发生在进入函数前（可能抛异常，但不影响 *this）；swap noexcept；自赋值时拷贝了自己再换回来，无害。传值版本让拷贝优化器可见（还能吃移动）。代价：总是多一次构造。

**4.** 写一个 `Buffer` 类带 `noexcept` 移动与一个不带的 `BadBuffer`，各放 1000 个进 vector 触发扩容，用第 2 题的计数类测量拷贝/移动次数差异。

> [!TIP]
> 思路noexcept 版扩容全是移动（1000 次移动构造）；无 noexcept 版全是拷贝（1000 次深拷贝 + 析构旧对象）。计数输出直观展示「一行标注的 O(n) 差距」——vector 用 is_nothrow_move_constructible 查询决定策略。

**5.** 解释为什么 `std::string s = std::string("a") + std::string("b");` 不需要（也不应该）写 std::move——从 RVO 与右值链的角度分析。

> [!TIP]
> 思路`operator+` 的返回值本身是右值（临时对象），初始化 s 时自动走移动/或直接在 s 的存储上构造；再套 std::move 属于对右值 move（多余）。规则：move 只用于「具名、之后不再用」的对象；右值链上每一环已经是右值。

**6.** 设计一个「移动后必须显式 reset 才能用」的类（更严格的 moved-from 规约），说明这个设计对调试的帮助与代价。

> [!TIP]
> 思路移动构造把资源偷走后，原对象置为「毒化状态」（如 data_=nullptr 且毒标记置位），除 reset/析构/赋值外所有方法 assert(!poisoned)。帮助：误用 moved-from 对象当场断言而不是未指定行为。代价：每个成员函数多一次检查（debug 下可接受，release 可用 NDEBUG 去掉）。这是把「未指定状态」显式化的工程化方案。
