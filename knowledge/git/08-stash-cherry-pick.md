---
title: 暂存与摘取：中断与搬运
order: 8
tags: stash, cherry-pick, 工作流中断
summary: stash 作为「可恢复抽屉」的全部操作（含未跟踪文件与部分暂存）、cherry-pick 的复制语义与来源标注 -x、跨分支搬运提交的三种场景，以及「写到一半被叫走」的完整中断恢复流程。
---

两个高频的「计划外场景」撑起本篇：**工作流中断**（写到一半必须立刻切走）与**跨分支搬运**（某个提交需要出现在另一条线上）。stash 解决前者，cherry-pick 解决后者——两者都是把「提交模型」用到非线性的场景。

## 1. stash：可恢复的抽屉

### 1.1 基本循环

```bash
git stash push -m "登录重构进行中"      # 收纳：工作区+暂存区的修改进栈，工作区变干净
git switch main                        # 放心切走
# ...处理紧急事务...
git switch feat/login
git stash pop                          # 取回最近的收纳（并从栈里删除）

git stash list                         # 栈内容（stash@{0} 最新）
git stash apply stash@{2}              # 取指定层（不删——apply 只取不删）
git stash drop stash@{0}               # 扔掉一层
git stash show -p stash@{1}            # 先看看这层是什么
```

stash 的本质是**两个 commit**（工作区状态一个、暂存区状态一个）挂在特殊的引用栈上——所以「收进去的东西」有对象兜底，误 drop 也能从 reflog/fsck 救回（[第 7 篇](07-undo.md)）。

### 1.2 覆盖未跟踪文件与部分收纳

```bash
git stash push -u                      # --include-untracked：新建的文件也收（默认只收已跟踪的修改！）
git stash push -a                      # 连 .gitignore 忽略的也收（慎用）

git stash push -p                      # 补丁模式：逐块选择收什么（与 add -p 同交互）
git stash push -- src/app.py           # 只收某个文件的修改
```

最高频的坑：**stash 默认不收未跟踪文件**——`git status` 里的 Untracked 留在工作区。切走后「新文件怎么还在/新文件没被带上」的困惑都源于此。需要完整收纳（含新文件）就 `-u`。

### 1.3 恢复时的冲突

pop 时如果当前分支的状态与 stash 内容冲突，stash **不会被删除**（pop 失败时保留）——安全设计。此时手动解冲突后 `git stash drop`。另一个细节：stash pop 后暂存区状态不保留（全部进工作区），需要重新 add。

## 2. cherry-pick：把一个提交复制到另一条线

### 2.1 语义与基本用法

```bash
git cherry-pick a1b2c3         # 把该提交的「补丁」应用到当前分支顶端，生成新提交（新哈希）
```

cherry-pick 是**复制不是移动**：原提交还在原分支，新提交内容相同、哈希不同（父变了）。典型场景：

```bash
# 场景①：hotfix 需要同时出现在 main 与 release/2.x
git switch main && git cherry-pick <fix_sha>
git switch release/2.x && git cherry-pick <fix_sha>    # 同一个修复搬两次

# 场景②：PR 里有 5 个提交，reviewer 只要其中一个
git switch main && git cherry-pick <good_sha>

# 场景③：feature 分支上的某个提交想提前单独上线
```

**标注来源**是跨分支搬运的纪律：

```bash
git cherry-pick -x a1b2c3      # 提交信息自动附上 "(cherry picked from commit a1b2c3...)"
```

`-x` 让「同一个改动在多条线上」的事实可追溯——之后 bisect、考古（[第 5 篇](05-history.md)）都能顺着引用找到原型提交，避免「重复修复」或「一边修了另一边忘了」。

### 2.2 冲突与序列

```bash
git cherry-pick a1b2c3 d4e5f6 9a8b7c      # 按序摘多个（一次提交一个）
# 冲突时：解决 → git add → git cherry-pick --continue
#          反悔 → git cherry-pick --abort
```

与 rebase 的关系一句话：**rebase 是「把整条分支的提交」依次 cherry-pick 到新基点**——两者的冲突处理流程完全一致（continue/abort），学一次用两处。

## 3. 中断恢复：综合演练

「写代码写到一半，线上出事故要立刻处理」的完整剧本：

