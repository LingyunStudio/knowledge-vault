---
title: 撤销与回退
order: 7
tags: 核心, reset, revert
summary: 工作区/暂存区/已提交三层撤销：restore、reset 三种模式与 revert 的安全回退。
---

"手滑了"是 Git 的日常。撤销是否危险只取决于一件事：**改动有没有被提交、有没有被推送**。本地未推送的一切都可以随便重来；推送到公共分支的历史，只能新增"反向提交"，不能改写。

## 撤销前的定位

```bash
git status                  # 先确认改动在哪个层：工作区？暂存区？还是已提交？
git diff --staged           # 看清暂存区里已经装了什么
git log --oneline -5        # 确认要回到哪个提交
git diff                    # 动手前先看清楚要丢的是什么
git stash list              # 顺带看看有没有存着的现场
```

撤销操作的破坏力与你对现状的了解程度成反比。读不懂 status 的输出，就什么都别做。动手前先把现场存个底——`git branch backup` 或 `git stash`，成本为零，后悔药管够。三个层，对应三种工具：

| 层 | 场景 | 工具 |
| --- | --- | --- |
| 工作区 | 文件改乱了，还没 add | `git restore <file>` |
| 暂存区 | add 错了文件 | `git restore --staged <file>` |
| 已提交 | 提交错了、提交多了 | `git reset` / `git revert` |

## 工作区与暂存区：restore

```bash
git restore README.md               # ✅ 丢弃工作区改动，回到最近暂存/提交的状态
git restore --staged README.md      # 移出暂存区（改动保留在工作区）
git restore --source=main src/      # 从指定提交恢复文件
git restore .                       # 丢弃当前目录下所有工作区改动——同样危险
```

restore 不带文件名会直接报错，这是刻意设计的防误操作；`git restore .` 则是真正的大范围丢弃，执行前深呼吸。工作区与暂存区一步到位恢复：`git restore --staged --worktree <file>`。

> [!WARNING]
> `git restore <file>` 丢弃的改动**没有任何地方可以找回**——它从没进过 Git 的对象库。执行前确认真的不要了。连 Untracked 文件也救不回来——任何回退命令都管不了从没进过暂存区的东西。

> [!NOTE]
> 老教程里的 `git checkout -- file` 和 `git reset HEAD file` 分别对应现在的 `git restore` 与 `git restore --staged`，效果相同，新命令语义更清晰。

### add 过但没提交的，也能捞

工作区文件被误删误覆盖，但曾经 `git add` 过？对象库里还有副本。`git fsck --lost-found` 会列出悬空 blob，去 `.git/lost-found/` 里翻找内容。

## 已提交：reset 三种模式

reset 把**当前分支指针**挪到指定提交。三种模式控制"回退范围"逐级扩大——soft 只动指针，mixed 动到暂存区，hard 动到工作区：

| 模式 | 分支指针 | 暂存区 | 工作区 | 一句话 |
| --- | --- | --- | --- | --- |
| `--soft` | 回退 | 原样保留 | 原样保留 | 只是反悔了提交 |
| `--mixed`（默认） | 回退 | 重置到目标 | 原样保留 | 提交和暂存都反悔 |
| `--hard` | 回退 | 重置到目标 | 重置到目标 | ❌ 彻底回到过去，未提交改动全没 |

```bash
# 场景：最后一次提交（HEAD）有问题，想重做
git reset --soft HEAD~1     # ✅ 撤销提交，改动回到暂存区，改完再提交
git reset HEAD~1            # 撤销提交和暂存，改动留在工作区
git reset --hard HEAD~1     # ❌ 提交和改动一起消失——确认工作区干净再用

# 场景：回到某个历史提交，之后的一切都不要了
git reset --hard abc1234    # ❌ 危险：之后的提交和未提交的本地改动全部丢弃
```

`HEAD~1` 是上一个提交，`HEAD~3` 是往上数第三个。reset 前的位置会记在 `ORIG_HEAD` 里，`git reset --hard ORIG_HEAD` 可以反悔最近一次 reset。记住：reset 不删除任何对象，只移动指针——这正是 reflog 能救场的根本原因（见历史篇）。

场景速查：

| 你想要 | 命令 |
| --- | --- |
| 撤销最后一次提交，重新编辑 | `git reset --soft HEAD~1` |
| 撤销提交和暂存，改动留在工作区 | `git reset HEAD~1` |
| 彻底丢弃最后一次提交 | `git reset --hard HEAD~1` |
| 分支整体退回某个历史点 | `git reset --hard abc1234` |
| 只把某个文件恢复到某个版本 | `git restore --source=abc1234 <file>` |

> [!WARNING]
> `reset --hard` 不会删除 Untracked 文件——它们本来就不在版本控制里，但也不会被恢复。危险的是它对所有**已跟踪**文件的未提交改动一视同仁地抹掉。
> 执行前 `git branch backup` 留一手——指针操作零成本，后悔药却很贵。

`--hard` 丢弃的提交并非不可挽回——它们仍能通过 reflog 找回（见历史篇）——但它对**从未提交过**的工作区改动确实无能为力。

> [!TIP]
> 修正最后一次提交有专用命令：`git commit --amend`，改提交信息或补文件一步到位。它同样改写历史，规则同 reset：没推送随便用，推送了别碰。只改提交信息同样用它：`git commit --amend` 直接打开编辑器。

## revert：公共历史的安全回退

已推送的提交想撤回？不要 reset（改写历史），用 revert **生成一个反向提交**——思路和数据库的补偿事务一样：历史不可变，向前修正。

```bash
git revert abc1234          # 创建新提交，内容正好抵消 abc1234
git revert HEAD             # 撤销最近一次提交
git revert abc1234..def5678 # 撤销一段范围内的提交（逐个生成反向提交）
git revert --no-commit abc1234   # 只取反向改动不提交，攒几个一起提交
git revert -m 1 abc1234     # 撤销合并提交：-m 1 表示保留"第一个父提交"一侧
```

合并提交有两个父提交，直接 revert 会报错，必须用 `-m` 指定保留哪一侧。还有一个著名的坑：撤销合并后，将来想再次合入同一分支，Git 会认为"这些提交已经合并过"而跳过——需要先 revert 那个 revert，或重做改动。

历史长度增加，但没有任何提交被改写——别人的克隆不受影响，`git blame` 和 review 都能看到"撤回"这个动作本身。**多人共享的分支上撤销，永远用 revert。**

revert 会打开编辑器确认提交信息，默认标题是 Revert "原标题"，正文里写清撤回原因。批量 revert 从小范围开始试，冲突时逐个处理。

## 怎么选

```text
改动还在工作区/暂存区 → restore（丢了就真丢了，想清楚）
提交了但没推送        → reset --soft / --mixed 重做，小修用 --amend
推送了，只有自己用    → reset 后 --force-with-lease，或干脆 revert
推送了，多人共享      → revert，没得商量
误删分支/提交         → reflog 找回（见下一篇）
```

选择困难时记住优先级：先保数据（backup / stash），再谈整洁。

相关阅读：[stash 与 cherry-pick](08-stash-cherry-pick.md)
