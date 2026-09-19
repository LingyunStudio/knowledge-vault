---
title: JavaScript 基础：类型、this 与原型
order: 5
tags: JS, 闭包, this, 原型, 解构
summary: let/const 与提升、原始与引用类型的复制语义、严格相等与假值表、块级作用域与闭包、this 的四条绑定规则与箭头函数、原型链与 class 的关系、解构与可选链等现代语法，以及 map/filter/reduce 的函数式日常。
---

JS 的学习曲线集中在四个概念：**引用类型的复制语义**（对象赋值不拷贝——与 [C 的指针](../c/04-pointers.md)、[python 的绑定](../python/01-python-model.md)同宗）、**this**（C 系语言没有的动态绑定）、**闭包**（与 [python](../python/04-functions.md) 同构）、**原型**（class 的底层）。本篇按这四块 + 现代语法组织。

## 1. 声明与作用域：let/const 时代

```javascript
const PI = 3.14;        // 常量绑定（对象内容仍可改——绑定不可变，不是值不可变）
let count = 0;          // 可变绑定
count = 1;

var legacy = 1;         // 函数作用域 + 变量提升（历史包袱——现代代码禁用）
```

var 的两个历史陷阱（现代代码用 let/const 规避）：**函数作用域**（块内声明泄漏到函数级）与**提升**（声明前可用、值为 undefined——「用了没声明的变量居然不报错」）。let/const 是块级作用域 + 暂时性死区（声明前访问直接报错）——错误更早暴露，与 [C 篇](../c/01-c-model.md)「声明即初始化」的纪律同向。

## 2. 类型：原始与引用的复制语义

```javascript
// 原始类型（值复制）：number / string / boolean / null / undefined / bigint / symbol
let a = 1;
let b = a;  b = 2;            // a 仍是 1 —— 值拷贝

// 引用类型（引用复制）：object（含数组/函数/日期）
const arr1 = [1, 2];
const arr2 = arr1;            // 同一个数组！
arr2.push(3);                 // arr1 也变成 [1,2,3]

const copy = [...arr1];       // 浅拷贝（一层）
const deep = structuredClone(obj);   // 深拷贝（现代标准 API）
```

「对象赋值是传引用」（[第 1 篇](01-web-model.md)提到的前端与 python 的共同点）——React 状态更新的规则（不可变更新：永远造新对象而非原地改，[第 9 篇](09-react.md)）全部建立在这个语义上。

### 2.1 相等比较与类型转换

```javascript
1 == "1"        // true   —— == 做隐式转换（语义混乱之源）
1 === "1"       // false  —— 严格相等：值 + 类型
NaN === NaN     // false！（[C 篇](../c/02-types.md)的 IEEE 754 同款）
Number.isNaN(NaN)   // 判 NaN 的正确姿势
0.1 + 0.2 === 0.3   // false —— 浮点三兄弟[（C/python）](../c/02-types.md)再次会师

// 假值表（if 里为 false 的全部成员）：
false, 0, -0, 0n, "", null, undefined, NaN
// 其余一切为真：包括 [] 和 {}！（空数组是真——与 python 不同）
```

`===` 是现代 JS 的默认（== 只在 `x == null` 判空这个惯用法里存活）。类型转换的防御：显式 `Number(x)`/`String(x)`/`Boolean(x)`、`+x` 的数字转换惯用法。

## 3. 闭包与作用域链

```javascript
function makeCounter() {
    let n = 0;
    return () => ++n;        // 内层函数捕获外层的 n
}
const c = makeCounter();
c(); c();                    // 1, 2 —— 状态活在闭包里

// 经典陷阱：循环里的 var
for (var i = 0; i < 3; i++) setTimeout(() => console.log(i));   // 3,3,3（var 函数作用域共享 i）
for (let i = 0; i < 3; i++) setTimeout(() => console.log(i));   // 0,1,2（let 每轮一个绑定）
```

闭包与 [python](../python/04-functions.md) 完全同构（捕获变量、惰性/共享的细节差异在 let/var 的作用域语义）。闭包在前端的日常存在感极高：事件回调捕获状态、模块封装私有变量、React hooks 的状态记忆全部依赖它。

## 4. this：调用点决定一切

`this` 是 JS 最独特（也最被诟病）的机制：**它的值由「函数怎么被调用」决定**，不是由定义处决定：

