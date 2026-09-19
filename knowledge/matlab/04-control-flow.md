---
title: 控制流与逻辑：条件必须是标量
order: 4
tags: if, switch, for, while, try catch
summary: if 条件必须为标量的规则与 any/all 折叠、switch 的精确匹配语义（无穿透）、for 遍历矩阵即遍历列、while 与 break/continue、try/catch 的资源保护，以及「循环还是向量化」的初判。
---

MATLAB 的控制流关键字与 C/Python 同名，但有一条**自己的铁律**：`if`/`while` 的条件必须是**标量逻辑值**——矩阵条件不合法（多数版本直接报错）。这条铁律把「数组思维」与「分支思维」强行分开，是 MATLAB 代码风格的最大分水岭。

## 1. if：条件折叠是显式的

```matlab
x = [1 2 3];

% if x > 0          % ❌ 报错（旧版本「全真才真」的隐式语义已废除）：
%    ...            %    条件是数组 —— MATLAB 拒绝替你解释意图

if all(x > 0)        % 显式折叠：全部为正？
    disp('all positive')
end

if any(isnan(v))     % 存在 NaN？
    disp('contains NaN')
end
```

「数组真假」必须自己定义语义：`all`（全称）、`any`（存在）、还是统计个数 `sum(x>0) > 3`。这个「多写一个词」的不便是**故意的**——它强迫作者声明「数量条件的含义」，避免 C 风格的真值歧义（[python 篇](../python/03-control-flow.md)的假值表问题在这里从语言层面被禁止）。

```matlab
if x > 0
    ...
elseif x == 0
    ...
else
    ...
end
```

## 2. switch：精确匹配，无穿透

```matlab
switch method
    case 'fft'
        y = fft(x);
    case {'wavelet', 'dwt'}          % 多值共享一分支（cell 列表）
        y = dwt(x);
    otherwise
        error('Unknown method: %s', method);
end
```

与 C 的两点差异：**case 不穿透**（匹配一个分支后退出，无需 break）；匹配是**相等比较**（字符串/标量），不支持范围——范围判断老实用 if/elseif。`otherwise` 兜底与 C 篇 switch 的 default 同纪律：**必写**，新枚举值进来时有据可查。

## 3. for：遍历的是「数组」

```matlab
for k = 1:10                 % 遍历 1:10 这个行向量的元素
    ...
end

for c = A                    % ★ A 是矩阵时：k 每轮取**一列**！
    process(c)               %   （列优先模型的循环投影）
end

for s = {'alice', 'bob'}     % 遍历元胞
    disp(s{1})
end

for k = 10:-1:1              % 逆序；步长任意
    ...
end
```

`for c = A` 遍历列是「矩阵按列优先展开」的自然结果——「逐列处理」在 MATLAB 里是一等公民（图像按帧、信号按通道，常以列存储）。循环内修改循环变量不影响遍历（遍历开始时数组已定）——与 Python 相同的语义。

## 4. while 与循环控制

```matlab
n = 1;
while abs(x - sqrt(n)) > 1e-10        % 条件同样是标量（一个数）
    n = n + 1;
end

for k = 1:1e6
    if converged, break; end          % 提前退出
    if k % 2 == 0, continue; end      % 跳过本轮
end
```

数值迭代的收敛判断用**容差**（`> 1e-10`）而非 `==`——浮点等号判等在收敛循环里永不满足（[第 3 篇](03-operators.md)的浮点纪律）。

## 5. try/catch：错误兜底与资源保护

```matlab
fid = fopen(path);
try
    data = process(fid);
catch ME                        % ME：MException 对象（.message/.identifier/.stack）
    fprintf(2, '处理失败: %s\n', ME.message);
    rethrow(ME);                % 或抛新的 error('MyApp:parse', '...') —— 链式见 doc
finally                         % R2014b+：无论如何执行
    fclose(fid);                % 清理（对应 Python 的 finally/with）
end
```

错误抛出用 `error('ID:消息', ...)`（标识符供程序化判断，`MException` 捕获后按 identifier 分支）。MATLAB 的错误处理比 Python 粗糙（无异常层次树），工程惯例是**标识符前缀**（`MyApp:badInput`）做命名空间。

## 6. 循环还是向量化：初判

MATLAB 解释器对循环的开销大（每轮解释执行），而内置矩阵运算走底层 BLAS——所以传统 MATLAB 的性能教条是「能向量化就别写循环」。但 R2015b 起 JIT 显著改善，当代判断：

