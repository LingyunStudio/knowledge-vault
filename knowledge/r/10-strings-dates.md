---
title: 字符串与日期：stringr 与 lubridate
order: 10
tags: stringr, 正则, lubridate, 日期, 时区
summary: stringr 的动词式字符串 API 与向量化正则、提取与替换的捕获组用法、Date/POSIXct 的两种日期形态、lubridate 的解析四件套与时间运算、时区的显式纪律，以及一条「日志解析 + 时间统计」实战链。
---

字符串与日期是数据分析的两大「非数值暗礁」。R 的现代答案是两个动词式包：**stringr**（字符串，正则统一 `str_` 前缀）与 **lubridate**（日期时间，「解析/运算/取字段」三件事的语法糖）。正则的原理与[python 篇](../python/03-control-flow.md)共享，本篇只标 R 特有处。

## 1. stringr：字符串的动词族

```r
library(stringr)

str_length(c("abc", "de"))              # 3 2 —— 长度（注意区分 str_count）
str_c("a", "b", sep = "-")              # "a-b" —— 拼接（对应 paste0/paste）
str_sub("hello", 1, 3)                  # "hel" —— 切片（1-based、含端点！）
str_to_lower("ABC"); str_trim("  x  ")  # 归一化

str_detect(v, "error")                  # 逻辑向量：包含判断（filter 的原料）
str_count(v, "\\d+")                    # 匹配次数
str_which(v, "NA")                      # 匹配的下标
```

全部 `str_` 函数**向量化**（吃向量出向量）——与 dplyr 的 mutate 无缝组合：

```r
df |> mutate(domain = str_extract(email, "@(.+)$"),
             is_gmail = str_detect(email, "gmail"))
```

### 1.1 提取与替换：正则的主力

```r
s <- "order-2024-06-01-id42"

str_extract(s, "\\d{4}")                # "2024" —— 第一个匹配
str_extract_all(s, "\\d+")              # list("2024","06","01","42") —— 全部匹配（注意 list 返回！）

str_match(s, "order-(\\d{4})-(\\d{2})") # ★ 捕获组矩阵：整匹配 + 各组
str_match(s, "id(\\d+)")[, 2]           # "42" —— 取第 1 组

str_replace(s, "-", "_")                # 替换第一个；str_replace_all 全部
str_replace_all(s, "(\\d{4})-(\\d{2})-(\\d{2})", "\\3/\\2/\\1")   # 组引用：日期换序

str_split("a,b,c", ",")                 # list(c("a","b","c")) —— 切分（返回 list）
str_split_fixed(s, "-", n = 4)          # 固定列数的矩阵切分

str_flatten(c("a","b","c"), ", ")       # "a, b, c" —— 收拢（join）
```

正则要点（与 [python 篇](../python/03-control-flow.md)共享的规则）：`\\d` 双反斜杠转义、捕获组 `()`、`^ $` 锚、惰性 `*?`。R 特有：`stringr` 默认 ICU 正则（`regex()` 可开 `dotall/multiline`），base 的 `grep/gsub` 用 POSIX 或 `perl=TRUE`——**新代码统一 stringr**，读老代码注意两方言。

## 2. 日期的两种形态：Date 与 POSIXct

```r
d <- as.Date("2026-09-19")              # Date：天（整数，无时间无时区）
class(d); as.numeric(d)                 # 20717 —— 自 1970-01-01 的天数

dt <- as.POSIXct("2026-09-19 10:30:00", tz = "UTC")   # POSIXct：秒（时间戳，带时区）
as.numeric(dt)                          # 秒数 —— 与 unix 时间戳直接互转

as.Date(df$raw_date, format = "%d/%m/%Y")   # ★ 显式格式解析（猜格式是事故之源）
```

| 类型      | 存储          | 有无时间/时区   | 用途                     |
| --------- | ------------- | --------------- | ------------------------ |
| `Date`    | 天（整数）     | 无               | 日期、日历运算             |
| `POSIXct` | 秒（双精度）  | 时间 + 时区       | 时间戳、时间运算            |
| `POSIXlt` | list（字段化）| 时间 + 时区       | 取字段（mday/hour）——ct 更常用 |

日期运算天然成立：`d + 30`（加 30 天）、`difftime(dt2, dt1, units = "days")`、`seq(d, by = "month", length.out = 12)`。

## 3. lubridate：解析、运算、字段

```r
library(lubridate)

# 解析：按「年月日」的顺序拼函数名（多格式自动尝试）
ymd("2026-09-19");  mdy("09/19/2026");  dmy("19-09-2026")
ymd_hms("2026-09-19 10:30:00", tz = "UTC")
parse_date_time2(s, orders = c("dmy", "Ymd"))    # 多格式混排

# 字段与调整
year(d); month(d, label = TRUE); wday(d, label = TRUE)
floor_date(dt, "week")                  # 向下取整到周首（分桶统计的主力）
round_date(dt, "hour"); ceiling_date(dt, "month")

# 区间与时长
interval(d1, d2)                        # 时间区间
d2 %within% interval(d1, d3)            # ★ 判断是否落在区间内
dt + days(3) + hours(5)                 # 时长运算（days vs ddays 的夏令时差异）

# 时区
with_tz(dt, "Asia/Shanghai")            # 同一时刻、换显示时区（安全）
force_tz(dt, "Asia/Shanghai")           # 改「时钟读数」保壁钟值（危险：换时刻）
```

lubridate 三纪律：

