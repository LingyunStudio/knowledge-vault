---
title: SSH 与远程操作
order: 9
tags: 核心, ssh, 密钥
summary: 密钥登录、ssh_config 别名、scp/rsync 传输、端口转发一页纸。
---

服务器工作的第一入口是 SSH。这篇解决四件事：用密钥替代密码、用 config 给服务器起别名、用 scp/rsync 传文件、用端口转发够到够不着的内网服务。

## 密钥登录

密码登录的问题：可被暴力破解，且每条 ssh/scp 都要输一遍。密钥认证用非对称加密：私钥留本机，公钥放进服务器的 `~/.ssh/authorized_keys`。

```bash
ssh-keygen -t ed25519 -C "work-laptop"   # 生成密钥对（-C 只是备注）
# 默认生成 ~/.ssh/id_ed25519（私钥，绝不外传）与 id_ed25519.pub（公钥，随便放）

ssh-copy-id user@host                    # 把公钥装到服务器上
# Windows 无此命令：手动把 .pub 内容追加到服务器的 ~/.ssh/authorized_keys
```

权限是硬性要求，不对就直接拒绝工作：

```bash
chmod 700 ~/.ssh                  # 服务器上：家目录下的 .ssh
chmod 600 ~/.ssh/authorized_keys  # 本机的私钥同样是 600
```

之后 `ssh user@host` 不再要密码。多把密钥（公司/个人分开）用 `-i` 指定，或写进 config。首次连接会提示确认主机指纹——这是防中间人的机制：除了重装系统，指纹变化都要警惕。

ssh-agent 把解密后的私钥缓存在内存里，适合加密保护过的私钥：

```bash
eval $(ssh-agent)         # 启动 agent（现代桌面/WSL 通常已自动跑着）
ssh-add ~/.ssh/id_ed25519 # 输一次密码短语，本会话内不再重复问
ssh -T git@github.com     # 测试 Git 的 SSH 通道是否打通，通则显示用户名
```

`git clone git@github.com:user/repo.git` 走的就是这套 SSH 密钥，配置一次，git push/pull 全程免密。

## ssh_config：给服务器起别名

`~/.ssh/config` 是 SSH 世界的配置中心，每次连接都会读取：

```text
Host dev                       # 别名，随便起
    HostName 203.0.113.10      # 真实地址
    User deploy                # 默认用户
    Port 2222                  # 非默认端口
    IdentityFile ~/.ssh/id_ed25519
    ServerAliveInterval 60     # 每 60 秒发心跳，防长时间交互断线

Host *.internal
    User root
    ProxyJump dev              # 经 dev 跳板访问内网机器
```

配置后 `ssh dev` 等价于原来那串 `ssh -p 2222 deploy@203.0.113.10 -i ...`。scp、rsync、git 全都认这套别名——一处配置，处处生效。还能配置连接复用，让第二条 ssh 瞬间连上：

```text
Host *
    ControlMaster auto
    ControlPath ~/.ssh/cm-%r@%h:%p
    ControlPersist 10m         # 首条连接保持 10 分钟，后续连接直接复用通道
```

> [!TIP]
> `ssh dev uptime` 直接在远端执行单条命令并返回；`ssh dev "df -h && free -m"` 就是批量巡检的雏形。SSH 的价值不止登录，更在"远程执行"。

## scp 与 rsync

```bash
scp app.tar.gz user@host:/tmp/      # 本机 → 远程
scp user@host:/var/log/app.log .    # 远程 → 本机
scp -r src/ user@host:/srv/         # 递归目录

rsync -avz src/ user@host:/srv/app/              # 同步目录（首选）
rsync -avzP src/ user@host:/srv/app/             # -P 显示进度且支持断点续传
rsync -avz -e "ssh -p 2222" src/ user@host:/srv/app/   # 走非默认端口
rsync -avn --delete src/ user@host:/srv/app/     # ❌ --delete 前必跑 -n 预演
```

rsync 优于 scp 的核心是**增量**：它比对源与目标的大小和修改时间，只传输有差异的部分（大文件还能按数据块级别的差异传输），中断后重跑自动续传。第一次全量、之后秒级同步——这正是它成为部署与备份标配的原因。

两个易错点：

- **尾斜杠语义**：`src/` 同步 src 的**内容**到目标；`src`（无斜杠）会在目标下创建 src 目录本身。rsync 事故八成出在这
- `--delete` 让目标与源严格一致（目标多出来的文件会被删）——❌ 配合路径写错就是清空目标目录，永远先 `rsync -avn`（-n 即 dry-run）预演

> [!WARNING]
> scp 简单但每次全量传输；目录同步、断点续传、保留权限时间戳都该用 rsync（`-a` 等于递归 + 保留权限/属主/时间戳，`-v` 显示过程，`-z` 压缩传输）。

## 端口转发一页纸

```bash
# 本地转发 -L：访问本机 8080 = 访问"服务器视角的" localhost:80
ssh -L 8080:localhost:80 user@host
# 典型场景：数据库、管理后台只监听服务器本机，映射到本地浏览器访问

ssh -L 5432:db.internal:5432 user@host
# 转发目标还能写服务器内网的另一台机器

# 远程转发 -R：把本机服务暴露给远端（反向）
ssh -R 9000:localhost:3000 user@host
# 服务器上的 9000 端口流量会回到你本机的 3000——给内网 demo 临时暴露服务

# 动态转发 -D：本机起一个 SOCKS5 代理
ssh -D 1080 user@host
# 浏览器代理设为 socks5://127.0.0.1:1080 后，流量经服务器出去
```

记忆模型：`-L` 是"把远端够得着的服务拉到本地"，`-R` 是"把本地服务推给远端"，`-D` 是"把整条通道当代理用"。

连不上时按报错分流排查：

| 报错 | 含义 | 第一反应 |
| --- | --- | --- |
| `Connection refused` | 机器可达，端口没人听 | sshd 挂了或端口不对；`ss -tlnp` 看服务器侧（见[网络工具速查](10-network-basics.md)） |
| `Connection timed out` | 包被丢弃，路由不通 | 安全组/防火墙拦截，或 IP 写错 |
| `Permission denied (publickey)` | 认证失败 | 私钥路径/权限（600）、公钥没进 authorized_keys、服务器禁了 root 登录 |

> [!NOTE]
> 转发默认只监听本机 127.0.0.1，安全。同一条 ssh 命令可以叠加多个 `-L` 同时映射 web 和数据库；只要隧道不要终端就加 `-N -f`（不执行远程命令、转后台）。会话开着，转发才活着。

相关阅读：[网络工具速查](10-network-basics.md)
