---
title: 事故现场手册：诊断与处方
order: 11
tags: 事故恢复, reflog, filter-repo, 诊断流程
summary: 事故处理的三问诊断法（什么阶段/推没推/有没有别人）、现场固定三命令、按事故类别的处方速查表、六个完整案例的深度复盘（推错分支、提交进错分支、仓库损坏、误提交大文件），以及一份预防配置清单。
---

这是 Git 篇章的收束：把前几篇的机制压缩成一本**事故响应手册**。Git 事故的可怕之处从来不是「丢数据」——对象库几乎不会真的丢——而是**慌乱之下的连环操作**把可恢复变成不可恢复。所以本篇的第一节不是命令，是方法论。

## 1. 三问诊断法

任何 Git 事故，先冷静回答三个问题：

1. **出问题的内容在什么阶段？** 工作区（没进数据库，最危险）/ 本地提交（进库了，reflog 兜底）/ 已推送（远程还有一份）。
2. **推送到远程了吗？** 未推送 → 可以自由重写（reset/rebase）；已推送 → 只能反转（revert）或需要协调。
3. **有别人基于它工作吗？** 只有你 → 历史随你改写；有协作者 → 任何历史改写都需要通知与对齐。

三问决定了处方。配合「现场固定」原则：

```bash
git status            # ① 现在站在哪、有什么脏的
git log --oneline -5  # ② 历史到哪了
git reflog -10        # ③ 我刚才做了什么（操作流水）
```

**先跑这三条再动手**——它们只读不写，把「记忆里的现场」变成「屏幕上的现场」。更保险的一步是先把当前状态落成标签/分支（`git branch backup-<时间>`），任何后续操作都从可回退的锚点出发。

## 2. 处方速查表

### 2.1 工作区类（未进数据库——唯一真丢区）

| 事故                       | 处方                                          |
| -------------------------- | --------------------------------------------- |
| `restore` 丢修改后反悔       | 基本无救（对象库没它）；IDE 本地历史/vscode timeline 是最后稻草 |
| 改乱了一堆文件想全盘重来     | `git restore .`（已跟踪）；未跟踪文件 `git clean -fd`（先 `-n` 预览！） |
| 误删文件                    | 已提交过的：`git restore <file>`；未提交的：无救 |
| stash drop 后反悔           | [第 7 篇](07-undo.md)：fsck --unreachable → stash store |

### 2.2 提交类（本地历史）

| 事故                             | 处方                                                |
| -------------------------------- | --------------------------------------------------- |
| commit 信息错了（未推送）          | `commit --amend -m`                                  |
| 提交进错分支（未推送）             | `reset --soft HEAD~1` → `switch 正确分支` → `commit`（改动随你在分支间走） |
| 提交早了想补文件                   | `add` + `commit --amend --no-edit`                   |
| 忘切分支写了一堆改动                | `switch -c 正确分支`（未提交改动带过去）或 stash         |
| 多个提交想合并/重排                 | `rebase -i`（未推送）                                 |
| reset --hard 后反悔               | `reflog` 找回 → `reset --hard <sha>`                  |
| 误删分支                         | reflog 找 tip → `branch <名> <sha>`                   |

### 2.3 远程类

| 事故                             | 处方                                                       |
| -------------------------------- | ---------------------------------------------------------- |
| push 到了错误的远程分支           | 远程恢复：`push origin --delete 错误分支`（若刚推）+ 本地正确推送；别人的分支则通知 + `revert` |
| 强推覆盖了别人的提交             | 从本地 reflog / 协作者仓库找回被覆盖提交 → 重新推上去 → 复盘流程 |
| pull 出现奇怪的合并提交         | `git reset --hard ORIG_HEAD`（pull 前的位置被记录）→ 改用 `pull --rebase` |
| 误推巨大文件/密钥                | 见第 4 节案例 6                                            |

`ORIG_HEAD` 是 merge/rebase/reset 前的 HEAD 快照——「刚才那次大操作之前在哪」的快捷引用。

### 2.4 环境类

| 事故                     | 处方                                                    |
| ------------------------ | ------------------------------------------------------- |
| `.git` 目录误删部分       | `git fsck --full` 评估；严重时从远程重新 clone + reflog 数据迁移（本仓库独有提交先按 reflog 抢救） |
| 仓库体积异常大           | `git count-objects -vH` → 历史里找大 blob（案例 6）        |
| 工作区文件损坏/未知状态   | `git status` + `git checkout -- .`（已提交内容的重置）；先 stash 未提交部分 |

## 3. 六个深度案例

### 3.1 案例 1：提交进了错误的分支（已写完 3 个提交才发现）

```bash
git branch feat/target                # ① 在正确位置落一个分支（别丢工作）
git reset --hard origin/main          # ② 原分支退回远程状态
git switch feat/target                # ③ 提交们已经在这了
```

原理：提交不属于分支，分支只是指针——「搬提交」=「把指针挪过去」。若原分支已推送，②改为 `reset --soft` + 通知。

### 3.2 案例 2：误推到共享的 main

```bash
# 你已经 push 到 main 了（规则上不允许），还没人 pull：
git reset --hard HEAD~1          # 本地退回
git push --force-with-lease      # 恢复远程（窗口极短才行）
# 已有人 pull：只能 revert（正向修复），并接受历史里留痕
```

黄金窗口判断：推上去到被人 fetch 之间（通常几分钟内）才能无损撤回；之后就是 revert + 复盘。这也是「main 保护规则」存在的直接理由。

### 3.3 案例 3：一次混乱的 merge 后找不到北

```bash
git merge feat/big
# 冲突解到一半手忙脚乱，commit 了半成品……
git reflog                       # 找到 merge 之前的位置
git reset --hard HEAD@{2}        # 或 ORIG_HEAD
git merge feat/big               # 从头再来，这次分块解决
```

