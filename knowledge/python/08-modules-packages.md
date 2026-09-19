---
title: 模块与导入系统：import 是执行
order: 8
tags: 模块, 包, sys.path, 循环导入, pyproject
summary: import 的三步执行（查找→执行→缓存）与模块单例语义、__init__.py 作为公共 API 面、相对导入的规则、sys.path 与虚拟环境的关系、循环导入的三个解法，以及 src 布局与 pyproject.toml 的工程结构。
---

`import` 看起来像 C 的 `#include`，实际是另一种东西：**执行**。导入一个模块 = 找到文件 → **从头到尾执行它** → 把结果缓存进 `sys.modules`。理解「import 是执行」之后，模块级副作用、`__main__` 判断、循环导入这些现象全部变得可推导。

## 1. 模块机制：查找、执行、缓存

```python
import utils          # ① 在 sys.path 里找 utils.py
                      # ② 从头到尾执行它（顶层代码全部运行）
                      # ③ 缓存进 sys.modules["utils"]
import utils          # ④ 直接命中缓存：不再执行！
```

三个直接推论：

1. **模块是单例**：全程序 import 一百次也只有一次执行、一个模块对象。模块级变量因此就是全局状态（[第 1 篇](01-python-model.md)的三问同样适用）。
2. **顶层代码在 import 时执行**——所以模块顶层只该放定义与常量，耗时/有副作用的逻辑放函数里（或 `if __name__ == "__main__":`）。
3. **`__name__ == "__main__"` 的机制**：直接运行 `python utils.py` 时 `__name__` 是 `"__main__"`；被 import 时是 `"utils"`。这个判断让文件既能当脚本又能当模块：

```python
# utils.py 顶层
def clean(s): ...

if __name__ == "__main__":       # 只有直接运行才走这里
    print(clean(" demo "))       # 模块自测 / CLI 入口
```

### 1.1 导入的四种形式与取舍

```python
import json                       # 命名空间完整：json.dumps(...)（最明确）
import numpy as np                # 别名：约定俗成的缩写（np、pd、plt）
from json import dumps            # 直取名字：调用短，但来源不如 import json 显眼
from json import *                # ❌ 禁止：把几十个名字倒进当前命名空间，来源不可追溯
```

规约：默认 `import x`；频繁使用且约定别名（numpy→np）用 as；`from x import y` 适合明确的一两个名字；`*` 只允许出现在 `__init__.py` 配合 `__all__` 控制导出面。

## 2. 包：目录即命名空间

```text
myapp/
├── pyproject.toml
└── src/
    └── myapp/                # 包 = 带导入语义的目录
        ├── __init__.py       # 包的「门面」：首次 import myapp 时执行
        ├── core.py
        └── io/
            ├── __init__.py
            └── file.py
```

### 2.1 __init__.py 的两个职责

```python
# src/myapp/__init__.py
from myapp.core import Engine          # 重导出：调用方 from myapp import Engine 即可
from myapp.io import read_file

__all__ = ["Engine", "read_file"]      # 显式公共 API（配合 from myapp import *；
                                       # 更重要的是「声明哪些是接口」的文档作用）
__version__ = "1.2.0"
```

`__init__.py` 在包被 import 时执行——它把包组装成整洁的 API 面：**内部模块怎么组织是实现细节，`from myapp import Engine` 是稳定契约**。内部重构（core.py 拆成三个文件）不再波及调用方。

### 2.2 相对导入与绝对导入

```python
# myapp/io/file.py 内部
from myapp.core import Engine          # ✅ 绝对导入：从包根写全（默认推荐）
from .core import Engine               # ✅ 相对导入：「本包的 core」（. 当级，.. 上级）
from .. import __version__             # 上一级包
import file                            # ❌ Python 3 不再隐式相对导入（3 的重大变化）
```

相对导入的限制：**只能用在包内**，直接运行包内文件（`python myapp/io/file.py`）会报「attempted relative import with no known parent package」——因为它的 `__package__` 丢了。工程解法是让一切入口走包（`python -m myapp.io.file`，`-m` 按包语义运行）。

## 3. 查找路径：sys.path 与虚拟环境

### 3.1 import 从哪里找

```python
import sys
sys.path       # 模块搜索路径列表，按顺序查找：
# [''（脚本所在目录/当前目录）, 虚拟环境的 site-packages, 标准库路径, PYTHONPATH 的条目, ...]
```

