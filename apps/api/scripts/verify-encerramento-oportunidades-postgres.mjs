// Somente PostgreSQL descartável já migrado. Não carrega .env nem inicia workers.
// node apps/api/scripts/verify-encerramento-oportunidades-postgres.mjs <URL>
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { setTimeout as esperar } from "node:timers/promises";

const url = new URL(process.argv[2] || "");
assert(url.protocol === "postgresql:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  && /^\/[a-z0-9_]+_governance_test$/.test(url.pathname), "Exige PostgreSQL loopback descartável _governance_test");
assert([...url.searchParams.keys()].every(k => ["schema", "connection_limit", "pool_timeout"].includes(k)), "Parâmetros não permitidos");
// As corridas precisam de conexões independentes, inclusive para observar a espera.
url.searchParams.set("connection_limit", "5");
Object.assign(process.env, { DATABASE_URL: url.href, NODE_ENV: "test", LOG_LEVEL: "fatal",
  INTEGRACAO_WHATSAPP: "0", INTEGRACAO_WHATSAPP_IA: "0", INTEGRACAO_IA_COMERCIAL: "0",
  IA_LEADS_OPENAI: "0", INTEGRACAO_FISCAL_LEADS: "0", GUIDE_STORAGE_PROVIDER: "LOCAL" });
let rede = 0;
const semRede = () => { rede++; throw Error("Rede externa proibida"); };
globalThis.fetch = http.get = http.request = https.get = https.request = semRede;
const { prisma: db } = await import("../src/infrastructure/db/prisma.js");
const { descartar, desistir, elegibilidadeDescarte, VINCULOS_DESCARTE } = await import("../src/application/onboarding/OnboardingService.js");
const transaction = db.$transaction.bind(db);
const findUnique = db.onboarding.findUnique.bind(db.onboarding);
const run = `encerramento-${crypto.randomUUID()}`, checks = [];
const ok = nome => { checks.push(nome); console.log("OK", nome); };
const barreira = () => { let liberar; const promessa = new Promise(r => { liberar = r; }); return { promessa, liberar }; };
const resultado = p => p.then(valor => ({ valor }), erro => ({ erro }));
const limite = p => Promise.race([p, esperar(12000, null, { ref: false }).then(() => { throw Error("Barreira excedeu 12s"); })]);
let indice = 0;
const fixture = patch => db.onboarding.create({ data: { id: `${run}-${++indice}`, origem: "ABERTURA",
  responsavelNome: "Contato sintético", ...patch } });
const dadosProposta = id => ({ onboardingId: id, versao: 1, fichaVersao: 0, snapshot: {}, expiraEm: new Date("2030-01-01") });
const criadores = {
  atendimentoLead: async (tx, id) => {
    const conversa = await tx.conversaWhatsapp.create({ data: { telefoneE164: `fixture-${id}`, chaveEscopo: `fixture-${id}` } });
    return tx.atendimentoLead.create({ data: { onboardingId: id, conversaId: conversa.id } });
  },
  propostaComercial: (tx, id) => tx.propostaComercial.create({ data: dadosProposta(id) }),
  contratoComercial: async (tx, id) => {
    const proposta = await tx.propostaComercial.create({ data: dadosProposta(id) });
    return tx.contratoComercial.create({ data: { onboardingId: id, propostaId: proposta.id, modeloId: "fixture",
      texto: "Contrato sintético sem assinatura", dados: {} } });
  },
  documentoOnboarding: (tx, id) => tx.documentoOnboarding.create({ data: { onboardingId: id,
    nome: "fixture.txt", mime: "text/plain", conteudoCifrado: "fixture-inerte", sha256: "0".repeat(64), criadoPor: run } }),
  trabalhoFiscalLead: (tx, id) => tx.trabalhoFiscalLead.create({ data: { onboardingId: id,
    cnpj: "00000000000000", tipo: "FIXTURE", status: "CONCLUIDO", criadoPor: run } }),
  fichaEmpresaAvulsa: (tx, id) => tx.fichaEmpresaAvulsa.create({ data: { onboardingId: id, dados: {} } }),
  onboardingAnalise: (tx, id) => tx.onboardingAnalise.create({ data: { onboardingId: id,
    tipo: "PUBLICA", status: "CONCLUIDA", cnpj: "00000000000000", criadoPorId: run } }),
  onboardingLink: (tx, id) => tx.onboardingLink.create({ data: { onboardingId: id,
    tokenHash: crypto.randomBytes(32).toString("hex"), expiresAt: new Date("2000-01-01"), criadoPorId: run } }),
  onboardingEtapa: (tx, id) => tx.onboardingEtapa.create({ data: { onboardingId: id, chave: "fixture", titulo: "Etapa sintética", ordem: 1 } }),
  onboardingEvento: (tx, id) => tx.onboardingEvento.create({ data: { onboardingId: id, tipo: "DEMANDA_ORIGEM" } }),
};
// Aguarda prova do bloqueio real no PostgreSQL, não um atraso presumido.
async function esperarLock(pid) {
  const inicio = Date.now();
  while (Date.now() - inicio < 8000) {
    const [estado] = await db.$queryRaw`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`;
    if (estado?.wait_event_type === "Lock") return;
    await esperar(20);
  }
  throw Error(`Não observou lock do backend ${pid}`);
}
function interceptarLock(antes, depois) {
  db.$transaction = (fn, options) => transaction(async tx => fn(new Proxy(tx, {
    get(alvo, chave) {
      if (chave === "$queryRaw") return async (...args) => {
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
        await antes?.(pid);
        const r = await tx.$queryRaw(...args);
        await depois?.();
        return r;
      };
      const valor = alvo[chave];
      return typeof valor === "function" ? valor.bind(alvo) : valor;
    },
  })), { ...options, timeout: 20000, maxWait: 15000 });
}
try {
  await db.$queryRaw`SELECT 1`;
  assert.deepEqual(Object.keys(criadores).filter(k => k !== "onboardingEvento").sort(), VINCULOS_DESCARTE.map(([k]) => k).sort());
  const vazio = await fixture();
  assert.deepEqual((await elegibilidadeDescarte(vazio.id)).impedimentos, []);
  await assert.rejects(descartar(vazio.id, { versao: 7 }), e => e.code === "formulario_alterado");
  assert.deepEqual(await descartar(vazio.id, { versao: 0 }), { ok: true });
  await assert.rejects(descartar(vazio.id, { versao: 0 }), e => e.status === 404);
  assert.equal(await db.onboarding.findUnique({ where: { id: vazio.id } }), null);
  ok("Vazio elegível, versão antiga bloqueada, exclusão persistida e repetição sem efeito");
  for (const [modelo, criarVinculo] of Object.entries(criadores)) {
    const ficha = await fixture();
    assert.equal((await elegibilidadeDescarte(ficha.id)).podeExcluir, true);
    const filho = await criarVinculo(db, ficha.id);
    const previa = await elegibilidadeDescarte(ficha.id);
    assert.equal(previa.podeExcluir, false, modelo);
    const rotulo = VINCULOS_DESCARTE.find(([k]) => k === modelo)?.[1] || "Histórico do atendimento";
    assert(previa.impedimentos.includes(rotulo), modelo);
    await assert.rejects(descartar(ficha.id, { versao: 0 }), e => e.code === "atendimento_tem_historico" && e.status === 409);
    assert(await db[modelo].findUnique({ where: { id: filho.id } }));
    const encerrada = await desistir(ficha.id, { versao: 0, motivo: "Ensaio", atorId: run });
    assert.equal(encerrada.status, "DESISTIU");
    assert(await db[modelo].findUnique({ where: { id: filho.id } }), "Encerrar preserva o vínculo");
    await desistir(ficha.id, { versao: 0, motivo: "Não substituir", atorId: run });
    const salva = await db.onboarding.findUnique({ where: { id: ficha.id } });
    assert.equal(salva.motivoDesistencia, "Ensaio"); assert.equal(salva.versao, 1);
    assert.equal(await db.onboardingEvento.count({ where: { onboardingId: ficha.id, tipo: "DESISTIU" } }), 1);
    ok(`${modelo}: prévia, revalidação, encerramento e histórico preservado`);
  }
  for (const patch of [{ convertidoEm: new Date() }, { proposta: {} }, { enviadoEm: new Date() },
    { origemPreenchimento: "CLIENTE" }, { fontesDados: { nome: "CLIENTE" } },
    { desistiuEm: new Date() }, { faseComercial: "CONTRATADO" }, { status: "RECEBIDO" }]) {
    const ficha = await fixture(patch);
    assert.equal((await elegibilidadeDescarte(ficha.id)).podeExcluir, false);
    await assert.rejects(descartar(ficha.id, { versao: 0 }), e => e.status === 409);
    assert(await db.onboarding.findUnique({ where: { id: ficha.id } }));
  }
  const portal = await db.portalClient.create({ data: { id: `${run}-portal`, razao: "Empresa sintética",
    cnpj: `${crypto.randomInt(10000000, 99999999)}000199` } });
  const vinculada = await fixture({ portalClientId: portal.id });
  await assert.rejects(descartar(vinculada.id, { versao: 0 }), e => e.code === "atendimento_tem_historico");
  assert(await db.portalClient.findUnique({ where: { id: portal.id } }));
  ok("Marcos escalares e empresa impedem exclusão");

  const rollback = await fixture();
  db.$transaction = (fn, options) => transaction(async tx => {
    await fn(tx);
    throw Object.assign(new Error("Falha sintética antes do commit"), { code: "P2003" });
  }, options);
  await assert.rejects(descartar(rollback.id, { versao: 0 }), e => e.code === "atendimento_tem_historico" && e.status === 409);
  db.$transaction = transaction;
  assert(await db.onboarding.findUnique({ where: { id: rollback.id } }), "Rollback restaura ficha apagada dentro da transação");
  ok("Falha após delete reverte a transação e retorna conflito recuperável");

  const obsoleta = await fixture(), esperando = barreira(), continuar = barreira();
  interceptarLock(async () => { esperando.liberar(); await limite(continuar.promessa); });
  const descarteObsoleto = resultado(descartar(obsoleta.id, { versao: 0 }));
  try {
    await limite(esperando.promessa);
    await db.onboarding.update({ where: { id: obsoleta.id }, data: { versao: { increment: 1 } } });
  } finally { continuar.liberar(); }
  assert.equal((await descarteObsoleto).erro?.code, "formulario_alterado");
  db.$transaction = transaction;
  assert.equal((await db.onboarding.findUnique({ where: { id: obsoleta.id } })).versao, 1);
  ok("Versão alterada entre leitura e lock impede exclusão");

  // Duas desistências leem exatamente a mesma revisão antes de disputar o CAS.
  const concorrente = await fixture(), ambas = barreira(); let leituras = 0;
  db.onboarding.findUnique = async args => {
    const lida = await findUnique(args);
    if (args.where.id === concorrente.id && leituras < 2) {
      if (++leituras === 2) ambas.liberar();
      await limite(ambas.promessa);
    }
    return lida;
  };
  const disputas = await Promise.all([1, 2].map(() => resultado(desistir(concorrente.id, { versao: 0, atorId: run }))));
  db.onboarding.findUnique = findUnique;
  assert.equal(disputas.filter(r => r.valor).length, 1);
  assert.equal(disputas.find(r => r.erro)?.erro.code, "formulario_alterado");
  assert.equal(await db.onboardingEvento.count({ where: { onboardingId: concorrente.id, tipo: "DESISTIU" } }), 1);
  ok("Desistências concorrentes: um evento, um conflito recuperável");

  for (const modelo of ["onboardingEvento", "documentoOnboarding"]) {
    // Filho confirma primeiro: FK mantém KEY SHARE, descarte espera FOR UPDATE.
    const ficha = await fixture(), inseriu = barreira(), soltarFilho = barreira(), tentouLock = barreira();
    const filhoPendente = resultado(transaction(async tx => {
      const filho = await criadores[modelo](tx, ficha.id);
      inseriu.liberar(); await limite(soltarFilho.promessa); return filho;
    }, { timeout: 20000 }));
    await limite(inseriu.promessa);
    interceptarLock(pid => tentouLock.liberar(pid));
    const descarte = resultado(descartar(ficha.id, { versao: 0 }));
    try { await esperarLock(await limite(tentouLock.promessa)); }
    finally { soltarFilho.liberar(); }
    const [filho, removida] = await Promise.all([filhoPendente, descarte]);
    db.$transaction = transaction;
    assert.ifError(filho.erro);
    assert.equal(removida.erro?.code, "atendimento_tem_historico");
    assert(await db[modelo].findUnique({ where: { id: filho.valor.id } }));
    assert(await db.onboarding.findUnique({ where: { id: ficha.id } }));
    ok(`${modelo}: filho confirma primeiro, descarte preserva histórico`);

    // Descarte trava primeiro: novo filho espera e é recusado pela FK após delete.
    const outra = await fixture(), travou = barreira(), soltarPai = barreira(), tentouFilho = barreira();
    interceptarLock(null, async () => { travou.liberar(); await limite(soltarPai.promessa); });
    const paiPendente = resultado(descartar(outra.id, { versao: 0 }));
    await limite(travou.promessa);
    const novoFilho = resultado(transaction(async tx => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      tentouFilho.liberar(pid);
      return criadores[modelo](tx, outra.id);
    }, { timeout: 20000 }));
    try { await esperarLock(await limite(tentouFilho.promessa)); }
    finally { soltarPai.liberar(); }
    const [pai, insercao] = await Promise.all([paiPendente, novoFilho]);
    db.$transaction = transaction;
    assert.ifError(pai.erro); assert.deepEqual(pai.valor, { ok: true });
    assert.equal(insercao.erro?.code, "P2003");
    assert.equal(await db[modelo].count({ where: { onboardingId: outra.id } }), 0);
    assert.equal(await db.onboarding.findUnique({ where: { id: outra.id } }), null);
    ok(`${modelo}: descarte confirma primeiro, insert recusado sem histórico perdido`);
  }
  assert.equal(rede, 0);
  console.log(JSON.stringify({ run, checks, tentativasRede: rede,
    limites: ["Fixtures conservadas exclusivamente no banco descartável", "Permissão e escopo HTTP cobertos nas suítes de rotas", "QA visual e revisão independente pelo Principal"] }, null, 2));
} finally {
  db.$transaction = transaction; db.onboarding.findUnique = findUnique;
  await db.$disconnect();
}
