---
title: 异步 JavaScript：事件循环到 async/await
order: 7
tags: 异步, Promise, async await, 事件循环, fetch
summary: JS 单线程模型与事件循环的完整机制（调用栈/微任务/宏任务的执行顺序实验）、Promise 的状态机与链式错误传播、async/await 的语法糖本质与并发模式（all/allSettled）、fetch 的使用与「HTTP 错误不是异常」的陷阱。
---

JS 是**单线程**的：同一时刻只执行一段代码——但浏览器要同时响应点击、跑动画、发请求。答案是**异步**：耗时操作交给浏览器后台，完成后通过事件循环把回调排队回来。理解异步的钥匙是**事件循环**的执行模型，从回调到 async/await 的语法演化都是给这个模型包上更好的「皮」。

## 1. 事件循环：JS 的调度核心

```text
┌──────────┐   耗时操作交给浏览器线程     ┌──────────────┐
│ 调用栈    │ ──── setTimeout/fetch ───→ │ Web API/后台   │
│ (同步执行)│                             └──────┬───────┘
└────┬─────┘                                    │ 完成后回调排队
     │ 事件循环：栈空时                          ▼
     └─────────────────────── 微任务队列（Promise.then，优先清空）
                              宏任务队列（setTimeout，逐个取）
```

执行顺序实验（面试经典，更是理解一切的钥匙）：

```javascript
console.log("1 同步");
setTimeout(() => console.log("4 宏任务"));
Promise.resolve().then(() => console.log("3 微任务"));
console.log("2 同步");
// 输出：1 → 2 → 3 → 4
// 规则：同步代码 → 清空全部微任务 → 取一个宏任务 → 再清微任务 → ……
```

两条推论贯穿日常：

1. **同步代码阻塞一切**：一个 while 循环 5 秒 = 页面卡死 5 秒（单线程没有任何并发逃逸）——重计算要么拆分要么进 Worker 线程。
2. **微任务插队**：Promise 的 then 会在下一个 setTimeout 之前执行——「异步也分优先级」，调试时序问题时想清 callback 排在哪条队。

## 2. Promise：异步的值

回调时代的「回调地狱」（嵌套金字塔 + 错误处理散落）催生了 Promise——**一个「未来才有值」的对象**，它有三种状态：pending（进行中）→ fulfilled（成功）/ rejected（失败），且状态**一旦落定不可再变**。

```javascript
fetch("/api/user")                       // 返回 Promise
    .then(res => res.json())             // 链式：上一步的结果传给下一步
    .then(user => render(user))
    .catch(err => showError(err))        // ★ 链上任何一步的失败都被这里接住
    .finally(() => hideSpinner());       // 无论成败都执行（清理）
```

链式的关键性质：**每个 then 返回新 Promise**——异步操作的串行写成了线性管道；错误沿链条**向下传播**到最近的 catch（与同步异常的 try/catch 传播同构）。每个 `.then` 里的返回值若是 Promise，链会「等待它落定」——这就是链式能串行异步的原因。

## 3. async/await：同步写法的异步

```javascript
async function loadUser(id) {
    try {
        const res = await fetch(`/api/user/${id}`);     // ★ await：暂停本函数，等 Promise 落定
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const user = await res.json();
        return user;
    } catch (err) {                                     // 失败 = 抛异常 → 普通 try/catch 接住
        showError(err.message);
        return null;
    } finally {
        hideSpinner();
    }
}
```

async/await 是 Promise 的**语法糖**：`await` 等价于 `.then`（把「暂停恢复」编译成状态机），`async` 函数本身返回 Promise（调用方仍可 await 它）——异步代码终于长得像同步代码，错误处理回归 try/catch。

**await 只暂停「这个 async 函数」，不阻塞线程**——等待期间事件循环照常跑其他任务（这是与同步阻塞的本质区别）。

### 3.1 串行与并行：await 的常见误用

```javascript
// ❌ 串行：3 秒 + 3 秒 = 6 秒（第二个请求等第一个 await 完才开始）
const a = await fetchA();
const b = await fetchB();

// ✅ 并行：同时发出，一起等 = 3 秒
const [a, b] = await Promise.all([fetchA(), fetchB()]);

// allSettled：全部落定（含失败）——失败不中断整批
const results = await Promise.allSettled([fetchA(), fetchB(), fetchC()]);
results.filter(r => r.status === "rejected").forEach(r => log(r.reason));

// race：第一个落定的胜出（超时控制的实现姿势）
const result = await Promise.race([fetchWithTimeout(), timeout(5000)]);
```

「多个独立 await 写成串行」是性能低效的头号模式——**没有数据依赖的异步操作必须并行**（Promise.all）。all 与 allSettled 的取舍：一个失败全盘作废（强一致场景）vs 各自结算（批量任务）。注意 all 的「快速失败」会让其他进行中的请求变成「无人管的孤儿」——需要取消语义时用 AbortController。

## 4. fetch：网络请求的现代原语

```javascript
const res = await fetch("/api/orders?status=paid", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page: 1 }),        // 对象 → JSON 字符串
    signal: controller.signal,                // 取消支持（AbortController）
});

if (!res.ok) throw new Error(`HTTP ${res.status}`);   // ★ fetch 只在网络层失败时 reject！
const data = await res.json();                // 404/500 也会走 then —— 必须手动判 ok
```

