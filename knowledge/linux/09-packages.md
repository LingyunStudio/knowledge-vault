---
title: 软件包管理：apt、dnf 与生态
order: 9
tags: apt, dnf, pacman, dpkg, 依赖
summary: 包管理器解决的三件事（依赖解析/签名验证/版本一致性）、apt 与 dnf 的完整工作流与易混命令（update/upgrade、history undo）、语言生态包管理器与系统包管理器的边界（PEP 668）、第三方仓库的信任模型。
---

装软件在 Linux 上不是「下载安装包」——是**向受签名的仓库请求带依赖清单的包**。包管理器解决三件事：**依赖解析**（A 需要 B 的 1.2 版）、**签名验证**（包没被篡改）、**版本一致性**（全系统一个数据库管状态）。三个主流方言（apt/dnf/pacman）概念同构、命令不同——学一套，另一套对着概念表翻译。

## 1. apt：Debian/Ubuntu 阵营

```bash
sudo apt update               # ★ 更新「仓库索引」（包的目录，不装任何东西）
sudo apt upgrade              # 按索引升级已装包
sudo apt install nginx        # 安装（自动解析并装依赖）
sudo apt remove nginx         # 卸载（留配置）
sudo apt purge nginx          # 卸载 + 删配置（「清除」）
sudo apt autoremove           # 清掉「只为依赖而装、现在没人要」的包

apt search "mysql server"     # 搜索（不用 sudo）
apt show nginx                # 包详情（版本/依赖/描述/大小）
apt list --upgradable         # 有哪些可升级
sudo apt full-upgrade         # 升级允许「移除冲突包」（发行版大版本升级用）
```

**update 与 upgrade 是两件事**：update 刷新「货架目录」，upgrade 按「目录」进货——「install 之后找不到新版本包」十有八九是忘了 update。`apt` 命令是新接口（交互友好）；底层 `dpkg` 处理单个 .deb：

```bash
dpkg -l | grep nginx          # 已装包清单
dpkg -L nginx                 # 这个包装了哪些文件（文件 → 包的反查用 dpkg -S /usr/bin/nginx）
sudo dpkg -i foo.deb          # 装 .deb（不解析依赖——依赖缺失时补 apt install -f）
```

版本固定（回滚/锁定）：

```bash
apt list -a nginx             # 看可用版本
sudo apt install nginx=1.24.0-1ubuntu4    # 装指定版本
sudo apt-mark hold nginx      # 锁定：upgrade 跳过它
```

## 2. dnf：Red Hat 阵营

```bash
sudo dnf install nginx && sudo dnf remove nginx
dnf search nginx && dnf info nginx
sudo dnf upgrade              # 等价 apt upgrade（dnf update 是别名）
dnf list installed | grep nginx

dnf history                   # ★ 事务历史：每次 install/remove 一条记录
sudo dnf history undo 42      # ★ 撤销第 42 号事务（dnf 的杀手级特性）
```

`dnf history undo` 是「一次安装引发的连锁问题」的干净解法——按事务反向回滚，而不是逐个 remove。RHEL 长生命周期意味着**包版本常年不变、bug 修复走 backport**——「软件版本老」是特性不是缺陷（配套的是完整的安全补丁承诺）。

## 3. pacman：Arch 阵营（速查）

```bash
sudo pacman -Syu package      # 同步索引 + 全量升级 + 安装（滚动发行版：升级即日常）
pacman -Ss keyword            # 搜索；pacman -Qi pkg 详情；pacman -Ql pkg 文件清单
sudo pacman -Rns package      # 卸载 + 依赖 + 配置（一步到位）
```

Arch 滚动更新（无版本号跨越）要求**勤升级**——攒半年再升是滚动发行版翻车的标准姿势。

## 4. 概念对照表

| 概念         | Debian/Ubuntu    | RHEL/Fedora        | Arch        |
| ------------ | ---------------- | ------------------ | ----------- |
| 安装         | `apt install`    | `dnf install`      | `pacman -S` |
| 刷新索引     | `apt update`     | （dnf 自动）        | `-Sy`       |
| 升级         | `apt upgrade`    | `dnf upgrade`      | `-Syu`      |
| 底层包工具   | dpkg / .deb      | rpm / .rpm         | pacman 本体  |
| 文件清单     | `dpkg -L`        | `rpm -ql`          | `pacman -Ql`|
| 反查文件归属 | `dpkg -S`        | `rpm -qf`          | `pacman -Qo`|
| 历史回滚     | （apt 无原生）    | `dnf history undo` | （降级 -U） |

「这个文件是哪个包带来的」是排查系统问题的常用反查（`dpkg -S /usr/bin/curl`）——每个阵营都有对应命令。

## 5. 语言生态的包管理器：边界与冲突

pip/npm/cargo 与系统包管理器管**不同的依赖图**——它们各自的包进各自的目录（`site-packages`/`node_modules`），系统包进 `/usr`。冲突来自「同一个软件两处都有」：

- **PEP 668**（Debian 12+/Ubuntu 23.04+）：系统 Python 标记为「externally-managed」，裸 `pip install` 被拒绝——防止 pip 覆盖 apt 装的 Python 库造成系统工具损坏。正解：**虚拟环境（venv）或 `pipx`（应用级隔离）**，而不是 `--break-system-packages`（那是关闭保护）。
- Node 生态独立成熟（nvm 管版本）；cargo/Rust 几乎无冲突。
- 判断原则：**系统组件用系统包管理器（安全补丁走系统渠道），语言依赖用语言生态（版本自由）**——把 apt 装的 Python 包与 venv 里的包混为一谈是事故之源。

