---
title: 类与对象模型：不变量是类的灵魂
order: 3
tags: 构造函数, 析构函数, 特殊成员函数, Rule of Zero, 初始化列表
summary: 类的本质是不变量——构造建立它、析构维护它；构造函数家族与成员初始化列表的必要性与顺序陷阱、析构顺序、Rule of Zero/Three/Five 的完整决策树，以及值类型与实体类型的设计分野。
---

把「类」理解为「数据 + 方法」错过了 C++ 类设计的核心。类的本质是**不变量（invariant）**：一组「对象在任何公开方法执行前后都必须成立的性质」。构造函数的工作是**建立**不变量；析构函数的工作是**维护**它到最后一刻；每个成员函数的工作是**保持**它。`std::vector` 的不变量是「size ≤ capacity 且 data 指向连续有效存储」——你永远见不到一个违反不变量的 vector，这就是封装的意义。

围绕不变量，C++ 给类配了一整套**自动机制**：六个特殊成员函数（构造、析构、拷贝构造/赋值、移动构造/赋值）在你不写时由编译器按规则生成。理解「编译器什么时候帮你生成、生成什么、什么时候拒绝生成」是类设计的基本功。

## 1. 类的基本形制

```cpp
class Stack {
public:                                   // 接口：调用方可见的能力面
    explicit Stack(size_t cap);           // 构造
    ~Stack();                             // 析构
    void   push(int v);
    int    pop();
    bool   empty() const;                 // const 成员函数：不修改对象
    size_t size() const { return n_; }    // 简短函数可内联定义

private:                                  // 实现：只有成员函数看得见
    std::vector<int> data_;
    size_t n_ = 0;                        // 类内默认初始化器（C++11）
};
```

- `class` 与 `struct` 唯一区别是**默认访问权限**（private vs public）。惯例：有不变量要维护、有封装意图 → `class`；纯数据聚合（无不变量）→ `struct`。
- 成员函数在类内声明、类外定义（`void Stack::push(int v) { ... }`）是主流风格——头文件里只见接口，实现细节不参与依赖传染。
- `this` 是「当前对象地址」的隐式参数；在 const 成员函数里类型是 `const Stack*`。

## 2. 构造函数：建立不变量的入口

### 2.1 家族全景

```cpp
class Buffer {
public:
    Buffer();                             // 默认构造
    explicit Buffer(size_t size);         // 带参构造
    Buffer(std::initializer_list<int> l); // 列表构造
    Buffer(const Buffer &other);          // 拷贝构造
    Buffer(Buffer &&other) noexcept;      // 移动构造
    // 拷贝/移动赋值见第 5 篇
};
```

### 2.2 explicit：堵住隐式转换

```cpp
class Meter {
public:
    Meter(double m);              // ❌ 没有 explicit
};

void draw(Meter m);
draw(3.5);                        // 隐式把 3.5 转成 Meter——这是想要的吗？
```

单参数构造函数默认允许隐式转换，而「3.5 悄悄变成 Meter」在真实代码里几乎总不是意图。**单参构造函数一律 explicit**，需要转换时写 `Meter(3.5)` 显式表达——这是现代 C++ 的标准纪律。

### 2.3 成员初始化列表：三种「必须」与一个顺序陷阱

```cpp
class Session {
    const int id_;                 // ① const 成员：初始化后不能赋值
    std::string &name_;            // ② 引用成员：必须初始化时绑定
    Logger log_;                   // ③ 无默认构造的成员
public:
    Session(int id, std::string &n)
        : id_(id), name_(n), log_("session")   // 成员初始化列表
    { /* 函数体：此时所有成员已构造完毕 */ }
};
```

在**函数体内赋值**与在**初始化列表里构造**是两件事：函数体执行时成员已经默认构造过一遍（对 string 是空串构造 + 赋值的两次成本；对上面三种成员则直接编译错误）。工程规约：**成员一律走初始化列表**，函数体只放「无法用初始化表达」的逻辑（如校验失败抛异常）。

顺序陷阱：**成员按声明顺序构造，不是按列表书写顺序**：

```cpp
class Bad {
    std::vector<int> data_;
    size_t cap_;                    // 声明在 data_ 之后
public:
    Bad(size_t cap)
        : cap_(cap),                // ← 书写顺序：cap_ 先
          data_(cap_)               // ← 实际构造顺序：data_ 先！此时 cap_ 未初始化
    {}
};
```

防御：**让初始化列表顺序与声明顺序一致**（GCC/Clang 的 `-Wreorder` 会警告），更彻底的做法是避免成员间初始化依赖（cap_ 之类能算出来的不存成员）。

### 2.4 委托构造与默认实参

```cpp
class Point {
    double x_, y_;
public:
    Point(double x, double y) : x_(x), y_(y) {}
    Point() : Point(0, 0) {}              // 委托构造：复用主构造
    explicit Point(double v) : Point(v, v) {}
};
```

多个构造函数共享逻辑时委托给「主构造」，避免复制粘贴初始化代码。

## 3. 析构函数：维护不变量到最后一刻

