---
title: 文件操作与查找：通配符、find 与打包
order: 3
tags: cp, mv, rm, find, tar, 通配符
summary: Shell 通配符展开的时机陷阱、cp/mv/rm 的危险参数与安全习惯、find 的完整过滤语法与 -exec 两种结尾、grep 基础、tar 打包与压缩格式的选型，以及空格文件名对一切工具的考验。
---

文件操作的命令朴素（cp/mv/rm），但事故也集中在这里——`rm -rf` 的传说每年都在更新。本篇把操作类命令的**危险面**与**查找类命令的完整语法**讲清，核心是两个机制：**通配符由 Shell 展开**（不理解这点，引号就用不对）与 **find 是遍历引擎**（理解结构，所有参数不用背）。

## 1. ls 与查看

```bash
ls -lh            # 长格式 + 人类可读大小（K/M/G）
ls -la            # 含隐藏文件（点开头）
ls -lt            # 按修改时间（-tr 反序：最旧在前）
ls -lS            # 按大小排序
ls -ld /var/log   # 看目录本身的属性（不加 -d 会列出内容）
```

`-h`（human readable）应该成为肌肉记忆——`ls -l` 输出的字节数没有意义，人需要的是 `4.0K` 与 `2.3G` 的差别。

## 2. cp / mv / rm：危险面的管理

```bash
cp -a src/ dst/       # ★ 归档复制：保留权限/时间戳/属主/递归 —— 备份场景的默认
cp -r src/ dst/       # 递归复制（不保属性）
cp -i file /dst/      # 覆盖前询问（交互习惯）

mv old new            # 同盘改名（瞬时）；跨盘 = 复制+删除（[第 2 篇](02-filesystem.md)）
mv -i a b             # 覆盖询问

rm file               # 删除
rm -rf dir/           # ★★ 递归 + 无询问 + 强制 —— 全宇宙最危险的组合
```

### 2.1 rm 的安全习惯

rm 没有回收站。防御不靠「小心」，靠习惯工程化：

```bash
# ① 用通配符前先 echo 预演 —— 看清展开结果再删
echo rm -rf ./build/*.o
rm -rf ./build/*.o

# ② 交互模式进高危目录
rm -ri dir/

# ③ 大目录删除用「先移走再删」的两步法
mv to-delete/ /tmp/to-delete.$$ && rm -rf /tmp/to-delete.$$
# （真删错了 /tmp 里还有一会儿 —— 给自己留缓冲）

# ④ 路径必须显式：绝不 rm -rf $SOMETHING/*
echo "rm -rf $VAR" 的教训：VAR 为空时变成 rm -rf /* 
# 防御：rm -rf "${VAR:?}/" —— bash 的 :? 让空变量直接报错
```

最后一条值得背下来：**变量可能为空的 rm 命令，永远用 `${VAR:?}` 保护**——变量未设置时 bash 拒绝执行而不是展开成 `/`。

## 3. 通配符：Shell 的事，不是命令的

```bash
ls *.log            # Shell 把 *.log 展开成文件列表，再交给 ls
cp *.txt /backup/   # 展开后等价于 cp a.txt b.txt c.txt /backup/
echo *.log          # echo 暴露真相：看到的就是 Shell 交给命令的东西
```

三个必须理解的机制：

1. **展开发生在命令运行前**：如果目录里没有 .log 文件，`ls *.log` 传给 ls 的就是字面字符串 `*.log`（bash 默认如此，报 No such file）。「引号忘写」的事故来源。
2. **引号 = 关闭展开**：`ls "*.log"` 找的是名为 `*.log` 的文件。含空格的文件名必须引号：`cp "my file.txt" /tmp/`。
3. **rm 与通配符**：`rm *` 在有几千文件的目录里可能超出参数长度上限（`Argument list too long`）——此时用 find（第 4 节）或 `echo * | xargs rm`。

| 通配符   | 含义                       | 例子                        |
| -------- | -------------------------- | --------------------------- |
| `*`      | 任意长度任意字符（不含 /）   | `*.py`、`report*`           |
| `?`      | 恰好一个字符                | `file?.txt`                 |
| `[abc]`  | 字符集中的一个              | `file[12].log`              |
| `[a-z]`  | 范围                        | `chapter[1-3].md`           |
| `{a,b}`  | 花括号展开（组合，非匹配）   | `cp file.{txt,md} /dst/`    |

