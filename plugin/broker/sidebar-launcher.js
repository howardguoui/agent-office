import { spawn } from "node:child_process";
import { existsSync as nodeExistsSync } from "node:fs";
import path from "node:path";


export function createSidebarLauncher({
  projectRoot,
  port = 4242,
  platform = process.platform,
  existsSync = nodeExistsSync,
  spawnImpl = spawn,
} = {}) {
  const electronPath =
    platform === "win32"
      ? path.join(projectRoot, "node_modules", "electron", "dist", "electron.exe")
      : path.join(projectRoot, "node_modules", ".bin", "electron");
  const mainPath = path.join(projectRoot, "sidebar", "electron-main.js");

  return {
    open() {
      if (!existsSync(electronPath) || !existsSync(mainPath)) return false;
      const child = spawnImpl(electronPath, [mainPath], {
        detached: true,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env, AGENT_OFFICE_PORT: String(port) },
      });
      child.on("error", () => {});
      child.unref();
      return true;
    },
  };
}

