import test from "node:test";
import assert from "node:assert/strict";

import { createCompanionLauncher, createSidebarLauncher } from "../broker/sidebar-launcher.js";


test("launches the real Windows Electron binary without a shell or PID lock", () => {
  const calls = [];
  const launcher = createSidebarLauncher({
    projectRoot: "E:/agent-office-plugin",
    platform: "win32",
    existsSync: () => true,
    spawnImpl: (...args) => {
      calls.push(args);
      return { on() {}, unref() {} };
    },
  });

  assert.equal(launcher.open(), true);
  assert.equal(calls.length, 1);
  assert.match(
    calls[0][0].replaceAll("\\", "/"),
    /node_modules\/electron\/dist\/electron\.exe$/,
  );
  assert.equal(calls[0][2].shell, false);
  assert.equal(calls[0][2].detached, true);
});

test("launches the companion overlay on the broker's port", () => {
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
  assert.match(calls[0][1][0].replaceAll("\\", "/"), /companion\/overlay\/electron-main\.cjs$/);
  assert.equal(calls[0][1][1], "--port=4300");
  assert.equal(calls[0][2].env.AGENT_OFFICE_PORT, "4300");
});

test("does not spawn when Electron is unavailable", () => {
  const launcher = createSidebarLauncher({
    projectRoot: "E:/agent-office-plugin",
    existsSync: () => false,
    spawnImpl: () => {
      throw new Error("must not spawn");
    },
  });
  assert.equal(launcher.open(), false);
});

