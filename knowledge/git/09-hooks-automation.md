---
title: 钩子与自动化：把纪律写进流程
order: 9
tags: hooks, pre-commit, commitlint, gitattributes
summary: 钩子的执行机制与退出码约定、pre-commit/commit-msg/pre-push 四大钩子的职责、pre-commit 框架的配置化方案、commitlint 守护提交信息、gitattributes 统一换行与二进制 diff，以及「钩子是提示、CI 是保安」的防线分层。
---

代码规范的执行成本：靠自觉，人各有异；靠 review，粒度太粗还伤感情；靠 CI，反馈太迟。**Git 钩子**把检查放在「提交的那一瞬间」——违规在本地就地拦截，反馈延迟为零。本篇讲钩子机制、四个核心钩子的职责，以及让钩子可共享的框架方案。

## 1. 钩子机制：退出码就是裁决

钩子是 `.git/hooks/` 下的可执行脚本，Git 在特定时点调用它们。约定极简：

- **退出码 0** = 放行；**非 0** = 拦截操作。
- 不同钩子收到不同参数（如 commit-msg 收到信息文件路径）。
- 语言不限（shell/python/node 皆可），命名为「钩子名.sample」的模板不生效（去掉后缀才生效）。

```bash
ls .git/hooks/
# pre-commit.sample  commit-msg.sample ...   ← 模板，去掉 .sample 启用
```

```bash
#!/bin/sh
# .git/hooks/pre-commit —— 禁止提交带 TODO-FIXME 的代码
if git diff --cached | grep -q "FIXME.*不要提交"; then
  echo "❌ 暂存区里有未完成的 FIXME"
  exit 1                                  # 非 0：提交被拦截
fi
exit 0
chmod +x .git/hooks/pre-commit
```

四个核心钩子的时点与职责：

| 钩子           | 触发时点           | 拿到什么           | 典型职责                     |
| -------------- | ------------------ | ------------------ | ---------------------------- |
| `pre-commit`   | git commit 执行前   | —                  | lint、格式检查、密钥扫描      |
| `commit-msg`   | 提交信息写入前      | 信息文件路径        | 提交信息规范校验（commitlint）|
| `pre-push`     | git push 前         | 远程与分支列表      | 全量测试（慢检查放这里）      |
| `post-merge`   | pull/merge 完成后   | —                  | 提醒重装依赖（lock 变了）     |

## 2. 钩子的第一个问题：不随仓库传播

`.git/` 目录不会被克隆——你精心写的钩子，同事 clone 下来全没有。三种共享方案：

1. **pre-commit 框架**（事实标准）：钩子配置进仓库里的 `.pre-commit-config.yaml`，同事一条 `pre-commit install` 装好（本文 3 节）。
2. **husky**（Node 项目）：`package.json` 里声明，`npm install` 时自动挂钩。
3. **versioned hooks**：把钩子脚本放仓库的 `hooks/` 目录 + `git config core.hooksPath hooks` 一行安装脚本。

## 3. pre-commit 框架：声明式的钩子管理

```yaml
# .pre-commit-config.yaml（进仓库，团队共享）
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit    # lint + 格式
    rev: v0.6.0
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: https://github.com/pre-commit/pre-commit-hooks   # 通用卫生检查
    rev: v5.0.0
    hooks:
      - id: end-of-file-fixer          # 文件以换行结尾
      - id: trailing-whitespace        # 行尾空白
      - id: check-yaml                 # YAML 语法
      - id: check-merge-conflict       # 残留冲突标记（<<<<<<<）
      - id: detect-private-key         # ★ 密钥扫描：私钥进仓库的防线之一

  - repo: https://github.com/gitleaks/gitleaks         # 更全的秘密扫描
    rev: v8.18.0
    hooks:
      - id: gitleaks
```

```bash
pip install pre-commit          # 安装框架
pre-commit install              # 写入 git hooks（每次 clone 后执行一次）
pre-commit run --all-files      # 手动全量跑一遍
```

框架的价值：钩子以**声明式 YAML + 版本固定的远程仓库**定义，任何语言写的检查器都能挂进来；`rev` 锁版本保证全团队检查行为一致。`check-merge-conflict` 与 `detect-private-key` 两个钩子分别对应[第 2 篇](02-daily-workflow.md)与[第 7 篇](07-undo.md)的两类高危事故——把事故预防挪到提交前。

## 4. commit-msg 钩子：提交信息的守门员

```bash
#!/bin/sh
# 最小可用的信息校验：首行格式 <type>: <摘要>
head -1 "$1" | grep -qE "^(feat|fix|docs|test|chore|refactor)(\(.+\))?: .{1,72}$" && exit 0
echo "❌ 提交信息需符合: type(scope): 摘要（约定式提交）"
exit 1
```

生产项目用 **commitlint**（配合 husky）做全量规则（类型白名单、大小写、句号、最大长度）：

```bash
npm install -D @commitlint/cli @commitlint/config-conventional husky
echo "export default { extends: ['@commitlint/config-conventional'] }" > commitlint.config.mjs
npx husky init && echo "npx --no -- commitlint --edit \$1" > .husky/commit-msg
```

提交信息规范「靠自觉」必然漂移（[第 2 篇](02-daily-workflow.md)的信息质量就是历史索引的质量），钩子是把它变成机器裁决的唯一办法。

## 5. gitattributes：仓库级的内容属性

