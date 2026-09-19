---
title: STL 算法与 lambda：声明式的循环
order: 9
tags: lambda, sort, find_if, accumulate, ranges, 严格弱序
summary: lambda 的编译器本质与捕获语义（含悬垂场景）、核心算法的实战用法与选择、迭代器适配器、C++20 ranges 的管道与惰性视图、比较器的严格弱序要求，以及「循环该不该写成算法」的判断标准。
---

手写循环是把「做什么」和「怎么做」搅在一起：下标管理、边界判断、临时变量，全都淹没了意图。STL 算法 + lambda 把循环升级成**声明**：「找出所有满足条件的」「按这个规则排序」「把这些归约成一个数」——意图在前，机制隐去。而声明式的额外红利是**可组合**（算法互相拼接）与**可并行**（同一算法换个执行策略就多线程）。

本篇先讲 lambda（算法的燃料），再过一遍核心算法的实战地图，最后用 C++20 ranges 把两者接成现代形态。

## 1. lambda：编译器生成的匿名函数对象

### 1.1 语法全景

```cpp
#include <algorithm>

std::vector<int> v{5, 2, 8, 1, 9};

// 完整形态：[捕获](参数) -> 返回类型 { 函数体 }
auto max_it = std::max_element(v.begin(), v.end());

int threshold = 5;
auto cnt = std::count_if(v.begin(), v.end(),
                         [threshold](int x) { return x > threshold; });
//                          └值捕获      └参数        └函数体（可用 threshold）
```

捕获的三种基本方式与语义：

| 捕获              | 语义                                       | 风险                     |
| ----------------- | ------------------------------------------ | ------------------------ |
| `[x]`             | 按值拷贝（lambda 存一份副本）               | 拷贝成本；看不到外部更新   |
| `[&x]` / `[&]`    | 按引用（lambda 存指针）                     | **悬垂**（见下）          |
| `[=]`             | 按值捕获全部用到的（隐式）                   | 隐式拷贝大对象；纪律上禁用 |
| `[this]` / `[*this]` | 捕获 this 指针 / 对象拷贝                 | this 悬垂（成员函数异步）  |
| `[y = std::move(x)]` | 初始化捕获（C++14）：移动进 lambda         | 移动后原对象 moved-from   |

### 1.2 lambda 的本质：编译器替你写的类

```cpp
int threshold = 5;
auto pred = [threshold](int x) { return x > threshold; };
// 编译器大致生成：
class __lambda {
    int threshold;                       // 捕获 → 成员变量
public:
    __lambda(int t) : threshold(t) {}
    bool operator()(int x) const { return x > threshold; }   // 函数体 → operator()
};
```

这个视角解释了 lambda 的全部行为：**按值捕获 = 拷贝进成员**（默认 const，所以改它要 `mutable`）；**按引用捕获 = 存指针**（悬垂风险与裸指针相同）；无捕获 lambda 可以转成普通函数指针（没有成员可携带）。

```cpp
auto counter = [n = 0]() mutable { return ++n; };   // mutable：允许修改按值捕获
counter(); counter();                                // n = 2：状态存续在 lambda 对象里
```

### 1.3 悬垂捕获：lambda 的头号事故

```cpp
std::function<void()> make_callback() {
    int local = 42;
    return [&local] { return local; };   // ❌ 按引用捕获局部：返回后 local 已死
}
auto cb = make_callback();
cb();                                    // UB：读已销毁的栈变量
```

规则：**lambda 活得比捕获对象久（异步回调、存进容器、跨线程传递），一律按值捕获**（或初始化捕获 move）。按引用捕获只用于「lambda 在同一作用域内立即执行」（算法调用就是典型——同步完成，无风险）。

## 2. 核心算法实战地图

### 2.1 查找与判定（非修改序列）

```cpp
auto it  = std::find(v.begin(), v.end(), 42);              // 值相等
auto it2 = std::find_if(v.begin(), v.end(), pred);         // 谓词——最常用
bool all  = std::all_of(b, e, pred);                       // 全部满足
bool any  = std::any_of(b, e, pred);                       // 至少一个
auto [mn, mx] = std::minmax_element(b, e);                 // 一次拿到最小最大
size_t n   = std::count_if(b, e, pred);                    // 满足条件的个数
bool same  = std::equal(a.begin(), a.end(), b.begin());    // 序列相等
```

