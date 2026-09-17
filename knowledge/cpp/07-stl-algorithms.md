---
title: STL 算法与 lambda
order: 7
tags: 核心, algorithm, lambda
summary: 算法+迭代器的组合思维、lambda 捕获、结构化绑定与范围 for。
---

STL 的设计精髓是正交分解：容器管存储，算法管计算，迭代器是中间的胶水。`std::sort` 不认识 vector，只认识迭代器——于是它能排序任何暴露了区间的东西。配上 lambda 就地定义谓词，手写 for 循环的场景大半可以消灭，且消灭之后代码更短、意图更清楚。

## 算法 + 迭代器：一对 [first, last)

所有算法都吃一对迭代器，表示左闭右开区间：

```cpp
#include <algorithm>
#include <numeric>

std::vector<int> v{5, 3, 1, 4, 2};

std::sort(v.begin(), v.end());                      // 排整个 vector
std::sort(v.begin(), v.begin() + 3);                // 只排前 3 个
int sum = std::accumulate(v.begin(), v.end(), 0);   // 求和，初值 0
auto it = std::find(v.begin(), v.end(), 4);         // 找到返回迭代器，找不到返回 end()
bool pos = std::all_of(v.begin(), v.end(), [](int x){ return x > 0; });
```

区间是迭代器对，意味着算法对容器类型无感：`std::find` 同样能搜数组、list、甚至裸指针区间。这就是 C 的 `qsort`/`memmove` 思路的类型安全加强版——比较函数内联展开，还不用 `void*`。

## lambda：就地定义的匿名函数

```cpp
auto is_even = [](int x) { return x % 2 == 0; };   // 无捕获，纯函数

int threshold = 3;
auto above = [threshold](int x) { return x > threshold; };   // 按值捕获：拷贝一份
auto bump  = [&threshold]() { threshold += 10; };            // 按引用捕获：改本体

std::count_if(v.begin(), v.end(), above);
```

捕获列表是 lambda 的核心语义：

| 写法 | 含义 |
| --- | --- |
| `[]` | 不捕获 |
| `[x]` / `[&x]` | 按值 / 按引用捕获 x |
| `[=]` / `[&]` | 全部按值 / 按引用（隐式，慎用） |
| `[x = expr]` | 初始化捕获（C++14），可用于移动捕获 |

按值捕获默认不可修改，想改拷贝要加 `mutable`。纪律是**显式列出捕获的名字**：`[=]`/`[&]` 图省事，却让「这个 lambda 到底摸了哪些变量」变成考古题。

> [!WARNING]
> 按引用捕获的 lambda 在被引对象死亡后悬空——异步回调、定时器、跨线程提交任务里尤其高发。凡是 lambda 的生命周期**可能超过**当前函数的（存进队列、交给线程池），一律按值捕获或捕获智能指针。

```cpp
using Task = std::function<void()>;
void post_task(Task t);              // 假设：任务排队后异步执行

void schedule() {
    int attempts = 0;
    post_task([&]{ ++attempts; });   // ❌ schedule 返回后 attempts 悬空
}                                    // 任务真正执行时，读到的是已销毁的栈内存

void schedule_safe() {
    int attempts = 0;
    post_task([attempts]{ use(attempts); });   // ✅ 按值捕获，拷贝随 lambda 存活
}
```

另一种修法是捕获智能指针（shared_ptr 按值），让对象活到任务跑完为止。

## 结构化绑定与范围 for

C++17 的结构化绑定把「解包」写进了语言：

```cpp
#include <map>
#include <string>

std::map<std::string, int> ages{{"alice", 30}, {"bob", 25}};

for (const auto& [name, age] : ages)          // 直接解包 pair
    std::cout << name << ": " << age << "\n";

auto [it, ok] = ages.insert({"carol", 28});   // insert 返回 pair，直接解
if (ok) { /* 插入成功 */ }

struct Point { int x, y; };
Point p{1, 2};
auto [x, y] = p;                              // 结构体成员也能绑定
```

范围 for 本质是 `begin()`/`end()` 的语法糖。想修改元素，记得 `auto&`：

```cpp
for (auto& x : v) x *= 2;     // ✅ 原地修改
for (auto x : v) x *= 2;      // ❌ 改的是拷贝，编译器不报错
```

## 常用算法速查

| 算法 | 用途 | 复杂度 |
| --- | --- | --- |
| `sort` / `stable_sort` | 排序（后者保序稳定） | O(n log n) |
| `find` / `find_if` | 线性查找 | O(n) |
| `count` / `count_if` | 计数 | O(n) |
| `accumulate` | 折叠求和/累积 | O(n) |
| `transform` | 逐元素变换 | O(n) |
| `remove_if` + `erase` | 条件删除 | O(n) |
| `max_element` / `min_element` | 极值 | O(n) |
| `lower_bound` | 有序区间二分查找 | O(log n) |

`remove_if` 不真的删除——它无法改容器大小，只把该留的元素前移、返回新逻辑终点，必须配 `erase`：

```cpp
v.erase(std::remove_if(v.begin(), v.end(),
                       [](int x){ return x < 0; }),
        v.end());        // remove-erase 惯用法
```

> [!TIP]
> 见到手写 for 循环先问一句：这属于哪类模式（过滤、累积、查找、变换）？十有八九标准算法的名字就叫这个。算法名即意图——`count_if` 一眼可读，手写的计数循环得逐行读。

> [!NOTE]
> 本篇全是「迭代器对」的老范式；C++20 的 ranges 库把 `sort(v)`、`filter | transform` 管道化，是同一套思想的长相升级。C++17 时代先把迭代器思维打牢，ranges 只是换了层皮。

## 练习

- [ ] 用 sort + lambda 给 `vector<pair<int, std::string>>` 按「分数降序、同分按名字升序」排序
- [ ] 写一个按引用捕获局部变量的 lambda 存进函数外的 `std::function`，调用时观察悬空，再改成按值捕获修复
- [ ] 用结构化绑定遍历 unordered_map 统计词频，配合 partial_sort 输出 top 3

相关阅读：[STL 容器](06-stl-containers.md)
