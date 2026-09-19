---
title: 历史考古：log、blame 与 bisect
order: 5
tags: log, blame, bisect, reflog, diff
summary: log 的过滤与格式化全参数、引用 commit 的完整语法、pickaxe 搜索（-S/-G）定位行为变化、blame 的行级归属与空白豁免、bisect 二分定位与全自动 bisect run、reflog 作为本地操作日志的恢复入口。
---

Git 的价值一半在提交时的质量（[第 2 篇](02-daily-workflow.md)），另一半在**出事时的考古能力**：这段代码为什么这么写？这个 bug 从哪次提交进来？上周五那个提交的哈希是多少？本篇的每一件工具都对应一类考古问题。

## 1. log：从「流水账」到「查询」

### 1.1 格式化

```bash
git log --oneline                    # 每提交一行（摘要 + 短哈希）
git log --oneline --graph --all      # 图形化全分支 —— 日常首选形态
git log -3                           # 最近 3 条
git log --pretty=format:"%h %ad %an %s" --date=short    # 自定义列
git log --stat                       # 附带每个提交的文件改动统计
git log -p -- src/app.py             # 附带完整 diff（按路径过滤）
```

`%h` 短哈希、`%ad` 日期、`%an` 作者、`%s` 摘要——配合 shell 别名（`git config --global alias.lg "log --oneline --graph --all"`）把常用形态固化成肌肉记忆。

### 1.2 过滤：log 是查询语言

```bash
git log --author="Alice"                        # 按作者
git log --since="2 weeks ago" --until="2026-01-01"
git log --grep="login"                          # 按提交信息搜（这就是提交质量的红利）
git log -- src/auth/                            # 按路径（谁动过这个目录）
git log --follow src/auth/login.py              # 跨重命名追踪
git log --merges                                # 只看合并（找集成的分界点）
```

### 1.3 范围与引用语法

```bash
git log main..feat          # feat 有而 main 没有的提交（PR 会包含什么）
git log feat..main          # main 有而 feat 没有的（落后了多少）
git log main...feat --left-right    # 两边的对称差（各自领先的部分）
git log HEAD~5..HEAD        # 最近 5 个提交
```

引用一个 commit 的完整语法表（所有命令通用）：

| 写法                | 含义                                    |
| ------------------- | --------------------------------------- |
| `abc1234`           | 哈希（前 7 位通常够用）                   |
| `HEAD` / `@`        | 当前位置                                 |
| `HEAD~2` / `HEAD^`  | 往上数 2 代 / 第一个父提交（`^2` 是第二父 = 合并的另一侧） |
| `main@{yesterday}`  | 分支昨天的位置（reflog 记录）              |
| `main@{u}`          | 上游分支（跟踪分支）的位置                 |
| `:/login`           | 提交信息里含 "login" 的最新提交           |
| `v1.2.0`            | 标签                                     |

## 2. pickaxe：按「行为」搜历史

按提交信息搜有盲区（信息写得烂就没救），pickaxe 直接搜**内容变化**：

```bash
git log -S "retry_limit"          # 增删了这个字符串的提交（出现次数变化）
git log -S "retry_limit" --oneline -- src/config.py    # 限定路径
git log -G "def.*retry.*\("       # 正则版：diff 中匹配新增/删除的正则
```

场景：「这个配置项是什么时候被移除的？」——`git log -S "old_config_key" --oneline` 直接命中引入与移除的提交，配合 `-p` 看现场。`-S` 找**出现次数变化**（加或删），`-G` 找 **diff 行匹配**——多数场景两者等价，`-S` 更常用于找「这个标识符的命运」。

## 3. blame：行级归属

```bash
git blame src/app.py                 # 每行：谁、哪个提交、何时写的
git blame -L 40,60 src/app.py        # 只看 40~60 行
git blame -w src/app.py              # 忽略空白改动（格式化不背锅）
git blame -C src/app.py              # 识别从别的文件移过来的代码（跨文件追溯）
```

