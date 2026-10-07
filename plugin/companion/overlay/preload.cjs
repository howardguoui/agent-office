// The only things the overlay page can ask of Electron: toggle click-through, open the menu,
// and hear about a character switch.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("companionBridge", {
  setInteractive: (on) => ipcRenderer.send("companion:interactive", Boolean(on)),
  showMenu: (options) => ipcRenderer.send("companion:menu", options),
  onSwitchModel: (callback) => ipcRenderer.on("companion:switch-model", (_event, key) => callback(String(key))),
});
