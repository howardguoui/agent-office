import test from "node:test";
import assert from "node:assert/strict";

import { createCompanionLauncher } from "../broker/companion-launcher.js";


test("launches the companion overlay with the plugin's Electron, detached, on the broker's port", () => {
  const calls = [];
  const launcher = createCompanionLauncher({
    projectRoot: "E:/agent-office-plugin",
    port: 4300,
    platform: "win32",
    existsSync: () => true,
    spawnImpl: (...args) => {
      calls.push(args);
      return { on() {}, unref() {} };
    },
  });
  assert.equal(launcher.open(), true);
  assert.match(calls[0][0].replaceAll("\\", "/"), /node_modules\/electron\/dist\/electron\.exe$/);
  assert.match(calls[0][1][0].replaceAll("\\", "/"), /companion\/overlay\/electron-main\.cjs$/);
  assert.equal(calls[0][1][1], "--port=4300");
  assert.equal(calls[0][2].shell, false);
  assert.equal(calls[0][2].detached, true);
  assert.equal(calls[0][2].env.AGENT_OFFICE_PORT, "4300");
});

test("does not spawn when Electron is unavailable", () => {
  const launcher = createCompanionLauncher({
    projectRoot: "E:/agent-office-plugin",
    existsSync: () => false,
    spawnImpl: () => {
      throw new Error("must not spawn");
    },
  });
  assert.equal(launcher.open(), false);
});
