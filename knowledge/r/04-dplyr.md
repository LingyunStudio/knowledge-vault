---
title: dplyr 数据处理
order: 4
tags: 核心, dplyr, 管道
summary: filter/select/mutate/arrange/group_by+summarize，管道思维一次养成。
---

dplyr 把数据处理压缩成几个动词：filter 挑行、select 挑列、mutate 造列、arrange 排序、group\_by 加 summarize 出指标。动词本身不难，难的是第一次建立「数据像流水一样穿过一串操作」的管道思维——建立一次，终身受用。

## 管道：先想清楚数据往哪流

管道把「由内向外读的嵌套调用」改写成「从上到下的流水线」。R 有两个管道：

```r
# 传统嵌套写法，要倒着读，反人类
summarize(group_by(filter(starwars, height > 100), species), n = n())

# %>% 来自 magrittr 包，tidyverse 传统写法
starwars %>% filter(height > 100)

# |> 是 R 4.1 起的原生管道，不装包就能用
starwars |> filter(height > 100)
```

两者的实际差别：

| <br />   | `%>%`（magrittr）          | `\|>`（原生）             |
| -------- | :----------------------- | --------------------- |
| 来源       | magrittr 包               | R 4.1 内置              |
| 左侧传入任意参数 | `lm(y ~ x, data = .)` 支持 | 只能传给第一个参数             |
| 占位符      | `.`                      | `_`（R 4.2+，且必须作为命名参数） |
| 额外依赖     | 需要 tidyverse             | 无                     |

新项目建议统一 `|>`，少一个依赖；老教程和网上的代码 `%>%` 铺天盖地，认识即可。本篇统一用 `%>%` 与主流材料保持一致。

## 五个动词

用 tidyverse 自带的 `starwars` 数据演示：

```r
library(tidyverse)

# filter：挑行，多个条件用逗号分隔（等价于 &）
starwars %>% filter(height > 180, species == "Human")

# select：挑列，支持范围与辅助函数
starwars %>% select(name, height:mass)
starwars %>% select(name, starts_with("hair"))

# mutate：造新列或改旧列
starwars %>%
  mutate(bmi  = mass / (height / 100)^2,
         tall = height > 180)

# arrange：排序，desc() 降序
starwars %>% arrange(desc(height), name)

# group_by + summarize：分组汇总，数据分析的心脏动作
starwars %>%
  group_by(species) %>%
  summarize(n          = n(),
            avg_height = mean(height, na.rm = TRUE)) %>%
  filter(n >= 3) %>%
  arrange(desc(avg_height))
```

> [!WARNING]
> group\_by 之后求均值必须写 `na.rm = TRUE`：`mean(height)` 遇到缺失返回 NA，于是每组的汇总结果全变 NA。这是 dplyr 新手第一个必踩的坑，症状是「汇总表里全是 NA」。

## filter 的条件写法

```r
# ❌ filter(homeworld == "Tatooine" | "Naboo")，没有这种语法
# ✅ 多值匹配用 %in%
starwars %>% filter(homeworld %in% c("Tatooine", "Naboo"))

# ❌ filter(height != 180) 会把 NA 行一起丢掉：NA 参与比较得 NA，被当作 FALSE
# ✅ 想保留缺失行要显式写出来
starwars %>% filter(height != 180 | is.na(height))
```

filter 的规则是「条件为 TRUE 的行留下」，而 NA 既不是 TRUE 也不是 FALSE，于是被丢弃。多数时候这正是你要的；但做数据质检时，它就变成了静默丢数据。

## summarize 的搭档

```r
starwars %>% count(species, sort = TRUE)   # 分组计数，group_by + n() 的语法糖

starwars %>% summarize(across(where(is.numeric), mean, na.rm = TRUE))
# across() 批量作用于多列，取代旧版 summarise_if / summarise_at

starwars %>% group_by(species) %>% slice_max(height, n = 1)
# 每组取身高最高的一个
```

> [!TIP]
> group\_by 之后记得 `ungroup()`，否则数据框带着分组属性，后续任何 mutate / summarize 都还在按组算——「为什么我的结果被拆成好几段」多半是这个原因。dplyr 1.0 起也可以在 summarize 里写 `.groups = "drop"`，汇总完直接解除分组。

## 管道思维的模板

九成的数据处理能套这个骨架：

```r
result <- raw_data %>%
  filter(...) %>%          # 1. 圈定范围
  mutate(...) %>%          # 2. 准备变量
  group_by(...) %>%        # 3. 定分组维度
  summarize(...) %>%       # 4. 出指标
  arrange(desc(...))       # 5. 排出结论顺序
```

每一行都是一句中文：筛什么 → 算什么 → 按什么分 → 汇总什么 → 从大到小排。写不出来的时候，多半是第 3 步的「分组维度」没想清楚——那是业务问题，不是代码问题。

## 练习

- [ ] 用 starwars 求每种 species 的平均身高，只保留样本数 ≥ 3 的组并降序排列
- [ ] 把本篇任意一段 `%>%` 代码改写成 `|>`，确认结果一致
- [ ] 故意对含 NA 的列不加 `na.rm = TRUE` 分组求均值，观察症状并修复

相关阅读：[ggplot2 可视化](05-ggplot2.md)
