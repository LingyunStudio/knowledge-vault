---
title: 分支
order: 4
tags: 核心, branch, merge
summary: 分支只是指向提交的指针：创建切换合并、快进与三方合并、冲突怎么解。
---

分支是 Git 的核心卖点：创建分支只是写一个 40 字节的文件，瞬间完成。其他系统把分支当"复制一份目录"，Git 把它当"一个可移动的指针"——理解这一点，分支的一切操作都变得自然。

## 分支的本质：一个指针

每个提交都有指向父提交的指针，提交链自然生长。**分支只是一个指向链上某个提交的可移动引用**，存在 `.git/refs/heads/` 下，内容就是一串哈希。

```text
C0 ── C1 ── C2 ── C3        ← main 停在 C3
             \
              C4 ── C5      ← dev 从 C2 分出后继续生长，停在 C5
```

创建分支不复制任何文件、不复制任何历史，切换分支也只是换一个指针指向——这就是 Git 分支"轻"的原因。日常观察分支拓扑就靠一条命令：`git log --oneline --graph --all`。每条命令跑完扫一眼这张图，分支模型很快长进脑子里。

## 创建、切换、删除

```bash
git branch                  # 列出本地分支（* 标记当前所在）
git branch dev              # 创建分支（不切换）
git switch dev              # 切换分支（新命令，推荐）
git switch -c dev           # 创建并切换（老写法：git checkout -b dev）
git switch main             # 切回 main
git branch -m dev feature   # 重命名
git branch --contains abc1234   # 查看哪些分支包含某个提交
git branch -d dev           # 删除已合并的分支（安全检查，未合并会拒绝）
git branch -D dev           # ❌ 强制删除未合并分支——上面的提交随时可能被 GC 回收
git branch -a               # 连远程跟踪分支一起列出
git switch -                # 回到上一个分支（类似 cd -）
```

> [!TIP]
> `checkout` 一个命令管两件事（切分支、恢复文件），容易混淆出事故。`switch` 只切分支、`restore` 只恢复文件，语义分离后更安全。

工作区只有一份，切换分支时 Git 会把工作区更新成目标分支的快照。**未提交的改动会跟着你走**（不冲突的前提下）——想清空现场再切，用 stash（见后续文章）。

## 合并：快进与三方

把 dev 合回 main 只有两种情况：

```bash
git switch main
git merge dev               # 在 main 上合并 dev
```

注意方向：**merge 是把别人合进当前分支**。想在 main 上拿到 dev 的成果，就先切到 main 再 merge dev——新手最常在这里反向操作。

**快进（fast-forward）**：main 在 dev 分出后没有新提交，把 main 指针直接挪到 dev 的位置即可，不产生新提交。快进之后两条分支指向同一位置，历史完全线性；不产生提交也就没有"合并"痕迹可寻——指针挪过头了 reset 回去就行。

**三方合并（three-way merge）**：两条分支各自有新提交，Git 找到共同祖先，对比三方差异后创建一个**合并提交**——它有两个父提交。

```text
快进（main 没动过）：
C0 ── C1 ── C2 ── C3 ── C4 ── C5      main 直接前移到 C5

三方合并（两边都有新提交）：
C0 ── C1 ── C2 ── C3 ────── M          M 是合并提交，父提交为 C3 和 C5
             \           /
              C4 ── C5 ──┘
```

```bash
git merge --ff-only dev     # ✅ 只允许快进，否则报错退出（想保证线性历史时用）
git merge --no-ff dev       # 强制生成合并提交（即使能快进也不偷懒）
git merge --squash dev      # 把 dev 的改动压缩成一个待提交变更，不生成合并提交
git branch --merged         # 列出已合入当前分支的分支——可以放心删除
```

> [!NOTE]
> 合并提交是真实存在的提交，会永久留在历史里。它记录"这里发生过一次整合"；也有人认为它是噪音——这正是 merge 与 rebase 之争的起点（见下一篇）。

## 冲突：不可避免，也不可怕

两个分支改了**同一个文件的同一处**，Git 无法替你决定，合并暂停：

```bash
git merge dev
# CONFLICT (content): Merge conflict in src/main.rs
git status                  # 列出冲突文件（标记为 both modified）
# 手动编辑文件，处理 <<<<<<< ======= >>>>>>> 标记
git add src/main.rs         # 标记该文件已解决
git commit                  # 完成合并提交
git merge --abort           # 处理不了想跑路？可以用，但先试着解决
```

冲突标记长这样：

```text
<<<<<<< HEAD
main 分支的内容
=======
dev 分支的内容
>>>>>>> dev
```

冲突并不可怕的根源在于：Git 从不悄悄替你做决定——它宁可停下，把选择权完整地交给你。

rebase 和 cherry-pick 的冲突标记格式相同，只是尖括号后面跟的是提交哈希而非分支名，原理与处理方式一致。拿不准解得对不对，`git diff` 直接看工作区——冲突现场的标记一目了然。

解冲突是理解两侧意图的设计决策，不是机械保留某一侧。拿不准就找写另一侧的人对齐，而不是随机挑一个。

> [!WARNING]
> 解完冲突务必跑一遍测试再提交。`git checkout --ours/--theirs <file>` 可以整文件取一侧，但非常容易把对方的改动整个抹掉。

## 分支策略

- 分支要**短命**：活几天就合，拖两周的分支合并时必然是地狱
- 一个分支一个主题：一个功能或一个修复，别把多个任务混进同一分支
- 分支名让人看得懂：`feature/login`、`hotfix/crash-on-start`，好过 `dev2`、`test1`
- 分支随便建、随便删、随便改名——指针操作而已，零成本；真正需要敬畏的是改写历史（下一篇）
- 长期分支（main/release）只接受合并进入，不直接开发——来源始终清晰
- `main` 随时保持可用；团队约定大于工具，小团队用主干 + 短分支足够

相关阅读：[rebase 变基](05-rebase.md)
