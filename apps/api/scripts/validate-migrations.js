import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.resolve(process.cwd(), "prisma/migrations");
const allowlistPath = path.resolve(process.cwd(), "scripts/migration-audit-allowlist.json");
const dangerousPatterns = [
  /DROP\s+TABLE\s+"?User"?/i,
  /DROP\s+TABLE\s+/i,
  /ALTER\s+TABLE\s+.+\s+DROP\s+COLUMN/i,
];

// Os padroes acima descrevem COMANDOS. Aplicados ao arquivo inteiro eles casam tambem com o
// texto dos comentarios — uma migration que explica por escrito que nao remove nada era reprovada
// por dizer isso. Remove comentario respeitando string/identificador/bloco $$, senao um apostrofo
// dentro de um comentario (ou um "--" dentro de uma string) desalinha o resto do arquivo.
function stripSqlComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end; // preserva o \n para nao colar os tokens vizinhos
      continue;
    }
    if (sql.startsWith("/*", i)) {
      let depth = 1; // no PostgreSQL blocos /* */ aninham
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.startsWith("/*", i)) {
          depth += 1;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      out += " ";
      continue;
    }
    const dollarTag = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
    if (dollarTag) {
      const tag = dollarTag[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    const char = sql[i];
    if (char === "'" || char === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === char) {
          if (sql[j + 1] === char) {
            j += 2; // aspas duplicada = aspas escapada, a string continua
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

// A allowlist e um arquivo versionado, com barra normal. No Windows path.relative devolve
// contrabarra e a comparacao nunca casava — as duas entradas listadas eram reprovadas mesmo assim.
function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

if (!fs.existsSync(migrationsDir)) {
  // eslint-disable-next-line no-console
  console.error(`Migrations directory not found: ${migrationsDir}`);
  process.exit(1);
}

const sqlFiles = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(migrationsDir, entry.name, "migration.sql"))
  .filter((filePath) => fs.existsSync(filePath));

const violations = [];
let allowlist = [];
if (fs.existsSync(allowlistPath)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
    if (Array.isArray(parsed)) allowlist = parsed.map((entry) => toPosixPath(String(entry)));
  } catch {
    // ignore malformed allowlist and continue strict
  }
}
for (const filePath of sqlFiles) {
  const relativePath = toPosixPath(path.relative(process.cwd(), filePath));
  if (allowlist.includes(relativePath)) continue;
  const sql = stripSqlComments(fs.readFileSync(filePath, "utf8"));
  for (const pattern of dangerousPatterns) {
    if (pattern.test(sql)) {
      violations.push({
        filePath: relativePath,
        pattern: pattern.toString(),
      });
    }
  }
}

if (violations.length) {
  // eslint-disable-next-line no-console
  console.error("Dangerous migration patterns detected:");
  for (const violation of violations) {
    // eslint-disable-next-line no-console
    console.error(`- ${violation.filePath} matches ${violation.pattern}`);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log("Migration audit passed: no dangerous patterns detected.");