虚拟环境的本质就是**改写 sys.path 的顺序与内容**：激活 venv 后，它的 `site-packages` 排在前面，`import requests` 找到的是 venv 里安装的版本。理解这一点，以下现象都可解释：

- 「装了包还是 ImportError」：运行的不是激活环境里的 Python（`which python` / `python -m pip` 检查）。
- 「标准库被覆盖」：自己命名了 `json.py` 放在脚本目录——**当前目录优先于标准库**，shadowing 生效，之后全程序 `import json` 都是你的文件。**模块文件永远不要与标准库重名**（json、os、test、typing 是重灾区）。
- `sys.path.append` 的滥用：脚本里硬编码路径是把安装问题糊在代码里——正规解是 `pip install -e .`（可编辑安装）。

### 3.2 安装与 pyproject.toml

```toml
# pyproject.toml —— 现代项目的唯一配置入口
[project]
name = "myapp"
version = "1.2.0"
requires-python = ">=3.11"
dependencies = ["requests>=2.31", "pydantic>=2.5"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project.optional-dependencies]
dev = ["pytest", "ruff", "mypy"]
```

```bash
uv venv && uv pip install -e ".[dev]"    # 可编辑安装：import myapp 从 src/ 解析
pytest                                    # 测试里 import myapp —— 走安装好的包路径
```

**src 布局的核心理由**：源码在 `src/myapp`，不在项目根——测试与工具 import 的是**安装后**的包，能立刻暴露「忘了把新文件打进包」「隐式依赖当前目录」的问题。平铺布局（包目录在根）会让 cwd 恰好替代安装，掩盖这类错误。

## 4. 循环导入：成因与三个解法

```python
# a.py
from b import helper          # 执行 a → 执行 b
def run(): helper()
# b.py
from a import run             # 执行 b → 回头 import a：a 尚未执行完！
                              # run 还没定义 → ImportError（或拿到半成品模块）
```

成因一句话：**两个模块在顶层互相 import，而 import 会执行顶层**——后导入的回头要一个还没定义的名字。

三个解法（按优先级）：

```python
# ① 重构（治本）：把共同依赖下沉到第三个模块，依赖图变成 DAG
#    core.py（共同定义）/ a.py / b.py 都只 import core

# ② 函数内延迟导入（治标）：import 移到使用处
def run():
    from b import helper      # 调用时 b 已就绪
    helper()

# ③ 类型注解专用：TYPE_CHECKING（注解只是类型信息，运行时不需要）
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from b import Config      # 只在 mypy 检查时导入

def process(cfg: "Config"): ...   # 字符串前向引用
```

循环导入的出现几乎总是**模块边界设计问题**（两个模块耦合过深），延迟导入只能止痛——出现循环导入时先问「这两个模块真的应该互相认识吗」。

## 5. 动态导入与工程细节

```python
import importlib

mod = importlib.import_module("myapp.io.file")   # 字符串驱动的导入：插件系统的地基
cls = getattr(mod, "FileEngine")                  # 插件注册表：名字 → 对象

# 条件导入：可选依赖的标准形制
try:
    import orjson as json_lib          # 有就快
except ImportError:
    import json as json_lib            # 没有就标准库
```

其他工程要点：

- **`-m` 运行**：`python -m myapp` 需要 `__main__.py`——包级 CLI 入口的标准形态。
- **导入成本**：import 是运行时行为，模块顶层 import 的大库（pandas）会拖慢一切启动——CLI 工具的「秒开」优化就是延迟导入重依赖。
- **__pycache__**：字节码缓存（[第 1 篇](01-python-model.md)），进 .gitignore；源码变化自动失效，无需手动清。
- **测试的导入路径**：pytest 配合 src 布局时测试文件 `from myapp import ...`——若报 ModuleNotFoundError，先查「装了吗（-e）」而不是折腾 sys.path。

## 6. 陷阱清单

