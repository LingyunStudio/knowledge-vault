---
title: 可视化：从 plot 到出版级图表
order: 6
tags: plot, subplot, surf, 图形句柄, exportgraphics
summary: plot 的 LineSpec 与属性系统、hold/tiledlayout 的图面管理、常用二维图族（scatter/bar/histogram/errorbar）、三维 surf/contour 与 colormap、出版级导出（exportgraphics），以及图形句柄的编程式控制。
---

MATLAB 的可视化与计算无缝衔接：变量在命令窗里算完，一行 `plot` 立即成图。本篇按「画得出来 → 画得好看 → 画得可发布」三层推进，终点是用**图形句柄**编程式控制一切视觉元素。

## 1. plot：线条与属性

```matlab
x = linspace(0, 2*pi, 200);
plot(x, sin(x))                          % 最小图

plot(x, sin(x), 'r--o', x, cos(x), 'b-.')  % LineSpec：颜色+线型+标记 三合一
%  颜色：r红 g绿 b蓝 k黑 m品红 c青 y黄
%  线型：- 实线  -- 虚线  : 点线  -. 点划线
%  标记：o x + * s d ^ v p h

plot(x, sin(x), 'LineWidth', 1.5, 'Color', [0.2 0.4 0.8], ...
     'MarkerSize', 5, 'MarkerFaceColor', 'auto')   % Name-Value 属性（精细控制）
```

图面装配四件套：

```matlab
hold on                       % ★ 保持：后续 plot 叠画在同一坐标系（默认会清屏！）
plot(x, cos(x))
hold off
legend('sin', 'cos', 'Location', 'best')
xlabel('时间 (s)'); ylabel('幅值'); title('信号对比'); grid on
xlim([0 pi]); ylim([-1.2 1.2]); axis tight    % 坐标范围（axis equal/x/y 固定纵横比）
```

`hold on` 是初学者「图被覆盖」的唯一原因——MATLAB 默认每次 plot 重绘整个坐标系。

## 2. 多图布局：tiledlayout

```matlab
figure
tiledlayout(2, 2)                      % R2019b+；旧版用 subplot(2,2,i)
nexttile; plot(x, sin(x));  title('sin')
nexttile; plot(x, cos(x));  title('cos')
nexttile; scatter(rand(50,1), rand(50,1)); title('scatter')
nexttile; histogram(randn(1000,1)); title('hist')
```

tiledlayout 的间距与跨格控制（`tileindex` 跨行列）优于 subplot 的紧凑排版问题；「一图一窗口还是多图分格」取决于对比需求——**同参数不同条件的曲线放一格（hold），不同量纲放不同格**。

## 3. 二维图族：按数据形态选图

```matlab
scatter(x, y, size, color, 'filled')     % 散点：相关性的第一眼
bar([a; b]')                              % 柱状（分组）；barh 横向
histogram(data, 30)                       ★ 直方图（R2014b+：自动分箱 + 句柄可控）
errorbar(x, y, yerr, 'o-')                % 误差棒：实验数据的诚实表达
stairs(t, y)                              % 阶梯：采样保持信号
area(x, y)                                % 面积：堆叠量
imagesc(M); colorbar                      % 矩阵热图（频谱/图像的默认形态）
boxplot(data, groups)                     % 统计工具箱：分布对比
```

选图哲学：**分布 → histogram/boxplot；关系 → scatter/plot；组成 → bar/area；强度场 → imagesc/surf**。用错图的形态（比如折线连散点暗示不存在的连续性）是可视化事故的常态。

## 4. 三维与 colormap

```matlab
[X, Y] = meshgrid(-2:0.05:2);
Z = exp(-(X.^2+Y.^2));

surf(X, Y, Z)                       % 曲面；mesh 线框
shading interp                      % 平滑着色（faceted/flat/interp）
colorbar; colormap parula           % 色图（MATLAB 默认 parula；jet 色彩失真慎用）
contour(X, Y, Z, 20); hold on       % 等高线叠加
view(45, 30)                        % 视角（方位角, 仰角）；rotate3d 交互
plot3(t, x, y)                      % 三维曲线
```

三维图的工程要点：**3D 图常用于探索（旋转观察），2D 截面用于结论（报告里可读）**——评审文档里的 surf 配 contour 投影比纯 3D 曲面信息密度更高。

## 5. 出版级导出

```matlab
figure('Units', 'centimeters', 'Position', [2 2 8 6])   % 目标物理尺寸
plot(x, y, 'LineWidth', 1.2); set(gca, 'FontSize', 10, 'FontName', 'Arial')

exportgraphics(gcf, 'fig1.pdf', 'ContentType', 'vector')   % ★ R2020a+：矢量 PDF/EPS
exportgraphics(gca,  'fig1.png', 'Resolution', 300)        % 高分辨率位图（幻灯片）
```

出版四要素：**合适物理尺寸（对应期刊栏宽）、足够字号（缩印后仍可读）、矢量格式（PDF/EPS，无限缩放）、无多余装饰**（`grid off`、边框收紧）。截图粘贴是图质量的第一杀手——exportgraphics 一条命令替代所有截图方案。坐标轴里的 LaTeX（`xlabel('$\omega$ (rad/s)', 'Interpreter', 'latex')`）服务数学记号。

## 6. 图形句柄：把图当数据编程