```gitattributes
# 换行符统一（跨平台协作的第一根源问题）
* text=auto eol=lf          # 文本统一 LF（检出也用 LF，Docker/Linux 友好）
*.bat text eol=crlf         # Windows 批处理例外

# 二进制标记：避免 Git 当文本处理（假差异、坏合并）
*.png binary
*.xlsx binary

# 合并策略
package-lock.json merge=ours    # 锁文件冲突时保留当前侧（由工具重新生成）
```

换行符事故的经典形态：Windows 开发者（CRLF）提交后，Linux 同事看到「整个文件都改了」（其实只有行尾）。`text=auto eol=lf` 在仓库层一次性终结——属性跟着仓库走，比每个人的 autocrlf 配置可靠。

## 6. 防线分层：钩子是提示，CI 是保安

钩子的致命局限：**`git commit --no-verify` 一键绕过**（紧急时刻合法，日常滥用常态）。所以钩子只是第一道防线：

```text
本地钩子（pre-commit）      ← 最快反馈，可绕过：拦 90% 的顺手失误
CI 检查（push/PR 触发）     ← 不可绕过：合并前的硬门槛（[第 12 篇](../python/12-quality.md)）
平台保护（分支保护规则）     ← 最终裁决：main 只接受通过 CI 的 PR
```

分工原则：**重的检查放 CI（全量测试），轻的检查放钩子（lint、格式、密钥）**——钩子追求秒级反馈，别把 5 分钟的测试塞进 pre-commit（那正是 --no-verify 滥用的根源）。

## 7. 陷阱清单

- 钩子写好自己用，同事没有：用 pre-commit 框架/husky 共享配置。
- pre-commit 塞全量测试：提交卡几分钟 → 全员 --no-verify；重检查给 CI。
- 钩子静默通过一切（退出码忘了非 0）：检查脚本要真的会失败；故意违规验证一次。
- 忘 `chmod +x`：钩子存在但不执行；--no-verify 之外的「静默失效」。
- 跨平台换行靠口头约定：gitattributes 的 `text=auto eol=lf` 一劳永逸。
- 密钥只靠 review 肉眼：gitleaks/detect-private-key 钩子 + 平台 secret scanning 双保险。
- commitlint 只挡不教：拦截信息里给出正确示例或模板（commit.template 配置）。

## 8. 小结

- 钩子 = 特定时点的可执行脚本 + 退出码裁决：pre-commit 管内容、commit-msg 管信息、pre-push 管重检查、post-merge 管提醒。
- 钩子不随克隆传播：pre-commit 框架（声明式 YAML + 版本锁定）是跨语言的事实标准，husky 服务 Node 项目。
- 高价值钩子三件：ruff（lint+格式）、check-merge-conflict（冲突标记残留）、gitleaks/detect-private-key（密钥防线）——分别封堵三类高频事故。
- gitattributes 在仓库层终结换行符战争、保护二进制文件、定制合并策略。
- 防线分层：钩子秒级反馈可绕过、CI 硬门槛、平台保护最终裁决——重的给 CI，轻的给钩子。

## 9. 练习

**1.** 手写一个 pre-commit 钩子：拒绝提交超过 500 行的单次变更（提示「拆分提交」），故意触发一次并观察退出码行为；再用 --no-verify 绕过，写出你对「钩子定位」的结论。

> [!TIP]
> 思路`git diff --cached | grep -c '^+[^+]'` 数新增行。绕过实验的结论：钩子是「流程提示」不是「安全边界」——绕过零成本，所以重检查必须上移 CI。

**2.** 给你的项目配置 pre-commit 框架：ruff + 通用卫生检查 + gitleaks 三组钩子，clone 到新目录验证 `pre-commit install` 后的拦截行为。

> [!TIP]
> 思路验证清单：改坏格式看 ruff 是否拦、留冲突标记看 check-merge-conflict、写假密钥看 gitleaks。三个用例全拦住才算装好——「假设它能工作」是钩子事故的主要来源。

**3.** 用 commitlint + husky 建立提交信息防线：写一条不合规范的提交观察拦截，再用 commit.template 提供正确模板降低书写摩擦。

> [!TIP]
> 思路拦截（负反馈）与模板（正引导）配套才有持续合规——只有拦截的团队会学会一键 --no-verify。`git config --global commit.template ~/.gitmessage`。

**4.** 在一个含 CRLF 污染历史的仓库执行 gitattributes 统一：`* text=auto eol=lf` + `git add --renormalize .`，观察 diff 的变化与一次性「行尾大改」提交的必要。

> [!TIP]
> 思路renormalize 会产生一次「全库行尾统一」的提交——它必须在团队约定的时间点做（所有人先合并手头工作），否则之后的每次合并都在行尾冲突里挣扎。一次性手术 + 仓库属性 = 终结战争。

**5.** 设计你团队的「提交防线地图」：列出 5 条团队规则（如「禁提交密钥」「信息合规范」「lint 全绿」），每条标注执行层（钩子/CI/平台保护）与理由。

> [!TIP]
> 思路分层的依据是「检查速度 × 绕过代价」：秒级可绕过的放钩子，分钟级不可绕的放 CI，流程性的放平台。地图画出来后，「为什么这条规则没生效」的争论就变成了「放错层了」。

**6.** 讨论：pre-push 钩子跑「只测受影响模块」的增量测试是否是好方案？与「CI 全量」的协作边界在哪？

> [!TIP]
> 思路增量测试（基于 diff 定位受影响测试）能把 push 前反馈控制在 30 秒内，CI 仍全量兜底——两层互补。前提是「受影响分析」可靠（依赖图），不可靠时宁可 hook 只跑 lint。工具：pytest-testmon 等自带依赖追踪。
