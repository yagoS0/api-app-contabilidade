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

// ⚠ ESTA LINHA JÁ MENTIU, E DO PIOR JEITO: afirmando "DESLIGADO" sobre uma produção que estava
// varrendo a carteira 45 vezes por hora.
//
// `DFE_NOTAS_WORKER_ENABLED` é lido do ambiente ONDE O SCRIPT RODA. A receita de uso (topo do
// arquivo) é `railway run --service Postgres`, que injeta as variáveis do **Postgres**, não as do
// serviço da API — a flag vem sempre indefinida, e o script imprimia "a rotina nunca rodou e nenhum
// dado abaixo explica coisa alguma". Quem seguisse isso descartaria justamente a evidência certa.
//
// O que responde "o worker rodou?" é DADO, não flag: cada varredura grava um `NotasCapturaJob`
// com `origem:"automatico"`. É isso que se lê aqui.
const ultimaVarredura = await prisma.notasCapturaJob.findFirst({
  where: { origem: "automatico" },
  orderBy: { createdAt: "desc" },
  select: { createdAt: true },
});
const varredurasUltimaHora = await prisma.notasCapturaJob.count({
  where: { origem: "automatico", createdAt: { gt: new Date(Date.now() - 3600 * 1000) } },
});
console.log(
  ultimaVarredura
    ? `WORKER: rodou — última varredura automática ${idade(ultimaVarredura.createdAt)} atrás · ${varredurasUltimaHora} na última hora`
    : "WORKER: NENHUMA varredura automática registrada — a rotina nunca rodou nesta base (confira DFE_NOTAS_WORKER_ENABLED=1 NO SERVIÇO DA API)",
);
console.log(`(flag lida NESTE ambiente, que pode não ser o da API: ${DFE_NOTAS_WORKER_ENABLED ? "1" : "não definida"}) · intervalo ${DFE_NOTAS_WORKER_INTERVAL_MIN}min\n`);

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
  // ⚠ O VEREDITO SAI DA TENTATIVA (`*LastAttemptAt`), NUNCA DO SYNC (`*LastSyncAt`).
  //
  // `adnLastSyncAt` só é gravado quando CHEGA documento (`persistCursor`). Numa empresa que não
  // emitiu nota ele fica parado para sempre, mesmo com o worker consultando de hora em hora — e
  // este script chegava a acusar "ADN parado há dias" em 13 empresas perfeitamente saudáveis,
  // mandando quem investigasse procurar defeito onde não havia. É a MESMA confusão que o comentário
  // de `PortalSyncState` no schema registra ter custado 29 dias, e que derrubou o gate de 1h em
  // 09/08/2026 (13.000+ consultas/dia até o ADN responder 429).
  //
  // Medido em produção (12/08/2026): 18 empresas com A1, TODAS com `adnLastAttemptAt` de 57 min
  // (o intervalo é 60) e `adnLastSyncAt` de 5 a 9 dias. Nenhuma delas tinha problema nenhum.
  else if (!st.adnLastAttemptAt && !st.dfeLastAttemptAt) veredito = "NUNCA olhada (worker não chegou)";
  else if (minutos(st.adnLastAttemptAt) > 60 * 6) veredito = "⚠ ADN SEM SER OLHADO há horas";
  else if (!st.adnLastSyncAt) veredito = "olhando · nunca veio nota";
  else veredito = "ok";

  linhas.push({
    razao: String(p.razao || "").slice(0, 28),
    cnpj: p.cnpj,
    A1: !legacy.certStorageKey ? "não" : certVencido ? "VENCIDO" : "ok",
    IE: legacy.inscricaoEstadual ? "sim" : "não",
    adnCursor: st.adnNsuCursor ?? "—",
    // ⚠ As DUAS colunas, sempre juntas: "olhou" é o worker rodando, "recebeu" é ter vindo nota.
    // `adnOlhou 57min · adnRecebeu 8d` é uma empresa SAUDÁVEL que não emitiu nada — mostrar só a
    // segunda foi o que fez este script acusar defeito onde não havia.
    adnOlhou: idade(st.adnLastAttemptAt),
    adnRecebeu: idade(st.adnLastSyncAt),
    adnErro: (st.adnLastError || "").slice(0, 40) || "—",
    dfeCursor: st.dfeNsuCursor ?? "—",
    dfeOlhou: idade(st.dfeLastAttemptAt),
    dfeRecebeu: idade(st.dfeLastSyncAt),
    dfeErro: (st.dfeLastError || "").slice(0, 40) || "—",
    veredito,
  });
}

console.table(linhas);

const semA1 = linhas.filter((l) => l.A1 !== "ok").length;
const nunca = linhas.filter((l) => l.veredito.startsWith("NUNCA olhada")).length;
console.log(`\n${linhas.length} empresa(s) · ${semA1} sem A1 válido (essas o worker NUNCA tenta) · ${nunca} nunca olhada(s).`);
console.log("\n⚠ LEIA `adnOlhou`, NÃO `adnRecebeu`, para saber se a captura está rodando.");
console.log("   `adnRecebeu` só se move quando CHEGA documento — empresa que não emitiu nota fica");
console.log("   com ele velho para sempre, e está CORRETA. Foi essa leitura trocada que fez este");
console.log("   script acusar 13 empresas saudáveis de 'ADN parado há dias'.");

await prisma.$disconnect();
