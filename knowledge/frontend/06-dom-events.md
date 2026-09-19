---
title: DOM 与事件：页面的操作与响应
order: 6
tags: DOM, 事件, 事件委托, innerHTML
summary: DOM 树与节点查询、元素创建与修改的安全边界（innerHTML 的 XSS 面）、classList 与样式批量更新（重排/重绘的性能账）、事件模型（捕获/冒泡/委托）、常用事件族与 Observer 家族，以及框架出现前后的 DOM 心智。
---

DOM（Document Object Model）是浏览器把 HTML 解析成的**对象树**——JS 操作页面 = 操作这棵树。原生 DOM 操作是框架的底层（React 的 diff 最终也是 DOM 更新），理解它才能理解框架在做什么、为什么那样做。

## 1. 查询与遍历

```javascript
// 现代查询：querySelector 全家（CSS 选择器语法）
const el  = document.querySelector(".card");        // 第一个匹配
const els = document.querySelectorAll(".card");     // 全部（NodeList，静态快照）
document.getElementById("app");                     // id 专用（最快）
el.closest(".modal");                               // 向上找最近的匹配祖先（事件委托的搭档）
el.matches(":disabled");                            // 自身是否匹配
```

NodeList 的遍历：`forEach` 可用；需要 map/filter 时 `[...els]` 展开成数组。注意 `querySelectorAll` 返回**静态快照**（之后 DOM 变化不反映）——动态集合用 `getElementsByClassName`（live）或每次重新查询。

## 2. 创建与修改

```javascript
// 安全的方式：createElement + textContent
const li = document.createElement("li");
li.textContent = userInput;                 // ★ textContent 是纯文本：用户输入安全
li.className = "item";
list.append(li);                            // 追加（append/appendPrepend 支持 Node 与字符串、多参数）

// ⚠️ 危险的方式：innerHTML 解析为 HTML
list.innerHTML = `<li>${userInput}</li>`;   // userInput = "<img onerror=alert(1)>" → XSS！
```

**textContent 与 innerHTML 的分界是安全线**：用户输入一律 textContent（纯文本）——innerHTML 会把字符串当 HTML 解析，`<img onerror=...>`、`<script>`（经由内联事件）都能执行（XSS 攻击，[第 10 篇](10-http-storage.md)详述）。确需模板化 HTML 时用 `<template>` 元素 + 克隆，或框架的转义渲染。

```html
<template id="row-tpl">                     <!-- 模板：不渲染、克隆使用 -->
    <li class="item"><span class="name"></span></li>
</template>
```

```javascript
const tpl = document.getElementById("row-tpl");
const node = tpl.content.cloneNode(true);   // 深克隆
node.querySelector(".name").textContent = user.name;   // 填充（textContent 安全）
list.append(node);
```

## 3. 属性、class 与样式

```javascript
el.setAttribute("href", "/about");          // 通用属性
el.dataset.userId = "42";                   // data-user-id 属性（dataset 映射）
el.disabled = true;                          // 常见属性有直接 property 映射（prop vs attr 的差异）
el.classList.add("active");                  // ★ classList：增删切换（替代 className 拼串）
el.classList.toggle("open", condition);

el.style.color = "red";                      // 内联样式（单值微调）
getComputedStyle(el).fontSize;               // 计算后的最终值（[CSS 级联](03-css-basics.md)的结果）
el.style.setProperty("--brand", "#f00");     // 设置 CSS 变量（JS 与 CSS 的令牌通道）
```

「property 与 attribute」的微妙差异：attribute 是 HTML 标签上的初始值，property 是 DOM 对象的当前值（`input.value` 用户输入后 property 变、attribute 不变）——表单取值一律用 property。

### 3.1 样式更新的性能账

```javascript
// ❌ 循环里逐条改样式：每次都可能触发重排（layout）
for (const el of items) { el.style.height = x + "px"; read(el.offsetHeight); }

// ✅ 批量：读写分离 + class 切换
items.forEach(el => el.classList.add("tall"));   // 一次重排
// 更优：改 CSS 变量 / transform（不触发布局，走合成层）
el.style.transform = `translateX(${x}px)`;       // 动画的首选属性
```

改样式引发的渲染成本阶梯：**transform/opacity（合成，最便宜）< 普通绘制 < 布局属性（width/top——触发重排，最贵）**。动画只动 transform 与 opacity 是性能铁律（[第 1 篇](01-web-model.md)渲染流水线的直接推论）。

## 4. 事件模型：捕获、冒泡与委托

```javascript
el.addEventListener("click", (e) => { ... });   // 标准绑定（替代 onclick 属性）
el.removeEventListener("click", handler);       // 移除（同一个函数引用！）

e.preventDefault();       // 阻止默认行为（表单提交/链接跳转）
e.stopPropagation();      // 阻止继续传播（慎用——破坏委托与全局监听）
```

事件传播三阶段：**捕获（window→目标）→ 目标 → 冒泡（目标→window）**——默认在冒泡阶段处理。「事件先在子元素、再冒到父元素」的特性成就了**事件委托**：

```javascript
// 委托：在父元素上监听，处理所有子元素的事件
list.addEventListener("click", (e) => {
    const btn = e.target.closest("button.delete");    // 从点击点向上找目标
    if (!btn) return;
    removeItem(btn.dataset.id);                       // 子元素再多也只有一个监听器
});
```

委托的三个收益：**动态添加的子元素自动被覆盖**（不用重新绑）、**内存省**（一个监听器 vs 一百个）、**清理简单**。它是 React 合成事件系统的底层原理（[第 9 篇](09-react.md)）。

## 5. 常用事件族

