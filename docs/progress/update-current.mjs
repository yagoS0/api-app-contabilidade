import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const PROGRESS_DIR = path.join(ROOT, "docs", "progress");
const CURRENT_FILE = path.join(PROGRESS_DIR, "current.md");

function getArg(name, fallback = "") {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith("--")) return fallback;
  return String(value);
}

function parseList(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return raw.split(/[|,]/).map((item) => String(item).trim()).filter(Boolean);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateTimeStamp(date) {
  return `${formatDate(date)}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function sectionList(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

const now = new Date();
const title = getArg("title", "Progress Update");
const date = getArg("date", formatDate(now));
const backend = parseList(getArg("backend", ""));
const frontend = parseList(getArg("frontend", ""));
const how = parseList(getArg("how", ""));
const notes = parseList(getArg("notes", ""));
const latestSnapshot = `${formatDateTimeStamp(now)}.md`;
const change = getArg("change", "Update registrado pelo script de progresso.");

const whereItChanged = sectionList([
  ...backend.map((item) => `Backend: ${item}`),
  ...frontend.map((item) => `Frontend: ${item}`),
]);

const snapshotContent = `# ${title}\n\nDate: ${date}\n\n## Latest Change\n\n${change}\n\n## Where it changed\n\n${whereItChanged}\n\n## How it was done\n\n${sectionList(how)}\n\n## Notes\n\n${sectionList(notes)}\n`;

const currentContent = `# Current Progress\n\nDate: ${date}\n\nLatest snapshot: \`${latestSnapshot}\`\n\n## Latest Change\n\n${change}\n\n## Where it changed\n\n${whereItChanged}\n\n## How it was done\n\n${sectionList(how)}\n\n## Notes\n\n${sectionList(notes)}\n`;

await mkdir(PROGRESS_DIR, { recursive: true });
await writeFile(path.join(PROGRESS_DIR, latestSnapshot), `${snapshotContent}\n`, "utf8");
await writeFile(CURRENT_FILE, `${currentContent}\n`, "utf8");

process.stdout.write(`${path.join("docs", "progress", "current.md")} updated\n`);
