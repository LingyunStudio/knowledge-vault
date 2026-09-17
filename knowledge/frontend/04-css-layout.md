---
title: 布局：Flex 与 Grid
order: 4
tags: 核心, Flex, Grid
summary: Flex 一维布局、Grid 二维布局、响应式断点，现代布局只教这两个。
---

现代 CSS 布局只有两件兵器：**Flex** 处理一维（一行或一列），**Grid** 处理二维（行和列同时）。float、表格布局、负 margin 这些历史手段一律不用学。这两件吃透，九成页面布局不再成问题。

## Flex：一维布局

容器加 `display: flex`，子元素立刻沿**主轴**排成一队：

```css
.container {
  display: flex;
  flex-direction: row;      /* 主轴方向：row 横排 / column 竖排 */
  justify-content: center;  /* 主轴上的对齐与分布 */
  align-items: center;      /* 交叉轴上的对齐 */
  gap: 12px;                /* 子元素间距，替代 margin */
}
```

容器上的常用属性：

| 属性 | 作用 | 常用值 |
| --- | --- | --- |
| `justify-content` | 主轴对齐 | `center`、`space-between`、`space-evenly` |
| `align-items` | 交叉轴对齐 | `center`、`stretch`（默认）、`baseline` |
| `flex-wrap` | 放不下是否换行 | `nowrap`（默认）/ `wrap` |
| `gap` | 子元素间距 | 任意长度值 |

子元素上的分配规则：

```css
.item {
  flex: 1;   /* 简写：flex-grow:1, flex-shrink:1, flex-basis:0% */
}            /* 意思是：剩余空间按比例平分 */

.sidebar {
  flex: 0 0 240px;   /* 不放大、不缩小、固定 240px——经典侧栏写法 */
}
```

`flex: 1` 是最常写的值：导航旁自适应的内容区、表格里的弹性列，全靠它。

## 主轴与交叉轴：Flex 唯一的坑

主轴由 `flex-direction` 决定，交叉轴永远垂直于主轴：

- `row`（默认）：主轴水平，`justify-content` 管左右，`align-items` 管上下
- `column`：主轴变垂直，**两个属性的角色互换**——`justify-content` 管上下，`align-items` 管左右

> [!WARNING]
> "justify-content 管水平"是初学者最大的错觉。它永远管主轴。竖排时想让孩子水平居中，动的是 `align-items`；要水平垂直双居中，两处都设 `center`。

经典居中三行：

```css
.center {
  display: flex;
  justify-content: center;   /* 主轴居中 */
  align-items: center;       /* 交叉轴居中 */
}
```

## Grid：二维布局

Grid 直接把容器划成网格，子元素往格子里放：

```css
.layout {
  display: grid;
  grid-template-columns: 240px 1fr;  /* 两列：固定侧栏 + 弹性内容 */
  gap: 16px;                         /* 行列间距（可分写 row-gap / column-gap） */
}
```

`fr` 是 Grid 专属单位，表示"剩余空间的一份"，思想与 `flex: 1` 相同。更常用的配方是**自动响应列**：

```css
/* 每列至少 200px、至多 1fr；容器放得下几列就摆几列 */
.gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}
```

这一行替代过去几十行媒体查询：屏幕宽就多摆几列，窄就少摆几列，卡片宽度始终在 200px 上下浮动。

子元素也可以主动占格：

```css
.featured {
  grid-column: span 2;   /* 横跨两列 */
  grid-row: span 2;      /* 纵跨两行 */
}
```

## 响应式断点

Flex/Grid 解决"怎么摆"，媒体查询解决"什么屏幕怎么摆"：

```css
/* 移动优先：默认样式就是手机版 */
.nav { display: flex; flex-direction: column; }

/* 屏幕够宽时切换桌面版 */
@media (min-width: 768px) {
  .nav { flex-direction: row; }
}

@media (min-width: 1200px) {
  .layout { grid-template-columns: 240px 1fr 320px; }
}
```

常用断点参考 640 / 768 / 1024 / 1280px。写 `min-width`（小屏往上加）比 `max-width`（大屏往下删）好维护，这就是"移动优先"。

## Flex 还是 Grid：一张表选型

| 场景 | 选择 | 理由 |
| --- | --- | --- |
| 导航栏、按钮组、标签列表 | Flex | 天然一维 |
| 侧栏 + 主内容 | Flex 或 Grid | 单列结构 Flex 够用 |
| 卡片墙、仪表盘、整页框架 | Grid | 行列关系明确 |
| 内容自适应换行 | Grid `auto-fill` | 一行代码替代媒体查询 |
| 居中一个元素 | Flex | 两行代码 |

不必纠结：一个页面里两者混用是常态——Grid 搭整页骨架，Flex 处理每个部件内部。

> [!TIP]
> 拿不准时先问：这批内容是"一条线"还是"一张网"？一条线用 Flex，一张网用 Grid。答错了也无妨，多数场景两者都能实现，只是代码量不同。

## 练习

- [ ] 用 Flex 实现"圣杯布局"：顶栏、240px 侧栏、自适应内容区、底栏
- [ ] 用 `repeat(auto-fill, minmax(180px, 1fr))` 做图片网格，拖窗口宽度观察列数变化
- [ ] 故意把 `flex-direction: column` 下的水平居中写错一次，再修正——把主轴互换刻进肌肉记忆

相关阅读：[CSS 基础](03-css-basics.md)
