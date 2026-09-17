---
title: rebase 变基
order: 5
tags: 核心, rebase, 历史
summary: rebase 与 merge 的取舍、公共分支上的黄金法则、交互式 rebase 整理提交。
---

rebase 换个说法是：把我的提交摘下来，搬到目标分支的最新位置重新演一遍。它和 merge 都能整合分支，但产出完全不同的历史——选哪个，取决于你要的是真实过程还是干净结果。

## rebase 做了什么

```text
merge 的历史——保留分叉与合流，真实但毛糙：
C0 ── C1 ── C2 ── C3 ────── M
             \            /
              C4 ── C5 ───┘

rebase 的历史——假装你是在最新代码上顺序开发的：
C0 ── C1 ── C2 ── C3 ── C4' ── C5'
```

rebase 把 dev 上的 C4、C5 逐个"重放"到 main 的 C3 之后，生成**内容相同但哈希不同的新提交** C4'、C5'，然后抛弃原来的 C4、C5。

```bash
git switch dev
git rebase main             # 把 dev 的提交搬到 main 最新处
git switch main
git merge dev               # 此时可快进合并，历史保持一条直线
```

重放过程也可能冲突：如果 C4 改动的位置在 C3 里也变过，rebase 会停在 C4' 让你处理，解决后 `git add` + `git rebase --continue`。

> [!NOTE]
> 重放的提交是**新对象**，哈希变了——对 Git 来说这是两个不同的提交。旧的 C4、C5 并未立即消失，仍在引用日志里躺一段时间（这是事故后的救命稻草，见历史篇）。

## merge 还是 rebase

| 维度 | merge | rebase |
| --- | --- | --- |
| 历史 | 真实记录分叉与合并 | 伪造线性历史 |
| 产生的提交 | 额外的合并提交 | 重放的新提交，哈希改变 |
| 冲突 | 一次性解决 | 逐个提交依次解决 |
| 安全性 | 不改写历史，绝对安全 | 改写历史，已推送则有风险 |
| 适合 | 整合公共/已推送分支 | 整理自己未推送的本地提交 |

常见组合拳：**自己的分支定期 rebase main 保持新鲜，合回 main 时用 merge**。要不要保留合并提交是团队口味问题，关键是全员一致。

一句话决策：这个分支的提交已经离开你的机器了吗？离开了用 merge，没离开 rebase 随便用。顺带注意：squash 合并、amend、压缩提交同样在改写哈希——"公共历史不可改写"的范围远不止 rebase。

## 黄金法则：公共分支不要 rebase

> [!WARNING]
> 永远不要对**已经推送给他人**的提交做 rebase。重放后的新提交和别人的旧提交是两个东西，别人基于旧提交的工作会全部错位。法则一句话：**只 rebase 自己私有的、未推送的提交**。

```bash
git switch feature
git rebase main             # ✅ feature 是自己的分支，提交还没推送——安全

# ❌ 在 main 上执行 rebase——main 已推送、多人共享，历史直接打架
```

为什么这么严格？你在本地 rebase 后，你的 main 包含的是新哈希的提交，同事的 main 还是老哈希——两边从此分道扬镳，每次同步都产生重复提交和假冲突，历史彻底不可读。重复提交和假冲突消耗的是整个团队的信任，这是法则背后的真实成本。

如果 rebase 了已推送分支还想 push，会被拒绝（non-fast-forward）；用 `--force` 硬推等于砸掉别人的工作。真要覆盖远程，用 `--force-with-lease` 并提前和团队打招呼。

## 交互式 rebase：整理提交

`-i` 打开编辑器，对一段提交做增删改排：

```bash
git rebase -i HEAD~4        # 整理最近 4 个提交
git rebase -i --root        # 从第一个提交开始整理（大仓库慎用）
```

编辑器里每行是一个提交，左边的命令决定怎么处理它：

```text
pick  a1b2c3 feat: 输入支持自动补全
squash d4e5f6 fix: 补全的空指针
reword 9g8h7i feat: 支持自动补全
drop  i9j0k1 chore: 临时调试代码
```

| 命令 | 作用 |
| --- | --- |
| `pick` | 保留 |
| `reword` | 保留但改提交信息 |
| `squash` / `fixup` | 并入上一个提交（fixup 丢弃提交信息） |
| `drop` | 删除该提交 |
| `edit` | 停下来修改提交内容 |

典型用法：开发过程中攒了一堆 "wip"、"fix typo"，合回主线前压成一个干净的提交。

```bash
git commit --fixup a1b2c3          # 改动自动标记为"a1b2c3 的修补"
git rebase -i --autosquash a1b2c3~1   # Git 自动排好顺序，不用手工挪行
```

`--fixup` + `--autosquash` 是多轮迭代后的整理神器：修补提交会被自动 squash 到目标提交，免掉手动调整 pick 顺序的机械劳动。

> [!TIP]
> 动手前先 `git branch backup-dev` 留后路。rebase 中途出乱子，`git rebase --abort` 可以全身而退；已经完成的搞砸了，去 reflog 找回（见历史篇）。

## 其他两个高频场景

```bash
# 拉取远程更新时不想产生无意义的合并提交
git pull --rebase           # 等价 fetch + rebase：本地提交搬到远程最新之后

# 把 main 的更新搬进自己的 feature 分支
git switch feature
git rebase main             # 比先 merge main 再说更干净

# 工作区有未提交改动也想 rebase？让它自动 stash 再恢复
git rebase --autostash main
```

冲突在 rebase 里会逐个提交出现：解决后 `git add .`，然后 `git rebase --continue`；整个不要了用 `git rebase --abort`。

相关阅读：[远程协作](06-remote.md)
