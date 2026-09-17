---
title: 浏览器存储与 HTTP
order: 10
tags: 进阶, storage, CORS
summary: cookie/localStorage/sessionStorage、HTTP 缓存头、跨域 CORS 常识。
---

前端不是只管渲染：登录态存哪、接口数据缓存多久、请求为什么被跨域拦截——这些都要懂浏览器存储与 HTTP 才能回答。本篇讲三块：三种本地存储、HTTP 缓存头、以及"报了 CORS 错到底该改哪"。

## 三种本地存储

三种存储分工明确：cookie 走网络、localStorage 走持久、sessionStorage 走会话。先看对比表，再记 API。

| | cookie | localStorage | sessionStorage |
| --- | --- | --- | --- |
| 容量 | 约 4KB | 约 5-10MB | 约 5-10MB |
| 生命周期 | 可设过期时间 | 永久，手动清除 | 标签页关闭即清 |
| 随请求发给服务器 | 每次同域请求自动携带 | 不发送 | 不发送 |
| API | 老旧的字符串拼接 | 简单键值对 | 简单键值对 |
| 典型用途 | 服务端会话 | 主题、草稿等持久数据 | 一次性表单数据 |

```javascript
// localStorage 与 sessionStorage 的 API 完全一致
localStorage.setItem("theme", "dark");
localStorage.getItem("theme");           // "dark"
localStorage.removeItem("theme");
localStorage.clear();

// 只能存字符串，对象要过 JSON
localStorage.setItem("user", JSON.stringify({ name: "Ada" }));
const user = JSON.parse(localStorage.getItem("user") ?? "null");
```

> [!NOTE]
> 更大的结构化数据（离线缓存、聊天记录）用 IndexedDB：容量上百 MB、支持索引查询，但 API 繁琐，实际项目一般包一层库再用。日常需求，上表三种足够。

> [!WARNING]
> localStorage 对同源的**任何 JS** 都可读——包括被 XSS 注入的脚本。令牌存进去等于放在 XSS 的攻击面里。敏感凭证首选 HttpOnly cookie（JS 读不到）；localStorage 只放丢了也不致命的数据。

## cookie：会自动带回服务器的存储

cookie 的特殊性在于**每次同域请求自动携带**，这是它承担登录态的原因，也是它又慢又危险的原因：

- 服务器通过响应头 `Set-Cookie` 种下，之后每个请求浏览器自动带上，无需 JS 参与
- 属性决定行为：`HttpOnly`（JS 不可读，防 XSS 偷取）、`Secure`（仅 HTTPS 发送）、`SameSite=Lax/Strict`（跨站请求不携带，防 CSRF）、`Max-Age`（有效期）
- 现代 API 项目的常见取向：令牌放 HttpOnly cookie，靠 `SameSite` 防住大部分 CSRF；localStorage 不存敏感信息

cookie 按域生效：`a.example.com` 与 `b.example.com` 默认共享 `example.com` 域下的 cookie，"单点登录"能跨子站工作，靠的就是这一点。

## HTTP 最小常识

缓存和 CORS 都是 HTTP 的子话题，先补齐最小词汇量。一次请求就是一个"请求—响应"对：请求带方法、路径、头（和可选的请求体），响应带状态码、头（和可选的响应体）。

方法表达意图，五个够用：

| 方法 | 含义 | 典型用途 |
| --- | --- | --- |
| `GET` | 读 | 拉取页面和数据 |
| `POST` | 创建 / 提交 | 表单、发帖 |
| `PUT` / `PATCH` | 整体 / 部分更新 | 改资料 |
| `DELETE` | 删除 | 删条目 |

状态码表达结果，按首位分类：`2xx` 成功（200 最常见）、`3xx` 重定向或缓存命中（301 永久跳转、304 协商缓存）、`4xx` 客户端问题（404 不存在、401 未登录、403 无权限）、`5xx` 服务器问题（500 内部错误）。看到 4xx 先查自己的请求，看到 5xx 才轮到怀疑后端。

