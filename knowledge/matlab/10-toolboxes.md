---
title: 工具箱速览
order: 10
tags: 进阶, Simulink, 工具箱
summary: Simulink/符号计算/信号处理/优化工具箱的定位与入口，按需选型不迷路。
---

MATLAB 本体只是底座，领域级能力几乎都在工具箱（Toolbox）里：框图仿真、符号推导、滤波器设计、约束优化各有专门的家伙什。先搞清每个工具箱"解决什么问题、入口函数是谁"，按需选型，不迷信全家桶。

## Simulink：框图式建模仿真

定位完全不同于脚本：不是写代码，而是**画框图**——积分器、增益、传递函数等模块连成系统，定义输入后由求解器仿真运行。控制系统、电力电子、通信、机械动力学的建模仿真事实标准。

- 入口：命令行敲 `simulink` 打开库浏览器，`sim('model')` 运行模型
- 与脚本互通：From Workspace / To Workspace 模块交换数据；参数在脚本里改完批量扫参仿真
- 调试手段：Scope 看波形、信号 Logging 存回工作区、连线悬停看数值
- 心智模型：Simulink 管"连续时间动态系统 + 控制设计 + 硬件在环"；纯数据分析用它属于杀鸡用牛刀，脚本更直接

三个术语先对齐：**模块**（Block）是基本运算单元，**信号线**是数据流，**求解器**（Solver）负责把连续系统积出来。看懂这三个词，库浏览器里几千个模块就有了分类坐标。

一个最小模型就是"阶跃输入 + 传递函数 + Scope"三件：改参数、点运行、看曲线，控制课作业的完整闭环。底层是变步长数值积分（ode45 一族）自动解微分方程，你只管搭结构；需要部署时还能把模型生成 C 代码落到嵌入式（需 Embedded Coder）。

仿真参数在模型配置里设：StopTime 定仿真时长，变步长求解器自动调步长保精度。批量扫参不进模型界面改——用 `sim` 在脚本里循环调用，参数从工作区传入，结果回来直接画图，模型当"函数"用。

## 符号计算：Symbolic Math Toolbox

数值计算拿不到解析解时，符号引擎让 x 保持成符号：

```matlab
syms x a
f = a*x^2 + 3*x + 1;
solve(f == 0, x)            % 解析解：含参数 a 的表达式
diff(f, x)                  % 符号求导：2*a*x + 3
int(1/x, x, 1, 2)           % 符号积分：log(2) 而不是 0.6931...
simplify((x^2 - 1)/(x - 1)) % 化简 → x + 1
[sx, sy] = solve(x + y == 3, x^2 + y == 2, x, y)   % 方程组也能解
vpa(pi, 30)                 % 任意精度数值：精确到 30 位
fNum = matlabFunction(f);   % 转成数值句柄，无缝接回脚本
```

定位：推公式、验证算法、化简表达式。符号运算慢、吃内存、进不了大数据管线，正确姿势是"符号推结论，数值跑计算"：结论要精度用 `vpa`，要落地用 `matlabFunction` 转回句柄。

`syms` 报"未定义函数"多半是没装这个工具箱，先 `ver` 确认。另外符号与数值的边界要心里有数：方程无解析解时 `solve` 会返回空或冗长的隐式结果，不如直接退回数值方法。

## 信号处理：Signal Processing Toolbox

FFT 本体在基础版里就有，工具箱补齐"滤波器设计与分析"这条链：

```matlab
fs = 1000;  t = (0:fs-1)/fs;             % 采样率 1 kHz，采 1 秒
x = sin(2*pi*50*t) + 0.3*randn(size(t)); % 50 Hz 正弦 + 噪声
N = numel(x);
X = abs(fft(x))/N;
f = (0:floor(N/2))*(fs/N);               % 单边频率轴
plot(f, 2*X(1:numel(f)))                 % 峰应出现在 50 Hz

h = designfilt('lowpassiir', 'PassbandFrequency', 100, ...
    'StopbandFrequency', 200, 'SampleRate', fs);
xf = filtfilt(h, x);                     % 零相位滤波
spectrogram(x, 128, 120, 128, fs, 'yaxis')   % 时频图
```

常用入口：`designfilt` 设计滤波器（对话框式，参数填完即用）、`filtfilt` 零相位滤波、`pwelch` 功率谱估计、`spectrogram` 时频分析、`findpeaks` 找峰、`resample` 变采样率。滤波器类型覆盖低通/高通/带通/带阻，FIR 与 IIR 各有取舍；做频谱估计记得加窗（hann、hamming），`pwelch` 内部已代劳。

