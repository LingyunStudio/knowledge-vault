---
title: 异步 JavaScript
order: 7
tags: 核心, Promise, async
summary: 事件循环的直觉、Promise 链、async/await 与错误处理、fetch 请求。
---

JS 是单线程的：同一时刻只执行一段代码，而网络请求、定时器都是耗时的。异步机制解决的就是"现在不等，回头再叫我"。Promise 是现代异步的统一载体，async/await 是它的语法糖，fetch 是浏览器发请求的标准入口。

## 事件循环：单线程怎么不堵车

JS 运行时里有三样东西：**调用栈**（正在执行的代码）、**Web API**（定时器、网络等浏览器能力）、**任务队列**（排队的回调）。事件循环的规则一句话：**调用栈空了，才取队首的回调执行**。

```javascript
console.log("1");
setTimeout(() => console.log("2"), 0);   // 0ms 也不插队
Promise.resolve().then(() => console.log("3"));
console.log("4");
// 输出顺序：1 4 3 2
```

`setTimeout(…, 0)` 不会立刻执行——它只是把回调放进队列，等同步代码（1、4）跑完才有机会。队列还分两种：**微任务**（Promise 回调）在每轮同步代码结束后优先清空，**宏任务**（setTimeout）排在其后，所以 3 先于 2。

> [!NOTE]
> 心智模型：同步代码是"现在"，`then` / `await` 后面的代码是"下一轮"，`setTimeout` 是"下一轮的更后面"。单线程意味着任何同步长计算都会冻结整个页面——重活交给浏览器（fetch、Worker），别在主线程硬算。

## Promise：异步结果的容器

Promise 是"未来才有值"的对象，有三种状态：

- `pending`：进行中
- `fulfilled`：成功，携带结果值
- `rejected`：失败，携带错误原因

状态迁移**不可逆且只发生一次**：pending 只能单向走到 fulfilled 或 rejected，之后永远定格，再调 resolve/reject 都被忽略。

```javascript
const p = new Promise((resolve, reject) => {
  setTimeout(() => resolve("好了"), 1000);
  // resolve 之后这里再 reject 也无效——状态不可逆
});

p
  .then(value => console.log(value))             // 成功时执行；返回值传给下一个 then
  .catch(err => console.error(err))              // 链上任何一环失败都跳到这里
  .finally(() => console.log("无论如何都执行"));  // 收尾清理
```

`then` 返回的还是 Promise，所以能链式调用，把嵌套回调拉平成一列——这是它对"回调地狱"的核心胜利：

```javascript
// ❌ 回调地狱：嵌套逐层加深，错误处理重复三遍
getUser(id, (err, user) => {
  getPosts(user, (err2, posts) => {
    getComments(posts[0], (err3, comments) => { /* … */ });
  });
});

// ✅ Promise 链：一层缩进，一条错误通道
getUser(id)
  .then(user => getPosts(user))
  .then(posts => getComments(posts[0]))
  .then(comments => render(comments))
  .catch(handleAnyError);
```

## async/await：Promise 的糖

`async` 函数内部可以用 `await` "暂停"等一个 Promise 的结果，写起来像同步代码：

```javascript
async function loadPage() {
  try {
    const res = await fetch("/api/posts");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const posts = await res.json();
    return posts;
  } catch (err) {
    console.error("加载失败：", err);
    return [];
  } finally {
    hideSpinner();
  }
}
```

规则三条：`async` 函数的返回值永远是 Promise；`await` 后面跟 Promise 时等它落定（跟普通值也行，原样返回）；`await` 会把 rejected 的错误抛出来，所以配 `try/catch` 用。

相互独立的请求要**并行**发，别写成串行：

```javascript
// ❌ 串行：总耗时 = 三个请求之和
const user = await getUser();
const posts = await getPosts();
const tags = await getTags();

// ✅ 并行：总耗时 ≈ 最慢的那个
const [user2, posts2, tags2] = await Promise.all([getUser(), getPosts(), getTags()]);
```

> [!TIP]
> `Promise.all` 一败俱败：任一失败整体拒绝。`Promise.allSettled` 全员到齐：成功失败分开装箱。轮播图要三个接口同时成功用前者；仪表盘允许部分失败用后者。

## fetch：浏览器发请求

```javascript
const res = await fetch("/api/posts", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: "新文章" }),
});
```

fetch 有个反直觉设定必须背下来：

> [!WARNING]
> fetch 只在网络层失败（断网、DNS 解析失败）时 reject；404、500 都算"成功"resolve。不检查 `res.ok` 的 catch 是摆设——HTTP 错误要自己抛：

```javascript
// ❌ 以为 catch 能接住 404——接不住，res 照样返回
const res = await fetch("/api/missing");
const data = await res.json();      // 拿到的是错误响应体，或解析报错

// ✅ 显式检查状态
const res2 = await fetch("/api/missing");
if (!res2.ok) throw new Error(`请求失败：${res2.status}`);
```

跨域请求何时被浏览器拦、服务器要配什么响应头，见[浏览器存储与 HTTP](10-storage-http.md)。

## 练习

- [ ] 先预测输出再运行验证：`console.log("a"); setTimeout(() => console.log("b")); Promise.resolve().then(() => console.log("c")); console.log("d");`
- [ ] 把 `setTimeout` 包成 `delay(ms)` Promise，用它间隔 1 秒顺序打印 1、2、3
- [ ] 用 `Promise.allSettled` 同时请求两个接口，无论成败都渲染出可用的部分

相关阅读：[DOM 与事件](06-dom-events.md)
