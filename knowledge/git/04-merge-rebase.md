---
title: 合并与变基：历史怎么汇合
order: 4
tags: merge, rebase, 冲突, interactive rebase, squash
summary: 三方合并的 base/ours/theirs 机制与冲突的本质、冲突解决的标准流程、rebase 的重放语义与黄金法则、交互式 rebase 整理历史的全部动词、--squash 与 --no-ff 的取舍，以及「何时 merge 何时 rebase」的决策表。
---

两条分支各自前进了，怎么汇合？Git 给了两个答案：**merge**（新建一个双亲提交把两条线缝在一起）与 **rebase**（把一条线的提交摘下来「重放」到另一条线顶上）。两者最终都得到同样的文件内容，差别只在**历史的形状**——而历史形状影响的是：bisect 的结果、review 的粒度、回滚的成本。

## 1. 三方合并：冲突的本质

### 1.1 机制

合并两个分支时，Git 找到它们的**共同祖先**（merge base），把三方（祖先、ours、theirs）一起比较：

```text
        base C2
       /      \
ours  C5      C3  theirs
       \      /
        merge commit C6（两个父节点）
```

| 情况                        | Git 的动作                        |
| --------------------------- | --------------------------------- |
| 只有一边改了文件             | 直接取改动的那边                    |
| 两边改成了一样               | 取（无冲突）                        |
| 两边改了同一文件的不同区域    | 两处修改都保留                      |
| **两边改了同一文件的同一区域** | **冲突**：Git 无法替你做语义决策    |

### 1.2 冲突标记的解读

```text
<<<<<<< HEAD
result = retry(fn, times=3)          ← ours：当前分支的版本
=======
result = retry(fn)                   ← theirs：被合并进来的版本
>>>>>>> feat/retry
```

冲突的本质是「**两个修改都对，但语义上必须二选一或融合**」——这是只有人能做的决定。Git 把三个版本的素材都摆出来（`git show :1:file` 祖先版、`:2:` ours、`:3:` theirs），选择权在你。

## 2. 冲突解决的标准流程

```bash
git merge feat/retry
# CONFLICT (content): Merge conflict in src/app.py

git status                       # 列出全部冲突文件（Unmerged paths）
# ① 逐文件编辑：解决 <<<<<<< ======= >>>>>>> 标记
# ② 标记已解决：
git add src/app.py
# ③ 完成合并：
git commit                       # merge commit（信息里保留合并语义）

# 中途反悔：
git merge --abort                # 回到合并前的状态（干净利落）
```

解决冲突的编辑原则：

1. **理解两侧意图再下手**：不是「选一边删另一边」，而是判断业务上正确的结果（可能两边都保留一部分）。
2. **解决完必须让代码自洽**：冲突区域可能引用彼此（一边改了函数签名、另一边还在旧调用），逐文件解决完要整体过一遍——编译/测试是冲突解决的验收标准。
3. **复杂冲突用工具**：`git mergetool`（三方对比界面）、VS Code/IDEA 的冲突视图——本质都是同时展示 base/ours/theirs 四格。

### 2.1 冲突的预防

冲突成本 = 漂移时间 × 共同修改面积。[第 3 篇](03-branches.md)的「小步合并」是主预防；再加两条：

- **合并方向在自己手里**：feature 分支合回 main 前先 `git rebase main`（见下节）把 main 的最新变化先拿进来——冲突在自己的分支上解决，而不是在 main 的集成时刻炸给全团队。
- **分工避开热点文件**：生成文件（锁文件、schema）与公共头部是冲突重灾区，能自动化（锁文件由工具生成）就自动化。

## 3. rebase：换一条历史线

### 3.1 语义：复制重放

```bash
git switch feat
git rebase main          # 把 feat 独有的提交「摘下来」，逐个重放到 main 顶端
```

```text
rebase 前：                        rebase 后：
main  ── A ── B                    main ── A ── B
       \                                   \── A' ── B'  ← feat
feat   └── A ── B                   （A'、B' 是**新 commit 对象**：内容同、哈希变，
                                      因为父变了 + 重放时间变了）
```

rebase 是「**复制提交链**」：原提交 A、B 被抛弃，新 A'、B' 逐个应用到 main 顶端。每一步重放都可能冲突（等于把「一次大合并」拆成「多次小合并」）——这就是 rebase 解决冲突的体验：逐提交解决，每个冲突只涉及该提交的上下文，比一次性大冲突好对付。

