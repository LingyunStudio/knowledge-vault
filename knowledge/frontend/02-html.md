---
title: HTML：结构与语义
order: 2
tags: HTML, 语义化, 表单, 无障碍
summary: 文档骨架与 meta 标签、语义化标签的价值（SEO/无障碍/可维护性）、文本与列表的正确层级、链接与图片的关键属性（alt/lazy）、表单的完整形态（类型/标签/校验）、以及 HTML 作为「可访问性基座」的纪律。
---

HTML 的定位常被低估为「摆标签」——它是页面的**语义骨架**：屏幕阅读器靠它朗读、搜索引擎靠它理解、CSS/JS 靠它挂钩。语义化 HTML（用正确的标签表达内容含义）是前端的「地基地基」——它同时决定 SEO、无障碍与长期可维护性。

## 1. 文档骨架

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">                       <!-- 字符编码：必须第一 -->
    <meta name="viewport" content="width=device-width, initial-scale=1">  <!-- 移动端适配的开关 -->
    <title>页面标题 —— 站点名</title>              <!-- 标签页/搜索结果的标题 -->
    <meta name="description" content="页面摘要">   <!-- 搜索结果摘要 -->
    <link rel="stylesheet" href="style.css">
    <script src="app.js" defer></script>          <!-- defer：不阻塞解析（[第 1 篇](01-web-model.md)）-->
</head>
<body>
    <!-- 可见内容 -->
</body>
</html>
```

head 里的「隐形配置」决定页面的一半体验：`charset` 缺失乱码、viewport 缺失手机上缩小显示、title 是 SEO 的第一权重位。`lang` 属性服务屏幕阅读器的发音与翻译。

## 2. 语义化：用「对的标签」表达「对的意思」

```html
<!-- ❌ div 汤：结构存在，语义为零 -->
<div class="header"><div class="nav">...</div></div>
<div class="content">...</div>

<!-- ✅ 语义化：标签即含义 -->
<header>
    <nav aria-label="主导航">...</nav>
</header>
<main>
    <article>
        <h1>文章标题</h1>
        <section>...</section>
    </article>
    <aside>相关阅读</aside>
</main>
<footer>...</footer>
```

语义标签的三个收益：

1. **无障碍**：屏幕阅读器按语义导航（「跳到主内容」「这是导航区」）——`<main>`/`<nav>` 是视障用户的「目录」。
2. **SEO**：搜索引擎用语义与标题层级理解内容结构。
3. **可维护性**：`<nav>` 比 `<div class="nav">` 少一层约定——标签自带文档。

标题层级是语义的骨架纪律：**每页一个 h1，层级不跳级**（h1 → h2 → h3）——大纲（outline）由标题构成，跳级会让「文档地图」断裂。div/span 是「无语义的最后手段」：样式/脚本挂钩用（语义标签全部有默认含义，div/span 没有）。

## 3. 文本、列表与引用

```html
<h2>第二章</h2>
<p>段落里可以有 <strong>强强调（重要）</strong> 与 <em>斜强调（语气）</em>，
   以及 <code>行内代码</code>。</p>

<ul>                                     <!-- 无序列表 -->
    <li>苹果</li>
    <li>香蕉</li>
</ul>

<ol>                                     <!-- 有序 -->
    <li>预热烤箱</li>
    <li>放入面团</li>
</ol>

<blockquote><p>引用的原文。</p></blockquote>
<figure>
    <img src="chart.png" alt="2026 年季度营收柱状图">
    <figcaption>图 1：季度营收</figcaption>
</figure>
```

`<strong>`（重要性）与 `<em>`（强调语气）有语义区分——`<b>`/`<i>` 是纯视觉（避免用于强调）。`<figure>`+`<figcaption>` 把「图 + 说明」绑定成语义单元。

## 4. 链接与图片

```html
<a href="/about">关于我们</a>                    <!-- 站内：相对路径 -->
<a href="https://ext.com" target="_blank" rel="noopener">外部链接</a>
<!-- target=_blank 必须 rel=noopener：新窗口能通过 window.opener 操作原页（安全）-->

