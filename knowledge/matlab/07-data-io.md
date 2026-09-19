---
title: 数据导入导出：从文件到工作区
order: 7
tags: save, load, readtable, mat, datastore, json
summary: .mat 文件的格式选择（含 -v7.3/HDF5 与 matfile 局部读写）、table 的现代数据流（readtable/分组汇总/连接）、文本与 Excel 的导入选项、jsonencode 的互操作，以及 datastore 处理超大数据的流式方案。
---

MATLAB 的数据进出有两条主线：**.mat 文件**（自己的格式，全保真）与**通用格式**（CSV/Excel/JSON/HDF5，跨工具交换）。现代 API（readtable/readmatrix）已经取代了老一代（xlsread/csvread/load 猜格式）——本篇按现代 API 讲，标注旧名以防读老代码。

## 1. .mat：MATLAB 的原生格式

```matlab
save result.mat x y data            % 保存指定变量
save result.mat                     % 保存整个工作区
save result.mat -v7.3               % ★ 7.3 格式 = HDF5 底座：>2GB 变量必需
load('result.mat')                  % 全部载入
S = load('result.mat', 'x', 'y')    % 选择性载入（进结构体，不污染工作区）

save('result.mat', 'x', '-append')  % 追加/更新变量
m = matfile('big.mat');             % ★ 局部读写：不载入整个文件
m.bigArray(1:1000, :) = m.bigArray(1001:2000, :);   % 只动需要的一段
```

| 格式       | 特性                                       | 何时用                    |
| ---------- | ------------------------------------------ | ------------------------- |
| `-v7`（默认）| 压缩、≤2GB                                 | 日常                       |
| `-v7.3`    | HDF5 底座、可超 2GB、matfile 局部读写        | 大数组、需要与其他语言互读 HDF5 |
| `-ascii`   | 纯文本矩阵（无名字无结构）                   | 与古老工具交换（丢失一切元数据）|

`.mat` 的价值是**全保真**（类型/尺寸/元数据）与免解析；跨工具交换不要用它（外部人打不开）——交换走 CSV/JSON/HDF5。

## 2. table：现代表格数据流

```matlab
T = readtable('measurements.csv')      % ★ 自动探测分隔符/表头/类型
T.Properties.VariableNames             % 列名（自动清洗成合法变量名）
T = readtable('x.xlsx', 'VariableNamingRule', 'preserve')   % 保留原始列名（含中文）

T.Temp(1:5)                            % 按列名取列（点语法）
T(3:8, {'Time', 'Temp'})               % 行切片 + 列选择
T(T.Temp > 100, :)                     % ★ 逻辑索引过滤（行筛选）
T.SensorID == "A2"

% 汇总：分组统计
G = groupsummary(T, 'SensorID', 'mean', 'Temp')     % 按传感器分组求温度均值
% 连接：
J = innerjoin(T, metadata, 'Keys', 'SensorID')

writetable(T, 'out.csv')               % 写出
writetable(T, 'out.xlsx')              % 直接写 Excel（按扩展名选引擎）
```

table 是 MATLAB 的「DataFrame」（与[pandas 篇](../python/05-data-structures.md)、R data.frame 同思想）：列名语义化、异型列、分组聚合。**表格数据（实验记录、导出报表）用 table，数值矩阵计算用 double**——两层各得其所，`table2array`/`array2table` 转换。

## 3. 文本与矩阵：readmatrix 家族

```matlab
M = readmatrix('data.csv')          % 纯数值矩阵（自动跳表头/文本行）
M = readmatrix('data.txt', 'NumHeaderLines', 3)

opts = detectImportOptions('messy.csv')   % ★ 先探测再定制
opts = setvaropts(opts, 1, 'WhitespaceRule', 'preserve');
opts.DataRange = 'A2:E1000';              % 明确数据区
M = readmatrix('messy.csv', opts);

C = readcell('report.xlsx')          % 元胞级（混有文本与数字的报表）
S = readlines('log.txt')             % 按行的 string 数组

writematrix(M, 'out.csv')            % 写矩阵
writelines(lines, 'out.txt')
```

老代码对照：`csvread/xlsread/dlmread`（已不推荐，xlsread 还要返回第三个参数处理文本）→ 全部迁移到 readmatrix/readcell/readtable。**「先 detectImportOptions 再导入」**是脏数据的正确姿势：探测结果可检查可修改，而不是让自动猜测静默决定列类型。

## 4. JSON 与互操作

```matlab
S = jsonencode(struct('name', 'sensor1', 'values', [1 2 3]))
% '{"name":"sensor1","values":[1,2,3]}'
obj = jsondecode(S)                  % 回结构体（数组→元胞/矩阵的规则注意 doc）

im = imread('photo.png');            % 图像：uint8 矩阵（H×W×3）
im2 = imresize(im, 0.5);
[audio, fs] = audioread('clip.wav'); % 音频：double 矩阵 + 采样率
```

与 Python/其他语言交换的推荐序：**JSON（结构化小数据）→ CSV（表格）→ HDF5（大数值数组，-v7.3 或 h5py 直通）**。MATLAB 的 uint8 图像与 double 运算的转换（`im2double`）是图像处理的常客。

