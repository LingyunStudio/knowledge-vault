---
title: CSS 基础
order: 3
tags: 基础, CSS, 盒模型
summary: 选择器与优先级、盒模型、常用单位，样式从哪来怎么叠。
---

CSS 的运行模型一句话：选择器选中元素，声明块给样式；多条规则撞车时，由**优先级**和**书写顺序**裁决。这一篇把三件事讲清：样式从哪来、怎么选中元素、大小怎么算。

## 样式从哪来

三种写法，优先级从低到高：

```html
<head>
  <!-- 外部样式表：唯一推荐的方式 -->
  <link rel="stylesheet" href="style.css" />

  <!-- 内部样式：单页演示可用，项目里别用 -->
  <style>p { color: #333; }</style>
</head>
<body>
  <!-- 内联样式：优先级最高，救急用，难维护 -->
  <p style="color: red;">红字</p>
</body>
```

实际项目里九成九的样式写外部文件：能被多个页面复用、能被浏览器缓存、能被构建工具处理。内联样式只在 JS 动态改样式或极端救急时碰。

还有第四个来源：**浏览器默认样式**——h1 为什么天生大、a 为什么天生蓝下划线，都是它在起作用。你的样式永远是在默认样式之上做覆盖。

## 选择器

```css
/* 元素选择器 */
p { line-height: 1.6; }

/* 类选择器：最常用，. 开头 */
.card { padding: 16px; }

/* id 选择器：# 开头，优先级过高，慎用 */
#header { position: sticky; }

/* 后代选择器：空格，选 .card 里所有 a（不限层级） */
.card a { color: teal; }

/* 子选择器：>，只选直接子元素 */
.nav > li { display: inline-block; }

/* 群组：逗号并列 */
h1, h2, h3 { font-weight: 600; }

/* 属性选择器 */
input[type="password"] { letter-spacing: 2px; }

/* 伪类：元素的某种状态 */
a:hover { text-decoration: underline; }
input:focus { outline: 2px solid teal; }
li:first-child { font-weight: bold; }

/* 伪元素：元素的某个部分 */
p::before { content: "→ "; }
```

## 优先级：谁说了算

多条规则命中同一元素时，浏览器按优先级裁决：

| 来源 | 优先级 | 示例 |
| --- | --- | --- |
| `!important` | 压过一切常规来源 | `color: red !important` |
| 内联 style | 最高 | `style="color: red"` |
| id | 高 | `#header` |
| 类 / 属性 / 伪类 | 中 | `.card`、`:hover` |
| 元素 / 伪元素 | 低 | `p` |

同优先级时，**写在后面的赢**。可数着位数算：`#main .card a` 是 1 个 id + 1 个类 + 1 个元素，`.card a:hover` 是 2 个类 + 1 个元素——前者赢。

```css
/* ❌ 优先级军备竞赛：越写越具体，最后谁都压不过谁 */
#main .content ul li a.link { color: blue; }

/* ✅ 单一语义类名：优先级平稳，想覆盖也容易 */
.post-link { color: blue; }
```

> [!WARNING]
> `!important` 不是"更优先"，是"掀桌子"——一旦用了，想覆盖它只能再堆一个 `!important`，样式从此失控。只允许出现在覆盖第三方库这类最后手段里，日常样式禁用。

## 盒模型：一切皆盒子

每个元素都是一个盒子，从内到外四层：

- **content**：内容本身（文字、图片），由 `width` / `height` 控制
- **padding**：内边距，内容与边框之间的留白，随元素背景渲染
- **border**：边框
- **margin**：外边距，与其他盒子之间的距离，完全透明

关键分岔在 `width` 到底算到哪一层：

```css
/* content-box（默认）：width 只指内容区 */
/* 实际宽度 = width + padding×2 + border×2 */
.card-default {
  box-sizing: content-box;
  width: 200px;
  padding: 20px;
  border: 2px solid;   /* 实际占 244px，一加 padding 就变宽 */
}

/* border-box：width 指边框盒整体 */
/* 实际宽度 = width，padding 和 border 向内挤内容 */
.card-better {
  box-sizing: border-box;
  width: 200px;
  padding: 20px;
  border: 2px solid;   /* 实际就是 200px，加 padding 内容区自动缩小 */
}
```

border-box 符合直觉——"我说多宽就多宽"。所以现代项目第一步几乎都是全局切换：

```css
*, *::before, *::after {
  box-sizing: border-box;
}
```

> [!TIP]
> 普通文档流里，相邻块级元素的垂直 margin 会**合并**（塌陷）：不相加，取较大者。不想被它咬，统一只用一个方向的 margin，或者干脆用 Flex/Grid 的 `gap` 代替（gap 不塌陷）。

## 常用单位

| 单位 | 含义 | 典型用途 |
| --- | --- | --- |
| `px` | 绝对像素 | 边框、阴影这类不随缩放的细节 |
| `%` | 相对父元素 | 宽度 |
| `rem` | 相对根元素字号（默认 16px） | 字号、间距；全站缩放只改一处 |
| `em` | 相对元素自身字号（设 font-size 时相对父元素） | 行高、按钮内边距随字号走 |
| `vw` / `vh` | 视口宽 / 高的 1% | 全屏区块、弹窗 |

响应式布局的主力（媒体查询 + 弹性单位）在[布局：Flex 与 Grid](04-css-layout.md)展开。这里先立规矩：字号和间距用 `rem`，别拿 `px` 硬编码。

## 练习

- [ ] 写一个卡片：border-box 下固定宽 240px，调大 padding 后量一量，确认总宽不变
- [ ] 用 `:hover` 和 `:focus` 给链接和输入框加状态样式
- [ ] 给三个选择器排序：`#main .card a`、`.card a:hover`、`ul li a`，动手算位数验证

相关阅读：[布局：Flex 与 Grid](04-css-layout.md)
