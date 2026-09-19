---
title: React：声明式 UI 与组件化
order: 9
tags: React, 组件, 状态, Hooks, 虚拟DOM
summary: 声明式 UI 的核心转变（UI = f(state)）、组件与 JSX 的组合模型、useState 与不可变更新、重渲染的触发时机与 keys、useEffect 的依赖与清理、useRef/useMemo 的定位、自定义 hooks 的抽象形态。
---

React 的核心思想一句话：**UI = f(state)**——界面是状态的函数。你声明「状态是什么、界面长什么样」，React 负责在状态变化时更新 DOM（[第 6 篇](06-dom-events.md)的手动同步被自动化）。这个转变把前端的复杂度从「过程式 DOM 操作」迁移到「状态设计」——组件化是它的组织形态，Hooks 是它的逻辑复用单元。

## 1. 组件与 JSX：组合的艺术

```tsx
type Props = { name: string; onFollow?: () => void };

function UserCard({ name, onFollow }: Props) {
    return (
        <div className="card">
            <h3>{name}</h3>
            {onFollow && <button onClick={onFollow}>关注</button>}
        </div>
    );
}

// 组合：组件树
function App() {
    return (
        <main>
            <UserCard name="alice" onFollow={() => follow(1)} />
            <UserCard name="bob" />
        </main>
    );
}
```

- **JSX** 是「JS 里写 HTML」的语法糖：编译为函数调用（`React.createElement`）——它在 JS 里，所以 `{}` 可以放任何表达式（条件 `&&`、列表 `map`）。
- **props 是只读的**：组件是「props → UI」的纯函数（同 props 同输出）——修改 props 是违规模式。
- **children 与组合**：`<Card><Content/></Card>` 的 children 让组件像「插槽」——组合优于继承在这里落地（[python 组合优先](../python/07-classes.md)的 UI 版）。

## 2. 状态：useState 与不可变更新

```tsx
import { useState } from "react";

function Counter() {
    const [count, setCount] = useState(0);          // [当前值, 设置函数]

    return (
        <button onClick={() => setCount(count + 1)}>
            {count}
        </button>
    );
}
```

- `setState` 触发**重渲染**（组件函数重新执行）——UI 的更新入口。
- setState 是**请求**不是立即赋值（React 批量处理更新）——「setCount 后立刻读 count 拿到旧值」是新手第一坑；基于前值更新用函数形式：`setCount(c => c + 1)`。
- **不可变更新**（[JS 引用语义](05-js-basics.md)的直接推论）：React 靠「引用是否变化」判断状态变了——原地修改对象/数组**不会触发更新**：

```tsx
// ❌ 原地修改：引用没变，React 不知道
todos.push(newTodo); setTodos(todos);

// ✅ 造新对象/数组
setTodos([...todos, newTodo]);
setUser({ ...user, name: "new" });          // 展开覆盖（[python 的浅拷贝](../python/02-data-model.md)的不可变版）
setItems(items.map(i => i.id === id ? { ...i, done: !i.done } : i));   // 条件替换
```

**状态该放在哪**：单向数据流——状态提升到「共同的最小父组件」，props 向下、事件向上。「多个组件要共享的状态」提升，「只有一个组件用的」留在原地（`useState` 本地）。

## 3. 列表与 keys：diff 的路标

```tsx
{todos.map(todo => (
    <TodoItem key={todo.id} todo={todo} />     // ★ key：稳定唯一的标识
))}
```

React 更新列表时用 key 对比新旧树的元素（哪些要复用、哪些要重建）。**key 用稳定的业务 id**——用数组下标作 key 时，插入/删除会让 React 「张冠李戴」（下标对应的元素错位——输入框内容错乱是经典现场）。key 的规则：兄弟之间唯一且稳定。

## 4. useEffect：与外部世界同步