```javascript
const obj = {
    name: "alice",
    greet() { console.log(this.name); }     // this = 调用时的对象
};

obj.greet();            // "alice" —— 方法调用：this = obj
const g = obj.greet;
g();                    // undefined —— 裸调用：this = undefined（严格模式）
setTimeout(obj.greet);  // undefined —— 作为回调传递后「脱离了对象」→ 经典丢失现场
```

四条绑定规则按优先级：**new 调用（新对象）> 显式绑定（call/apply/bind）> 方法调用（点号前的对象）> 默认（undefined/全局）**。

### 4.1 箭头函数：没有自己的 this

```javascript
const timer = {
    seconds: 0,
    start() {
        setInterval(() => {           // ★ 箭头函数：继承定义处的 this（= timer）
            this.seconds++;
        }, 1000);
    }
};

function regular() { this; }          // 普通函数：this 由调用点决定
const arrow = () => this;             // 箭头函数：this = 定义处的外层 this（词法）
```

箭头函数是「this 丢失」问题的官方解：**它没有自己的 this/arguments，沿用词法外层**——回调里要用外层 this 就用箭头函数；需要动态 this（如 DOM 事件里要 this 指向元素）就用普通函数。规则一句话：**「this 要跟着调用点走」用普通函数，「this 要跟着定义走」用箭头函数**。

## 5. 原型与 class：继承的两层皮

```javascript
// class 语法（现代主流）
class Animal {
    constructor(name) { this.name = name; }
    speak() { return `${this.name} makes a sound`; }
}
class Dog extends Animal {
    speak() { return `${super.speak()} (woof)`; }     // 重写 + super
}
```

class 之下是**原型链**：对象的属性查找沿 `__proto__` 链向上走（找不到方法 → 原型 → 原型的原型 → null）——`speak` 其实存在 `Dog.prototype` 上，实例通过原型链共享（与 [python 类的属性查找](../python/07-classes.md)思想一致）。

```javascript
Dog.prototype.speak === d.speak.constructor.prototype.speak;  // 方法在原型上共享
Object.hasOwn(obj, "name");        // 判「自有属性」vs 原型继承来的
```

现代 JS 的实操纪律：**写代码用 class、理解底层知原型**——原型链解释了「为什么方法不占每实例内存」「instanceof 的原理」「JSON 化丢方法」（方法在原型上，序列化只剩数据——对象持久化的固有边界）。

## 6. 现代语法速成

```javascript
// 解构与展开
const { name, age = 18, ...rest } = user;      // 对象解构 + 默认值 + 收集
const [first, , third] = list;                  // 数组解构（跳位）
const merged = { ...defaults, ...options };     // 展开合并（后者覆盖）
const arr3 = [...arr1, ...arr2];

// 可选链与空值合并
const city = user?.address?.city ?? "unknown";  // 安全深入 + 空值默认（?? 只对 null/undefined 生效，0/"" 保留！）
const fn = callback?.();                        // 存在才调用

// 模板字符串
const msg = `Hello ${name}, total: ${price.toFixed(2)}`;
```

`??` 与 `||` 的区别是 [python 篇 or 陷阱](../python/03-control-flow.md)的 JS 版：`||` 对一切假值兜底（0/"" 会被吞）、`??` 只对 null/undefined——「0 是合法值」的场景必须 `??`。

## 7. 数组与对象的方法日常

```javascript
// 函数式三件套（与 [MATLAB](../matlab/09-vectorization.md)、[R](../r/03-subsetting.md) 的向量化同思想）
const names = users.map(u => u.name);                     // 映射：一对一转换
const adults = users.filter(u => u.age >= 18);            // 过滤
const total = orders.reduce((sum, o) => sum + o.amount, 0);  // 归约：折叠成单值

const found = users.find(u => u.id === 42);               // 找第一个（找不到 undefined）
users.some(u => u.admin);                                 // 存在判断
users.every(u => u.active);                               // 全部判断
[...new Set(ids)]                                          // 去重（Set 的展开妙用）

Object.keys(obj); Object.entries(obj); Object.fromEntries(pairs);
arr.sort((a, b) => a.price - b.price);        // ★ sort 原地修改！比较器返回数字
arr.toSorted((a,b) => a.price - b.price);     // 非破坏版（ES2023）
```

map/filter/reduce 是数据处理的心智核心（与 dplyr、pandas、STL 算法同一思想）——前端的大部分「列表渲染/统计」逻辑都是它们的组合。`sort` 的原地修改是 React 不可变更新的经典坑（先 `[...arr].sort()` 或 `toSorted()`）。

## 8. 陷阱清单

