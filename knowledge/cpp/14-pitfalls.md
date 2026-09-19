---
title: 陷阱全景：一份 C++ 审查清单
order: 14
tags: 代码审查, ODR, 静态初始化顺序, 现代化, 反模式
summary: C++ 特有的 UB 类别（ODR、静态初始化顺序灾难、magic statics），按八个类别组织的全书事故审查清单，C++98→20 的现代化迁移路线，以及与 C 篇清单互补的 PR 审查流程。
---

这是 C++ 篇章的收束，与 [C 篇的陷阱全景](../c/14-pitfalls.md)互为姊妹篇：C 的事故大多发生在「语言不管」的地方（指针、内存、UB），C++ 的机制管住了大半——于是事故转移到了「机制用错位」：拷贝该禁没禁、移动没标 noexcept、生命周期与视图脱节、锁保护的不是不变量。本篇先补三个散点（C++ 特有的链接与初始化暗礁），然后把全书汇编成审查清单与现代化路线。

## 1. 三个散点：C++ 特有的暗礁

### 1.1 ODR：一次定义规则的现代形态

C++ 的「每个外部符号全程序只能有一个定义」（One Definition Rule）在头文件时代变得微妙：**允许重复**的只有 inline 函数、模板、类定义（各 TU 内一致）；**不允许**的是普通函数与全局变量。ODR 违反不保证被诊断——两个 TU 里同名 inline 函数定义不一致，程序可以「看似正常」地跑出精神分裂行为：

```cpp
// a.h
struct Config { int v; };              // 类定义：ODR 允许，但必须各处完全一致
inline int helper(int x) { return x + 1; }   // inline：允许重复（定义必须逐词一致）
```

防御：**头文件只进版本库一处**、`-Wodr`（配合 LTO 才全量检查）、构建系统保证同一头只从一条 include 路径解析。这也是「不要复制粘贴头文件」的深层理由。

### 1.2 静态初始化顺序灾难

不同翻译单元的全局变量初始化顺序**未指定**——A.cpp 的全局变量在构造时读了 B.cpp 的全局对象，而后者可能还没构造：

```cpp
// logger.cpp
Logger g_logger;                        // 构造顺序：？
// main.cpp
extern Logger g_logger;
int init_app() { g_logger.write("hi"); }   // g_logger 构造了吗？未指定！
```

解法按优先级：**消灭跨 TU 的全局对象依赖**（依赖注入）；必须全局时用 **Meyer's singleton**——函数内 static 局部变量，C++11 起标准保证其初始化**线程安全且首次调用时执行**（magic statics）：

```cpp
Logger &logger() {
    static Logger instance;             // 首次调用时构造，顺序确定，线程安全
    return instance;
}
```

代价是首次调用的同步检查（通常可忽略）与「析构顺序仍可能有问题」（跨单例互指时）。这把 C 篇的「全局可变状态三问」升级成了「全局对象四问」：重入、测试、并发、**初始化顺序**。

### 1.3 未初始化成员：构造函数的漏网之鱼

```cpp
class Widget {
    int count_;                 // 构造函数没碰它 → 垃圾值
public:
    Widget() {}                 // ❌ count_ 未初始化
};
```

编译器对「成员未初始化」的静态检查不完整（复杂路径漏检）。铁律：**所有成员要么类内初始化器 `int count_ = 0;`，要么在每个构造函数的初始化列表里覆盖**。类内初始化器是默认姿势——它把「这个成员的默认值是什么」写成一处真相。

## 2. 审查清单：八个类别

### 2.1 资源与 RAII（第 4 篇）

- [ ] 裸 new/delete 只存在于智能指针/容器内部，应用代码零出现
- [ ] 手动 acquire/release（fopen、lock、fd）全部有 RAII 包装
- [ ] 析构函数不抛异常；需要报告结果的清理有显式 close
- [ ] 构造函数完成即有效（不变量成立），失败即抛
- [ ] 异常安全等级（基本/强）有文档承诺

### 2.2 所有权与智能指针（第 6 篇）

- [ ] 所有权的答案在签名里：unique/shared/裸指针（借用）语义正确
- [ ] unique_ptr 是默认，shared_ptr 有存在理由（共享生存期）
- [ ] 回指/观察用 weak_ptr；所有权图无环
- [ ] make_unique/make_shared 而非裸 new
- [ ] get() 的指针只借用不长期持有

### 2.3 类设计（第 3 篇）

