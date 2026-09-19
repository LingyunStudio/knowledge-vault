---
title: 分支：指针的艺术
order: 3
tags: branch, switch, HEAD, 分支策略, trunk-based
summary: 分支作为 41 字节指针的全部行为推导、switch 与 checkout 的职责分离、未提交修改在切换时的两条命运、快进与三方合并的图景预览，以及从 Git Flow 到 trunk-based 的分支策略光谱与选型。
---

「分支很贵」是 CVS/SVN 时代的记忆——拷贝整个目录。Git 的分支是**41 字节的文件**（一个 SHA 哈希），创建与切换近乎零成本。这个成本差异改变的不只是速度，而是**工作方式**：因为分支免费，你可以为任何实验、任何想法开分支——分支从「管理资源」变成「思维工具」。

## 1. 分支的全部行为都从「指针」推出

[第 1 篇](01-object-model.md)已确认：`refs/heads/分支名` 是一个存着 commit 哈希的文本文件。由此推出一切：

```bash
git branch                    # 列出分支（本质：ls refs/heads/）
git branch feat/search        # 创建分支：复制当前 HEAD 的哈希写入新文件（不切换！）
git switch feat/search        # 切换：HEAD 改指向该分支 + 工作区更新到那个快照
git switch -c feat/search     # 创建并切换（-c = create；等价老语法 checkout -b）
git branch -d done-branch     # 删除（已合并才允许——防丢提交）
git branch -D messy-branch    # 强删（未合并的内容真的会丢，除非 reflog 兜底）
git branch -m old new         # 重命名（指针文件改名而已）
```

```text
提交前：                          提交后（在 feat 上）：
main ──→ C1                      main ──→ C1
feat ──→ C1（刚建，同指 C1）        feat ──→ C2 ←─ HEAD
                                          （main 纹丝不动：分叉了）
```

「分叉」的本质：两个指针指向了不同的 commit。合并（[第 4 篇](04-merge-rebase.md)）就是让两条链重新汇合的操作。

## 2. switch/restore：checkout 的全能职责被拆分

`git checkout` 历史上同时干三件事（切分支、检出文件、分离 HEAD），语义过载。Git 2.23 把它拆成两个**意图明确**的命令：

| 老命令                    | 新命令                          | 语义                   |
| ------------------------- | ------------------------------- | ---------------------- |
| `git checkout feat`       | `git switch feat`                | 切分支                  |
| `git checkout -b feat`    | `git switch -c feat`             | 建分支并切换             |
| `git checkout HEAD~2`     | `git switch --detach HEAD~2`     | 分离 HEAD（明确标注）    |
| `git checkout -- f.txt`   | `git restore f.txt`              | 丢弃工作区修改           |
| `git checkout HEAD~2 -- f`| `git restore --source=HEAD~2 f`  | 从历史版本恢复文件       |

新代码一律用 switch/restore——「丢弃工作区修改」和「切分支」是两种意图，塞在一个命令里正是事故来源（想切分支却把文件改坏了）。

## 3. 切换时未提交的修改去哪了

切换分支会更新工作区——那没提交的修改呢？Git 的规则是**尽力带着走**：

```bash
# 情形①：修改与目标分支的文件无冲突 → 修改被带到新分支
git switch feat        # 未提交的修改跟着走（它们不属于任何分支）

# 情形②：与目标分支的文件冲突 → 拒绝切换
error: Your local changes to the following files would be overwritten by checkout

# 情形③：想留下来？三选一
git stash push -m "wip"        # 收进暂存栈（[第 8 篇](08-stash-cherry-pick.md)）
git commit -m "wip"            # 先提交（回头 amend/rebase 整理）
git switch -c new-idea         # 直接把修改带进一个新分支（最常见！）
```

情形③是分支「免费」的直接体现：写到一半发现方向不对，`switch -c` 一个新分支继续——原分支毫发无损。**实验性思维的摩擦力为零**，这是 Git 对开发方式的真正改变。

## 4. 合并的两张脸（预览）

两条分支的分叉如何合流，取决于历史形状：

```text
快进（fast-forward）：feat 没有分叉、只是领先
main ──→ C1 ←── feat 切出          合并后：main ──→ C3（指针直接前移）
          └─ C2 ── C3 ←── feat      无新 commit，历史保持直线

三方合并（three-way）：两边都各自有新提交
main ──→ C1 ──→ C5（main 上也动了）      合并后：出现「双亲」的合并 commit C6
          └─ C2 ── C3 ←── feat                 C1 ── C5 ──→ C6 ←── main
                            \──→ C6 ←── feat
```

细节、冲突解决与 rebase 的取舍全部在[第 4 篇](04-merge-rebase.md)。这里只需要记住：**fast-forward 是指针移动，三方合并是新节点**——两者在历史上留下的痕迹不同（直线 vs 菱形），这正是团队要约定「怎么合」的原因。

## 5. 分支策略：光谱与选型

### 5.1 光谱两端

```text
Git Flow（重）                        Trunk-Based（轻）
main（生产）                          main（唯一长期分支）
 └ develop（集成）                      │ 短命分支（1~2 天）直接合回 main
    ├ feature/*（长命分支）              │ 未完成功能用 feature flag 隐藏
    ├ release/* └ hotfix/*
适合：发版节奏固定、多版本并行维护        适合：持续部署、小步快走、强 CI
```

中间地带是 **GitHub Flow**：main + 短命 feature 分支 + PR review——多数中小团队的最佳点。

