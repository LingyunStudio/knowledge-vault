---
title: 网络与存储：HTTP、跨域与浏览器数据
order: 10
tags: HTTP, Cookie, CORS, 缓存, XSS, CSRF
summary: HTTP 的请求/响应模型与方法/状态码语义、统一 API 封装的形态、浏览器存储三兄弟（cookie/localStorage/IndexedDB）的分工、CORS 与同源策略的机制、XSS/CSRF 两大攻击与防线、HTTP 缓存的头字段。
---

前端的「半壁」在浏览器之外：与后端的每一次对话走 HTTP（[net 篇](../net/05-http.md)的协议细节），用户的身份与偏好存在浏览器的存储里，跨域与安全是每一层都要过的关卡。本篇把「前端视角」的网络与存储讲成一体的运维地图。

## 1. HTTP：请求与响应的速写

```http
GET /api/users/42 HTTP/1.1
Host: api.example.com
Authorization: Bearer eyJhbGc...
Accept: application/json

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: max-age=60

{"id": 42, "name": "alice"}
```

| 方法   | 语义             | 幂等？ | 经典用途                     |
| ------ | ---------------- | ------ | ---------------------------- |
| GET    | 读取             | ✅     | 查询（可缓存）               |
| POST   | 创建/提交        | ❌     | 新增资源、触发动作           |
| PUT    | 整体替换         | ✅     | 全量更新                     |
| PATCH  | 部分更新         | ❌     | 改一个字段                   |
| DELETE | 删除             | ✅     | 删除资源                     |

状态码的三位语义（[net 篇](../net/05-http.md)全表）：**2xx 成功、3xx 重定向、4xx 客户端错（401 未认证 / 403 无权限 / 404 不存在 / 422 校验失败）、5xx 服务端错**。前端的错误处理必须分层：**网络层失败（fetch reject）≠ HTTP 错误（res.ok 判定）≠ 业务错误（200 + code 字段）**——三层各管各的（[第 7 篇](07-async.md)）。

## 2. 统一 API 封装：一次写对处处受益

```typescript
// api/client.ts —— 项目的网络层单点
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`/api${path}`, {
        headers: { "Content-Type": "application/json", ...authHeader() },
        ...options,
    });
    if (res.status === 401) { redirectToLogin(); throw new Error("unauthorized"); }
    if (!res.ok) throw new ApiError(res.status, await res.text());   // 统一抛错
    return res.json();
}

// 业务侧只关心业务
const users = await api<User[]>("/users?page=1");
```

统一的封装点：**baseURL、认证头注入、错误归一化（ApiError）、401 跳登录、超时与取消（AbortController）**——散落的 fetch 调用是「每一处都要重对一遍」的维护灾难。token 的存放与刷新（401 → refresh → 重放请求）也是这个封装层的职责。

## 3. 浏览器存储：三兄弟的分工

| 存储          | 容量   | 生命周期            | 随请求发送？ | 典型用途                     |
| ------------- | ------ | ------------------- | ------------ | ---------------------------- |
| Cookie        | 4KB    | 可设过期            | ★ 每次自动带上 | 服务端会话、认证（HttpOnly） |
| localStorage  | ~5-10MB | 永久（手动清）      | 否           | 主题偏好、草稿、token（权衡） |
| sessionStorage | ~5MB  | 标签页生命周期       | 否           | 一次性表单/流程状态           |
| IndexedDB     | 大     | 永久                | 否           | 离线应用的大数据（结构化）     |

```javascript
localStorage.setItem("theme", "dark");        // 只存字符串（对象要 JSON 序列化）
localStorage.getItem("theme");
sessionStorage.setItem("step", "2");

document.cookie = "a=1; Secure; SameSite=Lax"; // JS 可操作非 HttpOnly 的 cookie
```

