import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar } from "../src/components/shell/Sidebar";
import { initializeAppearance } from "../src/lib/appearance";
import "../src/styles/tokens.css";
import "../src/styles/app.css";
import "../src/styles/ai.css";
import "../src/styles/settings.css";

initializeAppearance();
createRoot(document.getElementById("root")!).render(createElement(Sidebar));
