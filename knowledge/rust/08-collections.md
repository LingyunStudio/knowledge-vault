---
title: 集合：Vec、String 与 HashMap
order: 8
tags: Vec, String, HashMap, entry, UTF-8
summary: Vec 的增删改查与所有权交互（move 进出集合）、String 的 UTF-8 模型与 &str/String 的分工、HashMap 的 entry API 与 key 契约、容量预分配的性能纪律，以及三种集合的所有权流转图。
---

Rust 的三大日常集合——`Vec<T>`（动态数组）、`String`（字符串）、`HashMap<K, V>`（哈希表）——每一个都是「所有权系统」的实战场：元素进集合是 **move**、从集合取值涉及所有权去向、key 要求 Hash + Eq。本篇讲清三者的语义与惯用法。

## 1. Vec<T>：动态数组

```rust
let mut v: Vec<i32> = Vec::new();
v.push(1); v.push(2); v.push(3);              // 尾部追加（摊还 O(1)）
let third = v[2];                              // 索引访问（越界 panic！）
let maybe = v.get(10);                         // 安全访问：Option<&i32>（None 而非 panic）

for x in &v { println!("{x}"); }               // 不可变遍历（借用）
for x in &mut v { *x *= 2; }                   // 可变遍历（解引用修改）

let last = v.pop();                            // Option<i32>：弹出（值的所有权交还给你）
let taken = v.remove(0);                       // 移除指定位置（O(n) 平移）
v.clear();

let v2 = vec![1, 2, 3];                        // 宏：字面量构造
```

Vec 的所有权交互是理解 Rust 集合的钥匙：

```rust
let strings = vec![String::from("a"), String::from("b")];
let s = strings[0];                            // ❌ 编译错误：不能移出集合（ strings 仍拥有）
let s = strings[0].clone();                    // ✅ 克隆一份
let s = strings.into_iter().next().unwrap();   // ✅ into_iter：消费集合，元素所有权移交
```

「**访问 vs 消费**」的分界：`v[i]`/`.get()` 给借用（集合仍拥有），`.into_iter()`/`.remove()`/`.pop()` 给所有权（元素交出来）。想「从集合拿出值但保留集合」的惯用法是 `.remove(index)` 或（元素可 Clone 时）clone——Rust 没有隐式的「复制出来」。

### 1.1 容量与预分配

```rust
let mut v = Vec::with_capacity(1000);          // ★ 已知规模：预分配（免多次扩容拷贝）
for i in 0..1000 { v.push(i); }
// 逐个 push 无预分配：多次 realloc（[MATLAB 的动态增长](../matlab/09-vectorization.md)同款 O(n²) 陷阱）
```

Vec 的容量（capacity）与长度（len）分离——扩容按倍数分配并**移动全部元素**到新内存（与 [C++ vector](../cpp/08-stl-containers.md) 同机制）。`with_capacity` 是热路径的免费午餐。

## 2. String：UTF-8 的世界

```rust
let s = String::from("hello");                 // String：拥有数据的 UTF-8 字节串（可增长）
let st = "hello";                              // &str：字符串切片（借用/字面量）

let s2 = s + " world";                         // 拼接（s 被 move！add 的所有权签名）
let s3 = format!("{s} world");                 // ★ format!：拼接的主流（不 move 左操作数）
```

`&str` 与 `String` 的分工（[第 5 篇](05-borrowing.md)签名惯例的展开）：

| 类型     | 本质                          | 何时用                     |
| -------- | ----------------------------- | -------------------------- |
| `String` | 拥有堆数据的 UTF-8（可变可增长）| 需要拥有/存储/修改          |
| `&str`   | 字符串切片（指向 UTF-8 的借用）| 函数参数（宽输入）、只读视图 |

### 2.1 UTF-8 的两个「不能」

```rust
let s = String::from("héllo");
// s[0]                                        // ❌ 不能按字节下标（UTF-8 变长！索引语义模糊）
let h = s.chars().next();                      // ✅ 字符迭代（char 序列）
let bytes = s.bytes();                          // 字节迭代（u8 序列）
let hello = &s[0..1];                           // ✅ 切片可以——但必须切在字符边界！（切进 UTF-8 中间 panic）
```