cookie 的三个安全属性是认证安全的骨架：**HttpOnly**（JS 读不到——XSS 偷不走 token）、**Secure**（只走 HTTPS）、**SameSite**（跨站请求不带——CSRF 的主要防线，[第 10 篇下半](#10-cors-与安全)）。localStorage 存 token 的权衡：XSS 可读（比 HttpOnly cookie 弱）——**有 XSS 风险面就优先 HttpOnly cookie + CSRF 防线**；纯本地应用（无服务端会话）用 localStorage 无妨。

## 4. CORS：跨域的规则

**同源策略**：不同源（协议+域名+端口任一不同）的页面脚本不能互读对方的响应——浏览器安全模型的基石（没有它，任何网站都能读你在别的网站的登录态）。CORS 是「服务端显式授权跨域」的机制：

```text
简单请求（GET/POST + 常见头）：浏览器直发，响应必须带
  Access-Control-Allow-Origin: https://app.example.com   ← 服务端声明「允许这个源读」

非简单请求（PUT/DELETE/自定义头/JSON content-type）：
  先发 OPTIONS 预检（preflight）→ 服务端回答允许 → 再发真请求
  Access-Control-Allow-Methods / -Headers
```

三个关键认知：

1. **CORS 是浏览器的行为**——curl/服务端间调用没有 CORS；「Postman 能通、浏览器报 CORS」不是后端 bug 的反证（是浏览器在执行策略）。
2. **解法是服务端配响应头**（或同域部署/开发期代理：Vite 的 `server.proxy` 把 `/api` 转发到后端——开发环境的同域化）。
3. **凭证跨域**（带 cookie）：`credentials: "include"` + 服务端 `Allow-Origin` 不能是 `*`（必须具体源）+ `Allow-Credentials: true`——三者缺一即失败。

## 5. 安全：XSS 与 CSRF 的攻防

### 5.1 XSS（跨站脚本）：恶意代码在你的页面里跑

```javascript
el.innerHTML = userInput;              // ❌ 用户输入被当 HTML/JS 执行（[第 6 篇](06-dom-events.md)）
// React/Vue 默认转义插值 —— 但 dangerouslySetInnerHTML/url 里的 javascript: 仍可破防
```

类型与防线：**存储型**（恶意内容存进 DB，所有访问者中招——最狠）、**反射型**（URL 参数直接渲染）、**DOM 型**（前端拼 HTML）。防线四件：**输出转义/框架默认转义**（第一道）、**CSP**（Content-Security-Policy 响应头：限制脚本来源，内联与外域脚本被禁）、**HttpOnly cookie**（偷了 token 也用不了）、**输入校验**（辅助而非主力——输出侧防御才是根本：XSS 的本质是「把数据当代码」，转义发生在输出端）。

### 5.2 CSRF：借你的身份发请求

```text
用户登录了 bank.com（cookie 在）→ 访问恶意站 evil.com
→ evil.com 里 <form action="https://bank.com/transfer" method="POST"> 自动提交
→ 浏览器自动带上 bank.com 的 cookie → 转账成功（用户毫不知情）
```

CSRF 的本质：**浏览器自动带 cookie 的特性被第三方利用**。防线：**SameSite cookie**（Lax/Strict 让跨站请求不带 cookie——现代默认，已挡掉大半）、**CSRF token**（表单里埋服务端发的随机 token——第三方拿不到）、**校验 Origin 头**。「cookie 自动附带」与「请求来源可验证」是这个战场的全部棋理。

## 6. HTTP 缓存：让浏览器少要一次

```text
首次请求：响应头带缓存策略
  Cache-Control: max-age=31536000, immutable      ← 指纹文件（app.a1b2c3.js）：一年 + 不可变
  Cache-Control: no-cache                          ← 每次都验证
  ETag: "abc123"                                   ← 资源指纹（内容哈希）

再次请求：max-age 内直接用本地缓存（0 请求）
  过期后带 If-None-Match: "abc123" 问服务器 → 未变：304 Not Modified（不传正文）
```

缓存的工程配比：**带内容哈希的文件名（构建指纹）+ 一年 immutable**（JS/CSS——内容变文件名变）、**HTML 本身 no-cache**（引用最新指纹）——「改了代码用户还看到旧版」的根源就是 HTML 被缓存。API 响应的缓存要按业务谨慎（max-age 内的数据是「可能旧的」）。

## 7. 陷阱清单

- fetch 不判 res.ok / 不分三层错误（网络/HTTP/业务）：统一 ApiError 封装。
- token 存 localStorage 且站点有 XSS 面：HttpOnly cookie + SameSite 优先。
- 跨域后端「没配 CORS」：预检 OPTIONS 405/缺头；开发用 proxy、生产同域或正确响应头。
- CSP 缺失：XSS 的纵深防线少一层；先 report-only 灰度。
- 缓存了带用户数据的响应：privacy 泄露；API 层 no-store 或精确 max-age。
- 构建产物无指纹 + HTML 可缓存：发版后用户旧版；指纹文件 + HTML no-cache。
- credentials 跨域三件套不全：带 cookie 的跨域永远失败。

## 8. 小结

- HTTP 的前端视角：方法语义（幂等表）、状态码三层错误（网络/HTTP/业务）——统一 API 封装把认证/错误/取消收敛到一处。
- 存储三兄弟的分工：cookie（认证、HttpOnly+Secure+SameSite 三属性是安全骨架）、localStorage（本地偏好）、IndexedDB（离线大数据）。
- CORS 是浏览器执行的服务端授权：预检机制、凭证三件套、开发期 proxy——「Postman 通而浏览器不通」的真相。
- XSS 防「数据变代码」（输出转义+CSP+HttpOnly）、CSRF 防「身份被借用」（SameSite+token+Origin）——两类攻击的防线方向相反，常一起考。
- HTTP 缓存的工程配比：指纹文件 immutable 一年、HTML no-cache——发版可见性与性能的平衡点。

## 9. 练习

**1.** 用 DevTools Network 面板分析一次登录：观察请求头（cookie/authorization）、响应的 Set-Cookie、状态码；故意输错密码看 401 的形态——把「认证对话」的完整流程画成时序图。

> [!TIP]
> 思路登录是最复杂的 HTTP 对话之一（POST/302 或 200+token/Set-Cookie/后续自动带凭证）。时序图上标注「每一跳谁带了什么凭证」。

**2.** 搭建一次跨域实验：前端（localhost:5173）直连后端（localhost:8000）观察 CORS 报错 → 后端加响应头修复 → 再故意只加 Allow-Origin 不加 Allow-Headers 的自定义头场景——逐个报错对号入座。

> [!TIP]
> 思路CORS 报错的信息几乎不指明缺哪个头——对照预检 OPTIONS 响应（Network 面板可见）逐项核对是唯一高效路径。三种失败（无 Allow-Origin/无 Allow-Headers/无 Allow-Methods）各有面貌。

**3.** 制作一个「XSS 教学页」：三个输入框分别走 innerHTML/textContent/框架渲染，输入 `<img src=x onerror=...>`；再加一层 CSP 头观察 even innerHTML 被拦截——纵深防御的体感实验。

> [!TIP]
> 思路CSP 的 `script-src 'self'` 让内联 onerror 也不执行——「即使转义漏了还有 CSP」的纵深思路。report-only 模式先观察再强制是上线姿势。

**4.** 实现「写后读」的缓存验证：一个 GET 接口带 Cache-Control: max-age=60，改数据后前端重取观察旧值——再用 ETag/版本参数/请求头 no-cache 三种方式修复，记录各自的网络面板表现（304/200）。

> [!TIP]
> 思路「改了不生效」在 HTTP 缓存的场景是「浏览器按契约没发请求」——契约是响应头定的。指纹文件 + no-cache HTML 的工程配比由此落地。

**5.** 设计「token 刷新」的完整封装：401 → 用 refresh token 换新 token → 重放原请求 → 多个并发 401 只刷一次（锁）→ 刷新失败登出——伪代码级设计并标注竞态点。

> [!TIP]
> 思路并发 401 的「只刷一次」是设计难点（共享一个 refresh promise）；重放请求要保存原配置。这是「统一 API 封装层」存在价值的终极案例。

**6.** 讨论：「前端安全」与「后端安全」的边界在哪里？从「前端的一切输入/存储都可被用户操控」（F12 改请求/localStorage/绕过前端校验）出发，论证「前端校验只是体验优化、服务端校验才是安全边界」，并指出三类「以为前端校验了就安全」的典型漏洞。

> [!TIP]
> 思路前端在用户的机器上运行 = 一切前端状态可伪造。典型漏洞：只靠前端隐藏按钮做权限、只靠前端校验金额/数量、把管理接口藏起来不设服务端鉴权。「服务端不信任任何输入」是安全的第一公理——前端的校验、隐藏、防呆全是 UX。
