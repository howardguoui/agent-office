import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { toOverlay, fullscreenInFront, SCRIPT } = require("../companion/overlay/desktop-windows.cjs");

test("converts physical window frames to work-area CSS pixels and drops our own window", () => {
  const geometry = { workArea: { x: 0, y: 0, width: 2560, height: 1392 }, scaleFactor: 1.25, ownPid: 99 };
  const out = toOverlay([
    { id: 1, pid: 10, app: "chrome", x: 500, y: 250, w: 1000, h: 800, minimized: false, foreground: true },
    { id: 2, pid: 99, app: "electron", x: 0, y: 0, w: 3200, h: 1740 },
    { id: 3, pid: 11, app: "code", x: 9000, y: 100, w: 500, h: 500 }, // on another monitor
  ], geometry);
  assert.deepEqual(out, [{ id: 1, pid: 10, app: "chrome", x: 400, y: 200, w: 800, h: 640, minimized: false, foreground: true }]);
});

test("the window lister reads frames and process names, never window titles", () => {
  assert.doesNotMatch(SCRIPT, /GetWindowText\(/);
  assert.match(SCRIPT, /GetWindowTextLength/); // only to skip untitled helper windows
  assert.match(SCRIPT, /DwmGetWindowAttribute\(h, 9/);
});

test("detects a fullscreen app in front (game mode), not a maximized window", () => {
  const geometry = { displayBounds: { x: 0, y: 0, width: 2048, height: 1152 }, scaleFactor: 1.25, ownPid: 99 };
  const game = { id: 1, pid: 5, app: "VALORANT-Win64-Shipping", x: 0, y: 0, w: 2560, h: 1440, foreground: true };
  const maximized = { id: 2, pid: 6, app: "chrome", x: 0, y: 0, w: 2560, h: 1392, foreground: true };
  assert.equal(fullscreenInFront([game], geometry), true);
  assert.equal(fullscreenInFront([maximized], geometry), false);
  assert.equal(fullscreenInFront([{ ...game, foreground: false }, maximized], geometry), false);
  assert.equal(fullscreenInFront([{ ...game, pid: 99 }], geometry), false);
});
