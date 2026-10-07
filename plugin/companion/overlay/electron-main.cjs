// Desktop companion window: transparent, frameless, always on top, click-through except over the
// character, her bubble and the chat box. Loads the overlay page from the local broker.
const { app, BrowserWindow, Menu, ipcMain, screen } = require("electron");
const path = require("node:path");
const http = require("node:http");

const PORT = Number(process.env.AGENT_OFFICE_PORT || 4242);
const URL = `http://127.0.0.1:${PORT}/companion/overlay`;
const SIZE = { width: 360, height: 560 };

if (!app.requestSingleInstanceLock()) app.quit();

function brokerReady() {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${PORT}/health`, (res) => { res.resume(); resolve(res.statusCode === 200); })
      .on("error", () => resolve(false));
  });
}

async function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    ...SIZE,
    x: workArea.x + workArea.width - SIZE.width - 24,
    y: workArea.y + workArea.height - SIZE.height,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
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

  for (let attempt = 0; attempt < 60 && !(await brokerReady()); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await win.loadURL(URL);
  return win;
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
