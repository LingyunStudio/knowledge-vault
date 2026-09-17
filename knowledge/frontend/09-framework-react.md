---
title: 框架思维：以 React 为例
order: 9
tags: 进阶, React, 组件
summary: 组件与状态、声明式 UI 与数据驱动、虚拟 DOM 直觉、框架解决什么。
---

手写 DOM 的时代，每次数据变化你都要手动找到节点、算好怎么改——页面一大，"改哪里、改几次"就成了事故源头。框架的核心贡献只有一个：**你声明"界面是数据的函数"，数据变了框架负责算出最小 DOM 改动**。本篇以 React 为例讲清这套思维。

## 组件：UI 的函数

React 里一切界面都是组件，组件就是返回界面的函数：

```jsx
// props：父组件传进来的只读参数，像函数入参
function Badge({ count }) {
  if (count === 0) return null;   // 组件也可以"什么都不渲染"
  return <span className="badge">{count > 99 ? "99+" : count}</span>;
}
```

JSX 看着像 HTML，本质是 JS 的语法糖——标签会被编译成函数调用，所以花括号里能写任意 JS 表达式。几个高频差异：用 `className` 不用 `class`，`style` 接对象且属性驼峰：

```jsx
const box = <div className="box" style={{ fontSize: 14 }}>内容</div>;
// 本质等价于：React.createElement("div", { className: "box", style: { fontSize: 14 } }, "内容")
```

> [!NOTE]
> JSX 不是模板语言，是表达式：能存进变量、能当参数传、能出现在 if 和 map 里。把它当"用标签语法写出来的函数调用"理解，一切语法限制（标签必须闭合、必须唯一根节点）都说得通。

## 状态与数据驱动

props 从外面来；state 是组件**自己拥有的、会变的数据**。state 一变，React 自动重新执行组件函数并更新页面：

```jsx
import { useState } from "react";

function Counter() {
  const [count, setCount] = useState(0);   // 当前值 + 修改函数，成对出现

  return (
    <button onClick={() => setCount(count + 1)}>
      点了 {count} 次
    </button>
  );
}
```

注意思维的反转：你不写"点击时把 span 里的数字加一"，只声明"界面是这个状态的函数"，然后调 `setCount`。与命令式对比：

```javascript
// ❌ 命令式（原生 DOM）：每一步自己动手，路径多了必然漏改
count += 1;
document.querySelector("#count").textContent = String(count);

// ✅ 声明式（React）：只改状态这一件事，DOM 更新交给框架
setCount(count + 1);
```

> [!WARNING]
> state 必须经 setter 更新，且用"替换"而非"原地改"：`count += 1` 或 `user.name = "Bob"` 改了值但 React 察觉不到，界面不会更新。对象和数组要用展开运算符生成新的：`setUser({ ...user, name: "Bob" })`。

## 虚拟 DOM：diff 的直觉

React 每次 render 生成一棵轻量的 JS 对象树（虚拟 DOM），与上一次的树做 diff，算出最小改动批量应用到真实 DOM。它的价值不是"虚拟 DOM 比真实 DOM 快"（并不），而是把"数据变了界面该怎么增量更新"从你手里接走，用可预测的算法替代人肉维护。

列表渲染是 diff 的日常入口——JSX 里没有模板 for，直接 `map` 出标签数组：

```jsx
<ul>
  {todos.map(t => (
    <li key={t.id}>{t.text}</li>   {/* key 帮 diff 认出"这一项还是原来那一项" */}
  ))}
</ul>
```

两个与 diff 直接相关的实践：

- 列表渲染要给每项一个稳定的 `key`，diff 才能正确复用节点；用数组下标当 key，排序或删除时会错位复用
- state 放得越低，重渲染范围越小；性能问题多半出在"把无关的状态放得太高"

## 组件组合：数据向下，事件向上

组件的价值靠组合兑现：小部件拼成区块，区块拼成页面，数据自上而下流动：

```jsx
function TodoApp() {
  const [todos, setTodos] = useState([]);

  function addTodo(text) {
    setTodos([...todos, { id: Date.now(), text, done: false }]);  // 新数组替换旧数组
  }

  return (
    <section>
      <TodoForm onAdd={addTodo} />   {/* 数据向下：props 传下去；事件向上：回调接回来 */}
      <TodoList todos={todos} />
    </section>
  );
}
```

> [!TIP]
> 数据向下、事件向上（props down, events up）是各框架通用的数据流模型，Vue 与 React 完全一致。两个兄弟组件要共享状态？把状态提到最近的共同父组件。这条规则定了，九成"状态放哪"的问题都有答案。

## 框架解决什么，不解决什么

框架给你：状态到 UI 的自动同步、组件化拆分与复用、庞大的生态（路由、状态管理、组件库）、团队统一的开发范式。

框架不给你：业务逻辑本身、CSS 布局能力（[布局：Flex 与 Grid](04-css-layout.md)照用）、性能常识、可访问性。这些欠的账一个都跑不掉。

判断"该不该上框架"也有了标尺：交互多、状态与界面联动频繁的页面，框架的收益巨大；纯静态内容页用原生 HTML 反而更快更省。框架是解决"状态同步"的方案，没这个病就不用这副药。

所以学习顺序很重要：先把原生三件套学到能解释"React 帮我省掉了什么"，再上框架——否则调不出问题时，既不懂框架也不懂浏览器。好消息是，函数组件、状态、数据流这套模型对学 Vue、Svelte 几乎免费赠送：换的是 API，不变的是 `UI = f(state)`。

## 练习

- [ ] 实现一个 Todo：输入添加、点击切换 done、删除，全程不直接操作 DOM
- [ ] 故意用 `todos.push(...)` 更新列表，观察界面不动，再改成 `setTodos([...todos, x])` 修复
- [ ] 列表 key 分别用下标和稳定 id，做一次排序操作，观察节点复用行为的差异

相关阅读：[异步 JavaScript](07-async-js.md)
