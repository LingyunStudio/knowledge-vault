---
title: 文件操作
order: 3
tags: 核心, cp, find
summary: ls/cp/mv/rm 的安全用法、find 与 grep 定位文件和内容、通配符。
---

文件操作占日常命令行的六成以上，也是事故高发区——`rm` 不进回收站，通配符展开错了就是灾难。这一篇的纪律只有一条：**动手前先看清会作用到什么**。

## ls：先看清楚再动手

```bash
ls           # 列出文件名
ls -l        # 长格式：权限、硬链接数、属主 属组、大小、修改时间、名字
ls -a        # 含隐藏文件（以 . 开头的，如 .bashrc）
ls -h        # 配合 -l：大小显示成 K/M/G 而不是字节数
ls -lt       # 按修改时间倒序，最新在上
ls -lS       # 按大小排序
ls -d */     # 只列目录
ls -lah /var/log   # 选项合并，参数照给
```

`ls -l` 一行输出从左到右：权限（见[权限与用户](04-permissions.md)）、硬链接数、属主、属组、字节数、修改时间、文件名。Linux 不靠扩展名判断文件类型，`file mystery.dat` 会告诉你它到底是什么（文本、ELF 可执行、压缩包……）。

## 创建与查看

```bash
mkdir -p a/b/c       # 建多级目录（-p：父目录一并创建，已存在也不报错）
touch draft.md       # 创建空文件（对已存在的文件则是更新时间戳）
cat config.yml       # 整个输出到屏幕——小文件专用
less app.log         # 大文件分页看：/ 搜索、q 退出，几个 G 的日志也是秒开
head -n 20 app.log   # 看前 20 行
tail -n 50 app.log   # 看后 50 行
tail -f app.log      # 持续跟踪文件新增内容，盯日志的标准姿势
```

`tail -f` 配合 Ctrl+C 退出，是排查线上问题的日常动作。日志会轮转（app.log 变成 app.log.1）的场景用大写的 `tail -F`，它能跟上文件的改名与重建。

## cp / mv：复制与移动（改名）

```bash
cp a.txt b.txt               # 复制
cp a.txt /tmp/               # 复制到目录
cp -r src/ dst/              # 复制目录必须 -r（recursive）
cp -i a.txt b.txt            # 目标已存在时先询问
cp -p a.txt b.txt            # 保留权限和时间戳，备份场景常用
mv old.txt new.txt           # 改名和移动是同一个命令
mv old.txt /tmp/             # 移动
mv -i old.txt /tmp/          # 覆盖前询问
```

`mv` 跨文件系统时自动"复制 + 删除"，大目录会慢；同分区内则是瞬间的改名操作。`cp`/`mv` 默认覆盖不询问——目标已存在时它不会提醒你。

> [!WARNING]
> `cp -r src/ dst/`：dst 不存在时，src 的**内容**被复制进新建的 dst；dst 已存在时，结果变成 `dst/src/...`，多套了一层。复制前想清楚目标和斜杠的含义，不确定就先 `ls` 目标位置。

## rm：没有后悔药

```bash
rm file.txt          # 删除单个文件
rm -r dir/           # 删目录及内容（-r 必须，否则拒绝删目录）
rm -i *.log          # 逐个确认——批量删除时的保命写法
rmdir empty_dir/     # 只能删空目录，安全性最高的删目录方式

# ❌ rm -rf 是最高危组合：递归 + 不询问，路径写错（多空格、变量为空）就是事故
# ❌ rm -rf $TARGET —— TARGET 未定义时等价于 rm -rf（删当前目录的通配展开），
#    这是真实事故的经典来源：变量名拼错、脚本没写 set -u
# ❌ 永远不要对 / 下不确定的路径加 -f
```

防御习惯：删除前用**同样的通配符**跑 `ls` 预览一遍（`ls *.log` 确认 → `rm *.log`）；变量路径加引号并在脚本里 `set -u` 防未定义（见[Shell 脚本](06-shell-scripting.md)）；真怕手抖就把 `rm` alias 成 `rm -i`，但别依赖它——习惯才是护城河。

## 通配符：shell 替你展开

关键认知：**通配符不是命令的功能，是 shell 在敲回车前就展开的**。`rm *.log` 实际执行的是 `rm a.log b.log c.log`，命令自己看到的已经是文件名列表。

| 模式 | 匹配 |
| --- | --- |
| `*` | 任意长度的任意字符（不含以 `.` 开头的隐藏文件） |
| `?` | 恰好一个字符 |
| `[abc]` | a、b、c 之一 |
| `[a-z]` | a 到 z 范围内之一 |
| `{jpg,png}` | 花括号展开：两者之一（shell 的另一套机制） |

```bash
ls *.py              # 预览所有 py 文件——删除前的标准动作
rm report_202?.pdf   # 删 2020-2029 年的年报（? 占一个字符）
mv *.{jpg,png} img/  # 花括号展开后等价于 mv *.jpg *.png img/
```

文件名带空格是经典坑：`rm my file.txt` 是删两个文件。好习惯是给名字加引号，用 `Tab` 补全让它替你处理转义。

## find：按条件找文件

`find` 从指定路径递归搜索，条件可以叠加：

```bash
find . -name "*.conf"            # 按名字（区分大小写）
find . -iname "readme*"          # 名字忽略大小写
find /etc -type f                # 只要文件（-type d 只要目录）
find . -size +100M               # 大于 100MB 的文件
find /var/log -mtime -7          # 7 天内修改过（+7 是 7 天前，-7 是 7 天内）
find . -mmin -30                 # 最近 30 分钟内修改过
find . -user alice               # 属主是 alice
find . \( -name "*.jpg" -o -name "*.png" \)   # 或条件，括号要转义
find . -name "*.tmp" -delete     # 找到即删（先去掉 -delete 预览！）
find . -name "*.log" -exec gzip {} \;   # 对每个结果执行 gzip
```

`-exec ... {} \;` 里 `{}` 代表找到的每个文件路径；`\;` 每个文件起一次进程，`+` 攒一批调用，后者快得多。要往管道外送时用 `-print0 | xargs -0`，文件名带空格也不会断。

> [!TIP]
> 日常就四招：`-name` 找名字、`-size` 找大文件、`-mtime` 找最近改动、`-exec` 批量处理。条件从上到下短路，把最便宜的条件（如 `-name`）放前面能明显提速。

## grep：按内容找文件

```bash
grep "error" app.log            # 在单个文件里搜
grep -rn "deprecated" src/      # 递归搜索目录并显示行号——最常用的组合
grep -i "warning" a.log         # 忽略大小写
grep -v "^#" config             # 反向匹配：排除注释行
grep -c "404" access.log        # 只数命中了多少行
grep -l "password" *.py         # 只列出包含该内容的文件名
grep -A3 -B1 "panic" app.log    # 命中行后 3 行、前 1 行（-C2 是上下各 2 行）
grep -E "^\d+$" nums.txt        # 扩展正则
grep -o "http://[^ ]*" a.log    # 只输出匹配片段本身，不输出整行
grep -rn --include="*.py" "password" src/   # 递归但只搜指定后缀
```

模式里有空格必须加引号；`^` 锚定行首、`$` 锚定行尾，日志分析天天用。顺带认识 ripgrep（命令名 `rg`）：默认递归、自动忽略 `.gitignore` 里的文件、速度快一个量级，`apt install ripgrep` 装上不亏。

grep 只解决"找"，加工交给管道——见[管道与文本处理](05-pipes-text.md)。

相关阅读：[文件系统与目录结构](02-file-system.md)
