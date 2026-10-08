// Lists visible top-level windows on Windows (top-most first) so the companion can stand on them.
// One long-lived PowerShell process answers "list" requests; it reports each window's visible frame,
// its app (process name), and which one is in front. Window titles and contents are never read out.
const { spawn } = require("node:child_process");

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class CompanionWindows {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int index);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT value, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int value, int size);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  public static void Init() { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
  // Desktop layer: put the companion's window under every other app window (HWND_BOTTOM), without moving,
  // resizing or activating it. Explorer keeps the wallpaper below it, so she stays visible on the desktop.
  public static void Bottom(long h) { SetWindowPos(new IntPtr(h), new IntPtr(1), 0, 0, 0, 0, 0x0013); }
  public static List<long[]> List() {
    var result = new List<long[]>();
    IntPtr fg = GetForegroundWindow();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || GetWindowTextLength(h) == 0) return true;
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true;           // WS_EX_TOOLWINDOW
      int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4);       // DWMWA_CLOAKED
      if (cloaked != 0) return true;
      RECT r; if (DwmGetWindowAttribute(h, 9, out r, 16) != 0) return true; // extended frame bounds
      uint pid; GetWindowThreadProcessId(h, out pid);
      result.Add(new long[] { h.ToInt64(), pid, r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top, IsIconic(h) ? 1 : 0, h == fg ? 1 : 0 });
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
"@
[CompanionWindows]::Init()
$names = @{}
while (($line = [Console]::In.ReadLine()) -ne $null) {
  if ($line.StartsWith('bottom ')) { [CompanionWindows]::Bottom([long]$line.Substring(7)); continue }
  $items = foreach ($w in [CompanionWindows]::List()) {
    $procId = [int]$w[1]
    if (-not $names.ContainsKey($procId)) { $names[$procId] = (Get-Process -Id $procId).ProcessName }
    '{"id":' + $w[0] + ',"pid":' + $procId + ',"app":"' + ($names[$procId] -replace '[^A-Za-z0-9._ -]', '') + '","x":' + $w[2] + ',"y":' + $w[3] + ',"w":' + $w[4] + ',"h":' + $w[5] + ',"minimized":' + ($(if ($w[6]) {'true'} else {'false'})) + ',"foreground":' + ($(if ($w[7]) {'true'} else {'false'})) + '}'
  }
  [Console]::Out.WriteLine('[' + ($items -join ',') + ']')
  [Console]::Out.Flush()
}
`;

/** A display's bounds in physical pixels (window frames come from the lister in physical pixels). */
function physical(display) {
  const { bounds, scaleFactor = 1 } = display;
  return { x: bounds.x * scaleFactor, y: bounds.y * scaleFactor, w: bounds.width * scaleFactor, h: bounds.height * scaleFactor };
}

/**
 * Ids of the displays where the top-most window covers the whole screen: a game, a fullscreen video or a
 * presentation. Uses z-order, not focus, so clicking a window on the other monitor does not bring her back
 * over the game. Explorer (the wallpaper and desktop) never counts.
 */
function busyDisplays(windows, displays, { ownPid } = {}) {
  const busy = new Set();
  for (const display of displays) {
    const b = physical(display);
    const top = windows.find((w) => w.pid !== ownPid && !w.minimized && w.app.toLowerCase() !== "explorer"
      && w.x < b.x + b.w && w.x + w.w > b.x && w.y < b.y + b.h && w.y + w.h > b.y);
    if (top && top.x <= b.x + 2 && top.y <= b.y + 2 && top.x + top.w >= b.x + b.w - 2 && top.y + top.h >= b.y + b.h - 2) busy.add(display.id);
  }
  return busy;
}

/** Which display she should live on: stay where she is unless a fullscreen app took it; null when every screen is busy. */
function pickHost(displays, busy, currentId, primaryId) {
  if (displays.some((d) => d.id === currentId) && !busy.has(currentId)) return currentId;
  const free = displays.filter((d) => !busy.has(d.id)).sort((a, b) => (b.id === primaryId) - (a.id === primaryId));
  return free.length ? free[0].id : null;
}

/** Kept for the single-screen case: true when the given display is covered by a fullscreen app. */
function fullscreenInFront(windows, { displayBounds, scaleFactor, ownPid }) {
  return busyDisplays(windows, [{ id: 0, bounds: displayBounds, scaleFactor }], { ownPid }).has(0);
}

/** Convert physical-pixel window frames to the overlay's CSS pixels, relative to the work area. */
function toOverlay(windows, { workArea, scaleFactor, ownPid }) {
  return windows
    .filter((w) => w.pid !== ownPid)
    .map((w) => ({
      ...w,
      x: Math.round(w.x / scaleFactor - workArea.x),
      y: Math.round(w.y / scaleFactor - workArea.y),
      w: Math.round(w.w / scaleFactor),
      h: Math.round(w.h / scaleFactor),
    }))
    .filter((w) => w.x + w.w > 0 && w.x < workArea.width && w.y + w.h > 0 && w.y < workArea.height);
}

/**
 * Polls the window list. onList(raw) gets physical frames (top-most first) so the caller can pick a display;
 * then onWindows gets them converted to the overlay of the display getGeometry() describes.
 */
function createWindowWatcher({ intervalMs = 1500, onList = () => {}, onWindows, getGeometry, ownPid = process.pid, spawnImpl = spawn } = {}) {
  if (process.platform !== "win32" && spawnImpl === spawn) return { stop() {}, bottom() {} };
  const encoded = Buffer.from(SCRIPT, "utf16le").toString("base64");
  const child = spawnImpl("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  let buffer = "";
  let pending = false;
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      pending = false;
      if (!line.startsWith("[")) continue;
      try {
        const raw = JSON.parse(line);
        onList(raw);
        onWindows(toOverlay(raw, { ...getGeometry(), ownPid }));
      } catch {
        // ignore a malformed line; the next poll will try again
      }
    }
  });
  const timer = setInterval(() => {
    if (pending || !child.stdin.writable) return;
    pending = true;
    child.stdin.write("list\n");
  }, intervalMs);
  child.on("exit", () => clearInterval(timer));
  return {
    /** Send a window (by native handle) under all other app windows. */
    bottom(hwnd) {
      if (child.stdin.writable && /^\d+$/.test(String(hwnd))) child.stdin.write(`bottom ${hwnd}\n`);
    },
    stop() {
      clearInterval(timer);
      try { child.kill(); } catch { /* already gone */ }
    },
  };
}

module.exports = { createWindowWatcher, toOverlay, fullscreenInFront, busyDisplays, pickHost, SCRIPT };
