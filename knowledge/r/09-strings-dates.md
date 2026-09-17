---
title: 字符串与日期
order: 9
tags: 基础, stringr, 日期
summary: stringr 处理文本、正则要点、lubridate 解析与运算时间。
---

文本和日期是数据清洗里最磨人的两类数据，工作量常常超过建模本身。R 的解法是两个「动词命名的包」：stringr 全家桶都叫 `str_xxx`，lubridate 用 `ymd()` 这类直白函数吃下乱七八糟的日期。函数名本身就是索引，记不住细节没关系。

## stringr：函数名即文档

stringr 所有函数以 `str_` 开头，第一个参数几乎都是字符串向量，天然向量化：

```r
library(stringr)

str_length(c("苹果", "apple"))   # 2 5，字符数（不是字节数）
str_c("a", "b", sep = "-")       # "a-b"，拼接
str_to_upper("hello")            # "HELLO"
str_trim("  hi  ")               # "hi"，去首尾空白
str_sub("2026-09-13", 1, 4)      # "2026"，按位置截取（下标从 1 起）
```

检测与提取是最高频的动作：

```r
s <- c("订单A-100", "订单B-200", "退货C-300")

str_detect(s, "订单")           # TRUE TRUE FALSE，是否包含
str_extract(s, "\\d+")          # "100" "200" "300"，抓第一段数字
str_extract_all(s, "\\d+")      # 每个字符串的所有匹配，返回 list
str_replace(s, "订单", "单号")  # 每个字符串替换第一处；全部替换用 str_replace_all
str_split("a,b,c", ",")         # list(c("a", "b", "c"))，注意返回 list
```

> [!NOTE]
> 记函数名的规律：`detect` 问真假、`extract` 抓片段、`replace` 换内容、`remove` 删片段、`split` 切开；加 `_all` 后缀处理所有匹配。IDE 里敲 `str_` 看自动补全，比翻文档快。

常用函数速查：

| 需求 | 函数 |
| --- | --- |
| 拼接与插值 | `str_c()` / `str_glue()` |
| 按位置截取 | `str_sub()` |
| 计数匹配 | `str_count()` |
| 提取捕获组 | `str_match()` |
| 压缩空白 | `str_squish()` |
| 大小写转换 | `str_to_upper()` / `str_to_lower()` |

```r
str_count(s, "\\d")                 # 每个字符串里有几个数字
str_squish(" a   b ")               # "a b"，压掉重复空格
str_match(s, "订单([AB])-(\\d+)")   # 返回矩阵：完整匹配 + 各捕获组
```

调试正则用 `str_view(s, "模式")`，高亮显示匹配位置，比肉眼猜快得多。

## 正则要点

```r
str_detect(s, "^订单")                     # ^ 锚定开头
str_detect(s, "300$")                      # $ 锚定结尾
str_detect(s, "[AB]-")                     # 字符类：A 或 B 后跟横线
str_replace(s, "订单([AB])", "单号\\1")    # \\1 引用第一个捕获组
str_detect(s, fixed("A-100"))              # fixed() 按纯文本匹配，不解释正则
```

常用元字符：`.` 任意字符、`\\d` 数字、`\\w` 字母数字下划线、`\\s` 空白；量词 `*`（0 次以上）、`+`（1 次以上）、`?`（0 或 1 次）。正则里的 `.` 和 `\` 本身要转义，匹配「3.5」这类文本用 `fixed()` 最省心。

正则写到三个捕获组以上就该拆成多步——可读性优先，别炫技。

## 日期：先解析，再运算

R 原生两类日期：`Date`（只有日期，底层是从 1970-01-01 起的天数）和 `POSIXct`（日期时间，底层是秒数）。lubridate 负责把字符串解析成它们：

```r
library(lubridate)

ymd("2026-09-13")                 # 按年月日的顺序选函数
mdy("09/13/2026")                 # 月日年
dmy("13-09-2026")                 # 日月年
ymd_hms("2026-09-13 08:30:00")
today(); now()                    # 今天、此刻
```

`ymd` 家族按「年月日在字符串里出现的顺序」选，解析不出来的元素会警告并返回 NA——立刻暴露数据问题，比拖到画图时发现整列 NA 强得多。

```r
d <- ymd("2026-09-13")
year(d); month(d); day(d)         # 各部分随便取
wday(d, label = TRUE)             # 星期几，直接给标签

d + days(10)          # 2026-09-23
d + months(1)         # 2026-10-13，月份运算自动处理大小月
as.period(interval(d, ymd("2027-01-01")))   # 两个日期之间的间隔
```

> [!WARNING]
> Excel 存出的 csv 里，日期可能变成 `45000` 这样的序列数（距 1900 年的天数）。识别特征：本该是日期的列全是 3~5 万的整数。修复：`as.Date(x, origin = "1899-12-30")`，这个 origin 已经替你绕开了 Excel 把 1900 当闰年的历史 bug。

## 展示与聚合

```r
with_tz(now(), "Asia/Shanghai")   # 换时区显示，时刻本身不变
force_tz(d, "UTC")                # 硬改时区标签，时刻真的变
format(d, "%Y年%m月")             # 自由格式化输出
```

`Date` 减 `Date` 得天数，`POSIXct` 减 `POSIXct` 得秒数（`difftime()` 可指定单位）。按天/月分组聚合前，先 `class()` 确认列真的是日期类型——字符串「日期」的排序碰巧是对的，运算全是错的。

另外分清 period 与 duration：`months(1)` 是 period（自然月，自动处理月末），`dmonths(1)` 是 duration（固定秒数）。跨月计算用 period，精确机器时间运算才用 duration，混用是时区之外的第二大坑。

日期处理的第一原则：**解析和展示分离**。解析成 Date / POSIXct 之后一切运算才有意义，展示格式留给 `format()`。

> [!TIP]
> 分组聚合日期优先用 `floor_date(d, "month")`（lubridate）把日期压到月初，再 group_by——比手写 `format(d, "%Y-%m")` 转回字符串再排回来的老办法干净得多。

## 练习

- [ ] 把 `c("2026年9月13日", "2026年10月1日")` 解析成 Date（提示：先用 `str_replace_all` 换掉年月日）
- [ ] 用 `str_extract_all` 从 `c("重3箱", "重12箱")` 里提取所有数字
- [ ] 算一下今天到你下一个生日还有多少天

相关阅读：[dplyr 数据处理](04-dplyr.md)