## 4. find：遍历引擎

find 的心智模型：**「在目录树里递归行走，每一站做一次测试，通过则执行动作」**——参数全是「测试」与「动作」的组合：

```bash
find /var/log -name "*.log"              # 按名字（通配符要引号，防止 Shell 抢先展开）
find . -type f -size +100M               # 类型 + 大小（大文件狩猎）
find . -mtime -7                         # 7 天内修改过（+7 是 7 天前，-7 是最近 7 天）
find . -user alice -perm -u+x            # 属主 + 带执行位
find . -name "*.tmp" -not -path "./build/*"   # 排除路径
```

动作（默认是 -print 打印路径）：

```bash
find . -name "*.tmp" -delete                       # 直接删除（比 -exec rm 快）
find . -name "*.sh" -exec chmod +x {} \;           # 每个文件起一个进程
find . -name "*.sh" -exec chmod +x {} +            # ★ 尽量批量传给一个进程（高效形态）
find . -type f -exec grep -l "TODO" {} +           # find + grep 的组合
```

`{} \;` 与 `{} +` 的区别是进程数：前者每个文件一个进程（几千文件几千进程），后者把尽量多的文件名塞进一次调用——大规模操作选 `+`。

`-exec` 里的分号对 Shell 有意义，要转义（`\;` 或引号 `';'`）——这是「谁展开谁」的又一次现身。

**locate** 是另一条路线（数据库索引查找，快但依赖 `updatedb` 定时更新，新文件查不到）：find 是真遍历（慢但实时、过滤强），locate 是索引查询（快但可能陈旧）。

## 5. grep：文本搜索的门面

```bash
grep "error" app.log               # 基本搜索
grep -i -n "error" app.log         # 忽略大小写 + 显示行号
grep -r "TODO" src/                # 递归搜目录（程序员日常）
grep -v "DEBUG" app.log            # 反选：排除行
grep -c "error" app.log            # 计数
grep -E "error|fatal" app.log      # 扩展正则（egrep 的等价）
grep -l "pattern" *.conf           # 只列文件名
grep -A2 -B1 "panic" app.log       # 匹配行 + 后 2 行 + 前 1 行（上下文）
```

正则的详细功力（分组、引用、替换）与 sed/awk 一起放在[第 5 篇](05-pipes-text.md)；这里先建立 grep 的定位：**管道流水线里的「过滤阀」**——上游字节流进来，留下匹配的行。

## 6. tar：打包与压缩的两层概念

**打包（归档）与压缩是两件事**：tar 把多文件合成一个流（保持权限/目录结构），gzip/xz 等把单个流压小。「tar.gz」= 先 tar 后 gzip。

```bash
tar -czf backup.tar.gz dir/        # c=create z=gzip f=文件（打包+压缩）
tar -tzf backup.tar.gz             # t=列出内容（解压前先看！）
tar -xzf backup.tar.gz             # x=解压
tar -xzf backup.tar.gz -C /opt     # 解到指定目录

tar -caf backup.tar.xz dir/        # a=按后缀自动选压缩算法
```

| 格式      | 压缩率 | 速度 | 典型场景           |
| --------- | ------ | ---- | ------------------ |
| `.gz`     | 中     | 快   | 日常、日志轮转      |
| `.xz`     | 高     | 慢   | 发布归档、长期存储  |
| `.zst`    | 高     | 极快 | 现代发行版包、新项目 |
| `.zip`    | 中     | 中   | 跨 Windows 交换     |

习惯 `tar -tzf`（先看再解）防「解压炸一地文件」（没包顶层目录的 tar 直接散在当前目录）。解压永远先 `-t` 预览或解到新目录。

## 7. 陷阱清单

