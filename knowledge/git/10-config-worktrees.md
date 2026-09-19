---
title: 配置与多仓库：把 Git 调成你的形状
order: 10
tags: config, alias, worktree, submodule, LFS
summary: 配置三层结构与现代化默认值（pull.rebase、fetch.prune、push.autoSetupRemote）、别名库、条件包含实现工作/个人身份切换、worktree 多目录并行、submodule 的真实成本、LFS 管大文件的指针模型。
---

Git 的默认配置面向 2005 年的单机协作；现代工作流的不少摩擦（pull 造合并提交、忘建跟踪、拉取缓存堆积）都能用几行配置根治。本篇覆盖三层配置体系、条件包含的身份切换、worktree/submodule/LFS 三个「多仓库」工具——各自的适用边界比命令本身更重要。

## 1. 配置三层与现代化默认值

```bash
git config --system <k> <v>     # 系统级（所有用户）——很少动
git config --global <k> <v>     # 全局（当前用户）——~/.gitconfig，主要阵地
git config <k> <v>              # 仓库级（.git/config）——项目特例
git config --global --list      # 查看；git config <k> 查看合并后的生效值
```

三层优先级：**仓库 > 全局 > 系统**（近的覆盖远的）。

### 1.1 推荐的全局基线

```bash
# 身份
git config --global user.name "Alice"
git config --global user.email "alice@company.com"

# 协作行为现代化
git config --global pull.rebase true          # pull 用 rebase 整合（避免意外合并提交）
git config --global fetch.prune true          # fetch 自动清理失效的远程分支缓存
git config --global push.autoSetupRemote true # 首推自动建立跟踪（3.3+，替代 push -u）
git config --global init.defaultBranch main   # 新仓库默认分支名

# 提交体验
git config --global commit.verbose true       # 提交信息编辑器里显示 diff 助写正文
git config --global rerere.enabled true       # ★ 记住冲突解法：同款冲突第二次自动解决
git config --global help.autocorrect 30       # 打错命令 3 秒后自动执行近似命令（胆小可不开）
```

`rerere`（reuse recorded resolution）是被低估的宝石：rebase 长分支时反复解同款冲突的痛苦，开它一次终结——Git 记住你每次「冲突形状 → 解法」的映射。

## 2. alias：常用操作的压缩包

```bash
git config --global alias.lg "log --oneline --graph --all --decorate"
git config --global alias.last "log -1 HEAD --stat"
git config --global alias.st "status -sb"
git config --global alias.undo "reset --soft HEAD~1"       # 撤销上一次提交但保留改动
git config --global alias.wip '!git add -A && git commit -m "WIP"'   # ! 前缀 = shell 命令
```

alias 不是打字省事（shell 补全早就很快），是**把「正确的操作形态」固化**：`git lg` 的图形态、`git undo` 的 soft 语义，都是给高频动作绑一个不会错的入口。

## 3. 条件包含：工作/个人身份自动切换

痛点：一台机器上既提交公司项目又维护个人项目，user.email 不能混。解法是**按目录条件加载配置**：

```ini
# ~/.gitconfig
[user]
    name = Alice
    email = alice@personal.dev        # 默认（个人）

[includeIf "gitdir:~/work/"]
    path = ~/.gitconfig-work          # work 目录下追加公司配置
```

```ini
# ~/.gitconfig-work
[user]
    email = alice@company.com         # 公司项目用公司邮箱
```

`~/work/` 下的任何仓库自动叠加公司身份——「提交到公司库却带个人邮箱」这类事故从配置层根除（commit 的邮箱进历史后不可改，提前分流是唯一解）。

## 4. worktree：一个仓库，多个工作目录

切分支要收敛工作区（未提交的修改碍事）；**worktree 让同一仓库同时检出多个分支到不同目录**：

```bash
git worktree add ../hotfix-dir hotfix/token-loop    # 新目录检出 hotfix 分支
git worktree add ../main-dir main                   # main 常驻一个目录

cd ../hotfix-dir          # 在这里修紧急 bug（main 目录的工作不受任何影响）
# ...
git worktree list         # 查看全部工作树
git worktree remove ../hotfix-dir    # 用完拆掉
```

