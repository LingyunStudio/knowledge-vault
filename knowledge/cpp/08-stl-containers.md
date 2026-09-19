---
title: STL 容器与迭代器：数据结构的标准库化
order: 8
tags: vector, map, unordered_map, 迭代器失效, 容器选型
summary: 容器全景与选型决策树、vector 的扩容机制与迭代器失效规则、string 的 SSO、map 与 unordered_map 的结构差异和 operator[] 插入陷阱、迭代器概念体系，以及缓存友好性如何主导真实性能。
---

STL 的容器不是「一堆可互换的数据结构」，而是一组**性能契约明确、内存模型各异**的工具。选型的依据不是熟悉度，而是三个问题：**访问模式**（随机下标？按键查找？两端操作？）、**性能敏感点**（查找？遍历？插入？）、**迭代器稳定性**（扩容/插入时其他元素会不会失效）。本篇按「先讲清每个容器的内存模型，再给失效规则，最后给决策树」的顺序展开。

## 1. 容器全景

| 类别   | 容器                               | 内存模型    | 王牌操作             |
| ---- | -------------------------------- | ------- | ---------------- |
| 序列   | `vector`                         | 连续数组    | 随机访问、尾插、遍历       |
| 序列   | `array<T, N>`                    | 栈上定长数组  | 零堆开销             |
| 序列   | `deque`                          | 分段连续    | 两端 O(1) 插删       |
| 序列   | `list`（双向链表）、`forward_list`      | 节点链     | 任意位置 O(1) 插删+稳定  |
| 有序关联 | `map`/`set`（及 multi 版本）          | 红黑树     | 有序遍历、O(log n) 查改 |
| 哈希关联 | `unordered_map`/`unordered_set`  | 哈希桶 + 链 | 平均 O(1) 查找       |
| 适配器  | `stack`/`queue`/`priority_queue` | 包装底层容器  | 受限接口             |

一个先行的反直觉结论：**90% 的场景答案是 `vector`**。连续内存对现代 CPU 的缓存太友好，以至于链表的理论优势（O(1) 中间插删）在大多数真实负载里被缓存未命中的代价淹没——第 7 节用数字说明。

## 2. vector：默认容器的全部细节

### 2.1 扩容机制与容量管理

```cpp
std::vector<int> v;
v.reserve(1000);              // 预留容量：之后的 push_back 不再触发重新分配
v.push_back(1);               // size=1, capacity=1000

v.resize(50);                 // 改变 size（多出的元素值初始化）
// capacity 不变；resize 是「逻辑长度」，reserve 是「物理容量」
```

扩容策略：容量满时按**增长因子**分配新块（libstdc++ 2 倍、MSVC 1.5 倍），旧元素**移动**（noexcept 时，[第 5 篇](05-copy-move.md)）到新块，释放旧块。由此推得：

- 已知规模先 `reserve`：n 次扩容 + n 次迁移 → 0 次分配。
- 扩容使**全部迭代器与指针失效**（元素搬家了）。
- `shrink_to_fit()` 是请求不是命令（缩容 allocator 可能拒绝）。

### 2.2 迭代器失效规则（vector 全表）

| 操作                        | 失效范围                              |
| ------------------------- | --------------------------------- |
| `push_back`/`insert`（未扩容） | 插入点之后的迭代器失效                       |
| `push_back`/`insert`（扩容）  | **全部**失效                          |
| `erase`                   | 删除点**之后**全部失效                     |
| `swap`/`clear`            | 视实现；clear 后端部元素迭代器仍可能「指有效内存」但语义无效 |

失效的后果是 UB——编译器不报错，运行期随机崩溃。标准模式：

```cpp
// 边遍历边删除的正确姿势：erase 返回下一个有效迭代器
for (auto it = v.begin(); it != v.end(); ) {
    if (pred(*it))
        it = v.erase(it);        // erase 返回「被删元素的下一个」
    else
        ++it;
}
```

更优雅的是算法式写法：`v.erase(std::remove_if(v.begin(), v.end(), pred), v.end());`（erase–remove 惯用法），或 C++20 的 `std::erase_if(v, pred);`——一步完成，无迭代器手动管理。

## 3. string：SSO 与它的真实性格

`std::string` 是 `vector<char>` 加三件东西：字符串语义、SSO、编码无关的字节视图：

**SSO（小字符串优化）**：短字符串（libstdc++ 15 字节、MSVC 15 字节、libc++ 22 字节）直接存在对象内部，**零堆分配**。这解释了几个实测现象：短 string 的拷贝比 vector 快得多；返回短字符串不用移动语义也快；`sizeof(std::string)` 约 32 字节（SSO 缓冲占了空间）。

