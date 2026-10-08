// The only things the overlay page can ask of Electron: toggle click-through, come forward while a panel is
// open, open the menu, pick a project folder, hear about a character switch or a move to another monitor, and
// receive the list of windows she can stand on.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("companionBridge", {
  setInteractive: (on) => ipcRenderer.send("companion:interactive", Boolean(on)),
  // Bring her window above other apps while a panel is open; back to the desktop layer afterwards.
  setRaised: (on) => ipcRenderer.send("companion:raise", Boolean(on)),
  // She moved to another monitor (a fullscreen game took hers).
  onDisplay: (callback) => ipcRenderer.on("companion:display", () => callback()),
  showMenu: (options) => ipcRenderer.send("companion:menu", options),
  pickFolder: () => ipcRenderer.invoke("companion:pick-folder"),
  onSwitchModel: (callback) => ipcRenderer.on("companion:switch-model", (_event, key) => callback(String(key))),
  // Frames and app names of the other windows on screen, top-most first.
  onWindows: (callback) => ipcRenderer.on("companion:windows", (_event, windows) => callback(Array.isArray(windows) ? windows : [])),
});
