---
title: 撤销的艺术：按阶段分层回退
order: 7
tags: reset, revert, reflog, restore, 恢复
summary: 「要撤销的东西在哪个阶段」的决策树、restore 与 reset 三级（soft/mixed/hard）的精确语义、revert 作为共享历史的安全撤销、reflog 与 fsck 的终极恢复手段，以及「未推送可重写、已推送用反转」的总法则。
---

Git 最值钱的能力不是提交，是**撤销**——几乎任何失误都有回退路径，前提是你能回答一个问题：**「我要撤销的东西在哪个阶段？」** 工作区？暂存区？本地提交？还是已经推送的历史？位置不同，工具完全不同。本篇按决策树组织，终点是 reflog 兜底的完整恢复手册。

## 1. 决策树：先定位，再选工具

```text
要撤销的东西在哪？
├── 工作区的未暂存修改        → git restore <file>
├── 暂存区（add 早了）        → git restore --staged <file>
├── 最后一次本地提交          → amend（修补）或 reset（回退）
├── 多个本地提交              → git reset --soft/--mixed/--hard
├── 已推送的提交              → git revert（生成反向提交，不动历史）
└── 以为永远丢了的东西        → git reflog / git fsck --lost-found
```

总法则一句话：**未推送的历史可以重写（reset/rebase/amend），已推送的历史只能反转（revert）**——前者改写过去，后者向未来追加一个「抵消提交」，两条路线的读者不同（前者只有你，后者包括全团队）。

## 2. 工作区与暂存区：restore

```bash
git restore app.py                 # 丢弃工作区修改（回到暂存区版本）⚠️ 不可恢复
git restore --staged app.py        # 移出暂存区（修改保留在工作区）—— add 的反操作
git restore --source=HEAD~2 app.py # 从两个提交前拿回这个文件的版本
git restore --worktree --staged app.py   # 两边一起还原
```

第一条命令的危险等级最高：**未提交的修改没有对象兜底**（还没进数据库），丢弃即蒸发。手感没建立前，先 `git stash push` 再 restore——stash 至少是个可找回的抽屉（[第 8 篇](08-stash-cherry-pick.md)）。

## 3. reset：移动分支指针的三档力度

reset 的本质（[第 1 篇](01-object-model.md)）：**移动当前分支的指针**到指定提交，可选地同步暂存区与工作区。三档力度：

```bash
git reset --soft HEAD~1     # ① 只动分支指针：提交撤销，改动全在暂存区
git reset HEAD~1            # ② --mixed（默认）：指针+暂存区归位：改动在工作区（未暂存）
git reset --hard HEAD~1     # ③ 全动：指针+暂存区+工作区全回退——改动彻底消失（reflog 兜底）
```

```text
HEAD~1 ──── HEAD（要撤销的提交）

--soft :  分支指回 HEAD~1，改动留在 [暂存区]   → 重新组织后再次提交
--mixed:  分支指回 HEAD~1，改动留在 [工作区]   → 想重新分批 add 时用
--hard :  分支指回 HEAD~1，[全部] 归零         → 「这几次提交全不要了」
```

三个典型场景：

```bash
# 场景①：提交信息写错了 / 漏了文件（未推送）
git reset --soft HEAD~1
git add 修正的文件 && git commit -m "正确的信息"
# （等于 amend，但 amend 更直接——单提交修补首选 amend）

# 场景②：三个提交想合成一个（未推送）
git reset --soft HEAD~3 && git commit -m "feat: 完整功能"

# 场景③：实验分支整个不要了
git reset --hard origin/main        # 本地回到远程状态
```

`--hard` 的「彻底消失」是假象——commit 对象还在数据库里，reflog 记着指针走过的路（第 6 节）。真正的危险是 `--hard` 会**同时清掉工作区未提交的修改**，它们没有对象兜底，才是真丢失。

## 4. revert：共享历史的安全撤销

已推送的历史不能重写（协作者都基于它工作），撤销的方式是**向未来追加一个反向提交**：

```bash
git revert a1b2c3            # 生成一个「抵消 a1b2c3」的新提交
git revert HEAD              # 撤销最新提交
git revert a1b2c3..d4e5f6    # 批量撤销一段（按序逐个反向）
```

revert 与 `reset --hard` 的对比决定选用：

