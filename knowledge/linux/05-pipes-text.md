---
title: 管道与文本处理：sed、awk 与流水线
order: 5
tags: 管道, 重定向, sed, awk, xargs
summary: 重定向的全家族（2>&1 的精确读法）、管道与退出码（pipefail）、sed 的流编辑模型、awk 的模式-动作范式与字段处理、sort/uniq/xargs 的组合惯例，以及一条日志分析流水线的完整拆解。
---

管道是 Linux 组合哲学（[第 1 篇](01-philosophy.md)）的执行机制：进程间的一条字节流通道。本篇把管道的**机制**（重定向、退出码）讲清，再给出文本处理的三大主力（grep/sed/awk）——它们都是「流式、逐行、无状态或轻状态」的设计，天生适配管道。

## 1. 重定向：把字节流接往任何地方

每个进程默认开三个流：**stdin（0）标准输入、stdout（1）标准输出、stderr（2）标准错误**。重定向就是在 Shell 层面重新接线（Shell 做接线，命令自己毫不知情）：

```bash
cmd > out.txt          # stdout 接到文件（覆盖）
cmd >> out.txt         # 追加
cmd 2> err.txt         # stderr 接到文件（错误与输出分家——日志记录的正确姿势）
cmd > all.txt 2>&1     # ★ 先 1 到文件，再 2 指向 1（「2>&1」读作「2 指向与 1 同一去处」）
cmd &> all.txt         # bash 简写：两者都到文件
cmd < input.txt        # 文件接到 stdin
cmd > /dev/null 2>&1   # 全部丢弃（后台任务静默）
```

`2>&1` 的顺序陷阱：`cmd > f 2>&1`（对）与 `cmd 2>&1 > f`（错）——后者先把 2 接到屏幕（1 的当时去向），再把 1 改到文件，2 仍在屏幕。**从左到右接线，1 的去向是当时的**。

管道 `|` 与重定向的本质区别：`|` 接到**另一个进程**（并行、流式、无中间文件）；`>` 接到**文件**（落盘）。两者可组合：`cmd1 2>/dev/null | cmd2 > out.txt`。

## 2. 管道的退出码：流水线的故障检测

```bash
grep "error" app.log | wc -l
echo $?                # wc 的退出码！grep 的失败被吞了
```

默认情况下管道的退出码是**最后一个**命令的——上游失败会被下游掩盖。检测整条链：

```bash
set -o pipefail        # 任何一个环节失败 → 整条链失败（脚本必备，[第 6 篇](06-shell-scripting.md)）
echo ${PIPESTATUS[@]}  # bash：查看管道每个环节的退出码
```

「退出码 0 = 成功」是组合哲学的约定（[第 1 篇](01-philosophy.md)）——pipefail 把这个约定在流水线里贯彻到底。

## 3. sed：流编辑器

sed 的模型：**逐行读入 → 执行编辑脚本 → 输出**。最常用的是替换命令 `s`：

```bash
sed 's/foo/bar/' file            # 每行替换第一个 foo
sed 's/foo/bar/g' file           # g：全行替换
sed -i 's/8080/9090/g' app.conf  # ★ -i 直接改文件（流编辑的落盘形态）
sed -i.bak 's/a/b/g' file        # -i.bak 改前留备份（生产环境的安全姿势）

sed -n '10,20p' file             # -n 抑制默认输出 + p 打印 = 打印 10~20 行
sed '/^#/d; /^$/d' file          # d：删除匹配行（配置文件去注释去空行的经典）
sed -n '/ERROR/p' app.log        # 等价 grep ERROR（展示模式匹配的通用语法）
sed 's/\(error\)/[\1]/g' file    # 捕获组：\1 引用（ERE 用 () 不转义：sed -E）
```

sed 的正则默认是 BRE（`\(\)` 转义捕获组），`-E` 切换到 ERE（直接 `()`）——两套语法混用是 sed 报错的头名来源。

sed 是**流式**的：不需要把文件载入内存，GB 级日志照样处理。局限也在于「逐行」：跨行的修改（如 XML）不是它的领域。

## 4. awk：模式-动作的小语言

awk 不是「命令」而是**一门面向文本表的小语言**：把每行按分隔符切成字段，用「模式 {动作}」的规则处理：

