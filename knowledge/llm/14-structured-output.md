---
title: 结构化输出与约束解码
order: 14
tags: 结构化输出, 约束解码, JSON Schema, function calling
summary: 「让 LLM 可靠输出机器可读数据」的完整工程学——JSON 的典型断裂模式、三层方案（提示祈祷/解码约束/校验重试）、约束解码的原理（FSM 掩码与文法）、function calling 的内部机制，以及可解析率的评估方法。
---

LLM 输出的下游是程序——程序需要**机器可读的结构**（JSON/枚举/正则格式），而自回归模型天然「自由发挥」。结构化输出的工程学就是回答：**如何让概率性的文本生成器，可靠地产出符合 schema 的数据**。答案分三层：提示层（弱）、解码层（强）、校验层（兜底）——生产系统三层全配。

## 1. 失败模式：自由生成下的 JSON 断裂

```text
「请输出 JSON」的典型断裂：
① 格式断裂：代码围栏污染（```json ... ```）、前后解释文字
② 截断：输出超长被 max_tokens 掐断 → JSON 半截
③ 字段漂移：偶发漏字段、字段名变体（user_name vs userName）
④ 类型漂移："42"（字符串）vs 42（数字）、null vs 缺失
⑤ 嵌套崩塌：深层结构中括号不配对
⑥ 枚举漂移：enum 里的值生成出相近但非法的值（"high" → "HIGH"）
⑦ 内容幻觉：schema 合法但字段值编造（日期格式对、日期是假的）
```

这些断裂的根源：**自回归采样在每一步都是「自由选择下一个 token」**——没有任何机制保证「已生成的部分 + 下一个 token」仍然符合 schema。提示词「请严格遵守 JSON 格式」只是建议，不是约束。

## 2. 三层方案的总览

```text
层① 提示层：schema 写进 prompt + few-shot 示例
    成本：零 | 可靠性：90%+（简单 schema）/ 随复杂度衰减
层② 解码层（约束解码）：在采样时屏蔽非法 token —— 结构性保证
    成本：需框架支持 | 可靠性：100% 语法合规
层③ 校验层：Pydantic/zod 校验 + 失败重试
    成本：低 | 兜底一切（内容层错误仍需 LLM 判断）

生产架构：①+② 保语法、③ 保语义 —— 三层各管一段。
```

## 3. 约束解码的原理：token 掩码

```text
约束解码的核心：每一步生成前，根据「已生成内容 + 目标文法」计算
「哪些 token 是合法的下一步」，把非法 token 的 logits 屏蔽为 −∞：

  {"name": "alic
              ↑ 此刻合法的 token：继续 "e"、引号、逗号……
                而 "def"、中文等全部被屏蔽（logits = −∞ → 概率 0）

实现：把 JSON Schema 编译成「状态机/文法」→ 每步同步状态 → 掩码采样
```

```python
# llama.cpp 的 GBNF 文法（文法级约束的代表）
grammar = r'''
root ::= "{" "\"name\"" ":" string "," "\"age\"" ":" integer "}"
string ::= "\"" [^"]* "\""
integer ::= [0-9]+
'''
# 采样器：每步计算合法 token 掩码 → 模型「想跑偏也跑不了」
```

| 实现             | 机制                     | 生态                     |
| ---------------- | ------------------------ | ------------------------ |
| llama.cpp GBNF   | 文法（BNF 变体）         | 本地推理的全能约束        |
| Outlines         | FSM 编译正则/JSON Schema | python 生态               |
| XGrammar         | 高性能 JSON Schema 编译  | vLLM/SGLang 内置          |
| OpenAI structured outputs | 服务端约束   | API 的 response_format    |

约束解码的性能代价：**每步要维护 FSM 状态与掩码**（现代实现已优化到个位数百分比开销）；灵活性代价：**约束过死会降低内容质量**（模型被迫在狭窄选择里选词，长 JSON 中「内容质量下降」的观察）——schema 设计要给内容留自由度（枚举别过细、字符串别过度限制）。

## 4. API 层的结构化输出

```python
# OpenAI 风格：response_format + JSON Schema（服务端约束解码）
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[...],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "extract_invoice",
            "strict": True,                    # ★ strict：服务端保证 100% schema 合规
            "schema": {
                "type": "object",
                "properties": {
                    "vendor": {"type": "string"},
                    "total": {"type": "number"},
                    "currency": {"type": "string", "enum": ["USD", "EUR", "CNY"]},
                },
                "required": ["vendor", "total", "currency"],
                "additionalProperties": False,
            },
        },
    },
)
```

strict 模式的 schema 限制（了解才能设计）：**所有字段必须 required**（可选字段用 `type: ["string", "null"]` 表达）、不支持部分高级关键字——**schema 的设计要适配约束系统**，而不是把业务对象原样照搬。`strict` 下 schema 合规是**保证**（约束解码），但「字段值的语义正确性」仍无保证（日期可以是格式对的假日期——语义校验是另一层，[第 10 篇](10-deploy-engineering.md)）。

## 5. function calling 的内部：工具调用也是约束解码

```text
[第 9 篇](09-agents-tools.md)的工具调用，底层就是结构化输出：
  工具 schema → 约束解码 → 模型输出「合法的工具名 + 合法的参数 JSON」
  name 被 enum 约束（只有已注册的工具名）、参数被 JSON Schema 约束

工程推论：
① 工具参数的描述质量影响「值的语义质量」（约束只保形状不保内容）
② 参数过多过深的 schema 增加解码难度与错误率——扁平优先
③ enum 的候选集就是模型的「选择空间」——不要把语义判断挤进 enum
```

## 6. 校验层：Pydantic 与重试

