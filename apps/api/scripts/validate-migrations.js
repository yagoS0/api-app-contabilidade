import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.resolve(process.cwd(), "prisma/migrations");
const allowlistPath = path.resolve(process.cwd(), "scripts/migration-audit-allowlist.json");
const dangerousPatterns = [
  /DROP\s+TABLE\s+"?User"?/i,
  /DROP\s+TABLE\s+/i,
  /ALTER\s+TABLE\s+.+\s+DROP\s+COLUMN/i,
];

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
    if (Array.isArray(parsed)) allowlist = parsed.map((entry) => String(entry));
  } catch {
    // ignore malformed allowlist and continue strict
  }
}
for (const filePath of sqlFiles) {
  const relativePath = path.relative(process.cwd(), filePath);
  if (allowlist.includes(relativePath)) continue;
  const sql = fs.readFileSync(filePath, "utf8");
  for (const pattern of dangerousPatterns) {
    if (pattern.test(sql)) {
      violations.push({
        filePath,
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