merge 的每个中间态都有锚：`ORIG_HEAD`（merge 前）、reflog（全程）。**混乱的合并永远可以从头来**，前提是别在慌乱中继续叠加新操作。

### 3.4 案例 4：协作者强推，你的本地「分叉」了

```bash
git status          # Your branch and 'origin/feat' have diverged
# 你的本地 feat 是他强推前的旧版本（你的额外提交是否想保留？）
git fetch origin
git log --oneline HEAD...origin/feat --left-right   # 看两边各有什么
# 你的提交没有独立价值 →
git reset --hard origin/feat
# 有价值 → 先 branch 备份，再 reset，然后 cherry-pick 回来
```

「diverged」不是事故，是「历史被改写」的正常信号——处理方式取决于你本地那几个提交的归宿。

### 3.5 案例 5：rebase 到一半想放弃/已完成想反悔

```bash
# 中途：冲突地狱想跑路
git rebase --abort                      # 回到 rebase 前的完整状态

# 已完成：发现方向错了
git reflog                              # rebase 前的位置（finish 之前的条目）
git reset --hard <rebase前的sha>
```

rebase 的「重放」留下完整的 reflog 链——原提交在 rebase 完成后仍可达（直到 GC），恢复窗口很长。

### 3.6 案例 6：误提交大文件导致仓库臃肿

```bash
git count-objects -vH                   # 看仓库体积
# 找出历史中的大对象（top 10）：
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
  | awk '/^blob/ {print $3, $4}' | sort -rn | head
# 若未推送：直接 reset 掉 + lfs track 后重新提交
# 若已推送：git filter-repo --path big.zip --invert-paths（历史清洗，全员重克隆）
git lfs track "*.zip"                   # 以后走 LFS
```

「大文件进历史」的成本是永久的（每个历史版本都带它）——清洗是重写全历史的手术（[第 2 篇](02-daily-workflow.md)密钥处理同理），预防（LFS + pre-commit 大小检查）远胜治疗。

## 4. 预防配置清单

```bash
# 全局基线（[第 10 篇](10-config-worktrees.md)）
git config --global pull.rebase true         # 减少 30% 的「pull 意外」
git config --global rerere.enabled true      # 冲突解法记忆
git config --global fetch.prune true

# 提交防线（[第 9 篇](09-hooks-automation.md)）
pre-commit: ruff / check-merge-conflict / detect-private-key / gitleaks
CI: 全量测试 + 大小检查
平台: main 保护（禁直推、必须 PR 过 CI）
```

再加三条行为纪律：**事故后先三问再动手**；**动手前先落锚（backup 分支）**；**历史改写后立即通知受影响者**。Git 的安全网极厚（对象库 + reflog + 远程副本），绝大多数「数据丢失」都是慌乱操作剪断安全网的结果。

## 5. 小结

- 三问诊断（阶段/推送/协作方）+ 现场固定三命令（status/log/reflog）+ 先落锚，是所有事故响应的起手式。
- 处方按类别速查：工作区类唯一真丢区（操作前 stash）、提交类全部可救（指针搬移 + reflog）、远程类分窗口（黄金窗口内强推恢复，之后 revert）、环境类先 fsck 评估。
- 六案例的公共原理：提交不属于分支（搬提交=搬指针）、ORIG_HEAD 与 reflog 是每步大操作的锚、历史清洗（filter-repo）是最后手段且需全员重克隆。
- 预防清单（配置基线 + 提交防线 + 行为纪律）把事故发生率压到接近零——手册的价值一半在响应、一半在让事故消失。

## 6. 练习

**1.** 在测试仓库逐一「作案」：提交进错分支、reset --hard 后反悔、误删分支——每件事按三问诊断法写出完整恢复命令序列，并计时（你能在 2 分钟内救回吗）。

> [!TIP]
> 思路计时训练的目的是把「查手册」变成「肌肉记忆」。真实事故里每一分钟慌乱都在叠加新操作，肌肉记忆就是最好的刹车。

**2.** 制造案例 2 的黄金窗口：push 到共享 main 后，在「别人 fetch 之前」用 force-with-lease 撤回；再模拟「别人已经 pull」（另一个人 fetch），验证此时只能 revert。

> [!TIP]
> 思路两个时间点的可操作性差异就是「重写 vs 反转」法则的现场版。第二个场景里注意：即使 revert，也建议在 PR 里做（留 review 痕迹）。

**3.** 演练仓库「急救」：复制一个仓库，删掉 .git/refs/heads 下的分支文件，用 `git fsck --lost-found` + reflog 恢复全部分支。

> [!TIP]
> 思路分支文件丢了只是「名字丢了」，对象与 reflog 都在——`git reflog` 逐个 tip 重建 `git branch <名> <sha>`。这个实验证明「Git 的脆弱点几乎不在数据，在引用」。

**4.** 为你的团队把第 4 节的预防配置清单落地：全局基线写入文档、pre-commit 配置进仓库、main 保护规则开箱，并写一份 10 行的「事故响应卡」贴在团队 wiki。

> [!TIP]
> 思路响应卡格式：事故名 → 三问速答 → 三步内处方 → 升级路径（找谁）。卡的内容必须与团队实际工作流（分支模型、远程布局）一致——通用手册不如具体卡片。

**5.** 复盘你经历过的最痛的 Git 事故：按本篇框架重走一遍（当时哪一步慌了？三问的答案是什么？正确的处方是什么？），提炼出属于你自己的两条新纪律。

> [!TIP]
> 思路复盘的目的不是自责，是发现「慌乱点」通常对应「机制理解空白」——那正是下一步学习的地图。你的新纪律应该能被配置或钩子自动化，而不是依赖意志力。
