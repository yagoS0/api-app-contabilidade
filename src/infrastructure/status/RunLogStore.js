import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const LAST_RUN_FILE = path.join(DATA_DIR, "last-run.json");
const SENT_LOG_FILE = path.join(DATA_DIR, "sent-emails.jsonl");

async function ensureDataDir() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

async function readJsonSafe(filePath, fallback) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await ensureDataDir();
  const tmp = filePath + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fsp.rename(tmp, filePath);
}

function defaultState() {
  return {
    kind: null, // "send" | "inbox"
    startedAt: null,
    finishedAt: null,
    running: false,
    error: null, // { message }
    messages: [], // [{ timeISO, to, cliente, mes, subject }]
  };
}

export const RunLogStore = {
  async getLastRun() {
    return readJsonSafe(LAST_RUN_FILE, defaultState());
  },

  async appendEntry(entry) {
    const timeISO = new Date().toISOString();
    const normalized = {
      timeISO,
      ...entry,
    };
    const state = await this.getLastRun();
    state.messages.push(normalized);
    await writeJson(LAST_RUN_FILE, state);
    try {
      await ensureDataDir();
      await fsp.appendFile(SENT_LOG_FILE, JSON.stringify(normalized) + "\n", "utf8");
    } catch {
      // ignore append errors
    }
  },

  async startRun(kind) {
    const state = {
      kind: kind || null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      running: true,
      error: null,
      messages: [],
    };
    await writeJson(LAST_RUN_FILE, state);
  },

  async appendSend({ to, cliente, mes, subject }) {
    await this.appendEntry({ type: "email", status: "sent", to, cliente, mes, subject, reason: "ok" });
  },

  async finishRun({ error } = {}) {
    const state = await this.getLastRun();
    state.running = false;
    state.finishedAt = new Date().toISOString();
    if (error) {
      const message =
        typeof error === "string"
          ? error
          : error && typeof error === "object" && error.message
          ? error.message
          : String(error);
      state.error = { message };
    } else {
      state.error = null;
    }
    await writeJson(LAST_RUN_FILE, state);
  },
};


