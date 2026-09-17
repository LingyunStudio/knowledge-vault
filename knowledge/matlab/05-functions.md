---
title: 函数
order: 5
tags: 核心, 函数文件, 匿名函数
summary: 函数文件的命名规则、匿名函数与函数句柄、varargin/varargout。
---

MATLAB 的函数必须住在与函数同名的 .m 文件里，这是它最"死板"也最少歧义的规则。函数文件、匿名函数、函数句柄三层机制，撑起了"把运算当参数传递"的现代写法。

## 函数文件与命名规则

函数文件第一行是函数声明，文件保存时名字必须与主函数一致：

```matlab
% myStat.m —— 文件名必须叫 myStat.m
function [m, s] = myStat(x)
%MYSTAT 均值与标准差
%   [M, S] = MYSTAT(X) 返回向量 X 的均值和样本标准差

    m = mean(x);
    s = std(x);
end
```

三条规则要刻在脑子里：

1. **MATLAB 按文件名调用函数**：函数名只是声明，查找靠文件名。文件名对不上，调用的就是文件名那个"名字"
2. 一个文件可以有多个函数：第一个是**主函数**（对外可见），其余是**局部函数**（仅限本文件内部使用）
3. `end` 可写可不写，但用**嵌套函数**时必须写——建议全部写 end，一劳永逸

> [!WARNING]
> 文件名与函数名不一致时，外部只能用文件名调用（新版还会给出警告）。比如文件存成 mystat.m 而里面写的是 `function myMean(x)`，命令行只能敲 `mystat`。保存时用 Ctrl+S 让编辑器按函数名自动命名，从源头杜绝。

## 输入输出参数

`nargin`/`nargout` 记录"实际传入几个、调用方要几个返回值"，是可选参数和惰性计算的基石：

```matlab
function [out, idx] = peak(x, tol)
    if nargin < 2                % 只传了一个参数
        tol = 1e-6;              % 手动给默认值
    end
    [out, idx] = max(abs(x));
    if nargout == 2              % 调用方要第二个输出才算
        idx = find(abs(x) == out, 1);
    end
end
```

调用侧的自由度：

```matlab
p = peak(x);         % 只收第一个输出
[p, i] = peak(x);    % 两个都要
[~, i] = peak(x);    % ~ 明确跳过第一个输出
```

R2019b+ 的 `arguments` 块把参数校验做成声明式，替代 nargin 防御式写法：

```matlab
function y = myinterp(x, v, xq)
    arguments
        x (1, :) double          % 必须是 1×N 的 double
        v (:, :) double
        xq double                % 类型与尺寸不符时自动报错
    end
    y = interp1(x, v, xq);
end
```

> [!TIP]
> arguments 块除了校验还能写默认值（`x (1,:) double = 1:10`），错误信息自动生成。新函数都用它，参数问题在入口处爆炸，而不是在函数深处。

## 匿名函数与函数句柄

`@` 把函数变成"值"，可以存变量、传参数、进数组：

```matlab
f = @(x) x.^2 + 1;        % 匿名函数：单表达式，返回句柄
f(3)                      % 10
g = @sin;                 % 具名函数也能取句柄
integral(g, 0, pi)        % 句柄当参数传给求解器
fzero(@(t) t^2 - 2, 1)    % 临时函数不值得建文件，就地匿名
```

句柄是 MATLAB 函数式一面的支点：`integral`、`fzero`、`arrayfun`、排序比较器，全都吃句柄。

> [!WARNING]
> 匿名函数在**创建那一刻**就把用到的变量拍成了快照，之后原变量怎么变都与它无关：
>
> ```matlab
> a = 2;
> h = @(x) a * x;
> a = 100;
> h(3)       % 结果是 6，不是 300
> ```
>
> 循环里批量生成匿名函数几乎必踩此坑。需要"活的引用"时改用嵌套函数，或把参数显式传进去。

## varargin 与 varargout

可变参数用 cell 数组打包：`varargin` 装多余输入，`varargout` 装多余输出：

```matlab
function out = addup(first, varargin)   % varargin 是 cell
    out = first;
    for k = 1:numel(varargin)
        out = out + varargin{k};        % 花括号取内容
    end
end
% addup(1, 2, 3, 4) → 10

function myPlot(x, y, varargin)         % 经典用法：透传绘图选项
    plot(x, y, varargin{:});            % {:} 解包后原样转发
end
```

`varargout` 与 `nargout` 配合，让输出个数由调用方决定：

```matlab
function varargout = bounds(x)
    varargout{1} = min(x);
    if nargout >= 2
        varargout{2} = max(x);
    end
end
% lo = bounds(x) 或 [lo, hi] = bounds(x) 都成立
```

可变参数是好东西，但别滥用：参数超过四五个、顺序靠记的接口，改用 `arguments` 块加名称-值对（`'LineWidth', 2`），可读性完全不同。

相关阅读：[控制流与脚本](04-control-flow.md)、[数据导入导出](07-data-io.md)
