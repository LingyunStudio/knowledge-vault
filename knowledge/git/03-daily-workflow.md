---
title: 日常基本流程
order: 3
tags: 基础, status, commit
summary: status/add/commit/log 的日常循环，commit message 怎么写才有价值。
---

90% 的 Git 使用就是一个循环：改代码 → add → commit，重复几百次。循环本身很简单，真正拉开差距的是**提交的粒度**和**提交信息的质量**——半年后能救你的只有这两样。

## 日常循环

```bash
git status                  # ① 看一眼现状：改了什么、暂存了什么
git diff                    # ② 具体改了什么（工作区 vs 暂存区）
git add src/main.rs         # ③ 挑选文件进暂存区
git commit -m "fix: 修复登录时 token 未刷新的问题"   # ④ 提交
git log --oneline -5        # ⑤ 确认历史
git status -sb              # 短格式：连分支和领先/落后一起显示
```

这个循环每天要跑几十次，值得形成肌肉记忆。所有命令都是本地操作，慢的只有 push。`git status -sb` 的两位字母分别代表暂存区与工作区是否干净，看熟了比全格式更快。

顺带一提 `git commit -am "msg"`：把已跟踪文件的改动 add + commit 一步完成。方便，但不会带上新文件，还容易养成不审 diff 就提交的坏习惯——用之前想想刚才到底改了什么。

## add：精确控制提交内容

```bash
git add file.rs             # 单个文件
git add src/                # 整个目录
git add .                   # 当前目录下的全部改动（在仓库根目录跑等价于 -A）
git add -A                  # 整个仓库的所有改动（含新文件、删除、改名）
git add -u                  # 只加已跟踪文件的改动，不含新文件
git add -p                  # 逐块确认：同一个文件里挑一部分提交
```

`git add -p` 是拆分提交的利器：它把改动按 hunk 逐块展示，你挨个回答 y/n——同一个文件里的两处改动，完全可以分进两次提交。

删除文件同样要进暂存区：`git rm file.rs` 等于删文件加暂存删除；手动 rm 之后跑 `git add -u` 也能补上记录。不确定会加进哪些文件？`git add --dry-run .` 先预演一遍。

> [!TIP]
> 只提交逻辑上完整的一件事。修 bug 和顺手重构绝不混在一个提交里——将来 `git revert`、`git blame`、code review 都会感谢你。

## commit message 怎么写才有价值

提交信息是写给**未来的自己和同事**看的。标准格式：

```text
<类型>: <一句话说清做了什么，50 字以内>

<可选正文：解释为什么改，动机与背景>
```

常用类型约定：

| 类型                        | 用途           |
| ------------------------- | ------------ |
| `feat`                    | 新功能          |
| `fix`                     | 修 bug        |
| `refactor`                | 重构（不改行为）     |
| `perf`                    | 性能优化         |
| `build` / `ci`            | 构建 / CI 配置   |
| `docs` / `test` / `chore` | 文档 / 测试 / 杂务 |

```bash
# ❌ 「修改」「更新」「fix bug」——半年后没人知道它干了什么
git commit -m "更新"
# ✅ 标题说做了什么，正文说为什么
git commit -m "fix: 登录后 token 过期未刷新

refresh_token 接口返回的过期时间单位是秒，前端按毫秒解析，
导致 token 立刻过期。改用秒并补充断言。"
```

判断标准很简单：**这条信息能帮人从 500 个提交里快速定位到这次改动吗？**

> [!TIP]
> 不带 `-m` 直接 `git commit` 会打开编辑器，适合写多行正文；编辑器里 `#` 开头的行会被自动忽略。

> [!NOTE]
> 标题用祈使句（"添加 X"而不是"添加了 X"），结尾不要句号。`git log --oneline` 里只显示标题，它必须能独立成立。

提交前自查三问：能用一句话说清这个提交做了什么吗（说不清就是粒度太大）；diff 里有没有混进无关改动（格式化、调试代码）；它能独立通过编译和测试吗。

## log：回顾来路

```bash
git log --oneline                 # 每个提交一行
git log --oneline -10             # 最近 10 条
git log --oneline --graph --all   # 带分支拓扑图
git log -p src/main.rs            # 只看这个文件的每次改动内容
git log --follow -p src/main.rs   # 文件改过名也能追踪下去
git log --author="Zhang"          # 按作者过滤
git log --grep="fix"              # 按提交信息搜索
git log --since="2 weeks ago"     # 按时间过滤
git log --stat                    # 每条提交改了哪些文件
git shortlog -sn                  # 按提交数统计每个人的工作量
git log abc1234..HEAD --oneline   # 某个提交之后的所有提交
git log -p -2                     # 最近 2 次提交的完整 diff
```

过滤器可以叠加使用：先按文件、再按作者、再按内容，一层层收窄。记不住参数时，`git log --help` 里的 examples 部分值得通读一遍。常用节奏：先 `--oneline` 扫全局，再对可疑提交 `git show <hash>` 看细节。

## 一个真实的上午

```bash
git pull                        # ① 开始工作前先同步
# ... 写代码：修了一个 bug，顺手加了个小功能 ...
git status                      # ② 发现混了两个逻辑改动
git add src/bugfix.rs
git commit -m "fix: 处理空输入导致的崩溃"   # ③ bug 单独成提交
git add src/feature.rs
git commit -m "feat: 输入支持自动补全"      # ④ 功能单独成提交
git push                        # ⑤ 推送
```

注意 ③④：改动是写代码时混在一起做的，但提交的粒度由暂存区控制，最终历史依然干净。这正是暂存区存在的意义。小步提交让每次回退、每次 review 都有明确落点——这是整个循环里唯一需要动脑的部分。

> [!TIP]
> 提交完才发现漏了个文件？没推送的话 `git add 漏掉的文件 && git commit --amend --no-edit` 直接补进上一个提交，不留 "fix 补提交" 这种垃圾记录。

相关阅读：[分支](04-branches.md)
