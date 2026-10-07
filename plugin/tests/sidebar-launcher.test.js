import test from "node:test";
import assert from "node:assert/strict";

import { createSidebarLauncher } from "../broker/sidebar-launcher.js";


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

