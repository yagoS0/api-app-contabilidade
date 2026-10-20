import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";

const url = new URL(process.argv[2] || "about:blank");
assert.equal(process.env.AJUSTES_LOCAL_CHECK, "1", "Exige AJUSTES_LOCAL_CHECK=1");
assert(["postgres:", "postgresql:"].includes(url.protocol));
assert(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
assert.equal(url.pathname, "/ajustes_governance_test");
assert.equal(decodeURIComponent(url.username), "ajustes_test");
process.env.DATABASE_URL = url.toString();
const semRede = () => { throw new Error("HTTP externo proibido neste ensaio"); };
http.request = http.get = https.request = https.get = globalThis.fetch = semRede;
const { prisma } = await import("../src/infrastructure/db/prisma.js");
const { aplicarTransicao } = await import("../src/application/declarados/DeclaradoService.js");
const { retomarAtendimento } = await import("../src/application/onboarding/OnboardingService.js");
const id = randomUUID(), onboardingId = randomUUID(), competencia = "2026-09";
const ator = { id: `teste-${id}`, role: "contador", accountType: "FIRM" };
const args = declaradoId => ({ portalClientId: id, declaradoId, transicao: "CONFIRMAR",
  dados: { contaAplicada: "411020008" }, usuarioId: ator.id, agora: new Date(), client: prisma });
try {
  await prisma.portalClient.create({ data: { id, razao: "Fixture descartável", cnpj: id.replace(/\D/g, "").padEnd(14, "0").slice(0, 14) } });
  await prisma.chartOfAccount.createMany({ data: [
    { portalClientId: id, codigo: "5", codigoCompleto: "111010001", nome: "Caixa", tipo: "ATIVO", analitica: true },
    { portalClientId: id, codigo: "464", codigoCompleto: "411020008", nome: "Despesa", tipo: "DESPESA", analitica: true },
  ] });
  const criar = () => prisma.lancamentoDeclarado.create({ data: {
    portalClientId: id, origem: "CLIENTE_MANUAL", estado: "A_CONFERIR", tipo: "SAIDA",
    competencia, valor: 100, descricaoOriginal: "Teste", descricaoNormalizada: "TESTE",
    dataPagamento: new Date("2026-09-20T00:00:00Z"), origemPagamento: "OFX",
    criadoPor: ator.id, hashDedupe: randomUUID(),
  } });
  const declarado = await criar();
  const concorrentes = await Promise.allSettled([aplicarTransicao(args(declarado.id)), aplicarTransicao(args(declarado.id))]);
  assert.equal(concorrentes.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await prisma.accountingEntry.count({ where: { portalClientId: id } }), 1);
  const salvo = await prisma.lancamentoDeclarado.findUnique({ where: { id: declarado.id } });
  assert(salvo.accountingEntryId);
  console.log("PASS: duas aplicações simultâneas geram uma única partida");

  const circular = await prisma.companyMonthlyCircular.create({ data: { portalClientId: id, competencia } });
  const segundo = await criar();
  // Pausa depois da leitura transacional de fechamento. O fechamento concorrente lê o razão
  // e escreve a circular, reproduzindo o conflito de predicados do protocolo Serializable.
  let liberar, avisar;
  const lido = new Promise(resolve => { avisar = resolve; });
  const seguir = new Promise(resolve => { liberar = resolve; });
  const client = new Proxy(prisma, { get(target, key) {
    if (key !== "$transaction") return target[key];
    return (fn, options) => target.$transaction(async tx => fn(new Proxy(tx, { get(t, k) {
      if (k !== "companyMonthlyCircular") return t[k];
      return { ...t[k], findUnique: async input => {
        const r = await t[k].findUnique(input); avisar(); await seguir; return r;
      } };
    } })), options);
  } });
  const aplicacao = aplicarTransicao({ ...args(segundo.id), client }).then(() => ({ ok: true }), erro => ({ erro }));
  await lido;
  try {
    await prisma.$transaction(async tx => {
      await tx.accountingEntry.findMany({ where: { portalClientId: id, competencia } });
      await tx.companyMonthlyCircular.update({ where: { id: circular.id }, data: { fechadoContabilEm: new Date() } });
    }, { isolationLevel: "Serializable" });
  } finally { liberar(); }
  assert((await aplicacao).erro, "A aplicação deve abortar ao perder a corrida com o fechamento");
  assert.equal(await prisma.accountingEntry.count({ where: { portalClientId: id } }), 1);
  console.log("PASS: fechamento concorrente preservado sem nova partida");

  await prisma.onboarding.create({ data: { id: onboardingId, origem: "TRANSFERENCIA", status: "DESISTIU", versao: 2,
    motivoDesistencia: "Histórico", eventos: { create: { tipo: "DESISTIU", dados: { motivo: "Histórico" } } },
    links: { create: { tokenHash: randomUUID(), expiresAt: new Date("2099-01-01"), criadoPorId: ator.id } } } });
  const retomadas = await Promise.all([
    retomarAtendimento(onboardingId, { user: ator, motivo: "Retomar fixture", versao: 2 }, prisma),
    retomarAtendimento(onboardingId, { user: ator, motivo: "Retomar fixture", versao: 2 }, prisma),
  ]);
  assert(retomadas.every(r => r.status === "RASCUNHO" && r.versao === 3));
  assert.equal(await prisma.onboardingEvento.count({ where: { onboardingId, tipo: "ATENDIMENTO_RETOMADO" } }), 1);
  assert.equal(await prisma.onboardingLink.count({ where: { onboardingId, revokedAt: null } }), 0);
  assert.equal(await prisma.onboardingEvento.count({ where: { onboardingId, tipo: "DESISTIU" } }), 1);
  console.log("PASS: retomada concorrente idempotente, links revogados e histórico preservado");
} finally {
  await prisma.onboarding.deleteMany({ where: { id: onboardingId } });
  await prisma.portalClient.deleteMany({ where: { id } });
  await prisma.$disconnect();
}
