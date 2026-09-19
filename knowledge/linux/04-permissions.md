---
title: 权限体系：rwx、归属与 sudo
order: 4
tags: chmod, umask, sudo, setuid, ACL
summary: rwx 对文件与目录的不同语义（目录的 x 是进入权）、ugo 三组与数字/符号两种 chmod、umask 的默认权限算法、setuid/setgid/sticky 三个特殊位、sudo 的机制与最小授权，以及传统权限不够时的 ACL。
---

权限模型是 Linux 多用户安全的根基。它表面上是一串 `rwxr-xr-x`，实质是**三个问题**：对谁（u/g/o）、做什么（r/w/x）、谁说了算（属主/组/其他）。学权限的关键不是背数字，是理解 **rwx 在文件与目录上的含义完全不同**——以及三个特殊位与 sudo 的机制。

## 1. 读模型：ls -l 的每一列

```bash
$ ls -l /var/log/syslog
-rw-r-----  1 syslog adm    123456 Sep 19 10:00 syslog
│└┬┘└┬┘└┬┘   │  └──┬──┘ └┬┘  └────────┬─────────┘
│ u  g  o    │  属主   属组       大小 时间 名字
└ 类型
```

| 列       | 含义                                                |
| -------- | --------------------------------------------------- |
| 类型      | `-` 文件、`d` 目录、`l` 链接（[第 2 篇](02-filesystem.md)七种） |
| rwx × 3   | 属主(u)/属组(g)/其他(o) 各三权                        |
| 硬链接数  | 指向该 inode 的名字数                                 |
| 属主/属组 | 谁的文件                                             |

每个进程运行时带有「用户身份」（uid 与所属组列表），访问文件时内核按 **属主匹配 → 组匹配 → 其他** 的顺序取用对应的三权——匹配即停，不叠加。

## 2. rwx 的语义：文件与目录是两套

这是权限学习的第一分水岭：

| 权限 | 对普通文件                | 对目录                                  |
| ---- | ------------------------- | --------------------------------------- |
| r    | 读取内容                   | **列出目录内容**（看到文件名清单）        |
| w    | 修改内容                   | **增删改目录里的条目**（建/删/改名文件）  |
| x    | 执行（程序/脚本）          | **进入并穿越**（cd 进去、访问内部条目）   |

推论值得逐条消化：

- **目录没有 x**：即使 r 权限在，也只能「看到名字列表」而不能 cd 进去、不能读文件内容——`chmod 644 dir` 之后目录变成「玻璃橱窗」。
- **目录没有 r 但有 x**：能 cd 进去、能按已知名字访问文件，但不能 ls——「知道名字才能用」的隐藏目录技巧。
- **目录的 w 是危险权限**：能删目录里的**任何文件**（不管文件本身是否可写！）——删除的权限检查在目录不在文件。防误删靠粘滞位（第 4 节）。

## 3. chmod：数字与符号两种语言

### 3.1 数字法

r=4、w=2、x=1，三权相加得一位八进制：

```bash
chmod 644 file     # rw- r-- r--   普通文件的标准形态
chmod 755 script   # rwx r-x r-x   可执行/目录的标准形态
chmod 600 id_rsa   # rw- --- ---   私钥（只属主可读——SSH 对权限不达标的私钥会拒绝使用）
chmod 700 dir      # rwx --- ---   私有目录
```

记两个基准就够了：**644（文件）与 755（目录和可执行）**，其余按需推导。

### 3.2 符号法：增量修改

```bash
chmod +x deploy.sh          # 三组都加执行（ugo 省略 = 全部）
chmod u+x,go-w script       # 属主加执行，组和其他去掉写
chmod g-r secrets.conf      # 组去掉读
chmod -R g+w /srv/share     # 递归（目录树的批量授权）
```

数字法是「设定终态」、符号法是「相对调整」——修复单个文件用数字，批量微调用符号，混着用最自然。

## 4. umask：新文件的默认权限从哪来

```bash
umask                # 0002（典型用户）/ 0022（root）
touch new.txt && ls -l new.txt
# -rw-r--r--  →  666 & ~umask = 666 - 0022 的位 = 644
# 目录：777 - 022 = 755
```

