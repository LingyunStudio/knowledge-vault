---
title: 词汇类型：让 API 自己说话
order: 12
tags: string_view, span, optional, variant, chrono, C++20
summary: string_view/span 的非拥有视图语义与悬垂边界、optional 的「正常地没有」、variant 的封闭多态与 visit、chrono 的单位类型化、tuple 与结构化绑定，以及这些类型如何把参数语义与返回语义写进签名。
---

「词汇类型」（vocabulary types）指标准库提供的一批小而通用的类型——`string_view`、`span`、`optional`、`variant`、`chrono::duration`。它们的共同使命：**把「参数怎么用、返回什么意思」写进类型签名**，让编译器替文档办事。`f(std::string_view)` 自我说明「只读、不拥有、接受任何字符串」；`std::optional<int> f()` 自我说明「可能没有结果」。本篇按「视图 → 可选 → 变体 → 时间」的顺序过一遍这一代工具。

## 1. string_view：字符串的借用视图

### 1.1 语义与用法

```cpp
#include <string_view>

void log_msg(std::string_view sv);      // 只读、不拥有、零拷贝

log_msg("hello");                        // C 字面量：不构造 string！
log_msg(std::string("heavy"));           // string：隐式转视图
std::string s = "...";
log_msg(s);                              // 零拷贝

sv.substr(0, 3);                         // O(1)：只是指针和长度的算术（string 的 substr 是 O(n) 拷贝）
sv.starts_with("user_");                 // C++20 前缀检查
sv.remove_prefix(5);                     // 移动指针：解析器的利器
```

`string_view` 是「指针 + 长度」：不分配、不拷贝、O(1) 切片。它同时消灭了三种参数形态的重复：

```cpp
void f(const std::string &s);      // 传字面量要构造临时 string（堆分配）
void f(const char *s);             // 长度未知，调用方常strlen
void f(std::string_view sv);       // ✅ 通吃三者，零拷贝 —— 参数的默认选择
```

### 1.2 悬垂：视图的第一戒律

视图**不拥有数据**，它的全部危险集中于此：

```cpp
std::string_view get_name() {
    return std::string("temp");       // ❌ 返回指向已死临时的视图
}

std::string_view sv = std::string("hi") + "!";    // ❌ 临时 string 立即销毁，sv 悬垂
// （const string& 有临时寿命延长，string_view 没有 —— 第 2 篇的规则差异）

void store(std::string_view sv);
std::string_view danger;
{
    std::string s = "local";
    danger = s;                        // ❌ s 作用域结束，danger 悬垂
}
```

规约三条：**函数参数用 string_view（生命周期由调用表达式覆盖，安全）；返回值与成员存储用 string（拥有）；视图作为局部变量只做短程解析**。拿不准就 string——悬垂省下的拷贝远不够调试成本。

### 1.3 两个细节

- **不保证 NUL 终止**：`sv.data()` 不能交给 `printf("%s")`/C API——`std::string(sv).c_str()` 或传 `sv.data(), sv.size()`。
- `string_view` 的隐式转换是**单向**的（string→view 可，view→string 不可，需显式构造）——接口从 string 收紧到 string_view 安全，反向收紧（调用方被要求改签名）需要审视。

## 2. span：连续内存的万能视图

```cpp
#include <span>

double mean(std::span<const double> data);   // 只读视图：vector/array/裸数组/C缓冲区通吃

std::vector<double> v{1, 2, 3};
double arr[] = {4, 5, 6};
mean(v);                                     // vector → span
mean(arr);                                   // 裸数组 → span（带尺寸！）

std::span<double> mut = v;                   // 可写视图
mut[0] = 10;
auto first_half = v | std::views::take(2);   // 与 ranges 联动（C++20）
```

`span<T>` 与 `string_view` 同理是「指针 + 长度」，但类型层面区分可写（`span<T>`）与只读（`span<const T>`）——**接受序列的函数参数从 `T* + len` 升级为 span**，长度检查成为可能，且调用方零适配。与 string_view 相同的戒律：不拥有，别存它。

## 3. optional：「没有」是正常答案

[第 11 篇](11-errors-exceptions.md)已定位 optional 的语义（可能无值且无值正常）。补充日常用法层：

```cpp
std::optional<int> parse(std::string_view s);     // 解析失败返回 nullopt

// 惯用法
auto v = parse("42");
if (v) use(*v);                        // if 形式
int def = v.value_or(0);               // 无值取默认
auto &r = v.value();                   // 无值抛 bad_optional_access（会检查）

// C++23 monadic：链式处理，避免手工 if 嵌套
auto len = parse(s)
    .transform([](int x) { return x * 2; })
    .and_then([](int x) { return lookup(x); })
    .value_or(-1);
```

