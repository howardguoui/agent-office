import { spawn } from "node:child_process";
import { existsSync as nodeExistsSync } from "node:fs";
import path from "node:path";


/** Starts one Electron app from the plugin's own Electron, detached so it outlives the hook that started the broker. */
export function createElectronLauncher({
  projectRoot,
  main,
  args = [],
  port = 4242,
  platform = process.platform,
  existsSync = nodeExistsSync,
  spawnImpl = spawn,
} = {}) {
  const electronPath =
    platform === "win32"
      ? path.join(projectRoot, "node_modules", "electron", "dist", "electron.exe")
      : path.join(projectRoot, "node_modules", ".bin", "electron");
  const mainPath = path.join(projectRoot, main);

  return {
    open() {
      if (!existsSync(electronPath) || !existsSync(mainPath)) return false;
      const child = spawnImpl(electronPath, [mainPath, ...args], {
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

export function createSidebarLauncher(options = {}) {
  return createElectronLauncher({ ...options, main: path.join("sidebar", "electron-main.js") });
}

/** The desktop companion overlay. It holds a single-instance lock, so opening it twice is harmless. */
export function createCompanionLauncher(options = {}) {
  return createElectronLauncher({
    ...options,
    main: path.join("companion", "overlay", "electron-main.cjs"),
    args: [`--port=${options.port ?? 4242}`],
  });
}
