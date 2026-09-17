---
title: STL 容器
order: 6
tags: 核心, STL, vector
summary: vector/map/set/unordered_map 的选型与复杂度速查、迭代器失效规则。
---

STL 容器把 C 程序员手写的数据结构（动态数组、链表、哈希表）变成了标准件，并且都遵守同一套约定：值语义、析构自动释放内存、统一的迭代器接口。选型只看两个问题：**按什么查数据**、**顺序要不要紧**。

## vector：默认容器

```cpp
#include <vector>

std::vector<int> v;       // 空数组
v.push_back(1);           // 均摊 O(1) 尾插
v.reserve(1000);          // 预分配容量，避免反复扩容
v[0] = 2;                 // operator[]：不检查越界（快）
v.at(0);                  // at()：越界抛 std::out_of_range（慢但安全）
```

内存布局与 C 的 `malloc` 动态数组一致：**连续内存**，随机访问 O(1)，缓存友好。扩容时申请更大内存、搬移全部元素、释放旧块——单次 O(n)，但均摊后尾插仍是 O(1)。

```cpp
v.emplace_back(1, 'x');        // 原地构造：参数直接转发给元素构造函数，省一次拷贝/移动
v.insert(v.begin() + 1, 99);   // 中间插入：O(n)，插入点之后的元素整体后移
```

`reserve` 与 `resize` 是两回事：reserve 只扩容量（capacity）不动 size，resize 连元素一起补齐——对存整数或指针的 vector 误用 resize，会塞进一堆默认值污染数据。还有一点反直觉：`clear()` 只清元素、**不释放内存**，capacity 不变；想真正还给系统用 `shrink_to_fit()`（非强制建议）。

没有特殊理由就用 vector。链表 list 的「任意位置 O(1) 插入」在实践中几乎总被缓存不友好抵消；连 C++ 之父都说默认用 vector。

## string 与 array：常被漏掉的两个成员

| 类型 | 特点 |
| --- | --- |
| `std::string` | 动态字符数组，扩容规则同 vector，同样受迭代器失效规则管束 |
| `std::array<int, N>` | 编译期定长，栈上存储，无堆分配，接口对齐 vector |

```cpp
std::array<int, 4> a{1, 2, 3, 4};
std::sort(a.begin(), a.end());     // 算法直接可用
// a[10];                          // ❌ 越界：未定义行为（a.at(10) 会抛异常）
```

## 选型速查

| 容器 | 底层 | 随机访问 | 查找 | 有序 | 典型用途 |
| --- | --- | --- | --- | --- | --- |
| `vector` | 动态数组 | O(1) | O(n) | 插入序 | 默认选择 |
| `deque` | 分段连续数组 | O(1) | O(n) | 插入序 | 两端进出（栈/队列） |
| `list` | 双向链表 | O(n) | O(n) | 插入序 | 稳定迭代器、大量拼接 |
| `map` / `set` | 红黑树 | — | O(log n) | 按 key 排序 | 有序遍历、范围查询 |
| `unordered_map` / `set` | 哈希表 | — | 均摊 O(1) | 无序 | 默认的键值查找 |

map 与 unordered_map 的取舍：要按 key 顺序遍历或范围查询用 map；纯查找用 unordered_map，但要接受哈希最坏 O(n) 与无序输出。

> [!TIP]
> map 的 `operator[]` 有个坑：key 不存在时会**插入默认值**，只读场景会偷偷改容器。只查询用 `find` 配合 C++17 的 if 初始化语句：`if (auto it = m.find(key); it != m.end()) use(it->second);`

## 迭代器失效：最经典的暗雷

迭代器本质是「广义指针」。容器结构一变，指向某元素的迭代器可能指向别处或彻底失效——表现与野指针一模一样，且不检查就崩在十万八千里外。

| 操作 | vector | deque | list | unordered_map |
| --- | --- | --- | --- | --- |
| 尾插 push_back | 扩容则全失效，否则不失效 | 迭代器失效，引用仍有效 | 不失效 | 迭代器失效，引用仍有效 |
| 中间插入 | 插入点之后失效 | 全失效 | 不失效 | 同尾插 |
| erase 删除 | 删除点及之后失效 | 中间删除全失效 | 仅被删元素 | 仅被删元素 |

两个保命写法：

```cpp
// 1. 边遍历边删：用 erase 的返回值接住下一个有效迭代器
for (auto it = v.begin(); it != v.end(); ) {
    if (bad(*it)) it = v.erase(it);   // erase 返回下一个有效迭代器
    else ++it;
}

// 2. 不要让迭代器跨过修改操作
auto it = v.begin();
v.push_back(1);       // 若触发扩容，it 已失效
// *it;               // ❌ 未定义行为
```

> [!WARNING]
> 规则表按容器背不如按直觉记：**连续内存结构（vector/string/deque）元素一挪动就可能全体失效；节点结构（list/map/set）只有被删的元素失效；哈希表 rehash 迭代器全失效但引用仍有效**。拿不准就重新 begin()，deque 的精细规则查 cppreference。

## 常用操作连招

```cpp
#include <algorithm>

std::vector<int> v{3, 1, 2};
std::sort(v.begin(), v.end());                    // O(n log n)
auto it = std::find(v.begin(), v.end(), 2);       // 找不到返回 end()
v.erase(std::remove(v.begin(), v.end(), 2), v.end());   // 删特定值：remove-erase 惯用法

std::unordered_map<std::string, int> count;
++count["cpp"];                                   // 不存在则先插入 0 再自增
```

排序、查找、删除的组合拳在[STL 算法与 lambda](07-stl-algorithms.md)展开；容器里放堆对象时的所有权规则见[智能指针](08-smart-pointers.md)。

> [!NOTE]
> `v.size()` 返回**无符号**类型：`v.size() - 1` 在空容器上会下溢成巨大正数，`for (int i = 0; i < v.size() - 1; ++i)` 是经典事故现场。用 `i + 1 < v.size()` 或直接范围 for 绕开减法。

> [!NOTE]
> remove-erase 两步不是画蛇添足：`std::remove` 只能把元素前移、无法改容器大小，必须配 `erase` 真正收缩。C++20 才提供一步到位的 `std::erase_if(v, pred)`，读老代码时认得这对手法即可。

## 练习

- [ ] 用 vector 实现简单 LRU：尾插 + 按值删除，测 10 万元素删除耗时，再和 unordered_map + list 方案对比
- [ ] 故意构造迭代器失效：push_back 后继续用旧迭代器，开 `-fsanitize=address` 看崩溃报告
- [ ] 验证 unordered_map 的遍历顺序在插入和扩容后发生变化，理解为什么不能依赖它的顺序
- [ ] 实测 `reserve` 与 `resize` 的区别：打印两个操作后 size 与 capacity 的值
- [ ] 用 `std::array` 存四个 `Point`，传给一个接受 `const std::vector<Point>&` 的函数试试，体会两者不能互换；再改成模板参数接受任意区间
- [ ] 遍历中对 `std::list` 做 push_back，验证既有迭代器全部不失效——对照 vector 的表现

相关阅读：[STL 算法与 lambda](07-stl-algorithms.md)
