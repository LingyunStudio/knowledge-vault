---
title: Shell 脚本
order: 6
tags: 核心, bash, 脚本
summary: shebang、变量与引号的区别、条件循环函数退出码、set -euo pipefail。
---

Shell 脚本的定位很清楚：**胶水**。部署、定时任务、批处理、构建步骤——凡是"把几个命令按顺序跑一遍"的场景，30 行 bash 比 300 行 Python 更直接。它不需要优雅，需要的是正确和可预期。

## shebang 与执行方式

```bash
#!/usr/bin/env bash
# 首行叫 shebang：内核据此决定用哪个解释器执行本文件
# /usr/bin/env bash 比 /bin/bash 可移植——不依赖 bash 的绝对路径
```

```bash
chmod +x deploy.sh    # 赋予执行权限（见[权限与用户](04-permissions.md)）
./deploy.sh           # 按 shebang 用 bash 执行
bash deploy.sh        # 不需要 +x，显式指定解释器，调试时常用
bash -n deploy.sh     # 只做语法检查不执行，改完脚本先跑一遍
```

第一行的 `#` 不是注释——这是整个脚本里唯一的例外，其余 `#` 开头都是注释。

## 变量与引号

```bash
name=world            # 等号两边【不能有空格】——有空格会被当成两条命令
echo "hello $name"    # hello world：双引号内变量展开
echo "hello ${name}!" # 花括号定界变量名，拼接时更稳
echo 'hello $name'    # hello $name：单引号内完全不展开，所见即所得
```

| 写法 | 变量展开 | 空格会拆词 | 典型后果 |
| --- | --- | --- | --- |
| `"$var"` 双引号 | 是 | 否，保持整体 | ✅ 几乎永远是对的 |
| `'$var'` 单引号 | 否 | 否 | 用于字面量、正则 |
| `$var` 裸奔 | 是 | **是，按空白拆成多个参数** | ❌ 文件名带空格直接炸 |

不加引号是 bash 脚本 bug 的最大来源。规则就一条：**变量出现在参数位置就套双引号**——`"$f"` 永远不会比 `$f` 更错。

```bash
echo $0 $1 $2     # 脚本名、第 1、2 个参数
echo $#           # 参数个数
echo "$@"         # 所有参数（各自独立成串，遍历用这个）
echo $?           # 上一条命令的退出码
${PORT:-8080}     # PORT 未定义或为空时用默认值 8080
count=$((count + 1))   # 算术：$(()) 里不用加引号也不怕空格
read -p "确认部署到 prod？(y/N) " answer   # 交互式读入一行
```

## 条件与循环

```bash
if [[ -f "$file" ]]; then          # -f 是普通文件；-d 目录；-z 空串；-n 非空
    echo "exists"
elif [[ "$env" == "prod" ]]; then  # [[ ]] 是 bash 增强：不怕空格拆词，支持 && ||
    echo "production"
else
    echo "missing"
fi

for f in *.log; do                 # 通配符展开后逐个遍历
    echo "processing $f"
done

for i in {1..10}; do echo "$i"; done       # 数字序列
while read -r line; do                     # 逐行读输入的标准写法
    echo "line: $line"
done < input.txt
```

数字比较用 `-eq -ne -lt -le -gt -ge`（或 `(( count > 3 ))` 算术写法），字符串用 `==`、`!=`。`[ ]` 是老的 POSIX 写法，`[[ ]]` 是 bash 专属但处处更好——shebang 既然后面是 bash，就直接用 `[[ ]]`。

## 函数与退出码

```bash
log() {                            # 定义：函数名() { ... }
    echo "[$(date +%T)] $*" >&2    # 日志走 stderr，不污染管道输出
}

deploy() {
    local dir=$1                   # local 把变量限制在函数作用域内
    [[ -d "$dir" ]] || return 1    # return 值即函数的退出码
    build && upload
}

deploy ./app || { log "部署失败"; exit 1; }
```

退出码是 shell 世界唯一的通用错误协议：**0 成功，1-255 失败**。`&&` 左边成功才执行右边，`||` 反之。注意命令是否"失败"由它自己的退出码定义——`grep` 没匹配到也算失败（退出码 1），这个细节坑过所有人。

## set -euo pipefail：脚本的保险丝

正式脚本请在 shebang 后第二行写上这句：

```bash
set -euo pipefail
# -e          任何命令退出码非 0 就立即终止——别让错误被悄悄吞掉继续往下跑
# -u          引用未定义变量直接报错退出——防变量拼错演变成空参数
# -o pipefail 管道退出码取"第一个非 0"，而不是默认的"最后一个命令的退出码"
```

逐项说为什么缺一不可：没有 `-e`，`cd /nonexistent` 失败后脚本继续跑，后续命令全在错误目录里执行；没有 `-u`，`rm -rf "$TMPDIR/"` 在变量名打错时变成 `rm -rf /`——❌ 这是真实存在过的事故类型；没有 pipefail，`curl ... | grep ok` 里 curl 挂了但 grep 成功，脚本浑然不觉。

> [!WARNING]
> `-e` 有两个经典例外：`if cmd`、`cmd || true` 里的失败不会触发退出；反过来，`grep` 无匹配这类"正常失败"会直接杀掉脚本，需要时显式写 `grep ... || true`。

临时文件要善终，用 `trap` 兜底：`trap 'rm -f "$tmpfile"' EXIT`——无论正常结束还是中途报错，退出时都会执行清理。

## 一个完整的脚本骨架

把上面的元素拼起来，大多数运维脚本长这样：

```bash
#!/usr/bin/env bash
set -euo pipefail

log() { echo "[$(date +%T)] $*" >&2; }

target=${1:?用法: $0 <目标目录>}      # :? 缺参数时报错退出，比沉默跑错好得多
tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT          # 无论怎么退出都清理临时文件

log "开始备份 $target"
tar czf "$tmpfile" "$target"          # 失败会被 -e 拦下，不会带病运行
mv "$tmpfile" "/srv/backup/$(date +%F).tar.gz"
log "完成"
```

> [!TIP]
> `set -x` 打印每条实际执行的命令，相当于 bash 的调试器。写完丢给 shellcheck（CLI 或网页版）过一遍，能抓住九成初级错误——写 bash 不跑 shellcheck，等于写 Rust 不看编译器报错。

相关阅读：[管道与文本处理](05-pipes-text.md)
