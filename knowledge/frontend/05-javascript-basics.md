---
title: JavaScript 基础
order: 5
tags: 核心, JS, 类型
summary: let/const、类型与 === 相等、函数与箭头函数、模板字符串。
---

JavaScript 是唯一原生跑在浏览器里的语言：动态类型、函数是一等公民。它最初只为写小脚本而生，二十多年长成了通用语言，于是留下"新老两套写法并存"的历史包袱——本篇只教该用的那套：`let/const`、严格相等、箭头函数、模板字符串。

## 变量：let 与 const

```javascript
let count = 0;      // 会被重新赋值的变量
count += 1;

const name = "Ada"; // 不会重新赋值的绑定——声明变量时默认选它
// name = "Bob";    // ❌ TypeError: Assignment to constant variable

const user = { name: "Ada" };
user.name = "Bob";  // ✅ 合法！const 锁的是"绑定"，不是对象内容
user.age = 36;      // 加属性也没问题
// user = {};       // ❌ 只有整体重新赋值才被禁止
```

`const` 的准确含义：**这个变量名不能再指向别的东西**，对象内部属性照改不误。想让对象也不许改，得用 `Object.freeze()`（且只冻结一层）。

> [!WARNING]
> `var` 是历史遗留：函数级作用域、变量提升，会产生反直觉的 bug。新代码一律 `const` 优先，需要重新赋值才用 `let`，永远不写 `var`。

## 类型与相等

七种原始类型：`number`、`string`、`boolean`、`undefined`、`null`、`symbol`、`bigint`；其余全是对象，数组、函数也是对象。

`typeof` 有两个著名的坑：

```javascript
typeof 42;             // "number"
typeof "hi";           // "string"
typeof undefined;      // "undefined"
typeof null;           // "object"   ← 二十年没修的历史 bug，背下来
typeof [1, 2];         // "object"   ← 判断数组要用 Array.isArray(arr)
typeof function () {}; // "function"
```

相等判断只有一条纪律：**永远用 `===`**。`==` 会先把两边转成同类型再比（隐式转换），规则晦涩：

| 表达式 | 结果 | 原因 |
| --- | --- | --- |
| `1 == "1"` | `true` | 字符串转成数字再比 |
| `0 == ""` | `true` | 空串转成 0 |
| `null == undefined` | `true` | 规范特批的特例 |
| `NaN == NaN` | `false` | NaN 不等于任何值，包括自身 |
| `1 === "1"` | `false` | 类型不同直接 false |

`===` 不做类型转换：类型不同即 `false`，同类型才比值。判空用显式写法：

```javascript
if (x === null || x === undefined) { /* … */ }
const port = config?.port ?? 3000;   // ?? 只在 null/undefined 时取右值
```

> [!TIP]
> `==` 仅存一个社区默许的用法：`x == null` 等价于 `x === null || x === undefined`。除此之外，代码评审里见到 `==` 就当 bug 处理。

## 函数与箭头函数

```javascript
// 函数声明：会提升，可以先调用后定义
function add(a, b) {
  return a + b;
}

// 函数表达式：赋值给变量
const sub = function (a, b) {
  return a - b;
};

// 箭头函数：现代默认写法
const mul = (a, b) => a * b;          // 单表达式，隐式 return
const square = n => n * n;            // 单参数可省括号
const make = () => ({ value: 1 });    // 返回对象字面量要多包一层括号
```

箭头函数与普通函数最大的差别是 `this`：普通函数的 `this` 由**调用方式**决定，箭头函数没有自己的 `this`，沿用**定义处**的。写回调时这是优点：

```javascript
const timer = {
  seconds: 0,
  start() {
    setInterval(() => {
      this.seconds += 1;   // ✅ 箭头函数的 this 沿用 start() 的 this
    }, 1000);
  },
};
// 若换成普通 function，this 会指向别处，seconds 悄悄加错了地方
```

经验法则：需要 `this` 的地方（对象方法、类方法）用方法简写，其余回调一律箭头函数。

## 模板字符串与现代速记

```javascript
const user = { name: "Ada", score: 92 };

// 模板字符串：反引号 + ${}，多行文本天然支持
const msg = `${user.name} 的成绩是 ${user.score} 分，${user.score >= 60 ? "及格" : "不及格"}`;

// 解构赋值：从对象 / 数组里"拆"字段
const { name, score } = user;
const [first, second] = [10, 20];

// 展开运算符：复制与合并（浅拷贝）
const updated = { ...user, score: 100 };   // 覆盖 score，其余原样
const nums = [...[1, 2], ...[3, 4]];       // [1, 2, 3, 4]

// 可选链：对付"可能没有"的嵌套数据，中途为 null/undefined 就短路返回 undefined
const city = user.address?.city;           // address 不存在也不会报错
```

数组方法 `map` / `filter` / `find` / `includes` 配箭头函数，是 JS 日常读写的主旋律。本篇所有例子都建议在浏览器 Console 里亲手敲一遍。

## 练习

- [ ] 在 Console 里验证 `typeof null` 和 `0 == ""`，亲眼看到这两个坑
- [ ] 写箭头函数 `formatPrice(n)`，用模板字符串输出 `￥12.50`（保留两位小数）
- [ ] 用解构加展开运算符写出 `increment(state)`：返回 `{ ...state, count: state.count + 1 }`

相关阅读：[DOM 与事件](06-dom-events.md)
