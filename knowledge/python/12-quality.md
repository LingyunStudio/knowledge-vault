---
title: 工程化：类型、测试与工具链
order: 12
tags: typing, mypy, pytest, ruff, CI
summary: 类型注解的渐进本质与现代语法（泛型、Optional/|、Protocol、TypedDict）、pytest 的 fixture/parametrize/monkeypatch、测试替身的依赖注入替代、ruff 的 lint 与格式化一体化、以及一个完整的 CI 配置把所有工具串成流水线。
---

Python 的动态类型换来速度，工程化的任务就是把「运行时才发现」的错误尽量左移：**类型注解**把类型错误左移到静态检查，**测试**把逻辑错误左移到提交前，**lint/格式化**把风格争论消灭在工具里。这三件事都不改变语言——它们是架在动态语言之上的质量流水线。

## 1. 类型注解：渐进类型的正确姿势

### 1.1 基本语法与本质

```python
def price_with_tax(base: float, rate: float = 0.13) -> float:
    return base * (1 + rate)

items: list[str] = ["a", "b"]           # 3.9+ 内置泛型（旧的 List[str] 已过时）
mapping: dict[str, int] = {}

# 注解的本质：元数据，运行时【不强制】！
price_with_tax("abc")     # 照样运行（直到 *2 抛 TypeError）—— 类型错在运行时仍会爆炸
# mypy 的价值 = 在运行之前指出这一行
```

渐进类型（gradual typing）的核心：注解是**增量的契约**——标了的部分由 mypy 检查，没标的部分自由。它不改变运行时行为，改变的是「错误被发现的时间」。

### 1.2 现代语法速查

```python
# 联合与可选（3.10+ 的 | 管道写法取代 Optional/Union）
def find_user(uid: int) -> User | None: ...
def parse(text: str | bytes) -> dict: ...

# Callable：可调用对象的类型
Handler = Callable[[str, int], bool]      # 参数类型列表 + 返回类型

# TypedDict：字典的结构化形状（JSON 边界的类型化）
class Article(TypedDict):
    title: str
    tags: list[str]

def render(a: Article) -> str: ...

# Protocol（结构化子类型）：鸭子类型的静态化！
class Drawable(Protocol):
    def draw(self) -> None: ...           # 有这个方法就算 —— 不需要继承

def paint(d: Drawable) -> None: d.draw()  # 任何「长得像」的类型都能传入
```

`Protocol` 是本章最重要的概念：它把 Python 的鸭子类型翻译给静态检查器——**接口靠结构匹配而非血统声明**，既有静态检查又不引入继承耦合（与 C++ concepts、Go interface 同一思想）。

### 1.3 mypy 的工程用法

```bash
mypy src/ --strict          # strict 模式：未注解也报错（新代码的起点）
mypy src/ --ignore-missing-imports   # 对无类型的三方库先宽容
```

落地策略：**新模块 strict、存量渐进**（先给公共 API 注解——那是调用方依赖的契约面）；类型注解的最大收益不在 catch bug，而在**重构安全性**（改签名后 mypy 立刻列出所有失配的调用点）与 **IDE 补全**。

## 2. pytest：现代测试的标准形制

### 2.1 基础与断言

```python
# test_pricing.py —— 文件/类/函数名以 test_ 开头即被发现
def test_price_with_tax():
    assert price_with_tax(100.0) == 113.0          # 断言失败自动显示两侧值

def test_price_default_rate():
    assert price_with_tax(100.0, rate=0) == 100.0

def test_negative_base():
    with pytest.raises(ValueError, match="negative"):
        price_with_tax(-1)
```

裸 assert + 失败时的值展开，是 pytest 取代 unittest 的第一优势——测试代码几乎没有仪式。

### 2.2 fixture：测试的前置条件管理

```python
import pytest

@pytest.fixture
def sample_db(tmp_path):                       # 内置 fixture：每个测试一个临时目录
    db = Database(tmp_path / "test.db")
    db.seed(sample_users)                      # 造数据
    return db

def test_lookup(sample_db):                    # 按名注入：fixture 依赖图自动解析
    assert sample_db.find("alice").active

@pytest.fixture(autouse=True)
def clean_env(monkeypatch):                    # autouse：全测试自动应用
    monkeypatch.setenv("APP_MODE", "test")
```

fixture 的价值：**前置条件的复用与隔离**（每个测试拿到全新实例——测试间零共享状态，呼应[第 1 篇](01-python-model.md)全局状态三问）；`tmp_path`、`monkeypatch`、`capsys`、`caplog` 是内置四大件。

### 2.3 parametrize：数据驱动

