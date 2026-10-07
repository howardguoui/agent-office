// Desktop companion window: a transparent layer over the whole work area of the main screen, always on top
// and click-through except over the character, her bubble and the chat box. She walks on the taskbar and on
// top of other windows, which a small watcher lists (frames and app names only).
const { app, BrowserWindow, Menu, ipcMain, screen } = require("electron");
const path = require("node:path");
const http = require("node:http");
const { createWindowWatcher } = require("./desktop-windows.cjs");

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const PORT = Number(portArg ? portArg.slice("--port=".length) : process.env.AGENT_OFFICE_PORT || 4242);
const URL = `http://127.0.0.1:${PORT}/companion/overlay`;

if (!app.requestSingleInstanceLock()) app.quit();

function brokerReady() {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${PORT}/health`, (res) => { res.resume(); resolve(res.statusCode === 200); })
      .on("error", () => resolve(false));
  });
}

async function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const win = new BrowserWindow({
    ...workArea,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    title: "Agent Office Companion",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, "floating");
  win.setIgnoreMouseEvents(true, { forward: true });
  // Forwarded mouse events stop after a navigation or reload unless this is applied again.
  win.webContents.on("did-finish-load", () => win.setIgnoreMouseEvents(true, { forward: true }));

  ipcMain.on("companion:interactive", (_event, on) => {
    win.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.on("companion:menu", (_event, { models = [], current } = {}) => {
    const menu = Menu.buildFromTemplate([
      ...models.map((key) => ({
        label: `Character: ${key[0].toUpperCase()}${key.slice(1)}`,
        type: "radio",
        checked: key === current,
        click: () => win.webContents.send("companion:switch-model", key),
      })),
      { type: "separator" },
      { label: "Hide for 30 minutes", click: () => { win.hide(); setTimeout(() => win.showInactive(), 30 * 60_000); } },
      { label: "Quit companion", click: () => app.quit() },
    ]);
    menu.popup({ window: win });
  });

  // The broker may start after the window (or restart); keep trying instead of giving up.
  for (;;) {
    if (await brokerReady()) {
      try {
        await win.loadURL(URL);
        break;
      } catch {
        // fall through and retry
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const watcher = createWindowWatcher({
    getGeometry: () => {
      const primary = screen.getPrimaryDisplay();
      return { workArea: primary.workArea, scaleFactor: primary.scaleFactor };
    },
    onWindows: (windows) => {
      if (!win.isDestroyed()) win.webContents.send("companion:windows", windows);
    },
  });
  win.on("closed", () => watcher.stop());
  screen.on("display-metrics-changed", () => {
    if (!win.isDestroyed()) win.setBounds(screen.getPrimaryDisplay().workArea);
  });
  return win;
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