blame 的正确心态：**找「最后一次真正修改这一行」的提交，然后看那次提交的信息与完整 diff**——是修 bug、是重构搬运、还是批量格式化？`-w` 与 `-C` 就是为了跳过后两种噪声直达真正的语义修改。

## 4. bisect：二分定位引入 bug 的提交

bug 在历史里某处被引入，逐个 checkout 试错是 O(n)；**二分是 O(log n)**——Git 把流程自动化了：

```bash
git bisect start
git bisect bad HEAD            # 现在的版本是坏的
git bisect good v1.2.0         # 这个版本是好的
# Git 检出中间某个提交 → 你测试 → 告诉它好/坏
git bisect good                # 这个版本正常 → 往后半段
git bisect bad                 # 坏 → 往前半段
# ... 几轮后 ...
a1b2c3 is the first bad commit     ← 锁定引入者
git bisect reset               # 回到原来的分支
```

**全自动模式**（有测试脚本时）：

```bash
git bisect start HEAD v1.2.0
git bisect run pytest tests/test_repro.py     # 每个提交自动跑：退出码 0=good 1=bad
# 一行命令，几分钟内从上千个提交中锁定元凶
```

bisect 的前提是**历史可二分**：每个提交都能编译、都能跑测试（[第 2 篇](02-daily-workflow.md)原子提交的直接回报）。历史上如果存在「坏几天」的 WIP 提交，bisect 会被它卡住——这也是提交纪律的经济证据。

## 5. reflog：本地的操作流水账

`git log` 显示**提交历史的结构**；`git reflog` 显示**你（本地 HEAD）走过的每一步**——包括被 rebase/reset/checkout 丢弃的位置：

```bash
$ git reflog
e4a3b8c HEAD@{0}: reset: moving to HEAD~2        ← 刚才 reset 掉了两个提交
9f1c2b3 HEAD@{0}: commit: feat: 搜索功能
a1b2c3d HEAD@{0}: rebase (finish): returning to refs/heads/feat
```

reflog 是**恢复的入口**：任何「被丢弃」的本地状态（reset 掉的提交、rebase 前的链、分离 HEAD 的孤儿提交）都还在 reflog 里，直到过期（默认 90 天）。恢复手法：

```bash
git reset --hard 9f1c2b3            # 回到任意 reflog 位置（[第 7 篇](07-undo.md)）
git branch rescue 9f1c2b3           # 或先落成一个分支再慢慢处理
```

> [!NOTE]
> reflog 是**纯本地**的——它不随 push/fetch 传输，只记录本仓库 HEAD 的移动。这决定了恢复的边界：**未推送的失误几乎都能救，已推送的历史由远程与协作者共同决定**。

## 6. diff 与 show：任意两点的精确对比

```bash
git diff                     # 工作区 vs 暂存区
git diff --staged            # 暂存区 vs HEAD
git diff HEAD                # 工作区 vs HEAD
git diff main feat           # 任意两个分支/提交
git diff main...feat         # 三点：从共同祖先到 feat（PR 展示的内容就是这个！）
git diff --word-diff         # 词级差异（长段落文本友好）
git show HEAD                # 某提交的完整信息+diff；git show v1.2:src/app.py 直接看历史文件内容
```

两点差异是考古的显微镜：`..` 是「两点间的差集」，`...` 是「从分叉点到终点的变化」——PR 的 Files Changed 视图就是三点 diff，理解这一点能解释「为什么 PR 里出现了我没改的东西」（你分支落后 main 的反向差异）。

## 7. 陷阱清单