<img src="photo.webp" alt="海滩日落，两人并肩散步" loading="lazy" width="800" height="600">
<!-- alt：图片加载失败/屏幕阅读器的替代文本——描述内容而非「一张图片」 -->
<!-- width/height：预留空间防布局抖动（CLS）；loading=lazy：视口外延迟加载 -->

<picture>                                        <!-- 响应式图片：按能力选格式/尺寸 -->
    <source srcset="photo.avif" type="image/avif">
    <source srcset="photo.webp" type="image/webp">
    <img src="photo.jpg" alt="海滩日落">
</picture>
```

alt 的纪律：**信息性图片写内容描述、装饰性图片 alt=""**（读屏跳过）——「图片是网页流量与无障碍的最大公约数」。`loading="lazy"` 与显式尺寸是现代图片的两件标配（性能与稳定性）。

## 5. 表单：交互的入口

```html
<form action="/api/signup" method="post">
    <label for="email">邮箱 <span aria-hidden="true">*</span></label>
    <input type="email" id="email" name="email" required
           autocomplete="email" placeholder="you@example.com">

    <label for="pw">密码</label>
    <input type="password" id="pw" name="pw" minlength="8" required>

    <fieldset>
        <legend>订阅偏好</legend>
        <label><input type="checkbox" name="news" value="weekly"> 周报</label>
        <label><input type="radio" name="plan" value="pro" checked> 专业版</label>
    </fieldset>

    <button type="submit">注册</button>
</form>
```

表单的语义四件套：

1. **label 关联输入**（for/id 配对）：点击 label 聚焦输入、读屏念出含义——**没有 label 的输入框是无障碍事故**。
2. **type 即语义**：email 触发邮箱键盘与校验、number/password/date 各有交互——用对 type 免手写逻辑。
3. **内置校验**：`required`/`minlength`/`pattern`——浏览器先拦一道（JS 校验是增强不是替代）。
4. **name 决定提交**：提交时 name=value 对——没有 name 的输入不随表单提交。

## 6. id、class 与 data-*

```html
<div id="app-root">              <!-- id：全页唯一（锚点/JS 单点挂钩） -->
<div class="card highlight">     <!-- class：可重复的样式/行为分组 -->
<article data-id="42" data-author="alice">   <!-- data-*：JS 的自定义数据 -->
```

- `id` 唯一且不可重复（CSS 里尽量不用 id 选择器——特异性过高难覆盖，[第 3 篇](03-css-basics.md)）。
- `class` 是日常主力（样式与 JS 选择的主挂钩）。
- `data-*` 把业务数据挂在元素上（JS 读取 `el.dataset.id`）——比塞进 class 或隐藏 input 干净。

## 7. 无障碍（a11y）的基本盘

```html
<button>删除</button>                     <!-- ✅ 语义按钮：键盘可达、读屏识别 -->
<div class="btn" onclick="...">删除</div>  <!-- ❌ div 按钮：Tab 不到、回车不触发 -->

