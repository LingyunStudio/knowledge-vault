---
title: Shell 脚本：从命令到程序
order: 6
tags: bash, 变量展开, 条件, 循环, set -euo pipefail
summary: 变量的赋值与四类展开（默认值/防空/去尾/子串）、"$@" 与引号的精确规则、[ ] 与 [[ ]] 的差异、while read 逐行标准形态、函数与 local、set -euo pipefail 安全模式与 trap 清理，以及 shellcheck 作为脚本的静态检查器。
---

Shell 脚本是命令的复用形态：把「你在终端敲的一串」固化成文件。但 Shell 同时是一门**充满历史包袱的语言**——空格语义、词分割、隐式全局变量。写 Shell 脚本的正道不是多写，而是**用一套防御性的子集写**：`set -euo pipefail`、一切引用加引号、shellcheck 把关。本篇按「机制 → 防御子集」组织。

## 1. 脚本骨架与退出码

```bash
#!/usr/bin/env bash          # shebang：用哪个解释器执行（env 版可移植性更好）
set -euo pipefail            # 安全模式（第 7 节）

main() {
    local src="$1"
    cp -a "$src" "/backup/$(basename "$src")"
}

main "$@"
```

```bash
chmod +x deploy.sh && ./deploy.sh     # 方式①：shebang 决定解释器
bash deploy.sh                        # 方式②：显式解释器（shebang 被忽略）
```

退出码是脚本的「返回值」：`exit 0` 成功、`exit 1` 失败、`$?` 读上一条命令的退出码。脚本的退出码默认是**最后一条命令**的——所以「半路失败但结尾 echo 成功」的脚本会骗过调用方，这正是安全模式的第一个价值。

## 2. 变量与展开：Shell 的核心机制

### 2.1 赋值与引用

```bash
name="world"          # 等号两侧不能有空格！（= 是赋值还是命令的分歧点）
echo "hello $name"    # 双引号：展开变量
echo 'hello $name'    # 单引号：字面输出（不展开）
echo "hello ${name}s" # 花括号：消除边界歧义（防止解析成 $names）
```

**「一切展开加双引号」是 Shell 的第一铁律**。不加引号的 `$var` 会经历「词分割 + 通配展开」两步：含空格的路径 `$f` 碎成多个参数、含 `*` 的字符串撞上文件名。唯一可以裸写 `$var` 的场景：确定它是不含空白的简单值——但判断成本高于永远写引号，所以规矩是永远写。

### 2.2 命令替换与四类展开

```bash
today=$(date +%F)          # $() 命令替换（可嵌套；反引号 `` 是过时写法）
files=$(ls *.log)

${var:-default}            # var 未设或为空 → 用 default（不改变 var）
${var:=default}            # 同上，且把 default 赋回 var
${var:?错误消息}            # var 空/未设 → 报错退出（rm 的防空保护，[第 3 篇](03-file-ops.md)）
${var:+other}              # var 有值时展开为 other

f="data.tar.gz"
${f%.gz}                   # 去尾部匹配（.gz）→ data.tar —— 改扩展名的标准写法
${f#data.}                 # 去头部匹配 → tar.gz
${f%.*}                    # 去最后一个 . 及之后 → data.tar
${f##*.}                   # 贪婪去头部 → gz（取扩展名）
${f:0:4}                   # 子串 data
```

`${var:?}` 与 `${var%.*}` 这类展开让大量「检查变量 + 字符串处理」不需要 if——它们是 Shell 里最值得记住的十几个字符。

## 3. 特殊变量：参数的读取协议

```bash
./script.sh alice bob

$0        # 脚本名
$1 $2 ...  # 位置参数（第 9 个起 ${10}）
$#        # 参数个数
"$@"      # ★ 全部参数（各自独立的引号词）—— 转发的唯一正确形态
"$*"      # 全部参数合成一个字符串（少用）
$?        # 上一条命令退出码
$$        # 当前 PID
```

`"$@"` 值得单独强调：它是「**原样转发任意参数**」的唯一正确写法（含空格/空参数都保真）——包装脚本（wrapper）的标配：

```bash
#!/usr/bin/env bash
# 前置一些检查，然后原样转发
exec /opt/real-tool "$@"
```

## 4. 条件：[ ]、[[ ]] 与 case