- 只会用 `git log` 裸命令：过滤参数（author/grep/-S/路径）是考古的核心能力。
- blame 见人就喊：先 `-w` 排除格式化，再读那次提交的完整 diff 与信息。
- bisect 遇到不可编译的提交就放弃：说明提交纪律欠账；也可 `git bisect skip` 跳过。
- 找不到「消失的提交」就慌：reflog 是本地安全网，默认 90 天；越早恢复越稳。
- 混淆 `..` 与 `...`：两点是差集、三点是分叉后变化；PR 视图是三点。
- `git show` 与 `git log -p` 混用场景：看单个提交用 show、过滤浏览用 log。
- 以为 push 过的提交在 reflog 里保平安：reflog 只管本地；远程状态看 [第 6 篇](06-remote.md)。

## 8. 小结

- log 是查询语言：格式化列 + 四类过滤（作者/时间/信息/路径）+ 三种范围；`--oneline --graph --all` 是日常形态。
- 引用语法（HEAD~、@{u}、:/text、tag）让「提交」可以用语义表达——所有命令通用。
- pickaxe（-S/-G）按内容变化搜历史，绕过烂提交信息；blame 定位行级归属，用 `-w/-C` 剔除噪声。
- bisect 用二分从数千提交中锁定 bug 引入点，`bisect run` 全自动化；它的可行性依赖原子提交纪律。
- reflog 是本地 HEAD 的操作日志：一切「丢了的提交」的恢复入口，90 天有效。
- `..` 与 `...` 的差集/分叉语义解释了 PR 视图的真相。

## 9. 练习

**1.** 给你的仓库配三个别名：`lg`（图形化日志）、`last`（上一提交详情）、`unstage`（移出暂存区），然后全用别名完成一次日常循环。

> [!TIP]
> 思路`git config --global alias.lg "log --oneline --graph --all"`、`alias.last "show --stat HEAD"`、`alias.unstage "restore --staged"`。别名固化的是「常用查询形态」，与函数库复用同理。

**2.** 用 pickaxe 找出一个「变量/配置项被删除」的历史时刻：`git log -S "某个老配置名" --oneline`，配合 `-p` 阅读引入与移除两个提交的上下文，还原它的一生。

> [!TIP]
> 思路-S 输出的第一个提交是引入、最后一个是移除；中间的改动看 --patch。「标识符的一生」考古是理解系统演化的最直接材料。

**3.** 在测试仓库里制造一个 bug（第 10 个提交引入），用 `git bisect start/bad/good` 手动二分定位；然后写个退出码脚本用 `bisect run` 全自动复做一次，对比轮数与用时。

> [!TIP]
> 思路10 个提交理论 4 轮内定位（log₂10≈3.3）。脚本版的关键是「退出码语义正确」——0 好 1 坏，脚本本身要幂等。这就是「提交可测」纪律的回报时刻。

**4.** 分别用 `git diff main feat` 与 `git diff main...feat` 对比一个落后 main 的分支，观察输出差异，解释 PR 页面上「多出来的文件」从哪来。

> [!TIP]
> 思路两点 diff 包含「feat 没有 main 的反向差异」（main 新增的东西显示为被删除），三点 diff 只显示「feat 相对分叉点的变化」。理解后「PR 里出现了别人的提交」不再是灵异事件。

**5.** 用 `git blame -w -C` 追查一段「看起来没道理」的代码的来历：先 blame 定位提交，再 `git show` 看那次提交的全貌（可能它只是从别的文件搬来的），再用 `-S` 找搬之前的原始提交。

> [!TIP]
> 思路代码的「出生地」经常在几个文件之前——-C 识别跨文件搬运，-S 跨提交追踪。「考古链」的终点通常是原始设计讨论的提交信息。

**6.** 讨论：为什么「提交信息写得好」能放大本篇所有工具的效果？从 grep、blame、bisect、log --grep 四个角度各举一个「信息质量决定成败」的场景。

> [!TIP]
> 思路--grep 直接搜信息；bisect 需要每个提交「语义完整」才能判定好坏；blame 的行归属要靠信息解释「为什么改」；-S 找到提交后读信息确认意图。历史是查询型资产，信息的质量就是索引的质量。