### 5.2 无论哪种策略都通用的纪律

1. **分支短命**：超过一周不合并的 feature 分支，冲突成本指数增长（与 main 的漂移越大，合并越痛）。「小步合并」胜过「憋大招」。
2. **main 可发布**：main 上每个 commit 都应该可部署（CI 守住）。
3. **命名有语义**：`feat/search`、`fix/401-loop`、`chore/deps`——分支名是临时的提交信息。
4. **合并前同步**：合回 main 前先更新（rebase main 或 merge main 进来），把冲突解决在自己手里而不是集成时。

```bash
# 分支的日常体检
git branch -vv                  # 每个分支 + 跟踪关系 + 领先/落后
git branch --merged main        # 已合并的（可安全删除的候选）
git branch --no-merged main     # 还没合的（别删！）
```

## 6. 分离 HEAD 的正确用法

```bash
git switch --detach v1.2.0      # 检出某个 tag/commit 只读查看、构建、调试
# 在这里提交 → 孤儿 commit（不被任何分支指着，GC 后消失）
```

分离 HEAD 不是错误状态——它是「我不在开发线上的任何分支」的准确表达。用它做考古、复现旧版本 bug；想在此提交就先 `switch -c` 落地一个分支（[第 1 篇](01-object-model.md)练习 4 的救援流程）。

## 7. 陷阱清单

- `git branch feat` 后忘 switch：分支建了但 HEAD 还在原地，提交进了老分支。
- 删分支前不看 `--merged`：`-D` 真的会丢未合并提交（reflog 可捞，但别赌）。
- 长命 feature 分支憋大招：与 main 漂移导致合并地狱；小步合。
- 切换分支被拒后用 `-f` 强切：未提交修改直接丢；先 stash/commit。
- 分离 HEAD 上直接提交：孤儿 commit；先 `switch -c`。
- 把分支当「完整副本」手动备份：分支就是指针，`branch -m` 重命名即可。
- checkout 的文件级丢弃误伤：`restore` 明确意图后再回车。

## 8. 小结

- 分支 = 41 字节指针：创建零成本、切换是「改 HEAD + 同步工作区」；分叉就是两个指针指向不同 commit。
- switch/restore 把 checkout 的过载职责拆开：切分支用 switch、文件恢复用 restore——意图显式化降低误操作。
- 未提交修改随切换「尽力带走」；冲突时 Git 拒绝，三选一：stash、先提交、或 `switch -c` 带去新分支。
- 快进合并是指针前移（直线历史），三方合并是双亲新节点（菱形历史）——策略约定的根源。
- 策略光谱从 Git Flow 到 trunk-based，共性纪律是「分支短命、main 可发布、合并前同步」。
- 分离 HEAD 是合法的只读状态；想提交先落地分支。

## 9. 练习

**1.** 在仓库里手动「看穿」分支：`cat .git/HEAD` 与 `cat .git/refs/heads/*`，提交一次后再看，验证「分支指针随提交前移、HEAD 是符号引用」。

> [!TIP]
> 思路提交前后对比 refs/heads 下文件内容的变化——40 位哈希换成新提交的。所有「分支怎么工作」的疑惑都可以用 `cat` 直接观察。

**2.** 制造切换被拒的场景（修改 main 上的文件后 `switch` 到一个该文件不同的分支），分别体验 stash、先提交、`switch -c` 三种出路，比较各自留下的后续工作。

> [!TIP]
> 思路stash 要记得 pop（[第 8 篇](08-stash-cherry-pick.md)）；先提交要整理历史；`switch -c` 最顺手但前提是「这个修改本就该在新分支」。三条路对应三种「修改的真实归属」。

**3.** 用 `git log --graph --all --oneline` 复现快进合并与三方合并的两种历史形状，然后回答：你的团队希望 `git log` 长什么样？为什么？

> [!TIP]
> 思路快进 = 直线；三方 = 菱形。直线利于 revert 序列与阅读；菱形保留了「真实发生过分叉并行」的信息。没有标准答案，有标准答案的是「全团队一致」。

**4.** 体验分离 HEAD 的用途：检出项目某个旧 tag，复现一次构建或运行，然后回 main。在分离 HEAD 上提交一次并观察 `git log --all` 找不到它。

> [!TIP]
> 思路孤儿 commit 在 `git reflog` 里可见——「reflog 是本地安全网」的又一实证。养成习惯：分离 HEAD 上想动手，先 `switch -c`。

**5.** 你的团队是「每周发版 + 多客户定制版本」场景，在 Git Flow、GitHub Flow、trunk-based 中选型，并列出所选策略下「hotfix 生产 bug」的完整命令序列。

> [!TIP]
> 思路多版本并行维护 → Git Flow 或其变体（release 分支持续存在）；hotfix 流：从生产 tag 切 hotfix 分支 → 修复 → 打 tag 回 main/develop。选型的依据是「维护多少个并存的版本」与发布频率，不是流行度。

**6.** 解释为什么「分支短命」不是口号而是数学：用一个 feature 分支落后 main 两周的例子，估算冲突解决成本与冲突文件数的增长关系。

> [!TIP]
> 思路漂移文件数 ≈ 两边改动文件的并集增长，冲突概率随共同修改文件数上升；两周的 main 改动可能波及你改过的每个文件。小步合并把 N 次大冲突变成 N 次小冲突——总成本严格更低。
