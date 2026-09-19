---
title: 继承与多态：vtable 的机制与克制
order: 10
tags: 虚函数, vtable, override, 抽象类, 组合优先
summary: 虚函数的 vtable 机制与内存布局、override/final 与虚函数四大陷阱（默认参数静态绑定、构造中调虚函数、名字隐藏、非虚析构）、多重继承与虚继承的成本、组合优先原则与类型擦除替代方案。
---

继承在 C++ 里承担两种完全不同的职责：**接口多态**（「任何 Shape 都能 draw」——运行时按实际类型分派行为）与**实现复用**（「Bird 复用 Animal 的 eat 代码」）。前者是多态的地基，后者常常是设计事故的起点。「组合优先于继承」这句军规针对的正是后者——本篇把虚函数的机制（vtable）讲透，再讲透什么时候才真正需要继承。

## 1. 继承基础与构造顺序

```cpp
class Animal {
public:
    explicit Animal(std::string name) : name_(std::move(name)) {}
    void eat() { std::cout << name_ << " eats\n"; }        // 非虚：实现复用
protected:                                                  // 派生类可见、外部不可见
    std::string name_;
};

class Dog : public Animal {
public:
    explicit Dog(std::string name) : Animal(std::move(name)) {}   // 必须先构造基类
    void bark() { std::cout << name_ << ": woof\n"; }      // 可用 protected 成员
};
```

- 构造顺序：**基类 → 成员（按声明序）→ 派生构造体**；析构严格逆序。派生类构造函数**必须**在初始化列表里喂基类构造。
- `public` 继承表达「is-a」；`private/protected` 继承是「按实现继承」（极少见，通常组合替代）。
- **名字隐藏**：派生类的同名函数会隐藏基类的**全部同名重载**（不看参数）：

```cpp
class Base { public: void f(int); void f(double); };
class Derived : public Base { public: void f(int); };

Derived d;
d.f(1.5);        // ❌ 编译错误：f(double) 被 Derived::f(int) 隐藏（不看参数匹配）
// 修法：Derived 里写 using Base::f;   —— 把基类重载引入
```

## 2. 虚函数：运行时多态的机制

### 2.1 vtable 机制

```cpp
class Shape {
public:
    virtual double area() const = 0;               // 纯虚：Shape 是抽象类，不能实例化
    virtual ~Shape() = default;                    // 多态基类：虚析构（第 3 篇立过的规矩）
};

class Circle : public Shape {
public:
    explicit Circle(double r) : r_(r) {}
    double area() const override { return 3.14159265358979 * r_ * r_; }
private:
    double r_;
};

class Rect : public Shape {
public:
    Rect(double w, double h) : w_(w), h_(h) {}
    double area() const override { return w_ * h_; }
private:
    double w_, h_;
};
```

虚调用的运行时机制（单继承、典型实现）：

```text
对象内存布局：
Circle 对象:  [ vptr ──→ vtable: [ &Circle::area ][ &Circle::~Circle ] ]
              [ r_ (double) ]                          ↑
虚调用 area() 的机器形态：                                │
  mov vptr ← [obj]          ; 取对象的虚表指针
  call [vptr + offset]      ; 虚表里按槽位间接调用 —— 就是一次函数指针调用！

Shape *s = new Circle(2);
s->area();        // 编译器不知道 s 指向什么；运行时查 vtable → Circle::area
```

三个工程推论：

1. **每个有虚函数的类一张虚表（类级共享），每个对象一个 vptr**（8 字节）——虚函数的内存成本。
2. **虚调用 = 一次间接寻址**，与手写函数指针（[C 篇第 9 篇](../c/09-function-pointers.md)）同价——零开销抽象的又一次兑现；代价是阻断内联（热点小函数慎虚）。
3. **虚析构是多态基类的硬性要求**：`delete shape_ptr` 时必须沿虚表找到派生类析构，否则派生部分泄漏。