```cpp
std::string a = "short";          // SSO：栈上，无堆分配
std::string b(100, 'x');          // 堆分配
```

字符串构造与拼接的安全与效率规约在 [C 篇第 5 篇](../c/05-arrays-strings.md)有对照——C++ 版只需记住：**构造用字符串字面量与 +，拼接用 += 或 format，解析外部输入用 stoi/stoull 系（带异常/错误码），绝不 strcpy**。非拥有的字符串视图 `string_view` 在[第 12 篇](12-modern-features.md)。

## 4. deque、list、array：各自的真实定位

### 4.1 deque：分段连续

```text
deque 内存布局（分段数组）：
map: [ptr]→[chunk0: 0..7][ptr]→[chunk1: 8..15][ptr]→[chunk2: ...]
```

「分段连续」让它两头 O(1) 插删（vector 头部插删是 O(n)）、随机访问仍 O(1)（两次寻址）。代价：迭代器是复杂结构（要处理跨段）、缓存局部性弱于 vector。真实定位：**队头队尾都要 O(1) 的场景**（滑动窗口、任务队列）。

### 4.2 list：被高估的容器

双向链表的理论优势与实际表现的对照：

| 操作         | list 理论           | list 实测（100 万元素级） | vector        |
| ---------- | ----------------- | ----------------- | ------------- |
| 遍历求和       | O(n)              | 慢 vector 数倍（指针追逐） | O(n) 最快（预取友好） |
| 中间插删（已知位置） | O(1)              | 快（但找到位置本身 O(n)）   | O(n) 移动       |
| 排序         | O(n log n)        | 慢 vector 数倍       | O(n log n)    |
| 两端插删       | O(1)              | 慢于 deque          | 尾 O(1) 头 O(n) |
| 每元素内存      | 节点 + 2 指针（24+ 字节） | 碎片化               | 元素本身（缓存密度高）   |

「需要频繁中间插删所以用 list」在实测中经常输给 vector——除非元素很大（移动昂贵）或有稳定的迭代器/指针稳定性需求（list 的迭代器只在自己的插删中失效）。**list 的真实用武之地比教程里少得多**。

### 4.3 array：把 C 数组装进 STL 接口

```cpp
std::array<int, 3> a{1, 2, 3};    // 栈上、零堆、有 size()/迭代器/比较
auto b = a;                        // 值拷贝（C 数组做不到）
```

固定尺寸小数组的现代答案；尺寸是类型的一部分（[第 7 篇](07-templates.md)非类型参数）。

## 5. 关联容器：有序树 vs 哈希表

### 5.1 map/set：红黑树的契约

- **有序**：遍历按键排序；`lower_bound`/`upper_bound` 范围查询是独门能力。
- O(log n) 查/插/删，最坏有保证（无哈希攻击问题）。
- **迭代器稳定**：插入删除不影响其他元素的迭代器/指针（节点式容器）。
- `map<K,V>` 的 value\_type 是 `pair<const K, V>`——key 不可改（改了树就坏了）。

### 5.2 map 的 operator\[] 陷阱

```cpp
std::map<std::string, int> counts;
counts["apple"]++;             // ⚠️ 「apple」不存在时：先插入 (apple, 0) 再自增
                               // —— 查询语义的 [] 会**修改**容器！

if (counts["apple"] > 0) ...   // ❌ 只读意图却可能插入 —— 违反 const 契约（[] 没有 const 版本）

counts.at("apple");            // ✅ 不存在时抛 out_of_range（查询语义）
counts.find("apple");          // ✅ 迭代器判断存在性
counts.try_emplace(key, args...);   // ✅ 不存在才构造（值类型的构造成本可控）
counts.insert_or_assign(key, v);    // 存在覆盖/不存在插入，返回信息完整
```

`[]` 的语义是「**访问或创建**」——计数器场景它是便利（`counts[k]++`），查找场景它是 bug。规约：**插入/计数用 `[]` 或 `try_emplace`，纯查询用 `find`/`at`**。

### 5.3 unordered\_map：哈希表的 STL 化

- 平均 O(1)、最坏 O(n)（哈希碰撞，[ds 篇第 6 篇](../ds/06-hash-table.md)的三语言实现内幕在 STL 里同样适用）。
- key 要求 `std::hash<K>` + `operator==`；自定义类型需要提供两者（或特化 hash）。
- **迭代器失效规则**：rehash 使**所有**迭代器失效（但引用/指针仍有效——节点不搬家，与 vector 相反！）；erase 只失效被删元素。
- 负载因子超过 `max_load_factor`（默认 1.0）时 rehash；已知规模先 `reserve`。
- 无序：需要按序输出时临时排序或改用 map。