## 优化：Optimization Toolbox

基础版自带无约束小工具（`fminsearch`、`fminbnd`、`fzero`），带约束、大规模、整数规划才需要工具箱：

```matlab
% 无约束（基础版就有）
p0 = fminsearch(@(p) norm(A*p - b)^2, [0; 0]);

% 带约束的非线性优化
opts = optimoptions('fmincon', 'Display', 'iter');
[p, fval] = fmincon(@obj, p0, [], [], [], [], lb, ub, @nonlcon, opts);

% 混合整数规划：intcon 标出哪些变量必须取整
[x, fval] = intlinprog(f, intcon, Aineq, bineq, [], [], lb, ub);
```

选型一句话：线性规划 `linprog`，混合整数 `intlinprog`，带约束非线性 `fmincon`，非线性最小二乘 `lsqnonlin`（曲线拟合的主力），全局与启发式 `ga`、`particleswarm`。这类函数的套路高度一致：目标函数写成句柄、约束按模板给、选项用 `optimoptions` 调——学会一个，其余照抄结构。

返回结果别只看数值：`exitflag` 退出标志和求解日志是判断"收敛了还是卡住了"的依据，局部最优不保证全局最优——把结果画出来验一眼，是最便宜的正确性检查。

## 按需选型速查

| 工具箱 | 典型问题 | 入口函数 |
| --- | --- | --- |
| Simulink | 动态系统框图仿真、控制设计 | `simulink` / `sim` |
| Symbolic Math | 解析解、公式推导 | `syms`、`solve`、`diff` |
| Signal Processing | 滤波、频谱、时频分析 | `designfilt`、`spectrogram` |
| Optimization | 拟合、约束优化、规划 | `fmincon`、`lsqnonlin` |
| Statistics and ML | 回归、分类、分布拟合 | `fitlm`、`fitcsvm`、`histfit` |
| Image Processing | 滤波、分割、形态学 | `imread`、`imfilter`、`regionprops` |
| Control System | 传递函数、PID 整定 | `tf`、`step`、`pidtune` |
| Curve Fitting | 经验公式拟合 | `fit`、曲线拟合 App |
| Parallel Computing | 并行循环、GPU 计算 | `parfor`、`gpuArray` |
| Deep Learning | 训练与部署神经网络 | `trainnet`、`dlnetwork` |
| DSP System | 流式信号处理、音频通信链路 | `dsp.FIRFilter` 等对象 |
| Test & Measurement | 仪器控制、数据采集 | `visadev`、`daq` |

用 `ver` 查看本机已装清单；每个工具箱的文档首页（如 `doc optim`）都有 Getting Started 入门线，按着走一遍比自己乱翻快。

## 学习路线建议

工具箱的正确打开方式：先把问题域的核心概念弄懂——做优化先懂"可行域、凸性、局部 vs 全局"，做信号先懂"采样定理、时频分辨率"，再按 doc 的 Getting Started 走示例线，最后回到自己的问题上改造示例。直接抄示例改参数是起步最快的方式，也最容易停留在表面；花两三小时读概念页，是这个层面性价比最高的投资。

决策顺序建议：基础版函数 → 已装工具箱 → File Exchange → 开源生态。反过来走（一上来就全家桶）容易把简单问题做复杂，也让代码背上不必要的依赖。

这张地图换语言同样有效：Simulink 对应 Modelica 一类仿真器，Symbolic 对应 SymPy，信号处理对应 SciPy.signal，优化对应 SciPy.optimize——概念是通的，换的只是工具名。

> [!NOTE]
> 很多"以为要装工具箱"的功能基础版就有：FFT、多项式拟合（`polyfit`/`polyval`）、`fminsearch`、`fzero`、`integral`、基础统计。动手前先 `doc` 搜一遍，确认不是自己重复造轮子。

> [!WARNING]
> 没装对应许可证的工具箱函数就是"未定义函数"，而且这类错误往往在别人的电脑上才爆出来。写要分发的代码时，开头用 `license('test', 'Optimization_Toolbox')` 或 `exist('fmincon', 'file')` 做依赖检查，报错越早越体面。

> [!TIP]
> 没有许可证先别急着放弃：查 `ver` 看校园版/试用授权，再不行看 File Exchange（官方插件市场）和开源替代——Python 的 SciPy 生态与 MATLAB 工具箱几乎一一对应，迁移成本比想象低。工具箱的学习成本主要在概念而非语法：概念对口，函数一查就会；概念不对，装了也用不起来。

相关阅读：[线性代数与统计](08-linear-algebra.md)、[绘图](06-plotting.md)
