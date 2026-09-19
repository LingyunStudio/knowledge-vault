---
title: Git 的对象模型：内容寻址的世界
order: 1
tags: 对象模型, blob, tree, commit, SHA, 内容寻址
summary: Git 的四类对象与内容寻址存储、.git/objects 的真实结构、commit 链与分支指针的关系、SHA 哈希如何同时完成寻址与完整性校验，以及「先懂数据库再学命令」为什么是学 Git 的正确顺序。
---

大多数人学 Git 是从命令开始的：add、commit、push——背一堆咒语，出了事就 Google。这条路的问题在于：**命令只是对底层数据库的操作**，不理解对象模型，每个事故都变成「玄学」。而 Git 的对象模型其实出奇地小：四类对象、一种寻址方式、一个快照模型。理解它之后，分支、变基、撤销这些「高级操作」都会降维成「移动指针」。

先立一个反直觉的观念：**Git 不是「记录差异」的工具，而是「存储快照」的内容寻址数据库**。每次提交存的是整个项目在那时刻的完整快照（去重后），差异只是你查看历史时临时计算出来的视图。

## 1. 四类对象

Git 数据库里只有四种对象，每种都由「内容 + 类型」唯一决定：

| 对象         | 内容                                | 作用                 |
| ---------- | --------------------------------- | ------------------ |
| **blob**   | 文件的字节内容（不含文件名、不含元数据）              | 存「每个文件的内容」         |
| **tree**   | 一组「文件名 → blob/子 tree」的目录清单        | 存「目录结构」            |
| **commit** | 一个 tree + 父 commit + 作者/时间 + 提交信息 | 存「一个快照 + 它在历史中的位置」 |
| **tag**    | 指向某对象的签名标注（annotated tag）         | 存「带说明的里程碑」         |

看真实数据最直观。`git cat-file` 让你直接读取数据库：

```bash
$ git init demo && cd demo
$ echo "hello" > a.txt
$ git add a.txt
$ git cat-file -p $(git hash-object a.txt)
hello                          ← blob：就是文件内容本身，连文件名都没有

$ git commit -m "first"
$ git cat-file -p HEAD
tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904   ← 指向根目录快照
author Alice <a@x.com> 1726000000 +0800
message first                  ← commit：快照 + 父指针 + 元数据

$ git cat-file -p HEAD^{tree}
100644 blob e965047ad7e5e0b1...    a.txt    ← tree：文件名 ↔ blob 的映射
```

关键理解点：

1. **blob 与文件名解耦**。文件名存在 tree 里，内容存在 blob 里——重命名文件时，内容 blob 完全不变（内容寻址），只有 tree 变了。这就是 Git 处理重命名几乎零成本的原理。
2. **tree 是递归的**。子目录是独立的 tree 对象，被父 tree 引用——整棵目录树快照即一棵对象树。
3. **commit 指向树，不指向差异**。`git diff` 看到的差异是两个快照临时算出来的。

## 2. 内容寻址：SHA 如何同时做三件事

每个对象的 ID 是它内容的 SHA-1 哈希（正迁移 SHA-256）：

```text
object_id = SHA1( "blob 6\0hello" )   ← 类型 + 长度 + 内容 一起参与哈希
```

这一个设计同时完成了三件事：

1. **寻址**：内容即地址。`e965047a...` 这个 40 位十六进制就是 blob 在 `.git/objects/` 里的存放路径（前两位做目录分桶：`.git/objects/e9/65047a...`）。
2. **完整性**：内容改一个字节，哈希全变——数据库自带校验，`git fsck` 能发现任何损坏。
3. **去重**：相同内容必然相同 ID。100 个文件里有 80 个 `package.json` 相同？只存一份 blob。历史版本间没改动的文件？新快照直接引用旧 blob——这就是「快照模型不比差异模型更占空间」的原因（加上 packfile 的增量压缩，实际存储极其紧凑）。

> [!NOTE]
> **commit 的 SHA 是「承诺」**：commit 对象的内容包含父 commit 的哈希，父又包含祖父……所以每个 commit 的哈希实际上覆盖了它之前的整条历史。改历史（rebase/amend）必然改变后续所有 commit 的哈希——这就是「已推送的历史不能改」在数学上的原因。

### 2.1 .git/objects 的三种存储形态

```bash
ls .git/objects
# e9/  4b/  ...        松散对象：每个对象一个文件（zlib 压缩）
# pack/                打包对象：多个对象打成一个 packfile（增量压缩 + 索引）
# info/
```