1. **解析显式**（ymd/mdy 按数据真实顺序选；不猜）——`03/04/2026` 是 3 月 4 日还是 4 月 3 日由地缘决定。
2. **时区显式**（存储 UTC、展示 with_tz）——与[python datetime](../python/11-standard-library.md)、[C 篇](../c/01-c-model.md)的时间纪律完全同源；force_tz 的「时钟不变、时刻变」是事故制造机。
3. **分桶用 floor_date**：按天/周/月聚合的标准入口（配合 group_by）。

## 4. 实战：日志解析与时间统计

```r
raw <- read_lines("app.log")
# 每行形如 "2026-09-19 08:31:22 [ERROR] auth: token expired for user 42"

log <- tibble(line = raw) |>
  transmute(
    ts    = ymd_hms(str_extract(line, "^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}")),
    level = str_extract(line, "\\[(\\w+)\\]", group = 1),
    module= str_extract(line, "\\] (\\w+):", group = 1),
    user  = as.integer(str_match(line, "user (\\d+)")[, 2])
  ) |>
  filter(level == "ERROR")

log |> count(hour = floor_date(ts, "hour"), module) |>    # 按小时×模块分桶
  ggplot(aes(hour, n, color = module)) + geom_line()
```

这条链是 stringr + lubridate 的标准组合拳：**正则抽取字段（group 参数直接取捕获组）→ 时间解析 → floor_date 分桶 → 计数可视化**——日志分析从「文本处理」变成「表格分析」的转换点。

## 5. 陷阱清单

- str_split/str_extract_all 返回 list：忘记 unlist/map 取内容；批量取第 N 组用 str_match 的矩阵列。
- 日期格式猜解析（mdy 与 dmy 的地缘差异）：显式 order/format；parse 失败的 NA 行数要检查。
- as.Date 忘 format：只认 ISO 格式，其他全 NA。
- POSIXct 的时区隐式继承（本地时区）：存储 UTC 显式 tz；with_tz/force_tz 分清。
- floor_date 的周起点（默认周日）：`week_start = 1` 对齐业务周。
- 日期列在 read_csv 中变 character：col_date 或 lubridate 二次解析；解析失败的 NA 统计。
- str_sub 的含端点切片与 Python 半开区间的互译差一。

## 6. 小结

- stringr 的动词族（detect/extract/match/replace/split/flatten）全部向量化、与 dplyr 无缝；str_match 的捕获组矩阵是结构化提取的主力。
- 日期两形态：Date（天、无时区）与 POSIXct（秒、时区）；显式 format/order 解析、失败行数必查。
- lubridate 三纪律：解析按真实顺序、存储 UTC + with_tz 展示、分桶 floor_date；区间 %within% 与时长运算服务业务逻辑。
- 日志分析的转换点：正则抽取 → 时间解析 → 分桶聚合——文本处理降维成表格分析。
- 与 python/lubridate 的对照：解析函数化（ymd vs %Y-%m-%d）、时区纪律同源、切片端点约定相反——跨语言互译表（[第 2 篇](02-vectors.md)）的又一组条目。

## 7. 练习

**1.** 对一组混合格式日期字符串（"2026/9/1"、"1-9-2026"、"Sep 1, 2026"）用 parse_date_time 的多 orders 解析，统计每种的解析成功率，失败行抽出来人工核对。

> [!TIP]
> 思路多格式解析的正确流程：orders 尝试 → is.na 统计失败 → 抽样人工归类 → 分组分别解析再 bind。混合格式是「猜不得」的实证。

**2.** 把一份含 US 与 CN 两种时区时间戳的数据统一到 UTC：force_tz 修正「无时区但实际是本地时间」的列，再用 with_tz 出两种展示——画出两种操作的效果差异时间线。

> [!TIP]
> 思路force_tz 改「壁钟值」用于标注缺失时区的原始数据；with_tz 改「同一时刻的显示」。两者用错 = 时间整体偏移 8 小时——画时间轴对比是最直观的自检。

**3.** 正则实战：从自由文本地址列提取省/市/街道三级（中文正则与 `[\u4e00-\u9fa5]`），统计无法完整解析的行；讨论正则解析自然文本的天花板在哪。

> [!TIP]
> 思路中文正则的字符类写法 + 贪婪/惰性控制是考点；天花板出现在「格式自由、层级缺失」的数据——那时该升级到地址库匹配/LLM 抽取。正则的甜区仍是「结构有模板」的文本。

**4.** 用 floor_date + count 做「事件热力分析」：按小时×星期几分桶统计，用 ggplot 画日历热图（weekday × hour 的 tiles），找出流量峰值时段。

> [!TIP]
> 思路`wday(ts, label=TRUE, week_start=1)` + `hour(ts)` 两维分桶 → geom_tile(aes(hour, wday, fill=n))。日期函数 + 透视 + 热图的三线合一是周期性分析的标准形态。

**5.** 对比 R/Python/MATLAB 的日期 API：解析一个 ISO 字符串、加 7 天、取星期几、换时区——写出四行对照表（[第 2 篇](02-vectors.md)互译表的日期版）。

> [!TIP]
> 思路R: lubridate；Python: datetime/zoneinfo；MATLAB: datetime/tz。三者的「解析-运算-时区」抽象同构，词汇不同——对照表延续跨语言素养的建设。

**6.** 讨论：为什么日期时间几乎在所有语言里都是「重灾区」？（夏令时、闰秒、时区政治、格式地缘）从「时间的一维物理本质 vs 人类历法的多层社会约定」分析，并总结你个人的「时间数据入库三纪律」。

> [!TIP]
> 思路物理时间（秒）与文明时间（历法/时区/夏令时）是两种模型，工程失败多在两者混用。三纪律：存 UTC、时区随数据显式标注、解析显式格式+失败可审计——与 [linux 篇 chrony](../linux/11-ops-pitfalls.md) 的服务器对时纪律呼应：时间的一致性是系统级工程。