析构函数在对象死亡时自动执行，**顺序与构造严格相反**（成员逆序 → 本体 → 基类）。这个「逆序」保证依赖关系安全：后构造的可以依赖先构造的，销毁时先死的不会拖累后死的。

什么时候需要**手写析构函数**？答案由第 4 节的规则给出；先记住一个反直觉事实——**绝大多数类不需要手写析构**：

```cpp
class Report {
    std::vector<std::string> pages_;   // vector 自己管理内存
    std::ofstream out_;                // ofstream 自己关闭文件
public:
    // 不需要写析构！成员的析构函数会自动执行
};
```

需要手写析构的信号：类**直接持有裸资源**（`FILE*`、`int fd`、`malloc` 来的指针）。而现代 C++ 的回答通常不是「写析构」，是「换成 RAII 成员」（`unique_ptr<FILE, decltype(&fclose)>`、`unique_fd`）——**析构函数该写的时候已经很少，写的时候一定伴随全套拷贝/移动设计**（下一节）。

## 4. 特殊成员函数：编译器的自动生成规则

### 4.1 六个特殊成员与生成条件

| 成员            | 默认生成条件（简化版）                            |
| --------------- | ------------------------------------------------- |
| 默认构造        | 没写任何构造函数                                   |
| 拷贝构造/赋值   | 没写移动相关成员、没写析构                         |
| 移动构造/赋值   | 没写拷贝/析构/移动，且所有成员可移动                |
| 析构            | 总有（不写就生成 public 非虚的）                    |

规则的内在逻辑一句话：**你接管了一项资源管理，编译器就把全套让给你**（防止「你写的析构 free 了内存，生成的浅拷贝还在拷贝这个指针」的组合灾难）。

### 4.2 Rule of Zero / Three / Five

三个规则是一个决策树：

```text
类直接管理资源（裸指针、句柄）？
├── 否（成员全是值/RAII 对象）
│     → Rule of Zero：五个特殊成员全不写，编译器生成的就是对的 ✅
└── 是
      → Rule of Five：析构、拷贝构造、拷贝赋值、移动构造、移动赋值
        五个全要考虑——写全，或显式 =delete 禁掉不该有的
```

**Rule of Zero 是现代 C++ 的默认答案**：让成员都是 `std::string`、`std::vector`、`unique_ptr` 这类自带资源管理的类型，你的类就自动获得正确的全部五个成员。**Rule of Three/Five 是给「不得不手写资源管理」的场景**（封装 C 库、实现自己的容器）。

```cpp
// Rule of Five 示例：一个管理 FILE* 的最小包装（通常该用 unique_ptr 替代，此处演示机制）
class File {
    FILE *f_ = nullptr;
public:
    explicit File(const char *path) : f_(fopen(path, "rb")) { if (!f_) throw ...; }
    ~File() { if (f_) fclose(f_); }

    File(const File &) = delete;             // 拷贝会导致双 fclose：禁掉
    File &operator=(const File &) = delete;

    File(File &&other) noexcept              // 移动：接管资源，原对象置空
        : f_(std::exchange(other.f_, nullptr)) {}
    File &operator=(File &&other) noexcept {
        if (this != &other) { if (f_) fclose(f_); f_ = std::exchange(other.f_, nullptr); }
        return *this;
    }
};
```

`=delete` 是「这个操作对这个类型无意义」的显式声明——比「不写让它不可用」好（错误信息明确、防止意外生成）。

### 4.3 虚析构：继承体系的前置要求

基类通过基类指针 delete 派生类对象时，若析构非虚，**只执行基类析构**（派生部分泄漏/未销毁）。规则：**多态基类的析构函数必须 virtual**（[第 10 篇](10-inheritance.md)展开）。反过来，不打算做多态基类的类不需要虚析构（虚调用有成本，零开销原则）。

## 5. 对象内存模型

```cpp
struct Empty {};                 // sizeof == 1（不同对象必须有不同地址）
struct Packed { char c; int i; }; // sizeof == 8：与 C 相同的对齐与填充规则
struct WithVtable { virtual void f(); char c; };  // sizeof == 16：8 字节 vptr + 1 + 7 填充
```

- 成员布局与对齐规则沿用 C（[C 篇第 8 篇](../c/08-structs-unions.md)），成员从大到小排的优化原样有效。
- 有虚函数的类多一个**隐藏的虚表指针**（vptr，通常 8 字节），这是多态的运行时成本——零开销抽象的「手写函数指针等价物」。
- 静态成员属于类不属于对象（`sizeof` 不含它）；`static` 成员函数没有 `this`，不能访问非静态成员。

## 6. 类设计规约

1. **先定义不变量再写类**：一句话说不出「这个类保证什么」，它大概率是个普通函数集合的容器，不是类。
2. **成员一律 private**（纯数据聚合 struct 除外）：public 成员等于把不变量的维护权交给所有调用方。
3. **Rule of Zero 默认**：成员用值类型与 RAII 类型；手写五个特殊成员只在封装裸资源时出现。
4. **单参构造 explicit**；能 constexpr 的接口（比较、算术类小类型）constexpr。
5. **值类型 vs 实体类型先想清楚**：值类型（Point、Money）可拷贝可比较、无身份概念；实体类型（连接、文件）不可拷贝、身份即本质（`=delete` 拷贝）。混淆两者是设计事故的常见源头。