## 6. 第三方仓库：信任模型与风险

```bash
# Docker 官方仓库的标准接入（Ubuntu）：导入签名密钥 → 注册仓库 → 安装
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker.gpg
echo "deb [signed-by=/usr/share/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update && sudo apt install docker-ce
```

第三方仓库的信任链：**GPG 密钥验证包来源**——签名校验失败的警告（NO_PUBKEY）不该跳过而该修密钥。风险意识：第三方仓库的包可能与系统包**同名冲突**（覆盖系统组件），来源越少越好；企业环境用仓库镜像/白名单管控。

## 7. 编译安装：最后的手段

```bash
./configure --prefix=/usr/local     # 探测环境 + 设定安装位置
make -j$(nproc)                     # 并行编译
sudo make install                   # 装进 /usr/local（不碰包管理器领地，[第 2 篇](02-filesystem.md)）
```

编译安装的代价：**脱离包管理器的状态管理**——没有卸载记录、没有升级通知、没有依赖追踪。有仓库版先仓库版；必须编译时 `--prefix=/usr/local`（或 stow 管理前缀）保持可卸载性。

## 8. 陷阱清单

- `apt install` 找不到新版本：忘了 `apt update`；update 是索引刷新不是升级。
- remove 与 purge 混淆：remove 留配置（重装保留原样）；要「干净移除」用 purge。
- 日常 `full-upgrade`：允许卸包，大版本升级才用；日常 upgrade。
- 裸 pip 装进系统 Python：PEP 668 保护与 --break-system-packages 的对抗；用 venv/pipx。
- 第三方仓库密钥警告绕过：签名是供应链防线；NO_PUBKEY 要修不要跳。
- 编译安装裸奔：--prefix 之外的位置 = 卸不掉的孤儿文件；固定 /usr/local。
- 滚动发行版攒升级：pacman -Syu 要勤；部分升级（-Sy 后只装个别包）是 Arch 翻车标准路径。
- `dnf history undo` 不知道：回滚实验性安装的正确工具。

## 9. 小结

- 包管理器 = 依赖解析 + 签名验证 + 全系统状态数据库；方言不同、概念同构（索引刷新/安装/升级/清单/反查）。
- apt 的节奏：update（索引）→ upgrade（按索引升级）；purge vs remove 的配置语义；apt-mark hold 锁版本。
- dnf 的 history undo 是事务级回滚的标杆；RHEL 的「老版本 + backport」是企业稳定性的实现方式。
- 语言生态与系统包管理的边界：系统组件走 apt/dnf、语言依赖走 venv/pipx/nvm；PEP 668 是保护不是障碍。
- 第三方仓库的信任建立在 GPG 签名上；编译安装以 `--prefix=/usr/local` 保住可卸载性。

## 10. 练习

**1.** 在虚拟机/WSL 里完成一次完整升级流程：update → list --upgradable → upgrade → autoremove，解释每步的输出里「索引、已装、待升级」三组信息的对应关系。

> [!TIP]
> 思路update 的「Get:N」行是索引下载；list --upgradable 是按新索引算出的差额；autoremove 的候选来自「依赖关系变化」。三条输出的信息链就是包管理器的状态机。

**2.** 反查实验：随机选一个系统命令（如 /usr/bin/ssh），用 dpkg -S 找到归属包，再用 dpkg -L 列出包内全部文件，总结「包 → 文件 → 包」双向查询的用途。

> [!TIP]
> 思路正向（包装了什么）用于清理前评估、反向（文件来自哪）用于溯源与排障。`dpkg -S` 对 /usr/local 下的文件无答案——那是非包管理领地（[第 2 篇](02-filesystem.md)的边界）。

**3.** 用 dnf history undo（或 apt 的降级）回滚一次安装实验：装一个小包 → 确认 → 回滚 → 再确认。写出两种阵营各自的「回滚姿势」。

> [!TIP]
> 思路dnf：`dnf history` 找事务号 → `dnf history undo N`。apt：`apt install pkg=旧版本`（先 `apt list -a pkg` 查可用版本）+ hold。「事务回滚」的有无是两阵营工程哲学差异的缩影。

**4.** 给 Ubuntu 配置 Docker 官方仓库（本篇第 6 节流程），对照官方文档逐行理解：gpg 密钥的作用、sources.list.d 条目的字段、signed-by 的意义。

> [!TIP]
> 思路第三方仓库接入的四件套：密钥（验签）、仓库条目（地址+组件）、update（纳入索引）、安装。理解一遍后，任何供应商的 Linux 安装文档都是同一个模板的变体。

**5.** 体验 PEP 668：在 Ubuntu 24.04 上裸 `pip install requests` 观察拒绝信息，改用 `python3 -m venv` 与 `pipx` 两条正路完成同一目标，解释两者隔离粒度的差异。

> [!TIP]
> 思路venv 隔离「一个项目的依赖」、pipx 隔离「一个命令行应用的依赖」——粒度对应使用场景（库开发 vs 装工具）。--break-system-packages 是「关掉烟雾报警器继续抽烟」。

**6.** 讨论：为什么企业服务器倾向「从发行版仓库装一切」而开发机允许大量语言生态包管理器？从「安全补丁渠道、变更审计、环境一致性」三个维度分析，给出你的分界线。

> [!TIP]
> 思路服务器：apt/dnf 渠道 = 有安全团队背书的补丁流 + 可审计的安装历史；开发机：新版本需求压倒统一性。分界线随团队规模与合规要求移动——「可审计」在事故复盘时的价值常被低估。
