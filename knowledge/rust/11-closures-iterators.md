---
title: 闭包与迭代器
order: 11
tags: 核心, 迭代器, 函数式
summary: Fn/FnMut/FnOnce 三种闭包 trait，以及让集合处理又短又快的迭代器适配器链。
---

闭包与迭代器是 Rust 函数式风格的两根支柱。它们看起来"高级"，实际是**零成本抽象**的样板：编译后与手写循环一样快，甚至更快（省去边界检查、自动向量化）。

## 闭包：捕获环境的匿名函数

```rust
let factor = 3;
let scale = |x: i32| x * factor;      // 捕获外部的 factor
println!("{}", scale(10));             // 30
```

闭包与函数最大的区别：**闭包可以捕获所在作用域的变量**。捕获方式由编译器自动推断，按需取最宽松的——这是理解三种闭包 trait 的关键。

## 三种闭包 trait

| trait | 捕获方式 | 类比 |
| --- | --- | --- |
| `FnOnce` | 拿走捕获变量的所有权（调用一次） | 消费者 |
| `FnMut` | 可变借用捕获变量 | 修改者 |
| `Fn` | 只读借用捕获变量 | 观察者 |

继承关系：`Fn: FnMut: FnOnce`。编译器为每个闭包推断出**最小权限**：

```rust
let name = String::from("Ada");

let greet   = || println!("hi {name}");        // 只读 → Fn
let rename  = || name.clear();                  // 修改 → FnMut
let consume = || drop(name);                    // 拿走 → FnOnce
```

实际接触它们的地方主要是标准库 API 的签名：

```rust
// sort_by 需要 FnMut（就地排序要反复读取比较器）
v.sort_by(|a, b| b.cmp(a));

// map/filter 需要 Fn（惰性、可重复）

// spawn 需要 FnOnce + 'static（任务跑一次，参数进线程）
thread::spawn(move || { ... });
```

> [!IMPORTANT]
> `move` 关键字强制闭包**拿走**所有捕获变量的所有权。最常见于把数据交给线程或 `'static` 任务——不写 move，闭包可能借到即将销毁的栈变量，编译器会拦下。

闭包与 `Fn` trait 结合泛型，可以写出接受"任何比较逻辑"的高阶函数：

```rust
fn find_first<T>(list: &[T], pred: impl Fn(&T) -> bool) -> Option<&T> {
    list.iter().find(|x| pred(x))
}
```

## 迭代器：惰性的处理流水线

`Iterator` trait 的核心只有一个方法：

```rust
pub trait Iterator {
    type Item;
    fn next(&mut self) -> Option<Self::Item>;
    // 其余 70+ 个方法都有默认实现……
}
```

迭代器是**惰性**的：不调用 `next`（或消费方法）就什么也不发生。适配器只是构建新迭代器，真正计算发生在最后一步：

```rust
let v = vec![1, 2, 3, 4, 5];

let sum: i32 = v.iter()
    .filter(|&&x| x % 2 == 1)     // 只记录"要奇数"
    .map(|x| x * x)               // 只记录"要平方"
    .sum();                       // ← 这里才开始真正迭代

let words: Vec<String> = text
    .split_whitespace()
    .map(str::to_lowercase)
    .collect();
```

### 三种迭代视角

| 调用 | 产出 | 所有权 |
| --- | --- | --- |
| `v.iter()` | `&T` | 只读借用 |
| `v.iter_mut()` | `&mut T` | 可变借用 |
| `v.into_iter()` | `T` | 消费集合 |

### 常用适配器速查

| 适配器 | 作用 |
| --- | --- |
| `map` / `filter` | 逐项变换 / 过滤 |
| `filter_map` | 变换 + 过滤（返回 Option）二合一 |
| `flat_map` | 变换后拍平（一对多） |
| `take` / `skip` | 取前 n 个 / 跳过前 n 个 |
| `take_while` / `skip_while` | 条件版 |
| `zip` / `chain` | 配对 / 串联 |
| `enumerate` | 附带下标 |
| `peekable` / `rev` |预览 / 反向 |
| `chunks` / `windows` | 分块 / 滑动窗口 |

### 消费者速查

| 消费者 | 返回 |
| --- | --- |
| `collect()` | 任意集合（Vec / HashMap / String…） |
| `sum()` / `product()` | 聚合数值 |
| `count()` / `max()` / `min()` | 统计 |
| `any()` / `all()` / `find()` | 判定 / 查找（短路） |
| `position()` / `fold()` / `try_fold()` | 下标 / 折叠 |
| `for_each()` | 副作用执行 |

`collect` 的目标类型靠标注推断，二义时用 turbofish：

```rust
let s: String = vec!['h', 'i'].into_iter().collect();
let set = v.iter().copied().collect::<HashSet<i32>>();
```

`filter_map` 实战——把"解析可能失败"变成天然流水线：

```rust
let nums: Vec<i32> = "1, x, 3, y, 5"
    .split(',')
    .filter_map(|s| s.trim().parse().ok())
    .collect();                     // [1, 3, 5]
```

> [!TIP]
> 判断迭代器 vs 手写循环的经验：**逻辑能用"变换+过滤+聚合"描述就用迭代器**；需要提前 break 多层、携带复杂状态或互相跳转时手写循环更清晰。两者性能几乎无差。

## 闭包 + 迭代器的典型组合

```rust
// 分组
let by_ext: HashMap<&str, Vec<&Path>> = files.into_iter()
    .map(|p| (p.extension().and_then(|e| e.to_str()).unwrap_or(""), p))
    .fold(HashMap::new(), |mut m, (ext, p)| {
        m.entry(ext).or_default().push(p);
        m
    });

// 范围生成
let squares: Vec<i32> = (0..10).map(|i| i * i).collect();

// 惰性无限序列
let fib = std::iter::successors(Some((0u64, 1u64)), |&(a, b)| Some((b, a + b)))
    .map(|(a, _)| a)
    .take(10)
    .collect::<Vec<_>>();
```

## 练习

- [ ] 用一条迭代器链统计文本中最长的单词及其长度
- [ ] 用 `successors` 生成前 20 个质数
- [ ] 把一个手写的嵌套循环重构成迭代器链，用 `cargo bench` 或 `time` 对比
