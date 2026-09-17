import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AskAIWindow } from "./components/ai/AskAIWindow";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/editor.css";
import "./styles/ai.css";
import "./styles/settings.css";
import { initializeAppearance } from "./lib/appearance";

const disposeAppearance = initializeAppearance();
if (import.meta.hot) import.meta.hot.dispose(disposeAppearance);

// 独立的「问 AI」窗口与主窗口共用同一份前端，按 URL 参数区分渲染
const isAskAIWindow =
  new URLSearchParams(window.location.search).get("window") === "ask-ai";

createRoot(document.getElementById("root")!).render(
  isAskAIWindow ? <AskAIWindow /> : <App />,
);

// 兜底：拖图片到编辑器外（侧栏等）时，别让 webview 导航打开图片文件
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());