| 类别   | 事件                                     | 要点                                  |
| ------ | ---------------------------------------- | ------------------------------------- |
| 鼠标   | `click`、`dblclick`、`contextmenu`        | click 在移动端有 300ms 延迟史（现已解决）|
| 表单   | `input`（即时）、`change`（值定）、`submit` | submit 绑在 form 上；input 防抖搜索    |
| 键盘   | `keydown`、`keyup`                         | e.key 判断（"Escape"/"Enter"）         |
| 滚动   | `scroll`（元素/window）                    | 高频触发——防抖/节流 + IntersectionObserver 替代 |
| 加载   | `DOMContentLoaded`、`load`、`beforeunload` | DOM 就绪 vs 资源全载                   |

现代替代者 **IntersectionObserver**（元素进入视口的异步通知）：懒加载图片、无限滚动、曝光埋点——替代 scroll 事件的持续监听（性能与简洁双赢）。同族的还有 MutationObserver（DOM 变化）与 ResizeObserver（尺寸变化）——**Observer 家族是「高频事件轮询」的异步事件化**。

## 6. 防抖与节流

```javascript
// 防抖：停止触发 N ms 后才执行（搜索输入的标配）
function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
input.addEventListener("input", debounce(search, 300));

// 节流：每 N ms 最多执行一次（滚动/resize）
function throttle(fn, ms) {
    let last = 0;
    return (...args) => {
        const now = Date.now();
        if (now - last >= ms) { last = now; fn(...args); }
    };
}
```

防抖管「等尘埃落定」（输入/resize 结束才算）、节流管「限频」（滚动中定期执行）——两者是高频事件治理的标准答案，手写一遍是前端面试的经典题，更是理解闭包计时器组合的练习。

## 7. 陷阱清单

- innerHTML 拼用户输入：XSS；textContent/template/框架转义。
- addEventListener 用匿名函数后无法 removeEventListener：保存引用或一次性 `{ once: true }`。
- 循环里逐条改布局属性：重排风暴；批量 class/transform。
- 动态子元素逐个绑事件：委托替代。
- 忘 preventDefault（表单提交刷新页面）：submit 处理器的第一行。
- scroll/input 里做重活：防抖/节流/Observer 家族。
- querySelectorAll 的静态快照当实时集合用：重新查询或用 live 集合。
- 属性与 property 混淆：表单当前值取 property（.value）。

## 8. 小结

- DOM 是 JS 与页面的接口：querySelector 查询、createElement/template 克隆创建、textContent 安全填充、classList/样式控制——四个基本动作覆盖日常。
- 安全线：用户输入只进 textContent（innerHTML 是 XSS 的正门）；性能线：动画只动 transform/opacity、样式批量更新。
- 事件模型的三阶段与委托：父元素监听 + closest 定位——动态内容、内存、清理三收益；React 合成事件的底层。
- 高频事件的三层治理：防抖/节流（简单场景）→ Observer 家族（现代正解）→ 框架的状态驱动（更上层）。
- 框架出现前后的一致性：React/Vue 的组件渲染最终都落在这些原语上——「框架 diff 后执行的操作」就是本篇 API。

## 9. 练习

**1.** 手写一个「待办列表」无框架实现：输入添加、点击删除（事件委托）、完成切换（classList）——全文不写 innerHTML，体会原生 DOM 的完整循环。

> [!TIP]
> 思路这个 40 行的小程序是理解框架的「对照组」：状态（数组）→ 渲染（重建列表）→ 事件（委托）。React 做的事 = 自动化这个「状态到 DOM」的同步。

**2.** XSS 实验与修复：写一个 innerHTML 渲染用户输入的评论框，输入 `<img src=x onerror=alert(1)>` 触发；改 textContent 验证免疫；再讨论「需要富文本怎么办」（白名单过滤库）。

> [!TIP]
> 思路XSS 的演示要限定在本地实验（安全合规）。富文本是「必须允许 HTML」的场景——白名单消毒（DOMPurify）而非黑名单过滤。

**3.** 性能实验：1000 个元素逐条改 width（每条间读 offsetHeight 强制重排）vs 批量改 class——Performance 面板对比 layout 次数与耗时。

> [!TIP]
> 思路「读写交错」是最贵的模式（每次读都强制同步布局）——读写分离/批量/transform 三招的实测收益能差百倍。performance 面板的紫色 layout 块是证据。

**4.** 用 IntersectionObserver 实现图片懒加载与「无限滚动加载下一页」；对比用 scroll 事件实现的版本（事件触发频率打日志对比）。

> [!TIP]
> 思路Observer 的回调由浏览器调度（只在交叉状态变化时触发）——scroll 是滚动帧率级触发。两者的 CPU 占用对比一目了然。

**5.** 实现防抖与节流的带 cancel 版本（组件销毁时取消 pending 的定时器），并用它们治理一个「输入实时校验」与「窗口 resize 重排」场景——总结两个工具的选择判据。

> [!TIP]
> 思路判据：关心「最终值」用防抖、关心「过程中的节奏」用节流。cancel 的存在提醒：定时器是资源的借用，组件生命周期要归还——React useEffect 清理函数的同款问题。

**6.** 讨论：React/Vue 的出现解决了原生 DOM 的什么根本痛点？（状态与视图的手动同步）从「状态分散在 DOM 里」的角度分析无框架开发的失控点（UI = f(状态) 的缺失），并说明为什么事件委托成为 React 合成事件的底层选择。

> [!TIP]
> 思路原生开发的失控点：DOM 就是状态存储（class/隐藏 input/data-*），多处修改互相踩踏且无法追溯——框架把状态收敛为唯一真相、DOM 变成投影。委托则让框架在根节点统一接管事件——性能与架构的双重必然。
