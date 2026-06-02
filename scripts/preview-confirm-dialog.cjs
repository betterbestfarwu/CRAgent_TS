/**
 * Visual + layout check for ConfirmDialog scroll cap (10 lines).
 * Usage: env -u ELECTRON_RUN_AS_NODE electron scripts/preview-confirm-dialog.cjs
 */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");

const htmlPath = path.join(__dirname, "preview-confirm-dialog.html");

function measure(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const body = document.querySelector(".confirm-dialog-body");
      const actions = document.querySelector(".confirm-dialog-actions");
      const dialog = document.querySelector(".confirm-dialog");
      const overlay = document.querySelector(".confirm-overlay");
      const bodyStyle = getComputedStyle(body);
      const actionsRect = actions.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      return {
        bodyScrollHeight: body.scrollHeight,
        bodyClientHeight: body.clientHeight,
        bodyHasVerticalScroll: body.scrollHeight > body.clientHeight + 1,
        maxHeight: bodyStyle.maxHeight,
        lineHeight: bodyStyle.lineHeight,
        dialogHeight: dialog.getBoundingClientRect().height,
        overlayHeight: overlayRect.height,
        actionsVisibleInOverlay:
          actionsRect.top >= overlayRect.top &&
          actionsRect.bottom <= overlayRect.bottom + 1,
      };
    })()
  `);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 420,
    height: 520,
    title: "Confirm dialog preview",
    show: true,
  });

  await win.loadFile(htmlPath);
  await win.webContents.executeJavaScript(
    "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
  );

  const metrics = await measure(win);

  console.log("Confirm dialog layout metrics:");
  console.log(JSON.stringify(metrics, null, 2));

  const ok =
    metrics.bodyHasVerticalScroll &&
    metrics.actionsVisibleInOverlay &&
    metrics.bodyClientHeight > 0;

  if (!ok) {
    console.error("Preview check FAILED — scroll or button visibility issue.");
    app.exit(1);
    return;
  }

  console.log("Preview check PASSED — body scrolls, action buttons stay in view.");
  if (process.env.CONFIRM_PREVIEW_AUTO_CLOSE === "1") {
    app.quit();
    return;
  }
  console.log("Close the preview window to exit.");
});

app.on("window-all-closed", () => {
  app.quit();
});
