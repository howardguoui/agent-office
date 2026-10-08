// Desktop companion window: a transparent, click-through layer over the work area of one screen. It sits on
// the desktop layer, under every app window, and only comes forward while Howard is talking to her or an agent
// is waiting for his approval. She walks along the bottom of the screen and on top of windows, which a small
// watcher lists (frames and app names only). When a fullscreen game or video takes her screen she moves to
// another monitor and comes back afterwards; if every screen is busy she hides until one is free.
const { app, BrowserWindow, Menu, dialog, ipcMain, screen } = require("electron");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { createWindowWatcher, busyDisplays, pickHost } = require("./desktop-windows.cjs");

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

let hiddenByUser = false;

// Started from the desktop shortcut (--start-broker): run the broker ourselves, without a console window. It
// watches our process id and exits when the companion quits. System Node runs it (AGENT_OFFICE_NODE overrides).
let brokerStarted = false;
function startBroker() {
  if (brokerStarted || !process.argv.includes("--start-broker")) return;
  brokerStarted = true;
  const script = path.join(__dirname, "..", "..", "broker", "index.js");
  const child = spawn(process.env.AGENT_OFFICE_NODE || "node", [script], {
    cwd: path.join(__dirname, "..", ".."),
    detached: true,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, AGENT_OFFICE_PORT: String(PORT), COMPANION_WINDOW: "off", AGENT_OFFICE_PARENT_PID: String(process.pid) },
  });
  child.on("error", () => { brokerStarted = false; });
  child.unref();
}

/** The native handle as a decimal string, for the window lister's "bottom" command. */
function handleOf(win) {
  const buffer = win.getNativeWindowHandle();
  return buffer.length >= 8 ? buffer.readBigUInt64LE(0).toString() : String(buffer.readUInt32LE(0));
}

async function createWindow() {
  let hostId = screen.getPrimaryDisplay().id;
  const host = () => screen.getAllDisplays().find((d) => d.id === hostId) || screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    ...host().workArea,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: false,
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
  win.setIgnoreMouseEvents(true, { forward: true });
  let raised = false; // true while a chat, card or settings panel is open
  let watcher = null;
  const sendToBack = () => { if (!raised && !win.isDestroyed()) watcher?.bottom(handleOf(win)); };
  ipcMain.on("companion:raise", (_event, on) => {
    raised = Boolean(on);
    if (win.isDestroyed()) return;
    if (raised) { win.setAlwaysOnTop(true, "floating"); win.moveTop(); }
    else { win.setAlwaysOnTop(false); sendToBack(); }
  });
  win.on("blur", sendToBack);
  // Forwarded mouse events stop after a navigation or reload unless this is applied again.
  win.webContents.on("did-finish-load", () => win.setIgnoreMouseEvents(true, { forward: true }));

  ipcMain.on("companion:interactive", (_event, on) => {
    win.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.handle("companion:pick-folder", async () => {
    const result = await dialog.showOpenDialog(win, { title: "Project folder for the agent", properties: ["openDirectory"] });
    return result.canceled ? "" : result.filePaths[0] || "";
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
      { label: "Hide for 30 minutes", click: () => { hiddenByUser = true; win.hide(); setTimeout(() => { hiddenByUser = false; win.showInactive(); }, 30 * 60_000); } },
      { label: "Quit companion", click: () => app.quit() },
    ]);
    menu.popup({ window: win });
  });

  // The broker may start after the window (or restart); keep trying instead of giving up.
  for (;;) {
    if (!(await brokerReady())) startBroker();
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
  const moveTo = (id) => {
    hostId = id;
    win.setBounds(host().workArea);
    win.webContents.send("companion:display", { id });
  };
  watcher = createWindowWatcher({
    getGeometry: () => {
      const display = host();
      return { workArea: display.workArea, displayBounds: display.bounds, scaleFactor: display.scaleFactor };
    },
    // Game mode: a fullscreen game or video on her screen sends her to another monitor, or hides her if
    // every screen is busy. She comes back to the main screen once the game ends.
    onList: (raw) => {
      if (win.isDestroyed() || hiddenByUser) return;
      const displays = screen.getAllDisplays();
      const next = pickHost(displays, busyDisplays(raw, displays, { ownPid: process.pid }), hostId, screen.getPrimaryDisplay().id);
      if (next === null) { if (win.isVisible()) win.hide(); return; }
      if (next !== hostId) moveTo(next);
      if (!win.isVisible()) win.showInactive();
      sendToBack();
    },
    onWindows: (windows) => {
      if (!win.isDestroyed()) win.webContents.send("companion:windows", windows);
    },
  });
  win.on("closed", () => watcher.stop());
  const refit = () => {
    if (win.isDestroyed()) return;
    if (!screen.getAllDisplays().some((d) => d.id === hostId)) moveTo(screen.getPrimaryDisplay().id);
    else win.setBounds(host().workArea);
  };
  screen.on("display-metrics-changed", refit);
  screen.on("display-removed", refit);
  sendToBack();
  return win;
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
