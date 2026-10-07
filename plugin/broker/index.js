#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAgentRunner } from "../companion/agents.js";
import { createApprovals } from "../companion/approvals.js";
import { createCompanion } from "../companion/companion.js";
import { TRAITS, codexModels, createSettings } from "../companion/settings.js";
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
const toOverlay = (message) => broker?.broadcast({ type: "companion", data: message });
const settings = createSettings({ file: path.join(companionDir, "settings.json") });
await settings.load();
const companion =
  process.env.COMPANION === "off"
    ? null
    : createCompanion({
        llm: createOllama(),
        memory: createMemory({ file: path.join(companionDir, "memory.json") }),
        loadPersona: async () => settings.persona(),
        emit: toOverlay,
      });
if (companion) setInterval(() => companion.tick().catch(() => {}), 60_000).unref();

// Messages typed to her can go straight to Claude Code or Codex (settings.target). Claude Code asks for
// permissions through the approval MCP server, which shows Allow / Deny in her bubble.
const approvalMcpConfig = JSON.stringify({
  mcpServers: {
    companion: {
      command: process.execPath,
      args: [path.join(projectRoot, "companion", "approval-mcp.js")],
      env: { AGENT_OFFICE_PORT: String(port) },
    },
  },
});
const approvals = createApprovals({ emit: toOverlay });
const runner = createAgentRunner({
  getSettings: () => settings.get(),
  approvalMcpConfig,
  emit: (event) => {
    toOverlay(event);
    companion?.noteAgent(event).catch(() => {});
    if (event.phase === "done" || event.phase === "error") approvals.denyAll("The task ended.");
  },
});
const controls = companion ? { settings, runner, approvals, codexModels, traits: Object.keys(TRAITS) } : null;

broker = createBrokerServer({
  host,
  port,
  store,
  companion,
  controls,
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