用 optional 表达「可能没有」之后，两个旧写法退休：哨兵值（`-1` 当「找不到」——与合法值冲突的风险）和「出参 + bool」（`bool find(K, V &out)` 的分支噪声）。

## 4. variant：类型安全的「封闭联合」

### 4.1 与 union 的代差

```cpp
#include <variant>

std::variant<int, std::string, double> v;     // 当前持有哪个类型是**被记录的**
v = 42;
v = std::string("now a string");              // 切换：旧值析构、新值构造（自动）

if (std::holds_alternative<std::string>(v)) {          // 检查当前类型
    auto &s = std::get<std::string>(v);                // 类型对了才安全（错了抛 bad_variant_access）
}
if (auto *d = std::get_if<double>(&v)) {               // 指针式：错了得 nullptr
    use(*d);
}
```

[C 篇的 tagged union](../c/08-structs-unions.md) 需要手工维护「标签-数据」一致性；variant 把它变成类型系统的职责：**当前活跃类型被记录、访问错类型可检测（异常/空指针而非 UB）**。variant 就是没有继承的「封闭集合多态」（[第 10 篇](10-inheritance.md)的类型擦除讨论）。

### 4.2 visit：全覆盖分派

```cpp
std::variant<Circle, Rect> shape = Circle{2.0};

std::visit([](const auto &s) {                    // 访问者：对每个可能类型实例化一次
    std::cout << area_of(s) << '\n';
}, shape);
// 编译器保证「所有分支都被处理」—— 新增 variant 成员后，visit 不改就编译错误
```

`std::visit` 的杀手锏是**穷尽性检查**：variant 新增类型，所有未覆盖的 visit 立刻编译报错——switch 的 default 兜底掩盖遗漏，visit 强制显式。规约：**封闭类型集合（状态机、AST 节点、协议消息）用 variant + visit；集合会无限扩展才用继承**。

## 5. chrono：时间的类型化

```cpp
#include <chrono>
using namespace std::chrono_literals;

std::this_thread::sleep_for(100ms);               // 字面量：单位写进类型
auto timeout = 30s + 500ms;                       // duration 运算：单位自动换算

auto start = std::chrono::steady_clock::now();
work();
auto ms = duration_cast<std::milliseconds>(std::chrono::steady_clock::now() - start);

// 类型系统挡住的错误：
// sleep_for(100);        // ❌ 100 个什么？编译错误（int 不能隐式转 duration）
// timeout_ms + 30s;      // 毫秒 + 秒：类型检查后正确换算，不再有单位混算 bug
```

「整数当毫秒、函数当秒」的接口歧义（`sleep(100)` 是 100ms 还是 100s？）被 duration 类型终结。工程规约：**接口收 duration 参数（或 chrono::time_point），存内部计数才转 count()**；时钟选择：测耗时用 `steady_clock`（单调，不受系统调时影响），日历时间用 `system_clock`。

## 6. tuple、pair 与结构化绑定

```cpp
std::map<std::string, int> scores;
for (const auto &[name, score] : scores) { ... }        // pair 拆解

std::tuple<int, std::string, double> row{1, "x", 3.14};
auto [id, tag, val] = row;                              // tuple 拆解（C++17）

auto [iter, ok] = scores.try_emplace("bob", 90);        // 多返回值的接收侧

// 函数多返回值：tuple 能用，但**命名的结构体几乎总是更好**——
struct Result { int id; std::string tag; double val; };
Result compute();                                        // 字段有名：可读性碾压 tuple
```

tuple 适合「即用即弃的临时聚合」（try_emplace 的返回、zip 场景）；跨越函数边界的返回值用结构体——字段名是免费的文档。

## 7. format：类型安全的格式化（C++20）

```cpp
#include <format>

std::string s = std::format("{} scored {:.1f} ({}%)", name, score, pct);
// 类型安全：参数与占位符不匹配 → 编译错误（printf 的 %d vs double 是运行时灾难）
// 性能：比 snprintf 快，直接写入输出迭代器的 std::format_to 也有
```

printf 的两个老问题（类型不安全、不支持 std::string 直接输出）与 iostream 的两个老问题（状态式 API、性能）在 format 上同时解决。规约：**新代码用 format，iostream 留给流式场景，printf 系退出应用代码**。

## 8. 陷阱清单

