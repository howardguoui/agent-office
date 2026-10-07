// The companion: watches normalized agent events, keeps a mood, remembers sessions, and talks
// through a local model. Every model call has a plain fallback, so she still works when Ollama is off.

import { SLEEPY_AFTER_MS, agentName, describeDigest, emptyDigest, react, updateDigest } from "./mood.js";

export const SESSION_IDLE_MS = 30 * 60_000;

const FALLBACK = {
  session_start: (m) => `Oh, ${m.who} is up. Let's see what we're building today.`,
  failure: (m) => `Hmm, that ${m.toolName || "step"} failed. ${m.who} will sort it out, I hope.`,
  waiting: (m) => `${m.who} is waiting for you. Go take a look?`,
  done: (m) => `${m.who} finished. Nice work, you two.`,
  sleepy: () => "It's quiet... I'll rest my eyes until the agents wake up.",
};

function memoryBlock(recall) {
  const lines = [];
  if (recall.facts.length) lines.push("Things Howard asked you to remember:", ...recall.facts.map((f) => `- ${f.text}`));
  if (recall.sessions.length) {
    lines.push("Recent sessions you remember:", ...recall.sessions.map((s) => `- ${s.date.slice(0, 10)}: ${s.summary}`));
  }
  return lines.join("\n");
}

