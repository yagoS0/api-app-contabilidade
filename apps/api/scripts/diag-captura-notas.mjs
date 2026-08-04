// Por que a captura de notas não trouxe nada — SOMENTE LEITURA, zero chamada externa.
//
// A rotina automática (`workers/dfeNotasWorker.js`) parou de trazer notas e ninguém percebeu. Ela
// falha em silêncio por construção: empresa sem certificado é descartada dentro de um `filter`
// (`listEligibleCompanies`), empresa dentro do intervalo vira um `skipped` que só existe em
// memória, e — diferente dos workers SERPRO — ela NÃO grava log de execução no banco. Sobrou o
// estado por empresa em `PortalSyncState`, e é ele que este script lê.
//
// ⚠ ANTES DE OLHAR QUALQUER LINHA AQUI: confira se `DFE_NOTAS_WORKER_ENABLED=1` está setada no
// ambiente. Se não estiver, a rotina nunca rodou e nenhum dado abaixo explica coisa alguma.
//
// Uso:
//   node scripts/diag-captura-notas.mjs           # todas as empresas
//   node scripts/diag-captura-notas.mjs 12345678  # filtra por trecho de CNPJ ou razão

import { prisma } from "../src/infrastructure/db/prisma.js";
import { DFE_NOTAS_WORKER_ENABLED, DFE_NOTAS_WORKER_INTERVAL_MIN } from "../src/config.js";

const filtro = String(process.argv[2] || "").replace(/\D/g, "") || String(process.argv[2] || "");

const portals = await prisma.portalClient.findMany({
  where: { cnpj: { not: "" } },
  select: { id: true, razao: true, cnpj: true, status: true, companyId: true },
  orderBy: { razao: "asc" },
});

const companyIds = portals.map((p) => p.companyId).filter(Boolean);
const companies = companyIds.length
  ? await prisma.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, certStorageKey: true, certExpiresAt: true, inscricaoEstadual: true },
  })
  : [];
const legacyById = new Map(companies.map((c) => [c.id, c]));

const estados = await prisma.portalSyncState.findMany({
  where: { clientId: { in: portals.map((p) => p.id) } },
});
const estadoById = new Map(estados.map((e) => [e.clientId, e]));

const minutos = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 60000) : null);
const idade = (d) => {
  const m = minutos(d);
  if (m == null) return "NUNCA";
  if (m < 60) return `${m}min`;
  if (m < 60 * 48) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
};

console.log(`WORKER: ${DFE_NOTAS_WORKER_ENABLED ? "ligado" : "DESLIGADO (DFE_NOTAS_WORKER_ENABLED != 1)"} · intervalo ${DFE_NOTAS_WORKER_INTERVAL_MIN}min\n`);

const linhas = [];
for (const p of portals) {
  if (filtro && !p.cnpj?.includes(filtro) && !String(p.razao || "").toLowerCase().includes(String(process.argv[2] || "").toLowerCase())) continue;
  const legacy = legacyById.get(p.companyId) || {};
  const st = estadoById.get(p.id) || {};
  const certVencido = legacy.certExpiresAt && new Date(legacy.certExpiresAt) < new Date();

  // O DIAGNÓSTICO, em uma palavra. É a coluna que responde "por que esta empresa não trouxe nada".
  let veredito;
  if (p.status === "SUSPENSA") veredito = "SUSPENSA";
  else if (!legacy.certStorageKey) veredito = "SEM A1 → worker PULA em silêncio";
  else if (certVencido) veredito = "A1 VENCIDO → worker PULA em silêncio";
  else if (st.adnBackoffUntil && new Date(st.adnBackoffUntil) > new Date()) veredito = "ADN em backoff";
  else if (st.dfeBackoffUntil && new Date(st.dfeBackoffUntil) > new Date()) veredito = "DFe em backoff";
  else if (!st.adnLastSyncAt && !st.dfeLastSyncAt) veredito = "NUNCA sincronizada";
  else if (minutos(st.adnLastSyncAt) > 60 * 24 * 3) veredito = "ADN parado há dias";
  else veredito = "ok";

  linhas.push({
    razao: String(p.razao || "").slice(0, 28),
    cnpj: p.cnpj,
    A1: !legacy.certStorageKey ? "não" : certVencido ? "VENCIDO" : "ok",
    IE: legacy.inscricaoEstadual ? "sim" : "não",
    adnCursor: st.adnNsuCursor ?? "—",
    adnSync: idade(st.adnLastSyncAt),
    adnErro: (st.adnLastError || "").slice(0, 40) || "—",
    dfeCursor: st.dfeNsuCursor ?? "—",
    dfeSync: idade(st.dfeLastSyncAt),
    dfeErro: (st.dfeLastError || "").slice(0, 40) || "—",
    veredito,
  });
}

console.table(linhas);

const semA1 = linhas.filter((l) => l.A1 !== "ok").length;
const nunca = linhas.filter((l) => l.veredito === "NUNCA sincronizada").length;
console.log(`\n${linhas.length} empresa(s) · ${semA1} sem A1 válido (essas o worker NUNCA tenta) · ${nunca} nunca sincronizada(s).`);
console.log("Empresa com `adnSync: NUNCA` e `adnErro: —` não falhou na captura — o worker não chegou nela.");

await prisma.$disconnect();