- string_view 存成员/返回：悬垂（无临时寿命延长）；存储与返回用 string。
- string_view 交给 C API 当 NUL 终止串：不保证终止；构造 string 或传 data+size。
- span/string_view 指向的容器被修改：视图失效或悬垂；短程使用。
- optional 解引用前不检查：UB；if/value_or/value。
- 用 optional 折叠「真错误」：丢失原因；错误用 expected。
- variant 用 get 强取不检查：bad_variant_access；get_if 或 visit。
- visit 不覆盖全部类型：编译错误（这正是价值）；漏处理是编译期的礼物。
- chrono 接口收裸整数：单位歧义回归；收 duration。
- steady/system 时钟混用：测耗时必须 steady_clock。
- tuple 当函数返回值跨边界：字段无名；命名结构体。
- format 格式串与参数类型不匹配：编译错误（这是保护）——比 printf 的运行时灾难强。

## 9. 小结

- 词汇类型的使命是把意图写进签名：string_view（只读借用字符串）、span（借用连续序列）、optional（可能无值）、variant（封闭变体）、duration（带单位的时间）。
- 视图类型的第一戒律是不拥有：参数短程使用安全，存储/返回必须拥有类型；string_view 无临时寿命延长、不保证 NUL 终止。
- optional 消灭哨兵值与「bool 出参」；expected 消灭「丢失原因的错误码」——「可能没有」与「失败」是两种语义，选对类型。
- variant + visit 是封闭集合的多态：类型记录自动维护、穷尽性由编译器强制；开放集合才轮到继承。
- chrono 把单位做成类型：混算 bug 在编译期消失；测耗时用 steady_clock。
- format 类型安全且快；函数多返回值优先命名结构体，tuple 留给临时聚合。

## 10. 练习

**1.** 写一个字符串解析器（提取 key=value 对），全链路用 string_view 实现零拷贝（remove_prefix/split），并构造三个悬垂场景让 ASan 报错，总结「视图安全区」的边界。

> [!TIP]
> 思路安全区：函数参数、函数内局部解析（源 string 活着）；危险区：存成员、返回、存进长生命周期容器。ASan 报 stack-use-after-scope / heap-use-after-free。总结成一句话：视图的寿命 ⊆ 底层数据的寿命。

**2.** 把一个旧接口 `void draw(const std::vector<double> &pts)` 迁移到 `std::span<const double>`，验证四种调用方的零改动兼容（vector、裸数组、array、初始化列表失败场景讨论）。

> [!TIP]
> 思路前三种隐式转换成功；初始化列表 `{1,2,3}` 不能隐式成 span（无拥有语义）——需要先建容器或用 C++26 的 span 构造改进。迁移价值：调用方不再被迫用 vector（裸数组/异构缓冲直接传），接口从「容器类型耦合」松绑为「内存布局契约」。

**3.** 用 variant + visit 重写一个「计算器 AST」：节点类型 Number/BinaryOp/UnaryOp，evaluate 用递归 visit。对比第 10 篇继承版的差异（新增节点类型的改动面）。

> [!TIP]
> 思路variant 版新增节点类型：改 variant 定义 → 所有 visit 编译报错 → 逐个补分支（编译器导航）；继承版：新增派生类无编译报错，但所有「类型相关处理」需要新虚函数或 dynamic_cast 扫描。封闭集合用 variant 的本质收益：**遗漏由编译器抓**。

**4.** 实现一个「重试带超时」的函数：`template<typename F> auto retry(F f, int max_tries, std::chrono::milliseconds backoff)`，全部用 chrono 类型，并演示把 `retry(task, 3, 100)`（裸 int）挡在编译期。

> [!TIP]
> 思路签名收 `std::chrono::milliseconds`，调用方写 `100ms`；裸 100 编译错误——这个「烦人」正是 chrono 的价值：单位歧义在编译期变成显式的 `100ms`。内部 sleep_for(backoff * attempt)（duration 支持标量乘）。

**5.** 把「状态机」从 enum + switch 实现迁移到 variant（每个状态一个结构体，事件触发时 `current = NextState{...}`），对比两种实现的状态转换合法性检查时机。

> [!TIP]
> 思路enum+switch：非法转换靠 switch 的 default 抓（运行期）或人工纪律；variant：状态就是类型，「当前状态」由 variant 记录，转换 = 赋值新状态——非法转换需要设计层挡（visit 里返回 optional），但每个状态可携带自己的数据（不用共享大结构体）。状态携带数据多时 variant 版明显干净。

**6.** 讨论题：一个团队还在 C++14，想用 string_view/optional/variant。给出「自己实现 vs 引用第三方（folly/absl） vs 升级编译器」三条路线的评估，并给出你的推荐与理由。

> [!TIP]
> 思路自研：API 易照抄但边界 bug（悬垂、一致性）全自己扛——不推荐；absl/folly：成熟但有依赖治理成本；升级编译器：一次性成本，长期收益最大（这些类型只是 C++17/20 收益的零头）。推荐升级——工具链债务只会越滚越大，词汇类型是「值得为它升级」的最低门槛之一。
