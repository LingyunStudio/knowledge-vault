---
title: 管道与文本处理
order: 5
tags: 核心, 管道, grep
summary: 管道的组合哲学：grep/sed/awk/sort/uniq 文本处理实战。
---

Unix 哲学的全部秘密在一根竖线上：每个程序只做一件事，管道把它们的标准输入输出串起来，组合出没人预先设计的功能。学会管道思维，你就不再需要"找一个能直接干这事的工具"——手头的十几个小工具就是工具箱。

## 管道与重定向

```bash
ls | wc -l               # 左侧的 stdout 接到右侧的 stdin：数一数有多少项
ps aux | grep nginx      # 管道两侧是并发启动的独立进程，没有中间临时文件

cmd > out.txt            # stdout 写入文件（覆盖）
cmd >> out.txt           # 追加
cmd 2> err.txt           # stderr 单独收集
cmd > all.txt 2>&1       # stderr 也并入（2>&1：让 2 号流指向 1 号流当前指向处）
cmd | tee log.txt        # 一份继续进管道，一份落盘——调试长管道必备
cmd 2>&1 | grep error    # 想让 stderr 也进管道：先 2>&1 再接竖线
```

要点：**管道只传 stdout，不传 stderr**——所以报错信息不会被下游误吞。这个特性决定了"过滤错误"和"过滤数据"要用不同手段。

grep 是管道里出场率最高的过滤件：

```bash
ps aux | grep nginx | grep -v grep    # 捞 nginx 进程，排除 grep 自己
journalctl -u app | grep -i error     # 服务日志里找错误
grep -v '^#' /etc/ssh/sshd_config | grep -v '^$'   # 去掉注释和空行，看有效配置
```

> [!TIP]
> `命令 | less` 是万能查看器：任何输出太长都先过 less，`/` 搜索、`q` 退出。`history | grep ssh` 找回上周敲过的命令，也是同一招。

## sed：按行流式编辑

```bash
sed 's/http:/https:/' urls.txt       # 每行替换第一处（输出到屏幕，原文件不动）
sed 's/http:/https:/g' urls.txt      # g = 全局替换整行的所有处
sed -i 's/8080/9090/' app.conf       # -i 就地写回文件（改前先跑一遍不带 -i 预览！）
sed -n '5,10p' app.log               # 只打印 5-10 行（-n 关默认输出，p 是打印）
sed '/^$/d' config                   # 删除空行（d = 删除）
sed -e 's/^#//' -e 's/ *$//' config  # -e 叠加多个表达式，按顺序执行
```

`-i` 直接改文件，跑错不可逆——老手的肌肉记忆是**先去掉 -i 看输出，确认无误再加回 -i**。`s/old/new/` 的分隔符可以换：`sed 's|/usr/bin|/usr/local/bin|g'`，处理路径时免得满屏转义。

## awk：按列取数

日志、`ls -l`、`ps` 这类输出天然按列排布，awk 默认按空白切列：

```bash
ls -l | awk '{print $9}'             # 第 9 列：文件名
awk -F: '{print $1}' /etc/passwd     # -F 指定分隔符为冒号，取第 1 列用户名
ps aux | awk '{print $2, $11}'       # PID 和命令名
df -h | awk 'NR>1 {print $5, $6}'    # NR 是行号：跳过表头，取使用率和挂载点
awk '{sum+=$1} END {print sum}'      # END 块在读完所有行后执行：求和
```

`$1`、`$2` 是第几列，`$NF` 是最后一列，`NF` 是当前行的列数，`NR` 是当前行号。awk 还能带条件过滤和格式化输出：

```bash
awk '$3 > 100 {print $1}' access.log              # 第 3 列大于 100 才输出第 1 列
awk -F: '{printf "%-12s %s\n", $1, $7}' /etc/passwd   # printf 左对齐 12 格输出
```

awk 其实是门完整语言（有 if/for/数组），但 90% 的用法就是上面这几行。

## cut / tr：轻量的小刀

```bash
cut -d: -f1 /etc/passwd      # 按冒号切，取第 1 列——单列场景比 awk 短
cut -c1-10 access.log        # 按字符位置截取第 1-10 列
tr 'a-z' 'A-Z' < names.txt   # 小写转大写（tr 只读 stdin）
tr -d '\r' < win.txt > unix.txt   # 删掉 Windows 换行符的 \r——处理 CRLF 文件的经典用法
```

`tr -d '\r'` 值得单独记住：Windows 下编辑过的脚本拷到 Linux 报 `\r: command not found`，就是它在作怪。

## sort / uniq / wc：统计三件套

```bash
wc -l app.log                # 数行数
head -n 20 big.txt           # 看前 20 行
tail -n 50 big.txt           # 看后 50 行；-f 持续跟踪新增
sort names.txt               # 默认字典序——1 会排在 10 后面！
sort -n nums.txt             # -n 按数值排
sort -h sizes.txt            # -h 认识 1K/2M/3G 这类人类单位
sort -u names.txt            # 排序 + 去重
sort -t: -k3 -n /etc/passwd  # -t 指定分隔符，-k 按第 3 列（UID）数值排序

sort ips.txt | uniq -c | sort -rn    # 经典三连：排序 → 聚合计数 → 按次数倒序
```

`uniq` **只合并相邻的重复行**，所以永远先 `sort` 再 `uniq`——这是新手最常见的翻车点。`sort ips.txt | uniq -c | sort -rn | head` 就是"统计访问量最高的来源 IP"的完整实现，一行顶一个小脚本。

## 实战：一条管道顶一段程序

```bash
# 访问日志里出现最多的 10 个 IP
awk '{print $1}' access.log | sort | uniq -c | sort -rn | head

# 统计当前目录 Rust 代码的非空行数
find . -name "*.rs" | xargs cat | grep -cv '^\s*$'

# 对比两份名单（先各自排序再 diff）
diff <(sort a.txt) <(sort b.txt)

# 统计你最常用的 10 条命令
history | awk '{print $2}' | sort | uniq -c | sort -rn | head

# access.log 里各种 HTTP 状态码的分布
awk '{print $9}' access.log | sort | uniq -c | sort -rn
```

拆开读，每一段都简单到无聊；串起来，就是一次数据分析。`diff <(cmd1) <(cmd2)` 这种写法叫进程替换——把命令的输出当作临时文件喂给需要文件参数的程序，bash 特有但极好用。

> [!NOTE]
> `xargs` 值得单独记住：它把 stdin 的内容变成**命令的参数**。很多命令（如 rm）不读 stdin，必须由 xargs 转交：`find ... -name '*.log' | xargs rm`；`xargs -I{}` 把参数插到指定位置：`cat urls.txt | xargs -I{} curl -sO {}`；GNU 版还有 `-P 8` 并行执行，批量 curl/压缩时提速明显。文件名可能带空格时用 `find -print0 | xargs -0`。

> [!WARNING]
> 管道末端接 `rm`/`mv` 这类破坏性命令时，先跑一遍去掉执行段的部分预览清单。`find $PATH | xargs rm` 在路径变量写错时就是批量删除——管道的威力在哪，危险就在哪。

相关阅读：[Shell 脚本](06-shell-scripting.md)
