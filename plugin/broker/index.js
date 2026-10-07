#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCompanion } from "../companion/companion.js";
import { createMemory } from "../companion/memory.js";
import { createOllama } from "../companion/ollama.js";
import { createPersonaSource } from "../companion/persona.js";
import { createMetadataLogger } from "./metadata-log.js";
import { createBrokerServer } from "./server.js";
import { createSidebarLauncher } from "./sidebar-launcher.js";
import { createStateStore } from "./state-store.js";


const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = Number.parseInt(process.env.AGENT_OFFICE_PORT || "4242", 10);
const host = process.env.AGENT_OFFICE_HOST || "127.0.0.1";
if (!new Set(["127.0.0.1", "::1"]).has(host)) {
  throw new Error("AGENT_OFFICE_HOST must be a loopback address");
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("AGENT_OFFICE_PORT must be a valid TCP port");
}

const dataRoot =
  process.env.AGENT_OFFICE_DATA_DIR ||
  path.join(process.env.LOCALAPPDATA || os.homedir(), "AgentOffice");
const logger = createMetadataLogger({
  directory: path.join(dataRoot, "logs", "events"),
});
const store = createStateStore({ appendLog: (event) => logger.append(event) });
const sidebar = createSidebarLauncher({ projectRoot, port });

// The desktop companion: on by default, COMPANION=off disables her.
let broker;
const companionDir = path.join(dataRoot, "companion");
const companion =
  process.env.COMPANION === "off"
    ? null
    : createCompanion({
        llm: createOllama(),
        memory: createMemory({ file: path.join(companionDir, "memory.json") }),
        loadPersona: createPersonaSource({ path: path.join(companionDir, "persona.md") }),
        emit: (message) => broker?.broadcast({ type: "companion", data: message }),
      });
if (companion) setInterval(() => companion.tick().catch(() => {}), 60_000).unref();

broker = createBrokerServer({
  host,
  port,
  store,
  companion,
  openSidebar: async () => sidebar.open(),
});

try {
  await broker.start();
  sidebar.open();
} catch (error) {
  if (error.code === "EADDRINUSE") process.exit(0);
  throw error;
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await broker.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

