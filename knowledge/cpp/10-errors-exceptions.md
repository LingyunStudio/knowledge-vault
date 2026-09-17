---
title: 异常与错误处理
order: 10
tags: 进阶, exception, optional
summary: 异常与 RAII 的配合、noexcept 的含义、optional/expected 传错误。
---

C 的错误处理是返回值加 errno，调用方忘了检查就静默吞掉。C++ 增加了异常：throw 把错误沿调用栈向上飞，沿途析构函数自动执行（栈展开）。异常该不该用，C++ 社区至今分歧很大——但机制本身必须懂，因为标准库和所有 RAII 设计都绕不开它。

## 异常的基本机制

```cpp
#include <iostream>
#include <stdexcept>

double div_or_throw(double a, double b) {
    if (b == 0) throw std::invalid_argument("divide by zero");
    return a / b;
}

int main() {
    try {
        div_or_throw(1, 0);
    } catch (const std::invalid_argument& e) {   // 按引用捕获，避免切片
        std::cerr << e.what() << "\n";
    } catch (const std::exception& e) {          // 基类兜底；子类必须写在父类前
        std::cerr << "std error: " << e.what() << "\n";
    }
}
```

要点：throw 一个对象，catch 按**引用**接（按值会切片，虚函数也失效）；`std::exception` 是标准库异常基类，`what()` 返回描述；catch 自上而下按顺序匹配。自定义异常继承 `std::runtime_error` 一族，就能被 `catch (const std::exception&)` 统一接住。

捕获后想继续往上抛，用无参的 `throw;` 重抛**原对象**（保留原类型）；写 `throw e;` 会按 e 的静态类型拷贝，派生类信息被切掉：

```cpp
catch (const std::exception& e) {
    log(e.what());
    throw;              // ✅ 原样继续向上传播
}
```

## 栈展开：异常与 RAII 的天作之合

异常从 throw 点逐层向上传播，路径上所有局部对象按构造逆序析构：

```cpp
void handle_request(const std::string& path) {
    std::ifstream in(path);                 // RAII：文件句柄
    std::vector<Row> rows = parse(in);      // parse 内部可能 throw
    save(rows);                             // 任何一层抛出……
}                                           // ……in 与 rows 照样析构，不泄漏
```

对比 C：每个可能失败的调用都要手工清理已获取的资源。C++ 里只要资源挂在 RAII 对象上，**异常安全就是默认属性**：正常路径和错误路径共用同一份清理代码。这就是 RAII 篇说「异常安全白送」的完整含义。

> [!WARNING]
> 析构函数绝不能让异常逃出去。栈展开期间一个析构函数再抛异常，两个异常同时活跃，程序直接 `std::terminate`。析构里可能失败的清理（flush 文件、关闭连接），要么吞掉记日志，要么另提供显式的 `close()` 让调用方在正常路径处理错误。

## noexcept：承诺与代价

```cpp
void f() noexcept;    // 承诺不抛异常；抛了就 std::terminate
void g();             // 可能抛异常
```

noexcept 的影响远比表面大：

- **调用方优化**：编译器不必为异常传播生成着陆代码，内联更放心
- **容器的选择**：vector 扩容搬移元素时，只对 noexcept 的移动构造用移动（`std::move_if_noexcept`），否则退回拷贝以保证异常安全——移动构造不写 noexcept，性能悄悄变差
- 移动构造、swap 这类不会失败的基础操作，默认都该标 noexcept

> [!NOTE]
> noexcept 不是「我不打算抛」的愿望，而是「抛了就死」的合同。默认构造、移动、swap、析构（析构默认就是 noexcept）适合标注；任何可能失败的 I/O、分配、解析都不要标。

## 不抛异常的错误传递：optional 与 expected

很多「失败」其实是正常业务分支：key 不存在、解析无结果。为此抛异常既慢又搅乱控制流。C++17 提供了 `std::optional`：

```cpp
#include <optional>

std::optional<Article> find_article(const std::string& id) {
    if (auto it = index_.find(id); it != index_.end())
        return it->second;         // 有值
    return std::nullopt;           // 「无值」这个状态本身
}

if (auto a = find_article("raii"))   // optional 可直接做布尔判断
    use(*a);                          // *a 取值，a->title 也可
else
    handle_missing();
```

optional 表达「可能有值」；失败还需要携带原因时，用 `tl::expected<T, E>`（C++23 已标准化为 `std::expected`，C++17 时代普遍用 tl 版本）：

```cpp
tl::expected<Config, std::string> load_config();   // 成功给 Config，失败给原因

auto cfg = load_config();
if (!cfg) { std::cerr << cfg.error() << "\n"; return 1; }
use(*cfg);
```

Rust 读者一眼就懂：optional ≈ `Option`，expected ≈ `Result`。差别是 C++ 没有强制检查——取值前忘了判断照样编译，纪律得自己带。

## 错误处理选型

| 手段 | 适用 | 代价 |
| --- | --- | --- |
| 异常 | 构造函数报错、逐层返回不现实的错误 | 展开路径有成本，错误分支在代码里不可见 |
| `std::optional` | 「没有值」是正常结果 | 每个调用点都要判断 |
| `tl::expected` | 失败需要携带原因 | 引入第三方库（或等 C++23） |
| 错误码 / errno | 与 C 代码交互的边界 | 忘检查就静默吞 |

构造函数只能靠异常报告失败——它没有返回值，这是异常难以彻底禁用的实际原因。

> [!TIP]
> 接手「禁用异常」的工程（游戏、嵌入式常见，编译加 `-fno-exceptions`）时，标准做法是错误码 + expected 风格，RAII 照用不误。RAII 与异常是解耦的：没有异常，析构照样执行，资源管理完全不受影响。

## 练习

- [ ] 写一个解析函数返回 `tl::expected`（或手写 `{bool ok; T value; std::string err;}`），与异常版本对比调用方代码长度
- [ ] 给自定义类型的移动构造分别带与不带 noexcept，用 vector 扩容计时测出差异
- [ ] 在析构函数里 throw，再在另一个 throw 的栈展开路径上触发它，观察 terminate 输出

相关阅读：[RAII 与资源管理](03-raii.md)
