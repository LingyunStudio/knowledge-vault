---
title: HTML 基础
order: 2
tags: 基础, HTML, 语义化
summary: 文档结构、常用标签、语义化的意义、表单与输入类型。
---

HTML 不是编程语言，是**标记语言**：用一对对标签描述"这里是什么"。浏览器据此建出 DOM 树，CSS 和 JS 都挂在这棵树上工作。写 HTML 的核心问题只有一个：这段内容，语义上到底是什么。

## 文档骨架

每个页面都是这个骨架：

```html
<!DOCTYPE html>          <!-- 声明：标准模式的 HTML5，别省 -->
<html lang="zh-CN">      <!-- lang 帮助读屏软件和翻译工具 -->
<head>
  <meta charset="UTF-8" />   <!-- 尽早声明编码，防乱码 -->
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>页面标题（显示在标签页和搜索结果里）</title>
</head>
<body>
  <!-- 用户看得见的内容都放这里 -->
</body>
</html>
```

`head` 里装"关于页面的信息"（元数据），`body` 里装"页面内容"。viewport 那行是移动端适配的开关：没有它，手机会按约 980px 宽渲染整页再缩小显示，你写的布局全部失真。

## 常用标签

按用途分几组，覆盖八成场景：

```html
<!-- 标题与段落 -->
<h1>一级标题</h1>          <!-- 一个页面通常只有一个 h1 -->
<p>一个段落。<strong>加粗强调</strong>，<em>斜体强调</em>。</p>

<!-- 链接与图片 -->
<a href="https://example.com" target="_blank">外链（新标签页打开）</a>
<img src="cat.jpg" alt="一只橘猫趴在键盘上" />  <!-- alt：图片挂了或读屏时显示的文字 -->

<!-- 列表 -->
<ul>
  <li>无序列表项</li>
</ul>
<ol>
  <li>有序列表项</li>
</ol>

<!-- 容器：div 块级独占一行，span 行内包一小段文字 -->
<div class="card">布局分区的通用容器</div>
<span class="highlight">方便加样式的行内片段</span>

<!-- 页面区块 -->
<header>页头</header>
<nav>导航</nav>
<main>主内容（每页一个）</main>
<article>独立成篇的内容：一篇文章、一条评论</article>
<footer>页脚</footer>
```

`id` 在页面内必须唯一；`class` 可重复、可叠加（`class="btn primary"`）。这两个属性是 CSS 和 JS 找元素的把手，HTML 本身不管长什么样。

## 语义化：标签的名字就是答案

同样的视觉效果，两种写法：

```html
<!-- ❌ div 汤：浏览器、搜索引擎、读屏软件都不知道这是什么 -->
<div class="top">
  <div class="title">我的博客</div>
</div>
<div class="content">
  <div class="post">第一篇文章</div>
</div>

<!-- ✅ 语义标签：结构自己会说话 -->
<header>
  <h1>我的博客</h1>
</header>
<main>
  <article>第一篇文章</article>
</main>
```

语义化的回报不在"看起来一样"的当下，而在三处：

1. **可访问性**：读屏软件靠标题层级、区块标签帮视障用户跳转页面
2. **SEO**：搜索引擎用 `h1`、`article`、`nav` 判断页面重点和结构
3. **可维护性**：半年后回看 `<nav>` 一眼就懂，回看 `class="div2"` 只能靠猜

> [!TIP]
> 拿不准用什么标签时问自己：这段内容"是什么"（导航？文章？补充说明 `aside`？），而不是"长什么样"。样式是 CSS 的事，标签只负责语义。

> [!NOTE]
> div 和 span 不是禁用的兜底——纯布局需要容器时用 div 完全正确。语义化反对的是"整个页面从头 div 到尾"。

## 表单与输入类型

表单是页面里唯一的标准"用户输入通道"：

```html
<form action="/api/login" method="post">
  <label for="email">邮箱</label>
  <input id="email" name="email" type="email" required />

  <label for="pwd">密码</label>
  <input id="pwd" name="pwd" type="password" minlength="8" required />

  <label for="age">年龄</label>
  <input id="age" name="age" type="number" min="0" max="150" />

  <button type="submit">登录</button>
</form>
```

四个要点：

- `label` 的 `for` 对应 input 的 `id`：点文字即可聚焦输入框，读屏软件也能报对字段名
- `type` 决定外观、校验和手机弹出的键盘：`email`、`number`、`date`、`checkbox`、`radio`、`file`、`range`……先查原生类型，多数需求不用 JS
- `required`、`minlength`、`min/max` 是浏览器**免费送的原生校验**，提交前自动拦截
- `name` 是提交给后端时的键名，漏了它这个字段根本不会被发送

> [!WARNING]
> 原生校验只是体验优化，不是安全边界。绕过页面直接向服务器发请求毫无门槛——服务端必须重新校验一切。前端校验管体验，后端校验管安全，缺一不可。

## 练习

- [ ] 给自己的个人主页写出完整骨架：header / nav / main / footer，全部用语义标签
- [ ] 做一个注册表单：邮箱、密码（至少 8 位）、生日（date）、同意条款（checkbox），全靠原生校验
- [ ] 找一个网页，用 DevTools 的 Elements 面板找出它的 h1 和三个语义标签

相关阅读：[CSS 基础](03-css-basics.md)
