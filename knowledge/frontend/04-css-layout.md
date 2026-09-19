---
title: 布局：Flexbox、Grid 与响应式
order: 4
tags: Flexbox, Grid, 定位, 响应式
summary: 布局工具的历史与选型（一维 Flexbox/二维 Grid）、Flexbox 的主轴模型与常用配方、Grid 的行列与 areas 声明式布局、四种定位、响应式的媒体查询与容器查询，以及经典布局配方集。
---

布局工具的演进史只有三幕：float（借排版属性做布局——历史包袱）、flexbox（**一维**布局：一行或一列）、grid（**二维**布局：行与列同时）。现代答案极其清晰：**一维场景 flexbox、二维场景 grid、脱离文档流用定位**——不再需要 hack。

## 1. Flexbox：一维布局的主力

```css
.container {
    display: flex;
    flex-direction: row;          /* 主轴方向（row/column） */
    justify-content: space-between; /* 主轴对齐：flex-start/center/space-between… */
    align-items: center;          /* 交叉轴对齐：stretch/center/flex-start */
    gap: 1rem;                    /* 项间距（替代 margin hack） */
    flex-wrap: wrap;              /* 放不下换行 */
}
.item { flex: 1; }                /* 弹性：均分剩余空间 */
.item.grow2 { flex: 2; }          /* 占两份 */
```

心智模型：**主轴（main axis）与交叉轴（cross axis）**——flex-direction 决定谁是主轴，justify-content 管主轴、align-items 管交叉轴（方向换了，两个属性的含义跟着换——这是 flexbox 唯一需要「想一下」的地方）。

```css
/* flex 的三个分量 */
flex: 1 1 0;      /* flex-grow（分剩余空间） flex-shrink（允许收缩） flex-basis（初始尺寸） */
flex: 1;          /* = 1 1 0：均分——最常用 */
flex: auto;       /* = 1 1 auto：先按内容分、再均分剩余 */

.item.fixed { flex: 0 0 200px; }   /* 固定列：不伸不缩 */
```

flex 的经典配方：

```css
/* 垂直水平居中（三行定生死） */
.center { display: flex; justify-content: center; align-items: center; }

/* 顶栏：logo | 弹性中间 | 按钮 */
.nav { display: flex; align-items: center; gap: 1rem; }
.nav .spacer { flex: 1; }

/* 经典三段：固定侧栏 + 自适应内容 */
.layout { display: flex; }
.sidebar { flex: 0 0 240px; }
.content { flex: 1; min-width: 0; }   /* ★ min-width:0 允许内容收缩（长文本/表格溢出的解药）*/
```

`min-width: 0` 是 flexbox 的著名暗坑：flex 项的默认 min-width 是 auto（内容的最小宽度）——长文本/宽表格会把弹性布局撑破，显式 `min-width: 0` 或 `overflow: hidden` 恢复弹性。

## 2. Grid：二维声明式布局

```css
.page {
    display: grid;
    grid-template-columns: 240px 1fr 1fr;   /* 三列：固定 + 两份弹性 */
    grid-template-rows: auto 1fr auto;      /* 三行 */
    gap: 1rem;
}
```

`fr`（fraction）是 grid 的弹性单位——「剩余空间的比例」；`auto` 按内容。行列线之间放元素：

```css
/* 命名区域：布局即图纸 */
.page {
    grid-template-areas:
        "header header header"
        "sidebar main  main"
        "footer footer footer";
}
.header { grid-area: header; }
.sidebar { grid-area: sidebar; }

/* 或直接用线号定位 */
.main { grid-column: 2 / 4; grid-row: 2; }     /* 从第 2 列线到第 4 列线 */

/* 卡片墙：自动填充 */
.cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));  /* 自适应列数 */
    gap: 1rem;
}
```

`repeat(auto-fill, minmax(240px, 1fr))` 是响应式卡片墙的「一行答案」：容器够宽就多列、不够就少列——**不写一个媒体查询的响应式**。grid vs flex 的选型：**二维同时定义行列用 grid；内容驱动的一维流用 flex**——同一页面两者并存（页面骨架 grid、骨架内组件 flex）。

## 3. 定位：脱离文档流的四种方式

```css
position: relative;   /* 相对自身偏移；作为 absolute 子元素的定位基准（最常用角色）*/
position: absolute;   /* 相对最近的定位祖先；脱离文档流 */
position: fixed;      /* 相对视口（滚动不动）——吸底按钮/弹窗 */
position: sticky;     /* ★ 滚动到阈值后「粘住」——表头吸顶/侧栏跟随 */
```

```css
/* sticky 吸顶表头 */
thead th { position: sticky; top: 0; background: white; z-index: 1; }

/* absolute 的定位锚：父容器 relative */
.card { position: relative; }
.card .badge { position: absolute; top: 8px; right: 8px; }   /* 挂在卡片右上角 */
```

定位的层次控制：`z-index` 只在定位元素（或 flex/grid 项）上生效；z-index 的层叠上下文（stacking context）是「z-index 无效」的元凶（父级创建了新的层叠上下文）——排查用 DevTools 的 Layers 面板。

## 4. 响应式：媒体查询与容器查询