新对象以松散形式写入；对象多了（或 push/fetch 时）`git gc` 把它们打包成 **packfile**——相似内容做 delta 增量压缩。`git cat-file -p <sha>` 不管形态都能读，这就是「Git 是数据库」的直接证据：**它的底层有存储格式，但所有操作都通过对象层**。

## 3. 引用系统：给哈希起名字

40 位哈希没法记，Git 用**引用（ref）**给关键 commit 起名字：

```bash
$ cat .git/HEAD
ref: refs/heads/main           ← HEAD：当前在哪个分支

$ cat .git/refs/heads/main
e4a3b8c9d2...                  ← 分支：就是一个 40 字节的文本文件！

$ cat .git/refs/heads/feature
9f1c2b3a8d...                  ← 另一个分支：另一个文件
```

「分支只是一个指向 commit 的可移动指针」——这句话现在是字面事实。创建分支 = 写一个 41 字节的文件（`git branch` 的真实开销）；切换分支 = 改 HEAD 指向 + 更新工作区文件。

引用的三层结构：

```text
HEAD                 → 「当前检出位置」的符号引用
refs/heads/分支名     → 本地分支（可移动指针，随提交前进）
refs/remotes/远程/分支 → 远程分支的「上次见到」的本地缓存副本
refs/tags/标签名      → 标签（轻量 tag 就是一个 ref；annotated tag 是 tag 对象）
```

**HEAD 的三种状态**影响一切操作的行为（后面撤销篇会用到）：

| HEAD 状态         | 含义                     | 提交时发生什么           |
| --------------- | ---------------------- | ----------------- |
| 挂在分支上（正常）       | `ref: refs/heads/main` | 分支指针随提交前进         |
| 分离（detached）    | 直接指向某个 commit          | 提交成了「孤儿」，随时可能被 GC |
| 未出生（unborn，空仓库） | 指向尚不存在的分支              | 第一次提交创建分支         |

## 4. 快照模型：一次提交到底存了什么

把一次提交解剖到底：

```text
commit a1b2c3 (parent: 9f8e7d)
└── tree root-2024
    ├── tree src/
    │   ├── blob main.py
    │   └── blob util.py
    ├── tree docs/
    │   └── blob readme.md
    └── blob .gitignore

提交后你修改了 src/main.py 并再次提交：
commit d4e5f6 (parent: a1b2c3)
└── tree root-2024-v2
    ├── tree src/
    │   ├── blob main.py-v2     ← 只有这个 blob 是新的
    │   └── blob util.py        ← 引用旧的：内容没变
    ├── tree docs/               ← 引用旧的
    └── blob .gitignore          ← 引用旧的
```

新提交只新增了「改变的对象」，未变的部分沿引用复用。**历史就是一棵不断分叉复用的对象图**——理解了这个图，后面所有命令都可以翻译成图操作：

| Git 术语          | 图操作                 |
| --------------- | ------------------- |
| commit          | 新建 commit 节点，分支指针前移 |
| branch          | 新建指向当前 commit 的指针   |
| merge           | 新建有两个父节点的 commit    |
| rebase          | 复制一串 commit 节点挂到新位置 |
| reset           | 移动分支指针              |
| checkout/switch | 移动 HEAD + 同步工作区     |

## 5. 三个「区」：工作区、暂存区、仓库

对象模型之上，Git 的日常工作流围绕三个区域：

```text
工作区（你的文件）──git add──→ 暂存区（index，下次提交的快照草稿）──git commit──→ 仓库（对象库）
     ↑←── git restore（丢弃工作区修改）──↑        ↑←── git reset（撤回暂存）──↑
```

暂存区（index）是初学者最困惑的概念，它的本质是：**「下一次提交的快照」的草稿区**。`git add` 的意义不是「添加文件」，而是「把这个文件的当前内容记入草稿」——之后你再改文件，草稿里仍是旧版本，直到再次 add。这就是为什么「改了 A 和 B，只想提交 A」成为可能：`git add A && git commit`。

```bash
git status                    # 三区的差异报告（最重要的日常命令）
git diff                      # 工作区 vs 暂存区
git diff --staged             # 暂存区 vs 上次提交
git diff HEAD                 # 工作区 vs 上次提交（两者之和）
```

## 6. 什么时候不该用 Git 的方式思考

对象模型解释一切，但也别过度仪式化：