所有工作树共享同一个 `.git` 对象库（磁盘省、fetch 一次处处生效），但各有独立的工作区与 HEAD。

| 场景                            | worktree                        | stash/切换                       |
| ------------------------------- | ------------------------------- | -------------------------------- |
| 长时间并行两个任务（功能+hotfix） | ✅ 两个目录随时切机器上下文        | 反复 stash/pop，上下文脑内切换    |
| 一边开发一边跑另一个分支的测试/构建 | ✅ 构建目录互不污染              | 切走后原任务中断                  |
| 对比两个版本的运行表现           | ✅ 两个版本同时存在、同时运行     | 只能先后看                        |

「并行上下文」是 worktree 的本质：stash 解决的是**串行**切换，worktree 解决**并行**共存。

## 5. submodule：嵌套仓库的真实成本

```bash
git submodule add https://github.com/org/lib.git vendor/lib   # 挂载子仓库
git clone --recurse-submodules <url>                          # 克隆时一并拉取
git submodule update --init --recursive                       # 克隆后补拉取（最高频遗忘）

git submodule update --remote vendor/lib                      # 更新子模块到其最新
```

submodule 在父仓库里存的是**子仓库的一个 commit 指针**（不是分支！），子模块自身仍是完整独立仓库。它的著名痛点：

1. **指针语义反直觉**：父仓库记录「vendor/lib 在某 commit」——子模块里 checkout 新分支/新提交后忘了回父仓库 commit 指针更新，「状态不同步」是日常。
2. **克隆体验**：忘了 `--recurse-submodules` 就是空目录；CI/新同事的高频坑。
3. **工作流复杂**：改子模块要「子模块提交推送 → 父仓库更新指针提交推送」两步走。

**替代品优先**：共享代码用包管理器（npm/pip/cargo）发布依赖——依赖解析、版本锁定、变更日志都是现成的。submodule 的正当用武之地：**没有包管理器生态的代码**（C/C++ 静态库）、**必须精确锁定到 commit 的外部资源**、**不想引入发布流程的临时共享**。git subtree / git subrepo 是「把子仓库内容真拷进父仓库」的替代（历史里保留来源，无指针同步问题），但合并信息量大。

## 6. LFS：大文件的指针层

Git 对二进制大文件（模型、数据集、视频、设计稿）不友好：blob 全量存储、diff 无意义、仓库体积单调膨胀。**Git LFS** 把大文件换成指针：

```bash
git lfs install                      # 装好钩子（或用 .gitattributes 驱动）
git lfs track "*.psd" "*.safetensors"   # 声明哪些模式走 LFS → 写入 .gitattributes
git add model.safetensors && git commit && git push   # 推的是指针，真文件进 LFS 服务器
```

仓库里存的是约 130 字节的指针文件（指向 LFS 服务器上的对象）；clone/pull 时按需下载真实文件。三条纪律：

1. **先 track 再 add**：普通 add 过的大文件会以完整 blob 进历史，改用 LFS 为时已晚（需历史重写）。
2. **模式要覆盖全**：`*.psd` 而不是单个文件名。
3. **带宽与配额**：LFS 服务有流量限制（GitHub 的配额模型），团队共享大模型前算账。

## 7. 凭据管理

```bash
git config --global credential.helper manager    # Windows/macOS 系统凭据库（默认推荐）
git config --global credential.helper store      # 明文文件（~/.git-credentials，仅私有机）
ssh-keygen -t ed25519                            # SSH 密钥（企业内网/高频推送的更优路线）
```

HTTPS + 凭据管理器 vs SSH 密钥：前者配置少（代理友好），后者免密钥过期焦虑、细粒度权限（deploy key）。HTTPS 仓库走 PAT（personal access token）时凭据管理器自动存储，避免「每次 push 都要粘贴 token」。

## 8. 陷阱清单

