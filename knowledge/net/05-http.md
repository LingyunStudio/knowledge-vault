---
title: HTTP：Web 的应用协议
order: 5
tags: HTTP, 状态码, REST, HTTP/2
summary: HTTP 的请求-响应模型与无状态语义、方法与状态码的精确语义（幂等性/安全性的设计约束）、关键头部（缓存/协商/认证）、HTTP/2 与 HTTP/3 的演进动机、以及 REST 风格的设计要点。
---

HTTP 是 Web 的语言：**请求-响应**的无状态协议——客户端问、服务器答、互不相欠。它的「无状态」是设计核心（每个请求自包含、服务器不记得你——扩展性[source](01-layered-model.md)），「状态」由 cookie/token 等机制在应用层补回（[第 10 篇](../frontend/10-http-storage.md)）。本篇讲语义（方法/状态码）、机制（头部/缓存）与演进（HTTP/2、3）。

## 1. 方法与状态码：语义的精确性

| 方法   | 语义               | 安全？（不改状态）| 幂等？（重复执行结果相同）|
| ------ | ------------------ | ----------------- | ------------------------- |
| GET    | 读取               | ✅                | ✅                        |
| POST   | 创建/提交/触发     | ❌                | ❌                        |
| PUT    | 整体替换           | ❌                | ✅                        |
| PATCH  | 部分更新           | ❌                | 不保证                    |
| DELETE | 删除               | ❌                | ✅                        |

**幂等性**的工程意义：网络重试的前提——GET/PUT/DELETE 可以安全自动重试（重发不改结果），POST 不能（可能重复创建）——「重试策略」按方法设计（[网络重试](../frontend/07-async.md)、[支付接口的幂等键](../database/07-transactions.md)）。

状态码的语义分层（[前端篇](../frontend/10-http-storage.md)）：

| 段   | 含义         | 高频码                                     |
| ---- | ------------ | ------------------------------------------ |
| 2xx  | 成功         | 200 OK、201 Created、204 No Content        |
| 3xx  | 重定向       | 301 永久、302/307 临时、304 Not Modified（缓存）|
| 4xx  | 客户端错误   | 400 语法、401 未认证、403 无权限、404 不存在、429 限流 |
| 5xx  | 服务端错误   | 500 内部错、502 网关错、503 不可用、504 网关超时 |

401 与 403 的区分（认证 vs 授权）是权限系统的语言（「没登录」vs「登录了但没权限」）——API 设计的语义精确性直接决定客户端的错误处理质量。

## 2. 关键头部：请求与响应的元数据

```http
请求头：
  Host: api.example.com              # 虚拟主机（一台服务器多个站点）
  Authorization: Bearer <token>      # 认证
  Content-Type: application/json     # 请求体的类型
  Accept: application/json           # 期望的响应类型（内容协商）
  If-None-Match: "abc123"            # 缓存验证（[第 10 篇](../frontend/10-http-storage.md)）
  Cookie: session=...                # 状态携带

响应头：
  Content-Type: application/json; charset=utf-8
  Cache-Control: max-age=3600        # 缓存指令
  Set-Cookie: sid=...; HttpOnly; Secure; SameSite=Lax
  Location: /users/42                # 201/3xx 的目标位置
  Retry-After: 30                    # 429 的礼貌提示
```

**内容协商**（Accept/Content-Type）让同一 URL 服务多种表示（JSON/XML）——API 版本化与多客户端的机制。`Host` 头是虚拟托管的基础（一台服务器按域名分发）——也是 [Host 头攻击](../frontend/10-http-storage.md)的攻击面。

## 3. HTTP/2：多路复用的性能革命

```text
HTTP/1.1 的痛点：
  每请求一个连接（或队头排队）—— 浏览器对同域限 6 连接
  文本协议头大且重复（每请求重复发 Cookie/UA…）

HTTP/2（2015）：
  ① 二进制分帧：一个 TCP 连接上「多路复用」多个请求流（互不排队）
  ② 头部压缩（HPACK）：重复头只传差异
  ③ 服务器推送（实践价值有限，已从 Chrome 移除）
  ④ 仍保留 HTTP 语义（方法/状态码/头不变——应用层无感升级）
```

HTTP/2 解决的是 **HTTP/1.1 的传输层低效**（队头排队/头部冗余），[TCP 层的队头阻塞](04-udp-quic.md)仍在（一个包丢失阻塞所有流）——这正是 HTTP/3（QUIC）要解决的。

## 4. HTTP/3：QUIC 上的 HTTP

```text
HTTP/3 = HTTP over QUIC（[第 4 篇](04-udp-quic.md)）：
  传输层换成 QUIC（UDP 上）→ 消除 TCP 队头阻塞
  握手合并：连接建立 + TLS 一次完成（更快的第一字节）
  连接迁移：网络切换不断连

部署：通过 Alt-Svc/HTTPS 记录通告 → 客户端尝试升级 → 失败回退 HTTP/2
```

版本演进的纪律：**语义层（方法/状态码/头）保持稳定**——三次大版本升级，Web 应用代码几乎不用改——「协议的分层设计让演进局部化」（[第 1 篇](01-layered-model.md)的分层红利在 HTTP 的兑现）。

## 5. REST 风格：资源导向的 API 设计