| 维度       | reset                      | revert                     |
| ---------- | -------------------------- | -------------------------- |
| 历史形状   | 改写（旧提交退出主链）        | 追加（旧提交仍在，后面加抵消） |
| 哈希       | 后续提交全变                 | 全部不变                     |
| 已推送场景 | ❌ 需强推（协作炸弹）         | ✅ 正常 push                  |
| 语义       | 「这些事没发生过」           | 「这些事被撤销了」（有记录）   |

**revert 合并提交**是多了一步判断的场景——合并提交有两个父节点，「撤销」要指明保留哪条主线：

```bash
git revert -m 1 <merge_commit_sha>    # -m 1：保留第一个父（通常是主线）那侧
```

撤销一个已上线的 feature 合并后想「重新合入」是个经典暗坑：直接再 merge 会发现「这些提交已经合过」而没有效果——正确姿势是 revert 掉那个 revert，或 rebase feature 后再合。

## 5. checkout 旧版本文件与 reset 的分工速记

```bash
git restore --source=v1.2 app.py    # 只还原某个文件到旧版本（保留其余）
git reset --hard v1.2               # 整个分支硬回退（历史改写）
```

口诀：**文件级回看用 restore --source，分支级回退用 reset（未推送）或 revert（已推送）**。临时想看看旧版本整个项目，`git switch --detach v1.2`（只读，不动任何分支）。

## 6. 终极恢复：reflog 与 fsck

### 6.1 reflog：HEAD 的行车记录仪

`git log` 记录提交图；`git reflog` 记录**你本地的每一步移动**——reset、rebase、checkout 全部留痕，默认保留 90 天：

```bash
$ git reflog
e4a3b8c HEAD@{0}: reset: moving to HEAD~3      ← 刚才的 reset
a1b2c3d HEAD@{1}: commit: feat: 干了一天的活    ← 被扔掉的那个提交还在！

git reset --hard a1b2c3d            # 一条命令回到 reset 之前
```

「任何本地失误，只要做过提交就有救」——reflog 是这句话的技术保证。常见恢复配方：

```bash
git reflog                                   # 找到目标位置
git reset --hard <sha>                       # 回去（分支指针也归位）

git branch rescue <sha>                      # 或先落成分支（更稳：不会被后续 reset 冲掉）
```

### 6.2 fsck：连 reflog 都没有的时候

对象仍在数据库但没有任何引用（包括 reflog 过期）时：

```bash
git fsck --lost-found        # 找出悬空（dangling）的 commit/blob
# dangling commit a1b2c3d... ← 就是它
git show a1b2c3d             # 确认内容后收编
git branch rescue a1b2c3d
```

### 6.3 删除分支与 stash 的恢复

```bash
# 误删未合并分支：reflog 里找它的最后位置
git reflog                                # 找到该分支 tip 的哈希
git branch feat/rescued <sha>

# 误 drop 的 stash：stash 本质是 commit，也在 reflog / fsck 里
git fsck --unreachable | grep commit
git show <sha>                            # 确认是丢的那个 stash
git stash store -m "recovered" <sha>      # 或直接 branch/cherry-pick 收编
```

## 7. 恢复现场手册（速查）

| 事故                              | 处方                                          |
| --------------------------------- | --------------------------------------------- |
| 改坏了没 add                       | `restore <file>`（无救，小心）或先 stash       |
| add 错了文件                       | `restore --staged <file>`                     |
| commit 信息写错（未推送）           | `commit --amend -m`                           |
| commit 漏文件（未推送）             | `add` 后 `commit --amend --no-edit`           |
| 想退回 N 个提交重组（未推送）        | `reset --soft/mixed HEAD~N`                   |
| 想完全丢弃本地若干提交              | `reset --hard HEAD~N`（reflog 兜底）          |
| 撤销已推送的提交                    | `git revert <sha>`                            |
| 撤销已上线的 feature 合并           | `revert -m 1 <merge_sha>`                     |
| reset --hard 后反悔                | `reflog` → `reset --hard <找回的sha>`         |
| 误删分支                           | reflog 找 tip → `branch <名> <sha>`           |
| 误 drop stash                      | `fsck --unreachable` → stash store            |
| rebase 中途乱了                    | `rebase --abort`；结束后反悔走 reflog         |
| 历史中混入密钥（已推送）            | 轮换密钥 + filter-repo/BFG 清洗 + 全员重克隆  |

## 8. 陷阱清单

