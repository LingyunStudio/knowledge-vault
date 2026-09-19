---
title: 错误处理：异常、错误码与词汇类型
order: 11
tags: 异常, 栈展开, noexcept, optional, 异常安全
summary: 异常的零开销成本模型（不抛免费、抛昂贵）、栈展开与异常安全等级的落地、按引用捕获与异常层次设计、错误码与 optional/expected 的现代替代、异常与错误码的选择决策表，以及 noexcept 作为接口契约的意义。
---

C++ 给了错误处理一套**多工具**方案：异常（构造失败唯一出路）、错误码（可预期失败的主流）、`optional`（「没有结果」是正常情形）、断言（程序员错误）。四者的边界与组合方式是本篇的核心——用错工具的代码要么在热路径上付异常的代价，要么用错误码把每个调用点变成噪声。

## 1. 异常机制：语义与成本模型

### 1.1 基本形制与异常层次

```cpp
#include <stdexcept>

double divide(double a, double b) {
    if (b == 0) throw std::invalid_argument("divide by zero");   // 抛出：控制流跳转
    return a / b;
}

try {
    parse_and_run(config);
} catch (const std::invalid_argument &e) {        // ✅ 按引用捕获（防切片，同多态规则）
    log(e.what());                                // what()：错误信息
} catch (const std::exception &e) {               // 基类兜底：所有标准异常的根
    log(e.what());
} catch (...) {                                   // 任意异常：只能转抛或记录，拿不到类型
    log("unknown error");
    throw;                                        // 裸 rethrow：原异常原样上抛
}
```

标准异常层次的设计值得借用：`std::exception` 之下分 `logic_error`（**程序员的错**，本可预防：invalid_argument、out_of_range）与 `runtime_error`（**运行时的错**，无法预防：文件失败、资源耗尽）。这个分层正是[C 篇第 12 篇](../c/12-errors-robustness.md)「assert 管契约、if 管输入」的异常版：logic_error 相当于 assert 的可恢复形态。

自定义异常：继承 `std::runtime_error`（或更贴切的分支），带上上下文字段——不要继承太深（catch 层次难维护）。

### 1.2 零开销成本模型：不抛免费，抛昂贵

异常的常见误解是「C++ 异常很慢」。真实模型分两半：

| 阶段       | 成本                                       |
| ---------- | ------------------------------------------ |
| 不抛异常路径 | **接近零**（表驱动实现：只占少量二进制体积，无运行时检查指令） |
| 抛出一次   | 昂贵：查表 + 栈展开 + 析构链 + 匹配 catch，微秒级 |

「零开销」的含义：`try` 块本身没有运行时代价，正常路径不付钱。代价集中在**抛出**——所以异常的适用性由**失败频率**决定：

- 失败是**例外**（文件不存在、网络断开、配置错误）：抛异常完全合理，正常路径零负担。
- 失败是**常态**（解析用户输入、查找可能不存在的键）：每次失败微秒级的展开成本 × 高频调用 = 灾难。用错误码/optional。

## 2. 栈展开与异常安全（与 RAII 的合流）

[第 4 篇](04-raii.md)已确立栈展开的两条铁律（析构不抛、构造抛异常安全）。这里补全**异常安全等级**的落地清单：

| 等级     | 承诺                             | 谁负责                       |
| -------- | -------------------------------- | ---------------------------- |
| 基本保证 | 无泄漏 + 对象处于有效状态         | 全员 RAII 后自动达成          |
| 强保证   | 异常后状态回滚到调用前            | copy-and-swap / 先副本后提交  |
| 不抛保证 | noexcept 且确实不抛               | 析构、移动、swap、-destructive 操作 |

```cpp
// 强保证的标准形态：全部可能失败的工作在副本上完成，最后 noexcept 提交
Config &Config::operator=(const Config &other) {
    Config tmp(other);              // 可能抛 —— this 未被触碰
    swap(tmp);                      // noexcept 提交
    return *this;
}
```

工程基线：**库代码默认承诺基本保证**（前提是全项目 RAII），关键接口写明强保证；文档不写异常保证 = 对调用方隐瞒半张契约。

## 3. noexcept：接口契约与性能开关

```cpp
void swap(Config &a, Config &b) noexcept;          // 承诺：绝不抛
double fast_path(double x) noexcept;               // 违反承诺 = std::terminate（不是 UB 是死刑）
```

noexcept 的三重身份：

