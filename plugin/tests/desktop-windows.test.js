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

test("detects a fullscreen app on top (game mode), not a maximized window", () => {
  const geometry = { displayBounds: { x: 0, y: 0, width: 2048, height: 1152 }, scaleFactor: 1.25, ownPid: 99 };
  const game = { id: 1, pid: 5, app: "VALORANT-Win64-Shipping", x: 0, y: 0, w: 2560, h: 1440, foreground: true };
  const maximized = { id: 2, pid: 6, app: "chrome", x: 0, y: 0, w: 2560, h: 1392, foreground: true };
  assert.equal(fullscreenInFront([game], geometry), true);
  assert.equal(fullscreenInFront([maximized], geometry), false);
  assert.equal(fullscreenInFront([{ ...game, foreground: false }, maximized], geometry), true); // z-order, not focus
  assert.equal(fullscreenInFront([maximized, game], geometry), false);
  assert.equal(fullscreenInFront([{ ...game, pid: 99 }], geometry), false);
});

const { busyDisplays, pickHost } = require("../companion/overlay/desktop-windows.cjs");
const LEFT = { id: 1, bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1 };
const RIGHT = { id: 2, bounds: { x: 2560, y: 0, width: 2560, height: 1440 }, scaleFactor: 1 };
const game = { id: 10, pid: 5, app: "StreetFighter6", x: 0, y: 0, w: 2560, h: 1440, minimized: false, foreground: false };
const chrome = { id: 11, pid: 6, app: "chrome", x: 2560, y: 0, w: 2560, h: 1392, minimized: false, foreground: true };
const wallpaper = { id: 12, pid: 7, app: "explorer", x: 0, y: 0, w: 5120, h: 1440, minimized: false, foreground: false };

test("a fullscreen game on the top of the z-order makes its monitor busy, even when another window has focus", () => {
  assert.deepEqual([...busyDisplays([chrome, game, wallpaper], [LEFT, RIGHT], { ownPid: 99 })], [1]);
  // A maximized window is not fullscreen, and the wallpaper never counts.
  assert.deepEqual([...busyDisplays([chrome, wallpaper], [LEFT, RIGHT], { ownPid: 99 })], []);
  // A window in front of the game means the game is not what he is looking at on that screen.
  const editor = { id: 13, pid: 8, app: "code", x: 100, y: 100, w: 900, h: 700, minimized: false };
  assert.deepEqual([...busyDisplays([editor, game], [LEFT, RIGHT], { ownPid: 99 })], []);
  // Her own window is ignored.
  assert.deepEqual([...busyDisplays([{ ...game, pid: 99 }], [LEFT], { ownPid: 99 })], []);
});

test("she moves to a free monitor when hers gets a game, stays put afterwards, and hides when every screen is busy", () => {
  const displays = [LEFT, RIGHT];
  assert.equal(pickHost(displays, new Set(), 1, 1), 1);
  assert.equal(pickHost(displays, new Set([1]), 1, 1), 2);
  assert.equal(pickHost(displays, new Set(), 2, 1), 2); // game over: no jumping back
  assert.equal(pickHost(displays, new Set([2]), 2, 1), 1);
  assert.equal(pickHost(displays, new Set([1, 2]), 1, 1), null);
  assert.equal(pickHost([LEFT], new Set(), 2, 1), 1); // her monitor was unplugged
});

test("the window lister can send her window to the desktop layer without activating it", () => {
  assert.match(SCRIPT, /SetWindowPos\(new IntPtr\(h\), new IntPtr\(1\), 0, 0, 0, 0, 0x0013\)/);
  assert.match(SCRIPT, /StartsWith\('bottom '\)/);
});