String **不可按整数索引**是刻意设计：UTF-8 变长编码下「第 n 个字节」与「第 n 个字符」是两回事，`s[0]` 的语义模糊 → 语言拒绝。切片（&s[0..1]）要求**字符边界**——切到多字节字符中间 panic（内存安全：不能造出非法 UTF-8 的 &str）。

「字符数」的三层（[R 友的第 2 篇](../r/02-vectors.md)与 [python](../python/02-data-model.md) 的 Unicode 讨论）：`s.len()` 是**字节数**、`s.chars().count()` 是 **char 数**（Unicode 标量）、用户感知字符（grapheme）需要第三方库——按业务语义选。

## 3. HashMap<K, V>：键值对

```rust
use std::collections::HashMap;

let mut scores: HashMap<String, i32> = HashMap::new();
scores.insert(String::from("alice"), 95);       // key 与 value 的所有权都被集合收走

let name = String::from("bob");
scores.insert(name, 80);                        // ★ name 被 move 进去（之后不可用）
// &name 传入则保留（insert(&String::from(..)) 需 key 类型配合——惯用：insert(name, ..)）

let score = scores.get("alice");                // Option<&i32>（key 借用 &str 即可：Borrow）
match score { Some(s) => println!("{s}"), None => println!("缺考") }

// ★ entry API：存在则取、不存在则插入——分组/计数的标准件
scores.entry(String::from("carol")).or_insert(0);          // 不存在插入 0
*scores.entry("carol".to_string()).or_insert(0) += 5;       // 原地累加

for (name, score) in &scores {                  // 遍历：无序！（哈希表）
    println!("{name}: {score}");
}
```

entry API 是 HashMap 的灵魂惯用法——「查询或插入」的原子形态：

```rust
// 词频统计（[python defaultdict](../python/05-data-structures.md)、[C++ 的 []](../cpp/08-stl-containers.md) 的对照）
let mut counts = HashMap::new();
for word in words {
    *counts.entry(word).or_insert(0) += 1;      // 一行 = 查无则建 + 累加
}
```

key 的契约：**必须实现 Eq + Hash**（[第 7 篇](07-structs-enums.md)的 derive 成对出现）——相等者必须同哈希（[ds 篇哈希表](../ds/06-hash-table.md)的契约）。f64 不能做 key（NaN 问题——[第 2 篇](02-variables-types.md)）。遍历顺序**不稳定**（随机哈希防碰撞攻击——[SwissTable](../ds/06-hash-table.md)的实现细节）：需要顺序用 BTreeMap（有序树）。

## 4. 其他常用集合

| 集合          | 结构             | 何时用                                     |
| ------------- | ---------------- | ------------------------------------------ |
| `Vec<T>`      | 连续数组          | 默认列表                                    |
| `VecDeque<T>` | 双端队列          | 两端插入弹出（队列/滑动窗口）                |
| `HashMap<K,V>`| 哈希表           | 无序键值查找                                 |
| `BTreeMap<K,V>`| B 树（有序）     | 需要按键序遍历/范围查询                      |
| `HashSet<T>` / `BTreeSet<T>` | 集合 | 去重/成员判断/集合运算                      |
| `BinaryHeap<T>`| 二叉堆           | 优先队列/TopK（[ds 篇](../ds/09-heap-priority-queue.md)）|

选型与 [C++ STL](../cpp/08-stl-containers.md)、[python](../python/05-data-structures.md) 完全同构：**访问模式决定集合**（下标/两端/键查/有序）。

## 5. 陷阱清单

- `v[i]` 越界 panic vs `.get()` 的 Option：不确定长度时用 get（[第 2 篇](02-variables-types.md)边界语义的集合版）。
- `s[0]` 的幻觉：String 不能按索引；chars()/bytes() 二选一按语义。
- 切片切进 UTF-8 中间：panic；is_char_boundary 检查或 chars 处理。
- insert(String) 后继续用原变量（move）：先 clone 或传引用（key 类型用 &str 需生命周期——常见做法是 move 进集合）。
- 期待 HashMap 遍历有序：无序；顺序需求换 BTreeMap 或先 sort。
- 动态增长无预分配：with_capacity（热路径）。
- entry 之外的「先 contains 再 insert」：竞态意义下低效（两次哈希）；entry 一次搞定。