**重放中解决冲突的推进器**：

```bash
git rebase main
# CONFLICT: Fix it then continue.
# 编辑解决 → git add
git rebase --continue          # 继续下一个提交
git rebase --skip              # 跳过当前提交（内容已被其他提交吸收时）
git rebase --abort             # 全部反悔
```

### 3.2 黄金法则：公共历史不 rebase

rebase 改写 commit（新哈希）。如果那些提交**已经推送给别人**，你本地的新历史与远程的历史是两条岔路——同步只能强推，而强推会让所有协作者本地历史错乱。

```text
法则：只 rebase 你自己拥有、未推送的提交。
      一旦 push 到共享分支，历史即公共财产。
```

「但我的 feature 分支推上去了 PR 用」是常见情形——**自己一个人的 PR 分支**可以 rebase + `--force-with-lease` 强推（lease 检查远程没有别人的新提交才允许，比裸 `--force` 安全）。多人共享的集成分支（main/develop）绝对不 rebase。

```bash
git push --force-with-lease    # 覆盖自己 rebase 过的 PR 分支：先确认远程没别人动过
```

### 3.3 merge 还是 rebase：决策表

| 场景                                   | 推荐                 | 理由                                   |
| -------------------------------------- | -------------------- | -------------------------------------- |
| 把 main 的更新拿进自己的 feature 分支    | **rebase main**      | 历史线性、冲突逐个解决、PR 的 diff 干净   |
| feature 分支合回 main                    | merge（或 squash merge） | 集成动作应当可见、可整体回滚             |
| 自己的 PR 里提交乱七八糟，未合并前        | `rebase -i` 整理      | review 粒度由你决定                      |
| 多人共享的集成分支                        | 永远 merge            | 黄金法则                                 |
| 一个 feature 的 WIP 提交需要合并          | `merge --squash`      | 历史里不留「wip」「修一下」噪声           |

## 4. 交互式 rebase：历史的手术台

`rebase -i` 把一个区间的提交**摊开成清单**让你编辑：

```bash
git rebase -i HEAD~4          # 编辑最近 4 个提交
```

```text
pick a1b2c3 feat: 基础搜索功能
pick d4e5f6 fix: 修一下                ← 手滑提交的 WIP
pick 9a8b7c wip
pick 1c2d3e docs: 补注释

# 动词：pick 保留 | squash 并入上一个（保留信息合并）
#       fixup  并入上一个（丢弃信息）| reword  改信息
#       edit   停在这里（amend 补东西）| drop   删除
```

把清单改成：

```text
pick a1b2c3 feat: 基础搜索功能
fixup d4e5f6
fixup 9a8b7c
pick 1c2d3e docs: 补注释
```

结果：三个提交压成一个干净的功能提交。**这是「提交前没拆好」的后悔药**——但它只属于未推送的历史（黄金法则）。

相关利器：

```bash
git commit --fixup a1b2c3                 # 提交时标注「这是给 a1b2c3 的补丁」
git rebase -i --autosquash main           # 自动把 fixup 排到目标提交后面
git rebase --onto newbase oldbase feat    # 把分支嫁接到另一个基点（高级搬家）
```

## 5. merge 的两个变体

```bash
# --no-ff：即使能快进也强制生成 merge commit
git merge --no-ff feat/search
# 价值：merge commit 是「这批功能作为一个整体进入」的标记，
#      revert 这一个节点即可整体回滚整个功能 —— 团队集成的常见约定

# --squash：把整个分支压成一个提交（不生成 merge commit、不移动合并分支）
git switch main
git merge --squash feat/wip-mess
git commit -m "feat: 报表导出"            # 分支上的 20 个 WIP 提交 → 1 个干净提交
# 适用：feature 分支的提交没有保留价值（WIP 噪声），
# 代价：丢弃了逐提交历史（想保留就先 rebase -i 整理再正常 merge）
```

## 6. 陷阱清单