### 2.2 override 与 final：让编译器接管一致性

```cpp
class Circle : public Shape {
public:
    double area() const override;         // override：拼写/签名/const 错一个就编译报错
};

class Fixed final : public Shape { ... };   // final 类：禁止再继承
double area() const final override;         // final 函数：禁止再重写（允许优化器去虚化）
```

不写 override 时，`double area()` 若签名不匹配（少 const、参数不同）会变成**新函数**——基类接口悄悄没实现，直到运行时发现调用走了错误分支。规约：**重写一律写 override**；确认「这是继承体系的叶子」才用 final（附带去虚化优化机会）。

## 3. 虚函数的四大经典陷阱

### 3.1 默认参数静态绑定

```cpp
class Base { public: virtual void draw(int depth = 1); };
class Derived : public Base { public: void draw(int depth = 5) override; };

Base *p = new Derived;
p->draw();       // 默认参数取 Base 的 1！默认参数按「静态类型」绑定，函数体按「动态类型」
```

默认参数在编译期按指针的**声明类型**填入，虚函数体却在运行时按**实际类型**分派——两者撕裂。规约：**虚函数不用默认参数**（需要时提供非虚的包装函数）。

### 3.2 构造/析构中调用虚函数

```cpp
class Base {
public:
    Base() { init(); }                 // ❌ 想调用派生类的 init
    virtual void init();
};
class Derived : public Base {
public:
    void init() override;              // 不会被调用！
};
```

构造 Base 时 Derived 部分**尚未诞生**，虚表还是 Base 的——`init()` 解析到 Base 版本。派生类的虚函数在基类构造期间「不存在」。规约：**构造/析构函数里不调用虚函数**；需要「构造后初始化」用工厂函数或两段式构造的显式 `init()`（由外部调用）。

### 3.3 非虚析构的两种正确写法

```cpp
// 写法①：public virtual —— 标准答案
class Base { public: virtual ~Base() = default; };

// 写法②：protected 非虚 —— 不通过基类指针删除的设计（禁止 delete base_ptr）
class Base { protected: ~Base() = default; };
// 想写 delete base_ptr 时直接编译错误 —— 把「不该做的事」挡在编译期
```

不打算多态删除的基类用写法②：零虚表成本、误用编译期报错。打算 `delete Base*` 的用写法①。

### 3.4 切片（slicing）：值语义对多态的绞杀

```cpp
void register_shape(Shape s);          // ❌ 按值传多态类型
Circle c(2);
register_shape(c);                     // 只拷贝出 Shape 部分！vptr 被剥掉，area 变成……编不过或纯虚调用崩溃

// ✅ 多态对象永远经引用/指针流动
void register_shape(const Shape &s);
std::vector<std::unique_ptr<Shape>> shapes;    // 容器存指针（多态集合的标准形态）
```

按值传递/存储派生类对象会「切掉」派生部分。规则：**多态类型不按值传递、不按值存储**；容器用 `unique_ptr<Base>`。

## 4. 多重继承与虚继承

```cpp
class Camera { ... };
class Mic { ... };
class Phone : public Camera, public Mic { ... };    // 多重继承：两个基类都是「mixin」性质
```

多重继承在「无公共祖先、各基类职责独立」（mixin 风格）时可用，但**菱形继承**（D→B、D→C、B/C→A）会造成 A 的两份副本：

```text
    A
   / \
  B   C          D 对象里有两份 A：字段重复、二义性
   \ /
    D
// 解法：class B : virtual public A —— 虚继承让 A 只存一份
// 代价：虚基类指针、构造顺序特殊（最派生类直接负责虚基类构造）、布局复杂
```

工程立场：**多重继承默认回避**。需要多接口时用纯虚接口类的多继承（只有虚表没有数据，无菱形数据问题）；需要能力组合时优先组合/模板 mixin（CRTP，见第 6 节）。

## 5. RTTI：dynamic_cast 与设计气味