1. **日常 90% 的操作只需要三区模型**：status → add → commit → push。对象模型在你「需要理解为什么」时才登场——但登场时能救命。
2. **不要背 SHA**：用 `HEAD`、`HEAD~3`、`main@{yesterday}`、分支名引用 commit（[第 5 篇](05-history.md)）。
3. **小仓库不必 gc 优化**：Git 的存储效率在百万对象级别才需要人工干预。

## 7. 陷阱清单

- 把 Git 当「差异记录器」：差异是视图不是存储；理解快照后重命名/去重行为全部可解释。
- 分离 HEAD 上提交：孤儿 commit 会被 GC；先建分支再检出（`git switch -c`）。
- 以为 `git add` 后修改的内容也会被提交：草稿记的是 add 时的内容。
- 手动删 .git/objects 里的「多余」文件：那是数据库本体；清理走 `git gc`。
- 拿分支当「完整副本」理解：它是 41 字节的指针，切换成本趋近于零。
- 改写已推送历史后强推：哈希变了意味着「新历史」；协作流程见[第 6 篇](06-remote.md)。
- 混淆 HEAD 与分支：提交时只有「挂着的分支」会前进。

## 8. 小结

- Git 是内容寻址数据库：blob（内容）、tree（目录）、commit（快照+父指针）、tag 四类对象，SHA 同时完成寻址、校验、去重。
- 分支是 41 字节的指针文件，HEAD 是当前位置；所有「高级操作」都能翻译成对象图上的指针移动。
- commit 链的哈希层层覆盖历史——改历史必换哈希，这是「已推送历史不可变」的数学基础。
- 三区模型服务日常工作流：暂存区是「下次提交的快照草稿」，add 的语义是记入草稿。
- 「先懂数据库再学命令」：命令是图操作的语法糖，事故救援全部依赖对象模型思维（[第 7 篇](07-undo.md)、[第 11 篇](11-pitfalls.md)）。

## 9. 练习

**1.** 在空仓库里执行 `echo hi > f.txt && git add f.txt && git commit -m x`，用 `git cat-file -p` 依次查看 blob、tree、commit 三层对象，画出对象图。

> [!TIP]
> 思路`git rev-parse HEAD` 拿 commit 哈希 → `git cat-file -p HEAD` 看 tree 与父指针 → `git cat-file -p HEAD^{tree}` 看文件名映射 → `git cat-file -p <blob>` 看内容。画出的图就是「快照 + 引用」的最小样本。

**2.** 验证内容寻址的去重：创建两个内容相同的文件 add 后，用 `git cat-file --batch-check --batch-all-objects` 数 blob 数量；再验证「改名后 blob 不变」。

> [!TIP]
> 思路两个相同内容的文件共享一个 blob；`git mv a.txt b.txt` 后对比 blob 哈希不变。这两个实验分别证明「内容寻址去重」与「名字在 tree 不在 blob」。

**3.** 用 `git log --graph --oneline --all` 观察一个有分支与合并的仓库，对照对象图术语描述每条线与每个分叉点。

> [!TIP]
> 思路每个 `*` 是 commit 节点，分叉是分支指针分出的链，合并是双父节点。「读图」能力是后续 rebase/cherry-pick 决策的基础。

**4.** 制造一次分离 HEAD 提交（`git checkout HEAD~1` 后提交），用 `git reflog` 找回它——解释「孤儿 commit」如何被 reflog 暂时保护。

> [!TIP]
> 思路分离 HEAD 提交不被任何分支引用，但 reflog 记录了它的哈希，`git branch rescue <sha>` 即可收编；GC 前它一直存在。这是[第 7 篇](07-undo.md)恢复手册的底层原理。

**5.** 解释为什么 `git commit --amend` 之后，之前推送的分支无法正常 push（非强推），从 commit 哈希的构成推导。

> [!TIP]
> 思路amend 生成新 commit（新哈希、父指针相同），本地分支指向新哈希；远程还是旧哈希的历史——两边历史已不同，普通 push 会拒绝（非快进）。「哈希覆盖历史」的必然结果。

**6.** 用三个文件实验暂存区的「快照草稿」语义：add 三个文件 → 修改其中一个 → `git diff` 与 `git diff --staged` 的输出差异 → 提交后验证仓库里是哪个版本。

> [!TIP]
> 思路diff 显示工作区 vs 草稿（有差异），diff --staged 显示草稿 vs 上次提交（无差异）——草稿记的是 add 时内容。提交的是草稿版本，工作区多出的修改留在三区之外，需再次 add。