## 7. 陷阱清单

- 初始化列表顺序与声明顺序不一致：成员间依赖读到未初始化值；`-Wreorder`。
- 函数体内「赋值」当「初始化」：double 构造成本；const/引用/无默认构造成员直接报错。
- 忘了 explicit 的单参构造：隐式转换到处开花。
- 管理裸资源的类只写了析构：生成的浅拷贝造成 double free；Rule of Five 全套或 =delete。
- 需要 Rule of Five 却写了 Rule of Three：缺移动语义，性能退化为拷贝。
- 多态基类析构非虚：delete 基类指针只析构一半。
- 引用成员/const 成员阻断赋值：设计期就决定「值类型还是实体类型」。
- 空类当容器用不记 1 字节：不同对象必须有不同地址（EBO 技巧可消除，见第 7 篇）。
- static 成员函数里访问非静态成员：没有 this。

## 8. 小结

- 类的本质是不变量：构造建立、成员保持、析构收尾；封装（private 成员）是不变量得以成立的边界。
- 构造函数走成员初始化列表（const/引用/无默认构造成员是硬性要求），顺序跟随声明而非书写；单参构造 explicit；多构造用委托收敛。
- 析构顺序与构造严格相反；需要手写析构的信号是「直接持有裸资源」，而正确回应通常是「换成 RAII 成员」。
- 特殊成员函数的生成规则归一为 Rule of Zero（成员全 RAII → 全自动）/ Rule of Five（手写资源 → 全套写全或显式 delete）；=delete 表达「操作无意义」。
- 对象内存沿用 C 的对齐规则；虚函数类多一个 vptr；虚析构是多态基类的硬性要求。
- 设计前置问题「值类型还是实体类型」决定拷贝语义；说不出不变量的类不值得存在。

## 9. 练习

**1.** 写一个 `Temperature` 类，不变量「摄氏度 ∈ [−273.15, +∞)」：构造与 setter 在违反时抛 `std::invalid_argument`。说明为什么 setter 里检查不够、必须在构造里也检查。

> [!TIP]
> 思路构造是对象进入世界的唯一入口——构造后立即访问（如 `t.celsius()`）时不变量必须已成立，否则「构造成功但对象无效」。检查逻辑收进一个私有 `validate()`，构造与 setter 共用，保证不变量的单一真相源。

**2.** 下面的类违反了哪些规则？逐条指出并重写。

```cpp
class Connection {
public:
    Connection(const char *host) { sock_ = socket_connect(host); }
    ~Connection() { socket_close(sock_); }
    void send(const char *data) { socket_send(sock_, data); }
private:
    int sock_;
};
```

> [!TIP]
> 思路拷贝构造/赋值未处理：编译器生成的浅拷贝会让两个对象共享 sock_ → double close。按 Rule of Five：拷贝 =delete，移动接管 + 置空 + noexcept。或更优：sock_ 包成 RAII 句柄类型（unique_handle），类退化为 Rule of Zero。

**3.** 解释 `std::vector` 为什么「构造后立即有效」：它的不变量是什么？默认构造的空 vector 如何满足它？

> [!TIP]
> 思路不变量：data_ 指向 capacity 个元素的有效存储（可为 nullptr 当 capacity 为 0），size_ ≤ capacity_。空 vector：nullptr + size 0 + capacity 0，不变量成立（「没有分配」是合法状态）。构造建立不变量的范例——调用方无需初始化检查就能用。

**4.** `struct Point { double x, y; }` 与 `class Money { ... 不变量: 非负 ... }` 分别该用什么形态（struct/class）、哪些特殊成员？写出 Money 的完整骨架（Rule of Zero 形态）。

> [!TIP]
> 思路Point：纯值聚合，struct + 全 public 成员 + 聚合初始化，无任何特殊成员。Money：class + private 成员（cents 或 double + 校验）+ const 成员函数 + 值语义默认生成（成员都是值类型 → Rule of Zero 自动正确）。对比展示「聚合与封装」的分界。

**5.** 用 `-Wreorder` 复现初始化顺序 bug：写 cap_/data_ 顺序错误的类，观察运行时 data_ 的 size 是垃圾值，再修复为声明顺序一致。

> [!TIP]
> 思路构造顺序 = 声明顺序：data_(cap_) 在 cap_ 未初始化时执行，读到栈上垃圾。修复：声明顺序改为 cap_ 在前，或消除依赖（data_ 的容量在函数体内 reserve）。这是「声明顺序即构造顺序」的实证。

**6.** 讨论：为什么 `std::string` 的析构函数不是虚的，而 `std::exception` 的是？由此提炼「要不要虚析构」的判断标准。

> [!TIP]
> 思路string 是值类型：通过具体类型使用，不需要多态删除；exception 是多态基类：catch (const std::exception&) 后按基类引用/指针管理，需要虚析构走完整销毁。标准：**「会不会通过基类指针/引用删除」**——多态用途的基类必须虚析构；值类型与非多态类不需要（虚调用有成本）。