```cpp
Shape *s = ...;
if (auto *c = dynamic_cast<Circle *>(s)) {          // 运行时类型检查：失败得 nullptr
    // 用 Circle 特有的接口
}
```

`dynamic_cast` 靠 RTTI（运行时类型信息，虚表的附属）做安全下行转换；`typeid` 取实际类型。两者真实成本不高，但**大量 dynamic_cast 是设计气味**：说明代码在「外部判断类型再分派」，而这件事本该由虚函数/访问者模式在体系内完成。规约：dynamic_cast 允许出现在「边界处的一次性适配」，不允许成为主控制流。

## 6. 组合优先：继承的替代品

### 6.1 决策原则

```text
需要「不同实现替换」+「通过统一接口在运行时切换」？
├── 是 → 接口多态（虚函数/纯虚接口）——继承的正当场景
└── 否，只是想复用代码 → 组合（成员对象）或自由函数
```

「is-a」检验：Dog **是** Animal（语义成立）；`Vector` **是** `std::vector` 吗？不——它**含有**一个 vector（组合）。把实现复用写成 public 继承的代价：耦合死（基类改动波及全部派生类）、切片风险、虚表开销。

### 6.2 类型擦除：无继承的多态

C++ 里还有一条不建继承体系的多态路线——**类型擦除**：

```cpp
#include <functional>

// std::function：任何「可调用」都装进来，鸭子类型的多态
std::vector<std::function<double(const Point&)>> metrics;
metrics.push_back([](const Point &p) { return p.x * p.y; });
struct Dist { double operator()(const Point &p) const { return std::hypot(p.x, p.y); } };
metrics.push_back(Dist{});                     // 没有任何继承关系，照样多态

// std::variant + visit：封闭集合的多态（编译期已知全部类型）
std::variant<Circle, Rect> shape = Circle{2};
std::visit([](auto &s) { fmt::print("area = {}\n", area_of(s)); }, shape);
```

类型擦除的取舍：`std::function` 有堆分配与间接调用（比虚调用略贵或相当）；`std::variant` 是**封闭集合**（新增类型要改 variant 定义，但编译器替你查全 exhaustive）——「开放集合用继承，封闭集合用 variant」是现代 C++ 的分界线（[第 12 篇](12-modern-features.md)展开 variant）。

### 6.3 CRTP 一瞥：编译期多态

```cpp
template <typename Derived>
class Comparable {
public:
    bool operator!=(const Derived &o) const {
        return !static_cast<const Derived *>(this)->operator==(o);   // 复用 == 实现 !=
    }
};

class Version : public Comparable<Version> {
public:
    bool operator==(const Version &o) const { return major_ == o.major_; }
};
```

CRTP（奇异递归模板）把「实现复用的继承」搬进编译期：无虚表、无间接调用、可内联——性能敏感的「继承」场景（数学库、表达式模板）用它替代运行时多态。

## 7. 陷阱清单

- 多态基类析构非虚：派生部分泄漏；public virtual 或 protected 非虚二选一。
- 重写不写 override：签名漂移变成新函数，接口悄悄失效。
- 虚函数带默认参数：静态绑定撕裂；默认参数放非虚包装。
- 构造/析构里调虚函数：派生部分未诞生/已死亡，解析到基类版本。
- 多态对象按值传/存：切片；引用或 unique_ptr<Base> 集合。
- 派生类同名函数隐藏基类重载：using Base::f 引入。
- 菱形继承不上虚继承：双份基类；优先避免多重继承。
- 主控制流里 dynamic_cast：类型判断外溢；虚函数或访问者收编。
- 为「代码复用」上 public 继承：组合即可；继承留给「接口多态」。
- 热点小函数虚化：内联被阻断；先测后虚，或 CRTP。

## 8. 小结

