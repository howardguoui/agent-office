import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Companion settings, edited from the gear panel and saved next to her memory.

export const TRAITS = {
  cheerful: "Upbeat and encouraging; you find the bright side.",
  teasing: "Playfully teasing, aimed at the agents, never at Howard.",
  calm: "Calm and soft-spoken; you keep things low-key.",
  shy: "A little shy; you get flustered when praised.",
  sarcastic: "Dry, deadpan humor.",
  energetic: "Bouncy and excitable; small wins thrill you.",
  nerdy: "A tech nerd who loves details about tools, models and GPUs.",
  tsundere: "Acts unimpressed but clearly cares; occasionally slips and shows it.",
  polite: "Polite and well-mannered.",
};

export const DEFAULTS = Object.freeze({
  target: "mira", // where typed messages go: mira (chat with her) | claude | codex
  project: "",
  recentProjects: [],
  claudePermission: "ask", // ask | acceptEdits | plan
  codexModel: "",
  codexSandbox: "read-only", // read-only | workspace-write
  character: "mao",
  commentOnApps: true,
  persona: { name: "Mira", traits: ["cheerful", "teasing"], notes: "" },
});

const CHOICES = {
  target: ["mira", "claude", "codex"],
  claudePermission: ["ask", "acceptEdits", "plan"],
  codexSandbox: ["read-only", "workspace-write"],
  character: ["mao", "haru"],
};

/** Persona text built from the settings panel: name, traits and free-form notes. */
export function buildPersona({ name, traits = [], notes = "" } = {}) {
  const chosen = traits.filter((trait) => TRAITS[trait]);
  return {
    name,
    text: [
      `You are ${name}, a desktop companion who lives on Howard's screen while he works with AI coding agents`,
      "(Claude Code, Codex, Gemini CLI). You are his coding buddy, not an assistant: you notice what the agents",
      "are doing, celebrate wins, worry a little when things fail, and nudge him when an agent needs his approval.",
      "",
      "Your personality:",
      ...(chosen.length ? chosen.map((trait) => `- ${TRAITS[trait]}`) : ["- Friendly."]),
      ...(notes.trim() ? [`- ${notes.trim()}`] : []),
      "",
      "How you talk:",
      "- Short: one or two sentences, under 30 words unless he asks for more.",
      "- Specific: mention the project, file, program, app or agent when you know it.",
      "- Honest: you only see names (projects, files, programs, apps) and whether steps failed, never code,",
      "  prompts or outputs, so never pretend to know their contents.",
      "- Keep it friendly and safe for work. No emoji, no stage directions in asterisks.",
    ].join("\n"),
  };
}

async function isDirectory(dir, statImpl) {
  try {
    return (await statImpl(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** Validate a partial update; returns { value, errors }. Unknown keys are ignored. */
export async function validateSettings(patch, current, { statImpl = stat } = {}) {
  const next = { ...current, persona: { ...current.persona } };
  const errors = [];
  for (const [key, options] of Object.entries(CHOICES)) {
    if (patch[key] === undefined) continue;
    if (options.includes(patch[key])) next[key] = patch[key];
    else errors.push(`${key} must be one of ${options.join(", ")}`);
  }
  if (patch.project !== undefined) {
    const project = String(patch.project).trim();
    if (!project) next.project = "";
    else if (!path.isAbsolute(project) || !(await isDirectory(project, statImpl))) errors.push(`Project folder not found: ${project}`);
    else {
      next.project = path.normalize(project);
      next.recentProjects = [next.project, ...current.recentProjects.filter((p) => p !== next.project)].slice(0, 8);
    }
  }
  if (patch.codexModel !== undefined) {
    if (patch.codexModel === "" || /^[a-z0-9][a-z0-9._-]{0,60}$/i.test(patch.codexModel)) next.codexModel = patch.codexModel;
    else errors.push("codexModel looks invalid");
  }
  if (patch.commentOnApps !== undefined) next.commentOnApps = Boolean(patch.commentOnApps);
  if (patch.persona) {
    const { name, traits, notes } = patch.persona;
    if (name !== undefined) {
      const clean = String(name).trim().slice(0, 30);
      if (clean) next.persona.name = clean;
      else errors.push("Name cannot be empty");
    }
    if (traits !== undefined) next.persona.traits = (Array.isArray(traits) ? traits : []).filter((t) => TRAITS[t]).slice(0, 4);
    if (notes !== undefined) next.persona.notes = String(notes).slice(0, 500);
  }
  if (next.target !== "mira" && !next.project && patch.target !== undefined && patch.target !== "mira") {
    errors.push("Pick a project folder before sending messages to an agent");
  }
  return { value: next, errors };
}

/** Models the user's Codex account lists (from Codex's own cache), so the picker offers only working ones. */
export async function codexModels({ home = os.homedir(), read = readFile } = {}) {
  try {
    const cache = JSON.parse(await read(path.join(home, ".codex", "models_cache.json"), "utf8"));
    const models = Array.isArray(cache) ? cache : cache.models || [];
    return models.filter((m) => m.visibility === "list" && m.slug).map((m) => ({ slug: m.slug, name: m.display_name || m.slug }));
  } catch {
    return [];
  }
}

export function createSettings({ file, statImpl = stat } = {}) {
  let data = structuredClone(DEFAULTS);
  let loaded = !file;

  async function load() {
    if (loaded) return data;
    loaded = true;
    try {
      const saved = JSON.parse(await readFile(file, "utf8"));
      data = { ...structuredClone(DEFAULTS), ...saved, persona: { ...DEFAULTS.persona, ...(saved.persona || {}) } };
    } catch {
      // first run: defaults
    }
    return data;
  }

  return {
    load,
    get: () => data,
    async update(patch) {
      await load();
      const { value, errors } = await validateSettings(patch || {}, data, { statImpl });
      if (errors.length) return { ok: false, errors, settings: data };
      data = value;
      if (file) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(data, null, 1), "utf8");
        await rename(`${file}.tmp`, file);
      }
      return { ok: true, settings: data };
    },
    persona: () => buildPersona(data.persona),
  };
}