export function createCompanion({
  llm,
  memory,
  loadPersona,
  emit = () => {},
  now = () => Date.now(),
  cooldownMs = 30_000,
} = {}) {
  const state = {
    mood: "idle",
    failStreak: 0,
    lastSpokeAt: 0,
    lastEventAt: now(),
    speaking: false,
    lines: [],
    digests: {},
  };

  function say(entry) {
    const line = { at: new Date(now()).toISOString(), mood: state.mood, ...entry };
    state.lines.push(line);
    if (state.lines.length > 30) state.lines.shift();
    emit({ type: "say", ...line });
    return line;
  }

  function setMood(mood) {
    if (mood && mood !== state.mood) {
      state.mood = mood;
      emit({ type: "mood", mood });
    }
  }

  async function systemPrompt(project = "") {
    const persona = await loadPersona();
    const recall = await memory.recall({ project });
    return { persona, recall, text: [persona.text, memoryBlock(recall)].filter(Boolean).join("\n\n") };
  }

  async function speak(moment, details) {
    if (state.speaking && moment.kind !== "waiting") return null;
    state.speaking = true;
    state.lastSpokeAt = now();
    try {
      const { text: system } = await systemPrompt(details.project);
      const recent = state.lines.filter((line) => line.kind !== "chat").slice(-3).map((line) => `"${line.text}"`);
      let text;
      let origin = "llm";
      try {
        text = await llm.chat(
          [
            { role: "system", content: system },
            {
              role: "user",
              content: [
                `(Event) ${moment.line}`,
                recent.length ? `Your last lines, which you must not repeat in wording or opening words: ${recent.join(" / ")}` : "",
                "React to Howard in one short line, in character.",
              ].filter(Boolean).join("\n"),
            },
          ],
          { maxTokens: 80 },
        );
      } catch {
        text = FALLBACK[moment.kind]?.(details) || "";
        origin = "fallback";
      }
      return text ? say({ kind: moment.kind, text, origin, source: details.source }) : null;
    } finally {
      state.speaking = false;
    }
  }

  async function finishSession(key) {
    const digest = state.digests[key];
    if (!digest) return null;
    delete state.digests[key];
    if (!digest.toolCalls && !digest.turns) return null;
    const facts = describeDigest(digest);
    let summary = facts;
    try {
      const { persona } = await systemPrompt(digest.project);
      summary = await llm.chat(
        [
          { role: "system", content: `You are ${persona.name}, writing a private memory note.` },
          {
            role: "user",
            content: `Write one sentence (under 35 words) for your private diary about this coding session, in your own voice and past tense, for example "Watched Claude fix the reranker in filings-rag; one test run failed first." Use only these facts: ${facts}`,
          },
        ],
        { maxTokens: 70, temperature: 0.3 },
      );
    } catch {
      // keep the factual description
    }
    const entry = {
      date: digest.lastAt,
      source: digest.source,
      project: digest.project,
      minutes: Math.max(1, Math.round((Date.parse(digest.lastAt) - Date.parse(digest.startedAt)) / 60_000)),
      toolCalls: digest.toolCalls,
      failures: digest.failures,
      files: digest.files.slice(-6),
      programs: digest.programs.slice(-5),
      summary,
    };
    await memory.addSession(entry);
    emit({ type: "memory", entry });
    return entry;
  }

  return {
    state,

    async observe(event) {
      state.lastEventAt = now();
      const key = `${event.source}:${event.sessionId}`;
      if (event.eventName === "SessionStart" && state.digests[key]) await finishSession(key);
      state.digests[key] = updateDigest(state.digests[key] || emptyDigest(event), event);

      const result = react(state, event);
      if (result.failStreak !== undefined) state.failStreak = result.failStreak;
      setMood(result.mood);

      let spoken = null;
      const due = now() - state.lastSpokeAt >= cooldownMs;
      if (result.moment && (due || result.moment.kind === "waiting")) {
        spoken = await speak(result.moment, {
          who: agentName(event.source),
          source: event.source,
          toolName: event.toolName,
          project: event.context?.project || state.digests[key]?.project || "",
        });
      }
      if (event.eventName === "SessionEnd") await finishSession(key);
      return spoken;
    },

    /** Call periodically: dozes off when nothing happens, and files away sessions that went quiet. */
    async tick() {
      const t = now();
      for (const [key, digest] of Object.entries(state.digests)) {
        if (t - Date.parse(digest.lastAt) >= SESSION_IDLE_MS) await finishSession(key);
      }
      if (t - state.lastEventAt >= SLEEPY_AFTER_MS && state.mood !== "sleepy") {
        setMood("sleepy");
        return say({ kind: "sleepy", text: FALLBACK.sleepy(), origin: "fallback" });
      }
      return null;
    },

    async chat(text) {
      const message = String(text || "").trim().slice(0, 2000);
      if (!message) throw new TypeError("Empty message");
      state.lastEventAt = now();
      if (state.mood === "sleepy") setMood("curious");
      const remembered = /^(please\s+)?remember(\s+that)?[\s:,]+(.+)$/i.exec(message);
      if (remembered) await memory.addFact(remembered[3].trim());
      const active = Object.values(state.digests).map((d) => `- ${describeDigest(d)}`);
      const project = Object.values(state.digests).at(-1)?.project || "";
      const { text: system, recall } = await systemPrompt(project);
      const context = active.length ? `What the agents are doing right now:\n${active.join("\n")}` : "No agent is running right now.";
      await memory.addChat("user", message);
      let reply;
      let origin = "llm";
      try {
        reply = await llm.chat(
          [
            { role: "system", content: `${system}\n\n${context}${remembered ? "\n\n(You just saved that to memory.)" : ""}` },
            ...recall.chat.map((c) => ({ role: c.role, content: c.text })),
            { role: "user", content: message },
          ],
          { maxTokens: 200 },
        );
      } catch {
        reply = remembered
          ? "Got it, I'll remember that. (My brain, Ollama, isn't answering right now, so that's all I can say.)"
          : "My brain isn't answering right now. Is Ollama running?";
        origin = "fallback";
      }
      await memory.addChat("assistant", reply);
      return say({ kind: "chat", text: reply, origin });
    },

    async snapshot() {
      const persona = await loadPersona();
      return {
        name: persona.name,
        mood: state.mood,
        model: llm.model || "",
        lines: state.lines.slice(-10),
        activeSessions: Object.values(state.digests).map((d) => ({ source: d.source, project: d.project, toolCalls: d.toolCalls })),
        memory: await memory.stats(),
      };
    },
  };
}