### 5.4 选择标准

| 需求               | 选                               |
| ---------------- | ------------------------------- |
| 快速按键查找，无序无所谓     | `unordered_map`                 |
| 按序遍历/范围查询/前驱后继   | `map`                           |
| 计数器/存在性检查        | `unordered_map`/`unordered_set` |
| key 是自定义类型且哈希麻烦  | `map`（只要 operator<）             |
| 最坏情况有保证（实时/对抗输入） | `map`                           |

## 6. 迭代器：容器与算法之间的胶水

### 6.1 概念体系

迭代器按能力分五级（算法用「最低要求」标注自己的能力需求）：

| 类别      | 能力                    | 代表                  |
| ------- | --------------------- | ------------------- |
| 输入迭代器   | 单遍读                   | `istream_iterator`  |
| 输出迭代器   | 单遍写                   | `back_inserter`     |
| 前向迭代器   | 多遍读写                  | `forward_list`      |
| 双向迭代器   | 再加 `--`               | `list`、`map`        |
| 随机访问迭代器 | 再加 `it + n`、`it1-it2` | `vector`、`deque`、指针 |

`std::sort` 要求随机访问——所以 `sort(list.begin(), list.end())` 编译不过（list 用自己的 `list::sort` 成员）。理解这个体系，算法的「为什么这个容器用不了这个算法」问题自动消解。

### 6.2 半开区间与 end 迭代器

`[begin, end)` 的半开区间约定：`end` 指向「最后一个元素的下一个」。好处：空区间 `begin==end` 统一表达、循环条件 `it != end` 对所有容器统一、`[i, n)` 与下标系统对齐。`end()` 不可解引用——它与「末尾后一位」的合法性（[C 篇第 4 篇](../c/04-pointers.md)）一脉相承。

## 7. 缓存友好性：真实性能的主导因素

用一个能跑的实验收束选型直觉：

```cpp
// 1 千万个 int：vector 顺序遍历 vs vector 二分查找 vs unordered_map 查找
std::vector<int> sorted(n);                      // 连续内存
std::unordered_map<int, int> m; m.reserve(n);

// 顺序求和：vector ~5ms（预取器全开）；list 同样遍历 ~40ms（每步一次缓存未命中）
// 单点查找：unordered_map ~O(1) 但常数大（哈希+桶）；vector 二分 log2(10^7)≈23 次缓存友好的比较
```

规律（x86 实测量级）：**连续内存的暴力扫描常胜过指针追逐的「更优复杂度」**。数据量到 10⁷ 级别，`vector` 二分与 `unordered_map` 查找的时间差常常小于 2 倍，而 `vector` 内存省一半以上。选型时先看数据规模：**小集合（几十个元素）线性扫描 vector 就是答案**；大集合才轮到哈希与树的复杂度优势。

## 8. 选型决策树

```text
需要按键关联？
├── 否（纯序列）
│     ├── 尺寸固定小 → array / 栈数组
│     ├── 两端都要 O(1) → deque
│     ├── 需要迭代器/指针稳定 + 元素巨大 → list（少见）
│     └── 其余 → vector ✅（默认）
└── 是
      ├── 需要有序/范围查询 → map / set
      ├── 只要最快点查 → unordered_map / unordered_set
      └── key 自定义 → 能写 hash+eq 就 unordered，否则 map（只要 <）
```

## 9. 陷阱清单

- `map[k]` 当查询：不存在时插入默认值；查询用 find/at。
- 遍历中 `erase(it)` 后继续 `++it`：已失效迭代器；用 erase 返回值。
- vector 扩容后继续用旧迭代器/指针：全部失效；重新 begin() 或 reserve 预防。
- unordered\_map 的 rehash 后用旧迭代器：全失效（指针/引用却仍有效——与 vector 相反的记忆点）。
- 「中间插删多就上 list」：实测常输给 vector；先测再换。
- reserve 与 resize 混淆：容量 vs 长度。
- 自定义类型做 unordered key 忘了提供 hash 或 ==：编译失败或退化；`unordered_map` 用自定义哈希传入。
- `std::sort` 套在 list 上：编译不过；list 有成员 sort。
- 在 for(range) 里向 vector push\_back：扩容使迭代器失效；先收集后批量插。
- 大集合用 map 只为「查找」而忽视 unordered：白付 log 因子；反之对抗性输入场景 unordered 的最坏 O(n) 是风险。

