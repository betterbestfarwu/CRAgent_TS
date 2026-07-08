import React from "react";
import { createRoot } from "react-dom/client";
import { initChatFontScale } from "@shared/chatFontScale.js";
import { initColorScheme } from "@shared/colorScheme.js";
import { App } from "./App.jsx";
import "./styles.css";

async function bootstrap() {
  initColorScheme();
  initChatFontScale();
  const rootEl = document.getElementById("root");
  if (!rootEl) {
    throw new Error("root element not found");
  }

  if (!window.cragent) {
    const { installWebBridge } = await import("./cragentWebBridge.js");
    installWebBridge();
  }

  const Root = window.cragent?.isDesktop ? React.Fragment : React.StrictMode;

  createRoot(rootEl).render(
    <Root>
      <App />
    </Root>,
  );
}

void bootstrap();
