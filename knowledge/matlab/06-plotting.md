---
title: 绘图
order: 6
tags: 核心, plot, 可视化
summary: plot 线型与标注、hold 与 subplot、常用图类型、导出出版级图片。
---

MATLAB 绘图是"一行命令出图，对象模型兜底"：日常场景 plot + hold + 标注三件套足够；要精细控制时，理解 Figure（图窗）→ Axes（坐标系）→ Line（线对象）三层模型是钥匙。

## plot 与标注

```matlab
x = linspace(0, 2*pi, 200);
y1 = sin(x);
y2 = cos(x);

figure
plot(x, y1, 'b-o', 'LineWidth', 1.2, 'MarkerSize', 4)
hold on                                   % 保持坐标系，后续画线叠加
plot(x, y2, 'r--', 'LineWidth', 1.2)
hold off

title('sin 与 cos')
xlabel('x / rad');  ylabel('幅值')
legend({'sin', 'cos'}, 'Location', 'best')   % 图例按绘制顺序对应
grid on;  xlim([0 2*pi])
```

不写 `hold on`，每次 plot 都会清空坐标系重画——新手"图里只剩一条线"的原因九成是这个。线型、颜色、标记可以缩写成一个字符串：

| 要素 | 符号 |
| --- | --- |
| 线型 | `-` 实线、`--` 虚线、`:` 点线、`-.` 点划线 |
| 颜色 | `r` 红、`g` 绿、`b` 蓝、`k` 黑、`m` 品红、`c` 青 |
| 标记 | `o` 圆、`x` 叉、`+` 加、`s` 方、`d` 菱、`^` 三角 |

`plot(x, y, 'ro--')` 即"红色虚线 + 圆点标记"。颜色也可以给 RGB 三元组 `[0.2 0.6 0.8]`，需要精确配色时用它。

坐标轴微调用 `axis` 家族：`axis equal` 等比例（画圆不变形）、`axis tight` 收紧到数据范围、`axis off` 隐藏坐标轴。

> [!WARNING]
> 循环里反复 plot 而不 `hold on`，只留下最后一次的线；反之 hold on 之后忘了 hold off，下一条命令继续叠加。每画一组数据前想清楚"叠加还是替换"，用完 hold 就收。

## 对象模型：句柄在手，属性随便改

plot、title 这些函数都返回对象句柄，对象的属性就是可视化的全部可调项：

```matlab
p = plot(x, y1);          % Line 对象
p.Color = [0.85 0.33 0.10];
p.LineWidth = 2;

ax = gca;                 % 当前 Axes（get current axes）
ax.FontSize = 12;
ax.YGrid = 'on';
ax.XLabel.String = 't / s';   % 属性层层嵌套，一路点下去
```

想改的属性几乎都能 `doc` 到（属性列表就在每个对象的文档页里）。记住对象模型，比背几百个参数组合划算——这也是 MATLAB 图"看着不像默认 MATLAB 图"的全部秘密。

## 多图布局

```matlab
subplot(2, 1, 1)          % 2 行 1 列的第 1 块
plot(x, sin(x))
subplot(2, 1, 2)
plot(x, cos(x))
```

R2019b+ 推荐 `tiledlayout` 替代 subplot：间距可控、支持整体标题：

```matlab
tl = tiledlayout(2, 1, 'TileSpacing', 'compact');
nexttile;  plot(x, sin(x))
nexttile;  plot(x, cos(x))
title(tl, '两个子图的共享标题')
```

一个 figure 里多套坐标系，多个 figure 用 `figure(n)` 编号切换。展示多组对比数据时，子图分屏比把八条线挤进一张图诚实得多。

## 常用图类型选型

| 想看什么 | 用什么 |
| --- | --- |
| 函数/序列走势 | `plot` / `fplot`（免手造网格） |
| 两变量离散关系 | `scatter`（可映射点大小与颜色） |
| 类别比较 | `bar` / `barh` |
| 数据分布 | `histogram`（自动分箱） |
| 均值 ± 误差 | `errorbar` |
| 跨数量级 | `semilogx` / `semilogy` / `loglog` |
| 逐点竖线/阶梯 | `stem` / `stairs`（采样与离散系统常用） |
| 占比 | `pie`（场合有限，慎用 3D 版） |
| 分组分布对比 | `boxchart` |
| 矩阵/热力图 | `imagesc` / `heatmap` |
| 三维面 | `surf` / `contour`（等高线） |

```matlab
scatter(x, y, 20, vals, 'filled')    % 第 3 参定大小，第 4 参上色
histogram(randn(1000, 1), 30)        % 30 个箱
fplot(@sin, [0 2*pi])                % 直接画函数句柄，不必造 x

[X, Y] = meshgrid(-2:0.1:2);         % 二维网格：三维图的标配
Z = X.^2 + Y.^2;
surf(X, Y, Z);  colorbar;  shading interp
```

## 导出出版级图片

```matlab
exportgraphics(gcf, 'fig1.png', 'Resolution', 300)        % R2020a+，自动紧边框
exportgraphics(gcf, 'fig1.pdf', 'ContentType', 'vector')  % 矢量格式
print('-dpng', '-r300', 'fig1')      % 老命令，带白边
saveas(gcf, 'fig1.png')              % 更老，分辨率不可控
```

`exportgraphics` 是当前的答案：默认裁掉白边、支持指定分辨率与矢量输出，比 print/saveas 省心一代。

> [!TIP]
> 论文插图首选 exportgraphics + PDF 矢量（`ContentType` 为 `vector`），插进 LaTeX/Word 放大不糊。导出前把图窗设成目标排版尺寸（如 `set(gcf, 'Units', 'centimeters', 'Position', [0 0 8 6])`），字号比例才不会失调；坐标轴文字用 `FontSize` 显式定大小，别依赖默认值。

相关阅读：[矩阵基础](02-matrix-basics.md)、[数据导入导出](07-data-io.md)