```bash
# test 的括号语法：空格是语法的一部分（[ 是命令！）
if [ "$count" -eq 0 ]; then ... fi
if [ -f "$file" ] && [ -d "$dir" ]; then ... fi

# bash 双括号：更现代（支持 &&、||、正则、不需要引号防分割）
if [[ "$file" == *.log ]]; then ... fi
if [[ "$input" =~ ^[0-9]+$ ]]; then echo "数字"; fi

# case：多分支匹配（通配符语义，与 switch 不同）
case "$1" in
  start)  start_service ;;
  stop)   stop_service ;;
  *)      echo "usage: $0 {start|stop}" >&2; exit 1 ;;
esac
```

| 判断       | 写法             | 判断       | 写法      |
| ---------- | ---------------- | ---------- | --------- |
| 数值相等   | `[ $a -eq $b ]`  | 字符串相等 | `[ "$a" = "$b" ]` |
| 文件存在   | `-e`             | 是普通文件 | `-f`      |
| 是目录     | `-d`             | 可执行     | `-x`      |
| 空串       | `-z "$s"`        | 非空       | `-n "$s"` |

两套括号的选型：**写 bash 就用 `[[ ]]`**（正则匹配、&& 直用、变量不加引号也不分割），`[ ]` 留给必须 POSIX 兼容的 sh 脚本。错误消息走 stderr（`>&2`）——那是它与 stdout 分流的意义（[第 5 篇](05-pipes-text.md)）。

## 5. 循环与逐行读取

```bash
# for：遍历列表（Shell 展开 or 命令替换）
for f in *.log; do
    gzip "$f"
done

for i in {1..10}; do echo "$i"; done           # 数字范围
for i in $(seq 1 3 10); do echo "$i"; done     # 步长

# while read：逐行读取文件的唯一安全形态（空格/特殊字符免疫）
while IFS= read -r line; do
    process "$line"
done < input.txt
# IFS= 防首尾空白被吞；-r 防反斜杠被转义 —— 两个修饰符都有明确理由

# 无限循环 + 管道逐行
tail -f app.log | while read -r line; do alert_if "$line"; done
```

「for line in $(cat file)」是经典反模式——命令替换的输出会被词分割（空格行碎裂）。**逐行处理只有 while read 形态**。

## 6. 函数与状态

```bash
log() {
    local level="$1"; shift        # local：局部变量（不写则污染全局！）
    printf '[%s] %s\n' "$level" "$*" >&2
}

log INFO "deploying"

backup() {
    tar -czf "$1.tar.gz" "$1"
    return 0                       # return = 函数的退出码（不是返回值！）
}

result=$(backup data)              # 「返回值」要靠 stdout 捕获 —— Shell 函数的两种出口
```

Shell 函数没有「返回值」概念：**return 是退出码（成功/失败信号），数据通过 stdout 传递**（调用方 `$(func)` 捕获）。想两者兼得：数据走 stdout、状态走 stderr + 退出码——函数设计与命令设计是同一套协议（这正是 Shell 的一致性）。

`local` 不是可选项：Shell 变量默认全局，函数里的临时变量不 local 就是给整个脚本埋雷（循环变量覆盖调用方状态）。

## 7. 安全模式：set -euo pipefail 与 trap

```bash
set -e      # errexit：任何命令失败（非 0）立即退出脚本
set -u      # nounset：使用未定义变量 = 错误（防空展开事故）
set -o pipefail  # 管道任一环节失败 = 整体失败（防中途失败被掩盖）
set -x      # xtrace：打印每条执行的命令（调试开关）

trap 'rm -rf "$TMP_DIR"' EXIT      # 退出时清理：无论正常结束/出错/被杀
trap 'echo interrupted; exit 1' INT SIGTERM
```

三个开关各堵一类事故：`-e` 堵「失败被忽略」（默认 Shell 会带着错误继续跑！）、`-u` 堵「空变量炸场」（`rm -rf $VAR/`）、`pipefail` 堵「管道中途失败被最后一个命令的成功掩盖」。trap 保证「临时目录/锁文件/后台进程」的清理不依赖记忆——脚本版的 RAII/finally。

注意事项：`-e` 有著名的豁免集（if 条件中的命令、`&&`/`||` 链中的非末位命令不会触发退出）——理解它但别依赖它，关键检查显式写 `|| exit 1`。

## 8. shellcheck：脚本的静态检查器

```bash
shellcheck deploy.sh
```

shellcheck（静态分析）能抓的正是本章所有陷阱：未引用的展开、无 local、`[ ]` 误用、无效的词分割、shebang 缺失——每条带解释与修复建议。**所有 Shell 脚本（哪怕 10 行）都过一遍 shellcheck** 应该是硬纪律，CI 集成与 pre-commit 钩子皆可（与 Git 篇[第 9 篇](../git/09-hooks-automation.md)的防线分层同构）。

## 9. 陷阱清单

