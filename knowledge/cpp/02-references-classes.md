---
title: 引用与类基础
order: 2
tags: 核心, 引用, class
summary: 引用是变量的别名、class 与封装、构造/析构函数的调用时机。
---

C 里想「用另一个名字摸到同一个变量」只能靠指针，而指针可以为空、可以乱指、要解引用。C++ 的引用把语义收紧：它是变量的**别名**，出生就必须绑定，终身不改嫁。类则把数据和操作它的函数捆在一起，用访问控制划定边界——两者合起来，是后面所有章节的地基。

## 引用：必须初始化的别名

```cpp
int x = 42;
int& r = x;        // r 是 x 的别名，不是拷贝
r = 100;           // 改的就是 x 本体
```

三条铁律，全部来自「别名」这个本质：

- **必须初始化**：别名总得是「谁」的别名
- **不能重新绑定**：`r = y` 是把 y 的值赋给 x，不是让 r 改指 y
- **没有空引用**：合法程序里引用必然指向有效对象——这正是它比指针安全的原因

```cpp
int y = 7;
r = y;             // 语义是 x = y，r 从此仍是 x 的别名
int& r2 = r;       // r2 还是 x 的别名（不存在「引用的引用」）
```

和 C 指针对比一下函数出参的写法：

```cpp
void swap(int& a, int& b) {     // C 里要写 void swap(int *a, int *b)，调用处还得 &x
    int t = a; a = b; b = t;
}
swap(x, y);                     // 调用点和传值一模一样，但改的是本体
```

> [!NOTE]
> 底层实现上引用通常就是一个指针，但语义完全不同：指针是独立对象、有自己的地址；引用没有「引用自己的地址」这回事。选型判断：可能为空、需要中途重指、要做指针运算 → 用指针；其余一律引用。

## const 引用：只读加免拷贝

```cpp
void print(const std::string& s);   // 大对象：不拷贝，也不许改
void print(std::string s);          // 值传递：多一次拷贝，通常没必要
```

`const T&` 是参数传递的默认选择。它还有一个特权：**能绑定临时对象**：

```cpp
void edit(std::string& s);
edit(std::string("tmp"));   // ❌ 非 const 引用不能绑临时值
// const std::string& 版本可以：临时对象活到本次调用结束
```

规则很好记：`T&` 表达「我要改它」，临时对象改了也没人看得到，所以语言直接禁止绑定。

## class：封装与访问控制

```cpp
class Article {
public:                          // 对外接口
    explicit Article(std::string title) : title_(std::move(title)) {}
    const std::string& title() const { return title_; }   // 尾部 const：承诺不改成员

private:                         // 内部实现
    std::string title_;
    bool published_ = false;     // 类内默认初始化（C++11）
};
```

- `public` / `private` / `protected` 三档访问控制，**默认 private**；`struct` 与 `class` 的唯一区别是 `struct` 默认 public
- 成员函数有个隐藏参数 `this`（类型 `Article*`），函数体里写 `title_` 实际是 `this->title_`
- 签名末尾的 `const` 修饰「this 指向的对象」：const 对象只能调 const 成员函数。C 里「这个函数会不会改结构体」靠注释约定，C++ 编译器替你查

## 构造函数：对象的出生

构造函数与类同名、无返回值、可重载，对象创建时自动执行：

```cpp
class Buffer {
public:
    Buffer() : Buffer(64) {}                  // 委托构造：复用另一个构造函数
    explicit Buffer(size_t n) : size_(n), data_(new char[n]) {}   // 成员初始化列表
    ~Buffer() { delete[] data_; }             // 析构函数，下一节讲

private:
    size_t size_;
    char* data_;
};
```

冒号后的成员初始化列表是唯一能初始化 const 成员和引用成员的方式，且通常比「先默认构造再赋值」少一步。注意：**初始化按成员声明顺序执行**，与列表里的书写顺序无关，列表顺序不一致会被编译器警告。

`explicit` 禁止隐式转换：没有它，`Buffer b = 64;` 这种莫名其妙的多参数转单参写法也能编译通过。

## 析构函数：对象的一生终点

析构函数 `~类名()` 在对象死亡时自动调用，**永远不会被忘记**：

```cpp
void demo() {
    Buffer b(128);          // 构造：new char[128]
}                           // 离开作用域，析构自动执行：delete[] data_
```

调用时机值得背下来：

| 场景 | 析构时机 |
| --- | --- |
| 栈上局部对象 | 离开作用域，按构造的**逆序**析构 |
| 堆上对象（new） | `delete` 执行时 |
| 临时对象 | 所在完整表达式结束时 |
| 全局/静态对象 | `main` 结束之后 |

> [!WARNING]
> 上面这个 Buffer 已经踩在雷上：自己管着堆内存，却没写拷贝构造——两个 Buffer 拷贝后共享同一块 `data_`，析构两次，程序崩溃。这正是下一章[拷贝控制与移动语义](04-copy-move.md)要解决的头号问题。

## 对象生灭现场

```cpp
#include <iostream>

struct Tracer {
    const char* name;
    explicit Tracer(const char* n) : name(n) { std::cout << name << " 构造\n"; }
    ~Tracer() { std::cout << name << " 析构\n"; }
};

int main() {
    Tracer a("a");
    {
        Tracer b("b");
        Tracer c("c");
    }                        // 先析构 c，再析构 b（逆序）
    std::cout << "main 继续\n";
}
// 输出：a 构造 / b 构造 / c 构造 / c 析构 / b 析构 / main 继续 / a 析构
```

这个逆序规则是 RAII 的地基：后借的锁先还、后开的文件先关，依赖关系天然正确。下一章[RAII 与资源管理](03-raii.md)就靠它吃饭。

> [!TIP]
> 引用成员和 const 成员都必须在初始化列表里给值，这是强制。反过来也提醒你：包含引用成员的类连默认构造都不会自动生成——设计接口时想清楚要不要让类持有引用。

## 练习

- [ ] 验证 `struct Point { int x, y; };` 能用 `Point p{1, 2};` 聚合初始化，再改成 class 加构造函数实现同样效果
- [ ] 写一个 `Counter` 类，构造时 `++n`、析构时 `--n`，用静态成员统计当前存活对象数
- [ ] 实测：`void f(int& x)` 传字面量 `f(1)` 看报错，改成 `const int&` 再试

相关阅读：[RAII 与资源管理](03-raii.md)
