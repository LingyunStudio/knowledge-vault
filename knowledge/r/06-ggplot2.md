---
title: ggplot2：图形的语法
order: 6
tags: ggplot2, aes, geom, facet, ggsave
summary: 图形语法的数据-映射-几何三层模型、常用 geom 族与统计变换、标度与图例、facet 分面、主题与 labs、ggsave 导出，以及「图层叠加」如何把复杂图分解成简单声明。
---

ggplot2 不是「画图函数的集合」，而是**图形语法的实现**：一张图 = 数据 + 映射（aesthetic）+ 几何对象（geom）+ 标度 + 分面 + 主题的**分层组合**。学会这套语法后，画新图不再是「查哪个函数」，而是「描述这张图由哪些层组成」。

## 1. 三层核心：数据、映射、几何

```r
library(ggplot2)

ggplot(mtcars, aes(x = wt, y = mpg)) +     # 数据 + 映射：wt 作 x、mpg 作 y
    geom_point()                            # 几何层：散点
```

- `ggplot(data, aes(...))`：**数据与美学映射**——「哪列承担哪个视觉角色」。
- `geom_*()`：**几何对象**——「用什么形状表达」。
- 图层用 `+` 叠加（R 的 + 在 ggplot 里是图层组合符）。

同一份数据换 geom 即换视图——语法的红利：

```r
ggplot(mpg, aes(x = class)) + geom_bar()                    # 计数
ggplot(mpg, aes(x = class, y = hwy)) + geom_boxplot()       # 分布
ggplot(mpg, aes(x = displ, y = hwy)) + geom_smooth()        # 关系 + 置信带
ggplot(mpg, aes(x = hwy)) + geom_histogram(bins = 20)       # 直方图
```

**映射（aes）与设置（参数）的区分**是第一道坎：`aes(color = class)`（按数据列着色——每类一色，自动图例）vs `color = "red"`（整层一个颜色——与数据无关）。写在 aes 里的是「数据的函数」，写在外面的是「图的常量」。

## 2. 多组与多图：分组映射与 facet

```r
ggplot(mpg, aes(x = displ, y = hwy, color = class, size = cyl)) +
    geom_point(alpha = 0.7)                    # 颜色/大小再映射两列 + 透明度防重叠

ggplot(mpg, aes(x = displ, y = hwy)) +
    geom_point() +
    geom_smooth(method = "lm") +
    facet_wrap(~ class, ncol = 3)              # ★ 分面：按 class 切成多张子图（同尺度对比）

ggplot(mpg, aes(x = displ, y = hwy)) +
    geom_point() +
    facet_grid(drv ~ year)                     # 二维分面（行 drv × 列 year）
```

「分组看差异」的两种表达：**映射分组**（一图多色，适合少量组）与**分面**（多图同尺度，适合多组或趋势对比）——图例与坐标对齐是分面的自动红利。

## 3. 标度与图例

```r
ggplot(df, aes(x = x, y = y, color = value)) +
    geom_point() +
    scale_x_log10() +                          # 对数轴
    scale_y_continuous(labels = scales::percent) +   # 轴标签格式化
    scale_color_viridis_c() +                  ★ 连续色标（感知均匀，替代默认/彩虹）
    scale_color_brewer(palette = "Set2") +     # 分类的调色板
    labs(title = "主标题", x = "排量 (L)", y = "油耗 (mpg)",
         color = "车型", caption = "数据来源: …")    # ★ 全部标注集中在此
```

标度层回答「数据值 → 视觉属性」的翻译规则（轴变换、色彩映射、图例条目）；`labs()` 集中管理所有文字标注——**图的标题/轴/图例名字是「图的可读性」的一半**。

## 4. 主题与出版级样式

```r
p <- ggplot(df, aes(x, y)) + geom_point() +
    theme_minimal(base_size = 12) +            # 底主题（minimal/bw/classic/light）
    theme(
        panel.grid.minor = element_blank(),    # 去次网格
        legend.position = "top",
        plot.title = element_text(face = "bold")
    )
ggsave("fig.pdf", p, width = 6, height = 4, units = "in")    # 矢量导出（尺寸即物理尺寸）
ggsave("fig.png", p, dpi = 300)
```

主题是「非数据元素的样式」：底主题（theme_minimal 等）一键定调，`theme()` 微调细节；样式固化的工程做法是写一个 `theme_mine()`（与 [MATLAB 的样式函数](../matlab/06-plotting.md)、ggplot 的[一致性哲学]同源）——所有图共享一套外观。

## 5. 统计变换与组合

```r
ggplot(df, aes(x = grp, y = val, fill = grp)) +
    stat_summary(fun = mean, geom = "bar") +                 # 组均值柱
    stat_summary(fun.data = mean_cl_normal, geom = "errorbar", width = 0.2) +
    geom_point(position = position_jitter(width = 0.2), alpha = 0.4)   # 原始点抖动叠加

ggplot(df, aes(x = val, fill = grp)) +
    geom_density(alpha = 0.4)                                # 半透明密度叠加

ggplot(df, aes(x, y)) +
    geom_col() + coord_flip()        # 横向条形（长标签友好）
```