```python
@pytest.mark.parametrize("text,expected", [
    ("42", 42),
    ("  -7 ", -7),
    ("0", 0),
    ("abc", None),
    ("9999999999999999999999", None),          # 溢出
])
def test_parse_int(text, expected):
    assert parse_int(text) == expected
```

「边界值列表驱动」是参数化的正确用法——写测试时先列**等价类与边界**（空、零、负、极大、非法），再让参数化跑完它们。一个测试函数覆盖一个行为的全部分支，比十个复制粘贴的测试强一个量级。

### 2.4 测试替身：mock 与依赖注入

```python
from unittest.mock import patch

def test_fetch_retries(monkeypatch):
    calls = []
    def fake_get(url, timeout):
        calls.append(url)
        raise ConnectionError("down")
    monkeypatch.setattr("mymod.http_get", fake_get)     # 打桩

    with pytest.raises(ConnectionError):
        fetch_with_retry("http://x")
    assert len(calls) == 3                       # 验证重试了 3 次
```

patch/monkeypatch 能把任何名字换成替身，但**patch 大面积使用是设计气味**——它把测试焊死在实现细节上（改 import 路径测试全红）。更稳的方向是**依赖注入**：把可变依赖变成参数（`fetch(url, http_get=default_get)`），测试直接传 fake，无需 patch。规约：**边界处 patch（时间、随机、网络），业务逻辑用注入**。

## 3. 质量三件套：ruff、格式化与 pre-commit

```bash
ruff check .        # lint：数百条规则（替代 flake8+isort+pyupgrade 大全家桶）
ruff format .       # 格式化（black 兼容风格）：风格争论归零
ruff check --fix .  # 自动修复：未用导入、升级写法（%.format→f-string 等）
```

ruff 一体化（Rust 实现，极快）已成为事实标准。配套纪律：

1. **格式化全自动**：提交里零手工排版，diff 只含逻辑变化。
2. **lint 当硬门槛**：`ruff check` 进 CI，红线规则（裸 except、未用变量、可疑默认参数）不许豁免——与[第 4 篇](04-functions.md)的可变默认参数这类静态可查陷阱联动。
3. **pre-commit** 在提交前本地跑同一套检查（快、增量），CI 跑全量（权威）。

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.6.0
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format
```

## 4. 性能与内存的工具链

```bash
python -m cProfile -o prof.out main.py     # 函数级剖析（第 1 篇）
python -m timeit -s "xs=list(range(1000))" "sum(xs)"   # 微基准：防「感觉优化」
```

```python
# 逐行热点：cProfile 找到函数后用 line_profiler 深挖
@profile
def hot_loop():
    ...
```

性能工作流的固定顺序：**cProfile 找热点函数 → line_profiler 找热点行 → timeit 验证优化**。内存侧：`tracemalloc`（标准库）定位分配大户——Python 的内存问题几乎都是「意外的全量物化」（readlines、list() 吃掉生成器），与[第 6 篇](06-iterators-generators.md)的惰性原则联动。

## 5. 打包与版本

```bash
uv venv && uv pip install -e ".[dev]"      # 可编辑安装（第 8 篇）
python -m build                             # 构建 sdist/wheel 发布物
```

- **版本号语义化**（SemVer）：主版本.次版本.修订——破坏性变更升主版本；API 稳定性承诺与版本号绑定。
- **锁定依赖**：`uv pip compile` 生成 lock 文件，CI 与生产用锁定的精确版本——「在我机器上能跑」的解药。
- **最低 Python 版本**用 `requires-python` 声明，CI 矩阵跑多版本。

## 6. CI：把流水线装配起来

```yaml
# .github/workflows/ci.yml 的核心步骤
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python: ["3.11", "3.12", "3.13"]
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: uv pip install -e ".[dev]" --python ${{ matrix.python }}
      - run: ruff check . && ruff format --check .        # lint + 格式
      - run: mypy src/                                     # 类型
      - run: pytest --cov=src --cov-fail-under=85          # 测试 + 覆盖率门槛
