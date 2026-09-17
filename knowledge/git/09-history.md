---
title: 查看历史与找回
order: 9
tags: 进阶, log, reflog
summary: log 的筛选与图形化、diff 的各种比较对象、blame 定位、reflog 找回丢失提交。
---

Git 的历史查询能力远超大多数人用到的程度：任何两个状态之间都能 diff，任何一行代码都能追责，被 reset 丢弃的提交也能从引用日志里捞回来。这一篇全是"事后诸葛亮"的工具——但排查问题时它们最值钱。

## log：不止是列表

log 支持"组合拳"：过滤器可以叠加，先按文件、再按作者、再按内容，一层层收窄范围。输出是纯文本，随便管道加工：`git log --oneline | wc -l` 数一数总提交数。

```bash
git log --oneline --graph --all   # 提交拓扑图，建议设为日常默认
git log -5                        # 最近 5 条
git log --author="Zhang" --since="2026-01-01" --until="2026-03-01"
git log --grep="fix"              # 按提交信息搜
git log -S "login_token"          # 按"新增或删除了该字符串"搜提交
git log -S "login_token" --all    # 在所有分支里搜，不只当前分支
git log -p src/auth.rs            # 看某文件的每次改动内容
git log --stat                    # 每条提交改了哪些文件
git log --merges --oneline        # 只看合并提交（--no-merges 反之）
git log --format="%h %an %ad %s" --date=short   # 自定义格式
git shortlog -sn                  # 按提交数排名：谁动了这个仓库
git log -g --oneline              # 按 reflog 顺序浏览：时间机器视角
git log --first-parent main       # 只看主线侧提交，忽略合并进来的
git log -S "token" --oneline main -- src/   # 范围、内容、路径三重过滤
```

> [!TIP]
> `-S`（pickaxe）按字符串的出现/消失搜历史，是"这行代码是哪次提交引入的"类问题的第一选择，比翻 blame 快得多。

> [!NOTE]
> log 默认按时间排序，但有合并存在时"父子顺序"并不直观。看分支拓扑认准 `--graph`，别靠缩进猜。

典型组合：`git log --since='1 month ago' --author='Zhang' --oneline -- src/`——最近一个月、某人、src/ 下的提交，一屏看完。

## diff：比较任意两个状态

diff 的参数一旦理解成"从哪里比到哪里"，就再也不会记混：

```bash
git diff                    # 工作区 vs 暂存区
git diff --staged           # 暂存区 vs 最近提交（HEAD）
git diff HEAD               # 工作区+暂存区 一起 vs 最近提交
git diff main dev           # 从 main 到 dev 的差异（两点等价于直接写两个名字）
git diff main...dev         # 共同祖先到 dev 的差异——review 页面展示的就是这个
git diff abc1234 def5678    # 任意两个提交之间
git diff abc1234 -- src/    # 相对某个历史版本，只看指定路径
git diff --stat             # 只看文件级的增删统计
git diff --color-words      # 单词级高亮，长行和中文更友好
git diff --name-only        # 只列变更文件；--name-status 连 A/M/D 状态一起给
git diff --numstat          # 数字化的增删行数，方便排序统计
```

两点与三点是高频混淆点：`main..dev` 比较两个**端点**；`main...dev` 比较的是**共同祖先到 dev** 的变化，即"dev 这条分支自己干了什么"。路径跟在 `--` 后面写，避免与分支名歧义：`git diff HEAD -- src/`。

常用定位节奏：先 `--stat` 找到嫌疑文件，再对该文件看详细 diff。排查"文件为什么变成这样"的两步：`git log -p <file>` 看演进，`git diff <good> <bad>` 看跃变。

## blame：这行是谁、哪次提交改的

```bash
git blame src/auth.rs             # 每行标注提交哈希、作者、日期
git blame -L 40,60 src/auth.rs    # 只看第 40-60 行
git blame -w src/auth.rs          # 忽略纯空白改动，不被格式化提交刷屏
git blame -C src/auth.rs          # 代码被移动/复制过也能追溯到原作者
git blame -e src/auth.rs          # 直接显示作者邮箱
git blame abc1234 -- src/auth.rs  # 从某个历史时间点开始 blame
```

blame 的输出要会读上下文：指向一个"重构"大提交时，真实作者往往是重构**之前**的那次提交——顺着哈希再查一层才能找到源头。blame 是放大镜不是望远镜，先 `git log --oneline -- <file>` 看整体脉络，再放大到行。`-L` 还支持正则定位：`git blame -L /handle_login/,+20` 从函数名那行往下看 20 行。`git log -L /funcname/:file` 则追踪一段代码的完整演变，比逐行 blame 更宏观。

## reflog：找回"丢失"的提交

reset --hard、rebase 搞砸、强切分支……提交"消失"了？只要提交过，对象就还在 `.git/objects` 里。reflog 记录着 **HEAD 的每一次移动**——commit、reset、merge、切分支都会留痕，它不只是 reset 的后悔药。对象库保存所有状态，reflog 保存你到达这些状态的路径：

```bash
git reflog                  # HEAD 移动历史（纯本地记录）
git reflog --date=iso       # 带时间戳显示，方便回忆"我什么时候干的"
# a1b2c3 HEAD@{0}: reset: moving to HEAD~1
# d4e5f6 HEAD@{1}: commit: feat: 完成登录
git reset --hard d4e5f6     # ✅ 回到 reset 之前的状态，提交找回来了
```

误删分支同理：

```bash
git branch -D dev           # ❌ 误删了未合并的分支
git reflog                  # 从移动历史里找到 dev 最后所在的哈希
git branch dev d4e5f6       # ✅ 分支原地复活
```

也可以建个分支指回去：`git branch rescue d4e5f6`。reflog 里的哈希一样可以 `git show` / `git diff`，找回前先看看内容对不对。reflog 也没辙时，`git fsck --lost-found` 直接列出所有不可达对象，是最后一道兜底。`git reflog show dev` 还能单独查看 dev 分支的移动历史，不限于 HEAD。

> [!WARNING]
> reflog 是**纯本地**记录，不随 push/pull 传播；条目默认保留 90 天（不可达提交 30 天），被 GC 清掉的提交才是真丢了。发现丢失后尽早抢救，别拖。

> [!NOTE]
> `HEAD@{n}` 指"HEAD 在 n 次移动之前"的位置，也支持 `HEAD@{one.hour.ago}` 这类时间写法。查 reflog 永远比重丢工作划算。

## bisect：二分定位坏提交

历史查询的终极形态：bug 在最近 200 个提交里混了进来，手动试错太慢，二分收窄。

```bash
git bisect start
git bisect bad HEAD         # 当前版本有 bug
git bisect good v1.2.0      # 这个版本没有
# Git 自动切到中间提交，你测试后标记：
git bisect good             # 没问题 → git bisect bad → 直到锁定
git bisect skip             # 当前提交无法测试时跳过
git bisect visualize        # 打开图形视图看当前二分区间
git bisect log > bisect.log # 保存排查记录，git bisect replay 可恢复现场
git bisect reset            # 结束，回到出发分支
```

原理是纯二分查找，前提是 good/bad 判断单调——bug 必须在这个区间内"要么一直有，要么一直没有"。200 个提交最多 8 次测试；测试能自动化时，`git bisect run make test` 全自动完成（退出码 0 视为 good，非 0 视为 bad，125 表示跳过）。锁定坏提交后 `git show` 看具体改动——bisect 负责定位，解释原因靠 diff。把排查记录（`git bisect log`）附到 issue 里，下次同类问题直接 replay。

相关阅读：[标签与 .gitignore](10-tags-ignore.md)