ggplot 的图层可自由叠加：**统计层（均值/误差棒）+ 原始数据层（散点）同图出现**是「既给结论又给证据」的可视化最佳实践——`position_jitter/position_dodge` 管理重叠元素的排版。

## 6. base graphics 一瞥（读懂旧代码）

```r
plot(x, y)                       # base：面向过程，逐步低层控制
lines(x2, y2)                    # 叠加线
abline(h = 0, lty = 2)           # 参考线
par(mfrow = c(2, 2))             # 多图布局（对应 facet 的原始形态）
hist(rnorm(100))
```

base graphics（plot/lines/par）是过程式的「画一笔是一笔」，无图例自动管理、无图层概念——读得懂即可，新图用 ggplot2（表达力、一致性与自动化全面占优）。

## 7. 陷阱清单

- 映射与设置混写：`aes(color = "red")` 得到红色图例的单色图——数据相关进 aes、常量在外。
- ggplot 的 `+` 换行写法：`ggplot(...) + geom_point()` 拆行时 **+ 必须留在行尾**（行首的 + 是对上一行结果做加法——经典静默错误）。
- 忘 alpha 防重叠：大散点图变成实心块；`alpha = 0.3` 是大数据图标配。
- 分面后自动缩放误导（各组量级不同）：`scales = "free_y"` 按需放开，但要标注。
- 直方图 binwidth 乱猜：`geom_histogram(binwidth = ...)` 显式；不同 bin 的直方图结论可以完全相反。
- 汇总图与原始图脱节：均值柱 + 抖动散点的组合层（第 5 节）优于只给汇总。
- ggsave 记的是「最后一个 plot」：保存指定对象用 `ggsave(file, plot = p)` 显式传参。

## 8. 小结

- 图形语法 = 数据 + aes 映射 + geom 几何 + 标度 + 分面 + 主题的分层叠加；`+` 组合图层，同数据换 geom 即换视图。
- aes vs 参数的二分（数据相关/常量）是 ggplot 的第一原则；分组用映射、多组对比用 facet。
- 标度管「值→视觉」翻译（log 轴/viridis/图例名），labs 集中所有文字；主题固化非数据样式。
- 统计层与原始层同图（均值+散点/误差棒）是诚实可视化；position_ 系列管重叠排版。
- ggsave 显式传 plot 对象、矢量优先——出版管线与 [MATLAB exportgraphics](../matlab/06-plotting.md) 同构。

## 9. 练习

**1.** 用同一份 mpg 数据画四张图（bar/boxplot/point+smooth/histogram），每张只改 geom——体会「语法复用」与 [matplotlib 系](../python/03-control-flow.md)逐图 API 的差异。

> [!TIP]
> 思路ggplot 的声明（数据+映射）不变，geom 一换视图即换；matplotlib 每种图一套函数签名。语法的价值在「学习成本一次性」。

**2.** 复现「均值柱 + 误差棒 + 抖动散点」的组合图（stat_summary × 2 + geom_point），并用 facet 按第二分组变量拆分——把第 5 节的模板用活。

> [!TIP]
> 思路position_dodge 让两组柱并排、jitter 散点对应加 dodge 宽度——「position 系列的一致性」是这类组合图不重叠的关键。

**3.** 做一张「出版级」面板：theme_minimal、labs 全套标注、viridis 色标、坐标对数化、ggsave 6×4 英寸 PDF——再写 theme_my() 固化样式供三个不同数据集复用。

> [!TIP]
> 思路样式函数签名：`theme_my <- function() theme_minimal(base_size = 12) + theme(...)`——与图表代码解耦。三数据集复用时改的只有数据与映射，样式零重复。

**4.** 故意制造三个 ggplot 经典错误：行首的 +、aes 里写字符串常量、直方图不设 binwidth——观察每个的错误形态（报错/静默/误导），写出排查口诀。

> [!TIP]
> 思路行首 + 的报错难懂（对象加法失败）、aes("red") 静默出图例、binwidth 误导结论——三种「错误可见性」的教材。口诀：+ 在行尾、映射进 aes、bin 宽要给。

**5.** 用 ggplot 复刻[第 5 篇](05-dplyr.md)练习 4 的分组汇总：group_summary 表 → geom_col + facet，把「数据整理链」与「可视化链」用同一列名无缝衔接——体会 tidy data 的管道贯通。

> [!TIP]
> 思路dplyr 输出的列名直接进 aes——「tidy 数据 → 语法映射」零翻译。数据形状与可视化语法的设计一致性是 tidyverse 全家桶的真实红利。

**6.** 讨论：为什么 ggplot2 的「语法化」比「函数集合」更能支撑复杂图？从「组合爆炸的控制」（每个维度独立正交）与「图的审查性」（每层声明可核对）两个角度，对照 [MATLAB 句柄](../matlab/06-plotting.md)与 base graphics 的过程式模型。

> [!TIP]
> 思路正交维度（数据/映射/几何/标度/分面/主题独立组合）把 M^N 的图空间压缩成 M+N 的声明组合；审查性：「这张图为什么这样画」的答案在代码层结构里。声明式 > 过程式的通用定律，在 SQL（[第 5 篇练习 6](05-dplyr.md)）与 dplyr 已见同款。
