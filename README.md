# Knowledge Vault · 知识库

Typora 式所见即所得的本地知识库：文章在**渲染后的排版上直接编辑**——点击任意位置即获得光标，1.2 秒静止后自动写回 Markdown，全程没有源码视图、没有编辑/阅读模式切换。

基于 **Tauri 2（Rust）+ React 19 + Milkdown/Crepe（ProseMirror）**，内容是带 YAML front matter 的标准 Markdown 文件，可随时用其他编辑器打开。

## 功能

- **永久 WYSIWYG**：阅读态与编辑态是同一个 contenteditable DOM（Crepe 预设，ProseMirror 内核）
- **持久化保存**：自动保存走「临时文件 + 原子替换」，写入前旧版本自动留档；每次保存携带内容修订号（mtime+长度+内容哈希），外部改动一律报冲突而非覆盖；保存失败时禁止切换文章/关闭窗口，内容留在页面上可重试或复制备份
- **可恢复删除 / 历史版本**：删除进隐藏回收站（`.kv/trash`，可恢复、不覆盖现有文件）；每次修改前的版本保存在 `.kv/history`，可预览并一键恢复
- **学习工作台**：首页「我的学习」汇总继续阅读、收藏、到期复习卡与回收站；文章页可收藏、标记学习状态（未学/学习中/待复习/已掌握）、制作复习卡（间隔重复）；阅读位置自动记忆，重开文章接着上次读
- **文章整理**：编辑标题/摘要/标签/排序元信息；在板块/分组间移动文章（图片相对路径自动改写；有入链或无法安全改写的引用时保守拒绝，绝不静默改写其他文章）
- **文章关联**：只读链接索引展示「引用本文 / 本文引用」，失效链接标红；AI 问答回答中的来源可点击跳转
- **搜索**：全文+标签+标题多关键词检索，板块/标签筛选，准确总数与分页；标签独立命中不再被漏掉
- **GFM alert（callout）**：`> [!NOTE]` 五色提示块，解析/序列化双向保真（自研 Milkdown 节点 + remark 插件）
- **GFM 表格 / 任务列表 / 删除线 / 脚注 / autolink**
- **围栏代码块**：CodeMirror 6 内嵌编辑、143 种语言懒加载、纸感语法主题
- **标题彩带排版**、行内代码、引用块，视觉对齐旧版纸感风格
- 侧栏：板块树（含子分组，空板块不隐藏）、Ctrl+K 全文搜索、字号 A−/A+、深浅主题、拖拽调宽
- **问 AI**：独立原生小窗口，默认置顶（📌 可切换）可关闭、拖到屏幕边缘自动吸附、可拖到应用外、任意方向缩放、位置尺寸自动记忆；回答可结合当前文章或**本地关键词检索的资料库来源**（发送前可预览模型/范围/来源，拒绝编造依据，回答中的来源编号可点击跳转）；会话按知识库+文章持久化（图片数据不落盘，配额失败明确提示）；**一键保存为笔记**（带来源相对链接，写入前校验资料库与只读状态）；画图模型自动改走 Images API 并结合文章主题出图，生成结果内嵌展示、单击弹出灯箱（滚轮/按钮缩放、拖拽平移）
- **AI 模型设置**：内置 Agnes 免费模型开箱即用（Key 藏于应用内不展示）；可添加自定义供应商，支持 OpenAI 兼容 / OpenAI Responses / Anthropic 兼容 / Gemini 原生四种接口（模型 id 按协议区分、切换自动跟随）；内置 90 家供应商预设（提取自 [cc-switch](https://github.com/farion1231/cc-switch) 预设库并按供应商去重）；支持从供应商 `/models` 端点一键拉取最新模型列表；请求经 Rust 端代理（SSE 流式转发），失败自动重试并在「系统代理 / 直连」间回退
- **文章源码 / 复制**：文章页一键查看 Markdown 源代码（编辑器状态保留，退出即回）、一键复制全文 Markdown
- **文章图片缩放**：点击图片出现手柄拖拽调整宽度，宽度以 `#w=` 片段形式持久化在 Markdown 里
- **内容创建**：主页板块卡片末尾虚线框新建板块；侧栏展开板块后可一键新建文章（防重名自动加序号，创建后自动打开编辑）；空板块页内也有新建入口
- **右键管理**：侧栏文章右键菜单支持重命名（改 front matter title）与删除（二次确认，删除进回收站可恢复；打开中的文章删除后自动回主页）
- 封面：刊头、最近文章头条、板块卡片（SVG/PNG logo + brand 色兜底）
- 板块目录页、文章页 TOC scrollspy、上/下一篇、阅读进度线
- 文件监听：外部改动自动重载；编辑中冲突时弹条让用户选择「用磁盘版 / 保留我的」（保留我的也先留档再覆盖）

## 目录结构

```
knowledge/                17 个板块、195+ 篇 Markdown（YAML front matter）
src-tauri/                Tauri 后端
  src/library.rs          目录扫描 / front matter 解析 / 搜索纯文本（移植自旧 egui 版）
  src/safe_path.rs        统一路径安全：拒绝符号链接/联接、Windows 保留名、越界
  src/vault.rs            原子保存（ReplaceFileW）/ 冲突检查 / 回收站 / 历史版本 / 元数据 / 安全移动
  src/kvstore.rs          .kv 回收站与历史条目（隐藏目录内原子写入的 JSON）
  src/links.rs            有界 Markdown 链接解析：只读索引、移动时出链 rebase、不支持语法拒绝
  src/root.rs             knowledge 目录定位与首运行资源拷贝
  src/watcher.rs          notify-debouncer 文件监听（失败回退轮询）
  src/commands.rs         Tauri 命令（全部写操作经 library_io 串行化）
  src/ai.rs               AI 代理：四类协议 SSE 流式 + Images API
frontend/                 React 前端
  src/editor/             Crepe 工厂、callout 节点/remark 插件、CodeMirror 主题
  src/components/         shell（侧栏）、pages（封面/学习台/板块/搜索/文章）、article（工作台）、ai（问 AI 窗口/设置）
  src/store/              zustand：导航（带历史栈与保存失败保护）/ 知识库 / 设置 / AI / 学习记录（按知识库隔离，localStorage）
  src/lib/                IPC、保存队列与协调器、搜索打分、AI 客户端/会话/来源检索、vault 客户端
  scripts/                node:test 回归（38 项）：保存/导航保护、搜索、AI 学习、设置、图片、工作台
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

## 测试

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib          # Rust：原子保存/冲突/回收站/历史/移动/链接
pnpm --dir frontend exec node --test scripts/*.test.mjs        # 前端：38 项（保存保护/搜索/学习/AI/设置/图片）
pnpm --dir frontend build                                      # tsc --noEmit + vite build
```

## 已知限制

- **文章移动**：有其他文章引用目标文章（入链）或文中含引用式/wiki/HTML 链接等无法安全改写的语法时，移动会被拒绝并提示先处理，不做跨文章批量改写（避免非原子操作损坏数据）；恢复回收站仅支持原路径。
- **AI 学习记录**：会话按「知识库+文章」保存在浏览器 localStorage（最多 24 会话 × 24 条消息，图片数据不保存）；配额满时明确提示未持久化。API Key 仍存于 localStorage（沿用现有设计），建议后续迁移到系统凭据存储。
- **AI 会话中的来源**基于本地关键词检索（无向量索引），长文只取命中片段；回答请以文内「来源」链接为准。

## 打包

```bash
./frontend/node_modules/.bin/tauri build
```

产物：`src-tauri/target/release/knowledge-vault.exe` 与 `src-tauri/target/release/bundle/nsis/*.exe` 安装包。

## 说明：首次保存的排版规范化

保存走 Milkdown 的 remark-stringify，会做一次**无语义变化**的规范化（表格列对齐补空格、
列表缩进、保守的标点反斜杠转义等，渲染结果完全一致）。首次编辑某篇后建议一次性提交该文件，
之后 diff 就是干净的实际改动。所有文章已通过全库往返审计：alert、代码块、front matter 零丢失。
