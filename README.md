# ⬡ Agent Office

**Real-time visualization of Claude Code agents — watch your AI work like a living office.**

[![Live Demo](https://img.shields.io/badge/demo-live-ec4899?style=for-the-badge&logo=vercel)](https://howardguoui.github.io/agent-office/)
[![License: MIT](https://img.shields.io/badge/License-MIT-818cf8?style=for-the-badge)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Plugin-f59e0b?style=for-the-badge)](https://code.claude.com)

Every time Claude Code spawns a subagent, calls a tool, or passes work between agents — Agent Office shows it as an animated office. Agents appear at their desks, acquire skills, pass data packets to each other, and complete tasks in real time.

---

## 🎬 Live Demo

**[→ Try the live demo](https://howardguoui.github.io/agent-office/)**

The demo runs a simulation. Install the plugin to see your actual Claude Code sessions.

---

## How It Works

```
Claude Code runs a task
       │
       ├─ SubagentStart  ──► .claude/hooks/send_event.py ──► HTTP POST
       ├─ PreToolUse     ──► .claude/hooks/send_event.py ──► HTTP POST
       ├─ PostToolUse    ──► .claude/hooks/send_event.py ──► HTTP POST
       └─ SubagentStop   ──► .claude/hooks/send_event.py ──► HTTP POST
                                                                 │
                                                          Node.js Server
                                                          (localhost:4242)
                                                                 │
                                                        WebSocket broadcast
                                                                 │
                                                    ┌────────────────────────┐
                                                    │   Agent Office UI      │
                                                    │  Agent spawns → desk   │
                                                    │  Tool use → progress   │
                                                    │  Skill gained → badge  │
                                                    │  Task done → pulse ✓   │
                                                    └────────────────────────┘
```

---

## Quick Start

### 1. Clone this repo

```bash
git clone https://github.com/howardguoui/agent-office.git
cd agent-office
```

### 2. Install into your Claude Code project

```bash
./install.sh /path/to/your/project
```

This copies the hook script and registers all events in `.claude/settings.json`.

### 3. Start the server

```bash
cd server
npm install
node index.js
```

### 4. Open the UI

```
http://localhost:4242
```

### 5. Run Claude Code

```bash
cd your-project
claude "build me a REST API with auth and tests"
```

Agents appear immediately as Claude Code spawns them. Watch them work.

---

## What You See

| Visual | What's Happening in Claude Code |
|--------|--------------------------------|
| 🟣 New desk spawns | `SubagentStart` — new subagent created |
| ⚡ Progress bar fills | `PreToolUse` — tool being called |
| ★ Skill badge appears | Agent used a new tool type |
| → Packet flies | Work being passed between agents |
| 🟢 Green pulse | `SubagentStop` — task complete |
| Desk fades out | Subagent finished and exited |

---

## Hooks Captured

| Hook Event | Trigger |
|------------|---------|
| `SubagentStart` | New subagent spawned |
| `SubagentStop` | Subagent finished |
| `PreToolUse` | Tool about to run (Read, Write, Bash, Task…) |
| `PostToolUse` | Tool completed |
| `PostToolUseFailure` | Tool failed |
| `UserPromptSubmit` | New prompt submitted |
| `SessionStart / End` | Session lifecycle |
| `Stop` | Claude Code finished |

---

## Plugin: desktop companion (`plugin/`)

`plugin/` is a second, newer way to run Agent Office. Instead of the office page it has a local broker and a Live2D
character on your desktop who reacts to your agents. Details are in [`plugin/README.md`](plugin/README.md).

- **Broker** (`plugin/broker/`): HTTP + WebSocket on `127.0.0.1:4242` (loopback only). It takes the same
  `POST /event` hook events, normalizes Claude Code, Codex and Gemini CLI events into one shape, tracks
  simultaneous sessions separately, and logs names-only metadata (never prompts, arguments or outputs).
- **Desktop companion** (`plugin/companion/`): an Electron window with a Live2D character. She chats through a
  local Ollama model, can pass what you type to Claude Code or Codex, and shows Allow / Deny approvals in her
  speech bubble. `COMPANION=off` runs the broker without her.
- **MCP server** (`plugin/mcp-server/`): two tools over stdio, `agent_office_status` and `agent_office_open`.

```bash
cd plugin
npm ci
npm start        # broker on 127.0.0.1:4242; opens the companion
npm test         # node --test, no Electron or display needed
```

The broker and `server/` both default to port 4242, so run one or the other.

---

## File Structure

```
agent-office/
├── .claude/
│   ├── hooks/
│   │   └── send_event.py      # Forwards Claude Code events → server
│   └── settings.json          # Registers hooks with Claude Code
├── server/
│   ├── index.js               # WebSocket + HTTP server
│   ├── package.json
│   └── ui/
│       └── index.html         # Live-connected visualization UI
├── plugin/                    # Broker, desktop companion, MCP server (see plugin/README.md)
├── demo/
│   └── index.html             # Standalone demo (GitHub Pages)
├── .github/
│   └── workflows/
│       ├── deploy-demo.yml    # Auto-deploys demo to GitHub Pages
│       └── plugin-tests.yml   # Runs the plugin's tests on push and pull request
├── install.sh                 # One-command installer
└── README.md
```

---

## Configuration

The hook sends to `http://localhost:4242/event` by default.

Override with an environment variable:

```bash
AGENT_OFFICE_URL=http://localhost:9999/event claude "do something"
```

---

## Requirements

- **Node.js** 18+
- **Python** 3.8+
- **Claude Code** (with hooks support)

---

## Roadmap

- [ ] VS Code extension (sidebar panel)
- [ ] Agent-to-agent message trace lines
- [ ] Session replay / export
- [ ] Token usage per agent
- [x] Electron standalone app (the desktop companion in `plugin/`)
- [x] Multi-session support (the `plugin/` broker tracks simultaneous Claude Code and Codex sessions)

---

## License

MIT — use it, fork it, ship it.

---

*Built with Claude Code. Visualized by Agent Office.*