- `restore`（无参数）当「后悔药」随手用：丢弃的是未提交修改，真蒸发；先 stash 再 restore。
- reset --hard 清掉未提交修改：对象库救不了「没进过库」的东西；hard 前先 status 确认没有未提交内容。
- 对已推送分支 reset + 强推：协作核弹；已推送一律 revert。
- revert 合并提交不带 -m：Git 不知道你要哪一侧；-m 1 通常是主线。
- revert 掉 revert 之后又想撤销：语义套娃，画 commit 图理清再动手。
- 以为 `git rm` 的文件救不回：已提交内容都在库里；未提交的才是真丢。
- reflog 依赖被 GC 破坏：越早恢复越稳；重要现场先落成 branch。
- 密钥泄露只删文件不洗历史：历史里永远可查；轮换是第一优先。

## 9. 小结

- 撤销的第一问是「在哪个阶段」：工作区（restore）、暂存（restore --staged）、本地提交（amend/reset）、已推送（revert）、一切兜底（reflog/fsck）。
- reset 三档是「动指针 + 可选同步暂存与工作区」：soft 留暂存、mixed 留工作区、hard 全清——「彻底消失」只对已提交内容是假象。
- 总法则：未推送可重写、已推送用 revert（反向提交保留痕迹、哈希稳定、可正常推送）；revert 合并用 -m 指定主线。
- reflog 是本地 HEAD 的行车记录仪（90 天）：reset/rebase/删分支的恢复入口；fsck --lost-found 兜底无引用对象；stash 是特殊 commit 同样可救。
- 密钥泄露的处理顺序：轮换第一、清洗第二——历史里的秘密永远是秘密。

## 10. 练习

**1.** 在测试仓库依次体验 reset 三档：三个提交后分别 soft/mixed/hard 回退一个，每次用 `status`/`diff`/`diff --staged` 记录三区状态，画出三档的作用面。

> [!TIP]
> 思路soft 后 diff --staged 显示改动；mixed 后 diff 显示改动而 --staged 为空；hard 后全部为空。三档就是「指针必动 + 暂存区？+ 工作区？」的布尔组合。

**2.** 演练「revert 一个已推送的提交」与「事后重新引入」：revert 后再 revert 那个 revert，观察 `git log --oneline` 的形状，说明为什么这是共享历史上「反悔的反悔」的标准姿势。

> [!TIP]
> 思路revert-of-revert 生成新的正常提交，原提交、抵消提交、再抵消全部留痕——历史的每一步都可见可追。这就是「向未来追加」哲学的完整形态。

**3.** 复现第 1 篇练习 4 的分离 HEAD 孤儿提交，这次故意让 reflog「过期」（`git reflog expire --expire=now --all && git gc --prune=now`，仅在测试仓库），再用 `git fsck --lost-found` 尝试找回，体验两道安全网的层级。

> [!TIP]
> 思路reflog 清空后对象变成完全悬空，fsck 仍能列出（直到 gc 真正清除）。实验结论：时间越长、GC 越勤，找回越难——「尽快恢复」不是口号。

**4.** 用 reflog 救回一个「误删的未合并分支」：建分支、提交、`branch -D` 强删、reflog 找 tip、重建。写出完整命令序列。

> [!TIP]
> 思路`git branch -D` 的输出其实直接打印了被删分支的哈希（保留习惯：删除前先记）。reflog 中 `checkout: moving from ... to ...` 与 `commit:` 条目都能定位 tip。

**5.** 设计团队的「事故响应手册」：为「误推密钥、误强推共享分支、rebase 中断混乱、误删 main」四种事故各写一段三步内的应急流程，并标注每步的风险等级。

> [!TIP]
> 思路误推密钥：轮换密钥（第一）→ 通知协作者暂停拉取 → filter-repo 清洗 + 强推 + 全员重克隆。误强推：立即 --force-with-lease 恢复原状（reflog/远程缓存）→ 通知。预案的价值在事故发生时不需要发明流程。

**6.** 讨论：为什么 `git push --force` 被很多团队直接禁用而 `--force-with-lease` 可被允许？从 lease 的检查机制推导它防住了什么、防不住什么。

> [!TIP]
> 思路lease 防住「覆盖他人新推送」（远程 ref 变过就拒绝）；防不住「你在 fetch 后、强推前这一瞬间的他人推送」（窗口极小）与「多人约定 lease 基线一致但语义冲突」。工程答案：lease + 保护分支 + 个人分支隔离三层。
