---
title: 标签与 .gitignore
order: 10
tags: 基础, tag, gitignore
summary: 轻量与附注两种标签、语义化版本、gitignore 规则语法与全局忽略。
---

两个收尾话题：标签给历史立"路标"（通常就是发布版本号），.gitignore 告诉 Git 哪些文件永远不进版本库。都不复杂，但各有几个新手必踩的坑。

## 两种标签

| | 轻量标签 lightweight | 附注标签 annotated |
| --- | --- | --- |
| 本质 | 只是指向提交的指针 | Git 里的完整对象 |
| 携带信息 | 无 | 打标人、日期、说明，可签名 |
| 适合 | 本地临时路标 | 一切对外发布的版本 |

```bash
git tag v1.0.0                        # 轻量标签
git tag -a v1.0.0 -m "首个正式版"     # 附注标签（发布一律用这个）
git tag -a v1.0.0 abc1234             # 给历史上的某个提交补标签
git tag -f v1.0.0 abc1234             # 同名标签强制重打（指向新提交）
git tag -s v1.0.0 -m "..."            # GPG 签名标签（开源项目发版常用）
git tag -l "v1.*"                     # 按模式筛选
git tag --contains abc1234            # 查看哪些标签包含某个提交
git show v1.0.0                       # 查看标签详情与对应提交
git log --oneline --decorate          # 输出里同时显示提交落在哪些标签/分支上
git tag -d v1.0.0                     # 删除本地标签
git push origin :refs/tags/v1.0.0     # 删除远程标签
git ls-remote --tags origin           # 只看远程有哪些标签（不受本地缓存影响）
```

注意一个细节：附注标签本体是标签对象、不是提交，需要时用 `git rev-parse "v1.0.0^{commit}"` 解引用。标签与分支的根本区别：标签钉死在提交上、不会移动——这正是"发布"需要的语义。另外标签一旦推出去就当公共 API 看待——重打标签要强推，下游会立刻炸，要改就打新号。

> [!WARNING]
> **push 不会自动带上标签**（避免误推实验性标签）。`git push origin v1.0.0` 推单个，`git push origin --tags` 推全部——后者容易把本地的临时标签一起推出去，推荐按个推附注标签。

## 语义化版本

标签最常用于版本号。SemVer 约定 `主.次.修订`（MAJOR.MINOR.PATCH）：

- **主版本**：不兼容的 API 变更
- **次版本**：向后兼容的新功能
- **修订**：向后兼容的 bug 修复
- 预发布用连字符后缀：`v1.2.0-beta.1` 排在 `v1.2.0` 之前；构建元信息用加号：`v1.2.0+build.42`

判断该升哪一位：改了对外接口语义升主版本，只加不破升次版本，只修不加升修订号。拿不准影响就往高升一位，宁可保守。0.x 阶段不必死守规则——API 未稳定时次版本可以当主版本用，升 1.0 是对稳定性的正式承诺。发布前完整跑一遍构建与测试，标签只打给验证过的状态；构建脚本里常用 `git describe --tags` 从最近标签生成可读版本号（如 `v1.2.0-3-ga1b2c3`）。各种包管理器的版本比较都按这套规则排序，跨生态通用。写 release notes 的原料也在这：`git log v1.1.0..v1.2.0 --oneline` 列出两个版本之间的全部提交。

## .gitignore：不进版本库的文件

规则写在仓库根目录 `.gitignore`（可以有多份，各自作用于所在目录及子目录）。它生效于"进暂存区之前"——拦的是 add，不是已经进历史的内容。

```text
# 注释
node_modules/          # 斜杠结尾：只匹配目录
*.log                  # 通配符：所有 .log 文件（无斜杠 = 匹配任意层级）
/build                 # 开头斜杠：锚定到仓库根目录下的 build
doc/**/*.pdf           # ** 跨任意层级目录
temp?.txt              # ? 匹配单个字符
*.py[co]               # 字符组：匹配 .pyc 和 .pyo
logs/**/*.log          # 双星组合：logs 任意子目录下的 .log
!important.log         # 例外：强制跟踪（救不回被整个忽略的目录里的文件）
```

两类文件必须忽略：**生成物**（编译产物、日志、依赖目录）和**含密钥的文件**（`.env`）——密钥进了仓库就当泄露处理，删掉文件历史里也还在，得直接换密钥。

| 类别 | 典型条目 |
| --- | --- |
| 依赖目录 | `node_modules/`、`vendor/`、`target/` |
| 构建产物 | `dist/`、`build/`、`*.o`、`*.class` |
| 日志与缓存 | `*.log`、`.cache/` |
| 本地环境 | `.env`、`.env.local` |
| 编辑器与系统 | `.idea/`、`.DS_Store` |

例外规则有边界：目录被整体忽略（如 `node_modules/`）后，里面的文件无法用 `!` 重新包含——想留下个别文件，就得先写细粒度的忽略模式。

> [!TIP]
> 不确定哪些文件会被带上：`git status` 看状态（`--ignored` 连被忽略的也列出来），`git add --dry-run .` 预演一遍再动手。

还有个冷知识：**Git 不跟踪空目录**。想让目录结构进仓库，放一个占位文件：

```bash
mkdir cache && touch cache/.gitkeep   # 空目录的通行证（文件名只是社区惯例）
```

> [!NOTE]
> .gitignore 只对 **Untracked** 文件生效。已经提交的文件，之后再加规则不会让它从版本库里消失——见下节。项目自身的 .gitignore 应该提交进仓库（它是团队约定）；个人专属的忽略才放全局。

## 已经提交的文件怎么忽略

```bash
echo "debug.log" >> .gitignore   # ① 先写规则
git rm --cached debug.log        # ② 从版本库移除（本地文件保留）
git status                       # ③ 确认文件已成 Untracked 且被规则拦下
git commit -m "chore: 忽略 debug.log"   # ④ 提交后规则开始生效
```

`--cached` 只是让文件变成 Untracked 并被规则拦住，产生的是正常的新提交，不改写历史。`git rm debug.log` 则连本地文件一起删——通常不是你想要的。改名场景同理：用 `git mv` 改名提交过的文件，历史追溯靠 `git log --follow`。

敏感文件提交过怎么办？`--cached` 只防未来，历史里照样翻得到——要彻底清除得用 `git filter-repo` 或 BFG 重写历史并强推，成本极高，不如一开始就忽略。

配套思考：如果文件本质是"配置模板"，正确做法是提交模板（`config.example.toml`）、忽略真实配置，而不是二者留一。

## 全局忽略：你的口味，别强加给团队

个人编辑器配置（`.idea/`、`.vscode/`、`*.swp`）不要写进项目的 .gitignore——那是你的习惯，不是团队的约定：

```bash
git config --global core.excludesFile ~/.gitignore_global   # 指定全局忽略文件
echo ".DS_Store" >> ~/.gitignore_global
echo "*.swp" >> ~/.gitignore_global
git config --global --get core.excludesFile   # 查看当前全局忽略文件是哪个
```

排查"某个文件为什么被忽略了"用 `git check-ignore -v path/to/file`——直接告诉你命中了哪条规则、写在哪个文件里。两套规则各司其职，项目 .gitignore 保持纯净，个人习惯互不干扰。

> [!TIP]
> 各语言的 .gitignore 模板直接用 github/gitignore 仓库的现成文件起步，比自己攒靠谱；GitHub 建仓库的向导也能直接生成。

相关阅读：[Git 是什么](01-what-is-git.md)