- [ ] 不变量一句话说得清；成员全部 private
- [ ] Rule of Zero 优先；手写资源管理的类 Rule of Five 全套或显式 delete
- [ ] 移动构造/赋值/swap 标 noexcept
- [ ] 成员全部类内初始化或初始化列表覆盖；列表顺序 = 声明顺序
- [ ] 单参构造 explicit；多态基类虚析构
- [ ] 重写带 override；构造/析构中不调虚函数

### 2.4 模板与泛型（第 7 篇）

- [ ] 模板定义在头文件或显式实例化
- [ ] 新模板用 concepts 表达约束；模板内 static_assert 前置检查
- [ ] 类型分支用 if constexpr 而非重载技巧
- [ ] 热点模板考虑 extern template 控制膨胀
- [ ] 泛型参数的拷贝/移动行为符合预期（转发引用 vs 值）

### 2.5 容器与算法（第 8、9 篇）

- [ ] 选型过决策树：vector 默认、关联容器按需求
- [ ] map 查询用 find/at，计数才用 []/try_emplace
- [ ] 迭代器失效规则核对：扩容/erase/insert 后不再用旧迭代器
- [ ] 已知规模 reserve；边遍历边删用 erase 返回值或 erase_if
- [ ] lambda 捕获显式；跨作用域 lambda 按值/move 捕获
- [ ] 比较器满足严格弱序（无 <=、无 NaN）

### 2.6 错误处理（第 11 篇）

- [ ] 机制按失败性质选：assert 管契约、optional 管「没有」、expected/错误码管可预期、异常管构造与例外
- [ ] 异常按引用捕获、catch 顺序具体到一般
- [ ] 异常不穿越线程/回调边界（future 通道或边界包裹）
- [ ] 无静默 catch；返回值 [[nodiscard]] 生效
- [ ] 构造失败用异常（唯一出路），不搞半构造对象

### 2.7 并发（第 13 篇）

- [ ] 每个共享可变状态有书面同步策略
- [ ] RAII 锁守卫；多锁 scoped_lock/锁序
- [ ] 条件变量谓词等待；notify 解锁后
- [ ] atomic 只用于单变量；内存序默认 seq_cst
- [ ] jthread 或显式 join；线程池化
- [ ] CI 跑 TSan

### 2.8 工程与构建（第 1、10 篇）

- [ ] `-std=c++17/20 -Wall -Wextra -Werror`；sanitizer 三配置
- [ ] 头文件无 `using namespace`；include 最小化
- [ ] 全局对象无跨 TU 构造依赖（或 Meyer's singleton）
- [ ] ODR 卫生：头文件单源、无复制粘贴定义
- [ ] 单元测试在 sanitized 配置下全绿

## 3. PR 审查顺序

1. **接口先行**：新函数/类的签名——参数是 view/引用/值？所有权谁接？错误怎么报？异常保证什么等级？签名决定一切下游质量。
2. **生命周期**：每个对象的诞生到死亡；视图/借用/引用有没有超出被指物的寿命；lambda 捕获的寿命。
3. **资源流**：RAII 覆盖度；异常路径资源不漏；拷贝/移动语义符合设计。
4. **不变量**：锁保护的是不变量吗？构造后有效吗？
5. **跑 sanitized + TSan 构建**：合并前最后一道闸。

与 C 篇的清单合用：**底层 C 代码按 C 清单，C++ 层按本清单**——两者共享「流程替代小心」的哲学。

## 4. 反模式速查

| 反模式                                         | 一句话修复                          |
| ---------------------------------------------- | ----------------------------------- |
| 裸 new/delete                                   | make_unique；容器                    |
| `using namespace std;` 进头文件                  | 删；显式限定                         |
| 手动 lock/unlock                                 | lock_guard/scoped_lock               |
| shared_ptr 当默认智能指针                         | unique_ptr 默认；shared 要理由       |
| `for (auto x : 大容器)`                           | `const auto&`                        |
| `map[k]` 当查询                                  | find/at                              |
| 裸 wait 无谓词                                   | 谓词版 wait                          |
| 移动构造不 noexcept                              | 加 noexcept（vector 扩容在等你）      |
| catch 后空块                                     | 记录/转抛/处理                       |
| `auto x = v[0]` 不知类型                          | 说出类型再写 auto                    |
| 返回 string_view 指向临时                         | 返回 string                          |
| `return std::move(local)`                        | 直接 return（RVO）                   |
| 循环里 `strlen`/重复求和                          | 缓存；ranges                         |
| dynamic_cast 主控制流                            | 虚函数/variant                       |
| assert 检查用户输入                              | 运行时检查 + 错误码                  |
| 全局对象互相依赖                                 | Meyer's singleton / 依赖注入          |

## 5. 现代化路线：从 C++98 到 C++20