- 继承的两种职责要分开：接口多态（虚函数，正当）与实现复用（组合/CRTP 替代）；构造基类→成员→派生体，析构逆序；派生同名函数隐藏基类全部重载（using 引入）。
- vtable 机制：类一张虚表、对象一个 vptr，虚调用 = 按槽位的间接调用——与函数指针同价的零开销抽象，代价是阻断内联。
- 四大陷阱：默认参数静态绑定、构造/析构中调虚函数、非虚析构、切片。override/final 让编译器把守一致性。
- 多重继承限「无数据菱形」的接口组合；虚继承是数据菱形的最后手段，成本高。
- dynamic_cast 频繁出现即设计气味；类型擦除（function/variant）提供无继承的多态——开放集合继承、封闭集合 variant。
- 组合优先不是「禁止继承」，是「复用别用继承」：虚函数留给「运行时按实际类型分派行为」这一件事。

## 9. 练习

**1.** 在 Compiler Explorer 上对比虚函数调用与函数指针调用的汇编，验证「虚调用 = 查表间接调用」；再解释为什么循环内的虚调用比外提后的直接调用慢。

> [!TIP]
> 思路两者都是 `call [寄存器]` 形态；差异在内联与预测：虚调用的目标随对象类型变化，热点循环里若类型多样则分支预测失败 + 无法展开。优化器在能证明实际类型时做去虚化（devirtualization），final 有助于此。

**2.** 实现图形系统：抽象类 Shape（area/perimeter/虚拟析构）+ Circle/Rect/Triangle，用 `vector<unique_ptr<Shape>>` 集合遍历输出总面积。故意写一个漏 override 的派生类观察编译器行为。

> [!TIP]
> 思路漏 override 时（如写成 `double Area()`）编译器不报错（它只是个新函数），运行时该形状走不到自己的实现——这正是 override 关键字的价值：把「实现接口」变成编译期契约。修复加 override 后签名错误当场报错。

**3.** 把第 6.2 节的 metrics 例子改造成 `std::variant` 版本（三种 metric 类型封闭集合），对比两种方案的错误处理（新增 metric 类型时谁会报错）。

> [!TIP]
> 思路function 版新增类型零改动（开放集合，灵活性即风险：类型不对运行期才发现）；variant 版新增类型后所有 visit 报编译错（exhaustive check 强制处理）——封闭集合的「改动波及面」被编译器管住。选择标准：集合会不会增长、由谁增长。

**4.** 用 CRTP 实现一个「编译期计数 mixin」（每个派生类型独立的实例计数器），对比运行时虚函数版本的实现差异与开销。

> [!TIP]
> 思路`template<typename D> struct Counted { static inline int count = 0; Counted(){++count;} ~Counted(){--count;} };` 每个 D 一份静态计数（模板按类型实例化）。运行时版本需要虚函数返回类型名 + 全局 map。CRTP 版零开销、类型安全；代价是错误信息与学习曲线。

**5.** 审查下面的设计并重构：`class StringUtils : public std::string { ... 工具函数 ... }`。

> [!TIP]
> 思路三个问题：非多态基类被继承（无虚析构 + is-a 不成立——「字符串工具」不是字符串）；实现复用误用继承；切片风险。重构：自由函数集（`namespace strutil { size_t count(...); }`）或独立类组合一个 string。这是「组合优先」最有代表性的教科书案例。

**6.** 讨论题：一个插件系统要求「宿主与插件二进制分离编译」，虚函数接口 vs std::function 接口 vs C 风格函数表接口，三者的 ABI 稳定性如何排序？为什么虚函数接口在跨编译器边界要谨慎？

> [!TIP]
> 思路C 函数表最稳（C ABI 有标准）；std::function 依赖标准库实现细节（跨编译器不保证）；虚函数布局（vtable 槽序、this 调整）在主流平台有事实约定但非标准——同编译器家族可用，跨编译器（MSVC↔GCC）有风险。跨二进制边界的接口设计是「ABI 设计」：少类型、显式版本号、C 风格最稳。