```bash
awk '{print $1}' access.log              # $1 = 第 1 字段（默认按空白切分）
awk -F: '{print $1, $3}' /etc/passwd     # -F 指定分隔符（passwd 冒号分隔）
awk '{print NF, $0}' file                # NF 字段数；$0 整行；NR 行号
awk '$3 > 1000 {print $1}' data.txt      # 条件 + 动作：第 3 列大于 1000 的行的第 1 列
awk '/ERROR/ {count++} END {print count}' app.log   # ★ 状态累积：ERROR 行计数
awk 'END {print NR}' file                # 总行数（wc -l 的 awk 版）
```

「模式 {动作}」+ 跨行累积变量，让 awk 能写**单行统计程序**：

```bash
# 每个状态码出现次数，按次数排序
awk '{print $9}' access.log | sort | uniq -c | sort -rn

# 纯 awk 版（体现 BEGIN/END 与数组）：
awk '{cnt[$9]++} END {for (s in cnt) print cnt[s], s}' access.log | sort -rn
```

awk 的数组是无预声明的关联数组（hash）——`cnt[$9]++` 一个表达式完成「分桶计数」。**grep 过滤、awk 取列与统计、sed 做文本整形**——三者配合覆盖八成文本任务。

## 5. sort / uniq / cut / tr / wc：流水线的标准件

```bash
sort -rn file                 # -r 逆序 -n 按数值（⚠️ 默认按字符串：10 排在 9 前面！）
sort -h                       # 按人类大小（2K < 1M < 3G）—— du/df 输出的正确排序
sort -u                       # 排序去重
sort -t, -k2,2nr data.csv     # -t 分隔符 -k 按第 2 列数值逆序

uniq -c                       # ★ 相邻去重计数 —— 必须先 sort！
sort names | uniq -c | sort -rn | head     # 词频统计的标准三连

cut -d, -f1,3 data.csv        # 按分隔符取列（简单取列比 awk 轻）
tr 'a-z' 'A-Z' < f            # 字符级转换（tr 只读 stdin）
tr -s ' '                     # 压缩连续重复字符（多空格变单空格）

wc -l / -w / -c               # 行数/词数/字节数
head -n 20 / tail -n 50       # 头尾截取；tail -f 实时跟踪（日志的伴生工具）
```

「sort 才能 uniq」是 uniq 名字误导：它只合并**相邻**重复——`sort | uniq -c` 是固定搭配，漏 sort 的 uniq 输出「看起来没去重」。

## 6. xargs：把字节流变回参数

管道传的是**数据流**，但很多命令只接受**命令行参数**（rm、chmod、kill）——xargs 是两者之间的转换器：

```bash
find . -name "*.log" | xargs rm          # 把路径列表变成 rm 的参数
find . -name "*.log" -print0 | xargs -0 rm   # ★ NUL 分隔：免疫空格/换行文件名（[第 3 篇](03-file-ops.md)）

cat servers.txt | xargs -I{} ssh {} 'uptime'   # -I{}：逐行代入占位符
ls *.png | xargs -n 1 -P 8 convert       # -P 8：8 路并行（批量处理的提速开关）
```

`-P` 并行是现代多核机器上 xargs 的最大价值——8 核机器的批量转码/下载直接近 8 倍提速，一行参数的事。

## 7. 实战：一条日志流水线的解剖

任务：「找出昨天 404 最多的 10 个客户端 IP，并显示每个 IP 的请求样本一条」：

```bash
grep "19/Sep/2026" access.log \
  | grep " 404 " \
  | awk '{print $1}' \
  | sort | uniq -c | sort -rn | head -10 \
  | tee /tmp/suspicious.txt \
  | awk '{print $2}' \
  | xargs -I{} grep -m1 "{}" access.log
```

逐段职责（自检每一段都能单独运行——组合哲学的可验证性）：

| 段                              | 职责                       |
| ------------------------------- | -------------------------- |
| `grep 日期`                      | 圈定时间窗                  |
| `grep " 404 "`                   | 圈定状态码                  |
| `awk '{print $1}'`               | 取 IP 列                    |
| `sort | uniq -c | sort -rn | head` | 频次统计 Top10（固定三连）  |
| `tee /tmp/suspicious.txt`        | ★ 三通：一边继续流动一边落盘 |
| `awk '{print $2}'`               | 剥掉计数留 IP               |
| `xargs -I{} grep -m1`            | 逐 IP 抽一条样本            |

`tee` 是流水线的「旁路监听」——中间结果落盘供检查，不中断主流。复杂流水线的调试法：**从左往右逐段追加，每加一段看一眼输出**——任何一段异常都能立即定位。

## 8. 陷阱清单