## 6. 小结

- Vec 是默认集合：访问（借用）与消费（into_iter/remove 所有权移交）的分界是所有权交互的核心；with_capacity 是热路径纪律。
- String/&str 的分工（拥有 vs 借用切片）+ UTF-8 的两个不能（无整数索引、切片需字符边界）——「字符数」按语义选 len/chars/graphemes。
- HashMap 的 entry API 是「查无则建 + 累加」的标准件；key 契约 Eq + Hash；遍历无序（防哈希碰撞攻击的设计）。
- 集合选型与 C++/python 同构：访问模式（下标/两端/键查/有序）决定容器。
- 所有权流转贯穿一切集合操作：元素进出集合的所有权图是 Rust 数据结构设计的日常思维。

## 7. 练习

**1.** 实现一个「去重保序」函数 `fn dedup_keep_order(items: Vec<String>) -> Vec<String>`——用 HashSet（seen）+ Vec（order）组合，标注每一步的所有权流动（move/借用/clone）。

> [!TIP]
> 思路遍历时 `seen.insert(item.clone())` 返回 false 才进结果——clone 的位置（key 借用可免 clone：HashSet<&str> 借用遍历再收所有权）。所有权流动的标注练习是本篇核心。

**2.** 词频统计升级版：输入一段文本（含大小写/标点），输出 Top 5 词频——组合 chars/str 方法（分词）、HashMap entry（计数）、sort_by（排序）三个知识点。

> [!TIP]
> 思路`text.to_lowercase()` → 分词（split_whitespace 或过滤标点）→ entry 计数 → `sort_by(|a,b| b.1.cmp(&a.1))` 取前五。跨[第 2~8 篇]的综合。

**3.** UTF-8 实验三连：`"héllo".len()`（6 字节！）与 `chars().count()`（5）；切片 `&s[..2]` 的 panic（é 是两字节）；用 `char_indices` 实现「安全截断到 n 字节但不破坏字符」的函数。

> [!TIP]
> 思路截断的正确姿势：找 `<= n` 的最大字符边界（char_indices 的 offset + char.len_utf8()）。UTF-8 的边界问题在日志截断/网络分包场景是真实事故源。

**4.** 用 HashMap 模拟「学生选课系统」：学生 → 课程集合（HashMap<String, HashSet<String>>），实现选课（entry）、退课（remove）、共同选课（intersection）——练习嵌套集合的所有权与借用。

> [!TIP]
> 思路`entry(student).or_default().insert(course)` 的链式；intersection 需要 borrow 两个集合再 collect——嵌套容器的所有权设计（外层 key move、内层值可变借用）。

**5.** 对比 Vec::with_capacity 的效果：10⁶ 次 push 分别「无预分配」与「with_capacity(1_000_000)」，用 std::time::Instant 计时——复现 [MATLAB](../matlab/09-vectorization.md) 同款实验在 Rust 的结论。

> [!TIP]
> 思路Rust 的 realloc + move 全部元素的成本同样存在（虽比解释型语言轻）。预分配纪律是跨语言的性能通则——量级不同，方向相同。

**6.** 讨论：为什么 Rust 的 String 禁止「按整数索引」而 python 的 str 可以（返回单字符字符串）？从「UTF-8 变长编码下索引语义的模糊性」「O(1) 索引与任意编码的不可兼得」「错误用法的静默危害」分析，并对照 [Rust 安全哲学](01-getting-started.md)——「拒绝实现模糊语义」是不是好设计？

> [!TIP]
> 思路python 的 s[0] 返回「码点字符串」（O(n) 实现），Rust 拒绝提供 O(1) 索引（UTF-8 做不到）并拒绝模糊语义——两种选择都成立，但 Rust 的「编译期拒绝模糊」与其内存安全的哲学一致。设计取舍：便利 vs 语义精确性。
