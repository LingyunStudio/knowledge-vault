---
title: tidyverse 与 dplyr：数据整理的动词
order: 5
tags: dplyr, 管道, filter, mutate, group_by, join
summary: 管道运算符的流程语义、dplyr 六大动词（filter/select/arrange/mutate/summarise/group_by）与 across、join 家族、group 的取消陷阱，以及一条完整 EDA 流水线的组装。
---

tidyverse 是一组共享设计哲学的包的合称（dplyr/tidyr/ggplot2/readr/purrr…），其核心是 **dplyr**：用一组「动词」声明式地操作表格。dplyr 的每个函数都对应一个数据处理的意图（筛选、变换、汇总）——代码读起来像英语祈使句，组合靠管道。

## 1. 管道：流程的语言

```r
df |> filter(score > 80) |> arrange(desc(score))
# 读作：「df，筛选，再排序」—— 数据在前，动作串联

# magrittr 的老管道 %>% 与原生管道 |>
#   %>% 支持 . 占位符与函数式用法；|> 是 R4.1+ 内建（更严格）
#   团队统一一种即可；本篇用 |>
```

管道把「嵌套调用」翻转为「流程叙述」：`f(g(h(x)))` 变成 `x |> h() |> g() |> f()`——阅读顺序 = 执行顺序 = 写作顺序。**一条管道做一件事**：超过 6~8 步的管道该拆成分步变量（每步检查中间结果——EDA 的节奏）。

## 2. dplyr 六大动词

| 动词        | 作用           | 例子                                  |
| ----------- | -------------- | ------------------------------------- |
| `filter()`  | 按条件选行      | `filter(df, score > 80, grp == "A")`  |
| `select()`  | 按列名选列      | `select(df, id, starts_with("t"))`    |
| `arrange()` | 排序            | `arrange(df, desc(score), id)`        |
| `mutate()`  | 新列/改列       | `mutate(df, ratio = score/100)`       |
| `summarise()` | 聚合         | `summarise(df, m = mean(score))`      |
| `group_by()`| 分组（改变后续动词的作用域） | `group_by(df, grp)`           |

```r
library(dplyr)

df |>
  filter(!is.na(score), score >= 60) |>          # 多条件 = 且（逗号分隔）
  mutate(grade = cut(score, c(0, 70, 85, 100),
                     labels = c("C", "B", "A"))) |>   # 新列（引用刚算的列也行）
  select(id, grp, score, grade) |>
  arrange(grp, desc(score))
```

select 的辅助选择器：`starts_with("t")`、`ends_with`、`contains`、`where(is.numeric)`（按类型选列）、`-col`（排除）、`everything()`（其余列）。

### 2.1 group_by + summarise：分组聚合的心脏

```r
df |>
  group_by(grp) |>                      # 之后的动词按 grp 分组作用
  summarise(
    n     = n(),
    mean  = mean(score, na.rm = TRUE),
    max   = max(score),
    .groups = "drop"                    # ★ 聚合后掉组（防隐式分组泄漏）
  )
```

`group_by` 之后的每一步都「按组」执行——summarise 每组一行、mutate 每组内计算（如组内排名 `rank()`）、filter 组内筛选。**分组状态是隐式的**：`.groups = "drop"` 或显式 `ungroup()` 是防「以为没分组其实还分着」的纪律（头部第一坑）。

### 2.2 mutate 的窗口函数与 across

```r
df |>
  group_by(grp) |>
  mutate(z = (score - mean(score)) / sd(score),     # 组内标准化
         rank = rank(desc(score))) |>               # 组内排名
  ungroup()

# across：对多列应用同一函数（批量 mutate/summarise）
df |>
  group_by(grp) |>
  summarise(across(c(score, weight), list(mean = mean, sd = sd), na.rm = TRUE))
df |> mutate(across(where(is.character), trimws))    # 所有字符列去空白
```

across 是「列的批处理」——替代「对 20 列各写一遍同一变换」的复制粘贴。

## 3. join 家族：表格连接

```r
inner_join(a, b, by = "id")      # 只留两边都有的
left_join(a, b, by = "id")       # 左全保（b 缺失为 NA）—— 分析的主连接
full_join(a, b, by = "id")       # 并集
anti_join(a, b, by = "id")       # ★ 左边有、右边没有的行（「孤儿检测」）
semi_join(a, b, by = "id")       # 左边有且右边有的行（不过滤列）

left_join(a, b, by = c("id" = "ref_id"), suffix = c("_a", "_b"))   # 键名不同/列名冲突
```

join 与 [第 4 篇](04-data-frames.md)的 merge 同功，但 by 的显式性、行序保持、错误信息都更好。连接前检查键唯一（[第 4 篇练习 4](04-data-frames.md)）；`anti_join` 是「哪个 ID 没匹配上」的排查利器——数据质量审计的常备动词。

## 4. 行操作：rowwise 与 if_else

```r
df |>
  rowwise() |>                          # 按行分组（逐行函数，如对每行取多个列的最大值）
  mutate(best = max(c_across(cols = q1:q5), na.rm = TRUE)) |>
  ungroup()

df |> mutate(flag = if_else(score >= 60, "pass", "fail"))    # 向量化 if（严格类型）
df |> mutate(v = case_when(                                  # 多分支向量化
          score >= 85 ~ "A",
          score >= 70 ~ "B",
          is.na(score) ~ "missing",
          TRUE ~ "C"))                                        # TRUE 兜底 = otherwise
```

