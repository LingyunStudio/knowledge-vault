---
title: 环境搭建与运行方式
order: 1
tags: 工具链, venv, pip
summary: 解释器、REPL 与脚本、venv 虚拟环境与 pip 换源，Python 项目的起跑线。
---

Python 是解释型语言：代码不经过编译，由解释器直接逐行执行。上手确实只要五分钟——但「能跑」和「跑对」之间，隔着虚拟环境、包管理和换源三道坎，新手一半的环境问题都出在这里。这一篇把起跑线的动作一次讲清。

## 确认安装与三种运行方式

先确认解释器就位：

```bash
python --version     # 输出 Python 3.12.x；Windows 上也可以用 py --version
```

**方式一：REPL**（交互式解释器）。终端直接输入 `python`，随手试验 API、验证小想法，学习期最好用的工具：

```bash
$ python
>>> 1 + 1
2
>>> exit()           # 退出；Windows 下 Ctrl+Z 回车，Linux/macOS 下 Ctrl+D
```

**方式二：运行脚本**，绝大多数实际场景：

```bash
python hello.py
```

**方式三**：`-m` 以模块身份运行（尤其是标准库工具），`-c` 执行一行代码：

```bash
python -m json.tool data.json                  # 用标准库的 json.tool 美化 JSON
python -c "import sys; print(sys.version)"     # 一行代码确认当前解释器版本
```

> [!TIP]
> 装包时用 `python -m pip` 代替裸 `pip`：前者保证 pip 一定作用于你指定的那个解释器，避开「装进 A 环境却以为装到了 B」的经典错位。

## venv：每个项目一个隔离环境

第三方包装在全局会互相污染：A 项目要 `requests==2.31`，B 项目要 `2.28`，全局解释器只能装一份。venv 的解法是给每个项目一份独立的解释器视图：

```bash
python -m venv .venv     # 在当前目录创建虚拟环境，目录名约定俗成为 .venv
```

激活之后，`python` 和 `pip` 都指向 `.venv` 内部：

```bash
# Windows PowerShell
.venv\Scripts\Activate.ps1
# Windows cmd
.venv\Scripts\activate.bat
# macOS / Linux
source .venv/bin/activate
```

激活成功的标志是提示符前多了 `(.venv)`，退出用 `deactivate`。

venv 不是黑魔法：它在项目目录里放了一套指向真解释器的软链和一个独立的 `site-packages`，激活时把该目录排到 `PATH` 最前面，于是你「走进」了这个环境。删掉 `.venv` 目录，环境就干净消失，不留残余。

> [!WARNING]
> `.venv/` 不要提交进 Git——它是随时可以重建的环境，真正该入库的是依赖清单 requirements.txt。`.gitignore` 里先写上这一行。

## pip：装包与依赖清单

```bash
python -m pip install requests               # 安装最新版
python -m pip install "requests==2.31.0"     # 锁定精确版本
python -m pip install "requests>=2.28"       # 限定版本区间
python -m pip list                           # 查看已装了什么
python -m pip show requests                  # 查看某个包的版本与依赖
```

导出与复原，是环境迁移的标准动作：

```bash
python -m pip freeze > requirements.txt      # 把当前环境的依赖写进清单
python -m pip install -r requirements.txt    # 在新机器上照单全收
```

新建的 venv 里只有 pip 等极少数包（3.12 起 venv 不再预装 setuptools），`pip list` 一眼就能确认环境是干净的。

## 换源：国内环境的必选项

PyPI 官方源在国内的下载速度经常感人，装个 numpy 转半天圈。全局换成清华镜像，一次配置长期受益：

```bash
python -m pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple
```

只想对单次安装生效时，用 `-i` 临时指定：

```bash
python -m pip install -i https://mirrors.aliyun.com/pypi/simple/ requests
```

常用镜像还有阿里云 `mirrors.aliyun.com/pypi/simple/`、中科大 `pypi.mirrors.ustc.edu.cn/simple/`。配置写到哪了可以用 `python -m pip config list -v` 查看。

> [!NOTE]
> 换源解决的是下载吞吐问题，不是版本解析问题。装不上包时先看报错是网络超时还是依赖冲突，再确认包名拼写与 Python 版本兼容性——盲目重试换源救不了 `ResolutionImpossible`。

## 新项目起跑线

动作是固定的，建议练成肌肉记忆：

```bash
mkdir myproj && cd myproj
python -m venv .venv
.venv\Scripts\Activate.ps1              # Windows；Linux/macOS 用 source .venv/bin/activate
python -m pip install requests
python -m pip freeze > requirements.txt
```

用 VS Code 或 PyCharm 打开项目后，手动把解释器指向 `.venv` 内的 python——此后编辑器里的运行、调试、补全都对齐同一个环境，不会出现「终端能跑、IDE 报错」的灵异事件。

## 练习

- [ ] 创建 venv 并激活，用 `python -m pip list` 确认环境初始状态，再用 `python -c "import sys; print(sys.executable)"` 确认解释器指向 `.venv` 内部
- [ ] 用 `python -m json.tool` 格式化一段 JSON 文本
- [ ] 配置清华镜像源，并用 `pip config list -v` 找到配置文件的实际位置

相关阅读：[模块与包](08-modules-packages.md)