- 在共享分支上 rebase 后强推：协作历史错位；黄金法则 + `--force-with-lease`。
- 裸 `--force` 强推：可能覆盖别人的提交；一律 `--force-with-lease`。
- 冲突标记残留提交（<<<<<<< 还在文件里）：编辑不彻底；解决后编译/测试验收。
- 冲突逐文件解决不看整体：跨文件语义断裂；解决完整体跑测试。
- `merge --abort` 不敢用：它是最干净的反悔；合并中途随时可回。
- rebase 大长分支丢提交：重放失败处理不当；`--abort` 或 reflog（[第 7 篇](07-undo.md)）。
- squash 后还想找回分支细节：squash 前的提交靠原分支保留；删分支前想清楚。
- 把 rebase 当「消除冲突手段」用在集成分支：代价是历史改写；冲突预防靠小步合并。

## 7. 小结

- 三方合并以共同祖先为基准：只有「同区域双侧修改」才冲突——冲突是需要人的语义决策，不是 Git 的失败。
- 冲突流程：status 列单 → 逐文件解标记 → add → commit；`--abort` 随时反悔；验收标准是整体可运行。
- rebase = 复制重放：历史线性、冲突逐提交化整为零；黄金法则是「公共历史不 rebase」，强推一律 `--force-with-lease`。
- `rebase -i` 的动词（pick/squash/fixup/reword/edit/drop）是未推送历史的手术台，autosquash 让「提交时打补丁」成为工作流。
- merge 的变体：`--no-ff` 保留功能级回滚点，`--squash` 压缩噪声——选择取决于你想让历史记录什么。
- 决策表的根逻辑：**整合进共享历史用 merge（可见、可回滚），整理自己的工作用 rebase（干净、逐个解决）**。

## 8. 练习

**1.** 制造一次真实冲突（两分支改同一函数同一行），完整走一遍：status 列单 → 编辑 → add → commit；再用 `git merge --abort` 反悔重来，体会「可逆性」。

> [!TIP]
> 思路刻意制造「两边都改了同一行」的场景，观察标记中 ours/theirs 与祖先版本的关系。重点体验：冲突解决是「编辑代码」而不是「点按钮」，abort 的随时可退让心情稳定。

**2.** 用 rebase 把「自己的 feature 分支」更新到 main 最新（故意让 main 产生一次与 feature 冲突的提交），体验逐提交解决冲突与一次性 merge 冲突的差异。

> [!TIP]
> 思路rebase 的冲突每次只涉及一个提交的上下文，定位更快；代价是可能同一个冲突出现多次（每个涉及它的提交都要解一次）。两者是「批量 vs 分批」的经典权衡。

**3.** 造 5 个乱七八糟的提交（wip、typo 修复、真功能混杂），用 `rebase -i` 整理成 2 个原子提交；再用 `--fixup` + `--autosquash` 流程重做一遍，对比工作流。

> [!TIP]
> 思路fixup 流程把「整理」摊到了提交时点（提交时标注归属），rebase -i 只是最后收网。这是给「做不到每次都原子提交」的人设计的出口——先自由提交，后整理历史。

**4.** 解释为什么「PR 分支 rebase 后要 force-with-lease 而不能普通 push」，并模拟「协作者在分支上加了提交而你强推」的冲突现场（lease 如何拦住你）。

> [!TIP]
> 思路本地历史已改写（新哈希），普通 push 判定「非快进」被拒；force-with-lease 检查远程 ref 是否还是你记忆中的值——别人推进去过就拒绝。lease 把「强推」从核弹降级为带保险的操作。

**5.** 你的团队 PR 要求「线性历史 + 每个功能一个提交」。设计从 feature 分支到 main 的完整流程（含更新、整理、合入的每一步命令），并说明每步为什么存在。

> [!TIP]
> 思路`rebase main`（更新+解冲突）→ `rebase -i`（压成一个）→ `switch main && merge --ff-only feat`（保证快进合入）→ push。`--ff-only` 是「线性历史」的机器守卫：不能快进就拒绝，防止有人绕过流程直接 merge。

**6.** 讨论：merge --no-ff（保留合并节点）与 rebase + ff（纯线性）两种团队约定的优劣——从「整体回滚一个功能」「bisect 穿越合并点」「新人读历史」三个角度。

> [!TIP]
> 思路no-ff：功能整体回滚只需 revert 合并节点、但历史有菱形噪声；线性：bisect 干净、阅读直观、但「功能边界」要靠提交信息约定。多数团队的务实解：PR 级 squash（每个功能一个线性提交 + 信息里带 PR 号）。
