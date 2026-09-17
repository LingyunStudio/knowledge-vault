---
title: ggplot2 可视化
order: 5
tags: 核心, ggplot2, 图形
summary: 图层语法：数据+映射+几何，常用 geom、分面与主题一条龙。
---

ggplot2 的核心是「图层语法」：一张图 = 数据 + 美学映射 + 几何对象，再按需叠加坐标轴、分面、主题。掌握这个分解后，画图从「每种图查一次教程」变成「把想表达的东西翻译成图层」。

## 三件套：数据、映射、几何

```r
library(tidyverse)
ggplot(mpg, aes(x = displ, y = hwy, color = class)) +
  geom_point()      # 排量 vs 高速油耗，按车型着色
```

三个组成部分各司其职：

- `ggplot(mpg, ...)`：给数据
- `aes()`（aesthetics）：把**列**映射到视觉通道——x、y、color、fill、size、shape
- `geom_xxx()`：选几何对象，散点、线、柱、箱线……

换几何对象就是换叙事角度，数据不用动：

```r
ggplot(mpg, aes(x = class, y = hwy)) + geom_boxplot()     # 组间分布对比
ggplot(mpg, aes(x = hwy)) + geom_histogram(binwidth = 2)  # 单变量分布
ggplot(mpg, aes(x = displ, y = hwy)) + geom_smooth()      # 趋势线，默认带置信带
```

## 映射错了，图就错了

```r
# ❌ 把常量放进 aes，产生无意义图例
ggplot(mpg, aes(displ, hwy, color = "blue")) + geom_point()

# ✅ 统一改颜色：写在 geom 层
ggplot(mpg, aes(displ, hwy)) + geom_point(color = "blue")

# ✅ 按列分组着色：裸列名放进 aes，不加引号
ggplot(mpg, aes(displ, hwy, color = class)) + geom_point()
```

口诀就一句：**aes 里放列名，aes 外放值**。`aes(color = "red")` 会把字符串 "red" 当成一列数据去分组——图上出现诡异的单一红色图例，就是这么来的。散点重叠时用 `alpha` 调透明度，是散点图的日常参数。

> [!NOTE]
> `geom_histogram()` 默认按数据自动分箱，同样的数据分箱数可能随会话变化；报告里固定 `binwidth` 才能保证每次渲染出同一张图。

## 常用 geom 速查

| 需求 | geom | 要点 |
| --- | --- | --- |
| 两变量关系 | `geom_point()` | `alpha` 抗重叠 |
| 趋势 | `geom_smooth()` | `method = "lm"` 或 `"loess"` |
| 组间分布 | `geom_boxplot()` / `geom_violin()` | — |
| 单变量分布 | `geom_histogram()` | 手动指定 `binwidth` |
| 分类计数 | `geom_bar()` | y 自动是频数 |
| 分类数值 | `geom_col()` | y 是数据列 |
| 时序折线 | `geom_line()` | 先按 x 排好序 |
| 文字标注 | `geom_text()` | `check_overlap = TRUE` |

`geom_bar` 与 `geom_col` 的区别必须分清：bar 帮你**数数**，col 画你给的**数值**。想画各区域销售额却用了 bar，画出来的是订单条数——经典的答非所问。

坐标与标度按需微调，函数名一律以 `scale_` / `coord_` 开头：

```r
ggplot(mpg, aes(class, hwy)) +
  geom_boxplot() +
  coord_flip() +                               # 横竖互换，长类别名更易读
  scale_y_continuous(breaks = seq(10, 45, 5))  # 手动控制刻度
```

## 分面：比六种颜色更好读

往一张图里塞太多分组，颜色会先崩溃；分面把图按类别切开，每组一个小面板：

```r
ggplot(mpg, aes(displ, hwy)) +
  geom_point() +
  facet_wrap(~ class)      # 单变量分面，自动换行排布

ggplot(mpg, aes(displ, hwy)) +
  geom_point() +
  facet_grid(drv ~ cyl)    # 行 ~ 列，双向分面
```

一个完整的出图脚本通常是「图层叠罗汉」：

```r
p <- ggplot(mpg, aes(x = class, y = hwy, fill = class)) +
  geom_boxplot(show.legend = FALSE) +
  labs(title = "各车型高速油耗分布", x = "车型", y = "高速 MPG") +
  theme_minimal() +
  theme(axis.text.x = element_text(angle = 30, hjust = 1))

ggsave("output/hwy-by-class.png", p, width = 7, height = 5, dpi = 300)
```

把图存进对象 `p` 是标准工作流：可以继续往上加图层、可以 `ggsave()` 出文件、可以塞进 R Markdown（见第 10 篇）。别用 RStudio 面板右键另存——尺寸和 dpi 都不受控。

## 柱子的顺序是因子问题

ggplot 画分类轴按**因子水平**的顺序排列，而 `factor()` 默认按字符串排序（`sort(unique(x))`），既不是数值大小也不是出现顺序——所以柱子经常高低乱插：

```r
# ❌ 直接画，柱子按字母序排列
# ✅ 先汇总，再用 forcats 按数值重排
mpg %>%
  group_by(class) %>%
  summarize(avg_hwy = mean(hwy)) %>%
  ggplot(aes(forcats::fct_reorder(class, avg_hwy), avg_hwy)) +
  geom_col()
```

`forcats` 包专门管因子：`fct_reorder` 按数值排序、`fct_infreq` 按频数排序、`fct_lump` 合并小类。分类变量的排序问题，十有八九要回到因子水平上去解决。

> [!TIP]
> `theme_minimal()`、`theme_bw()` 一行换风格，够用九成五的场合。细节用 `theme()` 配 `element_text()` / `element_rect()` 微调，需要时再查，不必背。

## 练习

- [ ] 画 displ-hwy 散点：按 class 着色，再 facet_wrap(~ drv) 分面
- [ ] 复现「aes(color = "red") 出红色图例」的错误，再用正确写法修复
- [ ] 画各 class 平均 hwy 的柱状图，柱子按数值降序排列

相关阅读：[dplyr 数据处理](04-dplyr.md)