```

五个环节各司其职：**lint（风格与静态缺陷）→ type（契约一致性）→ test（行为正确）→ 覆盖率（测试广度下限）→ 多版本矩阵（兼容面）**。覆盖率是下限指标不是目标（85% 而不是 100%——为覆盖而写的测试是负资产），真正的质量信号是「边界与异常路径有没有测试」（[第 9 篇](09-errors-exceptions.md)的错误路径）。

## 7. 陷阱清单

- 以为注解在运行时强制：类型错照样跑；mypy/CI 是 enforcement。
- Optional[X] 与 X=None 混淆：`X | None` 是类型、`=None` 是默认值，两者独立。
- 测试共享可变 fixture（模块级全局）：测试间状态泄漏；fixture 每测试新建。
- patch 业务内部函数：焊死实现细节；边界 patch + 依赖注入。
- 只测 happy path：异常与边界路径（[第 9 篇](09-errors-exceptions.md)）才是 bug 密度区。
- 覆盖率当目标：为覆盖写断言空洞的测试；断言行为不斷言「没崩」。
- fixture 该用没用（每个测试复制 setup）：改动牵连一片测试。
- mypy 全量上 strict 一次到位：存量报错海啸；新代码 strict、存量渐进。
- 微基准不用 timeit：解释器缓存与预热让「感觉」全错。
- 无 lock 文件部署：「昨天还能装」的环境漂移。

## 8. 小结

- 类型注解是渐进契约：运行时不强制、mypy 强制、重构安全与 IDE 补全是最实际收益；`X | None`、内置泛型、Protocol 是现代语法的三支柱。
- pytest 的三件武器：fixture（前置条件管理与隔离）、parametrize（边界值数据驱动）、raises/monkeypatch（异常与替身）；patch 留给边界，业务用依赖注入。
- ruff 统一 lint 与格式化：风格归零、lint 当 CI 硬门槛、pre-commit 本地先行。
- 性能工作流固定：cProfile → line_profiler → timeit；内存问题先怀疑意外的全量物化。
- 打包三件：pyproject 单一配置、lock 锁定环境、SemVer 承诺兼容性。
- CI 五环节（lint/type/test/coverage/matrix）把本章工具串成流水线；覆盖率是下限不是目标。

## 9. 练习

**1.** 给前面练习写过的 `parse_int`（[第 4 篇](04-functions.md)）补全类型注解并用 mypy strict 验证；再写一个「注解错了但运行正确」的例子，验证「注解运行时不强制」。

> [!TIP]
> 思路`def parse_int(text: str) -> int | None`；故意注解成 `-> int` 却可能返回 None——mypy 报错而运行正常。这个实验直观展示「静态检查的价值在 CI，不在运行时」。

**2.** 为第 11 篇练习的日志分析 CLI 写完整测试套件：parametrize 覆盖正则边界（空行、乱码、缺字段）、tmp_path 提供样例日志文件、caplog 验证日志输出、monkeypatch 冻结时间。

> [!TIP]
> 思路边界参数化表先列（正常行/空行/无时间戳/毫秒精度），每行一个参数化用例；monkeypatch.setattr 冻结 now 让 --since 可测。体会「先列边界再写测试」与「先写测试再想边界」的效率差。

**3.** 把一个「内部直接 import requests 调 API」的函数重构为依赖注入（HTTP 函数作参数），对比 patch 版与注入版测试在「URL 改版」后的存活情况。

> [!TIP]
> 思路patch 版：import 路径或函数名变化即红；注入版：只测业务逻辑（fake 直接传），签名改动才影响。这个对比是「patch 留给边界」的实证——注入让测试测的是「你写的逻辑」而不是「库的接线」。

**4.** 配置一个新项目的完整工具链：pyproject.toml（ruff/mypy/pytest 配置合一）、pre-commit、CI workflow（含 3 版本矩阵）。然后故意提交一个「可变默认参数」+「类型失配」的函数，验证三层防线（pre-commit/CI lint/mypy）各自能否拦住。

> [!TIP]
> 思路ruff 的 B006 规则抓可变默认参数；mypy 抓类型失配；两层防线重叠是设计（纵深防御）。观察哪一层跑得最快（pre-commit 本地）、哪层最权威（CI）——工具链的价值分层。

**5.** 用 cProfile + line_profiler 优化第 2 篇练习的词频统计（1 MB 文本）：记录优化前的热点分布与耗时，做两轮优化（算法/数据结构），每轮用 timeit 验证，写一份「测量→假设→验证」的优化记录。

> [!TIP]
> 思路典型热点：正则 vs str 方法链、Counter vs 手工 dict。优化纪律演示：每轮只改一处、timeit 复测、记录倍率——「感觉变快」在工程里不算数。

**6.** 讨论：一个「没人写测试的 5000 行遗留库」要加新功能，测试策略怎么定？（全量补测试？只测新代码？特征测试/快照测试？）给出分阶段方案与每阶段的退出条件。

> [!TIP]
> 思路阶段①给要改的模块写特征测试（现状即预期，golden/snapshot）；阶段②新功能 TDD + strict mypy；阶段③改动波及处补集成测试。退出条件：新增代码覆盖率 ≥90%、mypy strict 通过、关键路径有特征测试兜底。「遗留代码的现代 nostradamus 是 characterization test」——Feathers 的经典结论。
