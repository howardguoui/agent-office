# Agent Office Plugin: desktop companion for Claude Code, Codex and Gemini CLI

A Live2D character who lives on your desktop and knows what your coding agents are doing. Agent hooks send
lifecycle events to a local broker; the broker feeds her, and she reacts, chats (local Ollama, free) and can
pass what you type straight to Claude Code or Codex, with Allow / Deny approvals in her speech bubble.

## How it works

```
Claude Code / Codex / Gemini CLI → hooks → send_event.py → POST /event → broker (127.0.0.1:4242)
                                                                          ├─ companion brain (Ollama)
                                                                          └─ WebSocket → desktop companion (Electron)
```

The broker starts on the first hook event and opens the companion window. A new agent session brings her back
if she was quit.

## The companion window

- **Desktop layer.** Her window sits under every app window, so she never covers your work. It comes forward
  only while her chat box, settings, an answer card or an approval card is open.
- **Roams.** She walks along the bottom of the screen, hops onto the tops of windows, rides a window you move,
  and drops when it closes. Drag and throw her with the mouse.
- **Game mode.** When a fullscreen game or video is on top of her monitor she moves to another monitor; if
  every screen is busy she hides until one is free.
- **Privacy.** The window lister reads frames and process names only, never window titles or contents.

## Run

```bash
npm ci
node broker/index.js        # or let the hooks start it; COMPANION=off disables her
```

A browser view of the raw agent state is at `http://localhost:4242`.

## Layout

```
plugin/
├── broker/            # HTTP + WebSocket broker, event normalizer, companion launcher
├── companion/         # brain (Ollama), memory, persona, settings, agent runner, approvals
│   └── overlay/       # Electron window, Live2D page, roaming behavior, window lister
├── mcp-server/        # MCP tools: agent_office_status, agent_office_open (opens the companion)
├── sidebar/index.html # browser view of agent state
└── tests/
```

Live2D sample models (Mao, Haru) load from Live2D's CubismWebSamples and are used under Live2D's sample model
terms; they are not redistributed in this repo.
