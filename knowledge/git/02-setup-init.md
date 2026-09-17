---
title: 安装配置与初始提交
order: 2
tags: 工具链, config, init
summary: 安装、user.name/email、init 与 clone，以及第一次 add/commit 的完整走位。
---

Git 装好后第一件事是配置身份——每次提交都会永久刻上你的名字和邮箱。本篇从安装走到第一次提交，做完这些，仓库才算真正"活"了起来。

## 安装

```Shell
# Windows：官网下载安装包，一路默认（建议顺带装 Git Bash）
# macOS：
brew install git
# Debian / Ubuntu：
sudo apt install git
git --version              # 确认安装成功
```

> [!NOTE]
> Linux 上 Git 几乎是标配；Windows 版自带 Git Bash 与 CRLF/LF 转换选项（core.autocrlf），装的时候就要想好——见文末。

## 配置身份：user.name 与 user.email

每个提交都会记录作者信息，动手之前先把身份配好：

```bash
git config --global user.name "Zhang San"
git config --global user.email "zhangsan@example.com"
git config --global init.defaultBranch main      # 新仓库默认分支叫 main，不是 master
git config --global core.editor "code --wait"    # 写提交信息的编辑器换成 VS Code
git config --global --list                       # 查看全部配置
git config user.name                             # 不带值 = 查询当前生效值
```

配置分三个作用域，从大到小：

| 作用域 | 参数            | 配置文件                     |
| --- | ------------- | ------------------------ |
| 系统  | `--system`    | 安装目录下，所有用户共享             |
| 全局  | `--global`    | `~/.gitconfig`，当前用户的所有仓库 |
| 仓库  | `--local`（默认） | 仓库内 `.git/config`        |

近的覆盖远的：仓库级 > 全局 > 系统。公司项目要求用工作邮箱时，在仓库里用 `--local` 单独覆盖即可，不影响个人项目。

## 创建仓库：init 与 clone

两种入口，对应两种起点：

```bash
# 方式一：把现有目录变成仓库
mkdir demo && cd demo
git init                   # 生成 .git/ 目录，当前目录从此受 Git 管理
git init -b main           # 初始化时直接指定默认分支名

# 方式二：克隆已有仓库
git clone https://github.com/user/repo.git
git clone https://github.com/user/repo.git mydir   # 顺便指定本地目录名
```

`init` 之后目录里表面上什么都没变，只是多了 `.git/`——**仓库的全部本体都在这个隐藏目录里**。

> [!TIP]
> clone 一步到位：下载全部历史、自动把来源设为 origin 远程、给默认分支建好跟踪关系。所以刚克隆的仓库直接 `git pull` 不需要任何参数。

### 顺便配好 SSH（推荐）

平台上的仓库有两种地址：`https://...`（推拉要凭证）和 `git@...`（SSH，免密）。

```bash
ssh-keygen -t ed25519 -C "zhangsan@example.com"   # 生成密钥对，一路回车即可
cat ~/.ssh/id_ed25519.pub                         # 把公钥粘贴到平台的 SSH Keys 设置
ssh -T git@github.com                             # 测试连通，看到 Hi username! 即成功
```

已经用 https 克隆过的仓库，一条命令换协议：`git remote set-url origin git@github.com:user/repo.git`。

多个密钥、多个平台时，在 `~/.ssh/config` 里为不同 host 指定各自的 `IdentityFile`。

## 第一次提交的完整走位

```bash
git status                 # ① 此刻干干净净，还没有任何改动
echo "# demo" > README.md
git status                 # ② README.md 是 Untracked（红色）
git add README.md          # ③ 放进暂存区，变为 Staged（绿色）
git status                 # ④ 提交前最后确认一次暂存内容
git commit -m "init: 添加 README"    # ⑤ 创建第一个提交
git log --oneline          # ⑥ 查看历史，确认成功
```

走位的核心是：**status 是唯一的裁判**。不确定下一步该用什么命令时，先跑 `git status`，它会把"待暂存"和"待提交"分列摆给你看。

> [!WARNING]
> 提交作者信息会永久留在历史里。`user.email` 写错的典型后果：提交不算在 GitHub 的贡献图（绿格子）里——邮箱必须与平台账号绑定的一致。历史长了再改作者信息很麻烦，第一天就配对。

## 换行符：跨平台的第一道坑

Windows 换行是 CRLF，Linux/macOS 是 LF。不配置时，跨平台协作的 diff 里可能满是"整文件改动"，实际只是换行符在打架。

```bash
git config --global core.autocrlf input   # 提交时 CRLF→LF，检出时不转换
# ✅ 仓库里永远存 LF；本机怎么显示交给编辑器（配 .editorconfig 更稳）
```

更现代的做法是在仓库根目录放 `.gitattributes` 显式声明（如 `* text=auto`），把约定写进仓库，而不是赌每个人的本机配置一致。排查某文件被判定的属性：`git check-attr text eol -- path/to/file`。

## 少敲几个字：别名

```bash
git config --global alias.st status
git config --global alias.last "log -1 HEAD --stat"    # 最近一次提交改了什么
git config --global alias.unstage "restore --staged"   # git unstage file，语义直白
git st                     # 等价于 git status
```

别名不只是缩写，还能封装常用参数组合。但别急着配——先用手写全称把命令记住，肌肉记忆比缩写值钱。查看已有别名：`git config --get-regexp '^alias'`。

相关阅读：[日常基本流程](03-daily-workflow.md)
