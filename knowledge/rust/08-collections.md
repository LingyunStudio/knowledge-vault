---
title: 常用集合
order: 8
tags: 基础, Vec, HashMap
summary: Vec、String、HashMap 三大件：增删改查、所有权规则与性能要点。
---

标准库集合分三类：序列（`Vec`、`VecDeque`）、映射（`HashMap`、`BTreeMap`）、集合（`HashSet`、`BTreeSet`）。日常 90% 的需求由三巨头覆盖：**Vec**、**String**、**HashMap**。它们都把数据放在堆上，因此都遵循 [所有权系统](04-ownership.md)。

## Vec<T>：动态数组

```rust
// 三种创建方式
let mut v1 = Vec::new();
v1.push(1);
let v2 = vec![1, 2, 3];                 // 宏，元素类型自动推断
let v3 = vec![0; 5];                    // 5 个 0

// 读取：下标 vs get
let third = &v2[2];                     // 越界直接 panic
let maybe = v2.get(2);                  // 返回 Option<&i32>，越界给 None

// 遍历
for x in &v2 { println!("{x}"); }       // 只读
for x in &mut v2 { *x *= 10; }          // 就地修改
```

> [!WARNING]
> 借用规则在这里最常见：持有元素引用的同时 `push` 会编译失败——因为 push 可能触发扩容搬迁，旧引用全部悬垂。要么先用完引用，要么用下标/`get` 避免持有引用。

```rust
let mut v = vec![1, 2];
let first = &v[0];
// v.push(3);              // ❌ first 还活着，不允许修改
println!("{first}");
v.push(3);                  // ✅ first 已使用完毕（NLL）
```

常用操作速查：

| 操作 | 代码 | 复杂度 |
| --- | --- | --- |
| 尾部增删 | `push` / `pop` | 均摊 O(1) |
| 随机访问 | `v[i]` / `v.get(i)` | O(1) |
| 插入/删除中间 | `insert(i, x)` / `remove(i)` | O(n) |
| 排序 | `v.sort()` / `v.sort_by_key(\|x\| ...)` | O(n log n) |
| 去重 | `v.sort(); v.dedup();` | O(n log n) |
| 截断/清理 | `v.truncate(n)` / `v.clear()` | — |
| 保留条件 | `v.retain(\|x\| x % 2 == 0)` | O(n) |

## String：UTF-8 字节串

`String` 本质是 `Vec<u8>` 加上"内容必须是合法 UTF-8"的保证：

```rust
let mut s = String::new();
s.push_str("你好");
s.push('!');                    // push 单个 char
let s2 = format!("{s}，世界");   // 拼接首选，不取所有权
let s3 = s + "ok";              // + 会移走 s，注意
```

> [!IMPORTANT]
> **字符串不能按下标索引**。Rust 字符串是 UTF-8 字节序列，一个"字符"占 1~4 字节，`s[3]` 无法定义成"第 3 个字符"。需要遍历时显式选择单位：

```rust
for ch in "héllo".chars() { }       // 按字符（Unicode 标量）
for b  in "héllo".bytes() { }       // 按字节
let hello: &str = &"hello world"[..5];  // 切片必须落在字符边界上，否则 panic
```

## HashMap<K, V>

```rust
use std::collections::HashMap;

let mut scores = HashMap::new();
scores.insert("Alice", 90);
scores.insert("Bob", 85);

// 读取
let a = scores["Alice"];                    // 不存在则 panic
let b = scores.get("Bob").copied();         // Option<V>，不存在不炸

// 遍历（顺序随机！）
for (k, v) in &scores { println!("{k}: {v}"); }
```

所有权：键和值会被 HashMap **拥有**。想用 `&str` 作键又想避免生命周期问题，常见做法是用 `String` 作键、查询时 `get(&key_string)` 或 `get("字面量")`（`&str` 借用查询免费）。

三个高频"更新模式"：

```rust
// 1. entry：不存在才插入
scores.entry("Carol").or_insert(60);

// 2. entry：计数器
let mut counter = HashMap::new();
for word in text.split_whitespace() {
    *counter.entry(word).or_insert(0) += 1;
}

// 3. entry：聚合
*groups.entry(team).or_insert_with(Vec::new).push(member);
```

`entry` API 避免了"先 get 再 insert"的两次哈希，也避免了借用冲突，是 HashMap 的灵魂用法。

选型：需要**有序遍历**用 `BTreeMap`（按键排序），键是枚举/整数且范围固定可考虑数组或 `match`，并发场景用 `dashmap` 这类第三方库。

> [!TIP]
> `HashMap` 默认用 SipHash（抗碰撞攻击）但偏慢。纯内部使用、对性能敏感时，可换 `ahash`/`fxhash` 作为 hasher：`HashMap<K, V, ahash::RandomState>`。

## 集合间的转换

```rust
let v: Vec<i32> = "1 2 3".split_whitespace()
    .map(|s| s.parse().unwrap())
    .collect();                     // 迭代器 → Vec

let set: HashSet<i32> = v.clone().into_iter().collect();
let m: HashMap<&str, i32> = vec![("a", 1), ("b", 2)].into_iter().collect();
```

`collect()` 是迭代器生态的出口，详见 [闭包与迭代器](11-closures-iterators.md)。

## 内存与性能要点

- `Vec::with_capacity(n)` / `String::with_capacity(n)` 预分配，避免反复扩容
- `Vec` 扩容按倍增策略搬迁，搬迁时所有 `&T` 失效（这正是借用规则禁止持引用 push 的原因）
- 删除多个元素用 `retain` 或 `drain`，而不是循环 `remove`（后者 O(n²)）

## 练习

- [ ] 统计一段英文里每个单词的出现次数，按次数降序输出前 10
- [ ] 用 `entry` 实现"用户 ID → 最近 N 条消息"的环形日志
- [ ] 写一个函数把 `Vec<Vec<i32>>` 转置，返回新矩阵
