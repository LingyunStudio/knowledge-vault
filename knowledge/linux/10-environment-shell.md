---
title: 环境变量与 Shell 配置：进程的继承链
order: 10
tags: 环境变量, PATH, bashrc, dotfiles
summary: 环境变量的进程继承模型（fork 复制 + 覆盖）、export 的真实语义、PATH 的查找机制与经典事故、bash/zsh 配置文件的加载矩阵（login/interactive 与「放哪个文件」）、dotfiles 的版本管理。
---

「环境变量没生效」与「配置文件不加载」是 Shell 世界的两大日常困惑。两者的根因是同一个模型：**每个进程自带一份环境（键值对副本），fork 时从父进程复制，之后各自独立**——理解继承链，所有「变量为什么没了」的问题都能推导。

## 1. 环境变量的机制：进程环境块

```bash
env | sort                 # 当前进程的全部环境变量
printenv HOME              # 读单个
echo "$HOME"               # Shell 里展开

FOO=bar                    # Shell 变量：只存在于当前 Shell（子进程看不见）
export FOO=bar             # 导出：复制进之后 fork 的子进程的环境
FOO=new                    # 修改后子进程看到新值；但已启动的子进程不受影响
```

继承模型的三个推论：

1. **单向、单次**：子进程拿到的是 fork 时刻的快照副本——之后父进程改了，子进程不知道；子进程改了，父进程也不知道。「export 了但程序没看到」：程序是在 export **之前**启动的（常见于 systemd/IDE/守护进程——它们的环境来自启动时刻）。
2. **export 的是「放进环境」这个动作**，不是变量的属性：`export FOO=bar` 后 `FOO=baz` 仍是环境变量（Shell 记住导出标记）。
3. **临时环境**：`VAR=值 cmd` 前缀形式只影响这一次调用：`LANG=C sort file.txt`——不改 Shell 状态的最小作用域姿势。

## 2. PATH：命令查找的搜索路径

```bash
echo $PATH
# /usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games:~/.local/bin
which python3          # PATH 顺序里第一个命中的——「这个命令到底是谁」
type -a python3        # 列出 PATH 里全部命中（alias/内建/多个文件）
```

PATH 是冒号分隔的目录列表，Shell 逐目录找可执行文件——**「command not found」= 所有目录里都没有**，**「执行了旧版本」= 旧版本目录排在前面**。修改姿势：

```bash
export PATH="$HOME/.local/bin:$PATH"      # 前插：优先用我的（常用）
export PATH="$PATH:/opt/mytool/bin"       # 后插：兜底
```

经典事故两则：

- **`export PATH=xxx`**（没有 `:$PATH`）：PATH 只剩一个目录，`ls` 都找不到——当前会话瘫痪（新开终端可救）。
- **点进 PATH**（`PATH=.:$PATH`）：当前目录可执行文件劫持系统命令名（在陌生目录 `ls` 可能是恶意脚本）——安全红线，永远不要。

## 3. 配置文件矩阵：哪个文件管哪个场景

bash 的配置加载由两个维度决定：

- **login shell**？SSH 登录、`su -`、控制台登录 → 是；终端窗口里再开 bash → 否。
- **interactive**？人在交互 → 是；跑脚本 → 否。

```text
登录 Shell：   /etc/profile → ~/.bash_profile（或 ~/.bash_login / ~/.profile）
                  └─（惯例上它会 source ~/.bashrc）
交互非登录：   /etc/bash.bashrc → ~/.bashrc
非交互脚本：   只看 $BASH_ENV 与脚本自身 —— 配置文件大多不加载！
```

结论表（bash）：

| 你要放的东西                       | 放哪               |
| ---------------------------------- | ------------------ |
| 每次 Shell 都要的：别名、PATH、提示符 | `~/.bashrc`         |
| 仅登录时的：启动通知、SSH-agent、环境导出 | `~/.bash_profile` |
| 全系统默认                          | `/etc/profile.d/*.sh` |

**「.bashrc 里改了 PATH 但 SSH 登录后没生效/脚本里没生效」**的答案就在矩阵里：登录 Shell 先走 .bash_profile（若它不 source .bashrc 就断了）；脚本是非交互的（环境靠继承与显式 source）。zsh 的对应结构是 `.zshenv`（总是加载）→ `.zprofile`（登录）→ `.zshrc`（交互）→ `.zlogin`，通用变量放 `.zshenv`。

`source file`（或 `.`）在**当前 Shell**执行脚本——「把配置加载进来」的机制（区别于 bash file 的子进程执行）。

## 4. 必须认识的系统环境变量

| 变量            | 作用                                  | 事故场景                                |
| --------------- | ------------------------------------- | --------------------------------------- |
| `PATH`          | 命令查找                              | 见上节                                   |
| `HOME`          | 家目录（~ 的展开源）                   | root 与用户的 HOME 不同——「为什么它读了我的配置」|
| `LANG`/`LC_ALL` | 语言与编码（`LC_ALL=C` 强制 ASCII 排序）| 排序/日期格式随 LANG 变化——脚本里 `LC_ALL=C` 固定行为 |
| `EDITOR`        | git/crontab 等调用的编辑器             | 「git commit 打开 nano」                   |
| `LD_LIBRARY_PATH` | 动态库的额外搜索路径                  | 兼容性问题之源（该用 rpath/ldconfig.conf）|
| `http_proxy`/`https_proxy` | 命令行工具的代理约定          | 大写/小写两套并存（curl 都认）             |
| `NO_COLOR`      | 关闭彩色输出的跨工具约定               | CI 日志                                   |

