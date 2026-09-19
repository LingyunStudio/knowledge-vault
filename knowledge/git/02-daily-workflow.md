---
title: 日常三步：提交的质量决定历史的价值
order: 2
tags: add, commit, gitignore, 提交信息, 原子提交
summary: status 的三区解读、补丁级暂存 -p 的精确提交、约定式提交信息与原子提交原则、amend 的时机、.gitignore 的语法与「已跟踪文件不受影响」的真相，以及密钥一旦提交即永存历史的红线。
---

日常开发中 90% 的 Git 操作就是五个命令：status、add、commit、push、pull。但「会用」和「用好」之间隔着一个东西——**提交质量**。历史是 Git 真正的资产（考古、回滚、review、交接全靠它），而提交的质量在 `git commit` 敲下去的那一刻就决定了。

## 1. status：三区的体检报告

```bash
$ git status
On branch main
Changes to be committed:              # 暂存区 vs 上次提交（将被提交的）
        modified:   src/app.py
Changes not staged for commit:        # 工作区 vs 暂存区（改了没 add 的）
        modified:   src/util.py
Untracked files:                      # 工作区里 Git 还不认识的文件
        notes.md
```

读懂 status 就是读懂三区模型（[第 1 篇](01-object-model.md)）：一个文件可以同时出现在「已暂存」和「未暂存」两栏——add 后又改了。**status 是每天打开编辑器前的第一个命令**，它回答「我现在站在哪里、有什么没做完」。

```bash
git status -s          # 短格式：M  app.py /  M util.py / ?? notes.md
git status -sb         # 带分支与领先/落后信息 —— shell 提示符的素材
```

## 2. add 的粒度：从「全加」到补丁级

```bash
git add app.py              # 精确到文件
git add .                   # 当前目录全部（含新文件）
git add -u                  # 只加已跟踪的修改（不含新文件）
git add -A                  # 全仓库
git add -p app.py           # ★ 补丁级：逐块选择要不要暂存
```

`git add -p`（patch 模式）是把「杂乱的修改」拆成**原子提交**的核心工具：

```text
@@ -12,6 +12,9 @@ def handle(req):
+    if not req.auth:
+        return 401
Stage this hunk [y,n,q,a,d,s,e,?]? y     ← y 暂存这块，n 跳过，s 再拆细，e 手工编辑
```

场景：你同时改了「修 bug」和「重构」两类代码——用 `-p` 把 bug 修复的部分单独暂存提交，重构留给下一个提交。历史因此可回滚、可 review、可 bisect（[第 5 篇](05-history.md)的 bisect 要求每个提交都能编译）。

**配套命令 restore**（现代 Git 的对称设计：add 的逆操作）：

```bash
git restore util.py            # 丢弃工作区修改（危险：不可恢复！）
git restore --staged util.py   # 把文件移出暂存区（保留工作区修改）—— add 的反操作
```

## 3. 提交信息：给未来的自己留线索

### 3.1 为什么值得认真

三个月后的你会站在 `git log` 面前问三个问题：**这个提交做了什么？为什么做？影响了哪些行为？** 提交信息是唯一能回答的地方（diff 只回答第一问的一半）。

### 3.2 约定式提交（Conventional Commits）

```text
<类型>(<可选范围>): <一句话摘要>

<可选正文：为什么改、影响什么>

<可选脚注：BREAKING CHANGE、issue 引用>
```

```bash
git commit -m "fix(auth): 令牌过期后未刷新导致 401 循环

令牌过期时 refresh 端点返回的 401 被拦截器误判为未登录，
导致跳转登录页后死循环。改为识别 refresh 专用错误码。

Closes #452"
```

常用类型与语义：

| 类型       | 含义                 | 对历史的意义           |
| ---------- | -------------------- | ---------------------- |
| `feat`     | 新功能               | 语义化版本的「次版本」    |
| `fix`      | 缺陷修复             | 「修订版本」；可关联 issue |
| `refactor` | 重构（不改行为）       | bisect/回滚时的分界信号   |
| `docs` / `test` / `chore` | 文档/测试/杂务 | 过滤噪声                  |

