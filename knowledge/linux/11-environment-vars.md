---
title: 环境变量与 shell 配置
order: 11
tags: 进阶, 环境变量, dotfiles
summary: PATH 的真相、export 与作用域、bashrc/profile 加载顺序、dotfile 管理。
---

环境变量是进程的"随身配置"：PATH 决定命令从哪找、LANG 决定编码、HTTP_PROXY 决定走不走代理。而 bashrc/profile 的加载顺序，是"为什么我 export 的变量不生效"这类问题的唯一答案。这篇把两件事一次讲透。

## 环境变量与作用域

每个进程带着一组 `KEY=value` 字符串出生，fork 子进程时**复制**一份传下去：

```bash
printenv | sort               # 当前 shell 的全部环境变量
echo $HOME                    # 引用：$NAME
APP_ENV=prod                  # 只是 shell 变量，子进程【看不见】
export APP_ENV=prod           # 导出为环境变量，之后启动的子进程都能继承
unset APP_ENV                 # 删除

API_KEY=abcd1234 ./run.sh     # 只给这一条命令注入，跑完即消失——最干净的方式
env -i bash                   # 空环境启动，模拟干净系统排查问题
```

除 PATH 外，值得认识的常客：

| 变量 | 作用 |
| --- | --- |
| `HOME` | 家目录，`~` 就是它 |
| `USER` / `SHELL` | 当前用户名 / 登录 shell |
| `LANG`、`LC_ALL` | 语言与编码；报错信息乱码先查它 |
| `EDITOR` | git commit 等程序调用的默认编辑器 |
| `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` | 命令行走代理的三件套 |
| `PS1` | 提示符的样子，下一节就靠它改 |

继承是**单向向下**的：子进程 export 什么、改什么，父进程一概不知。

> [!WARNING]
> 这就是"脚本里 export 了变量，终端里为什么没有"的答案：脚本是 shell 的子进程，它内部的 export 随脚本退出一起消失。要让当前 shell 生效，用 `source script.sh`（或 `. script.sh`）——它让脚本在**当前 shell 进程内**执行，不 fork 子进程。

## PATH 的真相

PATH 是冒号分隔的目录列表。敲 `python` 时，shell **从左到右**在列表里找第一个叫 `python` 的可执行文件——先到先得，后面的全部被遮蔽。

```bash
echo $PATH                    # 看顺序
which python                  # 告诉你实际命中了哪一个
type -a python                # 列出所有同名候选（含 alias、内建命令）
```

```bash
# ❌ export PATH=$HOME/.local/bin        —— 覆盖！ls、sudo 全部 command not found
export PATH="$HOME/.local/bin:$PATH"     # 加在前面：你的版本优先（遮蔽系统的）
export PATH="$PATH:$HOME/.local/bin"     # 加在后面：系统的优先，找不到才轮到你
```

"装了新版却还在跑旧版"几乎都是 PATH 顺序问题，`type -a` 一下就水落石出。命令找不到时的标准排查：`type cmd` → 确认可执行文件确实存在 → 确认它所在的目录在 PATH 列表里。别忘了 PATH 的赋值本身也受作用域规则约束——写在 bashrc 里才对每个新终端生效。

## bashrc 与 profile：加载顺序

bash 按启动方式读不同的文件，这是最容易被背错的知识点：

| 启动方式 | 读什么 |
| --- | --- |
| **登录 shell**（SSH 登录、WSL 初始窗口、控制台 tty） | `/etc/profile` → `~/.bash_profile`（不存在则 `~/.bash_login`，再则 `~/.profile`） |
| **非登录交互 shell**（图形界面每开一个终端窗口/标签） | `/etc/bash.bashrc` → `~/.bashrc` |

注意：登录 shell **不会自动读** `~/.bashrc`。惯例是在 `~/.profile` 或 `~/.bash_profile` 里带这段，把两条路串起来：

```bash
# ~/.bash_profile 的标配
if [ -f ~/.bashrc ]; then
    . ~/.bashrc               # . 与 source 等价：在当前 shell 里执行
fi
```

系统级的全局变量放 `/etc/profile.d/*.sh`（目录下每个 `.sh` 都会被登录 shell 读取，适合给所有用户配 JAVA_HOME 之类）。实践结论一句话：**个人配置（alias、PATH、提示符、环境变量）统一写 `~/.bashrc`**——有上面那段桥接代码，它就覆盖交互 shell 的两种启动路径。改完执行 `source ~/.bashrc` 让当前窗口立刻生效，或重开终端。

> [!TIP]
> "改了 bashrc 没生效"多半是忘了 source，或者改错了文件（动了 `~/.bash_profile`，而日常开的是非登录 shell）。判断当前是哪种：`shopt -q login_shell && echo login || echo non-login`。

bashrc 是普通脚本，写错一行，之后每次开终端都报错——改完立刻 source 验证，别攒。

## bashrc 里最常写的三样

```bash
# 提示符：用户@主机:目录$
PS1='\u@\h:\w\$ '

# 别名：高频缩写，alias 优先于 PATH 里的同名程序
alias ll='ls -lah'
alias gs='git status -sb'

# 代理：临时需要时打开这三行，不用就注释掉
# export http_proxy=http://127.0.0.1:7890
# export https_proxy=$http_proxy
# export no_proxy=localhost,127.0.0.1
```

排障小技巧：给 `LC_ALL=C` 前缀任何命令，能让排序和报错输出回到不可预料的英文与字节序——`sort` 速度更快、报错信息可搜索。日常保持系统默认的 UTF-8 locale 即可，别全局设 C。

## dotfiles 管理

bashrc、gitconfig、ssh config……这些散落在家目录的点开头文件，就是你的"个人系统配置"。换机器、重装系统时逐个重配是浪费生命，标准做法是收进 git 仓库：

```text
~/dotfiles/
├── bashrc           # 内容即 ~/.bashrc
├── gitconfig
├── ssh_config
└── install.sh       # 部署脚本
```

```bash
# 部署 = 真身放进仓库目录，原位置放符号链接
ln -s ~/dotfiles/bashrc ~/.bashrc
ln -s ~/dotfiles/ssh_config ~/.ssh/config
```

进阶可以用 GNU stow 管理链接：`cd ~/dotfiles && stow bashrc` 会自动为 `bashrc/` 目录下的文件在家目录创建符号链接，比手写 ln 不易错。几条纪律：

- **密钥、token 永远不进 dotfiles 仓库**（私有仓库也不行）。它们留在本机，或交给单独的 secret 管理
- 机器间差异大的部分放进独立的 `~/.bashrc.local`，在 bashrc 末尾 `if 存在则 source`，仓库里只放通用配置
- alias 只放真正省事的：`ll`、`gs` 这类高频缩写值得，冷门缩写两周后自己都忘

> [!NOTE]
> 环境"漂移"的根源是配置不可复现。一个 dotfiles 仓库加一个"新机器五分钟恢复"的 install 脚本，你就不怕任何重装——WSL 与真实服务器之间也能无缝复用同一份配置。

相关阅读：[Shell 脚本](06-shell-scripting.md)
