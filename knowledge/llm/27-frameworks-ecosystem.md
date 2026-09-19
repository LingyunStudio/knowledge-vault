---
title: 框架与生态：脚手架的地图
order: 27
tags: LangChain, LangGraph, HuggingFace, LiteLLM, 工具链
summary: LLM 应用层的脚手架地图——编排框架（LangChain/LangGraph/LlamaIndex）的抽象与取舍、Agent 框架族、Hugging Face 生态的组件谱、网关路由层（LiteLLM/OpenRouter）、可观测性平台，以及「框架的价值、锁定与逃生通道」的选型哲学。
---

LLM 应用的每一层都有框架可选——编排（LangChain/LangGraph）、数据（LlamaIndex）、模型接入（LiteLLM）、微调（HF TRL）、可观测（LangSmith/W\&B）。框架的价值与风险并存：**好框架 = 站在抽象的正确层上；坏选择 = 被别人对「你需求」的错误猜测绑架**。本篇是脚手架地图 + 选型哲学。

## 1. 编排框架：LangChain 系与 LlamaIndex

```python
# LangChain 的核心抽象：组件 + 链
prompt = ChatPromptTemplate.from_template("总结：{text}")
chain = prompt | llm | StrOutputParser()        # LCEL（表达式语言）的管道组合
chain.invoke({"text": "..."})

# LangGraph：状态机图（[第 21 篇](21-agent-architecture.md)的编排框架形态）
graph = StateGraph(AgentState)
graph.add_node("plan", plan_node)
graph.add_node("execute", execute_node)
graph.add_conditional_edges("execute", route_fn)   # 动态路由
graph.add_edge("plan", "execute")
```

| 框架         | 核心抽象          | 强项                                                 | 弱点               |
| ---------- | ------------- | -------------------------------------------------- | ---------------- |
| LangChain  | 组件 + 链 + 集成大全 | 集成面最广、生态最大                                         | 抽象层厚、调试链路长       |
| LangGraph  | 状态机图          | 复杂控制流/中断恢复/持久化（[第 21 篇](21-agent-architecture.md)） | 学习曲线             |
| LlamaIndex | 数据框架与索引       | RAG 的数据接入与索引抽象最全                                   | 通用编排弱于 LangChain |
| Haystack   | 管道（Pipeline）  | 检索问答的传统强项、工程化干净                                    | 生态相对小            |

框架的「抽象层税」：**框架为你猜的抽象，猜对是杠杆、猜错是枷锁**（[第 6 篇](../c/02-types.md)的「抽象层选择」讨论）——复杂需求最终会「跳出框架直写」（LangChain 的逃生通道：任何组件都能换成自定义函数）。

## 2. Agent 框架族

```python
# OpenAI Agents SDK 的抽象：Agent + handoff + guardrail
agent = Agent(name="客服", instructions=..., tools=[...], handoffs=[技术组])
# handoff：Agent 之间的显式移交（[第 21 篇](21-agent-architecture.md)的多 Agent 形态）

# AutoGen：对话式多智能体（消息驱动的协作）
# CrewAI：角色扮演式的团队（角色/目标/工具的三元组）
# PydanticAI：类型安全的 Agent（与 Pydantic 校验一体化）
```

