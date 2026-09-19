---
title: 工具箱地图：领域计算全家桶
order: 10
tags: 工具箱, 统计, 优化, 信号, Simulink
summary: 工具箱生态的构成（函数+App+示例）、统计/优化/信号/图像/控制五大工具箱的核心函数地图、Simulink 的图形化建模定位、以及「用工具箱还是自己写」的选型判断。
---

工具箱（Toolbox）是 MATLAB 的真正护城河：每个工具箱 = **一组领域函数 + 交互式 App + 成套示例**。语言层面的能力（矩阵、绘图、函数）是地基，工具箱是「领域知识的产品化」——统计检验的分布表、控制系统的稳定性判据、滤波器的设计公式都已被封装。本篇给出主要工具箱的地图与选型判断。

## 1. 生态概览

```matlab
ver                                  % 已安装的全部产品与版本
license('test', 'Signal_Toolbox')    % 检查某工具箱的授权
exist('fitlm', 'file')               % 函数是否存在（哪个产品提供）
```

工具箱的三个组件值得关注：**函数**（可编程调用）、**App**（交互式界面，如曲线拟合 App——拖数据点选模型，自动生成可复用代码）、**示例**（doc 里的 Getting Started 是最快的学习路径）。

## 2. Statistics and Machine Learning Toolbox

```matlab
% 描述与分布
mean/std/corr/cov                    % 基础统计（部分内建）
pd = fitdist(data, 'Normal')         % 拟合分布：pdf/cdf/random 全套跟随
mle(data, 'pdf', @mypdf)             % 最大似然（自定义分布）

% 假设检验
[h, p] = ttest2(x, y)                % 双样本 t 检验：h=1 拒绝原假设，p 是 p 值
[h, p] = kstest2(x, y)               % 分布相同性
anova1(M)                            % 方差分析

% 回归与分类
mdl = fitlm(x, y)                    % 线性回归：coef/RSquared/pValue 全套
mdl = fitlm(T, 'Temp ~ Speed + Load')   % 公式式建模（table 接口）
mdl = fitcsvm(X, y)                  % SVM 分类；fitctree 决策树；fitcensemble 集成
ypred = predict(mdl, Xnew)

% 多元统计
pca(X)                               % 主成分：得分/方差解释率/载荷
```

统计工具箱与 [table](07-data-io.md) 的组合是「MATLAB 数据科学」形态：`groupsummary` 聚合 → `fitlm` 建模 → `plotResiduals` 诊断。理论背景在[概率论篇](../prob/01-foundations.md)。

## 3. Optimization Toolbox

```matlab
fminsearch(@(x) (x(1)-2)^2 + x(2)^2, [0 0])    % 无导数优化（Nelder-Mead）
fminunc(objfun, x0)                    % 梯度优化（平滑无约束）
x = fmincon(objfun, x0, A, b, Aeq, beq, lb, ub, nonlcon)   % 带约束
[x, resnorm] = lsqnonlin(@(p) model(p) - data, p0)          % 非线性最小二乘（曲线拟合核心）
linprog / intlinprog                   % 线性/整数规划
```

选型三问：**有没有约束（fmincon 家族 vs fminsearch）、目标是否平滑（是否可提供梯度）、是不是最小二乘形态（lsqnonlin 专治拟合）**。拟合实验数据的标配是 lsqnonlin + 匿名函数参数化模型（[第 5 篇](05-functions.md)的句柄闭包在此发光）。

## 4. Signal Processing Toolbox

```matlab
Fs = 1000; t = 0:1/Fs:1;
x = sin(2*pi*50*t) + 0.5*randn(size(t));

Y = fft(x);                            % 频谱：f = (0:N-1)*Fs/N
P2 = abs(Y/N); P1 = P2(1:N/2+1); P1(2:end-1) = 2*P1(2:end-1);
plot(f, P1)                            % 单边幅值谱（标准三行）

b = fir1(64, 0.2);                     % FIR 低通（归一化截止 0.2×Fs/2）
y = filter(b, 1, x);                   % 滤波
filtfilt(b, 1, x)                      % 零相位滤波（前后向，信号处理的关键技巧）

pspectrum(x, Fs)                       % 现代谱估计（封装了窗/平均的细节）
spectrogram(x, 128, 120, 128, Fs)      % 时频图
```

