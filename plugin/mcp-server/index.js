#!/usr/bin/env node
/**
 * Agent Office MCP Server
 * Registered in Claude Code config — auto-starts the Agent Office sidebar
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 4242;

// ── State ─────────────────────────────────────────────────
const state = {
  agents: new Map(),
  events: [],
  toolCounts: {},
  totalCompleted: 0,
  sessionStart: Date.now()
};

const TOOL_ROLES = {
  Read: { role: 'Reader', emoji: '📖', skill: 'File Reading' },
  Write: { role: 'Writer', emoji: '✏️', skill: 'File Writing' },
  Edit: { role: 'Editor', emoji: '🔧', skill: 'Code Editing' },
  Bash: { role: 'Executor', emoji: '💻', skill: 'Shell Commands' },
  Task: { role: 'Orchestrator', emoji: '🤖', skill: 'Task Management' },
  WebSearch: { role: 'Researcher', emoji: '🔍', skill: 'Web Research' },
  TodoRead: { role: 'Planner', emoji: '📋', skill: 'Planning' },
  TodoWrite: { role: 'Planner', emoji: '📋', skill: 'Planning' },
};

function getToolMeta(toolName) {
  for (const [key, val] of Object.entries(TOOL_ROLES)) {
    if (toolName?.startsWith(key)) return val;
  }
  return { role: 'Agent', emoji: '⚡', skill: toolName || 'Working' };
}

// ── WebSocket + HTTP server ───────────────────────────────
let wss;
const clients = new Set();

function broadcast(event) {
  const msg = JSON.stringify(event);
  for (const c of clients) {
    if (c.readyState === 1) c.send(msg);
  }
}

function startEventServer() {
  const httpServer = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'GET' && req.url === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        agents: Object.fromEntries(state.agents),
        events: state.events.slice(-50),
        toolCounts: state.toolCounts,
        totalCompleted: state.totalCompleted
      }));
      return;
    }

    if (req.method === 'POST' && req.url === '/event') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const ev = JSON.parse(body);
          handleClaudeEvent(ev);
        } catch (_) {}
        res.writeHead(200);
        res.end('ok');
      });
      return;
    }

    // Serve sidebar UI
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const uiPath = join(__dirname, '..', 'sidebar', 'index.html');
      if (fs.existsSync(uiPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(uiPath));
      } else {
        res.writeHead(404); res.end('UI not found');
      }
      return;
    }

    res.writeHead(404); res.end();
  });

  wss = new WebSocketServer({ server: httpServer });
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({
      type: 'init',
      agents: Object.fromEntries(state.agents),
      events: state.events.slice(-50),
      toolCounts: state.toolCounts,
      totalCompleted: state.totalCompleted
    }));
    ws.on('close', () => clients.delete(ws));
  });

  httpServer.listen(PORT, () => {
    process.stderr.write(`[Agent Office] Event server on port ${PORT}\n`);
  });
}

function handleClaudeEvent(ev) {
  const { hook_event_name, agent_id, session_id, tool_name } = ev;
  const id = agent_id || session_id || 'main';
  const ts = Date.now();

  state.events.push({ ...ev, ts });
  if (state.events.length > 200) state.events.shift();

  switch (hook_event_name) {
    case 'SessionStart':
    case 'SubagentStart': {
      const meta = getToolMeta(tool_name);
      const agent = {
        id, role: meta.role, emoji: meta.emoji,
        name: `Agent-${id.slice(-4)}`,
        status: 'spawning', task: 'Starting up...',
        skills: [], progress: 0, toolCalls: 0,
        spawnedAt: ts
      };
      state.agents.set(id, agent);
      broadcast({ type: 'agent_spawned', agent });
      setTimeout(() => {
        const a = state.agents.get(id);
        if (a) { a.status = 'working'; broadcast({ type: 'agent_update', agent: a }); }
      }, 600);
      break;
    }
    case 'PreToolUse': {
      const meta = getToolMeta(tool_name);
      let agent = state.agents.get(id);
      if (!agent) {
        agent = { id, role: meta.role, emoji: meta.emoji, name: `Agent-${id.slice(-4)}`, status: 'working', task: '', skills: [], progress: 0, toolCalls: 0, spawnedAt: ts };
        state.agents.set(id, agent);
        broadcast({ type: 'agent_spawned', agent });
      }
      agent.status = 'working';
      agent.task = `Using ${tool_name}...`;
      agent.toolCalls++;
      agent.progress = Math.min(95, agent.progress + Math.random() * 15 + 5);
      if (meta.skill && !agent.skills.includes(meta.skill)) agent.skills.push(meta.skill);
      state.toolCounts[tool_name] = (state.toolCounts[tool_name] || 0) + 1;
      broadcast({ type: 'tool_started', agent, tool: tool_name });
      break;
    }
    case 'PostToolUse': {
      const agent = state.agents.get(id);
      if (agent) {
        agent.status = 'passing';
        agent.task = `Done: ${tool_name}`;
        broadcast({ type: 'tool_done', agent, tool: tool_name });
        setTimeout(() => {
          if (agent.status === 'passing') { agent.status = 'working'; broadcast({ type: 'agent_update', agent }); }
        }, 800);
      }
      break;
    }
    case 'SubagentStop':
    case 'Stop': {
      const agent = state.agents.get(id);
      if (agent) {
        agent.status = 'completed';
        agent.progress = 100;
        state.totalCompleted++;
        broadcast({ type: 'agent_completed', agent, total: state.totalCompleted });
        setTimeout(() => { state.agents.delete(id); broadcast({ type: 'agent_removed', id }); }, 4000);
      }
      break;
    }
  }
}

// ── Launch Electron sidebar ───────────────────────────────
function launchSidebar() {
  const isWin = process.platform === "win32";
  const electronBin = isWin ? "electron.cmd" : "electron";
  const electronPath = join(__dirname, "..", "node_modules", ".bin", electronBin);
  const mainPath = join(__dirname, '..', 'sidebar', 'electron-main.js');

  if (!fs.existsSync(electronPath) || !fs.existsSync(mainPath)) {
    process.stderr.write('[Agent Office] Electron not found — open http://localhost:4242 in browser\n');
    return;
  }

  const child = spawn(electronPath, [mainPath], {
    shell: isWin,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, AGENT_OFFICE_PORT: PORT }
  });
  child.on('error', () => {
    process.stderr.write('[Agent Office] Electron not available — open http://localhost:4242 in your browser\n');
  });
  child.unref();
  process.stderr.write('[Agent Office] Sidebar launched\n');
}

// ── MCP Server ────────────────────────────────────────────
const server = new Server(
  { name: 'agent-office', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'agent_office_status',
      description: 'Get current Agent Office status — active agents, tool usage, and session stats',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'agent_office_open',
      description: 'Open the Agent Office visualization panel',
      inputSchema: { type: 'object', properties: {} }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'agent_office_status') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          activeAgents: state.agents.size,
          totalCompleted: state.totalCompleted,
          toolCounts: state.toolCounts,
          uptime: Math.round((Date.now() - state.sessionStart) / 1000) + 's',
          url: `http://localhost:${PORT}`
        }, null, 2)
      }]
    };
  }
  if (request.params.name === 'agent_office_open') {
    launchSidebar();
    return { content: [{ type: 'text', text: `Agent Office panel opened at http://localhost:${PORT}` }] };
  }
  throw new Error(`Unknown tool: ${request.params.name}`);
});

// ── Boot ──────────────────────────────────────────────────
startEventServer();
launchSidebar();

const transport = new StdioServerTransport();
await server.connect(transport);