- 裸 `$var`：词分割 + 通配展开；一切展开加双引号。
- `[ ]` 内忘空格（`[$a = $b]`）：`[` 是命令，空格是参数分隔。
- `for line in $(cat f)`：词分割碎行；while IFS= read -r。
- 函数内不 local：变量泄漏全局，循环间互相污染。
- 默认不带 set -e：中间失败静默继续；`set -euo pipefail` 是脚本头部的标配三连。
- `$(cmd)` 的退出码被忽略：命令替换失败不自动传播（配合 -e 检查或显式处理）。
- 用反引号嵌套：`$()` 可读且可嵌套。
- return 与「返回值」混淆：退出码走 return，数据走 stdout。
- 不跑 shellcheck：所有本章陷阱它都能抓。

## 10. 小结

- 脚本 = shebang + 安全模式 + main 函数 + `main "$@"` 的骨架；退出码是脚本与世界的接口。
- 展开机制是核心：`:-`/`:?`/`%`/`#` 四类花括号展开覆盖默认值、防空、去头尾；`"$@"` 是参数转发的唯一正确形态。
- 条件用 `[[ ]]`（正则、&&、免分割陷阱），case 用通配语义；逐行读取只有 `while IFS= read -r`。
- 函数的出口协议：return 退出码、stdout 传数据、local 隔离状态——与外部命令的协议完全一致。
- `set -euo pipefail` + trap 构成脚本的「安全带与安全气囊」：错误即停、防空、管道透明、退出清理。
- shellcheck 是脚本的 mypy：每个脚本提交前必过。

## 11. 练习

**1.** 写一个 `backup.sh <目录>`：校验参数（缺失则用法提示 + 退出码 1）、用 `${src%/}` 去尾斜杠、tar 归档到带日期的文件名、失败即停（安全模式）、trap 清理临时文件。

> [!TIP]
> 思路骨架：`set -euo pipefail` + 参数检查 `[ $# -eq 1 ] || { usage; exit 1; }` + `mktemp -d` 做临时区 + `trap 'rm -rf "$tmp"' EXIT`。这个 15 行脚本覆盖本章全部要点。

**2.** 解释三段代码的行为差异（涉及引号、词分割、通配展开）：

```bash
A: for f in $FILES; do ...
B: for f in "$FILES"; do ...
C: for f in "$@"; do ...
```

> [!TIP]
> 思路A：FILES 展开后词分割+通格展开（空格列表的惯用但危险写法）；B：整个变量是一个词（通常不是想要的）；C：逐参数保真。`"$@"` 的展开是 bash 里唯一「列表语义」的例外。

**3.** 把[第 5 篇](05-pipes-text.md)的日志分析流水线封装成 `top404.sh <日志> [天数]`：参数默认值用 `${2:-1}`、日期计算、错误路径走 stderr、shellcheck 零告警。

> [!TIP]
> 思路`days=${2:-1}`、`date -d "$days days ago" +%d/%b/%Y`；`if [[ ! -f $log ]]` 前置校验。把「能跑的流水线」变「可交付的脚本」的距离就是本章的全部内容。

**4.** 实验 set -euo pipefail 的三类拦截：写一个中途失败的脚本（无 -e 版 vs 有 -e 版）、未定义变量版、管道中途失败版，逐个观察退出码与输出差异。

> [!TIP]
> 思路`grep 不存在的串 | wc -l` 无 pipefail 时退出码 0（wc 成功）——「失败被吞」的活案例。三个实验做完，安全模式的三行不再是仪式而是保命符。

**5.** 用 trap 实现「锁文件防重入」：脚本启动时建锁文件（存在则报错退出）、退出（含被杀）时清理锁。测试 kill -9 与正常退出两条路径。

> [!TIP]
> 思路`lock=/var/run/myjob.lock; [[ -e $lock ]] && exit 1; touch $lock; trap 'rm -f $lock' EXIT`。注意 kill -9 无法被 trap——锁残留需要「启动时检测陈锁」（pid 存活性检查）的进阶处理，这也是所有任务调度器的必修课。

**6.** 讨论：什么任务该写 Shell 脚本、什么该写 Python？从「行数、条件复杂度、数据结构需求、可移植性要求」四维度给出决策线，并各举一个你写错边的例子。

> [!TIP]
> 思路Shell 甜区：<50 行、串联命令、系统交互（进程/文件/管道）；越界信号：字典/列表结构、复杂字符串处理、异常处理、>100 行。经典错边：用 bash 解析 JSON（应 Python+json）或用 Python 包装两条 cp（应直接 shell）。