查找算法的选择逻辑：**未排序数据 → find/find_if（O(n)）；已排序 → binary_search/lower_bound（O(log n)）**。`lower_bound` 的返回值是「第一个 ≥ 目标的位置」——插入点语义，比 bool 的 binary_search 实用得多：

```cpp
std::sort(v.begin(), v.end());
auto lb = std::lower_bound(v.begin(), v.end(), 42);
if (lb != v.end() && *lb == 42) { /* 找到 */ }
v.insert(lb, 42);                       // 还能直接当有序插入点用
```

### 2.2 变换与重构（修改序列）

```cpp
std::vector<std::string> names{...};
// transform：原地/异地映射
std::vector<size_t> lengths;
std::transform(names.begin(), names.end(),
               std::back_inserter(lengths),              // 迭代器适配器：push_back 接收
               [](const std::string &s) { return s.size(); });

// copy + back_inserter：过滤式复制
std::copy_if(names.begin(), names.end(), std::back_inserter(selected), pred);

// sort：自定义比较器（lambda 的主场）
std::sort(people.begin(), people.end(),
          [](const Person &a, const Person &b) {
              if (a.age != b.age) return a.age < b.age;
              return a.name < b.name;                    // 次级键：稳定且确定
          });

// unique：相邻去重（必须先 sort！它只合并「相邻」的重复）
std::sort(v.begin(), v.end());
v.erase(std::unique(v.begin(), v.end()), v.end());       // unique + erase 惯用法

// reverse / rotate / partition / nth_element：结构重排家族
std::nth_element(v.begin(), v.begin() + k, v.end());     // 第 k 小就位：O(n)，比 sort 便宜
```

`nth_element` 值得点名：只要「前 k 小」或「中位数」时它是 O(n)，比 sort 的 O(n log n) 便宜一个量级——「TopK 问题」的 STL 内建答案。

### 2.3 数值算法与归约

```cpp
#include <numeric>

int sum = std::accumulate(v.begin(), v.end(), 0);        // ⚠️ 初始值类型 = 结果类型
// 经典陷阱：accumulate(b, e, 0) 对 vector<double> —— 0 是 int，逐次截断！
double dsum = std::accumulate(v.begin(), v.end(), 0.0);  // ✅ 0.0 指定 double

auto prod = std::accumulate(b, e, 1, std::multiplies<>{});   // 自定义运算
auto total_len = std::accumulate(names.begin(), names.end(), size_t{0},
                                  [](size_t acc, const std::string &s) {
                                      return acc + s.size();
                                  });
```

`accumulate` 的初始值参数不只是「零」——它决定**结果类型与求值路径**。浮点求和对顺序敏感（[C 篇第 2 篇](../c/02-types.md)），并行归约用 `std::reduce`（第 5 节）。

## 3. 迭代器适配器：把「写」接到别处

```cpp
std::vector<int> dst;
std::copy(src.begin(), src.end(), std::back_inserter(dst));   // 写 → push_back
std::set<int> s;
std::copy(src.begin(), src.end(), std::inserter(s, s.end())); // 写 → insert（位置自适应）

std::copy(v.begin(), v.end(), std::ostream_iterator<int>(std::cout, " "));
std::vector<std::string> words{std::istream_iterator<std::string>(in),
                               std::istream_iterator<std::string>{}};
// 从流直接构造容器 —— 迭代器统一「一切序列」的威力
```

适配器的存在让算法不必知道目标是什么——「能被写入的序列」都能当输出。

## 4. Ranges（C++20）：算法的管道化

传统算法的两个摩擦：必须传 begin/end 两端、组合算法要嵌套或写中间容器。ranges 同时解决：

