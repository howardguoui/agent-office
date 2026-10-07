import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";


const ELECTRON_MAIN_PATH = new URL("../sidebar/electron-main.js", import.meta.url);

function readElectronMain() {
  return readFile(ELECTRON_MAIN_PATH, "utf8");
}


test("Electron uses an Agent Office-specific profile before taking its lock", async () => {
  const source = await readElectronMain();
  const profileIndex = source.indexOf('app.setPath("userData"');
  const lockIndex = source.indexOf("app.requestSingleInstanceLock()");
  assert.ok(profileIndex >= 0, "Agent Office userData profile is missing");
  assert.ok(profileIndex < lockIndex, "Profile must be set before the instance lock");
});

test("Electron explicitly focuses its first window", async () => {
  const source = await readElectronMain();
  const createIndex = source.indexOf("mainWindow = new BrowserWindow");
  const closeIndex = source.indexOf('mainWindow.on("closed"', createIndex);
  const firstWindowSetup = source.slice(createIndex, closeIndex);

  assert.match(firstWindowSetup, /focusWindow\(\);/);
});