- `2>&1 > file` 顺序错误：从左到右接线，2 跟的是 1 的当时去向；正确 `> file 2>&1`。
- 管道退出码是最后一个命令：脚本里 `set -o pipefail`；临时排查看 PIPESTATUS。
- sed 的 BRE/ERE 转义混乱：统一 `sed -E`；捕获组 `()` 与引用 `\1`。
- uniq 前没有 sort：只合并相邻重复；`sort | uniq -c` 固定搭配。
- sort 默认按字符串：数字用 -n、人类大小用 -h、「10 < 9」的经典输出。
- xargs 处理文件名不加 -0：空格/换行文件名碎成多参数；`-print0 | xargs -0`。
- awk 字段引用 `$1` 误写 `$1` 与 `$NF` 的边界（列不存在时得到空串）：统计前 `NF` 校验。
- 复杂流水线不逐段调试：从左往右逐段追加，每段独立可验证。

## 9. 小结

- 三个流（0/1/2）+ Shell 接线：`> >> 2> 2>&1 <` 与 `/dev/null`；`2>&1` 的顺序语义；管道接进程、重定向接文件。
- pipefail 让退出码约定贯穿流水线；PIPESTATUS 逐环节排查。
- sed 是流编辑器：s 替换（-i 落盘、-i.bak 留后路）、d 删行、-n p 打印区间；-E 统一正则方言。
- awk 是「模式{动作}」的表处理小语言：字段（$1/$NF/-F）、条件、关联数组累积、BEGIN/END——单行统计程序的制造机。
- 标准件组合：`sort -n/-h/-k`、`uniq -c`（必先 sort）、cut/tr/wc、head/tail -f、`tee` 三通。
- xargs 把流变参数：`-print0 | xargs -0` 防空格陷阱、`-I{}` 占位、`-P` 并行。

## 10. 练习

**1.** 用三种方式把「stdout 与 stderr 都写入同一文件」写出来，其中一种故意写错顺序，解释输出为什么跑到了屏幕上。

> [!TIP]
> 思路`cmd > f 2>&1`（对）、`cmd &> f`（bash 简写）、`cmd 2>&1 > f`（错：2 接到当时的 1=屏幕）。再试验 `cmd 2>&1 | grep x`——管道场景里这个顺序反而是对的（2 也要进管道）。

**2.** 用 awk 重写 `grep ERROR | wc -l`，再扩展成「按错误模块分别计数」（模块是行内第 5 列），对比两种方案的扩展成本。

> [!TIP]
> 思路`awk '/ERROR/ {c[$5]++} END {for (m in c) print c[m], m}'`。grep+wc 只能回答总数，分维度统计立即要加 sort/uniq 链或换 awk——awk 的关联数组是「分桶统计」的原生工具。

**3.** 实现一个「配置文件清洗」：去掉注释行（# 开头）与空行，压缩连续空白，输出到新文件。用 sed 一条命令完成，再用 sed+tr 组合完成，对比可读性。

> [!TIP]
> 思路`sed -E '/^\s*#|^\s*$/d' f | tr -s ' '` 或纯 sed：`sed -E '/^#/d;/^$/d;s/ +/ /g'`。分段管道易调试，单命令易分发——组合哲学的两种呈现。

**4.** 写一条流水线：从 ps aux 找出内存占用（RSS）最高的 5 个进程，输出「进程名 内存MB」，并用 `-h` 验证单位排序的正确性。

> [!TIP]
> 思路`ps aux --sort=-rss | awk 'NR>1 {print $11, $6/1024 "MB"}' | head -5` 或 `ps aux | sort -k6 -rn | head`。注意 ps 自带 --sort 与 sort 外部命令的差异（内部排序避免解析单位）。

**5.** 用 xargs -P 写一个「并发探测」：对 servers.txt 里每台主机并行 8 路 ssh uptime，输出带主机名前缀。再对比串行版本的总耗时。

> [!TIP]
> 思路`xargs -I{} -P 8 sh -c 'echo "=== {}"; ssh {} uptime' < servers.txt`。-P 是单机批量任务的白嫖提速——8 路并行的 ssh 等待时间重叠，串行 40 秒的任务缩到 6 秒。

**6.** 讨论：grep/sed/awk 三者的边界在哪里？什么信号提示你「该跳出文本工具、写 Python 脚本了」？给出你的判断清单。

> [!TIP]
> 思路信号：需要跨行状态机（嵌套结构）、复杂条件组合（布尔逻辑爆炸）、错误处理与类型转换、超过 ~5 段的管道、需要复用与测试。文本工具的甜区是「单遍、逐行、无重逻辑」——一越界，Python 的可读性立刻反超。