```cpp
#include <ranges>
namespace rv = std::views;

std::vector<int> v{1, 2, 3, 4, 5, 6, 7, 8};

// 管道：视图按 | 串联，惰性求值，不产生中间容器
auto evens_sq = v | rv::filter([](int x) { return x % 2 == 0; })
                  | rv::transform([](int x) { return x * x; })
                  | rv::take(3);
// 此刻什么都没算！遍历时才逐元素流过三段管道

for (int x : evens_sq) std::cout << x << ' ';     // 惰性：一次遍历完成 filter→transform→take

// 传统等价写法：一个中间 vector + 三次遍历
```

| 维度       | 传统算法                | ranges                       |
| ---------- | ----------------------- | ---------------------------- |
| 范围表达   | `begin(), end()` 两参数  | 直接传容器                     |
| 组合       | 嵌套调用/中间容器        | `\|` 管道，惰性，零中间容器     |
| 收成容器   | `back_inserter` 手工接   | `std::ranges::to<std::vector>`（C++23） |
| 约束       | 迭代器类别隐式           | concepts 明确报错              |

工程判断：**简单单步操作用传统算法（最成熟）；多步数据流用 ranges 管道（可读性最高）**。ranges 的惰性视图注意「视图不拥有数据」——`auto r = get_vec() | rv::filter(...)` 若 get_vec 返回临时，视图悬垂（[第 2 篇](02-references-auto.md)临时寿命规则的 ranges 版）。

## 5. 并行算法（C++17）：换个参数就多线程

```cpp
#include <execution>

std::sort(std::execution::par, v.begin(), v.end());       // 并行排序
auto s = std::reduce(std::execution::par, v.begin(), v.end(), 0.0);
// reduce：允许乱序/重结合的归约 —— 并行版本，浮点结果与串行 accumulate 可能差 ULP
```

执行策略三档：`seq`（串行）、`par`（并行）、`par_unseq`（并行+向量化）。约束：**操作必须无共享可变状态**（数据竞争 UB），且支持并行算法的标准库实现尚不均衡（MSVC 最好，libstdc++ 需要 TBB 后端）——用它之前先确认工具链。

## 6. 比较器的严格弱序：sort 的隐形契约

`std::sort` 的比较器必须满足**严格弱序**（strict weak ordering）：非自反（`comp(x,x)` 为假）、非对称、传递性。违反它，sort 的内部不变式被破坏——**UB**（libstdc++ 的 debug 模式能抓）：

```cpp
// ❌ 经典违反：用 <= 当比较器（不满足非自反）
std::sort(v.begin(), v.end(), [](const A &a, const A &b) { return a.key <= b.key; });
// ❌ 浮点直接比较含 NaN：NaN 使比较「无序」，传递性破裂
std::sort(v.begin(), v.end(), [](double a, double b) { return a < b; });

// ✅ 正确姿势：严格 <，NaN 剔除或排在固定端
std::sort(v.begin(), v.end(), [](double a, double b) {
    if (std::isnan(a)) return false;
    if (std::isnan(b)) return true;
    return a < b;
});
```

「排序结果不确定/崩溃在 sort 内部」十有八九是比较器违反严格弱序——用它排序的结构体字段含 NaN、或比较函数里藏了 `<=`。

## 7. 陷阱清单

- 异步/存储的 lambda 按引用捕获局部：悬垂；跨作用域一律按值或 move 捕获。
- `[=]` 隐式捕获一切：大对象拷贝 + this 隐式捕获的悬垂；显式列出捕获。
- accumulate 对浮点用 0 当初始值：int 截断；初始值类型即结果类型。
- unique 忘了先 sort：只合并相邻重复。
- 比较器用 `<=` 或含 NaN：违反严格弱序 → sort 内部 UB。
- 遍历中修改容器（算法的底层循环同理）：失效规则（[第 8 篇](08-stl-containers.md)）。
- ranges 视图悬垂：视图不拥有数据；底层容器寿命要覆盖视图使用期。
- 对 list 用 std::sort：需要随机访问迭代器；list::sort 成员。
- nth_element/sort 混用场景：只要 TopK/中位数用 nth_element（O(n)）。
- par 策略下操作访问共享状态：数据竞争 UB；并行算法的谓词必须无副作用。

## 8. 小结