存量代码的迁移按「收益/风险」排序，每步都可独立验证：

| 阶段                       | 动作                                                        | 收益                |
| -------------------------- | ----------------------------------------------------------- | ------------------- |
| C++98 → 11（风险最低）      | 裸指针→unique_ptr；auto 替代冗长迭代器类型；range-for；nullptr；移动语义接管 Rule of Three | 内存安全 + 可读性    |
| 11 → 14                    | 泛型 lambda；make_unique 补全                                | 表达力              |
| 14 → 17（第二波）           | if constexpr 替代 SFINAE；结构化绑定；optional/variant/string_view 进接口；scoped_lock；[[nodiscard]] | 接口自文档化        |
| 17 → 20（第三波，按需）     | concepts 替代 enable_if；ranges 管道；span；format；jthread   | 约束报错 + 惰性管道  |

迁移纪律：**一次一档标准 + sanitizer 全绿 + 基准测试无回归**；clang-tidy 的 modernize 检查组是半自动迁移的主力（`std::make_unique` 化、range-for 化、override 补全），人工审查收敛语义差异（auto 拷贝、view 悬垂）。

## 6. 小结

- C++ 特有暗礁：ODR 的静默违反（头文件卫生 + LTO 检查）、静态初始化顺序未指定（Meyer's singleton 化解）、成员未初始化（类内初始化器默认）。
- 审查清单八类别覆盖全书事故；签名审查先行——所有权、错误机制、异常保证都该在读实现之前从签名读出。
- 与 C 清单分工：C++ 机制层用本清单，底层 C 惯性代码用 C 清单；两者都以「流程替代小心」为哲学。
- 反模式速查是条件反射层；现代化迁移按「一次一档 + sanitizer 全绿 + 基准无回归」推进，clang-tidy 半自动化。

## 7. 练习

**1.** 复现静态初始化顺序灾难：两个 .cpp 互相依赖的全局对象，观察构造顺序未指定导致的行为；用 Meyer's singleton 修复并解释 magic statics 的语义。

> [!TIP]
> 思路A.cpp 全局 `Registry g_reg`，B.cpp 的全局对象构造时往 g_reg 注册——B 先构造时 g_reg 尚未诞生（未指定顺序），行为随机。修复：`Registry& registry()` 函数内 static——首次调用构造，顺序由调用时序天然确定且线程安全。

**2.** 用 clang-tidy（modernize 组）扫描一段 C++98 风格代码，统计自动修复项与人工项的比例，体验半自动迁移的工作流。

> [!TIP]
> 思路自动项：make_unique、range-for、nullptr、override；人工项：auto 拷贝语义判断、view 悬垂、Rule of Three→Five 语义判断。比例通常 7:3——工具管机械项，人管语义项，这就是「半自动」的分工。

**3.** 用本篇八类清单审查你之前 13 篇练习写的代码（挑一个模块），记录每类发现的问题数与分布，和 C 篇审查练习的结果对比。

> [!TIP]
> 思路典型分布：C++ 层「类设计与资源」问题最多（Rule of Five 不全、noexcept 缺失），C 层「指针与边界」最多。两类问题都指向同一个根：机制接管了的地方事故消失，机制没接管的地方事故照旧——这解释了「C++ 不是安全语言，是安全机制更多的语言」。

**4.** 设计团队的「C++ 准入规约」：从八类清单挑 CI 可自动验证项（≥8 条）与人工评审项（≥5 条），并说明每条归入哪类的理由。

> [!TIP]
> 思路自动项：-Werror、clang-tidy 白名单、[[nodiscard]]、禁止裸 new（正则/clang-tidy）、TSan 全绿、include-what-you-use、override 强制、benchmark 无回归。人工项：所有权设计、异常保证文档、不变量陈述、锁保护对象、view 生命周期。自动项越多，人工评审越聚焦设计——与 C 篇准入练习互为对照。

**5.** 讨论：本篇清单与 [C 篇清单](../c/14-pitfalls.md)各有一条「元规则」级别的差异（C 靠流程防 UB，C++ 靠类型把错误变成编译期）。挑三个具体事故，展示它们在两种语言里分别从哪个层面被拦截。

> [!TIP]
> 思路示例：越界——C 靠 sanitizer 运行时抓，C++ 可用 at/编译期 array；所有权——C 靠约定+工具，C++ 靠 unique_ptr 类型化；接口契约——C 靠文档，C++ 靠 concepts/类型。规律：C++ 把 C 的「运行时检查」上移成「编译期拒绝」，但 ABI 边界、UB 本体、并发内存模型仍是 C 的世界——两层清单因此都必要。
