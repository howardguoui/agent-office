import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Long-term memory on the user's disk: one-sentence session summaries, facts the user asked her to
// remember, and the recent chat. Stored as a single JSON file and written atomically.

const EMPTY = () => ({ sessions: [], facts: [], chat: [] });
const LIMITS = { sessions: 200, facts: 100, chat: 30 };

export function createMemory({ file } = {}) {
  let data = EMPTY();
  let loaded = !file;
  let writing = Promise.resolve();

  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const parsed = JSON.parse(await readFile(file, "utf8"));
      data = { ...EMPTY(), ...parsed };
    } catch {
      data = EMPTY();
    }
  }

  function save() {
    if (!file) return Promise.resolve();
    const snapshot = JSON.stringify(data, null, 1);
    writing = writing.then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.tmp`;
      await writeFile(temp, snapshot, "utf8");
      await rename(temp, file);
    }).catch(() => {});
    return writing;
  }

  function push(kind, entry) {
    data[kind].push(entry);
    if (data[kind].length > LIMITS[kind]) data[kind].splice(0, data[kind].length - LIMITS[kind]);
  }

  return {
    load,
    async addSession(entry) { await load(); push("sessions", entry); await save(); },
    async addFact(text, at = new Date().toISOString()) { await load(); push("facts", { at, text }); await save(); },
    async addChat(role, text, at = new Date().toISOString()) { await load(); push("chat", { at, role, text }); await save(); },
    /** What a reply should know: recent sessions (preferring this project), facts, recent chat. */
    async recall({ project = "", sessions = 5, chat = 8 } = {}) {
      await load();
      const sameProject = project ? data.sessions.filter((s) => s.project === project) : [];
      const recent = [...new Set([...sameProject.slice(-3), ...data.sessions.slice(-sessions)])].slice(-sessions);
      return { sessions: recent, facts: data.facts.slice(-20), chat: data.chat.slice(-chat) };
    },
    async stats() {
      await load();
      return { sessions: data.sessions.length, facts: data.facts.length, chat: data.chat.length };
    },
    flush: () => writing,
  };
}