| 场景                           | 建议                          |
| ------------------------------ | ----------------------------- |
| 数学运算映射到数组（逐元素/矩阵） | 向量化（一行算完）             |
| 每步依赖上一步（迭代法、递推）    | 循环（向量化无解）             |
| 稀疏控制流（每元素不同分支）      | 循环或 logical 索引分区        |
| 大数据 + 简单循环体              | 向量化收益最大（逻辑索引+矩阵运算）|

系统的方法在[第 9 篇](09-vectorization.md)；本节的判断标准一句话：**依赖链向左（前步影响后步）→ 循环；数据并行 → 向量化**。

## 7. 陷阱清单

- 矩阵当 if 条件：报错或（古版本）隐式全真语义；any/all 显式折叠。
- switch 期待范围匹配：它只做相等；范围用 if。
- `for c = A` 以为遍历元素：遍历**列**；逐元素用线性遍历或 `A(:)`。
- 循环里对数组动态增长（end+1）：预分配（zeros/NaN），size 先定。
- 收敛条件写 `==`：永不停止或过早停止；用容差 + 最大迭代数双保险。
- 遗漏 otherwise/else：新输入静默走进空分支；兜底分支里 error 报「不支持的输入」。
- catch 后吞掉异常（空 catch）：至少 fprintf(2,...) 或 rethrow——与[python 篇](../python/09-errors-exceptions.md)的异常纪律同源。

## 8. 小结

- if/while 条件必须是标量：数组条件的语义（all/any/计数）由作者显式声明——语言强制「数量条件要说清楚」。
- switch 精确匹配不穿透，otherwise 必写；for 遍历「数组的元素」——矩阵即列、元胞即内容、负步长自然。
- try/catch/finally 是资源保护的形态；错误用标识符（App:类别）抛出，catch 按 identifier 分派。
- 循环 vs 向量化的初判：依赖链决定——递推写循环、数据并行写向量化。
- 控制流的铁律背后是 MATLAB 的价值取向：把「对数组说话」留在矩阵运算与逻辑索引里，把「分支决策」留给标量。

## 9. 练习

**1.** 分别用循环与逻辑索引实现「把向量中所有负数替换为其绝对值」，验证一致；再思考「分段为三段」时哪种写法扩展性更好。

> [!TIP]
> 思路`v(v<0) = -v(v<0)` 一行 vs 五行循环。三段式（<0、=0、>0）时逻辑索引仍是三次掩码赋值——分区赋值模板的扩展性与性能都占优。

**2.** 写一个 while 循环用牛顿法求 √2（x_{n+1} = (x_n + 2/x_n)/2），收敛条件用容差 + 最大迭代数，打印每步误差观察二阶收敛。

> [!TIP]
> 思路`while abs(x^2-2) > 1e-14 && k < 50`——双条件（容差 + 上限）防死循环是数值迭代的标配纪律。误差每步约平方：观察 `loglog` 图上的直线。

**3.** 用 `for c = A` 遍历一个 3×5 矩阵的每一列计算列均值，再与 `mean(A)`（dim 语义）对比，确认「遍历列 = 沿第 1 维压缩」。

> [!TIP]
> 思路`for c=A; m(k)=mean(c); end` 得到 1×5 行向量 = `mean(A)`（默认 dim=1 沿行向压成列均值）。列优先模型的「循环投影」与「dim 参数」是同一件事的两种表述。

**4.** 实现一个「安全读取」函数：try 读文件，失败时按错误类型区分（文件不存在 → 返回默认值；格式错误 → 抛带上下文的新错误），finally 关闭句柄。

> [!TIP]
> 思路catch 里用 `strcmp(ME.identifier, 'MATLAB:load:couldNotReadFile')` 类判断分支——MATLAB 无异常树，标识符即类型。清理逻辑必须放 finally 而不是 catch（成功路径也要关）。

**5.** 把下面「循环里动态增长」的代码改写为预分配 + 计数填充，再用 timeit 对比 n=10⁶ 时的耗时。

```matlab
result = [];
for k = 1:1e6
    result(end+1) = k^2;
end
```

> [!TIP]
> 思路`result = zeros(1,1e6); for k=1:1e6, result(k)=k^2; end`——甚至直接 `result = (1:1e6).^2;`（完全向量化）。动态增长的 O(n²) 拷贝在百万级是分钟级与毫秒级的差距。

**6.** 讨论：为什么 MATLAB 强制「条件为标量」而 C 的 if(数组首元素)/Python 的 if(非空列表) 都能跑？从「数值计算的歧义成本」角度分析 all/any 显式化对科学代码可读性的价值。

> [!TIP]
> 思路「数组为真」有至少四种合理解释（全真/任一真/首元素/非空）——科学代码的语义歧义会变成静默的数值错误。语言强制歧义显式化，与它「公式直译」的设计目标是同一件事的两面。