1. **契约**：调用方可以放心在「不能失败」的语境里调用它（析构、扩容迁移）。
2. **性能**：vector 扩容按移动构造是否 noexcept 决定移动/拷贝（[第 5 篇](05-copy-move.md)）；某些优化（移动语义的选择）依赖它。
3. **行为**：noexcept 函数抛异常 → 直接 terminate，不走展开——比「可能异常」更严格，慎用范围：确实不会抛的操作。

历史注脚：C++98 的动态异常规范 `throw(int)` 已废弃——它带来运行时检查负担却不可靠；noexcept 是它的 boolean 化替代，语义是「要么不抛，要么死」。

## 4. 错误码的现代形态

### 4.1 optional：「没有」是正常答案

```cpp
#include <optional>

std::optional<User> find_user(int id) {
    auto row = db.query(id);
    if (!row) return std::nullopt;              // 「找不到」不是错误，是没有
    return User{*row};
}

if (auto u = find_user(42)) {
    use(*u);                                    // 有值：*u / u->field / u.value()
} else {
    create_default();                           // 无值
}
// *find_user(42) 直接解引用：无值时 UB —— optional 不替你检查！
```

optional 的语义边界要刻准：它表达「**结果可能不存在，且不存在是正常情形**」——查找、解析、可选配置。真正的错误（IO 失败、非法输入）不该被折叠成 nullopt（丢失了原因）。

### 4.2 expected：值或错误二选一（C++23）

```cpp
#include <expected>

std::expected<Config, ParseError> load_config(const std::string &path) {
    std::ifstream f(path);
    if (!f) return std::unexpected(ParseError::OpenFailed);
    auto raw = parse(f);                       // expected 链式传播
    if (!raw) return std::unexpected(raw.error());
    return validate(*raw);
}

auto cfg = load_config("app.conf");
if (cfg) use(*cfg);                            // 有值
else log(cfg.error());                         // 错误带原因、可分支 —— 值与错误同路返回
```

`expected<T, E>` 是「错误码 + 结果」的完整类型化：错误不可忽略（不看 error 就拿不到 value），传播可链式，性能与错误码同级。它是 Rust `Result` 的 C++ 对应物；C++23 之前用第三方 expected 或错误码 + 出参。

### 4.3 三种机制的选择决策表

| 失败的性质                     | 工具                    | 理由                         |
| ------------------------------ | ----------------------- | ---------------------------- |
| 违反不变量/程序员错误           | assert / abort          | 不是错误，是 bug             |
| 「没有」是正常情形（查找/解析）  | `optional`              | 类型表达「可能无值」          |
| 可预期失败 + 需要携带原因        | `expected` / 错误码      | 值与错误同路，无展开成本      |
| 构造函数失败                    | 异常（唯一出路）         | 构造无返回值                 |
| 例外性失败（IO/网络/资源）       | 异常                    | 正常路径零成本、传播不侵扰    |
| 热路径高频失败                  | 错误码/expected         | 抛出的微秒级成本不可承受      |

## 5. 异常使用的工程纪律

1. **按引用捕获**：`catch (const std::exception &e)`——按值捕获发生切片（[第 10 篇](10-inheritance.md)），子类信息丢失。
2. **catch 顺序从具体到一般**：基类 catch 会吃掉子类异常，`std::exception` 放最后。
3. **异常不可穿越线程/回调边界**：线程函数里抛出未捕获 → terminate；`std::future` 会把异常搬运到 get() 处重抛（[第 13 篇](13-concurrency.md)）。C 回调边界上必须 catch-all 包裹。
4. **不在异常里放「控制流」**：用异常跳出正常循环/提前返回，代码既慢又不可读——异常是错误通道，不是 goto。
5. **翻译异常在边界**：库把内部异常翻译成自己的异常类型再抛出（避免库的内部类型泄漏到用户代码）；跨模块边界（C 接口、插件）catch-all + 错误码。
6. **日志与吞掉的分界**：catch 后要么处理、要么包装重抛、要么明确记录——「catch 后什么都不做」是最危险的三行代码。

```cpp
// 禁忌示范
try { risky(); }
catch (const std::exception &) {}        // ❌ 吞异常：错误无声消失，下游拿到坏数据

// 边界翻译
int c_api_entry(void) {
    try { return app_main(); }
    catch (const std::exception &e) { log(e.what()); return -1; }   // ✅ C 边界翻译
    catch (...) { return -2; }
}
```

## 6. 陷阱清单