摘要行纪律：**一行、50 字内、祈使句**（「fix 循环」而不是「修复了循环」）——因为 `git log --oneline`、GitHub 列表都只显示这一行。

### 3.3 原子提交原则

一个提交做一件事——「一件事」的判定标准：**它能被独立回滚吗？它能通过 bisect 定位问题吗？它的信息不写「还有」两个字吗？**

```text
❌ "登录功能 + 顺便修了个 CSS + 升级依赖"     —— 回滚登录会带走 CSS 修复
✅ "feat: 登录支持记住我选项"
✅ "fix: 按钮在窄屏下溢出"
✅ "chore: 升级 requests 到 2.32"            —— 各自可独立回滚
```

「改了一半还没分清」时用 `git add -p` 在提交时拆分，而不是等提交完再后悔。

## 4. amend 与空提交：提交后的微调

```bash
git commit --amend                    # 修补上一次提交（补文件/改信息）
git add forgotten.py && git commit --amend --no-edit
git commit --amend -m "更好的信息"

git commit --allow-empty -m "chore: 触发 CI 重跑"    # 空提交：只改历史占位
```

amend 的红线：**只改未推送的提交**。amend 生成新哈希（[第 1 篇](01-object-model.md)的数学必然），已推送的历史被改后推送需要强推，协作中等于核弹（[第 6 篇](06-remote.md)）。空提交的正当用途：标记里程碑、触发 CI——它是「历史里的注释行」。

## 5. .gitignore：该跟踪什么、忽略什么

### 5.1 语法速查

```gitignore
# 注释
node_modules/          # 目录（含斜杠 = 只匹配目录）
*.log                  # 通配所有 .log
build/                 # 构建产物
*.py[cod]              # 字符类：pyc/pyo/pyd
debug?.log             # ? 单字符
**/temp                # 任意层级下的 temp
!important.log         # 否定：强制跟踪（必须放在忽略规则之后）
/doc                   # 锚定根目录（不匹配子目录下的 doc）
```

### 5.2 「已跟踪文件不受 ignore 影响」——最高频误解

```bash
# 文件已被跟踪后加入 .gitignore：Git 依然跟踪它的修改！
git rm --cached secret.env     # 从仓库移除跟踪（保留工作区文件）+ 加入 .gitignore
git commit -m "chore: 停止跟踪 secret.env"
```

`.gitignore` 只管「未跟踪的文件」——它的语义是「不要把**新的**东西拉进版本控制」。已入库的文件要先 `git rm --cached` 退出跟踪。彻底从**历史**中清除文件（密钥泄露）是另一个量级的操作（filter-repo/BFG，[第 7 篇](07-undo.md)）。

### 5.3 什么该提交、什么不该

| 提交 ✅                          | 忽略 ❌                          |
| -------------------------------- | -------------------------------- |
| 源码、构建配置、锁文件（package-lock.json 等） | 依赖目录（node_modules/、venv/）  |
| CI 配置、Dockerfile              | 构建产物（build/、dist/、__pycache__/） |
| 示例配置（config.example.json）   | 本地配置与密钥（.env、密钥、token） |
| 工具链共享配置（.editorconfig）   | 编辑器个人文件（.idea/、.vscode/ 部分） |
| .gitignore 自身                  | 操作系统杂物（.DS_Store、Thumbs.db） |

**锁文件应该提交**（可复现构建），密钥永远不进 Git——一旦进了，历史里永远有（哪怕后续删除）。全局忽略文件（`git config --global core.excludesfile`）收纳个人杂物（.DS_Store），项目内 ignore 只放项目语义的规则。

## 6. 一天的完整循环

```bash
git status                                  # 早上：看昨天留下什么
git switch -c feat/search                    # 开新分支干活（[第 3 篇](03-branches.md)）
# ...写代码...
git status && git diff                       # 提交前检查
git add -p                                   # 按块拆分暂存
git commit -m "feat(search): 支持拼音首字母检索"
# ...继续写...
git commit --amend                           # 发现漏了一个文件，补进上一提交
git push -u origin feat/search               # 推送并建立跟踪
```

这个循环里没有一条「背诵的咒语」——每一步都是三区模型（status/diff/add）与提交原则（原子、可解释）的直接应用。

## 7. 陷阱清单