每个图形元素都是对象，持有句柄即可读写属性：

```matlab
h = plot(x, y);              % 线对象的句柄
h.Color = [1 0 0];           % 点语法改属性（R2014b+）
h.YData = y * 2;             % ★ 直接改数据：动画/交互更新的基础

ax = gca;                    % 当前坐标轴
ax.XGrid = 'on'; ax.FontSize = 12;
ax.XTick = 0:pi/2:2*pi; ax.XTickLabel = {'0','\pi/2','\pi','3\pi/2','2\pi'};

fig = gcf;                   % 当前窗口
fig.Name = '实验 A'; fig.NumberTitle = 'off';
fig.WindowButtonMotionFcn = @(src, ev) update_display(src);  % ★ 事件回调：交互式 GUI 的地基

% 批量控制：找全部线条改粗细
set(findobj(gca, 'Type', 'line'), 'LineWidth', 1.5)
```

句柄层是 MATLAB 可视化与 GUI（App Designer 之前的 GUIDE、uicontrol 全家）的底座——「程序生成并控制图」的能力让批量出图（循环里每条数据一张图）成为脚本而非手工。

## 7. 陷阱清单

- 忘 hold on：每次 plot 覆盖前图；「多曲线只剩一条」的唯一原因。
- LineSpec 与 Name-Value 混排顺序：'r--o' 这种三合一是位置参数，属性对跟在后面。
- subplot 的紧凑排版：用 tiledlayout；间距问题不再手调。
- jet 色图：明度不均匀造成视觉假梯度；科学出版物用 parula/viridis 类。
- 三维图直接截图进报告：导出用 exportgraphics + 合理视角；2D 截面给结论。
- 大数据直接 plot：百万点的线图卡顿与文件巨大；先抽稀（downsample）或用 `plot(..., 'Marker', 'none')`。
- 图例自动带出调试线：hold on 里的试验曲线用 legend('Off') 管理，或单独 handle 控制。

## 8. 小结

- plot 三层：LineSpec 快速、Name-Value 精细、句柄编程式——hold on 是叠画开关，legend/label/grid 是图面装配。
- tiledlayout 管多格布局；选图形态按数据语义（分布/关系/组成/场）。
- 三维 surf+contour 用于探索，报告里配 2D 截面；色图选明度均匀的（parula）。
- 出版导出一条命令：exportgraphics（矢量 ContentType 或高 Resolution），物理尺寸与字号按目标媒介设定。
- 图形句柄（gcf/gca/线条对象）让图成为可编程数据——批量出图、动画、GUI 的地基。

## 9. 练习

**1.** 在一张图里画 sin、cos、sin·cos 三条曲线，分别用三种颜色/线型，图例标注，横轴用 π 的刻度（XTick + XTickLabel），网格开启。

> [!TIP]
> 思路`ax.XTick = 0:pi/2:2*pi; ax.XTickLabel = {'0','\pi/2','\pi','3\pi/2','2\pi'};`——LaTeX 解释器让 \pi 正常显示。这张图就是「图面装配四件套」的综合。

**2.** 用 tiledlayout 做 2×2 面板：原始信号、频谱（fft 的幅值）、时频热图（imagesc）、直方图——同一数据四种视角，共享标题风格。

> [!TIP]
> 思路信号分析的「四视图」模板。注意每个面板的量纲标注与 colormap 统一（colorbar 只在有强度语义的面板出现）——多面板图的一致性是可读性的关键。

**3.** 用 meshgrid + surf 画 saddle 面 z = x² − y²，调整 view 到两个观察角各导出一张矢量 PDF，并叠加等高线。

> [!TIP]
> 思路`contour3` 或 `surf` + `contour(X,Y,Z,10,'LineWidth',0.5)` 叠加。exportgraphics 的 ContentType='vector' 在 PDF 里放大无损——验证方法：无限放大看线条。

**4.** 用图形句柄做「实时动画」：一条正弦线，循环里更新 h.YData 与 drawnow，实现相位滑动；记录 FPS 并讨论 drawnow limitrate 的作用。

> [!TIP]
> 思路句柄更新数据而不重建图（plot 复用 vs 每帧新对象）是动画的性能关键；drawnow limitrate 限刷新频率防渲染瓶颈。GUI/仿真显示的底层机制就是它。

**5.** 把一张默认参数的图改造成「出版级」：8cm 宽、10pt Arial、无顶右边框（box off 但保留左下）、线宽 1.2、导出 300dpi PNG 与矢量 PDF。写一个 style\_current\_axes 函数固化这套样式。

> [!TIP]
> 思路把样式操作封装成函数（或 startup.m 自动执行）——「出图风格一致性」靠代码不靠手调。期刊/学位论文的模板图函数是科研 MATLAB 工作流的高价值资产。

**6.** 讨论：为什么科研出版物嫌弃 jet 色图（彩虹图）？从「明度非线性造成的假边界」「色盲可读性」「打印灰度退化」三个角度分析，并写代码对比 jet 与 parula 在同一数据上的表现。

> [!TIP]
> 思路jet 的黄-红段明度突跳让数据「看起来」有条不存在的边界；灰度打印后彩虹变成无序灰阶。matplotlib 的 viridis（明度单调）成为事实标准后 MATLAB 的 parula 同理——可视化默认值的科学化是整个社区的进步。
