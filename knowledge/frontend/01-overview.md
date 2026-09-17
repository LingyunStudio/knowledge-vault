---
title: 前端全景
order: 1
tags: 概念, 全景, 三件套
summary: HTML/CSS/JS 的分工、浏览器如何渲染页面、现代前端的工具链地图。
---

前端是浏览器里跑的那一层：HTML 定结构，CSS 定外观，JavaScript 定行为。三种语言各管一摊，浏览器把三者翻译成用户看到的像素。这一篇先画全景地图，细节留给后面各篇。

## 三件套的分工

一个最小页面，三种语言各占一个文件：

```html
<!-- index.html：结构与内容 -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>计数器</title>
  <link rel="stylesheet" href="style.css" />    <!-- 外观交给 CSS -->
  <script type="module" src="main.js"></script> <!-- 行为交给 JS -->
</head>
<body>
  <button id="inc">点了 <span id="count">0</span> 次</button>
</body>
</html>
```

```css
/* style.css：外观 */
button {
  padding: 8px 16px;
  border-radius: 6px;
}
```

```javascript
// main.js：行为
const btn = document.querySelector("#inc");
let n = 0;
btn.addEventListener("click", () => {
  n += 1;
  document.querySelector("#count").textContent = String(n);
});
```

这条边界是前端的地基：结构不对找 HTML，样式难看找 CSS，点了没反应找 JS。框架和工具链都是在这地基上加的楼，没有推翻它。

与后端语言"选一门学深"不同，前端三门都必须会——它们不是三个备选，是同一个页面的三个切面。好消息是三门都不难入门，难点在组合使用。

## 浏览器如何渲染页面

浏览器把三种输入变成像素，流水线大致五步：

1. 解析 HTML，建 **DOM 树**——标签在内存里的树形表示
2. 解析 CSS，建 **CSSOM**，与 DOM 合成渲染树
3. **布局**：算出每个节点的位置和大小
4. **绘制**：把节点画到图层上
5. **合成**：图层叠加成最终画面

由此推出几条日常结论：

- CSS 放 `<head>` 尽早加载，避免"先裸奔后穿衣"的闪烁
- `<script>` 默认**阻塞 HTML 解析**：要等脚本下载并执行完才继续。加 `defer`（延后执行、保持顺序）或 `async`（下完就执行、不保序）可以让脚本不挡路
- 改尺寸、位置会触发重新布局，改颜色只触发重绘，`transform` 和 `opacity` 甚至只需合成——代价依次递减，"动画优先用 transform"就是从这来的

这几个成本级别有名字：重新布局叫**回流（reflow）**，只重画叫**重绘（repaint）**。回流必然引发重绘，反之不然；渲染优化的核心就是少触发回流。

> [!NOTE]
> 各浏览器引擎的渲染细节略有差异，但"DOM + CSSOM → 布局 → 绘制 → 合成"这条主线是通用心智模型，足够指导日常判断。

## DevTools：第一件该学的工具

浏览器开发者工具（F12）是前端最重要的学习现场，没有之一：

- **Elements**：实时查看、修改 DOM 与 CSS，所见即所得地试样式
- **Console**：随手执行 JS，看报错堆栈
- **Network**：看每个请求的状态码、耗时、响应体
- **Sources**：打断点单步调试 JS
- **Application**：查看 cookie、localStorage 和缓存——[浏览器存储与 HTTP](10-storage-http.md) 的主角都在这里

看到任何好玩的网页，F12 打开看它的结构和样式，比看十篇教程学得快。右键"检查"能直接定位到你点击的元素，Elements 里的改动刷新前立即生效。

> [!TIP]
> 右键"查看源代码"看到的是服务器返回的原始 HTML；DevTools 的 Elements 面板看到的是 JS 改动后的实时 DOM。两者对不上时别怀疑人生，先分清你在看哪一个。

## 工具链地图

现代前端在"三件套"之外长出了一整套工具链，先混个脸熟：

| 类别 | 代表 | 一句话说明 |
| --- | --- | --- |
| 语言增强 | TypeScript | 给 JS 加静态类型，编译回 JS |
| UI 框架 | React / Vue / Svelte | 数据驱动的界面开发方式 |
| 构建工具 | Vite / webpack | 开发服务器 + 打包优化 |
| 包管理 | npm / pnpm | 安装和管理第三方依赖 |
| 代码质量 | ESLint / Prettier | 查逻辑隐患 / 统一格式 |
| 测试 | Vitest / Playwright | 单元测试与端到端测试 |
| 运行环境 | Node.js | 让 JS 脱离浏览器跑，工具链的地基 |

这些工具全跑在 Node.js 之上——Node 是把浏览器的 V8 引擎拿出来做成的 JS 运行时，于是前端工具链都用 JS 写。你不需要精通 Node，但要会装它、会跑 `npm` 命令。

框架的来龙去脉（React 为什么那样设计、组件思维是什么）等原生底子打完再上，见[框架思维：以 React 为例](09-framework-react.md)。

最后一句提醒：工具链换代极快，webpack 的时代知识五年就过时，但浏览器、HTTP、JS 语言本身几乎不变。学习精力投给不变量，工具随用随查。

## 本系列怎么读

- [HTML 基础](02-html-basics.md)、[CSS 基础](03-css-basics.md)、[布局：Flex 与 Grid](04-css-layout.md)：界面层，边读边动手做页面
- [JavaScript 基础](05-javascript-basics.md) 到 [模块与工具链](08-modules-tooling.md)：语言与工程底座，信息密度上升，建议每个例子都在 Console 里敲一遍
- [框架思维：以 React 为例](09-framework-react.md) 之后的三篇：有了前两段的底子，才能读出"框架到底解决了什么"，而不是背 API
- [浏览器存储与 HTTP](10-storage-http.md) 和 [工程化与规范](11-engineering.md) 收尾：从"会写页面"到"能交付项目"

## 练习

- [ ] 把本文的三段代码存成三个文件，用浏览器打开跑通计数器
- [ ] 随便打开一个常用网站，用 DevTools 找到它的 `<title>` 和一个按钮元素
- [ ] 在 Console 里输入 `document.querySelector("h1")`，看看返回什么

相关阅读：[HTML 基础](02-html-basics.md)