`LD_LIBRARY_PATH` 值得点名：它是「调试时指个临时库」的工具，**不是发布配置**——全局设置它等于把库查找顺序的确定性交给环境状态，兼容性事故的温床。正规做法：库放标准路径 + `ldconfig`，或编译时 rpath。

## 5. dotfiles：配置的版本管理

你的 `.bashrc/.gitconfig/.vimrc/ssh config` 是生产力资产——**用 Git 管理**：

```bash
# 方案①：bare 仓库（最轻）
git init --bare ~/.dotfiles.git
alias config='/usr/bin/git --git-dir=$HOME/.dotfiles.git --work-tree=$HOME'
config add .bashrc && config commit -m "bashrc"
config remote add origin git@github.com:me/dotfiles.git && config push

# 新机器恢复：
git clone --bare git@github.com:me/dotfiles.git $HOME/.dotfiles.git
config checkout
```

方案②GNU stow（符号链接农场：`~/dotfiles/bash/.bashrc` 链回 `~/.bashrc`）。无论哪种：**敏感文件（.ssh 私钥、凭据）绝不进 dotfiles 仓库**；配置里区分「通用」与「机器特定」（`.bashrc.local` 不入库的模式）。

## 6. 陷阱清单

- 「export 了为什么程序没看到」：程序在 export 前启动（systemd/IDE/守护进程的环境是启动时刻的）；改环境要重启服务。
- `export PATH=xxx` 覆盖式赋值：丢掉整个原 PATH；永远 `PATH="...:$PATH"`。
- bash 配置矩阵错位：环境变量放 .bashrc 而 SSH 登录链断了 source；分清 login/interactive 各放各的。
- 脚本依赖环境变量：cron/systemd/CI 的环境是裸的；脚本内显式设置或用文件配置。
- LD_LIBRARY_PATH 当发布配置：临时调试工具而已；库用 ldconfig 或 rpath。
- dotfiles 里混进私钥：仓库泄露 = 全部主机沦陷；.ssh/config 可入库、私钥绝不。
- `LC_ALL` 与 LANG 的层级混乱：LC_ALL 最高（覆盖一切），排程序行为差异先查它。

## 7. 小结

- 环境变量是进程环境的键值副本：fork 复制、单向单次、`VAR=x cmd` 前缀是最小作用域；「没生效」先查「程序什么时候启动的」。
- PATH 是命令查找的冒号列表：`which/type -a` 定位真相、追加用 `:$PATH`、点目录进 PATH 是安全红线。
- bash 配置矩阵按「login × interactive」分流：交互配置进 .bashrc、登录环境进 .bash_profile、脚本环境靠继承与显式 source。
- 系统变量的事故地图：PATH/LANG/EDITOR/LD_LIBRARY_PATH——各自的「别这样做」比「该这样做」更值钱。
- dotfiles 用 bare git 或 stow 管理：生产力资产版本化，私钥排除在外。

## 8. 练习

**1.** 验证继承模型：Shell 里 `FOO=1` 后启动子 bash 查看 FOO；export 后再对比；在已运行的子 bash 里改 FOO 回到父 Shell 查看——画出三个观察点。

> [!TIP]
> 思路子进程改动不回流父进程（单向）；export 后的子 bash 继承（快照）。再实验「子 bash 里 export 的变量在父 bash 不可见」——继承链的终点就是 export 的边界。

**2.** 复现「export PATH=xxx」事故并恢复：临时丢掉 PATH（保留一个恢复窗口），用全路径 /usr/bin/ls 验证命令查找机制，然后恢复 PATH。

> [!TIP]
> 思路事故现场连 which/type 都找不到（它们也是 PATH 命令）——用绝对路径自救。这个实验解释了 PATH 的本质：Shell 找命令的唯一线索，丢了就回到「全路径时代」。

**3.** 绘制你的 bash 配置加载图：在 /etc/profile、~/.bash_profile、~/.bashrc 各加一条 echo 标记，分别用「SSH 登录」「终端内开 bash」「bash script.sh」三种方式观察谁被加载。

> [!TIP]
> 思路SSH 登录走 profile 链、终端新开走 bashrc 链、脚本几乎全跳过。三种观察做完，「配置放哪」的决策变成查表而不是猜。

**4.** 把「脚本在 cron 里跑不起来」修好：写一个依赖 PATH 与 HOME 的脚本放进 crontab，观察失败，再用「脚本内显式设置环境」修复——总结 cron 环境的最小化程度。

> [!TIP]
> 思路cron 环境 PATH 常只有 /usr/bin:/bin——你的 ~/.local/bin、conda 等全不在。修复模式：脚本头部 `PATH=/usr/local/bin:/usr/bin:/bin` 或封装 wrapper。「服务化环境最小化」是 cron/systemd/CI 的共同特征。

**5.** 用 bare git 方案初始化你的 dotfiles 仓库：纳入 .bashrc、.gitconfig、.ssh/config（不含私钥），推到私有远端，并在虚拟机里完整恢复。

> [!TIP]
> 思路恢复的关键三步：clone --bare、config alias、checkout（冲突时用 checkout -f 或 stash 现有文件）。做完一次，「换机器配置半小时」变成「换机器配置五分钟」。

**6.** 讨论：`LD_LIBRARY_PATH` 为什么在开发里有用、在生产里有毒？从「查找顺序的确定性」「多应用共存」「安全（库注入）」三个角度分析，给出生产环境的替代方案清单。

> [!TIP]
> 思路毒点：全局环境变量影响所有进程（应用 A 的库版本污染应用 B）、可被指向恶意库（提权向量）。替代：ldconfig.conf + ldconfig（系统级注册）、编译 rpath（应用级锁定）、容器（环境天然隔离）。环境变量的「全局性」是它便利与危险的同源。