<img alt="">                              <!-- 纯装饰：空 alt（读屏跳过） -->
<input aria-label="搜索">                  <!-- 无可视 label 时的替代 -->
<div aria-live="polite">{{toast}}</div>    <!-- 动态内容变化时读屏播报 -->
```

无障碍的 80/20：**语义标签 + label 关联 + alt + 键盘可达**（button/a 原生支持键盘，div 做的「按钮」全失）覆盖绝大多数需求；ARIA 属性是「语义不够时的补丁」——**先语义后 ARIA**（错误的 ARIA 比没有更糟）。Tab 键遍历一遍页面是 5 分钟的无障碍审计。

## 8. 陷阱清单

- div 汤替代语义标签：SEO/无障碍双输；先想「这内容的语义是什么」。
- 标题跳级/多 h1：文档大纲断裂；一个 h1 + 顺序层级。
- img 缺 alt 或 alt=「图片」：无障碍与 SEO 双伤；描述内容。
- label 不关联输入：点击无效 + 读屏失效；for/id 配对。
- 表单输入没 name：提交丢数据。
- target=_blank 漏 rel=noopener：反向接管漏洞。
- 滥用 ARIA 补 div：先用对语义标签。
- 内联样式与 onclick 散落 HTML：样式与行为分离（[第 1 篇](01-web-model.md)三语言分工）。

## 9. 小结

- HTML 是语义骨架：head 的隐形配置（charset/viewport/title）+ body 的语义结构——「标签即含义」服务读屏、搜索引擎与维护者。
- 语义化的 80/20：header/nav/main/article/footer + 标题层级 + button/a 的正确使用——div/span 是无语义的兜底。
- 图片三件套：alt 内容化、显式尺寸、lazy；响应式用 picture 按能力选格式。
- 表单四纪律：label 关联、type 语义化、内置校验、name 提交——无障碍与功能性的交集。
- 无障碍基座 = 语义 + 键盘可达；Tab 遍历是最低成本审计。

## 10. 练习

**1.** 找一个网页（或你写的页面），用 DevTools 的 Accessibility 面板（或读屏模拟扩展）查看「读屏视角」的页面树——对比视觉布局与语义结构的差异。

> [!TIP]
> 思路Accessibility 面板显示的是「语义树」而非视觉盒模型——div 汤在这里露出原形（一堆无名的 generic）。这个视角是无障碍开发的坐标系。

**2.** 把一段「div 汤」重构为语义 HTML：保持视觉不变（CSS 挂钩换 class），验证标题大纲（headingsMap 扩展或 h1-h6 手查）与 Tab 导航。

> [!TIP]
> 思路重构的核心动作：给每个 div 问「它的语义角色是什么」——页眉/导航/主内容/独立文章。重构后 Lighthouse 的 accessibility 分数是客观验收。

**3.** 写一个完整的「联系表单」：姓名（必填）、邮箱（格式校验）、留言（限长）、同意条款（checkbox 必勾）——全部用 HTML 内置能力，测试浏览器校验与提交的 name=value。

> [!TIP]
> 思路required/pattern/minlength 全是属性级配置；F12 的 Network 面板看提交的表单数据（name 缺失的输入不出现——验证第 5 节纪律）。

**4.** 给一张「信息图」写 alt：先写 alt="图表"，再写描述数据的版本，用读屏（或 WebAIM 的模拟）体验差异——总结「alt 的信息密度标准」。

> [!TIP]
> 思路alt 的标准是「提供等效信息」：复杂图表的 alt 是结论/摘要（如「2026 年营收同比增长 20%」）+ 长描述另置。装饰图空 alt 与信息图内容化 alt 的二分。

**5.** 检查一个页面的 head 配置完整性：charset/viewport/title/lang/description/OG 标签（分享卡片）——缺失的逐个补上并说明每个影响的场景（乱码/移动端/SEO/分享）。

> [!TIP]
> 思路OG 标签（og:title/og:image）控制社交分享卡片——「页面被转发时的门面」。head 是「隐形配置层」：每个 meta 对应一个消费场景。

**6.** 讨论：为什么「语义先行」比「视觉先行」的 HTML 开发方式更可持续？从「CSS 可以随时改、语义改变伤筋动骨」「组件化时代语义仍是地基」「AI 与爬虫依赖语义理解」三个角度，并结合你项目里改版时的实际痛苦点。

> [!TIP]
> 思路视觉是易变层（改版频繁）、语义是稳定层（内容结构）——把易变写进 HTML 就是把随机性写进地基。语义化的收益随时间复利：读屏、爬虫、未来的解析器都靠它。
