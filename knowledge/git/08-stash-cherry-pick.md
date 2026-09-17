---
title: stash 与 cherry-pick
order: 8
tags: 进阶, stash, cherry-pick
summary: 手头改到一半要切分支？stash 存取现场；cherry-pick 精准搬运提交。
---

两个"救急"工具：stash 把做到一半的工作区整体封存，cherry-pick 把某一个提交单独搬到另一条分支。它们不改变你管理提交的主流程，但关键时刻省掉大量手工搬运。

## stash：把现场封存起来

场景：代码写到一半，线上出了 bug 要切分支修——未提交的改动要么跟着你走，要么挡着你切换。先存起来：

```bash
git stash                   # 把工作区和暂存区的改动存入栈，工作区恢复干净
git stash push -m "登录页改到一半"   # 带说明地存（强烈推荐）
git status                  # 现在工作区是干净的，可以随便切分支
# ... 切到别的分支修完 bug、提交、切回来 ...
git stash pop               # 取出最近的存档并从栈中删除，改动回到工作区
```

stash 是一个**栈**：最新的存档叫 `stash@{0}`，早先的依次往后排。存档不会出现在 `git log` 里（不在任何分支上），所以很容易忘了它的存在——`list` 命令记得常跑。

```bash
git stash list              # 查看所有存档
# stash@{0}: On feature/login: 登录页改到一半
# stash@{1}: WIP on main: a1b2c3 feat: 初始化
git stash apply             # 取出最近存档，但保留在栈里（还会再用时选这个）
git stash apply stash@{2}   # 取指定存档
git stash show -p stash@{0} # 查看某个存档的具体改动
git stash show --stat       # 只看某个存档动了哪些文件
git stash drop stash@{0}    # 删除某个存档
git stash clear             # ❌ 清空所有存档，不可恢复
```

pop 与 apply 的选择标准：确定只用一次选 pop；要在多个分支分别恢复试试选 apply。stash 的本体也是普通提交对象，挂在 `refs/stash` 引用上——`git log -g stash` 能按栈顺序浏览它的历史。

> [!WARNING]
> `git stash pop` 发生冲突时，存档**不会**自动从栈里删除——慌乱中很容易重复 apply。冲突后先 `git status` 确认状态，处理好再手动 `git stash drop` 清理。

> [!NOTE]
> stash 默认**不含 Untracked 文件**（新建还没 add 的）。要带上它们：`git stash -u`。

## stash 的进阶用法

```bash
git stash push -m "半成品" src/auth.rs   # 只存指定文件的改动
git stash branch hotfix-wip stash@{0}    # 基于存档时的提交建分支并恢复存档
git stash -k                # 只存暂存区之外的工作区改动（保留已暂存内容）
git stash -p                # 逐块挑选要存的内容，交互方式和 add -p 一样
```

stash 是临时停车场，不是版本管理。**超过一天的 stash 基本等于丢失**——不记得上下文、不敢 pop，最终 clear 了事。要留档就提交到分支，哪怕提交信息只写 "wip"。

> [!TIP]
> 现场较大时的替代方案：`git switch -c wip-xxx` 后直接 `git commit -am "wip"`，回来后 `git reset --soft main` 展开继续改。stash 适合几分钟到几小时的现场，分支适合更长的。

| | stash | wip 提交 + reset --soft |
| --- | --- | --- |
| 操作成本 | 一条命令 | 三条命令 |
| 暂存区状态 | 默认不保留 | 完整保留 |
| 可见性 | 容易遗忘在栈里 | 在 git log 里看得见 |
| 适合 | 几分钟到几小时的现场 | 隔夜的现场 |

## cherry-pick：精准搬运提交

cherry-pick 把**指定的某个提交**在当前分支重放一份（生成新哈希），其他提交一概不动。它和 rebase 的重放是同一件事，只是范围从"我的全部提交"缩小到"你点名的提交"。

```bash
git switch main
git cherry-pick a1b2c3              # 把 a1b2c3 这个提交搬到 main
git cherry-pick -x a1b2c3           # 同上，但提交信息末尾附上来源哈希，方便追溯
git cherry-pick a1b2c3^..d4e5f6     # 搬一段连续提交（^.. 写法包含 a1b2c3）
git cherry-pick --no-commit a1b2c3  # 只取改动不提交，自己整理后再提交
git log --oneline main..hotfix      # 先看看对方分支上有哪些提交可搬
git cherry-pick --abort             # 中途冲突想放弃
git cherry-pick --continue          # 解决冲突后继续
```

`-x` 留下的来源记录在排查"为什么同一处改动出现两次"时能对上账，跨分支搬运建议永远带上它。cherry-pick 也接受分支名，默认取该分支的最新提交：`git cherry-pick hotfix`。

典型场景：

- 线上 hotfix 分支修了 bug，要同步到 main 和 release 两条线
- feature 分支里混进一个应该立刻上线的提交
- 提交错到了错误分支，搬走后到原分支 revert

```bash
# 热修同步的标准走位：release 上修复，main 上搬运
git switch release
git commit -m "fix: 修复崩溃"
git switch main
git cherry-pick release        # 把修复搬回主线
```

## 冲突处理

cherry-pick 与 merge/rebase 一样会冲突，流程相同：编辑文件 → add → continue。

```bash
git status                  # 看哪些文件 both modified
# ... 手动解决冲突 ...
git add src/fix.rs
git cherry-pick --continue
```

冲突了又后悔，`--abort` 会回到 cherry-pick 之前的状态，与 rebase 的退出方式一致。stash pop 的冲突处理与此类似，差别只是结束后要手动 drop 存档。

## 用量的分寸

cherry-pick 产生的提交与原提交**内容相同、哈希不同**。同一段改动以两个身份出现在多条分支上，将来合并这些分支时可能出现"看似冲突实则相同"的麻烦。

- 一次搬运一两个提交：cherry-pick 合适
- 要搬整条分支的全部工作：那是 merge / rebase 的活
- 搬运前先确认目标分支没有同名改动，否则重放必冲突
- 发现自己定期把 A 分支搬向 B：说明分支策略该改了

已推送分支上的提交搬走了怎么办？在原分支用 revert 清理，别用 reset——规则和撤销篇讲的一致。搬运完尽快 push 同步，别让本地两条历史漂移太久。

相关阅读：[查看历史与找回](09-history.md)
