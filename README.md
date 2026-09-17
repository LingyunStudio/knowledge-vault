# Knowledge Vault · 知识库

Typora 式所见即所得的本地知识库：文章在**渲染后的排版上直接编辑**——点击任意位置即获得光标，1.2 秒静止后自动写回 Markdown，全程没有源码视图、没有编辑/阅读模式切换。

基于 **Tauri 2（Rust）+ React 19 + Milkdown/Crepe（ProseMirror）**，内容是带 YAML front matter 的标准 Markdown 文件，可随时用其他编辑器打开。

## 功能

- **永久 WYSIWYG**：阅读态与编辑态是同一个 contenteditable DOM（Crepe 预设，ProseMirror 内核）
- **自动保存**：停止输入 1.2 秒落盘；Ctrl/⌘+S 立即保存；切换文章、关窗自动 flush；写入带 mtime 乐观并发检查
- **GFM alert（callout）**：`> [!NOTE]` 五色提示块，解析/序列化双向保真（自研 Milkdown 节点 + remark 插件）
- **GFM 表格 / 任务列表 / 删除线 / 脚注 / autolink**
- **围栏代码块**：CodeMirror 6 内嵌编辑、143 种语言懒加载、纸感语法主题
- **标题彩带排版**、行内代码、引用块，视觉对齐旧版纸感风格
- 侧栏：板块树（含子分组）、Ctrl+K 全文搜索、字号 A−/A+、深浅主题、拖拽调宽
- **问 AI**：独立原生小窗口，默认置顶（📌 可切换）可关闭、拖到屏幕边缘自动吸附、可拖到应用外、任意方向缩放、位置尺寸自动记忆；回答自动结合主窗口正在阅读的文章；支持流式输出、中途停止、快捷提问；画图模型（gpt-image / 即梦 / Flux 等）自动改走 Images API 并结合文章主题出图，生成结果内嵌展示、单击弹出灯箱（滚轮/按钮缩放、拖拽平移）
- **AI 模型设置**：内置 Agnes 免费模型开箱即用（Key 藏于应用内不展示）；可添加自定义供应商，支持 OpenAI 兼容 / OpenAI Responses / Anthropic 兼容 / Gemini 原生四种接口（模型 id 按协议区分、切换自动跟随）；内置 90 家供应商预设（提取自 [cc-switch](https://github.com/farion1231/cc-switch) 预设库并按供应商去重）；支持从供应商 `/models` 端点一键拉取最新模型列表；请求经 Rust 端代理（SSE 流式转发），失败自动重试并在「系统代理 / 直连」间回退
- **文章源码 / 复制**：文章页一键查看 Markdown 源代码（编辑器状态保留，退出即回）、一键复制全文 Markdown
- **文章图片缩放**：点击图片出现手柄拖拽调整宽度，宽度以 `#w=` 片段形式持久化在 Markdown 里
- **内容创建**：主页板块卡片末尾虚线框新建板块；侧栏展开板块后可一键新建文章（防重名自动加序号，创建后自动打开编辑）
- **右键管理**：侧栏文章右键菜单支持重命名（改 front matter title）与删除（二次确认，打开中的文章删除后自动回主页）
- 封面：刊头、最近文章头条、板块卡片（SVG/PNG logo + brand 色兜底）
- 板块目录页、文章页 TOC scrollspy、上/下一篇、阅读进度线
- 文件监听：外部改动自动重载；编辑中冲突时弹条让用户选择「用磁盘版 / 保留我的」

## 目录结构

```
knowledge/                17 个板块、178 篇 Markdown（YAML front matter）
src-tauri/                Tauri 后端
  src/library.rs          目录扫描 / front matter 解析 / 路径安全 / 写盘（移植自旧 egui 版）
  src/root.rs             knowledge 目录定位与首运行资源拷贝
  src/watcher.rs          notify-debouncer 文件监听（失败回退轮询）
  src/commands.rs         Tauri 命令
frontend/                 React 前端
  src/editor/             Crepe 工厂、callout 节点/remark 插件、CodeMirror 主题
  src/components/         shell（侧栏）、pages（封面/板块/搜索/文章）、article、ai（问 AI 面板/设置）
  src/store/              zustand：导航 / 知识库 / 设置 / AI 模型（localStorage 持久化）
  src/lib/                IPC、front matter 按行改写、搜索打分、保存协调器、AI 客户端与预设
  scripts/                extract-presets.py（从 cc-switch 提取预设）、cdp-eval.mjs（WebView2 调试）
```

## 开发

前置：Rust 1.9+、Node 22+、pnpm、WebView2（Win11 自带）。

```bash
pnpm install
# 从仓库根目录启动（CLI 需识别 src-tauri/tauri.conf.json）
./frontend/node_modules/.bin/tauri dev
# 或
cd frontend && pnpm tauri dev   # 需保证从能发现 src-tauri 的目录运行
```

dev 构建下应用直接读写仓库内 `knowledge/`（见 `root.rs` 的 `dev-source` 分支）；
打包安装后首次运行把内置知识库拷贝到 `%LOCALAPPDATA%/com.local.knowledge-vault/knowledge`。

可用 `KNOWLEDGE_VAULT_ROOT` 环境变量覆盖知识库目录。

## 打包

```bash
./frontend/node_modules/.bin/tauri build
```

产物：`src-tauri/target/release/knowledge-vault.exe` 与 `src-tauri/target/release/bundle/nsis/*.exe` 安装包。

## 说明：首次保存的排版规范化

保存走 Milkdown 的 remark-stringify，会做一次**无语义变化**的规范化（表格列对齐补空格、
列表缩进、保守的标点反斜杠转义等，渲染结果完全一致）。首次编辑某篇后建议一次性提交该文件，
之后 diff 就是干净的实际改动。所有文章已通过全库往返审计：alert、代码块、front matter 零丢失。
