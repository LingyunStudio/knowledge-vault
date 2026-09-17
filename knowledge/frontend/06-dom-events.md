---
title: DOM 与事件
order: 6
tags: 核心, DOM, 事件
summary: 查询与操作节点、事件监听与冒泡、事件委托模式。
---

DOM 是 HTML 在内存里的树形表示，JS 通过它读写页面；事件是浏览器通知你"用户做了什么"的机制。框架普及后手写 DOM 少了，但事件模型——尤其冒泡与委托——是理解 React 合成事件等框架机制的前置知识，值得一次学透。

## 查询节点

```javascript
// 现代标准：参数就是 CSS 选择器
const btn = document.querySelector("#submit");        // 第一个匹配
const items = document.querySelectorAll(".item");     // 全部匹配，静态 NodeList，可 forEach

// 老 API，旧代码里仍常见
document.getElementById("app");
document.getElementsByClassName("item");
```

注意 `querySelectorAll` 返回的是**静态快照**：查询之后新加进 DOM 的节点不会自动出现在结果里，需要重新查询。

## 操作节点

```javascript
const el = document.querySelector(".card");

// 文本：textContent 当纯文本，innerHTML 当 HTML 解析
el.textContent = "<b>就当普通文字</b>";     // 安全，原样显示
el.innerHTML = "<b>当标签解析</b>";         // 能渲染标签，也有 XSS 风险，见下

// class：用 classList，别手拼 className 字符串
el.classList.add("active");
el.classList.toggle("open");                // 有则删，无则加
el.classList.contains("active");            // true / false

// 自定义数据：data-* 属性 ↔ dataset
el.dataset.userId = "42";                   // 对应 HTML 上的 data-user-id="42"

// 内联样式：属性名用驼峰
el.style.backgroundColor = "teal";

// 增删节点
const li = document.createElement("li");
li.textContent = "新条目";
document.querySelector("ul").append(li);    // 追加到末尾
li.remove();                                // 删除自己
```

> [!WARNING]
> `innerHTML` 拼接用户输入就是 XSS 漏洞：用户提交一段 `<img src=x onerror="steal(document.cookie)">`，页面就替攻击者执行了脚本。内容来自用户时一律用 `textContent`；确需渲染 HTML，先经过消毒（sanitize）处理。

## 事件监听

```javascript
const btn = document.querySelector("#submit");

btn.addEventListener("click", (event) => {
  event.preventDefault();             // 阻止默认行为（如表单提交刷新页面）
  console.log(event.target);          // 实际触发事件的元素
  console.log(event.currentTarget);   // 当前挂着这个监听器的元素
});

// 回调要传参时，包一层箭头函数
btn.addEventListener("click", () => handleSubmit("login"));

// 移除监听必须传同一个函数引用
function onClick() {}
btn.addEventListener("click", onClick);
btn.removeEventListener("click", onClick);
```

高频事件：`click`、`input`（每敲一个字符触发）、`change`（值变化且失焦）、`submit`（表单）、`keydown`、`scroll`、`DOMContentLoaded`（DOM 就绪）。

## 冒泡与捕获：事件流动的两个阶段

点击页面最深处的元素，事件不是原地发生，而是走一个往返：

1. **捕获阶段**：从 `document` 向下一路找目标（外 → 内）
2. **目标阶段**：到达被点击的元素本身
3. **冒泡阶段**：从目标向上逐层返回（内 → 外）

监听器默认挂在**冒泡阶段**；第三个参数传 `true` 才挂到捕获阶段：

```javascript
// 冒泡（默认）：button 的监听先执行，外层 div 的后执行
button.addEventListener("click", onButton);
div.addEventListener("click", onDiv);

// 捕获：div 的监听反而先于 button 执行
div.addEventListener("click", onCapture, true);

event.stopPropagation();   // 切断继续流动——会让委托失效，慎用
```

由此得到关键直觉：**子元素的事件会一路"冒"给所有祖先**。祖先不需要给每个后代绑监听，绑在自己身上就能收到所有后代的事件——这就是事件委托。

> [!NOTE]
> 记忆方向：捕获像快递分拣，从总部逐层下沉到你家（外 → 内）；冒泡像寄件，从你家逐级上交（内 → 外）。先捕获后冒泡，规范顺序不可颠倒。

## 事件委托：一个监听管一片

需求：列表项会动态增删，逐项绑监听既啰嗦又会漏。委托的做法是把监听绑在**父元素**上，用 `event.target` 判断真正被点的是谁：

```javascript
const list = document.querySelector("#todo-list");

list.addEventListener("click", (event) => {
  const item = event.target.closest("li");    // 从点击处向上找最近的 li
  if (!item || !list.contains(item)) return;  // 点在列表外就忽略
  item.classList.toggle("done");
});

// 之后动态添加的 li 天生被覆盖，不需要重新绑
const li = document.createElement("li");
li.textContent = "动态添加的条目";
list.append(li);
```

委托的收益有三层：监听器数量从 N 降到 1；动态子元素零成本接入；长列表下内存占用显著更低。这是 DOM 时代最重要的模式，也是 React 列表事件优化的底层思路。

> [!TIP]
> `closest(selector)` 从自身向上找最近的匹配祖先，是委托的黄金搭档；而 `stopPropagation` 会切断委托赖以工作的冒泡，除非明确知道在做什么，否则别碰。

## 练习

- [ ] 做一个 todo 列表：输入 + 添加按钮 + 点击条目切换完成状态，事件全部用委托
- [ ] 给 document 分别挂捕获和冒泡阶段的 click 监听，观察 Console 里的触发顺序
- [ ] 用 `event.target.dataset` 实现点击不同按钮执行不同操作，全程只绑一个监听器

相关阅读：[JavaScript 基础](05-javascript-basics.md)
