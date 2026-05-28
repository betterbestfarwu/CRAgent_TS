import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";

async function bootstrap() {
  const rootEl = document.getElementById("root");
  if (!rootEl) {
    throw new Error("root element not found");
  }

  if (!window.cragent) {
    const { installWebBridge } = await import("./cragentWebBridge.js");
    installWebBridge();
  }

  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