算法：新文件上限 666（新建文件天然无 x——执行权必须显式给，这是防「下载个脚本就能跑」的安全设计）、新目录上限 777，再**减去** umask 的位。umask 在 Shell 配置（`~/.bashrc`）或 systemd 服务里设置——多人共享目录的「互相读不了」事故多半是各人 umask 不同所致，统一方案见 ACL（第 6 节）。

## 5. 三个特殊位

| 位       | 符号表示 | 作用                                             | 典型现场                    |
| -------- | -------- | ------------------------------------------------ | --------------------------- |
| setuid   | `u+s`/4  | 执行该程序时**临时获得文件属主的身份**             | `/usr/bin/passwd`（需要写 /etc/shadow——root 才可写，但普通用户要能改自己密码）|
| setgid   | `g+s`/2  | 对目录：新文件的**组继承目录的组**（而非创建者主组）| `/srv/share` 共享目录（团队文件组一致） |
| sticky   | `+t`/1   | 对目录：只有文件属主（或目录属主）能删自己的文件    | `/tmp`（`drwxrwxrwt`——人人可写，但不能互删） |

```bash
chmod 4755 program        # setuid（4 + 755）
chmod 2775 /srv/share     # setgid 目录（2 + 775）：团队协作目录的标准配置
chmod 1777 /tmp-like      # sticky（1 + 777）
```

setuid 是安全审计的重点对象（提权通道）：`find / -perm -4000 2>/dev/null` 列出全系统 setuid 程序，陌生的要警觉。

## 6. sudo：受控的提权

root（uid 0）绕过一切权限检查。直接用 root 的问题：误操作无界、审计无据、职责无分。**sudo** 是「以声明过的身份执行声明过的命令」：

```bash
sudo systemctl restart nginx     # 以 root 跑单条命令
sudo -u postgres psql            # 以指定用户（不一定是 root）跑
sudo -i                          # 交互式 root shell（等同登录 root，慎用）
sudo -l                          # ★ 查看我被允许执行什么
```

授权规则在 `/etc/sudoers`（**永远用 `visudo` 编辑**——语法错误会锁死所有 sudo，visudo 保存前检查语法）：

```text
# 用户  主机=(以谁的身份) 允许的命令
alice   ALL=(ALL:ALL) ALL                    # 完全授权（常见于个人服务器）
deploy  ALL=(root) NOPASSWD: /usr/bin/systemctl restart myapp    # 最小授权样板
%developers  ALL=(ALL) /usr/bin/apt update, /usr/bin/apt upgrade   # 组授权
```

最小授权的样板值得背：**指定用户 + 指定命令 + 免交互密码（自动化场景）**——CI 部署、服务管理都长这样。

## 7. ACL：传统模型的三权不够时

传统权限每组只有一份「属主/属组/其他」。需求是「这个文件 alice 可写、bob 只读、其他人不可见」时，传统模型要造组才能表达——**ACL（访问控制列表）允许逐用户/逐组附加规则**：

```bash
getfacl report.txt                 # 查看完整 ACL
setfacl -m u:bob:r report.txt      # 给 bob 授读权（rwx 三权任配）
setfacl -m u:alice:rw report.txt
setfacl -d -m g:team:rwx /srv/share   # 默认 ACL：新建文件自动继承
```

`ls -l` 的权限位尾部出现 `+` 表示该文件带 ACL。共享目录（Samba、多人协作、Web 服务的运行目录）是 ACL 的主场——Samba/NFS 环境几乎必备。

## 8. 用户与组的基础管理

```bash
id                       # 我是谁（uid/组列表）
groups alice             # 某用户在哪些组
sudo useradd -m -s /bin/bash bob    # 建用户（-m 建家目录 -s 指定 Shell）
sudo passwd bob                     # 设密码
sudo usermod -aG docker bob         # ★ 追加到组（-a 追加 + -G 组；漏 -a 会覆盖组列表！）
getent passwd | wc -l               # 系统用户数据库（/etc/passwd 的读取接口）
```

`usermod -aG` 的 `-a` 是「append」——漏了它会把用户的组列表**覆盖**成只剩一个 docker，事故经常发生在给同事开 Docker 权限的时候。改组后需要重新登录才生效（组列表在登录时确定）。

## 9. 陷阱清单