- 对象/数组赋值当拷贝：浅拷贝 `[...]`/`{...}`，深拷贝 structuredClone。
- `==` 的隐式转换：统一 `===`；`??` 与 `||` 按语义选（0 是合法值用 ??）。
- 回调里 this 丢失（setTimeout(obj.greet)）：箭头函数包装或 bind。
- 空数组是真值：`if (arr.length)` 而不是 `if (arr)`——与 python 的假值表相反。
- var + 闭包循环陷阱：let 时代基本消灭，读老代码要认识。
- sort 原地修改：React 状态里先复制；比较器别写 `a - b` 于字符串。
- JSON 序列化丢方法/丢 undefined/丢循环引用：对象持久化的边界要知情。
- `for...in` 遍历原型链：遍历数组用 for-of / 遍历自有键用 Object.keys。

## 9. 小结

- JS 的四个深概念：引用语义（不可变更新的根）、闭包（状态与回调的地基）、this（调用点绑定 + 箭头函数的词法逃逸）、原型（class 的底层共享机制）。
- 现代语法标配：let/const、解构/展开、可选链 `?.` 与空值合并 `??`（区别于 `||` 的假值语义）、模板字符串。
- 函数式三件套 map/filter/reduce 是数据处理的日常；sort 的原地语义在不可变更新的框架里是头号小坑。
- 与其他语言的同构点：闭包≈python、引用≈python 绑定、浮点≈C/IEEE 754、原型≈python 类查找——「跨语言概念对齐」让 JS 的怪癖大半变成「熟悉机制的方言」。
- this 的记忆口诀：调用点决定普通函数、定义处决定箭头函数。

## 10. 练习

**1.** 复现「引用 vs 值」：原始类型与对象各做一次赋值修改实验；用展开/structuredClone 做浅深拷贝，验证嵌套对象在浅拷贝下的共享。

> [!TIP]
> 思路浅拷贝的内层对象仍共享——React 更新嵌套状态时逐层展开的原因（`{...state, user: {...state.user, name: "x"}}`）。这是「引用语义 → 框架更新模式」的因果链。

**2.** 复现「this 丢失」三连：方法调用、赋值后裸调用、setTimeout 传方法——分别用箭头包装、bind、箭头属性三种方式修复，并总结每种的适用。

> [!TIP]
> 思路`setTimeout(() => obj.greet())`（包装）、`obj.greet.bind(obj)`（预绑定）、类字段箭头函数（定义时绑定）。三种修复都指向「把 this 钉住」，选型看代码形态。

**3.** 用 reduce 实现三个「聚合」：按部门分组（对象累积）、去重数组（Set 累积）、管道流水（函数组合）——体验 reduce 作为「通用折叠器」的表达力，再判断哪题其实该用 map/filter/Map。

> [!TIP]
> 思路reduce 万能但可读性随复杂度下降——分组其实该用 `Map`/`Object.groupBy`（ES2024）。**reduce 是最后手段不是炫技场**——与[任何语言](../python/06-iterators-generators.md)的 reduce 使用哲学一致。

**4.** 验证假值表与 `??`：分别测试 `0 || "default"` 与 `0 ?? "default"`、`"" ?? "x"`、`[] || "x"`——列出所有意外，总结 JS 假值与 [python 假值](../python/02-data-model.md)的差异表。

> [!TIP]
> 思路最大差异：`[]`/`{}` 在 JS 是真值（python 是假值）——「空容器判断」跨语言必踩。差异表做成随身卡片，跨语言互译时先对表。

**5.** 探索原型链：`Object.getPrototypeOf(dog)` 逐层向上走到 null；用 `Object.hasOwn` 区分自有属性与继承属性；解释 `JSON.stringify(dog)` 为什么丢方法。

> [!TIP]
> 思路原型链的可视化（浏览器 console 的 `__proto__` 展开）比文字有效。JSON 只序列化「数据自有属性」——方法的存储位置（原型）与序列化的边界，解释了「对象持久化天然丢行为」。

**6.** 讨论：为什么 JS 的 this 被大量语言设计者视为「教训」，而箭头函数被视为「补丁的成功」？从「动态作用域 vs 词法作用域」的语言学角度分析 this 的本质（调用点绑定≈动态作用域），并对照 [python 显式 self](../python/07-classes.md) 的设计选择。

> [!TIP]
> 思路this 的调用点绑定本质是「隐式动态作用域」——可预测性差、重构脆弱（赋值传递即丢失）。python 的显式 self 与 JS 箭头函数的词法 this 都是向「词法可预测」的收敛。语言设计的教训：**隐式上下文是便利与脆弱的兑奖券**。
