/**
 * Agent Office Server
 * - Receives events from Claude Code hooks via HTTP POST /event
 * - Broadcasts to browser clients via WebSocket
 * - Serves the UI on GET /
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = 4242;
const clients = new Set();

// In-memory state
const state = {
  agents: new Map(),   // agent_id -> agent object
  session: null,
  events: [],
  toolCounts: {},
  totalCompleted: 0,
};

const TOOL_ROLE = {
  Read: "Reader", Glob: "Searcher", Grep: "Searcher",
  Write: "Writer", Edit: "Editor", MultiEdit: "Editor",
  Bash: "Executor", Task: "Orchestrator",
  WebFetch: "Researcher", WebSearch: "Researcher",
  TodoWrite: "Planner", TodoRead: "Planner",
};

const TOOL_SKILL = {
  Read: "File Reading", Glob: "Pattern Search", Grep: "Code Search",
  Write: "File Writing", Edit: "Code Editing", MultiEdit: "Bulk Editing",
  Bash: "Shell Commands", Task: "Task Delegation",
  WebFetch: "Web Research", WebSearch: "Web Research",
  TodoWrite: "Task Planning", TodoRead: "Task Planning",
};

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    try { ws.send(data); } catch (_) {}
  }
}

function agentFromSubagent(event) {
  const id = event.agent_id || event.session_id;
  if (!state.agents.has(id)) {
    state.agents.set(id, {
      id,
      role: event.agent_type || "Subagent",
      name: `${(event.agent_type || "Agent").slice(0, 3).toUpperCase()}-${String(state.agents.size + 1).padStart(3, "0")}`,
      status: "spawning",
      task: "Initializing...",
      skills: [],
      progress: 0,
      toolCalls: 0,
      isSubagent: true,
    });
  }
  return state.agents.get(id);
}

function getMainAgent() {
  const id = "main-" + (state.session || "session");
  if (!state.agents.has(id)) {
    state.agents.set(id, {
      id,
      role: "Orchestrator",
      name: "MAIN-001",
      status: "idle",
      task: "Waiting for prompt...",
      skills: ["Planning", "Delegation"],
      progress: 0,
      toolCalls: 0,
      isSubagent: false,
    });
  }
  return state.agents.get(id);
}

function handleEvent(event) {
  const type = event.hook_event_name;
  const ts = event._ts || Date.now();

  // Track in events log (keep last 200)
  state.events.unshift({ type, ts, data: event });
  if (state.events.length > 200) state.events.pop();

  let update = null;

  switch (type) {
    case "SessionStart": {
      state.session = event.session_id;
      const main = getMainAgent();
      main.status = "idle";
      update = {
        type: "session_start",
        session_id: event.session_id,
        agents: [...state.agents.values()],
      };
      break;
    }

    case "SessionEnd": {
      for (const agent of state.agents.values()) {
        if (agent.status !== "completed") agent.status = "idle";
      }
      update = {
        type: "session_end",
        agents: [...state.agents.values()],
      };
      break;
    }

    case "SubagentStart": {
      const agent = agentFromSubagent(event);
      agent.status = "spawning";
      agent.task = "Starting up...";
      update = {
        type: "agent_spawned",
        agent: { ...agent },
        log: `${agent.name} spawned as ${agent.role}`,
      };
      break;
    }

    case "SubagentStop": {
      const agent = agentFromSubagent(event);
      agent.status = "completed";
      agent.progress = 100;
      state.totalCompleted++;
      update = {
        type: "agent_completed",
        agent: { ...agent },
        log: `${agent.name} finished — task complete`,
        totalCompleted: state.totalCompleted,
      };
      // Remove after delay (handled client-side via status)
      break;
    }

    case "UserPromptSubmit": {
      const main = getMainAgent();
      main.status = "working";
      main.task = (event.prompt || "Processing prompt...").slice(0, 60);
      main.progress = 10;
      update = {
        type: "prompt_submitted",
        agent: { ...main },
        log: `Prompt received: "${main.task}"`,
      };
      break;
    }

    case "PreToolUse": {
      const tool = event.tool_name || "Unknown";
      const role = TOOL_ROLE[tool] || "Worker";
      const skill = TOOL_SKILL[tool] || tool;

      // Find the right agent - subagent if in subagent context, else main
      let agent;
      if (event.agent_id && state.agents.has(event.agent_id)) {
        agent = state.agents.get(event.agent_id);
      } else {
        agent = getMainAgent();
      }

      agent.status = "working";
      agent.toolCalls++;
      agent.progress = Math.min(90, agent.progress + Math.floor(Math.random() * 15) + 5);

      // Build descriptive task from tool + input
      let taskDesc = tool;
      const inp = event.tool_input || {};
      if (inp.command) taskDesc = `Running: ${String(inp.command).slice(0, 40)}`;
      else if (inp.path || inp.file_path) taskDesc = `${tool}: ${path.basename(inp.path || inp.file_path)}`;
      else if (inp.pattern) taskDesc = `Searching: ${inp.pattern}`;
      else if (inp.query) taskDesc = `Searching: ${inp.query}`;
      else if (inp.prompt) taskDesc = `Task: ${String(inp.prompt).slice(0, 40)}`;
      else if (inp.description) taskDesc = inp.description.slice(0, 50);
      agent.task = taskDesc;

      // Add skill if not already there
      if (!agent.skills.includes(skill)) {
        agent.skills = [...agent.skills, skill].slice(0, 6);
      }

      // Track tool counts
      state.toolCounts[tool] = (state.toolCounts[tool] || 0) + 1;

      update = {
        type: "tool_started",
        agent: { ...agent },
        tool,
        log: `${agent.name} → ${taskDesc}`,
        toolCounts: { ...state.toolCounts },
      };
      break;
    }

    case "PostToolUse": {
      let agent;
      if (event.agent_id && state.agents.has(event.agent_id)) {
        agent = state.agents.get(event.agent_id);
      } else {
        agent = getMainAgent();
      }
      agent.status = "passing";
      agent.progress = Math.min(95, agent.progress + 5);

      update = {
        type: "tool_done",
        agent: { ...agent },
        tool: event.tool_name,
        log: `${agent.name} ✓ ${event.tool_name} complete`,
      };
      break;
    }

    case "PostToolUseFailure": {
      let agent;
      if (event.agent_id && state.agents.has(event.agent_id)) {
        agent = state.agents.get(event.agent_id);
      } else {
        agent = getMainAgent();
      }
      agent.status = "error";
      update = {
        type: "tool_error",
        agent: { ...agent },
        tool: event.tool_name,
        log: `${agent.name} ✗ ${event.tool_name} failed`,
      };
      break;
    }

    case "Stop": {
      const main = getMainAgent();
      main.status = "idle";
      main.task = "Session complete";
      main.progress = 100;
      state.totalCompleted++;
      update = {
        type: "session_stopped",
        agent: { ...main },
        log: "Session finished",
        totalCompleted: state.totalCompleted,
      };
      break;
    }
  }

  if (update) {
    broadcast(update);
  }
}

// HTTP Server
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Receive hook events
  if (req.method === "POST" && req.url === "/event") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const event = JSON.parse(body);
        handleEvent(event);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // State dump for new clients
  if (req.method === "GET" && req.url === "/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      agents: [...state.agents.values()],
      events: state.events.slice(0, 50),
      toolCounts: state.toolCounts,
      totalCompleted: state.totalCompleted,
    }));
    return;
  }

  // Serve the UI
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const uiPath = path.join(__dirname, "ui", "index.html");
    if (fs.existsSync(uiPath)) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(fs.readFileSync(uiPath));
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body style="background:#05050a;color:#818cf8;font-family:monospace;padding:40px">
        <h2>⬡ Agent Office Server Running</h2>
        <p>WebSocket: ws://localhost:${PORT}</p>
        <p>Events received: ${state.events.length}</p>
        <p>Agents tracked: ${state.agents.size}</p>
        <p style="color:#6b7280;font-size:12px">Open the client UI separately or run: npm run dev</p>
      </body></html>`);
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// WebSocket Server
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`[AgentOffice] Client connected (${clients.size} total)`);

  // Send full current state to new client
  ws.send(JSON.stringify({
    type: "init",
    agents: [...state.agents.values()],
    events: state.events.slice(0, 50),
    toolCounts: state.toolCounts,
    totalCompleted: state.totalCompleted,
  }));

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[AgentOffice] Client disconnected (${clients.size} remaining)`);
  });
  ws.on("error", () => clients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`\n⬡ Agent Office Server running at http://localhost:${PORT}`);
  console.log(`  WebSocket: ws://localhost:${PORT}`);
  console.log(`  Hook URL:  http://localhost:${PORT}/event`);
  console.log(`\n  Waiting for Claude Code events...\n`);
});