- 靠记忆操作 pull/push 参数：基线配置（pull.rebase/fetch.prune/push.autoSetupRemote）一次写清。
- work 与 personal 邮箱混用：条件包含按目录分流；历史里的错误邮箱改不了（需重写）。
- submodule 忘 `--recurse-submodules`：空目录与「指针未提交」双坑；克隆后先 `submodule update --init`。
- submodule 里改代码没回父仓库提交指针：CI 构建的是旧版本；「两层提交」纪律写进 README。
- 大文件直接 add 进仓库：仓库体积永久膨胀；先 `lfs track` 再 add，模式写宽。
- worktree 忘了它们共享对象库：在任一工作树做的 fetch/commit 全局可见；不是完全独立克隆。
- alias 覆盖真实命令语义（alias.undo 做了 hard）：给破坏性操作起名要保守，或干脆不起。

## 9. 小结

- 配置三层（仓库 > 全局 > 系统）+ 现代基线（pull.rebase、fetch.prune、push.autoSetupRemote、rerere）根治大多数协作摩擦。
- alias 固化「正确形态」而非打字；条件包含（includeIf）按目录分流身份，从配置层杜绝邮箱混用。
- worktree 让多分支**并行共存**（共享对象库、独立工作区）：长任务并行、对照测试的场景答案，stash 只覆盖串行切换。
- submodule 是「父仓库存子仓库 commit 指针」：克隆与指针同步两坑常驻；有包管理器生态时优先发包依赖。
- LFS 用指针替代大文件 blob：先 track 再 add 是唯一正确的接入顺序。
- 凭据管理器或 SSH 密钥二选一，PAT 走管理器避免裸存。

## 10. 练习

**1.** 给你的全局配置补齐本篇基线的六项（pull.rebase、fetch.prune、push.autoSetupRemote、rerere、init.defaultBranch、commit.verbose），并在测试仓库逐一验证行为变化。

> [!TIP]
> 思路验证 rerere 最有戏剧性：制造冲突、解决、reset 重来——第二次相同冲突被自动解决。`git config --global --list` 与 `git config <key>` 分清「配置了什么」与「当前生效什么」。

**2.** 实现条件包含的工作/个人分流，然后用 `git config user.email` 在两个目录下验证（配置解析是目录感知的）。

> [!TIP]
> 思路includeIf 的路径匹配基于仓库位置而非 cwd 时点——在 work 目录外新建仓库验证默认身份。提交历史里邮箱不可改（重写成本极高），身份分流必须在第一次 commit 前生效。

**3.** 用 worktree 复现「功能开发中插队 hotfix」：feature 目录保持未提交状态，hotfix 目录完整处理一个紧急修复，全程 feature 的工作现场不受影响。

> [!TIP]
> 思路对比 stash 方案：worktree 版无需收纳与恢复，两边的编辑器/终端/运行状态天然共存。这正是「并行上下文」与「串行切换」的差异。

**4.** 拆一个含子模块的项目体验完整流程：添加、克隆（忘 --recurse 的报错现场）、子模块更新 + 父仓库指针提交。写出你将给团队 README 的子模块使用规约。

> [!TIP]
> 思路规约核心三条：克隆命令带 --recurse-submodules、改子模块必须「子推 → 父提交指针」两步、CI 显式 submodule update --init。「两层提交」的纪律是 submodule 唯一的生存方式。

**5.** 演示 LFS 的指针模型：track 一个二进制模式后提交，`git show HEAD -- file` 观察指针文本（version/oid/size 三字段），再用 `git lfs ls-files` 列出被管理的文件。

> [!TIP]
> 思路指针文件让仓库 diff/clone 的速度与「大文件内容」解耦。再实验「先 add 后 track」的错误顺序：文件以完整 blob 进了历史——这就是「先 track 再 add」铁律的由来（修正需历史重写）。

**6.** 讨论：团队要共享一组 3 GB 的训练数据集，比较四种方案：直接进 Git、Git LFS、DVC/对象存储、自建文件服务器（数据版本在文档中管理）。给出维度表（版本化能力、克隆成本、存储费用、协作摩擦）与推荐。

> [!TIP]
> 思路直接进 Git 是禁区（仓库不可克隆）；LFS 适合「中等大小 + 需要 Git 版本语义」；DVC（数据版本控制）用 Git 记指针 + 云存储放数据，是数据科学团队的标配；文档管理适合「低频更新 + 小团队」。维度表画完，答案随「更新频率 × 团队规模」浮动。
