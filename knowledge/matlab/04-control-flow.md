---
title: 控制流与脚本
order: 4
tags: 基础, if, for
summary: if/for/while/switch、脚本与实时脚本、向量化思维初体验。
---

MATLAB 的控制流关键字与 C 家族几乎同名，但细节处处不同：条件是"全非零才算真"、for 天生按列迭代、switch 不穿透。MATLAB 的效率哲学也在这里初现——能向量化就别写循环。

## if 与 switch

if 条件为真当且仅当"非空且全为非零元素"。对数组条件它不报错，而是静默按 `all` 处理——这既是特性也是坑：

```matlab
x = [1 2 0];
% if x                  % 不报错！等价于 all(x) ~= 0，这里为假
if all(x > 0)           % ✅ 意图写明，读代码的人不用猜
    disp('全为正');
end
```

> [!WARNING]
> `if x` 当 x 是数组时不报错、按"全非零"求值，与很多人以为的"报错"或"取第一个元素"都不一样。数组条件永远显式写 `all(...)` 或 `any(...)`，把意图钉死。

多分支用 `elseif` 连写；互斥的枚举分支用 switch 更清爽：

```matlab
switch lower(method)
    case 'fast'                    % 标量、字符串都能比
        n = 1;
    case {'accurate', 'precise'}   % 一个 case 多个候选值
        n = 10;
    otherwise                      % 相当于 default
        n = 50;
end
```

> [!NOTE]
> MATLAB 的 switch 不像 C 那样穿透（fall-through），命中一个 case 即结束，不需要 break。case 只做相等匹配，范围条件请回到 if。

可能失败的收尾操作用 try/catch 兜住，别让一个文件不存在炸掉整批任务：

```matlab
try
    M = readmatrix(inputFile);
catch ME
    fprintf('读取失败：%s\n', ME.message);
    M = [];
end
```

## for 与 while

for 遍历一个"表达式"的每一列，最常见的就是冒号区间：

```matlab
total = 0;
for k = 1:3                % 遍历 [1 2 3]
    total = total + k;
end

for k = 1:0.5:2            % 步长可以是小数
    disp(k);
end

M = [1 2; 3 4];
for col = M                % M 有两列 → 循环两轮，col 是 2×1 列向量
    disp(sum(col));        % 想逐元素遍历请先 reshape 成向量
end
```

while 适合循环次数未知的迭代，`break` 跳出、`continue` 跳过本轮、`return` 直接退出当前脚本/函数：

```matlab
x = 1;  a = 2;
while abs(x^2 - a) > 1e-10      % 牛顿迭代开平方
    x = (x + a/x) / 2;
end
```

> [!WARNING]
> 循环变量就是普通变量：循环结束后 `k` 留在工作区，接着运行的代码容易踩到旧值；循环体内给 `k` 赋值则会被下一次迭代覆盖。别把循环变量当临时存储用。

## 脚本与实时脚本

脚本（.m）是顺序语句的集合，跑在基础工作区；从 R2016b 起脚本末尾可以带**局部函数**，把小工具函数直接写在脚本里：

```matlab
%% 主流程
data = rand(100, 1);
mu = myMean(data)

%% 局部函数：必须放在文件末尾
function m = myMean(x)
    m = sum(x) / numel(x);
end
```

实时脚本（.mlx）是"可执行文档"：文字、公式、代码、运行结果同屏排版，适合做笔记、教学和带图报告，可一键导出 PDF/HTML。分工很清晰：探索和正式分析用 .m，要交付给人看的用 .mlx；逻辑要被多个脚本复用时，抽成函数文件（见[函数](05-functions.md)）。

给脚本起名遵循函数文件的老规矩：字母开头、只含字母数字下划线、不与已有函数撞名——脚本名会遮蔽同名函数，`plot.m` 这种名字一存，整个绘图功能就废了。

> [!TIP]
> 长脚本用 `%%` 分节调试（Ctrl+Enter 跑当前节），配合编辑器右侧的代码折叠，比整篇重跑快得多。变量都留在基础工作区，出问题先看工作区里有什么。

## 向量化思维初体验

同一个计算，循环与向量化两种写法：

```matlab
%% ❌ 循环逐点算
n = 1000000;
s = 0;
for k = 1:n
    s = s + sin(0.001 * k)^2;
end

%% ✅ 向量化：读起来就是数学公式
k = 1:n;
s = sum(sin(0.001 * k).^2);
```

两种写法结果一致，但向量化版本把"对每个元素求平方再求和"直接写成了集合运算——更短、更贴公式、更快（原因与代价见[稀疏与性能](09-performance.md)）。从今天起养成条件反射：写循环之前先问一句"这件事能不能对整个数组一步算完"。多数纯计算场景答案是能，剩下的场景预分配后再循环也不迟。

相关阅读：[函数](05-functions.md)、[稀疏与性能](09-performance.md)
