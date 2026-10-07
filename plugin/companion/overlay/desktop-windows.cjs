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
  public static void Init() { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
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
  $items = foreach ($w in [CompanionWindows]::List()) {
    $procId = [int]$w[1]
    if (-not $names.ContainsKey($procId)) { $names[$procId] = (Get-Process -Id $procId).ProcessName }
    '{"id":' + $w[0] + ',"pid":' + $procId + ',"app":"' + ($names[$procId] -replace '[^A-Za-z0-9._ -]', '') + '","x":' + $w[2] + ',"y":' + $w[3] + ',"w":' + $w[4] + ',"h":' + $w[5] + ',"minimized":' + ($(if ($w[6]) {'true'} else {'false'})) + ',"foreground":' + ($(if ($w[7]) {'true'} else {'false'})) + '}'
  }
  [Console]::Out.WriteLine('[' + ($items -join ',') + ']')
  [Console]::Out.Flush()
}
`;

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

function createWindowWatcher({ intervalMs = 1500, onWindows, getGeometry, ownPid = process.pid, spawnImpl = spawn } = {}) {
  if (process.platform !== "win32" && spawnImpl === spawn) return { stop() {} };
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
        onWindows(toOverlay(JSON.parse(line), { ...getGeometry(), ownPid }));
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
    stop() {
      clearInterval(timer);
      try { child.kill(); } catch { /* already gone */ }
    },
  };
}

module.exports = { createWindowWatcher, toOverlay, SCRIPT };