- lambda 是编译器生成的函数对象：捕获即成员、函数体即 operator()；按值捕获默认 const（mutable 解锁）、按引用捕获是存指针——悬垂规则与裸指针相同。
- 算法地图：查找（find/find_if/binary_search/lower_bound）、判定（all_of/count_if/minmax_element）、变换（transform/copy_if）、重排（sort/unique/nth_element）、归约（accumulate/reduce）。
- lower_bound 兼具查找与有序插入点语义；nth_element 是 TopK/中位数的 O(n) 答案；unique 必须先 sort。
- accumulate 的初始值决定结果类型；浮点归约顺序敏感，并行用 reduce。
- 迭代器适配器（back_inserter/inserter/流迭代器）让算法对接任意「序列」；ranges 用管道与惰性视图消除中间容器与 begin/end 噪音。
- 比较器的严格弱序是 sort 的隐形契约：`<=` 与 NaN 是两大违反源。
- 并行算法 = 同一算法 + 执行策略：谓词必须无共享状态；工具链支持度先验证。

## 9. 练习

**1.** 把一段手写的「过滤 + 转换 + 求和」三重循环改写为传统算法链与 ranges 管道两种形式，对比三版的行数、中间容器数量、可读性。

> [!TIP]
> 思路传统版需要中间 vector + transform + copy_if + accumulate（三次遍历）；ranges 版一条管道惰性完成（一次遍历、零中间容器）。手写版最快但意图埋在循环里——性能相同时，声明式的「审查成本」更低。

**2.** 用 lambda 写一个「可配置比较器工厂」：`make_sorter(field_name, ascending)` 返回比较 lambda，用于对 Person 按不同字段排序。讨论按值捕获配置参数的原因。

> [!TIP]
> 思路返回的 lambda 存了 field/ascending 的拷贝——工厂返回后局部配置变量已死，按引用必悬垂。这个练习是「lambda 超出作用域 → 按值捕获」规则的直接应用，也是「lambda = 携带状态的函数对象」的证明。

**3.** 实现 TopK：10⁶ 个数取最大的 100 个。对比三种方案：全排序、nth_element、小顶堆（手动维护 100 大小的堆），测量并分析复杂度差异。

> [!TIP]
> 思路全排序 O(n log n)；nth_element O(n)（但前 k 无序，需再排）；堆方案 O(n log k) 且可流式处理（内存 O(k)）。数据量 10⁶、k=100 时三者实测差距明显。结论：STL 的算法组合几乎覆盖所有「查询型」需求，先查手册再手写循环。

**4.** 构造一个违反严格弱序的比较器（用 `<=`），在 libstdc++ 的 `_GLIBCXX_DEBUG` 模式下运行 sort 观察报错；修复后对比。

> [!TIP]
> 思路debug 模式的 sort 有序性检查会在运行期断言失败，指出比较器违反严格弱序；release 模式下同一代码可能「看起来排好了」或随机崩溃。这个实验解释了「sort 崩溃先查比较器」的排障口诀。

**5.** 用 `std::istream_iterator` 一行从文件读入单词表并统计频率（combine 第 8 篇的 unordered_map），再讨论「流迭代器 + 算法」与「while (in >> w)」两种风格的取舍。

> [!TIP]
> 思路`std::unordered_map<std::string,int> freq{std::istream_iterator<std::string>(in), {}};` 构造进 map？不行——map 是序列构造，这里用 vector 接收 + for_each 计数，或 while 循环。取舍：流迭代器表达「序列统一」的抽象美；实际代码 while 更直白且易扩展（分词规则、大小写归一化）。抽象与直白的平衡是算法使用的元技能。

**6.** 用 ranges 重写「日志文件处理」管道：读取 → 过滤 ERROR 行 → 提取时间戳 → 去重 → 取前 10 条，全程惰性、零中间容器，并回答「视图悬垂」在文件流场景的对应问题是什么。

> [!TIP]
> 思路`std::views::istream<std::string>(file)` 逐词读（按行需自定义 getline range）→ filter 含 "ERROR" → transform 取时间戳字段 → 惰性去重需 C++23 ranges::cache_latest 或手动（ranges 去重有局限）→ take(10)。悬垂对应物：file 的作用域必须覆盖整个管道消费期——「视图不拥有数据源」的流版本。
