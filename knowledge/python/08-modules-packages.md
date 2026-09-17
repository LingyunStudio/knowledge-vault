---
title: 模块与包
order: 8
tags: 基础, import, 包结构
summary: import 的查找规则、__name__ == "__main__" 的作用、标准项目结构模板。
---

import 语句人人会写，但「Python 到哪里去找这个模块」「为什么直接双击运行和被 import 时行为不一样」这两个问题搞不清楚，项目一大就会撞墙。这一篇把查找规则、`__main__` 语义和标准项目结构一次说清。

## import 的几种姿势

```python
import json                       # 整个模块导入，用 json.load(...)
from json import loads            # 只导入名字，用 loads(...)，注意可能与本地名冲突
import numpy as np                # 长名字起别名，社区惯例别名要遵守
from pathlib import Path, PurePath   # 一行导入多个名字
```

`from xxx import *` 不要用：污染命名空间，读代码的人不知道名字从哪来，工具链也无从分析。

模块顶层代码在**第一次被 import 时执行一遍**，之后从缓存（`sys.modules` 字典）取，重复 import 不会重复执行。

## import 的查找规则

`import foo` 时，解释器按 `sys.path` 列表从上到下找：

```python
import sys
print(sys.path)    # 每一项是一个目录
```

典型顺序：

1. **入口脚本所在目录**（跑 `python a.py` 时是 a.py 所在目录；REPL 和 `python -m` 时是当前目录）
2. `PYTHONPATH` 环境变量里的目录
3. 解释器安装目录下的 `site-packages`（pip 装的第三方包都在这）

三种运行入口的差异汇总：

| 运行方式 | `sys.path[0]` | `__name__` |
| --- | --- | --- |
| `python a.py` | a.py 所在目录 | `"__main__"` |
| `python -m pkg.mod` | 当前工作目录 | `"__main__"` |
| `import pkg.mod` | 不变 | `"pkg.mod"` |

第一优先级是脚本目录，由此得出一条铁律：

> [!WARNING]
> 永远不要把自己的文件命名为 `random.py`、`json.py`、`requests.py`——它会被同目录导入规则顶掉标准库或第三方包，报错还是千里之外的另一行，排查极痛苦。文件名避开所有标准库模块名。

## `if __name__ == "__main__"` 的作用

每个模块都有 `__name__` 属性：直接运行时是 `"__main__"`，被 import 时是模块名。这个差异就是双用途文件的开关：

```python
# converter.py
def c_to_f(c):
    return c * 9 / 5 + 32

if __name__ == "__main__":
    # 直接 python converter.py 时才执行；被 import 时不执行
    print(c_to_f(100))     # 212.0
```

好处：别的文件 `import converter` 复用 `c_to_f` 时，不会被这些「试验代码」打扰；而单文件依然能直接跑。脚本入口、测试代码、示例用法都放进这个块里。

## 包：带结构的模块

包就是带 `__init__.py` 的目录，内部模块用点号分层。包内引用分两种：

```python
# src/mypkg/core.py
from .utils.text import clean        # 相对导入：. 是当前包，.. 是上一级
from mypkg.utils.text import clean   # 绝对导入：从项目根写全，更显式
```

团队协作建议默认用**绝对导入**，可读且重构友好；相对导入留给出包内部的小范围引用。

`__init__.py` 的作用：标记目录是包（并执行一次初始化），可以在里面做「再导出」收敛 API：

```python
# src/mypkg/__init__.py
from .core import Core, core_func    # 用户可以 from mypkg import Core
__all__ = ["Core"]                   # 声明 from mypkg import * 时导出什么
```

运行包内模块用 `python -m mypkg.core`（在项目根目录执行），它会正确处理包上下文，`python src/mypkg/core.py` 则会因为相对导入报错——这是经典困惑，记住用 `-m`。

> [!NOTE]
> 没有 `__init__.py` 的目录也能被导入（PEP 420 的命名空间包），但那是为大型发行版拆分设计的。日常项目老老实实放 `__init__.py`，工具链行为最可预期。

## 标准项目结构模板

```
myproj/
├── pyproject.toml        # 项目元数据与依赖声明（现代标准）
├── README.md
├── src/
│   └── mypkg/
│       ├── __init__.py
│       ├── core.py
│       └── utils/
│           ├── __init__.py
│           └── text.py
└── tests/
    └── test_core.py
```

要点：

- `src` 布局强制你「安装后使用」，测试环境与真实导入路径一致，避免「本地能跑、发布就坏」
- 依赖声明进 `pyproject.toml`（配合 `pip install -e .` 可编辑安装），`requirements.txt` 交给需要锁死版本的部署场景
- tests 与源码分离，测试文件名以 `test_` 开头以便 pytest 自动发现

环境管理（venv 与 pip）见[环境搭建与运行方式](01-getting-started.md)；单文件的 `__main__` 块写多了，就该按这个模板拆包了。

## 练习

- [ ] 在临时目录建一个 `json.py`，`import json` 并打印 `json.__file__`，亲眼看看遮蔽效应，然后删掉它
- [ ] 写一个双用途模块：`python dice.py` 打印随机点数，被 import 时只提供 `roll()` 函数
- [ ] 按模板搭一个最小项目，用 `python -m mypkg.core` 跑通一次

相关阅读：[环境搭建与运行方式](01-getting-started.md)