fetch 的头号陷阱：**HTTP 错误状态码（404/500）不会让 Promise reject**——它只在「网络彻底失败/断网」时 reject。忘了 `res.ok` 检查 = 把错误响应当成功处理（应用层拿到错误页的 JSON/HTML 当数据）。响应体方法（`.json()/.text()/.blob()`）返回的也是 Promise（流式读取）——两层 await 是常态。

取消（AbortController）是现代请求的标配：组件卸载时取消未完成请求（React useEffect 的清理）、超时控制——「请求发出去就收不回」在 UI 场景是竞态 bug 的源头（旧请求晚到覆盖新结果）。

## 5. 并发控制的工程化

```javascript
// 限流并发：同时最多 N 个请求（100 个文件分批上传）
async function pool(tasks, limit = 5) {
    const results = [];
    const executing = new Set();
    for (const task of tasks) {
        const p = task().then(r => { executing.delete(p); return r; });
        executing.add(p);
        if (executing.size >= limit) await Promise.race(executing);   // 满员等一个完成
        results.push(p);
    }
    return Promise.all(results);
}
```

无限制的 `Promise.all(一百个请求)` 会压垮浏览器连接数与服务端——**并发池**（限流）是批量任务的标准形态。配合重试（指数退避）与 AbortController，构成前端网络层的完整骨架。

## 6. 陷阱清单

- await 写成串行（无依赖的请求）：Promise.all 并行化。
- fetch 不判 res.ok：404/500 被当成功；封装一层「自动抛错」的 fetch。
- Promise.all 一个失败全崩且孤儿请求：allSettled/AbortController/并发池按需选。
- 同步重计算卡 UI：拆帧（requestIdleCallback）/Web Worker。
- 微任务风暴（递归 then）饿死宏任务：渲染被饿死；大循环用 setTimeout 分片。
- await 在循环里「逐个等」本可并行的操作：识别数据依赖。
- 忘记 AbortController：组件卸载后 setState（旧请求竞态覆盖新结果）。

## 7. 小结

- 事件循环是 JS 的调度宪法：同步 → 清微任务 → 一个宏任务 → 循环；「同步阻塞一切」与「微任务优先」是两条推论。
- Promise 的本质是「未来值的容器 + 状态机」：链式串行、错误沿链传播、不可逆的状态落定。
- async/await 是同步外形 + Promise 内核：try/catch 回归、await 只暂停当前函数；**无依赖的 await 必须并行化**（all/allSettled/race 的取舍）。
- fetch 的契约：网络失败才 reject、HTTP 状态必须手动判 ok；AbortController 是取消与超时的正解。
- 工程化三层：并发池限流、超时取消、失败重试（退避）——前端网络层的完整骨架。

## 8. 练习

**1.** 手写事件循环时序题并验证：混合 setTimeout/Promise.then/queueMicrotask/同步代码的五段输出，逐行标注「进哪条队列」——直到你能预测任意组合。

> [!TIP]
> 思路记忆锚点：微任务队列「清空才走」（包括 then 链新产生的微任务）、宏任务「一次一个」。预测错的每道题回事件循环图上重演一遍。

**2.** 把一段回调地狱（三层嵌套的 fs/请求回调）重构成 Promise 链，再重构为 async/await——三次版本的错误处理与可读性对比表。

> [!TIP]
> 思路对比维度：嵌套深度、错误处理位置、中途返回难度。async 版的错误处理与同步代码同构（try/catch）——「语法演化服务心智负担」的完整案例。

**3.** 实现一个「带超时与重试的 fetch」封装：AbortController 超时 5 秒、失败指数退避重试 3 次（1s/2s/4s）、4xx 不重试——处理成可复用的函数。

> [!TIP]
> 思路细节坑：超时要 abort 掉请求（不只是放弃等待）、重试之间的 await sleep、错误分类（网络类重试/HTTP 类按码）。这是前端网络层封装的最小完整形态。

**4.** 并发池实战：50 个图片 URL 并发池限 5 上传，进度条按完成数更新——对比「全部 Promise.all」「串行 await」「并发池」三种策略的耗时与内存。

> [!TIP]
> 思路预期：串行最慢、all 峰值压力大、池是平衡点。进度更新要用「计数器 + 微任务安全的状态渲染」（不要在 .then 里裸改 UI 状态机外的状态）。

**5.** 复现「竞态覆盖」：输入框快速输入触发搜索（无取消版），观察旧请求晚到覆盖新结果的乱序；用 AbortController + 请求序号两种方式修复——总结竞态的通用防线。

> [!TIP]
> 思路竞态的根源：响应顺序 ≠ 请求顺序。防线：取消（AbortController）、序号校验（丢弃过期响应）、防抖（减少并发源）。三者常组合使用。

**6.** 讨论：为什么 JS 选择「单线程 + 事件循环」而不是多线程？从「DOM 并发访问的复杂度」（两个线程同时改 DOM 的锁地狱）与「回调模型的编程简化」分析；Web Worker 的出现补了什么、又为什么依然不能碰 DOM——对照 [GIL](../python/01-python-model.md) 与 [系统线程](../linux/07-processes.md)的并发设计光谱。

> [!TIP]
> 思路单线程消除了「共享 DOM 的并发修改」整类问题——UI 框架的简化史由此开始；代价是重计算必须外置（Worker 不共享 DOM——消息传递隔离）。与 python 的 GIL、Go 的 goroutine 共享内存+channel 一起，构成「隔离与共享」光谱上的三个选择点。
