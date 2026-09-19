---
title: 函数与作用域：代码的组织单元
order: 5
tags: 函数文件, varargin, 匿名函数, 函数句柄, addpath
summary: 函数文件的完整形态（多返回值、帮助文本、nargin/nargout）、arguments 参数校验块、varargin 的变长参数、匿名函数与函数句柄（闭包捕获值）、嵌套函数与子函数的取舍、path 管理与函数名冲突。
---

MATLAB 的代码组织只有一种文件（.m）与两种形态（脚本/函数）。函数是唯一提供**独立工作区**的单元——它的边界感（参数进、结果出、内部状态不外泄）是 MATLAB 程序从「实验脚本」走向「可靠工程」的关键。

## 1. 函数文件的完整形态

```matlab
function [mu, sigma] = stats(x, dim)
% STATS  计算均值与标准差
%   [mu, sigma] = STATS(x) 沿第一维计算
%   [mu, sigma] = STATS(x, dim) 沿指定维度
%   输入：x - 数值矩阵；dim - 维度（默认 1）

    if nargin < 2, dim = 1; end        % nargin：实际传入的参数个数

    mu = mean(x, dim);
    sigma = std(x, 0, dim);
end
```

铁律与惯例：

- **文件名 = 主函数名**（stats.m）——MATLAB 按文件名查找，不一致则「函数未定义」。
- 紧跟定义行的注释是 `help stats` 的内容——**函数文档写在这里**而不是单独文件。
- 多返回值：`[a, b] = f(x)` 按 order 接收，只要第一个就 `a = f(x)`；`nargout` 知道调用方要了几个（可按需跳过昂贵计算）。
- 一个文件可以含多个函数：**第一个是主函数（对外可见），其余是局部函数**（只在本文件内可用——文件的「私有工具箱」）。

## 2. 参数的完整方案

### 2.1 arguments 校验块（R2019b+，现代首选）

```matlab
function out = resample(x, fs, newFs, opts)
    arguments
        x (:, :) double                          % 形状/类型约束
        fs (1, 1) double {mustBePositive}        % 必须是 1×1 正数
        newFs (1, 1) double {mustBePositive} = 16000   % 带默认值
        opts.verbose (1, 1) logical = false      % 名称-值参数
        opts.window = @hann                      % 任意类型 + 校验函数
    end
    ...
end

resample(x, 44100)                    % newFs/opts 走默认
resample(x, 44100, 16000, verbose=true)   % 名称-值调用
```

`arguments` 块声明式地完成「类型检查、形状检查、默认值、名称-值参数」——把散落 if 的手工校验收进签名。旧代码的世界是 `nargin` + `inputParser`（更繁琐但兼容老版本）。

### 2.2 varargin：变长参数

```matlab
function plot_all(styles, varargin)         % varargin 是元胞：装下所有额外参数
    for k = 1:length(varargin)
        fprintf('额外参数 %d: %s\n', k, varargin{k});
    end
end
% varargout 对称地收集多返回值
```

## 3. 匿名函数与函数句柄

### 3.1 函数句柄：函数的「引用值」

```matlab
f = @sin;                 % 句柄：函数作为值
f(pi/2)                   % 1
g = @myfun;               % 普通函数句柄
h = @(x) x.^2 + 1;        ★ 匿名函数：一行定义

h(3)                      % 10
quad(f, 0, pi)            % 句柄传给其他函数（积分/优化器都是这个接口形态）
cellfun(@(c) numel(c), C) % 逐元素应用
```

函数句柄是 MATLAB 的「高阶函数」通道：优化器、积分器、排序比较器全部以句柄为参数——与[C 篇函数指针](../c/09-function-pointers.md)、[Python 篇一等函数](../python/04-functions.md)同一思想。

### 3.2 匿名函数是闭包：捕获「定义时」的值

```matlab
a = 2;
f = @(x) a .* x;
a = 100;
f(3)                      % 6 —— 捕获的是定义时刻的 a=2，不是当前值！

make_adder = @(k) @(x) x + k;      % 返回函数的函数（柯里化）
add5 = make_adder(5);  add5(3)     % 8
```

匿名函数在定义瞬间**捕获自由变量的值**（不是引用）——与 Python 闭包的「惰性绑定」（[python 篇](../python/04-functions.md)循环陷阱）方向相反。这既让匿名函数可预测（无幽灵状态），也意味着「想让句柄用新值必须重新创建」。

## 4. 作用域：嵌套函数与共享状态

```matlab
function main()
    counter = 0;
    function bump()          % 嵌套函数：与外层共享工作区（真正的闭包引用！）
        counter = counter + 1;
    end
    bump(); bump();
    disp(counter)            % 2 —— 嵌套函数改的是 main 的 counter 本体
end
```

| 形态             | 作用域       | 适用                       |
| ---------------- | ------------ | -------------------------- |
| 局部函数（文件内） | 独立工作区   | 文件私有工具                |
| 匿名函数          | 捕获值       | 一行逻辑、传参              |
| 嵌套函数          | **共享变量** | 需要少量共享状态的紧凑场景   |

嵌套函数是 MATLAB 唯一的「可变共享状态」通道——用它是便利，滥用它就是隐式全局（[python 篇](../python/07-classes.md)的全局状态三问同样适用：重入、测试、并发）。

