---
title: 远程协作：同步对象数据库
order: 6
tags: remote, fetch, push, pull, PR, force-with-lease
summary: remote 的对象库本质与 refs/remotes 缓存模型、fetch/pull/push 的精确语义与配置化（pull.rebase）、跟踪分支与 ahead/behind、push 被拒的快进检查与 --force-with-lease、fork 工作流，以及 PR 协作的完整回路。
---

远程仓库不是「中央服务器上的特殊仓库」——它就是另一个普通的 Git 仓库。协作的全部内容是：**把你的对象库的新对象传过去，把对方的传回来**。理解这个模型，fetch/push/pull 的所有行为与报错都能推导。

## 1. remote：给另一个仓库起名字

```bash
git remote add origin https://github.com/team/app.git   # 起名 origin
git remote -v                                            # 查看远程（fetch/push 两个 URL）

git fetch origin        # 把远程的新对象与分支下载到本地
git push origin main    # 把本地 main 的新对象上传
```

fetch 之后本地的变化值得看清：

```bash
$ git fetch origin
$ git branch -vv
* main        a1b2c3 [origin/main: behind 2]  本地 main 落后了
* feat        d4e5f6 [origin/feat: ahead 1]   本地 feat 领先一个提交
```

关键事实：**fetch 只更新 `refs/remotes/origin/*`（远程分支的本地缓存），绝不碰你的工作区与本地分支**。你的 main 还是旧的，只是「Git 知道了远程的 main 到了哪」——「看到更新」与「合并更新」被刻意分开。

```bash
git log origin/main          # 看远程的新提交（不切分支就能 review）
git diff main origin/main    # 差异预览
```

## 2. pull 与 push：两个方向的整合

### 2.1 pull = fetch + 整合

```bash
git pull                     # fetch origin + merge 到当前分支（默认）
git pull --rebase            # fetch + rebase：把本地未推送提交摘到远程顶端
git config --global pull.rebase true    # 永远 rebase 式拉取（推荐配置）

git pull --ff-only           # 只允许快进：拉不下来（历史分叉）就报错，绝不制造意外合并
```

`pull --ff-only` 是保守派的利器：它把「远程有分叉更新需要决策」变成显式失败——你被迫先看清两边历史再选择 merge 还是 rebase，而不是 pull 默默造出一个混乱的合并提交。

### 2.2 push 的快进检查

```bash
git push                     # 推送当前分支（有上游时）
git push -u origin feat      # 首推：推送 + 建立跟踪关系（-u = --set-upstream）

# 远程有你没有的提交时：
! [rejected] main -> main (fetch first)
error: failed to push some refs ... (non-fast-forward)
```

push 的安全检查：**只允许快进**（你的提交是远程历史的延长线）。远程出现了你没有的提交时，普通 push 拒绝——防止「看不见的提交」被覆盖。标准响应：

```bash
git pull --rebase            # 把远程的新提交接进来（或 fetch + merge）
git push
```

除非你在改写**自己的**已推送历史（rebase 过的 PR 分支），否则不用强推；要用就用带保险的：

```bash
git push --force-with-lease  # 远程 ref 与你最后 fetch 时一致才允许强推（[第 4 篇](04-merge-rebase.md)）
```

## 3. 跟踪分支：本地与远程的绑定关系

「跟踪」是本地分支与远程分支的**默认对应关系**，它让大量命令省略参数：

```bash
git branch -vv               # 查看全部跟踪关系与 ahead/behind
git status -sb               # 当前分支的 ahead/behind 简报
git branch --set-upstream-to=origin/main main    # 补绑/改绑
git push -u origin feat      # 首推时一步建立
```

绑定后：`git push`/`git pull` 免参数；`git status` 提示领先/落后；`main@{u}` 引用上游；`git branch -r` 列远程分支。**远程分支的删除**：

```bash
git push origin --delete feat/old     # 删远程分支
git fetch --prune                     # 清理本地 refs/remotes 里已消失的远程分支缓存
git fetch -p                          # 同上（prune 建议常驻：fetch.prune true）
```

## 4. PR 流程：协作的标准回路

```bash
# ① 开分支干活，推到远程
git switch -c feat/search
git push -u origin feat/search

# ② 在平台上开 PR：目标 main —— PR 的 diff 就是 main...feat（[第 5 篇](05-history.md)）
# ③ review 意见来了：继续在这个分支上提交并 push（PR 自动更新）
git add -p && git commit -m "fix: 按 review 调整超时语义" && git push

# ④ review 期间 main 动了：更新分支（自己的分支可 rebase）
git fetch origin
git rebase origin/main
git push --force-with-lease

# ⑤ 合并（平台操作）：squash merge / merge commit / rebase merge —— 团队约定
# ⑥ 合并后清理
git switch main
git pull --ff-only
git branch -d feat/search               # 本地
git push origin --delete feat/search    # 远程（或平台自动删）
```

「review 后继续 push 到同一分支」是 PR 工作流的呼吸节奏——分支上的历史就是 review 的对话记录（所以 review 前的历史值得用 rebase -i 整理，review 后的修改则如实追加）。

### 4.1 fork 工作流：三方仓库

没有直接推送权限（开源项目）时，仓库分两层：

