---
title: 继承与多态
order: 9
tags: 核心, 虚函数, 多态
summary: 虚函数与 vtable、纯虚与抽象类、虚析构函数为什么必需。
---

C 里做「运行时多态」要手搓函数指针表：结构体里放一排函数指针，换不同的表就换行为。C++ 把这套手法内置成虚函数：编译器自动生成并维护那张表（vtable），调用点自动查表。理解了 C 版的手搓实现，虚函数就没有任何魔法。

## 从 C 的函数指针表说起

```c
// C 的典型多态：结构体里放函数指针
struct Shape {
    double (*area)(const void *self);    // 每个子类型提供自己的实现
};
```

C++ 的等价物：把 `virtual` 标在函数上，其余全自动：

```cpp
class Shape {
public:
    virtual double area() const = 0;     // 纯虚函数：必须由派生类实现
    virtual ~Shape() = default;          // 多态基类的必需品，后文详述
};

class Circle : public Shape {
public:
    explicit Circle(double r) : r_(r) {}
    double area() const override { return 3.14159 * r_ * r_; }   // override 显式标注
private:
    double r_;
};
```

## vtable：多态的运行时机制

带虚函数的类，编译器为每个**类**生成一张虚函数表，每个**对象**里藏一个指针（vptr）指向它：

```text
Circle 对象                  Circle 的 vtable
+----------------+          +--------------------+
| vptr ---------|---------> | &Circle::area      |
| r_            |           | &Circle::~Circle   |
+----------------+          +--------------------+
```

```cpp
void print_area(const Shape& s) {   // 通过基类引用或指针调用
    s.area();   // 编译期不知道 s 是谁 → 运行时查 vptr → vtable → 调用
}
```

这就是动态分发：一次额外的指针间接寻址，通常阻止内联。Rust 的 `dyn Trait` 底层是同样的宽指针加虚表结构，成本模型一致。对比模板的静态分发（零开销、代码膨胀），选型依据是「类型在编译期还是运行时才知道」。

> [!NOTE]
> `override` 关键字请永远写上：手打 `area()` 时拼错名字、漏写 const，没有 override 编译器会认为你在定义一个**新的**虚函数，多态静默失效；有 override 则直接报错。`final` 同理，可禁止后续重写。

## 纯虚函数与抽象类

`area() const = 0` 里的 `= 0` 让 Shape 成为**抽象类**：不能实例化，只能做基类；派生类必须实现所有纯虚函数，否则自己也是抽象的。这是 C++ 表达「接口」的方式：

```cpp
class Storage {
public:
    virtual bool save(const std::string& key, const std::string& body) = 0;
    virtual std::string load(const std::string& key) = 0;
    virtual ~Storage() = default;
};
// 实现可以换成磁盘、内存、网络——调用方只认 Storage 接口
```

纯虚函数也可以有函数体，但定义要放在类外（`void Storage::f() { ... }`），派生类通过 `Base::f()` 显式调用，用于提供公共逻辑；多数接口保持纯净即可。

> [!NOTE]
> 在基类构造/析构函数里调用虚函数，分发到的**永远是当前层的版本**——派生类部分还没构造（或已析构），vptr 指向基类的表。别指望基类构造函数里能调到派生类的 override，这是虚函数机制最容易误判的地方。

## 虚析构函数：删错指针就是未定义行为

通过基类指针 delete 派生类对象时，如果析构函数不是虚的，行为**未定义**——典型后果是只执行基类析构，派生类那部分的资源泄漏：

```cpp
struct Base { ~Base() { puts("base dtor"); } };            // ❌ 非虚析构
struct Derived : Base { std::vector<int> data{100000}; };

Base* p = new Derived();
delete p;       // ❌ UB！大概率只调用 ~Base，Derived 的 vector 泄漏

struct Base2 { virtual ~Base2() = default; };              // ✅ 虚析构
// delete 指向 Derived 的 Base2*：先 ~Derived 再 ~Base，完整释放
```

规则死记：**类只要有虚函数（打算被继承并多态使用），析构函数就该是虚的**。反过来，不做基类的具体值类型（string、Point 这类）不加虚函数，避免背上 vptr 的体积开销——两者互为镜像。

> [!WARNING]
> 另一个经典坑是**对象切片**：`Shape s = circle;` 按值接收派生类，只会拷贝基类子对象，Circle 的成员和虚表全被切掉，多态静默失效。多态只能通过基类引用或指针发生；容器里放多态对象请用 `std::unique_ptr<Shape>`。

## 组合优于继承

继承把基类的实现细节拖进派生类（protected 成员、版本耦合），C++ 又没有 Rust trait 那种灵活的接口组合。经验法则：is-a（圆是形状）才用 public 继承，has-a（车有引擎）用成员组合：

```cpp
class Logger {
public:
    void log(const std::string& msg);
};

class Engine {
    Logger logger_;                    // has-a：成员组合，实现细节不出头文件
public:
    void start() { logger_.log("start"); }
};
```

跨模块表达能力集合时，「抽象基类接口 + unique_ptr 传递」是标准打法——接口类只含虚函数和虚析构，实现细节全部藏在 .cpp 里。

## 练习

- [ ] 给 Shape 加 Rectangle 派生类，用 `std::vector<std::unique_ptr<Shape>>` 收集多个图形，统一 print_area
- [ ] 写非虚析构的基类加带资源的派生类，delete 基类指针，用 `-fsanitize=address` 看泄漏
- [ ] 打印 `sizeof(Circle)` 与 `sizeof(double)`，确认多出的 8 字节正是 vptr
- [ ] 在基类构造函数里调用虚函数并打印，验证它没有分发到派生类版本

相关阅读：[智能指针](08-smart-pointers.md)