信号处理的理论（采样定理、卷积、DFT 的频率泄漏）在信号课程与[网络/信号类资源]中；工具箱的价值是**把「正确的流程」变成默认**——pspectrum 自动加窗去泄漏，手写 fft 的三行模板则要求你自己记得补窗。

## 5. Image Processing Toolbox

```matlab
I = imread('cameraman.tif');
I2 = imadjust(I);                      % 灰度拉伸
H = fspecial('gaussian', [7 7], 2);    % 构造滤波核
I3 = imfilter(I, H);
edges = edge(I, 'canny');              % 边缘检测
bw = imbinarize(I);                    % 二值化
bw2 = imopen(bw, strel('disk', 3));    % 形态学开运算（去噪点）
regionprops(bw2, 'Area', 'Centroid')   % 连通域特征
```

图像即矩阵（[第 1 篇](01-matlab-model.md)）：imread 进来是 uint8 数组，im2double 转 double 参与运算——工具箱的函数全部「矩阵进出」，与你自己的矩阵代码无缝混合。

## 6. Control System Toolbox

```matlab
G = tf([1], [1 2 5])                   % 传递函数 1/(s²+2s+5)
step(G); bode(G); margin(G)            % 时域响应/频域/裕度（一行一张控制理论图）
poles = pole(G); isstable(G)           % 极点与稳定性判据

K = pidtune(G, 'PID')                  % 自动整定 PID
T = feedback(G*K, 1); step(T)          % 闭环仿真

ss(A, B, C, D)                         % 状态空间模型；lsim 任意输入仿真
```

控制系统工具箱的图（step/bode/nyquist）与控制理论课的语言一一对应——**模型对象（tf/ss/zpk）+ 分析函数**的设计让「设计控制器 → 仿真验证」成为脚本闭环。Simulink 的定位则是**图形化的动力学系统建模**：框图连线即模型（积分器、增益、饱和），适合多域物理系统与嵌入式代码生成——「写微分方程」用脚本，「搭系统框图」用 Simulink，两者共享求解器与数据。

## 7. 其他值得一书的工具箱

| 工具箱              | 一句话定位                       | 杀手级函数/App              |
| ------------------- | -------------------------------- | --------------------------- |
| Curve Fitting       | 拟合 App + fit 函数               | `fit(x, y, 'gauss2')`       |
| Deep Learning       | 训练/部署神经网络                 | trainNetwork→trainnet；onnx 导入导出 |
| Parallel Computing  | parfor/gpuArray/集群              | `parfor`（一行并行化）        |
| Symbolic Math       | 符号推导（微积分/化简/解方程）     | `syms; solve; diff`         |
| Financial/Robotics… | 各领域模型                       | ——                          |

`parfor` 值得点名：把 for 换成 parfor 即可并行（数据划分规则有约束，doc parfor 的「sliced/reduction 变量」分类必读）——与[第 9 篇](09-vectorization.md)的「先向量化后并行」顺序配合。

## 8. 用工具箱还是自己写

| 用工具箱 ✅                       | 自己写/用开源 ✅                    |
| --------------------------------- | ----------------------------------- |
| 需要数值稳健的标准算法（分解/检验） | 工具箱没有的模型与实验流程           |
| 想要 App 交互探索 + 可复用代码导出   | 需要透明审计的算法（论文可复现性）   |
| 团队都有 license                   | 授权成本不可接受（工具箱按产品计价） |
| 生产一致性（验证过的实现）          | 教学/理解内部（黑盒不利学习）        |

授权现实：MATLAB 核心与各工具箱**分产品计价**——个人版/学术版/商用版价格差异巨大；代码里用了工具箱函数，协作者也需要同款授权（`license('test')` 在 CI 里预检）。开源替代（Python/SciPy/Julia）的函数覆盖度逐年逼近——工具箱的持续优势在**集成体验与领域 App**，而非单个函数的存在性。

## 9. 陷阱清单