## 10. 小结

- 容器选型三问：访问模式、性能敏感点、迭代器稳定性；90% 的答案是 vector（连续内存的缓存优势压倒多数理论复杂度优势）。
- vector 的机制：size 逻辑长度、capacity 物理容量、扩容移动迁移（noexcept 前提）；已知规模先 reserve；erase–remove/`std::erase_if` 处理条件删除。
- string 的 SSO 让短串零堆分配；list 的真实用武之地比直觉少（元素巨大或需要稳定性）；deque 解决两端 O(1)。
- map 有序 + 迭代器稳定 + 最坏保证；unordered\_map 平均 O(1) 但 rehash 全失效；`[]` 是「访问或创建」语义——查询必须 find/at，计数才用 `[]`/try\_emplace。
- 迭代器五级概念解释算法与容器的兼容性；半开区间 `[begin, end)` 是统一的循环与区间表达。
- 缓存友好性主导实测性能：连续扫描可胜指针追逐；小集合线性 vector 常是最优解。

## 11. 练习

**1.** 写实验：10⁶ 个 int 存 vector（reserve 后填充）与 list（逐个 push\_back），分别遍历求和计时。解释差距的缓存学来源（预取、缓存行、节点跳转）。

> [!TIP]
> 思路vector 顺序访问完美预取（每缓存行 64B 装 16 个 int）；list 每节点一次必然未命中（节点还散落在堆各处）。差距通常 5\~10 倍。这就是「O(n) 不等于 O(n)」：复杂度相同，常数由内存系统决定。

**2.** 实现词频统计（`unordered_map<string,int>`），故意用 `counts[word]++` 与「查询存在性」两个意图混写的 bug 版本对比；改用 try\_emplace/find 的正确版本。

> [!TIP]
> 思路bug 版：查询不存在的 key 时静默插入 0——统计结果膨胀、内存上涨。正确：计数 `counts[word]++`（或 try\_emplace(word, 0).first->second++）；存在性 `counts.find(word) != counts.end()`。区分「写入路径」与「查询路径」是 map 使用的基本功。

**3.** 实现「边遍历边删除偶数」：先用错误的 `v.erase(it)` + `++it` 版本观察 UB（ASan 下直接报错），再写 erase 返回值版本与 `std::erase_if` 版本。

> [!TIP]
> 思路错误版 erase 后 it 失效，++it 是 UB（ASan 报 heap-use-after-free）。正确①`it = v.erase(it);`（删除时不 ++）；②`std::erase_if(v, [](int x){ return x % 2 == 0; });`——一行，无手动迭代器。C++20 的 erase\_if 是这个场景的终点答案。

**4.** 给自定义类型（如 `struct Point{int x,y;}`）实现 unordered\_map 的 key：提供 `operator==` 与 `std::hash` 特化（或自定义哈希对象），并测试 10⁶ 个 Point 的查找性能。

> [!TIP]
> 思路hash 组合：`(hash<int>{}(p.x) * 31) ^ hash<int>{}(p.y)`（更好的是 boost::hash\_combine 思路）。性能对比：自定义类型哈希质量差时桶堆积 → 查找退化。实验演示「哈希函数质量决定 unordered 容器的生死」（呼应 ds 篇）。

**5.** 「学生按分数排序输出 + 按 ID 点查」的双需求场景：设计数据结构（map\<id, stu> + 排序视图？unordered\_map + 每次排序？），讨论两种方案的写放大与代码复杂度。

> [!TIP]
> 思路方案①unordered\_map 点查 + 需要排序时收集指针排序（写简单、排序 O(n log n) 每次付）；方案②map 按 id + 排序视图每次构建（同样问题）；方案③数据 vector + 两套索引（id→下标的 unordered\_map + 分数排好的下标数组）——写入维护两套索引，查询两者皆快。数据量与读写比决定方案；这是「索引即副本」的权衡。

**6.** 用迭代器失效规则解释为什么 `for (auto x : v) v.push_back(x);` 是 UB，而 `for (auto x : m) m.erase(...)`（map 中删「别处」的元素）却定义良好。

> [!TIP]
> 思路vector：push\_back 可能扩容 → 全部迭代器失效（range-for 的隐藏 it 也是）→ UB。map：节点式容器，插入不影响已有迭代器；erase 只失效被删元素——只要删的不是当前迭代的元素，其余迭代器稳定。两条规则的分界是「节点式 vs 数组式」内存模型。