- 热路径高频抛异常：微秒级展开成本；改 expected/错误码。
- 按值捕获异常：切片；const 引用。
- catch(...) 静默吞掉：错误消失；记录或转抛。
- 异常穿越线程/回调边界：terminate；future 传递或边界包裹。
- 用异常做控制流（跳出正常流程）：性能与可读性双输。
- noexcept 函数里抛异常：terminate；只对确实不抛的操作标注。
- 忘记析构不抛：清理路径抛出 → terminate；记录不抛（[第 4 篇](04-raii.md)铁律）。
- optional 解引用前不检查：`*opt` 无值即 UB；if (opt) / value_or。
- expected/optional 丢弃返回值：编译器警告（`[[nodiscard]]`）要开；忽略必须有显式理由。
- 标准异常当基类继承太深：catch 层次混乱；继承 runtime_error/logic_error 一层即可。

## 7. 小结

- C++ 错误处理四工具的分工：assert 管程序员错误、optional 管「正常地没有」、expected/错误码管可预期失败、异常管构造失败与例外性失败。
- 异常的零开销模型：不抛路径接近零成本（表驱动），抛出昂贵（展开 + 析构链）；适用性由失败频率决定。
- 异常安全等级的落地：全员 RAII 自动基本保证；强保证用 copy-and-swap；noexcept 是接口契约（违反即 terminate）+ 性能开关（vector 扩容策略）。
- expected（C++23）把「错误码 + 结果」类型化：不可忽略、可链式传播、与错误码同价。
- 异常纪律：按引用捕获、从具体到一般、不穿越线程/回调边界、不用作控制流、边界处翻译、绝不静默吞掉。
- 文档写明异常安全等级与可能抛出的异常类型——异常保证是接口契约的一半。

## 8. 练习

**1.** 写一个「解析整数」函数的三个版本：抛异常、返回 optional、返回 expected< int, ParseError>，各写调用方代码，比较三种失败情形（空串、非数字、溢出）的表达能力。

> [!TIP]
> 思路异常版失败原因藏在异常类型与 what() 里（要多个异常类才区分）；optional 丢失原因（三种失败同形态）；expected 用 ParseError 枚举完整携带原因且不可忽略。结论：失败需要分类处理时 expected 最优，「有没有值」二元时 optional 足够。

**2.** 用 `std::future` 验证「异常穿越线程」的标准通道：工作线程抛异常，get() 处重抛并被主线程捕获；再写一个裸 std::thread 版本观察 terminate。

> [!TIP]
> 思路`std::async` 返回的 future 在 get() 时重抛工作线程的异常——异常被「存储进共享状态」搬运到等待方。裸 thread 的线程函数未捕获异常直接 terminate。这是「异常不穿越边界，除非通道显式支持」的实证。

**3.** 给第 5 篇的 Text 类（Rule of Five）补异常安全文档：每个操作标注承诺等级（基本/强/不抛），并让移动赋值与 swap 达到不抛保证。

> [!TIP]
> 思路拷贝赋值用 copy-and-swap 升到强保证；移动构造/赋值/swap 标 noexcept（只做指针交换，确实不抛）；析构 delete[] 不抛。「文档标注」本身是这个练习的目标——异常安全是接口契约，不写明的承诺等于没有。

**4.** 讨论：`std::vector::at`（抛 out_of_range）与 `operator[]`（越界 UB）并存的设计理由；你自己的容器该学哪个？

> [!TIP]
> 思路[] 是零开销路径（性能契约），at 是带检查路径（安全契约）——把选择权交给调用方。自有容器照搬：默认 []（快、注释标明「越界 UB」）+ at（调试/边界用途）；debug 构建给 [] 加 assert 是折中。两个入口的成本差异必须真实存在，否则 at 无意义。

**5.** 在一个「无异常构建」（-fno-exceptions）的嵌入式项目中，把第 1 节的 divide 与构造失败的场景改写为错误码方案，列出失去的能力清单。

> [!TIP]
> 思路失去：构造函数的失败通道（只能两段式构造 + bool init() 或工厂返回 expected）；深层传播需手动逐层检查（无展开）；标准库部分接口不可用（如 vector 扩容失败处理策略改变）。收获：零异常表体积、确定性行为。这个练习暴露了「构造失败是异常唯一不可替代场景」这句话的分量。

**6.** 设计库的异常策略：一个 JSON 库，parse 失败、key 类型错误、文件读取失败、内存不足四种失败各用什么机制？写出一个一致的策略表并说明理由。

> [!TIP]
> 思路parse 失败：expected<Json, ParseError>（用户输入驱动、高频、需分类）；key 类型错误：抛（程序员错误，logic_error 系）或 API 设计成 get_if 避免抛；文件读取：抛 runtime_error（例外性、正常路径零成本）；内存不足：让 bad_alloc 自然传播（库不捕不翻译）。策略表的核心是按「失败频率 × 责任归属」分派机制，而不是全局一刀切。