```css
/* 媒体查询：按视口宽度分支 */
@media (max-width: 768px) {
    .layout { flex-direction: column; }      /* 手机：侧栏上移 */
}

/* 流式优先：弹性布局先做满，断点只做「结构调整」 */
.grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
@media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }

/* 容器查询（现代）：按「容器」宽度响应（组件级响应式！） */
.card-wrap { container-type: inline-size; }
@container (min-width: 400px) {
    .card { flex-direction: row; }           /* 卡片自己宽了就横排——不关心视口 */
}
```

响应式的思想演进：**移动优先**（先写手机样式，min-width 逐步增强）vs 桌面优先（max-width 降级）——移动优先的渐进增强更健康。**容器查询**是范式转变：组件按自己容器宽度响应（同一组件在侧栏与全宽处形态不同）——组件库的响应式从「猜视口」变成「看容器」。

## 5. 经典配方速查

```css
/* 完美居中 */
.center { display: grid; place-items: center; min-height: 100vh; }

/* 圣杯布局（头部/底栏/侧栏/内容） */
.page {
    display: grid;
    grid-template-columns: 240px 1fr;
    grid-template-rows: auto 1fr auto;
    grid-template-areas: "header header" "sidebar main" "footer footer";
    min-height: 100vh;
}

/* 底部固定（footer 贴底） */
body { display: flex; flex-direction: column; min-height: 100vh; }
main { flex: 1; }

/* 内容溢出省略号 */
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 等比宽高比 */
.media { aspect-ratio: 16 / 9; }
```

## 6. 陷阱清单

- flex 主轴交叉轴想反（flex-direction: column 时对齐属性互换）：换方向时重新对照轴。
- flex 项被内容撑破：min-width: 0 / min-height: 0。
- 忘 gap 用 margin hack（最后一个多出的 margin）：gap 是正解。
- z-index 失效乱堆大数字：层叠上下文问题；先理解再治理。
- 媒体查询撒满魔法断点：auto-fill/auto-fit 的流式布局优先、断点只管结构变化。
- 绝对定位当布局工具（left: 137px）：布局用 flex/grid、定位只做「挂件」。
- 移动端 100vh 问题：dvh/svh。
- 图片/视频未限宽撑破容器：`img { max-width: 100% }` 全局标配。

## 7. 小结

- 布局选型的现代答案：一维 flex、二维 grid、脱离文档流用 position（sticky 管吸顶吸附）——float 只剩文字环绕的原始职责。
- flex 的心智是主轴/交叉轴 + flex 三分量（grow/shrink/basis）；min-width:0 与 gap 是两大常用补丁。
- grid 的心智是「先画图纸」（template-columns/areas）再放内容；auto-fill+minmax 是响应式卡片墙的一行答案。
- 响应式的演进：移动优先的断点策略 + 流式布局优先 + 容器查询的组件级响应。
- 经典配方（居中/圣杯/贴底/省略号）应内化为「读过即可复制」的肌肉记忆——布局问题 90% 落在这几个形状里。

## 8. 练习

**1.** 用 flex 与 grid 各实现一次「圣杯布局」（头/尾/侧栏/内容），对比两者的声明方式与「改布局成本」（如侧栏换到右侧各要改什么）。

> [!TIP]
> 思路grid 的 areas 图纸改一个词即换布局；flex 要动 DOM 顺序或 order 属性。「布局即声明」是 grid 的架构优势——适合页面骨架。

**2.** 复现并修复 min-width:0 坑：flex 布局里放一个超长英文单词/宽表格，观察撑破；加 min-width:0 + overflow 处理验证。

> [!TIP]
> 思路这是「flex 布局下内容溢出」的头号原因——面试高频题，实战更常见。`overflow-wrap: anywhere` 是文本换行的现代补丁。

**3.** 用 `repeat(auto-fill, minmax(240px,1fr))` 做卡片墙，拖动窗口宽度观察列数自适应；再加一个 @container 让卡片在窄容器里纵排——体验视口响应 vs 容器响应的差异。

> [!TIP]
> 思路同一个卡片组件放进侧栏（窄）与主区（宽）形态自动不同——容器查询让「组件级响应式」成为现实，组件库设计的范式转变。

**4.** 实现「吸顶表头 + 侧栏跟随」：长表格用 position: sticky 做表头，右侧目录用 sticky 跟随滚动——验证 sticky 的阈值与父容器限制。

> [!TIP]
> 思路sticky 的两个约束：相对「最近的滚动祖先」吸附、父容器范围内有效（父容器滚出就跟着走）——「为什么 sticky 不粘了」多半是父容器 overflow 或高度问题。

**5.** 排查一次「z-index 无效」：元素设了 z-index: 9999 仍被盖——检查层叠上下文（transform/opacity 的父级创建新上下文），用 DevTools Layers 面板可视化验证。

> [!TIP]
> 思路层叠上下文是「z-index 的作用域」——父级有 transform/opacity/filter 时子级 z-index 只在父级内比。「9999 军备竞赛」的根源是没理解上下文。

**6.** 讨论：为什么「float 布局」能统治十年然后被 flex/grid 两年替代？从「表达力与意图的错位」（借排版属性做布局）与「新原语的正交性」分析，对照 [数据库索引](../database/06-index.md)与「用错抽象层的代价」——工具的原生语义有多重要？

> [!TIP]
> 思路float 的年代是「没有布局原语时的 hack」——clear:both、负 margin、伪元素清除的全家桶都是错位使用的补丁。原语出现后 hack 一夜归零：**生态等待正确的抽象，而不是在错误抽象上修补**。