```bash
# ① 现状：feature 分支上若干未提交修改（含新文件）
git stash push -u -m "feat/login wip: 表单校验写到一半"

# ② 切到 main 处理事故
git switch main && git pull --ff-only
git switch -c hotfix/token-loop
# ...修复、提交、PR、上线（[第 6 篇](06-remote.md)）...

# ③ 回到原来的工作
git switch feat/login
git stash pop
# 有冲突？解冲突 → add → stash drop

# ④ 事故修复如果也适用于 feature 分支的代码基线：
git cherry-pick <hotfix_sha> -x        # 把修复同步过来（避免之后合并时再冲突）
```

另一个高频中断：「切换分支被拒」（[第 3 篇](03-branches.md)情形②）——stash 正是三条出路中最轻的一条，配合 `-u` 与 `-m` 信息，抽屉不是垃圾堆而是有序的暂停点。

## 4. 陷阱清单

- stash 默认漏掉未跟踪文件：`-u` 才完整；「新文件没被收走」的头号原因。
- stash 当长期储物间：栈会越积越乱（list 十几层没名字）；`-m` 认真写、定期清。
- pop 后以为暂存区还在：stash 不保暂存状态；重要分批重新 add。
- cherry-pick 不带 -x：跨分支副本失联，重复修复无人知晓；搬运必 -x。
- cherry-pick 后原分支又改了同一处：两线分叉积累冲突；用 rebase 同步基线代替手动搬运多个提交。
- 序列 cherry-pick 中途放弃：--abort 回到起点；别让「半摘取」状态过夜。
- 把 cherry-pick 当同步工具用（反复搬运）：那是 rebase/merge 的职责；cherry-pick 留给「单点搬运」。

## 5. 小结

- stash 是有对象兜底的收纳栈：push/pop/apply/drop/list 四件套，`-u` 收未跟踪、`-p` 部分收纳、`-m` 认真命名；pop 冲突时不删层。
- stash 的定位是「工作流中断的暂停点」，不是长期储物间——长期状态应该有分支或提交承载。
- cherry-pick 复制单提交到另一条线（新哈希），hotfix 多分支同步与 PR 挑提交的主场；`-x` 标注来源让副本可追溯。
- rebase = 整分支的 cherry-pick：continue/abort 的冲突流程一体通用。
- 中断恢复的完整剧本：stash -u 收纳 → 处理事故 → 回来 pop → 需要时 cherry-pick 同步修复。

## 6. 练习

**1.** 制造「含新文件的未提交修改」，分别用不带与带 `-u` 的 stash 收纳后切分支，对比两种情况下工作区与新分支的差异。

> [!TIP]
> 思路不带 -u 时新文件留在工作区跟着你切走（可能在错误分支上污染）；带 -u 才收进抽屉。这个对比就是「stash 收纳不完整」的直接证据。

**2.** 用 `git stash push -p` 把一个混合修改文件拆成「收一半」：pop 回来后检查工作区与暂存区的状态，理解部分收纳的语义。

> [!TIP]
> 思路部分收纳后 stash 里是选中的块，工作区剩下未选中的块——pop 时两层会合并回来。「收一半」适合「想提交一部分、另一部分继续」的场景（与 add -p 的「提交一半」互补）。

**3.** 演练 hotfix 双线搬运：main 上修一个 bug，`-x` cherry-pick 到 release 分支；两边的 `git log` 里对比来源标注，再故意在 release 上修改同一行制造 cherry-pick 冲突并解决。

> [!TIP]
> 思路-x 的标注是 `git log --grep "cherry picked"` 可检索的——「同一修复的多份拷贝」靠它对账。冲突演练展示「基线差异」是搬运失败的唯一原因：基线越接近，cherry-pick 越顺滑。

**4.** 设计你个人的「中断恢复」标准流程：从「正在写代码」到「处理完事故回到原点」，写一份自己的命令清单（含 stash 命名规范与回来后的第一件事）。

> [!TIP]
> 思路关键决策点：stash 还是先 commit wip？视「中断时长与稳定性」——小时级 stash、天级 wip commit + push（远程备份）。回来的第一件事：stash list 或 status，确认状态与记忆一致。

**5.** 讨论：什么时候「cherry-pick 多个提交」应该升级为「rebase 整条分支」？从提交数量、提交间依赖、目标分支的归属三个维度给出判断标准。

> [!TIP]
> 思路提交间有依赖（后一个依赖前一个的改动）时逐个 cherry-pick 必然冲突连片——整条 rebase 保持依赖关系一次解决；数量多、且整条分支都属于你 → rebase；只属于单点、来源分散 → cherry-pick。
