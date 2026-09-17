---
title: 数据导入导出
order: 7
tags: 基础, load, readmatrix
summary: mat 二进制与纯文本、readmatrix/readtable 读 Excel、批量处理文件。
---

数据进出两条主线：`.mat` 是 MATLAB 自家的二进制容器，保真保类型；对外交换则走纯文本与 Excel。读表格的现代 API 是 `readmatrix`/`readtable` 一族，老的 `xlsread` 已不推荐再写进新代码。

## mat 文件：save 与 load

```matlab
save result.mat x y A          % 只存指定变量
save result.mat                % 工作区全部存入
load result.mat                % 全部读回，按原变量名进工作区
S = load('result.mat', 'x')    % 挑着读：返回结构体，不污染工作区
save big.mat X -v7.3           % 单文件超 2GB 用 v7.3（HDF5 底层）
```

mat 文件带变量名与类型，跨平台稳定、数值无损，是"中间结果落盘"的默认选择。`-ascii` 模式只支持单个数值矩阵且丢名字丢精度，除非对接老古董程序，否则别用。

两个进阶用法：

```matlab
save session.mat -append       % 往已有 mat 里追加/更新变量
m = matfile('big.mat');        % 大文件按需读写，不整体载入
chunk = m.X(1:1000, :);        % 只取前 1000 行
m.Y(1, 1) = 42;                % 也能按索引写回
```

结果文件比内存还大时，`matfile` 的分块读写是唯一优雅解。

> [!WARNING]
> 直接 `load result.mat` 会把文件里的所有变量按原名倒进当前工作区，同名变量被静默覆盖——这类"数据凭空变了"的问题极难排查。脚本里更安全的姿势是 `S = load('result.mat')`，用 `S.x` 访问，来源一目了然。

## 读表格：readmatrix / readtable

| 函数 | 返回 | 适合 |
| --- | --- | --- |
| `readmatrix` | 数值矩阵 | 纯数字表格，直接进矩阵运算 |
| `readtable` | table | 带表头/混合类型，按列名访问 |
| `readcell` | cell 数组 | 格式乱、什么类型都有的表 |
| `writematrix` / `writetable` | — | 对应的写出 |

```matlab
M = readmatrix('data.xlsx');            % 自动跳过文字表头找数值区
T = readtable('data.xlsx');             % 第一行当列名
T.Height                                % 按列名取列
T.Height(T.Height > 170)                % 列上直接做掩码
writetable(T, 'out.csv');               % 写回 CSV，Excel 可直接打开
```

`readtable` 会自动推断每列类型（数值、文本、datetime），列名默认转成合法变量名。table 的列访问语法和矩阵下标并存：`T.Height` 按名、`T{:, 1}` 按位置取原始数据：

```matlab
head(T)                        % 预览前 8 行，先看再说
T.Properties.VariableNames     % 全部列名
T = rmmissing(T);              % 丢掉含缺失值的行
```

> [!TIP]
> 导入结果"不对劲"时，先跑 `detectImportOptions('data.xlsx')` 看工具把每列识别成了什么类型，再改 options 精调（指定列类型、跳过行数、重命名变量）。别猜，让工具告诉你它的判断依据。

老函数 `xlsread`、`csvread`、`dlmread` 已被官方标记为不推荐：功能被上面三个新函数覆盖，对非数值内容处理含糊，新代码不要再写，见到老代码知道是同类即可。

## 写文件：从 writetable 到 fprintf

结构化数据一步到位：`writetable` / `writematrix` 覆盖 xlsx、csv、txt。要完全控制格式（对齐、精度、自定义行），走 `fprintf`：

```matlab
fid = fopen('result.txt', 'w');      % 'w' 覆盖写，'a' 追加
if fid == -1, error('文件打不开'); end
for k = 1:5
    fprintf(fid, '%d, %.4f\n', k, sqrt(k));
end
fclose(fid);                         % 必关：缓冲没落盘会丢数据
type result.txt                      % 命令行里查看文本文件
```

fprintf 的格式串与 C 同源：`%d` 整数、`%f` 小数、`%.4f` 四位小数、`%e` 科学计数、`%s` 字符串，`\n` 换行。日常表格用 writematrix，fprintf 留给"要给人看、格式有讲究"的输出。

## 批量处理文件

批量处理的骨架是 `dir` + 循环，路径拼接一律用 `fullfile`：

```matlab
src = dir('*.csv');                  % 每个 entry 有 name/folder/bytes/datenum
[~, order] = sort([src.datenum]);    % 按修改时间排序
src = src(order);

files = string({src.name});
totals = zeros(numel(files), 1);     % 预分配结果

for k = 1:numel(files)
    M = readmatrix(fullfile(src(k).folder, src(k).name));
    totals(k) = sum(M(:, 2), 'omitnan');
end
```

三个细节决定这段代码的健壮性：`fullfile('data', '2024', name)` 代替手动拼分隔符，Windows/Linux 无痛互迁；`dir('**/*.csv')` 递归下子目录；结果变量先预分配（见[稀疏与性能](09-performance.md)），文件一多差距就出来了。

## 其他格式与选型

```matlab
txt = fileread('log.txt');              % 整个文件读成一个长字符串
J = jsonencode(struct('a', 1));         % struct ↔ JSON
d = jsondecode(J);
raw = webread('https://api.example.com/data');   % 直接读网络接口
```

不规则文本（列数不齐、自定义分隔符、混合格式）用 `textscan` 按格式串逐列解析，控制力最强但代码最啰嗦——决策顺序：先试 `readtable` 加 options，确实不行再上 `textscan`；`fgetl` 逐行读是最后手段，除非文件大到必须流式处理。

| 场景 | 首选 |
| --- | --- |
| MATLAB 自己的中间结果 | `.mat`（save/load） |
| 交付 Excel 用户 | `writetable(..., '.xlsx')` |
| 跨语言、进版本库 | `writematrix` 出 CSV |
| 超大矩阵分块读写 | `matfile` |
| 网络与结构化交换 | `jsonencode` / `jsondecode` |

相关阅读：[函数](05-functions.md)、[绘图](06-plotting.md)