请求头里最常打交道的还有两个：`Content-Type` 告诉服务器请求体是什么格式（JSON 接口就是 `application/json`），`Authorization` 携带登录令牌。

## HTTP 缓存：强缓存与协商缓存

缓存回答一个问题：这个资源下次还要不要重新下载？

**强缓存**——`Cache-Control: max-age=31536000`：一年内浏览器根本不发请求，直接用本地副本。带 hash 文件名的静态资源就该配超长强缓存，文件名一变缓存自然失效（见[模块与工具链](08-modules-tooling.md)）。

**协商缓存**——资源没变就不传正文。核心是 ETag 指纹的问答：

| 阶段 | 头字段 | 说明 |
| --- | --- | --- |
| 首次响应 | `ETag: "abc123"` | 服务器给资源内容算的指纹 |
| 再次请求 | `If-None-Match: "abc123"` | 浏览器带上旧指纹问：还匹配吗 |
| 内容没变 | `304 Not Modified` | 不传正文，浏览器用本地副本 |
| 内容变了 | `200 OK` | 返回新内容，附新 ETag |

组合策略一句话：hash 静态资源用长强缓存，HTML 入口用协商缓存（保证入口新鲜），API 默认不缓存。

调试缓存问题还有个顺手开关：DevTools Network 面板里右键请求，选 "Block request URL" 可以模拟资源加载失败；"Clear browser cache" 则一键清空缓存重来。

> [!TIP]
> DevTools 的 Network 面板勾上 "Disable cache" 再刷新，就能对比有缓存和无缓存的差异；Size 列显示 `304`、`memory cache`、`disk cache` 的都是命中缓存的请求。

## 跨域与 CORS：是浏览器的规矩

**同源策略**：协议 + 域名 + 端口三者完全相同才算同源，浏览器禁止页面里的 JS 读取非同源资源的响应。这是安全底线——否则你登录着银行网站，随手打开的网页就能读到你的账户数据。

**CORS（跨源资源共享）**是标准化的"有条件放行"：服务器通过响应头明确授权，浏览器才允许把跨域响应交给 JS。关键认知：**CORS 拦截是浏览器行为**——curl、Postman、服务器对服务器的请求都不受限，只有浏览器里的 JS 受限。

服务器要配的响应头长这样（写在后端，不是前端）：

- `Access-Control-Allow-Origin: https://app.example.com`——授权哪个源
- `Access-Control-Allow-Methods: GET, POST, PUT`——授权哪些方法
- `Access-Control-Allow-Headers: Content-Type, Authorization`——授权哪些请求头

典型的失败现场：

```javascript
// 请求成功发出，服务器也正常处理了，
// 但浏览器拒绝把响应交给 JS，Console 报 CORS 错
const res = await fetch("https://api.other.com/data");  // ❌ 被拦
```

> [!NOTE]
> 见到 CORS 报错，改前端的 fetch 参数基本无用。解药在服务器：加 `Access-Control-Allow-Origin` 等响应头。开发期的临时方案是让 Vite 的 dev server 代理请求——前端只发同源请求给自己的服务器，由它转发到真正的 API，服务器之间没有同源限制。

预检请求（preflight）：当请求带自定义头、用 PUT/DELETE、或 `Content-Type: application/json` 时，浏览器会先发一个 `OPTIONS` 请求"探路"，服务器正确响应后正式请求才发出。Network 面板里看到 OPTIONS 别慌，那不是重复请求。

跨域还要带 cookie 的话，前端设 `credentials: "include"`，同时服务端的 `Access-Control-Allow-Origin` 不能写通配符 `*`，必须给出明确来源——浏览器用这个约束防止凭据泄露给任意站点。

## 练习

- [ ] 写一个暗色模式开关，用 localStorage 记住选择，刷新后依然生效
- [ ] 用 DevTools 观察某网站的静态资源响应头，找出 Cache-Control 和 ETag
- [ ] 本地起两个不同端口的页面互相 fetch，复现 CORS 报错，再给服务端加响应头解决

相关阅读：[异步 JavaScript](07-async-js.md)
