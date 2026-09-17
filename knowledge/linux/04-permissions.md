---
title: 权限与用户
order: 4
tags: 核心, chmod, sudo
summary: rwx 三组权限、数字与符号两种写法、属主属组、sudo 的正确姿势。
---

`Permission denied` 是 Linux 给新手上的一课。权限系统其实只有一张 3×3 的表格加两个属主字段，十分钟可以讲完，但它决定了"哪些事你做得了、哪些必须 sudo"，值得彻底搞懂。

## rwx 三组九位

`ls -l` 开头的 `-rw-r--r--` 共 10 个字符：第 1 位是类型（`-` 文件、`d` 目录、`l` 链接），后 9 位按 **属主 / 属组 / 其他人** 分三组，每组都是 `rwx`：

```text
-rw-r--r-- 1 alice dev 1024 Sep 13 10:00 report.txt
  ─┬──────  ─┬────  ─┬────
  属主(u)    属组(g)   其他(o)
```

- 对**文件**：`r` 读内容，`w` 改内容，`x` 当程序执行
- 对**目录**，三个字母含义完全不同：`r` 列出目录里的文件名，`w` 在目录里增删文件，`x` 进入目录并访问其中文件的元数据

> [!WARNING]
> 目录没有 `x` 时，就算有 `r` 也只能看到文件名列表，进不去、读不了里面的文件。排查"明明有 r 却 Permission denied"，先检查路径上每一层目录是否有 `x`。

## 数字与符号两种写法

数字法把 `rwx` 当二进制位：`r=4, w=2, x=1`，每组求和，三组并排：

| 数字 | 权限 | 典型用途 |
| --- | --- | --- |
| 755 | rwxr-xr-x | 目录、自己的脚本 |
| 644 | rw-r--r-- | 普通文件、配置 |
| 700 | rwx------ | 私密目录（如 `~/.ssh`） |
| 600 | rw------- | 私密文件（如私钥） |
| 777 | rwxrwxrwx | ❌ 人人可写等于放弃防线，禁止 |

```bash
chmod 644 report.txt      # 属主读写，其他人只读
chmod 700 ~/.ssh          # 只有自己能进
chmod -R 755 www/         # 递归整个目录（-R 前先想清楚波及范围）
```

符号法用于**增量调整**，不碰其他位：

```bash
chmod u+x deploy.sh       # 给属主加执行位（下载的脚本没有 x 跑不了）
chmod go-w report.txt     # 去掉属组和其他人的写权限
chmod a+r pub.txt         # 所有人（a = ugo）加读
chmod o=r report.txt      # 其他人精确设为只读
```

两种写法各有分工：已知目标状态用数字（一次到位），只想微调一位用符号（不影响其他组）。

## 属主、属组与 umask

每个文件同时属于一个用户和一个组。`chown` 改属主（可连属组一起改），`chgrp` 只改组：

```bash
ls -l                              # 第三、四列就是属主与属组
id                                 # 我是谁：UID、所属的所有组
groups                             # 只看组
sudo chown alice report.txt        # 改属主为 alice
sudo chown alice:dev report.txt    # 属主 alice，属组 dev
sudo chown -R www-data:www-data /var/www   # 网站目录的经典操作
```

改属主需要 root——否则你就能把文件"送"给别人、绕过磁盘配额。**组**是团队共享的正解：把同事加进 dev 组，共享目录 `chgrp dev` 再 `g+rwx`，比逐个 chown 干净得多。Web 服务"没有权限读静态文件"的正解通常不是 chmod 777，而是 `chown` 给服务运行的那个用户（如 `www-data`）。

用户与组的管理命令，日常就这几条：

```bash
sudo adduser bob                  # 创建用户（交互式，含家目录和默认组）
sudo usermod -aG docker bob       # 把 bob 加进 docker 组——-a 附加，-G 指定组
sudo groupadd devs                # 新建组
getent group docker               # 看某个组里有哪些成员
```

经典场景是 `usermod -aG docker bob` 让普通用户能连上 Docker 守护进程。注意 **`-aG` 忘了 `-a` 会把用户踢出其他所有组**——这是真实事故级的手误，`-G` 是"设为仅属于这些组"，`-aG` 才是"追加"。

新建文件的默认权限由 **umask** 决定：从满权限里减掉 umask 的位。umask 022 → 新文件 `666-022=644`，新目录 `777-022=755`；改成 077 则新文件 600、新目录 700，适合多用户共用一台机器时的自我保护。敲 `umask` 看当前值。

还有三个特殊权限位，认识即可：SUID（`ls -l /usr/bin/passwd` 里的 `rws`——执行者临时获得文件属主的身份，普通用户才能改自己的密码）、SGID（目录上设置后，新文件自动继承目录的组）、sticky bit（`/tmp` 的 `rwt`——人人可写，但只能删自己的文件）。

## 权限排查的标准走位

遇到 Permission denied，按这个顺序取证，两分钟能定位：

```bash
id                                 # ① 我是谁、在哪些组
ls -l /srv/app/data/config.yml     # ② 目标文件的属主属组与权限位
namei -l /srv/app/data/config.yml  # ③ 逐层列出路径上每个目录的权限
sudo -l                            # ④ 我能 sudo 哪些命令
```

`namei -l` 是这个场景的隐藏神器：拒绝访问的原因经常不是文件本身，而是路径上**某一层目录**少了对你的 `x` 或 `r`。它把整条路径逐层展开对照，比逐个 cd 快得多。走完 ①-④，"谁、对什么、缺哪种权限"三个要素就齐了——剩下的只是改 chmod/chown 还是找管理员的判断题。

## sudo 的正确姿势

sudo = 以另一个用户（默认 root）的身份执行**这一条**命令，授权规则在 `/etc/sudoers`（只用 `visudo` 编辑，它保存前会做语法检查）。它优于长期登录 root 的地方：操作有日志、授权按命令粒度、root 密码不需要人人皆知。

```bash
sudo -l                      # 列出我被授权执行哪些命令
sudo apt install ripgrep     # 单条命令临时提权
sudo -i                      # 进入 root 的登录 shell（加载 root 的环境）
sudo -s                      # 也进 root shell，但保留当前环境变量
sudo !!                      # 上条命令忘加 sudo？!! 代表上一条命令原样重放
```

节奏建议：**能一条 sudo 解决就不进 root shell**；需要连续多条 root 操作时 `sudo -i` 进去，干完 `exit` 出来。自动化脚本需要免密时，白名单要收窄到具体命令，放进独立文件更好管理：

```text
# /etc/sudoers.d/deploy（用 sudo visudo -f /etc/sudoers.d/deploy 编辑）
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart myapp
```

sudo 执行过的命令记录在日志里（`/var/log/auth.log` 或 `journalctl`），出事能追到人——这是它比"共享 root 密码"先进的根本原因。

> [!WARNING]
> 两个坏习惯：一是用 `chmod -R 777` 修权限——问题没修好，还把防线拆了，正确思路是搞清楚**哪个进程以什么身份读哪个文件**；二是常年泡在 `sudo -i` 里干活，一条 `rm` 手误就是全盘事故。

> [!TIP]
> "Operation not permitted" 和 "Permission denied" 含义不同：前者多半是 root 级限制（改别人的文件、chattr 锁定的文件），后者是普通 rwx 不够。排障时先分清卡在哪一层。

相关阅读：[软件包管理](08-packages.md)
