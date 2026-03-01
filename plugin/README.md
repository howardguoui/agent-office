# ⬡ Agent Office Plugin — Claude Code Sidebar

Real-time visualization of Claude Code agents as a **persistent sidebar panel**.

## How it works

```
Claude Code → hooks → send_event.py → HTTP POST → MCP server → WebSocket → Sidebar UI
```

The MCP server registers with Claude Code and auto-launches a slim Electron window docked to the right side of your screen. Every tool call, agent spawn, and task completion appears instantly.

## Install

```bash
npm install
./install.sh /path/to/your/project
```

Then add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "agent-office": {
      "command": "node",
      "args": ["/path/to/agent-office-plugin/mcp-server/index.js"],
      "type": "stdio"
    }
  }
}
```

## Use

Just run Claude Code normally:

```bash
cd your-project
claude "build a REST API"
```

The sidebar opens automatically. Agents appear as they spawn.

## Without Electron

If you don't want the Electron window, open your browser to:

```
http://localhost:4242
```

## MCP Tools available in Claude Code

- `agent_office_status` — see active agents and stats
- `agent_office_open` — reopen the sidebar panel

## File structure

```
agent-office-plugin/
├── mcp-server/
│   └── index.js          # MCP server + WebSocket event server
├── sidebar/
│   ├── index.html        # Sidebar UI
│   └── electron-main.js  # Electron window (optional)
├── scripts/
│   ├── send_event.py     # Claude Code hook
│   └── settings.json     # Hook registrations
├── install.sh
└── package.json
```