- 代码依赖未授权的工具箱：协作者/CI 跑不起来；`license('test')` 预检 + 文档标注依赖。
- 把 App 的交互结果当「可复现」：App 生成的代码要导出并入库；交互产物要固化为脚本。
- fminsearch 用于大规模/有约束问题：Nelder-Mead 是低维无约束工具；规模与约束上 fmincon。
- filter 与 filtfilt 混用：前者有相位延迟（因果滤波），后者零相位（需离线数据）。
- fft 不去泄漏（不加窗）直接解读谱：幅值与频率失真；pspectrum 或手动加窗。
- 用 Deep Learning 工具箱时忘了 GPU 与 batch 的内存约束：显存爆炸；chunk 与 gpuArray 分配核对。
- 滥用 syms 混入数值管线：符号计算极慢且类型不同；符号层推公式、数值层做计算，边界清晰。

## 10. 小结

- 工具箱 = 函数 + App + 示例；`ver/license('test')` 管授权现实——代码依赖就是授权依赖。
- 统计线：fitdist/ttest/fitlm/fitcsvm/pca 配 table 组成数据科学闭环（理论在概率篇）。
- 优化线：按「约束/平滑/最小二乘形态」三问选 fminsearch/fmincon/lsqnonlin；匿名函数做模型参数化。
- 信号线：fft 模板、filtfilt 零相位、pspectrum 封装正确流程；图像线：矩阵即图像。
- 控制线：tf/ss 模型对象 + step/bode/pidtune 的脚本闭环；Simulink 管图形化建模与代码生成。
- 选型的元问题：数值稳健性与集成体验 vs 授权成本与透明性——按项目性质定，不按「炫技」定。

## 11. 练习

**1.** 用 fitdist 拟合 randn(1000,1) 的正态分布，输出 mu/sigma 与拟合优度；再用同一函数拟合指数分布数据对比 AIC——体会「分布拟合 + 模型选择」的完整流程。

> [!TIP]
> 思路`fitdist(x, 'Normal')` 与 `fitdist(x, 'Exponential')` 的 AIC/BIC 属性直接可比。理论背景（MLE 与似然比）在[概率论篇](../prob/05-estimation.md)——工具箱把「算」封装了，判断仍是你的。

**2.** 写一个「非线性拟合」完整脚本：含参数的阻尼振荡模型 y = A·exp(−kt)·sin(ωt+φ)，用 lsqnonlin 从随机初值拟合，报告参数、残差图与置信区间（nlparci）。

> [!TIP]
> 思路匿名函数 `@(p) model(p, t) - ydata` 是标准形态；初值敏感性实验（多组随机初值看是否收敛到同一解）是非线性拟合的必做功课。

**3.** 信号链实验：50Hz 正弦 + 噪声，分别用手写 fft 谱与 pspectrum 对比；设计一个 FIR 低通（fir1）并用 filter 与 filtfilt 各滤波一次，画出三者的叠加——直观看到相位延迟 vs 零相位。

> [!TIP]
> 思路filter 版的波形相对输入「整体右移」（群延迟），filtfilt 版对齐——「因果性换相移」的物理意义在图上一目了然。

**4.** 控制实验：建立二阶系统 tf(1,[1 1 1])，画 step/bode，用 pidtune 整定 PID 后画闭环阶跃响应对比开环——把「稳态误差、超调、裕度」从图上读出来。

> [!TIP]
> 思路`margin(G)` 直接给出幅值/相位裕度；pidtune 返回满足指定相角裕度的控制器。控制理论的「设计-验证闭环」在 10 行 MATLAB 里完整呈现。

**5.** 给一个双重循环的图像处理任务（逐像素阈值+邻域统计）做性能实验：纯循环 → 逻辑索引向量化 → 工具箱函数（imbinarize/ordfilt2）三条路线的耗时对比。

> [!TIP]
> 思路预期：循环最慢（且大图内存复制敏感）、向量化数倍提升、工具箱函数最快（C 实现 + 边界处理正确）。形态识别（这任务 = 形态学）比手写优化更根本——工具箱的「知识红利」。

**6.** 讨论：团队的项目依赖了 Statistics 与 Signal 两个工具箱，license 成本成为问题。给出三个方向的完整评估：优化工具箱使用（只留必需）、迁移热点到 Python/SciPy、混合部署（MATLAB 原型 + 生成代码交付），各自的迁移成本与风险。

> [!TIP]
> 思路评估维度：功能覆盖（SciPy 的统计/信号覆盖度高）、验证成本（已验证代码的迁移测试）、维护分裂（双语言栈）。常见结论：授权优化先行、迁移按模块渐进、MATLAB Coder 生成代码用于「算法交付但不带环境」的场景。
