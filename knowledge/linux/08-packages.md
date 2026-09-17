---
title: 软件包管理
order: 8
tags: 基础, apt, 包管理
summary: apt/dnf 两大体系、安装卸载与搜索、软件源、版本固定常识。
---

装软件这件事，Linux 和 Windows 的差别是本质性的：系统自带包管理器，维护着**带依赖关系和数字签名的软件仓库**，一条命令完成搜索、安装、升级、卸载。要学的不是"去哪下安装包"，而是两大体系（apt/dnf）的对应操作。

## apt：Debian / Ubuntu 系

```bash
sudo apt update                  # 只刷新"仓库里有什么"的索引，不装任何东西
sudo apt upgrade                 # 把已装软件升到索引里的最新版
sudo apt install ripgrep         # 安装（自动解依赖）
sudo apt install ripgrep fzf     # 一次装多个
sudo apt remove ripgrep          # 卸载（保留配置文件）
sudo apt purge ripgrep           # 卸载并删除配置文件
sudo apt autoremove              # 清理不再被任何包依赖的孤儿包
apt search "json"                # 按关键词搜仓库
apt show ripgrep                 # 看版本、大小、依赖、描述
apt list --installed             # 列出已装的包
apt list --upgradable            # 列出可升级的
sudo apt clean                   # 清空下载缓存（/var/cache/apt/archives）
```

> [!TIP]
> 忘了 `update` 直接 `upgrade` 是新手的经典困惑——"为什么升不动"。apt 拿的是本地缓存的旧索引，先 update 拉一份新目录，再 upgrade 照单办事。记住分工：update 查目录，upgrade 装东西。

顺带一提 apt 与 apt-get 的关系：apt 是给人用的交互式前端（带进度条、建议），apt-get 是给脚本用的稳定接口——写脚本用 apt-get，交互用 apt。

反向查询也很常用——"这个文件是哪个包装的"：

```bash
dpkg -S /usr/bin/curl            # Debian 系：查文件属于哪个包
sudo apt install apt-file && apt-file update && apt-file search curl   # 反向：哪个包提供这个文件
```

## dnf：Fedora / RHEL 系

dnf 是 yum 的继任者，命令更简洁，机制相同：

```bash
sudo dnf install ripgrep         # 安装（dnf 每次操作前自动刷新元数据）
sudo dnf remove ripgrep          # 卸载
sudo dnf upgrade                 # 全部升级（老教材里的 dnf update 是别名）
dnf search json                  # 搜索
dnf info ripgrep                 # 详情
dnf list installed               # 已装列表
sudo dnf autoremove              # 清理孤儿包
dnf history                      # 操作历史，可回滚某次事务
dnf provides "*/ifconfig"        # 哪个包提供这个文件（net-tools 就是这样找到的）
```

注意差别：dnf 每条命令前自动刷新元数据，所以**没有独立的 update 步骤**；apt 的 update/upgrade 分离则是历史设计。

## 两套命令对照

| 操作 | apt | dnf |
| --- | --- | --- |
| 刷新索引 | `apt update` | （随命令自动刷新） |
| 全部升级 | `apt upgrade` | `dnf upgrade` |
| 安装 | `apt install x` | `dnf install x` |
| 卸载 | `apt remove x` | `dnf remove x` |
| 连配置卸载 | `apt purge x` | `dnf remove x` |
| 搜索 | `apt search x` | `dnf search x` |
| 看详情 | `apt show x` | `dnf info x` |
| 已装列表 | `apt list --installed` | `dnf list installed` |
| 包格式 | `.deb`（dpkg 底层） | `.rpm`（rpm 底层） |

dpkg/rpm 可以手动安装下载来的包，但**依赖要自己解决**，能用包管理器就别用：

```bash
sudo dpkg -i app.deb             # 手动装 deb，报缺依赖时补一句 sudo apt -f install
sudo rpm -i app.rpm              # 手动装 rpm，缺依赖会直接报错
```

下载来的单个包，更推荐直接交给包管理器装——它顺带把依赖也解了：

```bash
sudo apt install ./app.deb       # 注意 ./ 前缀：有它 apt 才知道这是本地文件而不是包名
sudo dnf install ./app.rpm       # dnf 同理
```

## 软件源：包从哪来

仓库地址就是几个纯文本文件：

- Debian 系：`/etc/apt/sources.list` 与 `/etc/apt/sources.list.d/` 下的条目（新版 Ubuntu 迁移到了 `.sources` 格式）
- RHEL 系：`/etc/yum.repos.d/*.repo`

一行 sources.list 长这样（每行 = 仓库地址 + 发行版代号 + 组件范围）：

```text
deb http://archive.ubuntu.com/ubuntu noble main restricted universe multiverse
```

换国内镜像就是把这些行里的域名换成镜像站；添加第三方源（如 Docker、NodeSource 官方源）通常是"导入 GPG 密钥 + 往 `sources.list.d/` 加一个文件"两步，**永远以软件官方文档的步骤为准**。

Ubuntu 还有个封装好的 PPA 机制：`sudo add-apt-repository ppa:maintainer/name`——个人维护的第三方源，方便但信任级别低于官方仓库，生产机慎用。

> [!WARNING]
> ❌ 不要为了装一个软件往 sources 里堆来路不明的源，也不要随手 `wget` 个 deb/rpm 就装。软件源是 Linux 安全模型的根基：包有签名校验，源被污染等于系统门户大开。

## 版本固定

生产环境有时需要"钉住"某个版本（比如依赖特定版本的数据库）：

```bash
apt list -a nginx                # 看看有哪些版本可装
sudo apt install nginx=1.24.*    # 指定版本安装
sudo apt-mark hold nginx         # 固定：之后 upgrade 会跳过它
sudo apt-mark unhold nginx       # 解除固定
apt-mark showhold                # 看当前固定了哪些

sudo dnf install nginx-1.24*     # dnf 同样支持版本指定
# dnf 的固定需要插件：装 dnf-command(versionlock) 后用 dnf versionlock add nginx-*
```

固定不是免费的：被钉住的包不再收安全更新。固定要记录原因和期限（哪怕只是写进 wiki），定期评估是否解绑——不然一年后没人记得为什么这个包永远在 upgradable 列表里。

自己编译的软件按 FHS 的分工装进 `/usr/local`（不与包管理器管辖的 `/usr` 混放），将来卸载才知道去哪删。跨发行版通用的 snap/flatpak 是沙盒化的补充渠道，桌面环境用得多，服务器上仍以原生包管理器为主。

> [!NOTE]
> "装软件"的完整心智模型：优先包管理器 → 没有再找官方第三方源 → 最后才考虑手动下包或编译。越靠后，升级和安全更新越要自己操心。

相关阅读：[权限与用户](04-permissions.md)
