---
title: 模块与工具链
order: 8
tags: 进阶, ESM, Vite
summary: ESM import/export、npm 生态、Vite 的开发体验、打包产物常识。
---

一个真实项目有几百个函数，全塞一个文件没法维护。模块系统解决"代码怎么拆、怎么互相引用"，npm 解决"别人的代码怎么用"，Vite 解决"这些代码怎么变成浏览器能高效跑的东西"。三件事叠起来，就是现代前端的工程底座。

## ESM：import 与 export

ES Module 是语言原生的模块系统，每个文件就是一个模块：

```javascript
// math.js —— 导出
export const PI = 3.14159;                    // 命名导出，一个模块可多个
export function add(a, b) { return a + b; }

export default function calc(expr) { /* … */ }  // 默认导出，每模块最多一个

// app.js —— 导入
import calc, { PI, add } from "./math.js";    // 默认导出不带花括号，命名导出要带
import { add as plus } from "./math.js";      // as 改名

const mod = await import("./heavy.js");       // 动态导入：用到才加载，返回 Promise
```

浏览器里用 `type="module"` 启用：

```html
<script type="module" src="main.js"></script>
<!-- 自带三件事：严格模式、模块作用域（不污染全局）、defer 行为 -->
```

模块化之前，多个 `<script>` 标签共享全局作用域：靠加载顺序保证依赖、靠全局变量通信，谁改了谁的全局全凭运气。ESM 给每个文件独立作用域和显式依赖——`import` 写在文件顶部，这个文件依赖谁，一眼看尽。

另一个小规矩：导入自己的模块必须以 `./` 或 `../` 开头（`import "./utils.js"`），不带路径前缀的名字（`import "react"`）留给 npm 包。

> [!WARNING]
> 默认导出与命名导出是两套语法，混着写最容易出错：对默认导出写 `import { calc }` 会报"没有这个导出"。读第三方库文档时，先分清它导出的是哪一种。

## npm：包管理器

npm 是 JS 的包仓库和命令行工具，管理依赖四条命令起步：

```bash
npm init -y            # 生成 package.json（项目清单）
npm install react      # 装运行依赖，写入 dependencies
npm install -D vite    # 装开发依赖，写入 devDependencies
npm run dev            # 执行 package.json 里 scripts.dev 定义的命令

npm ci                 # 严格按 lock 文件还原依赖，团队与 CI 首选
npx prettier --write . # 临时跑一个没装在本地的包
```

`package.json` 只声明"要哪些包、什么版本范围"；**lock 文件**（package-lock.json）锁定每个依赖的精确版本，必须提交进版本库，否则两台机器装出的依赖树可能不同。

- `dependencies`：跑在用户浏览器里的代码（React、axios）
- `devDependencies`：只在开发构建时用（Vite、ESLint、TypeScript）
- `node_modules` 体积巨大且随时可重建，**永远不进版本库**，clone 后 `npm install` 即可
- `scripts`：项目命令别名，`npm run <名字>` 执行；`start` 和 `test` 可以省略 `run`

版本号遵循语义化版本 `主版本.次版本.修订号`：`^1.2.3` 允许升到 `1.x` 的最新版。"次版本向后兼容"只是约定，真正保稳的是 lock 文件。

> [!TIP]
> 团队与 CI 用 `npm ci` 代替 `npm install`：严格按 lock 文件安装，更快，且绝不悄悄升版本。

## 为什么需要构建工具

浏览器只认 HTML/CSS/JS，而项目里写的往往是 TypeScript、JSX、单文件组件——必须先"翻译"。翻译之外，构建还做四件事：

1. **打包**：几百个模块合并成少数几个文件，减少请求数
2. **压缩**：删注释、缩短变量名，体积砍到几分之一
3. **Tree-shaking**：按 import 关系只保留真正用到的导出，死代码不进产物
4. **缓存友好**：产物文件名带内容哈希（`app-3f9c2a.js`），内容不变 hash 不变，浏览器可以放心长期缓存

## Vite：当下的默认选择

```bash
npm create vite@latest my-app -- --template react   # 脚手架建项目
cd my-app
npm install
npm run dev      # 开发服务器，默认 http://localhost:5173
npm run build    # 产出优化后的静态文件到 dist/
```

开发体验是 Vite 的杀手锏：**按需编译**——浏览器请求哪个模块，Vite 才即时转换哪个（借助原生 ESM），因此冷启动秒开；改代码后**热更新（HMR）**毫秒级生效，页面不整体刷新，组件状态还能保住。生产构建时则用 Rollup 做完整的打包优化，交付标准静态文件。

开发时还会撞上跨域：让 Vite 的 `server.proxy` 把 `/api` 转发到真实接口，前端就只发同源请求。原理与取舍见[浏览器存储与 HTTP](10-storage-http.md)。

## 打包产物常识

打开 `dist/` 大致长这样：

```bash
dist/
├── index.html
├── assets/
│   ├── index-3f9c2a.js     # 业务代码，文件名带内容 hash
│   ├── index-b7e1d0.css
│   └── vendor-9d2f11.js    # 第三方库单独分包（配置的产物）
```

读懂产物的三个意义：

- **hash 文件名 = 精确缓存**：改一行代码只有对应文件换名，其余文件照用缓存
- **按路由分包（代码分割）**：首屏只加载首页的 chunk，其余路由用到再拉
- **source map**：`.map` 文件让线上报错映射回源码行号，通常只发给错误收集系统，不对公众暴露
- **public 目录**：favicon、robots.txt 这类静态资源原样拷进 dist，不参与打包和 hash

> [!NOTE]
> 面试高频："Vite 为什么快？"——开发态不做整体打包，靠原生 ESM 按需转换；生产态照样认真打包优化。开发体验和产物质量是两件事，别混为一谈。

## 练习

- [ ] 用 Vite 建一个 vanilla 项目，写两个模块互相 import，跑通 dev 和 build
- [ ] 故意改乱 lock 文件，对比 `npm install` 与 `npm ci` 的行为差异
- [ ] `npm run build` 后改一行源码再构建，观察哪些文件的 hash 变了、哪些没变

相关阅读：[JavaScript 基础](05-javascript-basics.md)
