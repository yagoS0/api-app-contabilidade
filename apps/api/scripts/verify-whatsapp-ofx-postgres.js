// Rota real + PostgreSQL descartável. Nenhuma integração externa; .env explicitamente desativado.
// node scripts/verify-whatsapp-ofx-postgres.js --url postgresql://whatsapp_check@127.0.0.1:55439/whatsapp_delivery_check
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import express from "express";
import request from "supertest";

const arg = process.argv.indexOf("--url");
const url = new URL(arg >= 0 ? process.argv[arg + 1] : "invalid:");
if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55439"
  || url.pathname !== "/whatsapp_delivery_check" || url.username !== "whatsapp_check") throw new Error("Somente base descartável whatsapp_delivery_check em 127.0.0.1:55439.");
process.env.DATABASE_URL = url.href;
process.env.DOTENV_CONFIG_PATH = resolve(`.env-inexistente-teste-${randomUUID()}`);
process.env.LOG_LEVEL = "silent";
const { prisma } = await import("../src/infrastructure/db/prisma.js");
const { createAccountingEntriesRouter } = await import("../src/routes/firm/accountingEntries.js");
const log = { info() {}, warn() {}, error() {}, debug() {} };
const app = express();
app.use(express.json());
// Somente a identidade de teste é injetada. Middleware de acesso, rota e transações são reais.
app.use((req, _res, next) => { req.auth = { user: { role: "admin" } }; next(); });
app.use("/companies/:companyId", createAccountingEntriesRouter({ log }));
const empresas = [];
const arquivos = [];
const conversas = [];
let verificacoes = 0;
const ok = (nome) => console.log(`OK ${++verificacoes}: ${nome}`);
const linha = { rowIndex: 0, data: "2026-09-01", historico: "Importação sintética", contaDebito: "D_TESTE", contaCredito: "C_TESTE", valor: 42.25 };
const importar = (companyId, arquivoId, transactions = [linha]) => request(app).post(`/companies/${companyId}/entries/import/ofx`).send({ transactions, ...(arquivoId ? { arquivoWhatsappId: arquivoId } : {}) });
const recibo = (id) => prisma.appSetting.findUnique({ where: { key: `whatsapp_ofx_import:${id}` } });
const novoArquivo = async (empresa, overrides = {}) => {
  const conversa = await prisma.conversaWhatsapp.create({ data: { telefoneE164: `teste-${randomUUID()}`, portalClientId: empresa.id, chaveEscopo: `teste:${randomUUID()}`, escopoVerificado: true } });
  conversas.push(conversa.id);
  const mensagem = await prisma.mensagemWhatsapp.create({ data: { conversaId: conversa.id, direcao: "in", tipo: "document", providerMessageId: `teste-${randomUUID()}` } });
  const arquivo = await prisma.arquivoWhatsapp.create({ data: { mensagemId: mensagem.id, portalClientId: empresa.id, midiaProvedorId: "123456", nomeArquivo: "sintetico.ofx", mimeType: "application/x-ofx", estado: "DISPONIVEL", expiraEm: new Date(Date.now() + 86400000), conteudo: Buffer.from("OFXHEADER:100"), ...overrides } });
  arquivos.push(arquivo.id);
  return arquivo;
};
try {
  const [server] = await prisma.$queryRaw`SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port`;
  assert.equal(server.db, "whatsapp_delivery_check");
  assert((server.host === "127.0.0.1" && server.port === 55439)
    || (process.env.CI === "true" && server.port === 5432 && /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(server.host)), "Servidor deve ser o cluster local ou serviço Docker do CI");
  for (let i = 0; i < 2; i += 1) empresas.push(await prisma.portalClient.create({ data: { razao: "Empresa sintética", cnpj: `teste-${randomUUID()}` } }));
  const [a, b] = empresas;
  const arquivo = await novoArquivo(a);
  const first = await importar(a.id, arquivo.id);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.created, 1);
  assert.equal(first.body.repetido, false);
  const entry = await prisma.accountingEntry.findUnique({ where: { id: first.body.details.created[0].entryId }, include: { lines: true } });
  assert.equal(entry.portalClientId, a.id);
  assert.equal(entry.lines.length, 2);
  assert.deepEqual(entry.lines.map((l) => Number(l.valor)), [42.25, 42.25]);
  assert((await prisma.arquivoWhatsapp.findUnique({ where: { id: arquivo.id } })).importadoEm);
  assert.equal((await recibo(arquivo.id)).value.companyId, a.id);
  ok("rota cria débito/crédito balanceados, recibo e marca no mesmo commit");

  const replay = await importar(a.id, arquivo.id, [{ ...linha, valor: 999 }]);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.repetido, true);
  assert.deepEqual(replay.body.details, first.body.details);
  assert.equal(await prisma.accountingEntry.count({ where: { portalClientId: a.id } }), 1);
  ok("retry após resposta perdida devolve recibo original e ignora novo payload");

  const invasao = await importar(b.id, arquivo.id);
  assert.equal(invasao.status, 404);
  assert.equal(await prisma.accountingEntry.count({ where: { portalClientId: b.id } }), 0);
  ok("arquivo de outra empresa não importa nem expõe recibo");

  for (const overrides of [{ expiraEm: new Date(0) }, { estado: "PENDENTE" }, { mimeType: "application/pdf" }]) {
    const invalido = await novoArquivo(a, overrides);
    const resposta = await importar(a.id, invalido.id);
    assert.equal(resposta.status, 404);
    assert.equal(await recibo(invalido.id), null);
  }
  ok("arquivo expirado, pendente ou PDF não autoriza importação OFX");

  const parcial = await novoArquivo(a);
  const antes = await prisma.accountingEntry.count({ where: { portalClientId: a.id } });
  const respostaParcial = await importar(a.id, parcial.id, [linha, { ...linha, rowIndex: 1, historico: "" }]);
  assert.equal(respostaParcial.status, 422, JSON.stringify(respostaParcial.body));
  assert.equal(respostaParcial.body.error, "OFX_WHATSAPP_LINHAS_INVALIDAS");
  assert.deepEqual(respostaParcial.body.details.created, []);
  assert.equal(await prisma.accountingEntry.count({ where: { portalClientId: a.id } }), antes);
  assert.equal(await recibo(parcial.id), null);
  assert.equal((await prisma.arquivoWhatsapp.findUnique({ where: { id: parcial.id } })).importadoEm, null);
  assert.equal((await importar(a.id, parcial.id)).status, 201);
  ok("linha inválida desfaz ledger/recibo/marca; correção posterior importa normalmente");

  const concorrente = await novoArquivo(a);
  const anteriores = await prisma.accountingEntry.count({ where: { portalClientId: a.id } });
  const corridas = await Promise.all(Array.from({ length: 8 }, () => importar(a.id, concorrente.id)));
  assert.equal(corridas.filter((r) => r.status === 201).length, 1);
  assert(corridas.every((r) => [200, 201].includes(r.status)), JSON.stringify(corridas.map((r) => r.body)));
  assert.equal(new Set(corridas.map((r) => r.body.details.created[0].entryId)).size, 1);
  assert.equal(await prisma.accountingEntry.count({ where: { portalClientId: a.id } }), anteriores + 1);
  ok("8 requests concorrentes importam uma vez e compartilham o recibo");

  const comumAntes = await prisma.accountingEntry.count({ where: { portalClientId: a.id } });
  const comum = await importar(a.id, null, [linha, { ...linha, historico: "" }]);
  assert.equal(comum.status, 201);
  assert.equal(comum.body.created, 1);
  assert.equal(comum.body.failed, 1);
  assert.equal(await prisma.accountingEntry.count({ where: { portalClientId: a.id } }), comumAntes + 1);
  ok("importação OFX comum mantém comportamento parcial anterior");
  console.log(`PASS: ${verificacoes} verificações F6 em rota e PostgreSQL reais.`);
} finally {
  if (arquivos.length) {
    await prisma.appSetting.deleteMany({ where: { key: { in: arquivos.map((id) => `whatsapp_ofx_import:${id}`) } } });
    await prisma.arquivoWhatsapp.deleteMany({ where: { id: { in: arquivos } } });
  }
  if (conversas.length) await prisma.conversaWhatsapp.deleteMany({ where: { id: { in: conversas } } });
  if (empresas.length) await prisma.portalClient.deleteMany({ where: { id: { in: empresas.map((e) => e.id) } } });
  await prisma.$disconnect();
}
