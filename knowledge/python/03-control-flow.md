---
title: 控制流
order: 3
tags: 基础, if, for
summary: 缩进即语法：if/for/while、range 与 enumerate、三元表达式与 match 语句。
---

Python 用缩进划分代码块——缩进不是风格偏好，是语法本身，官方约定 4 个空格，tab 与空格混用会直接报错。控制流关键字与其他 C 系语言大同小异，但有几个独有结构值得专门记住：for-else、海象运算符和结构化模式匹配。

## if 与真值测试

```python
score = 85
if score >= 90:
    print("优秀")
elif score >= 60:
    print("及格")
else:
    print("不及格")
```

Python 有明确的「真值」约定，if 后面不需要写 `== True` 这类废话：

```python
# 这些值为假：0、0.0、""、[]、()、{}、set()、None、False
# 其余几乎都为真

name = ""
if not name:            # ✅ 惯用：空字符串自然为假
    print("名字不能为空")

if len(name) == 0:      # 能用，但啰嗦
    print("名字不能为空")
```

## for：迭代而非计数

Python 的 for 是「对可迭代对象逐个取值」，不是 C 那种计数循环。任何可迭代对象都能直接遍历：

```python
for ch in "abc":
    print(ch)

for item in [10, 20, 30]:
    print(item)
```

需要下标时用 `enumerate`，而不是 `range(len(...))`：

```python
fruits = ["apple", "banana", "cherry"]

for i, fruit in enumerate(fruits, start=1):   # start 控制起始编号
    print(f"{i}. {fruit}")

# ❌ for i in range(len(fruits)): —— 能跑，但 C 味太重，不地道
```

并行迭代多个序列用 `zip`，以最短的为准：

```python
names = ["Ada", "Bob", "Cara"]
scores = [91, 85]
for name, score in zip(names, scores):
    print(name, score)          # Cara 会被静默丢弃
```

`range(start, stop, step)` 生成整数序列，含头不含尾：

```python
print(list(range(5)))          # [0, 1, 2, 3, 4]
print(list(range(2, 10, 3)))   # [2, 5, 8]
```

> [!TIP]
> 担心两个序列长度不一致被悄悄截断？3.10 起可以 `zip(names, scores, strict=True)`，长度不齐直接抛 ValueError。

## break、continue 与 for-else

`break` 跳出本层循环，`continue` 跳过本轮。独有的是 **else 子句**：循环没有被 `break` 打断时执行——精确表达「找了一圈没找到」：

```python
for n in [2, 4, 6, 9]:
    if n % 2 == 1:
        print(f"发现奇数 {n}")
        break
else:
    print("全是偶数")      # 只在循环正常跑完（未被 break）时执行
```

while 同样支持 else，语义相同。

> [!NOTE]
> for-else 的 else 极易被误解成「循环结束后执行」。准确语义是「没有 break 时执行」——把它默念成 nobreak 就通了。

## 三元表达式与海象运算符

Python 的条件表达式把值放在中间：

```python
parity = "偶数" if n % 2 == 0 else "奇数"
```

海象运算符 `:=`（3.8+）在表达式内部完成赋值，消灭重复求值：

```python
# ❌ 冗长版：readline 写了两遍
line = f.readline()
while line:
    process(line)
    line = f.readline()

# ✅ 海象版：赋值嵌进条件里
while line := f.readline():
    process(line)
```

注意整体要加括号：`:=` 的优先级很低，不加括号是语法错误。

## match 语句（3.10+）

结构化模式匹配，替代 if-elif 长链：

```python
def http_error(status):
    match status:
        case 400:
            return "Bad Request"
        case 401 | 403:          # | 表示多选一
            return "认证问题"
        case 404:
            return "Not Found"
        case _:                  # 相当于 default，必须放最后
            return "未知状态"
```

真正的威力在解构——按形状拆数据，捕获变量直接绑定：

```python
point = (3, 4)
match point:
    case (0, 0):
        print("原点")
    case (0, y):                 # y 是捕获变量，绑定为坐标值
        print(f"y 轴上，y={y}")
    case (x, 0):
        print(f"x 轴上，x={x}")
    case (x, y) if x == y:       # 守卫条件：只有满足才进入
        print("对角线上")
    case _:
        print("任意点")
```

> [!WARNING]
> match 不是 switch 换皮：`case (0, y)` 中的 y 是**捕获变量**，会把值绑定进去，而不是比较名为 y 的常量。想匹配常量必须用点号形式（如 `case Status.OK`）或加守卫条件——这是新手的头号陷阱。

## 练习

- [ ] 用 for-else 改写一个「在列表里找目标，找不到则报错」的函数
- [ ] 写一个 match，把 `(command, args)` 元组按 `("go", direction)` 等模式分发
- [ ] 把一段 `while True: ... if cond: break` 的代码用海象运算符重写

相关阅读：[函数](04-functions.md)