```bash
git remote add origin https://github.com/you/app.git     # 你的 fork
git remote add upstream https://github.com/org/app.git   # 官方仓库

git fetch upstream
git rebase upstream/main        # 永远从官方仓库更新
git push origin feat/x          # 推到自己的 fork
# 在官方仓库开 PR：you:feat/x → org:main
```

`origin` 只是「默认名」不是「官方」——fork 流里 origin 是你的副本，upstream 才是真源头。

## 5. 协作纪律

1. **main 不直接 push**：一律 PR（哪怕一行）——review、CI、可回滚的合并节点是集体资产。
2. **小 PR**：改动 < 400 行 review 质量显著更高（超过约 90 分钟评不完就倾向「LGTM 免检」）。
3. **push 前同步**：本地落后时先 pull --rebase，把集成冲突解决在自己手里。
4. **远程分支即备份**：每天 push 一次 WIP（标注 wip 前缀）比本地裸奔安全；团队约定哪些分支是私有的。
5. **强推只对自己的分支**、永远 --force-with-lease。

## 6. 陷阱清单

- 以为 fetch 会改工作区：它只更新远程缓存；pull 才整合。
- pull 默认 merge 造出意外的合并提交：`pull.rebase true` 或 `--ff-only` 显式化。
- push 被拒后直接 --force：覆盖他人提交；先 rebase/merge，强推一律 lease。
- fork 流里把 upstream 当 origin：推不上去还疑惑；remote -v 先看清两个 URL。
- 删了远程分支本地缓存还在：`fetch --prune`；长期开启 `fetch.prune`。
- 「push 了就算完成」：没 PR/没 review 的提交不在协作视野里。
- 复制粘贴别人的 remote URL 忘了 upstream：更新来源错位。

## 7. 小结

- remote 是给另一个仓库起名；fetch 只更新 refs/remotes 缓存不动工作区，「看到」与「合并」分离。
- pull = fetch + 整合：`pull.rebase true` 让拉取保持线性，`--ff-only` 把意外分叉变成显式失败。
- push 只许快进：被拒说明远程有新提交，标准响应是 `pull --rebase` 再推；强推一律 `--force-with-lease` 且只对自己的分支。
- 跟踪分支绑定本地与远程：免参数的 push/pull、ahead/behind 提示、prune 清理失效缓存。
- PR 回路：分支推远 → review 迭代（继续 push）→ 更新（rebase origin/main）→ 平台合并 → 双端清理；fork 流的 origin/upstream 分层。
- 纪律根植于模型：main 不直推、小 PR、push 前同步、WIP 上远程当备份。

## 8. 练习

**1.** 用 `git fetch` + `git log HEAD..origin/main` + `git diff` 完成「先看再合」的拉取流程，对比直接 `git pull`——列出两种姿势在「发现意外提交」时的应对差异。

> [!TIP]
> 思路fetch 先行让你能在 merge/rebase 前审阅远程的新提交（甚至 cherry-pick 挑选）；盲 pull 则被动接受整合结果。「审阅优先」是把远程当协作者而不是流水线。

**2.** 制造一次 push 被拒（同伴或自己用网页编辑器在远程加提交），分别用 `pull --rebase` 与 `pull --ff-only` 应对，观察后者如何把分叉变成显式失败。

> [!TIP]
> 思路--ff-only 在「本地已有提交 + 远程也有提交」时直接报错——它把「需要决策」从隐式合并变成红灯。日常配置 pull.rebase true 后，红灯只在真分叉时亮。

**3.** 在测试仓库完整走一遍 PR 回路（用本地「模拟远程」：`git init --bare remote.git` 当 origin），包括 review 修改、rebase 更新、squash 合并、双端清理，最后用 `git branch -a` 验证清洁。

> [!TIP]
> 思路裸仓库（--bare）没有工作区，正好当远程。全流程跑通一次，远程协作的每个环节就从「平台按钮」变成「命令序列」，平台只是这些命令的 UI。

**4.** fork 工作流演练：给一个开源项目（或自己拆两个目录模拟）配 origin/upstream 双远程，完成「同步官方更新 → 本地开发 → 推 fork → 开 PR」的循环，并写出「官方合并后如何同步你的 fork」的命令。

> [!TIP]
> 思路`git fetch upstream && git switch main && git rebase upstream/main && git push origin main`。fork 漂移是常态（main 落后官方几十个提交），定期同步 + 只在功能分支上干活可以少受其扰。

**5.** 演练「协作者强推了自己的 PR 分支」后你的本地状态：fetch 后 `git status` 显示什么？（diverged）正确的重新对齐步骤是什么？

> [!TIP]
> 思路对方的强推让 refs/remotes 的新哈希与你的本地历史无关——本地显示 diverged（各有各的）。你的本地分支只是他的旧版本 → 直接 `git reset --hard origin/feat`（你的本地提交若做过修改需先确认价值，reflog 兜底）。

**6.** 讨论：团队要不要把「WIP 每日 push」定为纪律？从「备份价值、CI/PR 噪声、隐私边界（wip 分支保护）」三方面给出方案。

> [!TIP]
> 思路方案：push 到 `username/wip-*` 前缀分支（CI 跳过、不进 PR 视图），每日下班前推。备份价值远大于成本——磁盘故障 = 全部历史蒸发；噪声问题用命名约定与分支保护规则隔离。
