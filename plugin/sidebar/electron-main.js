import { app, BrowserWindow, screen } from 'electron';

const PORT = process.env.AGENT_OFFICE_PORT || 4242;

app.whenReady().then(() => {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: 340,
    height: sh,
    x: sw - 340,
    y: 0,
    frame: false,
    transparent: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    title: 'Agent Office',
    backgroundColor: '#05050a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Wait for server to be ready then load
  function tryLoad(attempts = 0) {
    if (attempts > 20) {
      win.loadURL(`data:text/html,<body style="background:#05050a;color:#818cf8;font-family:monospace;padding:20px"><h2>⬡ Agent Office</h2><p>Server not found on port ${PORT}</p></body>`);
      return;
    }
    import('http').then(({ default: http }) => {
      http.get(`http://localhost:${PORT}`, (res) => {
        if (res.statusCode === 200) {
          win.loadURL(`http://localhost:${PORT}`);
        } else {
          setTimeout(() => tryLoad(attempts + 1), 500);
        }
      }).on('error', () => setTimeout(() => tryLoad(attempts + 1), 500));
    });
  }

  tryLoad();

  win.on('closed', () => app.quit());
});

app.on('window-all-closed', () => app.quit());