- `git add .` 一把梭后提交：历史里混进调试文件与密钥；`-p` 精确拆分。
- 密钥提交后删除文件再提交：**历史里仍在**；泄露即轮换密钥 + 历史清洗。
- 已跟踪文件加 ignore 不生效：先 `git rm --cached` 退出跟踪。
- 提交信息写「更新代码」「修改 bug」：三个月后零价值；写「为什么」。
- amend 已推送的提交：强制新历史；amend 只用于未推送。
- 一个提交塞多件事：bisect 与回滚失效；`add -p` 拆原子提交。
- ignore 误伤必须提交的文件：用 `!` 否定并确认位置（后面的规则覆盖前面的）。
- 忘记 lock 文件的语义：手改锁文件不生效（由包管理器生成）；提交它保证可复现。

## 8. 小结

- status 读三区：已暂存/未暂存/未跟踪；`add -p` 把杂乱修改拆成原子提交，restore 是 add 的逆操作。
- 提交信息 = 给未来的考古线索：约定式类型前缀 + 一行摘要 + 正文写为什么；摘要行是历史的目录。
- 原子提交的判定：可独立回滚、可 bisect、信息无「还有」。
- amend 只碰未推送提交；空提交是历史注释。
- .gitignore 管「未跟踪」不管「已跟踪」；退出跟踪 `rm --cached`、清除历史是另一个量级的手术；密钥不进 Git，进了就要轮换。
- 提交质量在 commit 那一刻定型——它决定三个月后历史是资产还是垃圾场。

## 9. 练习

**1.** 制造一个混合修改的文件（一半是 bug 修复、一半是重构），用 `git add -p` 拆成两个原子提交，检查 `git log --oneline` 与两个提交各自的 diff。

> [!TIP]
> 思路两块修改如果相邻，用 `s` 拆细或 `e` 手工编辑 hunk。体会「提交时拆分」与「事后 rebase 拆分」（[第 4 篇](04-merge-rebase.md)）的成本差。

**2.** 为你的项目写一套 .gitignore：包含构建产物、依赖、本地配置、系统杂物，并用 `git check-ignore -v <path>` 验证一条规则为什么命中。

> [!TIP]
> 思路check-ignore -v 显示命中的规则与文件位置——调试 ignore 的标准工具。验证「已跟踪文件不受 ignore 影响」的实验：跟踪一个文件后 ignore 它，看 status 是否仍报告修改。

**3.** 用约定式提交重写这三条烂信息，并给每条补上「正文为什么」：`update`、`fix bug`、`改了很多东西`。

> [!TIP]
> 思路示例：`fix(api): 分页参数 offset 越界时返回空页而非 500`——正文解释根因与影响范围。判断标准：三个月后只看摘要行能否定位这次提交的用途。

**4.** 实验暂存区语义：add 文件 → 修改它 → 分别执行 `git diff`、`git diff --staged`、`git diff HEAD`，用输出证明「草稿记的是 add 时刻的内容」。

> [!TIP]
> 思路diff 显示「工作区 vs 草稿」的差异，diff --staged 为空——提交进去的是 add 时的版本。这也是「add 完又改了一行」的代码「丢修改」错觉的真相：修改在工作区，没进草稿。

**5.** 演示「密钥进入历史」的不可逆性：提交一个假密钥 → 删除文件再提交 → `git log -p --all` 依然能找到它 → 再执行真正的历史清除（git filter-repo 或 BFG，在测试仓库做）。

> [!TIP]
> 思路历史清除重写所有受影响 commit 的哈希（[第 1 篇](01-object-model.md)的推论），需要全团队重新对齐——成本说明「防患（.gitignore + pre-commit 扫描）远胜治疗」。

**6.** 讨论：你的团队该不该用 Conventional Commits？从「语义化版本自动生成 changelog、commitlint 强制、学习成本」三个角度给出裁决与落地步骤。

> [!TIP]
> 思路收益在规模化：自动 changelog、语义版本发布、commitlint 挡住烂信息；成本是纪律与工具维护。落地：commitlint + husky/pre-commit 钩子（[第 9 篇](09-hooks-automation.md)）先提示后强制，模板降低书写成本。