```tsx
useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/user/${id}`, { signal: ctrl.signal })
        .then(r => r.json())
        .then(setUser)
        .catch(err => { if (err.name !== "AbortError") setError(err); });

    return () => ctrl.abort();            // ★ 清理函数：依赖变化/卸载时执行
}, [id]);                                  // 依赖数组：id 变了才重新执行
```

useEffect 的定位：**让组件与「React 之外的世界」同步**（网络/订阅/定时器/直接操作 DOM）。三条纪律：

1. **依赖数组如实声明**：用到的外部值都写进去（`[]` 只在挂载时跑一次）；说谎的依赖 = 闭包旧值 bug（stale closure，[闭包语义](05-js-basics.md)的框架版）。
2. **清理函数归还资源**：取消请求/清定时器/退订——「借了要还」（[RAII](../cpp/04-raii.md)思想的 hook 版）。
3. **能用渲染期算出的不要用 effect**：`derived = filtered(list)` 直接算（无状态冗余）——「你未必需要 effect」是官方文档的著名章节。

## 5. useRef 与 useMemo

```tsx
const inputRef = useRef<HTMLInputElement>(null);   // 引用 DOM：非状态的方式「摸」元素
inputRef.current?.focus();

const timerRef = useRef<number>();                 // 存「不参与渲染的可变值」（定时器 id 等）
useEffect(() => {
    timerRef.current = setInterval(tick, 1000);
    return () => clearInterval(timerRef.current);
}, []);

const sorted = useMemo(() => [...items].sort(cmp), [items]);   // 昂贵计算的缓存（依赖不变不重算）
const onClick = useCallback(() => send(id), [id]);             // 函数身份的稳定（传给 memo 子组件）
```

useRef 的双重身份：**DOM 引用**与「跨渲染的可变盒子」（改 current 不触发渲染）。useMemo/useCallback 是性能优化（计算缓存/引用稳定）——**先让它正确、再按 profile 加 memo**，无脑包裹只是复杂度（[MATLAB 的向量化纪律](../matlab/09-vectorization.md)：测量先行）。

## 6. 表单与受控组件

```tsx
const [text, setText] = useState("");
<input value={text} onChange={e => setText(e.target.value)} />
// 受控：React 状态是唯一真相源（value 由 state 决定）——校验/联动/提交统一走状态
// 非受控：defaultValue + ref 读值（简单表单/大表单的性能取舍）
```

受控组件是「UI = f(state)」在表单上的体现——状态驱动一切、可预测可回放；代价是每次击键重渲染（大表单的性能方案：非受控或状态拆分）。

## 7. 自定义 Hook：逻辑的复用单元

```tsx
function useDebouncedValue<T>(value: T, ms: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), ms);
        return () => clearTimeout(t);
    }, [value, ms]);
    return debounced;
}