`case_when` 是向量化分支的主力（`~` 左条件右值）；**NA 条件不会落入 TRUE 兜底**（返回 NA）——缺失分支要显式写（上面第三条）。

## 5. 完整 EDA 流水线：组装

```r
raw <- read_csv("survey.csv", na = c("", "NA", "-999"))

clean <- raw |>
  janitor::clean_names() |>                              # 列名统一蛇形
  mutate(date = ymd(date), region = as.factor(region)) |>
  filter(complete.cases(select(., id, score)))           # 关键列完整

summary_tbl <- clean |>
  group_by(region, year) |>
  summarise(n = n(), mean_score = mean(score), sd = sd(score), .groups = "drop") |>
  arrange(region, year)

outliers <- clean |> anti_join(summary_tbl, by = "region") |> ...   # 匹配不上的记录
```

这条链展示了 tidyverse 工作流的形状：**读入（显式缺失）→ 清洗（mutate/filter）→ 聚合（group_by/summarise）→ 审计（anti_join）→ 交付**。每段一个中间变量（可 print 检查），管道不超过一个屏幕。

## 6. 陷阱清单

- group 后忘了 ungroup/.groups="drop"：下游操作仍在分组状态（结果带 group 结构、逐组计算错乱）。
- filter 里对含 NA 列的比较：NA 行被静默丢弃；先显式处理缺失或 `filter(!is.na(x), ...)`。
- case_when 的 NA 条件不落 TRUE 兜底：缺失分支显式写。
- 管道过长不设中间变量：一步错全链错且难定位；EDA 中间结果可 print。
- mutate 里用循环思维（逐行 ifelse 套娃）：向量化函数（if_else/case_when/across）。
- join 键不唯一或类型不一致（integer vs character 的 key）：行数膨胀/全部 NA；连接前类型与唯一性双检查。
- `%>%` 与 `|>` 混用导致的行为差异（占位符、命名参数管道）——团队统一。

## 7. 小结

- 管道让代码按执行顺序阅读；一条管道一个意图，中间变量是 EDA 的检查点。
- 六动词 + group_by 覆盖表格操作的全部意图：filter/select/arrange/mutate/summarise；across 是列的批处理、case_when 是向量化分支（NA 分支显式）。
- 分组状态是隐式的：.groups="drop"/ungroup 是纪律；mutate 在分组下的「窗口函数」语义（组内标准化/排名）是重要形态。
- join 家族按匹配语义分五档：anti_join/semi_join 是数据审计工具；连接前查键唯一与类型。
- tidyverse 的工作流形状：读入显式化 → 清洗 → 聚合 → 审计 → 交付，每步可检查。

## 8. 练习

**1.** 用六动词重写[第 4 篇](04-data-frames.md)练习 3 的 base 三连（筛选+排序+新列），逐行对照两个版本的「意图可读性」——写下 dplyr 版更易读的三个具体点。

> [!TIP]
> 思路可读性差异的来源：动词命名即意图、列名裸写（无 df$ 前缀噪音）、管道消去中间赋值。这不是审美——是「review 时逐行核对成本」的工程差异。

**2.** 用 group_by + mutate 实现「组内 z 分数与组内排名」两个新列，再 summarise 出「每组 top1 的 id」两种写法（slice_max 与 filter(rank==1)），讨论组内并列时的行为差异。

> [!TIP]
> 思路slice_max(n=1, with_ties=TRUE) 保并列、filter(rank==min(rank)) 同样保并列但依赖 rank 的并列语义（ties.method）。「并列怎么处理」是排名类需求的隐藏规格。

**3.** 做一次「连接审计」：左右表 join 后用 n_row 对比、anti_join 找未匹配行、semi_join 找成功匹配——把三个结果组装成一个「连接质量报告」函数。

> [!TIP]
> 思路报告函数返回 list(row_in, matched, unmatched_a, unmatched_b, dup_key_b)。连接质量报告是数据集成项目的标准交付——比「跑通 join」多十分钟的工程换掉「静默丢行」的事故。

**4.** 用 across 完成一次「批量列清洗」：所有字符列 trimws+大小写归一、所有数值列替换 -999 为 NA、所有日期列解析——三行 across 语句。

> [!TIP]
> 思路`mutate(across(where(is.character), ~str_to_lower(trimws(.))))` 的 lambda（~/.）语法。across 把「列类型 → 列操作」的映射声明化——脏数据清洗的模板化答案。

**5.** 写一条超过 10 步的管道（故意的），然后重构为「四段式 + 中间变量」，每段 print 摘要——体会「管道的断点检查」在 EDA 里的实际价值。

> [!TIP]
> 思路断点的标准：每个中间产物可独立质疑（行数对吗？分布合理吗？）。EDA 的本质是「反复质疑数据」——管道的结构应该服务于这个循环。

**6.** 讨论：dplyr 的「动词」设计与 SQL 的「子句」设计（SELECT/WHERE/GROUP BY）是同一模型的不同拼写。把本篇的 EDA 流水线翻译成 SQL，列出动词↔子句对照表，并讨论为什么数据分析语言都收敛到这个模型。

> [!TIP]
> 思路对照：filter↔WHERE、select↔SELECT 列、arrange↔ORDER BY、mutate↔SELECT 表达式、group_by+summarise↔GROUP BY+聚合、join↔JOIN。收敛的原因：关系代数是表格操作的完备抽象——语言殊途，代数同归。
