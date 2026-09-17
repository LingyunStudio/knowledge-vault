---
title: 环境与 RStudio
order: 1
tags: 入门, RStudio, 包
summary: R 与 RStudio 的分工、CRAN 安装包、项目与工作目录意识。
---

R 是一门为统计计算而生的语言，RStudio 只是运行它的图形界面。分清楚两者：R 是引擎，RStudio 是驾驶舱。装好这对组合后，第一个要养成的习惯不是写代码，而是管理好「代码在哪、数据在哪、结果存哪」。

## R 与 RStudio 的分工

- **R**：解释器加基础包。Console 里跑的每一行代码最终都由 R 执行，版本升级、报错排查都指向它
- **RStudio**：IDE，提供四块标准布局——脚本编辑器、Environment（变量）、Console、Files/Plots/Help

安装顺序：先装 R，再装 RStudio Desktop。R 的包默认装在按版本命名的目录里，升级 R 后所有包要重装，所以别为小版本号频繁折腾。

```r
R.version.string      # 查看当前 R 版本
getwd()               # 当前工作目录，所有相对路径以它为基准
```

## Console 与 Script

Console 适合试探，Script 适合沉淀。数据分析师的日常应该九成发生在 Script 里：选中代码按 Ctrl+Enter 发到 Console 执行，文件本身保存下来，明天还能原样重跑。

只在 Console 里干活的人，会陷入「结果算出来了但说不清怎么算的」的处境——这叫不可复现，第 10 篇的 R Markdown 是它的彻底解法。

> [!TIP]
> 快捷键 Alt+- 自动输入赋值符号 `<-`。R 社区约定用 `<-` 赋值，`=` 只用在函数参数里：`x = 1` 能跑，但 `mean(x = 1:10)` 是给形参传值，不会创建名为 x 的变量。

## 会话：状态、重启与干净环境

R 的一次运行叫一个会话，Console 里赋的值都存在内存里，关掉就没了（除非隐式存进 .RData）：

```r
ls()                  # 看当前会话里有哪些变量
rm(list = ls())       # 清空所有变量，等于手动重启
```

RStudio 的扫帚图标和 Session → Restart R（Ctrl+Shift+F10）做的是同一件事：清空内存重新开始。调试疑难杂症的标准动作就是重启后从头跑脚本——能跑通说明代码自洽，跑不通说明你一直在依赖会话里的残留状态。

Tools → Global Options → General 里把「Save workspace to .RData on exit」取消勾选。让 .RData 隐式保存状态是万恶之源：你永远不知道会话里哪个变量是上上周哪个实验留下的。

## 包：安装一次，每次会话加载

CRAN（The Comprehensive R Archive Network）是 R 的官方包仓库，两万多个包全部经过基本审核。装包和用包是两件事：

```r
install.packages("tidyverse")   # 装包：一辈子装一次，包名加引号
library(tidyverse)              # 加载：每次新会话都要重新执行，不加引号
```

记忆方法：**install 是买家电，library 是插电源**。两类报错要分清：

- `could not find function "xxx"`：函数所在包没加载，先 `library()`
- `there is no package called 'xxx'`：没安装或包名拼错，先 `install.packages()`

> [!NOTE]
> 包版本与 R 版本挂钩：新包可能要求较新的 R。报错「namespace xxx 不可用」时先看 `R.version.string`，再决定是升级 R 还是装旧版包。

```r
installed.packages()[, 1]     # 列出本机已装的包
update.packages(ask = FALSE)  # 偶尔整体升级一次
```

> [!WARNING]
> 不要把 `install.packages()` 写进脚本或报告文档。它改变本机状态而不是分析逻辑，别人渲染你的文档时会因为权限或网络直接失败。

## 从一次会话看全流程

一个典型的分析脚本长这样，三个部分对应三类动作：

```r
library(tidyverse)                    # 1. 加载包

df <- read_csv("data/raw.csv")        # 2. 读数据，相对路径
glimpse(df)                           #    第一眼检查结构

p <- df %>%                           # 3. 处理与作图
  group_by(region) %>%
  summarize(sales = sum(amount)) %>%
  ggplot(aes(region, sales)) +
  geom_col()

ggsave("output/sales.png", p)         #    产物落盘
```

Script 的价值在于「一遍从头跑到尾」：所有代码都能从第一行执行到最后一行，中间结果全在 Environment 面板可见。写完一段就全选重跑一遍，确保没有依赖「上一步恰好算过的东西」。

## 项目：目录意识的落点

RStudio Project（File → New Project）生成一个 `.Rproj` 文件。双击它打开 RStudio，工作目录自动定位到项目根，会话是干净的。这就是 R 版的「工作区」：

```
my-analysis/
├── my-analysis.Rproj    # 项目文件，双击打开
├── data/                # 原始数据，只读不改
├── R/                   # 脚本
└── output/              # 图表等产物
```

好处很实际：代码里全是相对路径 `read.csv("data/raw.csv")`，换电脑、换同事都能跑；每个项目独立会话，互不污染。不用 Project 的人，脚本里写满 `setwd("C:/Users/张三/Desktop/新建文件夹 (3)/final_v2")`——这种路径只在这台电脑的这个下午有效。

> [!NOTE]
> 临时用 `setwd()` 无妨，但它不该出现在任何要交付的脚本里。需要更稳的相对路径用 `here` 包：`here::here("data", "raw.csv")` 无论从哪里运行都能对准项目根目录。

## 帮助文档怎么查

```r
?mean               # 查函数文档，等价 help("mean")
??"linear model"    # 模糊搜索
example(mean)       # 直接运行文档里的示例代码
args(lm)            # 只看参数签名
```

读文档看四样：Usage（参数顺序）、Arguments（参数含义）、Value（返回什么）、Examples（可直接跑）。报错信息先完整读一遍再动手——R 的报错啰嗦但大多准确，复制报错原文去搜索命中率最高。

## 练习

- [ ] 安装 tidyverse，重启 RStudio 后只用 `library(tidyverse)` 加载成功
- [ ] 新建一个 Project，确认 `getwd()` 返回项目根目录
- [ ] 读 `?mean`，找出 Arguments 里 `na.rm` 的默认值，再用 `mean(c(1, NA), na.rm = TRUE)` 验证

相关阅读：[向量与基本类型](02-basics-vectors.md)