```python
from pydantic import BaseModel, Field, ValidationError

class Invoice(BaseModel):
    vendor: str
    total: float = Field(gt=0)
    currency: str

def extract(text: str) -> Invoice:
    for attempt in range(3):
        raw = llm(prompt_with_schema_and_errors(text, errors=attempt_errors))
        try:
            inv = Invoice.model_validate_json(raw)    # 语义+类型校验
            return inv
        except ValidationError as e:
            attempt_errors = e.errors()               # ★ 把校验错误喂回给模型重试
    raise ExtractionFailed()
```

重试的工程细节：**把上次的校验错误信息显式喂回**（「total 必须为正数，你输出了 -5」）——比「再试一次」的盲目重试成功率高一个量级；重试次数封顶（3 次）+ 最终失败走人工/降级（[错误处理](../c/12-errors-robustness.md)的纪律）。

## 7. 评估：可解析率与字段准确率

```text
结构化输出的两维评估：
① 可解析率：100 次生成中多少次能通过 schema 校验（约束解码后应为 100%）
② 字段准确率：通过与「黄金标注」对比——每个字段的正确率
   （vendor 对了吗？total 数值对了吗？—— schema 合规 ≠ 内容正确）

评估集的构造：真实文档/查询的分层抽样 × 黄金标注
—— 换模型/换 schema/换版本都要跑（[第 10 篇](10-deploy-engineering.md)回归纪律）
```

## 8. 陷阱清单

- prompt 祈祷当唯一防线：schema 复杂度上升后必然断裂；解码层约束。
- strict schema 直接照搬业务对象（嵌套五层/几十字段）：解码难度与内容质量双降；扁平化 + 字段精简。
- 忘记校验内容语义（schema 合规 ≠ 值正确）：金额幻觉/日期编造要有业务校验。
- 重试不带错误信息：盲目重试成功率低；把 ValidationError 喂回。
- 枚举过度收窄：模型被迫选「都不对」的项——枚举留 other + 说明字段。
- 依赖「围栏剥离」的正则处理（```json）：脆弱；优先 API 的原生结构化输出。
- 字段名不一致的下游崩溃：schema 单一真相源（类型定义生成 prompt 与校验）。

## 9. 小结

- 自回归采样与结构化输出存在根本张力——「请输出 JSON」是建议，约束解码才是保证（FSM 掩码屏蔽非法 token）。
- 三层架构：提示层（规范表达）+ 解码层（语法保证）+ 校验层（语义兜底与重试）——生产全配。
- strict schema 的设计要适配约束系统：全 required、扁平化、留内容自由度——schema 合规 ≠ 语义正确。
- function calling = 约束解码的应用（工具名 enum + 参数 schema）——描述质量决定内容质量。
- 评估两维：可解析率（应 100%）与字段准确率（业务正确性）——换模型/改 schema 必须回归。

## 10. 练习

**1.** 断裂模式普查：用「请输出 JSON」的弱 prompt 对复杂 schema 生成 50 次，统计七类断裂的发生率分布——建立「你的模型在哪个模式上最脆」的画像。

> [!TIP]
> 思路预期：截断与字段漂移占大头（长 schema 时）。统计表是「为什么需要约束解码」的定量证据——说服团队投入的素材。

**2.** 三层方案对比：同一提取任务用「弱 prompt」「prompt+few-shot」「strict 结构化输出」各跑 50 次——对比可解析率与字段准确率的三级阶梯。

> [!TIP]
> 思路预期曲线：弱 prompt 可解析率 60~90% 波动、few-shot 90%+、strict 100%——但字段准确率三层都取决于模型能力。约束保形状、模型保内容。

**3.** 约束解码的手工体验：用 llama.cpp 的 GBNF 写一个「只输出 yes/no/unknown」的文法，测试任意提问下输出 100% 合法——再扩展到「固定字段的 JSON」，体验文法调试。

> [!TIP]
> 思路GBNF 的调试体验（语法错→静默不约束）是理解「文法编译」机制的捷径。写完后用「故意诱导跑偏」的 prompt 测试——约束解码下模型「想跑也跑不掉」。

**4.** 重试策略对比：同一失败注入场景（schema 复杂 + 弱模型），对比「盲目重试」「带错误信息重试」「带错误信息+简化 schema 重试」三版的三次内成功率。

> [!TIP]
> 思路预期：带错误信息的重试成功率远高于盲目重试——「反馈的具体性决定修复率」。第三版再叠加「降低难度」，是成本与成功率的最终平衡。

**5.** 字段准确率评估：构造 30 份发票/收据（黄金标注），用结构化输出抽取，逐字段计算准确率——找出「最常错的字段」并分析根因（值模糊？schema 设计？模型能力？）。

> [!TIP]
> 思路典型发现：「日期格式」「金额与小数点」「单位换算」是重灾区——每类的修复路径不同（few-shot 示例/后处理规则/换更强模型）。错误分析驱动 schema 与 prompt 的迭代。

**6.** 讨论：约束解码「保证语法、不保证语义」——这个边界说明「结构化输出的可靠性」最终取决于什么？从「约束把失败模式从『语法错误』压缩到『内容错误』」的角度分析，并讨论「语义校验器」的设计（业务规则引擎/交叉验证/置信度表达）——结合[第 9 篇](09-agents-tools.md)的工具返回整形，总结「LLM 输出可信化」的完整栈。

> [!TIP]
> 思路约束解码把「随机失败」变成「系统性问题」——语法层从概率问题变成确定问题，剩下的是内容层（模型能力与输入质量）。「LLM 输出可信化」的完整栈：约束解码（形状）→ 语义校验（规则）→ 交叉验证（一致性）→ 人工抽检（校准）——每层处理不同性质的错误。
