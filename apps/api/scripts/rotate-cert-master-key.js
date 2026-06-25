// Q30 Fase 1 — Rotação da chave-mestra dos certificados (CERT_SECRET_KEY).
//
// Recifra SENHA e o próprio PFX de TODOS os registros (Company.cert* + AppSetting do SERPRO)
// de uma chave ANTIGA para uma NOVA. Também faz a 1ª cifragem de dados ainda em claro (legado).
//
// Uso:
//   CERT_SECRET_KEY_OLD="<chave atual>" CERT_SECRET_KEY_NEW="<chave nova>" \
//     node apps/api/scripts/rotate-cert-master-key.js [--dry]
//
//   - A chave ANTIGA é a que cifra os dados hoje: o valor de CERT_SECRET_KEY, ou (se nunca setada)
//     o JWT_SECRET (fallback atual). A NOVA é a forte que você vai colocar no Railway.
//   - --dry: só conta o que mudaria, sem gravar.
//
// IMPORTANTE: rode com BACKUP feito antes (~/backups/pg-backup.sh). É idempotente: registros já na
// chave NOVA são pulados. Rode ANTES de remover o fallback JWT (item 1.2).

import crypto from "node:crypto";
import { prisma } from "../src/infrastructure/db/prisma.js";

const OLD = process.env.CERT_SECRET_KEY_OLD || "";
const NEW = process.env.CERT_SECRET_KEY_NEW || "";
const DRY = process.argv.includes("--dry");

if (!OLD || !NEW) {
  console.error("Defina CERT_SECRET_KEY_OLD e CERT_SECRET_KEY_NEW no ambiente.");
  process.exit(1);
}
if (NEW.length < 32) {
  console.error("CERT_SECRET_KEY_NEW deve ter >= 32 caracteres (use: openssl rand -base64 48).");
  process.exit(1);
}

const keyOf = (s) => crypto.createHash("sha256").update(String(s), "utf8").digest();
const kOld = keyOf(OLD);
const kNew = keyOf(NEW);
const SERPRO_KEY = "serpro_runtime_settings";
const MAGIC = Buffer.from("PFXENCv1:", "utf8");

// ── strings (senha / consumerSecret) — formato v1:iv:tag:cipher ──
function decStr(enc, key) {
  const parts = String(enc).split(":");
  const [, ivB, tagB, dataB] = parts;
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
  d.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([d.update(Buffer.from(dataB, "base64")), d.final()]).toString("utf8");
}
function encStr(plain, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}
const isStrFmt = (s) => typeof s === "string" && s.split(":").length === 4 && s.startsWith("v1:");
// Recifra string: legado em claro → cifra com NEW; já cifrada → OLD→NEW (pula se já em NEW).
function recryptStr(value) {
  if (value == null || value === "") return { value, changed: false };
  const s = String(value);
  if (!isStrFmt(s)) return { value: encStr(s, kNew), changed: true };
  try { decStr(s, kNew); return { value: s, changed: false }; } catch { /* não é NEW */ }
  return { value: encStr(decStr(s, kOld), kNew), changed: true };
}

// ── bytes (PFX) — MAGIC ++ iv(12) ++ tag(16) ++ cipher ──
const isEncBytes = (b) => Buffer.isBuffer(b) && b.length >= MAGIC.length && b.subarray(0, MAGIC.length).equals(MAGIC);
function decBytes(buf, key) {
  let o = MAGIC.length;
  const iv = buf.subarray(o, o + 12); o += 12;
  const tag = buf.subarray(o, o + 16); o += 16;
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(o)), d.final()]);
}
function encBytes(buf, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}
function recryptBytes(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { value: buf, changed: false };
  if (!isEncBytes(buf)) return { value: encBytes(buf, kNew), changed: true }; // legado em claro
  try { decBytes(buf, kNew); return { value: buf, changed: false }; } catch { /* não é NEW */ }
  return { value: encBytes(decBytes(buf, kOld), kNew), changed: true };
}

async function run() {
  let companies = 0; let serpro = 0;

  // 1) Certificados por empresa (Company)
  const list = await prisma.company.findMany({
    where: { OR: [{ certPfxBytes: { not: null } }, { certPasswordEnc: { not: null } }] },
    select: { id: true, certPfxBytes: true, certPasswordEnc: true },
  });
  for (const c of list) {
    const pwd = recryptStr(c.certPasswordEnc);
    const pfx = c.certPfxBytes
      ? recryptBytes(Buffer.isBuffer(c.certPfxBytes) ? c.certPfxBytes : Buffer.from(c.certPfxBytes))
      : { value: c.certPfxBytes, changed: false };
    if (!pwd.changed && !pfx.changed) continue;
    companies++;
    if (!DRY) {
      // eslint-disable-next-line no-await-in-loop
      await prisma.company.update({
        where: { id: c.id },
        data: { certPasswordEnc: pwd.value, certPfxBytes: pfx.value },
      });
    }
  }

  // 2) Certificado + secret do escritório (AppSetting serpro_runtime_settings)
  const setting = await prisma.appSetting.findUnique({ where: { key: SERPRO_KEY } });
  if (setting?.value && typeof setting.value === "object") {
    const v = { ...setting.value };
    let changed = false;
    for (const f of ["certPasswordEnc", "consumerSecretEnc"]) {
      if (v[f]) { const r = recryptStr(v[f]); if (r.changed) { v[f] = r.value; changed = true; } }
    }
    if (v.certPfxBase64) {
      const r = recryptBytes(Buffer.from(v.certPfxBase64, "base64"));
      if (r.changed) { v.certPfxBase64 = r.value.toString("base64"); changed = true; }
    }
    if (changed) { serpro = 1; if (!DRY) await prisma.appSetting.update({ where: { key: SERPRO_KEY }, data: { value: v } }); }
  }

  console.log(`${DRY ? "[DRY] " : ""}Rotação concluída: ${companies} empresa(s) recifrada(s), SERPRO ${serpro ? "recifrado" : "sem mudança"}.`);
}

run()
  .catch((err) => { console.error("Erro na rotação:", err?.message || err); process.exit(2); })
  .finally(() => prisma.$disconnect());