- 目录权限按文件思维给（644 的目录）：没有 x 无法进入；目录基准 755。
- 忘了删除的权限检查在目录：给目录 g+w 等于允许整组互相删文件；共享目录配 setgid + sticky。
- `usermod -G` 漏 `-a`：组列表被覆盖；永远 `-aG`。
- chmod -R 777 「解决一切」：把安全模型拆了；先想清楚给谁什么权，再考虑 ACL。
- sudoers 手编：语法错锁死系统；只走 visudo。
- setuid 堆积不管：`find / -perm -4000` 定期审计。
- umask 不同导致共享目录互不可读：共享目录用 setgid + 默认 ACL 统一。
- 私钥权限 644：SSH 拒绝使用；600。

## 10. 小结

- 权限 = 三问：对谁（u/g/o，匹配即停）、rwx 什么（文件与目录语义不同：目录 x 是穿越、w 是增删条目）、六位数字或符号表达。
- 基准形态：文件 644、目录/可执行 755、私钥 600、私有目录 700；符号法做增量、数字法定终态。
- umask 是新文件的默认权限减法（文件 666 起步无 x）；三个特殊位各司其职：setuid 提权执行、setgid 组继承、sticky 防互删（/tmp 模型）。
- sudo = 声明式提权：visudo 编辑、最小授权样板（用户+命令+NOPASSWD）、sudo -l 自查。
- ACL 表达「多主体多权限」：setfacl/getfacl、默认 ACL 让共享目录的组协作自然发生。
- 组管理的基础动作 `-aG`（永远带 -a）与「改组需重登」的时点。

## 11. 练习

**1.** 实验「目录 r、x、w 的独立语义」：分别构造 444、111、777 的目录，验证「r 无 x 能看名不能进」「x 无 r 能进不能列」「w 能删别人的文件」三种行为。

> [!TIP]
> 思路x 无 r 的目录里，若你知道文件名仍可 `cat`——「隐藏但可访问」的组合。w 删他人文件实验要配 sticky 位对照：加 +t 后删除被拒。三组实验做完，rwx 的目录语义就刻住了。

**2.** 用数字法与符号法各把一个文件从 644 变成 600、把目录从 755 变成 750，互相验证等价性。

> [!TIP]
> 思路数字：`chmod 600 f`、`chmod 750 d`。符号：`chmod go-r f`（去组与其他的读）、`chmod o-rx d`。两种语言的「终态 vs 增量」互补性在这里直观化。

**3.** 复现 setuid 的提权语义（用 `cp /usr/bin/passwd .` 之类受控实验或读 passwd 的 ls -l 输出），解释「普通用户改自己密码」为什么需要它——写文件的权限检查为什么绕得过去。

> [!TIP]
> 思路/etc/shadow 是 root-only，但 passwd 程序 setuid 到 root 执行——内核在 exec 时切换有效 uid。安全边界从「用户」变为「被 setuid 的程序是否可信」——这就是 setuid 程序要审计的原因。

**4.** 搭建一个「团队共享目录」：/srv/share 组 team，要求新文件自动归 team 组、组内可读写、成员不能互删。写出完整命令（含 setgid 与 sticky 或 ACL 方案），并验证新建文件的组归属。

> [!TIP]
> 思路`chgrp team /srv/share && chmod 2775 /srv/share`（setgid 让组继承 + sticky 防互删）或 `setfacl -d -m g:team:rwx` 默认 ACL。注意 umask 仍会收紧权限位——完整方案常是 setgid + umask 002 或默认 ACL。

**5.** 写一段 sudoers 最小授权：给 deploy 用户「只允许无密码重启 myapp 服务」。用 visudo 语法写出，并说明为什么不用 `ALL`。

> [!TIP]
> 思路`deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart myapp`。最小授权的价值：deploy 账号泄露时攻击面被限死在「重启一个服务」。配套：命令路径写全（防止 PATH 劫持同名脚本）。

**6.** 讨论：多租户服务器上，某人坚持 `chmod -R 777 /opt/app` 「解决部署报错」。给出三层回应：这样做了什么风险、报错的真正原因可能是什么、正确的最小授权怎么做。

> [!TIP]
> 思路风险：任何用户可改可删（包括植入代码，如果应用以任何用户身份跑）；真正原因常是「运行服务的用户对特定目录无写权」；最小授权：chown 到服务账号 + 精确目录 750/760，或 ACL。777 是「把诊断问题替换成安全问题」的权宜。