## 5. datastore：超大数据的流式入口

```matlab
ds = datastore('huge_*.csv')          % 文件集合当作一个逻辑表
ds.SelectedVariableNames = {'Time', 'Temp'};   % 只读需要的列
while hasdata(ds)
    chunk = read(ds, 'ReadSize', 10000);        % 分块：内存 O(块大小)
    process(chunk)
end

tall = tall(ds);                      % 延迟计算的「高数组」：自动分块MapReduce
m = mean(tall.Temp)                   % 语法与普通数组一致，gather 时才真正算
```

datastore/tall 是 MATLAB 对「数据大于内存」的答案——与[python 篇](../python/06-iterators-generators.md)生成器流、C++ 篇惰性视图同一思想：**处理逻辑与数据位置的解耦**。

## 6. 陷阱清单

- 大于 2GB 的 .mat 用默认格式：保存报错；`-v7.3`。
- readtable 自动把数字列猜成文本（混入脏值）：用 detectImportOptions 检查 varopts；VariableNamingRule preserve 保中文名。
- xlsread/csvread 的时代包袱：返回值怪、慢、不兼容；一律 readtable/readmatrix。
- save 全工作区当「存档」：把临时变量一起带进文件；显式列变量清单。
- load 不接返回值污染工作区（覆盖同名变量）：`S = load(...)` 收进结构体。
- jsonencode 的数组语义：行向量→JSON 数组、矩阵→数组的数组（读回来形状需核对）。
- datastore 忘记 SelectedVariableNames：全列读取放大 IO；先选列。

## 7. 小结

- .mat 两档：默认 v7（压缩）、v7.3（HDF5、>2GB、matfile 局部读写）；load 用返回值收进结构体防污染。
- table 是现代表格层：readtable 自动化 + 逻辑索引过滤 + groupsummary/innerjoin 聚合连接；矩阵计算与表格数据分层。
- readmatrix/readcell/readlines 取代老 read 家族；脏数据走 detectImportOptions 先探测后定制。
- 互操作排序：JSON（小结构）→ CSV（表格）→ HDF5（大数组）；图像/音频即矩阵（uint8/double 转换常客）。
- datastore + tall 把「大于内存」变成语法不变的问题——分块与延迟计算托管给框架。

## 8. 练习

**1.** 构造一个包含 1×10⁸ double 的数组，分别用默认格式与 -v7.3 保存，对比文件大小、保存时间与 matfile 局部读取的行为。

> [!TIP]
> 思路800MB 数组逼近 2GB 门槛——实验「默认格式报错/变慢」的现场与 v7.3 的从容。matfile 的局部读写配合 while 分块处理是这个格式的核心红利。

**2.** 把一份带脏数据的 CSV（空值、混型列、中文列名）导入 table：先 detectImportOptions 检查猜测，修正列类型后导入，统计每列缺失数，最后 groupsummary 按组求均值。

> [!TIP]
> 思路detectImportOptions 的 varopts 是「脏数据谈判桌」：MissingRule（NaN/fill）、千分位、日期格式。导入后 `ismissing(T)` 的热图（imagesc）定位缺失分布——数据清洗的可视化起点。

**3.** 用 table 完成一次「报表合并」：两份传感器数据表（不同时间段）按 SensorID 内连接，groupsummary 出每传感器的 mean/max/std，writetable 输出 CSV。

> [!TIP]
> 思路innerjoin 的 Keys 参数 + groupsummary 的多统计量列表（{'mean','max','std'}）。这套「过滤→连接→聚合→导出」与 pandas/SQL 的心智完全同构——表格操作的通用语法在三个工具间迁移。

**4.** 把结构体（含嵌套数组）jsonencode 后，用 Python json.loads 读入，再用 jsondecode 读回 MATLAB——列出三个「往返后类型/形状变化」的现场（如行向量、cell、字段顺序）。

> [!TIP]
> 思路典型变化：MATLAB 行向量 → JSON 数组 → Python list → 读回 MATLAB 变列向量；空矩阵→null→[]。JSON 往返不是无损的——「交换格式的类型系统交集」是互操作的真实边界。

**5.** 用 datastore 处理「一年份的日 CSV 文件」：只读两列、按月聚合出每月均值（while read 循环累加），与把全部文件 readtable 进内存的做法对比峰值内存。

> [!TIP]
> 思路分块版的内存 = 单块大小；全量版 = 数据总量。tall 版语法更优雅（mean(tall.Temp) 自动并行分块）——「逻辑不变、执行策略改变」是 datastore/tall 设计的价值证明。

**6.** 讨论：实验数据应该存 .mat 还是 CSV/JSON？从「保真度、跨工具可读性、版本控制友好度（git diff）、体积」四个维度给一个混合策略（哪些进 .mat、哪些进文本、哪些进 HDF5）。

> [!TIP]
> 思路实用混合：最终结果与中间大数组 → .mat/HDF5（保真）；参数与汇总指标 → JSON/CSV（可 diff、可进 git）；原始测量 → 原始格式 + 只读归档。「数据分级存储」让 git 管参数与结论、二进制格式管体积。
