---
title: 工程化与规范
order: 11
tags: 进阶, TypeScript, 工程化
summary: TypeScript 的价值、ESLint/Prettier、组件化目录结构、性能清单。
---

单人 demo 随便写，三人以上、三个月以上的项目就得靠工程化续命：类型系统把错误挡在运行前，Lint 把低级问题挡在提交前，统一的目录结构让任何人能快速定位代码。这篇收束整个系列，给一个可持续项目的标配。

## TypeScript：给 JS 上类型

TypeScript 是 JS 的超集：全部 JS 语法照用，额外加静态类型标注，编译期做完类型检查再产出 JS。价值不在"看着专业"，而在三件事：

```typescript
// 1. 运行时错误提前到编码时：拼错字段名，编辑器直接画红线
interface User {
  id: number;
  name: string;
  email?: string;          // ?: 可选属性
}

function greet(u: User): string {
  return `你好，${u.nmae}`;   // ❌ 编译期报错：属性 "nmae" 不存在
}

// 2. 类型即文档：签名自己说明输入输出
function findUser(id: number): Promise<User | null> { /* … */ }
// 一眼看懂：传数字，返回可能是 User 也可能没有

// 3. 重构有保险：改了接口定义，所有受影响的调用点全部报错，一个都漏不掉
```

```typescript
// 常用速记
let ids: number[] = [1, 2, 3];
let pair: [string, number] = ["age", 36];    // 元组：定长定型的数组
function log(a: string | number): void {}    // 联合类型
type Role = "admin" | "editor" | "viewer";   // 字面量联合：取值受限，比裸 string 安全
```

> [!TIP]
> `any` 是逃生舱不是默认值——它等于关掉类型检查。实在不知道类型先标 `unknown`（用之前必须收窄），或让类型从真实数据、库定义里推断。新项目一律开 `strict: true`，这是回报率最高的一行配置。

存量 JS 项目也不用推倒重来：TypeScript 支持渐进采用，`.js` 与 `.ts` 混用（`allowJs`），从一个文件、一个函数开始加类型，收益立等可取的地方先改——接口边界和公共工具函数最值得。

## ESLint 与 Prettier：各管一摊

两者常被混为一谈，分工其实清晰：

| | ESLint | Prettier |
| --- | --- | --- |
| 管什么 | 代码质量与隐患 | 纯格式排版 |
| 典型规则 | 未使用变量、误用 `==`、未处理的 Promise | 引号、缩进、换行、分号 |
| 类比 | 静态检查的编译警告 | 自动格式化工具 |

```bash
npm install -D eslint prettier
npx eslint src/           # 查代码隐患
npx prettier --write .    # 全项目格式化
```

落地姿势：格式类规则全交给 Prettier（ESLint 里关掉冲突规则），ESLint 专管逻辑隐患；两者都接进编辑器，保存即修复；再配 husky + lint-staged 在 git 提交时自动跑一遍。从此代码评审不再浪费在"逗号放哪"上。

规则的取舍也有原则：能自动修的（格式）交给工具，只把"修不了的"留给评审——命名是否达意、抽象是否合理。团队规范写成配置文件进版本库，而不是写在口口相传的 Wiki 里。

## 组件化目录结构

两种主流分法，团队二选一并贯彻到底：

```bash
# 按类型分：小项目直观，项目大了相关文件散落各处
src/
├── components/    # Button、Modal 等通用组件
├── hooks/         # 自定义 Hook
├── pages/         # 页面
└── utils/

# 按功能分：中大型项目首选，一个功能的改动集中在一个文件夹
src/
├── features/
│   ├── auth/          # 登录相关：组件、hook、api、类型都在这
│   │   ├── components/
│   │   ├── useAuth.ts
│   │   └── api.ts
│   └── articles/
├── components/        # 真正跨功能复用的才放这里
└── lib/
```

判断标准一句话：改一个需求时要动几个文件夹？按功能分的目标是"一个 feature 一个文件夹，互不牵连"。

目录之外的命名同理：组件文件 PascalCase、Hook 用 `use` 前缀、工具函数 camelCase。约定本身不重要，全团队一致才重要——而"一致"只能靠工具（格式化、Lint）保证，不能靠自觉。

## 性能清单

上线前过一遍，多数项目就能及格：

- [ ] 图片：现代格式（WebP/AVIF）、按需尺寸、懒加载 `loading="lazy"`
- [ ] JS 体积：路由级代码分割，首屏只加载首屏需要的 chunk
- [ ] 产物：确认 minify 和 tree-shaking 都在生效，对比 gzip 后的传输体积
- [ ] 缓存：hash 文件名 + 长强缓存，HTML 入口走协商缓存（见[浏览器存储与 HTTP](10-storage-http.md)）
- [ ] 请求：独立接口并行发（`Promise.all`），长列表分页或虚拟滚动
- [ ] 渲染：动画只用 `transform` 和 `opacity`（不触发布局），scroll/input 回调加防抖节流
- [ ] 字体：`font-display: swap`，别让文字被字体文件卡住
- [ ] 度量：用 DevTools Performance 和 Lighthouse 找瓶颈，先测量后优化

> [!WARNING]
> 性能优化的第一原则：不测量就优化等于猜。"感觉慢"和"真的慢"是两回事，Lighthouse 分数也不是 KPI。先用 Performance 面板定位时间花在哪，再决定动哪一刀；优化完必须再测一次，确认真的变快了。

## 从这里去哪

系列至此走完"三件套 → 工具链 → 框架 → 浏览器协作 → 工程化"。下一步的自然路径：用一个真实需求（个人博客、待办应用）从 Vite 脚手架开始完整走一遍；TypeScript 的泛型与高级类型可以缓一缓——先让类型为业务服务，别为类型而类型。

## 练习

- [ ] 给 Vite 项目补上 ESLint + Prettier，故意写一个 `==` 和一个未使用变量，验证能被查出
- [ ] 把一个 JS 组件迁移成 TypeScript，记录哪几处类型报错真的帮你抓住了问题
- [ ] 用 Lighthouse 跑一次自己的页面，挑分数最低的一项优化，前后各测一次

相关阅读：[模块与工具链](08-modules-tooling.md)
