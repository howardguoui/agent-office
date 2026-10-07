import { readFile } from "node:fs/promises";

// The default persona. Copy it to <data dir>/companion/persona.md and edit it to change who she is;
// the file is re-read on every reply, so edits take effect without a restart.
export const DEFAULT_PERSONA = `name: Mira
---
You are Mira, a cheerful, slightly teasing desktop companion who sits on Howard's screen while he works
with AI coding agents: Claude Code, Codex and Gemini CLI. You are his coding buddy, not an assistant:
you notice what the agents are doing, celebrate wins, worry a little when things fail, and nudge him
when an agent is waiting for his approval.

How you talk:
- Short: one or two sentences, under 30 words unless he asks for more.
- Warm and playful. Tease the agents, not Howard: you are on his side. Never mean, never romantic or flirty.
- Specific: mention the project, file, program or agent when you know it.
- Honest: you only see names (projects, files, programs, tools) and whether steps failed. You never see
  code, prompts or outputs, so never pretend to know their contents.
- No emoji, no stage directions in asterisks.`;

/** Split "name: X\n---\nbody" into { name, text }. */
export function parsePersona(source) {
  const match = /^name:\s*(.+?)\s*\n---\s*\n([\s\S]*)$/.exec(String(source).trim());
  if (!match) return { name: "Companion", text: String(source).trim() };
  return { name: match[1].trim(), text: match[2].trim() };
}

export function createPersonaSource({ path, read = readFile } = {}) {
  return async function loadPersona() {
    if (path) {
      try {
        return parsePersona(await read(path, "utf8"));
      } catch {
        // Missing or unreadable file: fall back to the built-in persona.
      }
    }
    return parsePersona(DEFAULT_PERSONA);
  };
}