Agent 框架的选型与[编排框架](#1-编排框架langchain-系与-llamaindex)同理，但多一层考量：**Agent 框架的「多智能体拓扑」是否匹配你的任务结构**（[第 21 篇](21-agent-architecture.md)的监督者/网络/层级）——框架的默认拓扑不该反过来塑造你的任务。**克制提醒**：[Agent 框架的最大价值常常是「逼你想清楚 Agent 的边界」](09-agents-tools.md)，而不是它的运行时魔法。

## 3. Hugging Face 生态：模型侧的操作系统

```text
transformers        模型加载与推理（[AutoClass](16-multimodal.md)）
accelerate          分布式训练的封装（[第 18 篇](18-training-infra.md)）
peft                LoRA/QLoRA（[第 7 篇](07-fine-tuning-peft.md)）
trl                 RLHF/DPO/SFT 的训练器
datasets            数据集加载与处理
hub                 模型/数据集的托管与版本（[模型地图](23-open-models.md)的仓库）
tokenizers          分词器（[第 2 篇](02-tokenizer-embedding.md)）

生态的一致性哲学：所有组件共享「模型 + 分词器 + 配置」的对象模型
—— 微调/评估/部署的工具链无缝衔接（[sklearn API 哲学](../ai/10-toolbox.md)的 HF 版）
```

HF 生态是「开源模型路线」的操作系统——从[第 19 篇](19-data-engineering.md)的数据到[第 18 篇](18-training-infra.md)的训练到[第 20 篇](20-local-edge.md)的部署，同一套对象模型贯穿。

## 4. 网关与路由：模型接入的中介层

```text
LiteLLM：统一 100+ 模型的调用接口（OpenAI 格式为标准）
  好处：切换/降级/路由/成本统计的统一层（[第 10 篇](10-deploy-engineering.md)）
OpenRouter：聚合 API（一个 key 访问多家模型 + 自动路由）
Portkey/self-host 网关：重试/缓存/限流/日志的策略层
```

网关层的价值：**把「模型供应商」从应用代码中解耦**——切换模型的成本从「改代码」降到「改配置」。这是[多模型抽象](../ai/10-toolbox.md)的工程落地：**供应商锁定的保险**（[第 17 篇](17-llm-security.md)的退出方案清单）。

## 5. 可观测性：LLM 应用的眼睛

```text
轨迹与调试：LangSmith / W&B Weave / Arize Phoenix
  —— 每次调用的 prompt/输出/token/延迟/评分的全记录（[第 12 篇](12-context-engineering.md)的构成日志）
标准协议：OpenTelemetry 的 LLM 语义约定（跨厂商的观测标准化）

观测的三个层次（[第 15 篇](15-evaluation-systems.md)的线上评估衔接）：
  调用级：每次请求的完整 trace（调试单例）
  聚合级：延迟分布/成本分布/失败率的看板（[运维](../linux/11-ops-pitfalls.md)）
  质量级：抽样评估/用户反馈的聚合（[质量飞轮](15-evaluation-systems.md)）
```

可观测性是[第 28 篇](28-pitfalls.md)「输出不稳定诊断」的前提——**没有 trace，七层诊断全部退化为猜测**。LLM 可观测的特有字段：prompt 模板版本、RAG 检索的块 ID、工具调用链、思维 token 数（[第 13 篇](13-reasoning-models.md)）。

## 6. 选型哲学：框架的价值、锁定与逃生

```text
框架价值的三问：
① 它替你解决的「复杂度」在你的项目里真实存在吗？
   （多模型切换？复杂控制流？大量集成？——[第 1 篇](01-what-is-llm.md)的定位先行）
② 它的抽象边界与你的需求重合吗？
   （抽象错位 = 框架之战：与框架搏斗比与问题搏斗更累）
③ 逃生通道在哪里？（自定义组件的入口/核心逻辑的框架无关性）

锁定风险的信号：
  业务逻辑 import 了大量框架专有类型
  框架的「魔法」（自动重试/隐式状态）不可关闭
  文档中找不到「不用框架做 X」的路径

逃生的工程形态：核心逻辑写成「纯函数 + 标准类型」，
  框架只在「编排边界」出现（[第 21 篇](21-agent-architecture.md)的「业务逻辑框架无关」纪律）
```

框架的演化风险在 LLM 领域特别高：**模型能力的提升会消灭框架的存在理由**（昨天需要 LangChain 的 Agent 框架，今天原生 function calling + 简单循环就够）——「框架的半衰期」是选型的时间维度。

## 7. 陷阱清单

- 框架抽象错位（需求简单却用重框架）：抽象税白交；「从最简开始」（[ai 篇](../ai/01-ml-overview.md)）。
- demo 级框架代码直接上生产：错误处理/重试/成本控制缺失（[第 10 篇](10-deploy-engineering.md)）。
- 框架升级破坏行为（LangChain 的 breaking changes）：版本锁定 + 升级演练。
- 可观测性的缺位（只有 print 调试）：trace 是七层诊断的前提。
- 网关层的一致性假设（所有模型的参数语义相同）：方言差异（[数据库方言](../database/08-advanced-sql.md)思想的 API 版）。
- 把向量库/框架/模型的选择耦合死：每层可替换（接口抽象，\[第 27 篇选型哲学]）。
- 忽略生态的成熟度差异（Star 数 ≠ 生产就绪）：生产案例与维护活跃度核查。

## 8. 小结

- 编排框架的取舍：LangChain（集成广）/LangGraph（控制流）/LlamaIndex（数据索引）——抽象层税与逃生通道是选型的核心考量。
- Agent 框架的拓扑要与任务结构匹配；框架的最大价值是「逼你想清楚边界」。
- HF 生态是开源路线的操作系统：transformers/accelerate/peft/trl 的对象模型一致。
- 网关层解耦供应商：切换/降级/路由/成本统计的中介——锁定的保险。
- 可观测性的三层（调用/聚合/质量）是「不稳定诊断」的前提；LLM 特有字段（prompt 版本/检索块/思维 token）要进 trace。
- 框架的半衰期意识：模型能力提升会消灭框架的存在理由——**投资在「可迁移的核心逻辑」，框架只是脚手架**。

## 9. 练习

**1.** 框架对比实验：同一个「RAG 问答」分别用 LangChain 与「裸实现（手写检索+prompt 拼装）」实现——对比代码行数、调试难度（故意注入一个检索 bug，看哪个版本定位快）、「换 embedding 模型」的改动面。

> [!TIP]
> 思路对比的公正性：两种实现都按生产标准写（错误处理/日志/重试）。框架的「起步快」与「调试链路长」在同一个实验里显形。

**2.** 网关层改造：把散落在代码里的 LLM 调用收敛到 LiteLLM（或自研网关），实现「按模型统计成本」与「一键切换供应商」——统计切换一个供应商的实际改动行数。

> [!TIP]
> 思路改造的前置：调用点收敛（所有 LLM 调用走同一入口）——散落的调用点先治理。收敛后「成本可见」与「切换自由」是立即可得的两个红利。

**3.** 可观测性接入：给一个 LLM 应用接入 OpenTelemetry（或 LangSmith），记录「prompt 版本/检索块 ID/工具调用链/思维 token 数」——然后故意注入一个 RAG 故障，验证 trace 能否定位到「检索层」。

> [!TIP]
> 思路LLM 特有字段的观测设计：检索块 ID 让「答案错了 → 当时的检索内容」可回放——这是[第 28 篇](28-pitfalls.md)诊断路线的「输入层」证据来源。

**4.** 逃生通道设计：审查一个重度使用框架的项目，把「核心业务逻辑」重构为框架无关的纯函数（框架只在编排边界出现）——统计重构后「换框架」的改动行数，验证逃生通道的真实性。

> [!TIP]
> 思路重构的判据：核心函数不 import 框架类型（用标准类型 + 显式参数）。「逃生通道的可编译性」是解耦完成的检验——不只是理念。

**5.** HF 生态全链体验：从 hub 加载模型 → peft 微调 → trl 的 DPO → accelerate 的多卡 → 导出 GGUF（[第 20 篇](20-local-edge.md)）——跑通「开源模型从训练到端侧」的完整链路，记录每一环的工具与坑。

> [!TIP]
> 思路这条链是「开源模型路线」的全景：每个环节的工具都有 HF 生态的对应物。链路打通后，「自托管模型的全生命周期」从黑盒变成地图。

**6.** 讨论：「框架的第一性问题」——为什么 LLM 领域的框架更迭如此之快（LangChain 被批判、新框架年年出），而 [React](../frontend/09-react.md)、\[Spring] 这类框架长期稳定？从「底层 API 的稳定性（浏览器 DOM vs 模型 API）」「需求的变化速度（模型能力月更）」「抽象的正确性（组件模型 vs Agent 循环）」三个角度分析，并给出「在快速演化领域选择抽象」的策略——什么值得抽象，什么应该留在原生层？

> [!TIP]
> 思路React 稳定的根基：DOM 是 20 年不变的稳定底座——框架抽象在一个「冻结的底座」上。LLM 的底座（模型能力/API 形态）每年都在变——抽象建立在流沙上。策略：抽象「稳定的部分」（评估/观测/成本核算的流程）、原生处理「变化的部分」（模型调用/Agent 形态）——抽象的投资决策跟「底座的稳定性」走。