- 模块与标准库重名（json.py、os.py）：当前目录优先，全程序 shadowing；换名。
- 顶层代码有副作用（连数据库、读配置）：import 即执行；副作用进 main 或惰性。
- `from x import *`：命名空间污染；显式导入或 __init__ + __all__。
- 直接运行包内文件导致相对导入崩：`python -m` 运行包入口。
- 循环导入用 try/except 掩盖：是设计问题；重构 DAG 或 TYPE_CHECKING。
- sys.path.append 硬编码路径：用可编辑安装（uv/pip install -e）。
- 「装了包还 ImportError」：多 Python/多环境错位；`which python` + `python -m pip` 对齐。
- 忘了 `__init__.py`（或该有 API 面却空着）：包不可导入 / API 面混乱。
- 巨库顶层 import 拖慢启动：CLI 场景延迟导入。
- 重构后旧路径仍被引用：pycache 与安装副本的陈旧拷贝；重装 -e。

## 7. 小结

- import = 查找 → 执行 → 缓存：模块是单例、顶层代码随 import 执行、`__name__ == "__main__"` 由此而来。
- 包用 `__init__.py` 组装 API 面（重导出 + `__all__`），内部结构可自由重构；绝对导入为主、相对导入限包内、`python -m` 是包语义的运行方式。
- sys.path 的顺序决定一切：虚拟环境靠它工作、当前目录 shadowing 标准库、正规项目用 src 布局 + 可编辑安装锁死导入路径。
- 循环导入是模块耦合的症状：重构 DAG 治本、延迟导入与 TYPE_CHECKING 治标；动态导入（importlib）是插件机制的地基。
- pyproject.toml 是现代项目的单一配置源：依赖、构建、工具配置合一。

## 8. 练习

**1.** 用 `sys.modules` 与打印语句验证「模块只执行一次」：a.py 顶层 print，两个不同模块 import a，观察输出次数；再 `importlib.reload(a)` 观察重载语义。

> [!TIP]
> 思路无论多少处 import，顶层 print 只在首次出现——缓存命中。reload 重新执行顶层，但**已持有旧名字的代码不受影响**（它们绑的是旧对象）——这解释了 reload 为什么在开发中半好用、在测试中常出怪事。

**2.** 复现标准库 shadowing：在脚本目录建 `random.py`，观察 `import random` 拿到自己的文件；删除后恢复。总结「给文件命名」的禁区清单。

> [!TIP]
> 思路当前目录在 sys.path 最前。禁区：所有标准库名（json/os/sys/test/random/typing/email...）+ 你依赖的第三方库名。经验法：文件名全部小写复数或带项目前缀。

**3.** 构造循环导入并按三种方式修复：下沉公共模块、函数内延迟导入、TYPE_CHECKING。比较三者的副作用（初始化顺序、运行时开销、类型检查支持）。

> [!TIP]
> 思路下沉：治本，无副作用；延迟导入：每次调用一次 import 开销（查缓存很快，可忽略），但隐藏依赖关系；TYPE_CHECKING：零运行时成本，仅解决「类型注解需要」这一种循环。真实项目常是「下沉 + TYPE_CHECKING」组合。

**4.** 把一个平铺布局的项目改造成 src 布局 + pyproject.toml + `uv pip install -e .`：验证「删掉 src 里的一个模块后测试立刻红」——说明这个立刻变红为什么是 src 布局的价值。

> [!TIP]
> 思路平铺布局下 cwd 恰好让 import 成功，掩盖「新文件没打进包/路径 hack」；src 布局强制走安装路径，包内容与磁盘脱节立刻暴露。「让错误尽早出现」是布局选择的全部理由。

**5.** 实现一个最小插件系统：`plugins/` 目录下每个 `*_plugin.py` 暴露 `register(registry)`，主程序用 `importlib` + `pkgutil` 自动发现并加载全部插件。讨论「自动发现」的失败模式（坏插件、重名）。

> [!TIP]
> 思路`pkgutil.iter_modules(pkg.__path__)` 枚举 → import_module → getattr(register)。失败模式：插件异常（隔离加载、收集错误）、重名（命名空间前缀）、导入副作用（插件规范里禁止顶层副作用——与本篇第 1 节呼应）。

**6.** 一个 CLI 工具启动要 800ms，分析发现顶层 `import pandas` 占 600ms 但只在 `--export` 子命令用到。给出重构方案并讨论「延迟导入」的代码组织（局部 import vs 入口分发）。

> [!TIP]
> 思路方案①把 pandas import 移进 export 函数（最简单）；②入口按子命令分发、各子命令模块惰性 import（架构清晰）。延迟导入的代价是「依赖关系不再一目了然」——用 pyproject 声明依赖、用文档/类型检查弥补，是 CLI 生态（如 pip 自身）的成熟做法。
