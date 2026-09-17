---
title: 远程协作
order: 6
tags: 核心, remote, push
summary: remote/push/pull/fetch 的关系、跟踪分支、PR 协作与分叉同步。
---

本地仓库再好用，协作也要有"真相之源"。远程仓库（GitHub/GitLab/自建服务器）就是全员公认的基准。本篇讲清 remote、fetch、pull、push 的真实关系，以及 PR 协作的完整走位。

## remote：给远程仓库起名字

remote 只是一个**书签**：远程仓库的 URL 加一个短名字，仅此而已。记不清有哪些书签？`git remote -v` 永远是第一步。

```bash
git remote -v               # 查看已配置的远程（origin 是克隆时的默认名）
git remote add upstream https://github.com/original/repo.git   # 添加第二个远程
git remote rename origin src     # 重命名
git remote remove origin    # 删除（只删书签，不动远程仓库本身）
git ls-remote origin        # 直接查询远程的引用，不经本地缓存
```

- `origin`：你克隆来的地址，通常是你有推送权的仓库
- `upstream`：项目的原始仓库（fork 场景），你一般只有读权限

一个本地仓库可以同时配多个 remote（origin、upstream、镜像……），push/pull 时用名字指定即可。remote 只关心 URL，协议可以是 https、ssh 甚至本机另一块盘上的路径——"远程"不等于"在互联网上"。书签本身不存任何数据，删了重加零成本。远程仓库自己不"工作"——它只是所有共享对象的存放点，在众人的 push/pull 之间保持同步。

## fetch 与 pull 的区别

> [!NOTE]
> 这是最常被混为一谈的一对。**fetch 只下载远程的新提交，完全不动你的工作区**；pull = fetch + merge（或 rebase），会直接改你的分支。
> 多人协作的节奏：开工先 pull，收工前 push——把冲突消灭在最小的窗口里。

```bash
git fetch origin            # 只下载新提交，更新 origin/main 等远程跟踪分支
git log main..origin/main --oneline   # 看看远程比本地多了什么
git merge origin/main       # 满意之后再合并进来

git pull                    # = fetch + merge，一步到位（可能产生合并提交）
git pull --rebase           # = fetch + rebase，历史保持线性
git pull --ff-only          # 只允许快进，分叉直接失败——想守住主干线性时用
git fetch --prune           # 顺便清理远程已删除的分支在本地残留的引用
```

推荐习惯：**先 fetch 看一眼，再决定怎么合**。pull 不是错，但闭眼 pull 会把冲突和惊讶一起带进工作区。

> [!TIP]
> 每次开始工作先 fetch，写代码前 rebase 到最新——冲突越早解决，规模越小。

```bash
# 标准同步流程：先看，再合，最后推
git fetch --all --prune              # 拉取全部远程并清理残余引用
git log --oneline HEAD..origin/main  # 主线上有什么新东西
git rebase origin/main               # 把自己的工作搬到新主线之上
git push
```

还要说明一点：fetch/pull 只影响**当前分支的工作区**，其他本地分支不会被动合并——远程的新提交先进远程跟踪分支，等你决定怎么处理。

## 跟踪分支

本地分支可以和远程分支建立"跟踪"关系：

```bash
git branch -vv              # 查看各分支的跟踪状态与领先/落后
git push -u origin dev      # 首次推送并建立跟踪（-u = --set-upstream）
git branch --track dev origin/dev   # 基于远程分支创建本地分支
git switch dev              # 远程有同名分支时，直接建本地分支并自动跟踪
```

建立跟踪后，`git status` 会告诉你"领先 2、落后 1"，`git push` / `git pull` 不带参数也知道和谁比。跟踪关系随时可改绑：`git branch -u origin/dev`。落后/领先的具体内容：`git log @{u}..HEAD` 看本地独有，`git log HEAD..@{u}` 看远程独有。`@{u}` 是"当前分支的上游"的简写。

`origin/main` 这样的**远程跟踪分支**是本地记录的"远程上次已知状态"，只在 fetch（或成功 push）时更新——它可能已经过期，做过期快照的判断时要小心。远程跟踪分支也能直接查日志：`git log origin/main`，看远程进度不用切分支。

## push：把提交送出去

```bash
git push                    # 推送当前分支到它跟踪的远程分支
git push origin dev         # 推到指定远程和分支
git push origin --delete dev    # 删除远程分支（合并完成后清理用）
git push origin dev:main        # 推到不同名的分支（本地 dev → 远程 main）
git push --force-with-lease # ❌ 覆盖远程历史——仅在确认无人依赖旧历史时使用
```

> [!WARNING]
> 永远不要对共享分支 `push --force`。用 `--force-with-lease` 代替：如果远程在你上次 fetch 之后有新提交，推送会被拒绝，避免覆盖别人的工作。公共分支上的历史修正一律走 revert（见撤销篇）。

push 被拒绝（non-fast-forward）只有一种常见原因：远程有你没有的提交。标准处理是 `git pull --rebase` 把自己的提交搬上去，再推；改写了历史才需要强推。另外，推送标签是独立动作：`git push origin v1.0.0`（详见标签篇）；`push.default` 默认为 simple——只推同名分支，新手友好。

## PR 协作：典型的团队走位

```bash
git switch -c feature/login        # ① 开功能分支
# ... 开发、提交 ...
git fetch origin                   # ② 同步远程
git rebase origin/main             # ③ 变基到最新主干，减少 PR 冲突
git push -u origin feature/login   # ④ 推送并建立跟踪
git push --force-with-lease        # ⑤ rebase 后分支需要覆盖推送（仅限自己的分支）
# ⑤ 平台上发起 Pull Request → review → 合并 → 删除远程分支
```

平台通常给三种合并方式：merge commit（保留全部历史）、squash and merge（把分支压成一个提交进主干）、rebase and merge（线性拼接）。小而碎的功能分支推荐 squash——主干上它永远是单个完整的功能提交。

PR 的价值在 review 和 CI 卡点，而不是"不许直接 push"的流程本身。在平台上把 main 设为受保护分支（禁止直推），比口头约定有效得多。review 意见改完直接 push，PR 自动更新，不用重新发起；PR 要小——一个 PR 只做一件事，几百行和几行的 review 质量天差地别。

## fork：给不认识的人递代码

没有推送权限时：fork 一份到自己账号 → clone 自己的 fork → 开分支推送 → 向上游发 PR。

```bash
git remote add upstream https://github.com/original/repo.git   # 指向上游
git fetch upstream          # 拉取上游更新
git rebase upstream/main    # 让自己的分支跟上主线
```

PR 合并后记得删分支、同步 fork。fork 的 main 落后一点没关系，feature 分支跟紧 upstream/main 才是关键。平台上的 Sync fork 按钮就是这套命令的图形化等价物。

> [!TIP]
> fork 仓库的 main 保持"只用来同步上游"，开发永远在 feature 分支上——这样每次同步都是干净的快进，不用纠结冲突。

相关阅读：[撤销与回退](07-undo.md)