脚本自 R2016b 起也能在**文件末尾**定义局部函数——小实验不再必须为辅助函数单开文件。

## 5. path：函数如何被找到

```bash
which mean            % 它解析到哪个文件（内建 vs 工具箱 vs 你的同名文件！）
addpath('lib/')       % 加搜索路径（会话级）；savepath 持久化
pathtool              % 图形管理
```

函数查找按 **path 顺序**——你的 `mean.m` 若排在前面会**遮蔽内建函数**（遮蔽的英文 shadowing 与[python 篇](../python/08-modules-packages.md)同名问题同源）。`which mean -all` 排查「这个函数到底是谁」；自定义函数永远不要与工具箱/内建重名（mean/max/filter 是重灾区）。工程组织的标准做法：项目根 + `startup.m` 里 addpath 子目录，或改用 package（`+pkg/` 目录，`pkg.func()` 调用——真正的命名空间）。

## 6. 陷阱清单

- 文件名与函数名不一致：函数「找不到」；重命名要连文件一起。
- 匿名函数捕获的是值不是引用：期待「变量更新后句柄跟着变」是错的；需要引用语义用嵌套函数。
- 变量名遮蔽函数名（x = max 后 max(...)）：把函数名当变量名用是静默事故源；`clear max` 或重命名。
- varargin 的元胞忘花括号：`varargin{k}` 取内容、`(k)` 取元胞。
- arguments 块版本依赖：老版本 MATLAB 报语法错；团队版本对齐或用 inputParser。
- addpath 不 savepath：重启 MATLAB 路径消失；或用 startup.m 自动化。
- 多返回值顺序记错：`[a,b] = f(x)` 的次序是接口契约——help 文档里写明并保持稳定。

## 7. 小结

- 函数文件三件套：文件名=函数名、首行注释即 help 文档、局部函数做文件内私有工具。
- 参数体系现代形态：arguments 块（类型/形状/默认/名称-值声明式校验）+ nargin 兜底；varargin/varargout 管变长。
- 函数句柄是高阶函数的通道；匿名函数是「定义时捕获值」的闭包——与 Python 的惰性绑定方向相反。
- 嵌套函数提供共享变量（唯一可变闭包），用前过「重入/测试/并发」三问。
- path 顺序决定函数解析：which -all 排查遮蔽、不与内建重名、+package 是真命名空间。

## 8. 练习

**1.** 写一个 `fitline(x, y)` 函数返回 `[p, res]`（最小二乘系数与残差范数），带完整 help 文档与 arguments 校验（x、y 同长度且有限）。用 help 查看自己的文档验证。

> [!TIP]
> 思路`arguments x(:) double; y(:) double; end` + `mustBeSameSize` 风格校验（或 assert(numel(x)==numel(y))）。polyfit 一行可解（p = polyfit(x,y,1)），练习的重点是接口工程而非算法。

**2.** 验证匿名函数的「值捕获」：定义 f=@(x)a*x 后改 a，调用 f；再写一个嵌套函数版本让改 a 真的生效。总结「要引用语义怎么办」。

> [!TIP]
> 思路匿名版输出不变（捕获定义时 a）；嵌套函数版共享工作区会变。引用语义的第三条路：把「可变状态」装进 handle 类对象（对象句柄传递引用——面向对象篇的预览）。

**3.** 用函数句柄重写[第 4 篇](04-control-flow.md)练习 2 的牛顿法：把「函数与导数」作为参数传入 `newton(@(x)x^2-2, @(x)2*x, x0)`——体验「算法与目标函数解耦」的高阶函数设计。

> [!TIP]
> 思路签名 `function x = newton(f, df, x0, tol)`——同一个 newton 能解任何方程。fzero/fsolve 的接口就是这种形态的工业级版本，读它们的 doc 会发现参数设计惊人地一致。

**4.** 故意制造函数遮蔽：在自己的目录写一个 mean.m，观察 `which mean -all` 的输出与调用结果，然后删除并总结「命名冲突排查」的步骤。

> [!TIP]
> 思路症状常是「内置函数行为诡异」——第一反应永远是 `which fname -all` 看解析顺序。预防：项目目录命名避开内建/工具箱名；startup 里不随意 addpath 全家桶。

**5.** 把一个 300 行脚本重构为「主函数 + 3 个局部函数」：数据加载、核心计算、绘图各自独立，参数与返回值显式化。重构前后对比：哪些变量从「全局隐式共享」变成了「接口显式传递」。

> [!TIP]
> 思路重构的检验标准：每个函数不看其他函数也能读懂（签名自解释）。脚本变量逐步变成接口的过程，就是 MATLAB 代码从「实验记录」到「可测试程序」的迁移路径。

**6.** 讨论：MATLAB 的 `+package/` 命名空间与 Python 的模块系统差异（导入语义、路径查找、遮蔽风险），为什么 MATLAB 项目普遍仍用「addpath 平铺」而 Python 社区强制包管理？从生态与工具链角度分析。

> [!TIP]
> 思路addpath 平铺 = 所有函数在一个全局命名空间（重名即遮蔽）；+package 语义更接近 Python 但生态惯性（工具箱文档、教学惯例）压过了它。生态工具链的默认形态决定社区实践——语言特性只有在工具链支持时才普及。
