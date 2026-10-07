// The only things the overlay page can ask of Electron: toggle click-through, open the menu,
// hear about a character switch, and receive the list of windows she can stand on.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("companionBridge", {
  setInteractive: (on) => ipcRenderer.send("companion:interactive", Boolean(on)),
  showMenu: (options) => ipcRenderer.send("companion:menu", options),
  onSwitchModel: (callback) => ipcRenderer.on("companion:switch-model", (_event, key) => callback(String(key))),
  // Frames and app names of the other windows on screen, top-most first.
  onWindows: (callback) => ipcRenderer.on("companion:windows", (_event, windows) => callback(Array.isArray(windows) ? windows : [])),
});
