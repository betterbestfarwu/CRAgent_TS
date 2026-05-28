import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("root element not found");
}

if (!window.cragent) {
  rootEl.innerHTML =
    '<div style="padding:24px;font-family:system-ui;color:#1a1a1a;background:#ffffff">' +
    "<h2>CRAgent 未能连接主进程</h2>" +
    "<p>preload 未加载。请完全退出后重新运行 <code>npm run dev</code>。</p>" +
    "</div>";
} else {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
