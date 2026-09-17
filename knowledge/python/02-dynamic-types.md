---
title: 动态类型与基本数据
order: 2
tags: 基础, 类型, 不可变
summary: 一切皆对象：int/str/bool 的不可变性、动态类型与强类型之辨、is 与 ==。
---

Python 里没有「原始类型」——整数、字符串、函数、类本身，统统是对象，都有类型、有身份、有自己的方法。理解了这一点，动态类型的很多「怪现象」都会变得顺理成章。

## 一切皆对象

```python
print(type(42))     # <class 'int'>
print(type("hi"))   # <class 'str'>
print(type(len))    # <class 'builtin_function_or_method'>，函数也是对象
print(type(int))    # <class 'type'>，类型本身也是对象
```

变量不是「盒子」，而是「标签」：赋值只是把名字绑定到某个对象上。每个对象有三个内在属性：

```python
x = 1000
print(type(x))               # 类型：它是谁
print(id(x))                 # 身份：唯一标识（CPython 实现里是内存地址）
print(isinstance(x, int))    # 类型检查惯用 isinstance，而不是 type(x) == int
```

`x = 2000` 不是修改了 x 的内容，而是把标签撕下来贴到另一个对象上；原来的 `1000` 若再无引用，随后被垃圾回收。

## 不可变类型

`int`、`float`、`bool`、`str`、`tuple`、`bytes` 都不可变：对象一旦创建，内容无法修改。

```python
s = "hello"
# s[0] = "H"     # ❌ TypeError: 'str' object does not support item assignment
s = "Hello"      # ✅ 这是重新绑定：指向了新对象，旧对象原封未动
```

所有看似「修改」字符串的操作，实际都在返回新对象：

```python
s = "hello world"
print(s.upper())   # HELLO WORLD，返回新字符串
print(s)           # hello world，s 纹丝不动
```

`int` 在 Python 3 里没有溢出，可以任意大：

```python
print(2 ** 100)    # 1267650600228229401496703205376，位数只受内存限制
```

代价与收益并存：不可变意味着可以安全地共享与作字典键；但也意味着频繁拼接字符串会产生大量临时对象，热点代码请用 `"".join(parts)` 而不是循环 `+=`。

> [!NOTE]
> `bool` 是 `int` 的子类：`True == 1`、`False == 0`，甚至 `True + True == 2`。这是历史包袱，但解释了为什么 `isinstance(True, int)` 返回 True。

## 动态类型，但强类型

这两个词经常被混为一谈，实际说的是两件事：

- **动态类型**：类型检查发生在运行时，变量无需声明类型，一个名字可以先后绑定不同类型的对象
- **强类型**：类型之间不会偷偷自动转换，不兼容的操作直接报错

```python
x = 42          # x 此刻是 int
x = "hello"     # ✅ 合法，x 现在是 str —— 这叫动态类型

"1" + 1         # ❌ TypeError: can only concatenate str (not "int") to str
```

对比 JavaScript 的 `"1" + 1` 得到 `"11"`：那叫弱类型。Python 宁可抛异常也不给你意外结果，想要拼接就显式转换：`"1" + str(1)`。

| | 动态 / 静态 | 强 / 弱 |
| --- | --- | --- |
| Python | 动态 | 强 |
| JavaScript | 动态 | 弱 |
| Java | 静态 | 强 |
| C | 静态 | 弱 |

动态不等于随心所欲——对象身上的类型是不变的，变的是名字的绑定。类型的灵活性由「鸭子类型」承担：只要对象有你需要的方法就能用，见[类与面向对象](07-classes-oop.md)。

## is 与 ==

`==` 比较值是否相等，`is` 比较是否是同一个对象（即 `id()` 是否相同）：

```python
a = [1, 2, 3]
b = [1, 2, 3]
c = a

print(a == b)   # True，值相等
print(a is b)   # False，两个不同的列表对象
print(a is c)   # True，c 与 a 绑定的是同一个对象
```

规则很直接：**和 None 比较用 is，其他一律用 ==**。

```python
if x is None: ...     # ✅ 惯用写法
if x == None: ...     # ❌ 能跑，但不地道
```

原因：None 是全局唯一的单例，`is` 是一次指针比较，既快又不会被自定义的 `__eq__` 干扰。

> [!WARNING]
> 不要用 `is` 比较整数或字符串。CPython 会缓存 -5 到 256 的小整数，`a = 256; b = 256` 时 `a is b` 为 True，换成 257 就可能为 False——这是解释器的实现细节，不是语言承诺，依赖它迟早翻车。

## 数字与字符串速览

```python
# 数字运算
print(7 / 2)     # 3.5，真除法，结果永远是 float
print(7 // 2)    # 3，整除（向下取整，所以 -7 // 2 是 -4）
print(7 % 2)     # 1，取余
print(2 ** 10)   # 1024，幂运算

# float 是 C 的 double，有精度问题；钱相关的计算用 decimal.Decimal
print(0.1 + 0.2)             # 0.30000000000000004

# str：不可变序列，方法众多
print("hello"[1])            # e
print("a,b,c".split(","))    # ['a', 'b', 'c']
print("-".join(["a", "b"]))  # a-b
print(f"{3.14159:.2f}")      # 3.14，f-string 是格式化的现代标配
```

## 练习

- [ ] 验证 `True + True == 2`，并解释 `isinstance(True, int)` 为什么是 True
- [ ] 解释 `a = [1]; b = a; b.append(2)` 之后 `a` 变成 `[1, 2]` 的原因（提示：标签模型）
- [ ] 用 `0.1 + 0.2 == 0.3` 观察结果，再查一下 `math.isclose` 的用法

相关阅读：[内置数据结构](05-data-structures.md)