```text
REST 的核心：把「操作」建模为「资源 + 方法」
  GET    /users          列出用户
  POST   /users          创建用户
  GET    /users/42       获取一个
  PUT    /users/42       替换
  DELETE /users/42       删除
  GET    /users/42/orders   嵌套资源（用户的订单）

设计要点：
  资源用名词复数、层级表达从属；过滤用查询参数（?status=paid）
  状态码表达结果（201/404/422 而非全 200+code）
  版本策略（/v1/ 或头协商）；分页约定（[第 2 篇](../database/02-sql-select.md)游标）
```

REST 的取舍：**一致性与可预测性**（ anyone 看懂 API）换一些灵活性（复杂操作在「资源+方法」里别扭——RPC 式端点作为补充是务实选择）。

## 6. 陷阱清单

- POST 的误用（用 GET 做状态变更）：爬虫/预取触发副作用的事故。
- 全 200 + code 字段的 API 设计：HTTP 语义废弃（监控/缓存/重试全部失灵）；状态码表达传输结果。
- 401/403 混用：认证与授权的语义混淆。
- 重定向缓存误配（301 缓存了错误的临时跳转）：301 会被浏览器永久缓存——临时用 302/307。
- PUT 的非幂等实现（每次自增版本）：幂等性被实现破坏。
- HTTP/2 的头部大小与流控问题（大 header 拒绝）：HPACK 表与 SETTINGS 配置。
- 缓存头配错（用户数据被共享缓存缓存）：[第 10 篇](../frontend/10-http-storage.md)的 privacy 红线。
- 忽略 Retry-After 与 429 的退避：限流雪崩（[第 7 篇](../frontend/07-async.md)）。

## 7. 小结

- HTTP 的模型：请求-响应 + 无状态——方法与状态码是「语义的词汇表」，幂等性决定重试策略。
- 401/403/429 的语义精确性直接决定客户端行为；完整的状态码分层（2/3/4/5xx）是 API 的公共语言。
- 头部是元数据层：缓存（Cache-Control/ETag）、协商（Accept）、认证（Authorization）、状态（Cookie）各司其职。
- HTTP/2 解决传输低效（多路复用/压缩）、HTTP/3 换 QUIC 解决 TCP 队头阻塞——语义层稳定的演进红利。
- REST 用「资源+方法」建模操作：一致性可预测性优先，复杂操作允许 RPC 补充。

## 8. 练习

**1.** 幂等性实验：写一个测试脚本对同一个 API 分别重试 GET/POST 三次，观察副作用（重复创建）——然后把 POST 改成「带幂等键」（Idempotency-Key 头，服务端去重）——支付级 API 的标准设计。

> [!TIP]
> 思路幂等键的模式：客户端生成唯一键 → 服务端记录「键→结果」→ 重试返回同结果（[事务的原子性](../database/07-transactions.md)在网络层的延伸）。「网络会重试」是分布式 API 的设计前提。

**2.** 状态码审查：找一个 API 的响应，检查「错误全 200+code」「401/403 混用」「404 与 400 混淆」三类问题——重构成精确状态码，并用 curl -i 验证每类的可观测性差异。

> [!TIP]
> 思路精确状态码的受益者是「基础设施」：监控按 5xx 告警、网关按 429 限流、缓存按 Cache-Control——语义废弃 = 基础设施失明。

**3.** HTTP/1.1 vs HTTP/2 的加载对比：用 curl --http1.1 与 --http2 访问一个多资源页面（或 DevTools 协议列），对比连接数与总时间——多路复用的收益实测。

> [!TIP]
> 思路H1.1 的 6 连接排队 vs H2 单连接交错——资源越多差距越大。但注意「单 TCP 队头阻塞」（[第 4 篇](04-udp-quic.md)）在丢包环境反噬 H2——H3 的登场理由。

**4.** 缓存头实战：给静态资源配「指纹文件名 + immutable 一年」、给 API 配「no-store 或精确 max-age」、给 HTML 配「no-cache + ETag」——用 DevTools Network 验证三类资源的缓存行为（from disk cache/304/200）。

> [!TIP]
> 思路三类的契约：静态指纹（激进缓存）、API（不缓存或短缓存）、HTML（必须验证）——「缓存策略 = 资源类型的函数」（[前端缓存](../frontend/10-http-storage.md)的展开）。

**5.** REST API 设计评审：给「文件管理系统」设计 API（上传/列表/下载/删除/分享/回收站）——处理「非 CRUD 操作」（分享=POST /files/42/share）与「状态机」（回收站恢复）的建模——写完整端点表与状态码。

> [!TIP]
> 思路非 CRUD 的建模选项：子资源动作（POST .../share）、状态字段（PUT /files/42 {restored:true}）、或 RPC 端点——每种的一致性代价与可读性。「资源建模」的边界判断是 REST 设计的核心技能。

**6.** 讨论：HTTP 从 1.1 到 3 的演进中，「应用语义几乎不变、传输层全面重写」——这种「语义稳定 + 传输演进」的分层策略对 API 设计的启示是什么？对照 [gRPC（HTTP/2 上的 RPC）](../cpp/13-concurrency.md)、[GraphQL（查询语言层）]与 [WebSocket]（长连接语义）——「HTTP 之上还有没有统一空间」与「何时该跳出 HTTP 语义」的判断框架。

> [!TIP]
> 思路HTTP 语义（方法/状态码/缓存/无状态）的稳定性是 30 年生态投资的结果——跳出它的正当理由：双向流（WebSocket）、多路强类型 RPC（gRPC）、灵活查询（GraphQL）。判断框架：需要的是「HTTP 已优化的问题域」还是「HTTP 没覆盖的问题域」——不要为了新而跳出已被解决的层。