// 使用：逻辑像内置 hook 一样可组合
const q = useDebouncedValue(query, 300);
useEffect(() => { if (q) search(q); }, [q]);
```

自定义 Hook = **「用 hook 组装的可复用逻辑」**（命名 use 开头）——它不是组件、不渲染，只把「状态 + 副作用」打包。数据获取、防抖、本地存储同步……都值得封装成 hook（与 [python 装饰器](../python/04-functions.md)的复用层次对照：hook 复用「有状态的逻辑」，装饰器复用「无状态的处理」）。

## 8. 数据获取的形态：服务端状态

```tsx
// 手写形态：状态 + effect + 清理 + 缓存 + 重试……（样板很多）
// 库形态（TanStack Query）：服务端状态的生命周期托管
const { data, isPending, error } = useQuery({
    queryKey: ["user", id],
    queryFn: () => api.getUser(id),
});
const mutation = useMutation({ mutationFn: api.updateUser, onSuccess: () => invalidate() });
```

「服务端数据」与「客户端状态」是两类状态：前者是远端数据的缓存（需要缓存失效/重取/去重），后者是纯 UI 状态——TanStack Query/SWR 处理前者、useState 处理后者，**混为一谈是状态管理的根源性混乱**。全局状态库（Zustand/Redux）只在「跨组件树共享的客户端状态」真出现时才引入。

## 9. 陷阱清单

- 原地修改状态（push/直接改属性）：不触发渲染；不可变更新（展开/结构性复制）。
- setState 后立刻读 state：拿到旧值；函数式更新 `set(c => c + 1)`。
- 列表 key 用下标：插入删除错位；稳定业务 id。
- useEffect 依赖说谎（stale closure）：eslint 的 exhaustive-deps 别关；或函数式 setState 避开依赖。
- effect 做派生计算/事件响应：「你未必需要 effect」；派生用渲染期计算。
- 卸载后 setState（请求竞态）：AbortController 清理（[第 7 篇](07-async.md)）。
- 无脑 useMemo/useCallback：测量后再优化；先正确后性能。
- 客户端状态与服务端状态混库：Query 管服务端缓存、useState/Zustand 管客户端。

## 10. 小结

- React 的范式转变：UI = f(state)——手动 DOM 同步被状态驱动的自动渲染取代；组件是 props 到 UI 的纯函数，组合优于继承。
- 状态三纪律：不可变更新（引用比较的机制要求）、最小作用域（提升共享状态）、稳定 key（diff 的路标）。
- useEffect 的定位是「与外部世界同步」：依赖如实、清理归还、派生计算不用 effect——stale closure 与竞态是两大事故源。
- useRef（DOM/可变盒子）、useMemo/useCallback（测量后的优化）、自定义 hook（有状态逻辑的复用单元）各司其职。
- 状态的分类治理：服务端状态（Query 托管缓存）vs 客户端状态（useState/全局库）——混用是状态管理混乱的根源。

## 11. 练习

**1.** 把[第 6 篇](06-dom-events.md)的原生待办列表重写为 React（useState + map 渲染 + 事件），对比两个版本的代码结构——统计「状态存储位置」「更新路径」「事件绑定」三处的差异。

> [!TIP]
> 思路原生版状态散在 DOM 与数组两处、手动同步；React 版状态唯一（数组）、DOM 是投影。「UI = f(state)」在两个版本的对照中最直观。

**2.** 不可变更新专练：实现「添加/删除/切换完成/清空已完成」四个操作，全部用展开与 map/filter——不出现任何 push/splice；用 React DevTools 验证每次渲染。

> [!TIP]
> 思路这四个操作覆盖了不可变更新的全部形态：追加（展开）、删除（filter）、更新（map + 条件展开）、批量过滤。写熟后不可变不再是负担而是模式。

**3.** 复现两个经典坑并修复：①key 用下标的列表在头部插入后输入框错乱；②effect 依赖缺失导致的 stale closure（计数器 setTimeout 里读到旧值）——每个坑记录现象、原因、修复。

> [!TIP]
> 思路两个坑的共同根：「引用/身份的语义」——key 的身份、闭包的快照。React 的调试必须建立在 [JS 引用语义](05-js-basics.md)与[闭包](../python/04-functions.md)的地基上——这就是「先地基后框架」的验证。

**4.** 写一个自定义 hook：`useLocalStorage<T>(key, initial)`——读写同步 localStorage、跨标签页同步（storage 事件）、JSON 序列化容错。在两个组件里复用它。

> [!TIP]
> 思路hook 的设计面：泛型初值、解析容错（坏 JSON 不崩）、卸载清理监听。「一个 hook 解决一类横切逻辑」——与 [python 装饰器](../python/04-functions.md)的复用思想对比着学。

**5.** 给搜索页接入 TanStack Query：queryKey 带搜索词、防抖输入（自定义 hook）、加载/错误/空态三视图、结果缓存（回退搜索词立即显示缓存）——体验「服务端状态托管」与手写 effect 的差距。

> [!TIP]
> 思路手写版的完整清单（取消/去重/缓存/重试/竞态）有七件套，Query 把它们内置化。「服务端状态是缓存」的视角转变是状态管理认知的分水岭。

**6.** 讨论：React 的「重渲染整个组件函数」为什么没有想象中慢？从「虚拟 DOM diff 的最小更新」「JIT 的函数调用成本」「不可变数据结构的可比较性」分析，并与 [直接 DOM 操作](06-dom-events.md)、[虚拟列表](../c/09-function-pointers.md)的场景对照——什么时候「手写优化」仍然必要？

> [!TIP]
> 思路React 的赌注：JS 引擎够快 + diff 只碰必要的 DOM——大多数场景对。失效场景：超长列表（虚拟化）、高频动画（直接 transform）、深度树频繁变更（组件拆分/memo）。「框架优化失效的地方回到原生」——分层性能观的又一例。