- rm 变量为空：`rm -rf $VAR/*` 变 `rm -rf /*`；用 `${VAR:?}` 防空。
- 通配符不匹配时字面传递：`ls *.log` 无匹配报错；写循环处理前先确认匹配非空。
- 空格文件名裸传：`cp my file.txt` 是两个参数；一律引号，脚本用数组或 `-print0`/`xargs -0`。
- `find -exec {} \;` 批量场景：每文件一进程；换 `{} +`。
- `rm -rf /` 级事故的另一个入口：`rm -rf ./` 在错误 cwd 执行——操作前 `pwd` 确认，习惯用显式相对/绝对路径。
- tar 解压炸一地：先 `tar -t` 预览。
- cp 不保属性丢权限/时间戳：备份用 `cp -a`；配 rsync 更好（增量）。
- 把 grep 的正则与通配符混淆：`*.log` 是 Shell 语法，`.*\.log` 才是正则——两套语法永远别混写。

## 8. 小结

- ls 的参数是「观察维度」（大小/时间/类型）；cp -a 是备份级复制；mv 同盘瞬时跨盘复制。
- rm 的安全靠工程习惯：echo 预演、`${VAR:?}` 防空变量、两步删除法；rm 没有回收站。
- 通配符由 Shell 展开（引号关闭展开）——「谁展开」的时机决定了引号、空格文件名、Argument list too long 的全部行为。
- find 是遍历引擎：测试（-name/-type/-size/-mtime）+ 动作（-print/-delete/-exec）；`{} +` 优于 `{} \;`；locate 是索引路线。
- grep 是管道过滤阀：-r 递归、-v 反选、-A/-B 上下文。
- tar 管归档、压缩器管压缩；`tar -t` 先预览；xz 高比慢、zst 快比高。

## 9. 练习

**1.** 验证「通配符是 Shell 展开」：`echo *.py`、`ls *.py`、`echo "*.py"` 三者的输出差异，并用一个不存在的模式观察报错来源。

> [!TIP]
> 思路echo 暴露展开结果；引号内不展开。再实验 `echo .[!.]*`（隐藏文件的正确通配）——`*` 不匹配点开头的文件是 Shell 的既定约定。

**2.** 用 find 完成一次「清理任务」：找出 30 天前的 .log 文件、列出总大小（`-exec du -ch {} +`）、预览后删除。每一步先打印确认。

> [!TIP]
> 思路三步：`find . -name "*.log" -mtime +30 | wc -l`（数量）→ `-exec du -ch {} +`（体积）→ `-delete`。清理类操作永远「先看后删」，与 rm 的 echo 预演同一纪律。

**3.** 制造含空格与中文的文件名，分别用裸参数、引号、`find -print0 | xargs -0` 三种方式批量复制，观察哪一种全胜。

> [!TIP]
> 思路`xargs -0` 以 NUL 分隔——文件名里不可能出现的字节，从根上免疫空格/换行陷阱。批量处理「用户提供的文件名」时这是唯一安全形态。

**4.** 用 tar 做一次完整备份流程：打包 /etc（保留属性）、压缩、校验列表、解到临时目录、diff 验证一致性。

> [!TIP]
> 思路`tar -C / -czf etc-backup.tar.gz etc`（-C 指定起点让包内路径干净）→ `tar -tzf` → 解压 → `diff -r etc etc-backup`。备份的完整性验证（不是「打包成功」而是「恢复一致」）是备份的真实定义。

**5.** 在 /var/log 里找「最近 24 小时内被修改过、且含 error 字样」的日志：find + grep 组合，再与 `grep -r --include="*.log"` 纯 grep 方案对比适用边界。

> [!TIP]
> 思路find 管元数据过滤（时间/大小），grep 管内容——两者组合覆盖「结构化搜索」。纯 grep 的 --include 简单但过滤维度少。判断标准：过滤条件里出现「非名字」维度就上 find。

**6.** 讨论：为什么「rm 防误删」社区方案偏向习惯（echo 预演、两步法）而不是 alias rm='rm -i'？从「alias 在脚本里失效」「交互确认疲劳」两个角度分析，给出你的组合方案。

> [!TIP]
> 思路alias 只在交互 Shell 生效（脚本里裸 rm），且 -i 的机械确认会训练出「无脑按 y」。「确认疲劳」是安全设计的经典反面——有效防线应该是「结构性」（移走再删、快照、备份），确认只是补充。
