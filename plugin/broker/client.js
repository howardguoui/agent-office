import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";


const BROKER_ENTRY = fileURLToPath(new URL("./index.js", import.meta.url));
const DEFAULT_PORT = Number.parseInt(process.env.AGENT_OFFICE_PORT || "4242", 10);
export const DEFAULT_BASE_URL =
  process.env.AGENT_OFFICE_URL || `http://127.0.0.1:${DEFAULT_PORT}`;

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function isBrokerHealthy(baseUrl = DEFAULT_BASE_URL) {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(300),
    });
    if (!response.ok) return false;
    return (await response.json()).ok === true;
  } catch {
    return false;
  }
}

export function spawnBrokerProcess() {
  const child = spawn(process.execPath, [path.normalize(BROKER_ENTRY)], {
    detached: true,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env },
  });
  child.unref();
  return child;
}

export async function ensureBroker({
  healthCheck = () => isBrokerHealthy(),
  spawnBroker = spawnBrokerProcess,
  delay = wait,
  attempts = 30,
} = {}) {
  if (await healthCheck()) return;
  spawnBroker();
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await delay(100);
    if (await healthCheck()) return;
  }
  throw new Error("Agent Office broker did not become healthy");
}

export async function requestBroker(
  pathname,
  { method = "GET", baseUrl = DEFAULT_BASE_URL } = {},
) {
  await ensureBroker({ healthCheck: () => isBrokerHealthy(baseUrl) });
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: method === "POST" ? { "content-type": "application/json" } : {},
    body: method === "POST" ? "{}" : undefined,
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) {
    throw new Error(`Agent Office broker returned HTTP ${response.status}`);
  }
  return response.json();
}

