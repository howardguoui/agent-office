import { app, BrowserWindow, screen } from "electron";
import http from "node:http";
import path from "node:path";


const port = Number.parseInt(process.env.AGENT_OFFICE_PORT || "4242", 10);
const width = Number.parseInt(process.env.AGENT_OFFICE_WIDTH || "340", 10);
const baseUrl = `http://127.0.0.1:${port}`;
let mainWindow;

app.setName("Agent Office");
app.setPath("userData", path.join(app.getPath("appData"), "AgentOffice"));

function focusWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", focusWindow);
  app.whenReady().then(() => {
    const { width: screenWidth, height: screenHeight } =
      screen.getPrimaryDisplay().workAreaSize;
    mainWindow = new BrowserWindow({
      width,
      height: screenHeight,
      x: screenWidth - width,
      y: 0,
      frame: false,
      transparent: false,
      alwaysOnTop: false,
      skipTaskbar: false,
      resizable: true,
      title: "Agent Office",
      backgroundColor: "#05050a",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    function tryLoad(attempt = 0) {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (attempt > 40) {
        const message = encodeURIComponent(
          `<body style="background:#05050a;color:#818cf8;font-family:monospace;padding:20px"><h2>Agent Office</h2><p>Broker not found on port ${port}</p></body>`,
        );
        mainWindow.loadURL(`data:text/html,${message}`);
        return;
      }
      const request = http.get(`${baseUrl}/health`, (response) => {
        response.resume();
        if (response.statusCode === 200) mainWindow.loadURL(baseUrl);
        else setTimeout(() => tryLoad(attempt + 1), 250);
      });
      request.setTimeout(250, () => request.destroy());
      request.on("error", () => setTimeout(() => tryLoad(attempt + 1), 250));
    }

    tryLoad();
    focusWindow();
    mainWindow.on("closed", () => {
      mainWindow = undefined;
      app.quit();
    });
  });
}

app.on("window-all-closed", () => app.quit());
