// Exercita o webhook, o menu, o coletor e o transporte rastreado reais.
// Somente PostgreSQL de teste; Meta, IA e consultas externas são bloqueadas.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
const url = new URL(process.argv[2] || "");
const local = url.hostname === "127.0.0.1" && url.port === "55443" && url.pathname === "/comunicacao_v2_check" && url.username === "lead_test";
const ci = url.hostname === "127.0.0.1" && url.port === "55439" && url.pathname === "/whatsapp_delivery_check" && url.username === "whatsapp_check" && url.password === "ci_test_only";
assert(url.protocol === "postgresql:" && (local || ci), "Use apenas o banco descartável local/CI autorizado.");
const run = `entrada-lead-${crypto.randomUUID()}`;
const base = Number(String(Date.now()).slice(-7));
const telefones = Array.from({ length: 5 }, (_, i) => `55119${String(base + i).padStart(8, "0")}`);
Object.assign(process.env, { DATABASE_URL: url.href, NODE_ENV: "test", WHATSAPP_IDENTIDADE_V2: "0", WHATSAPP_CHAT_V2: "0",
  WHATSAPP_MULTICANAL: "0", WHATSAPP_COLETA_COMERCIAL: "1", IA_COMERCIAL_TELEFONES_PILOTO: telefones.slice(0, 4).join(","),
  INTEGRACAO_WHATSAPP_MENU: "1", WHATSAPP_MENU_LEADS: "0", WHATSAPP_MENU_TELEFONES_PILOTO: "", IA_EMPRESAS_PILOTO: "",
  INTEGRACAO_WHATSAPP: "0", INTEGRACAO_IA_COMERCIAL: "0", INTEGRACAO_WHATSAPP_IA: "0", INTEGRACAO_FISCAL_LEADS: "0", LOG_LEVEL: "fatal" });
let rede = 0, ia = 0, sequencia = 0;
const bloquear = () => { rede++; throw Error("Rede externa proibida."); };
globalThis.fetch = http.get = http.request = https.get = https.request = bloquear;
const { prisma: db } = await import("../src/infrastructure/db/prisma.js");
const { processarEventoWhatsapp } = await import("../src/application/whatsapp/ProcessarEventoWhatsappService.js");
const { responderMenuWhatsapp } = await import("../src/application/whatsapp/MenuWhatsappService.js");
const { responderColetaComercial } = await import("../src/application/whatsapp/RespostaColetaComercialWhatsappService.js");
const { coletarComercialWhatsapp } = await import("../src/application/onboarding/ColetaComercialWhatsappService.js");
const { montarPayloadLista } = await import("../src/application/whatsapp/WhatsappCloudClient.js");
const saidas = [], checks = [];
const ok = texto => { checks.push(texto); console.log("OK " + texto); };
const cloud = Object.fromEntries(["enviarTexto", "enviarLista", "enviarBotoes"].map(tipo => [tipo, async args => {
  if (tipo === "enviarLista") montarPayloadLista({ ...args, para: args.telefone });
  saidas.push({ tipo, ...args }); return { wamid: `${run}-out-${saidas.length}` };
}]));
const casos = async telefone => db.atendimentoLead.findMany({ where: { conversa: { telefoneE164: telefone } }, include: { onboarding: true } });
const entrada = async (telefone, texto, { id = `${run}-in-${++sequencia}`, interacao } = {}) => {
  const agora = new Date();
  const m = { id, from: telefone, timestamp: String(Math.floor(agora.getTime() / 1000)),
    ...(interacao ? { type: "interactive", interactive: { list_reply: { id: interacao, title: texto } } } : { type: "text", text: { body: texto } }) };
  const resposta = await processarEventoWhatsapp({ entry: [{ changes: [{ field: "messages", value: { messages: [m] } }] }] }, {
    agora, responder: async () => { ia++; throw Error("IA proibida."); },
    responderMenu: args => responderMenuWhatsapp({ ...args, client: db, cloud }),
    responderColeta: args => responderColetaComercial({ ...args, client: db, cloud,
      coletar: args => coletarComercialWhatsapp({ ...args, deps: { ...args.deps, consultaPublica: async () => ({
        razaoSocial: "EMPRESA SINTÉTICA", situacaoCadastral: "ATIVA", municipio: "Rio de Janeiro", uf: "RJ",
      }) } }) }),
  });
  assert.deepEqual(resposta.erros, [], JSON.stringify(resposta.erros)); return id;
};
try {
  // Recusa colisão com qualquer fixture de outra execução, antes de escrever.
  assert.equal(await db.conversaWhatsapp.count({ where: { telefoneE164: { in: telefones } } }), 0);
  const [medico, transferencia, inativa, desconhecido, fora] = telefones;
  await entrada(medico, "Olá");
  assert.deepEqual(saidas.at(-1).linhas.map(o => o.titulo), ["Abrir uma empresa", "Trocar de contador", "Empresa parada", "Já sou cliente", "Falar com a equipe"]);
  assert.equal((await casos(medico)).length, 0);
  ok("Saudação abre lista nativa válida sem criar ficha nem depender do piloto operacional");

  const id = await entrada(medico, "Sou médico e quero abrir uma empresa");
  assert.equal(saidas.at(-1).texto, "Como você se chama?");
  let ficha = (await casos(medico))[0].onboarding;
  assert.equal(ficha.dados.atividadePretendida, "médico"); assert.equal(ficha.cnpj, null);
  const quantidade = saidas.length; await entrada(medico, "Sou médico e quero abrir uma empresa", { id });
  assert.equal(saidas.length, quantidade); assert.equal((await casos(medico)).length, 1);
  ok("Pedido direto inicia abertura e replay não duplica ficha nem resposta");

  await entrada(medico, "Quanto custa?");
  assert.match(saidas.at(-1).texto, /Como você se chama/);
  assert.equal((await casos(medico))[0].onboarding.dados.responsavelNome, undefined);
  await entrada(medico, "Me chamo Caio");
  assert.match(saidas.at(-1).texto, /cidade e estado/);
  await entrada(medico, "Rio de Janeiro/RJ");
  assert.match(saidas.at(-1).texto, /apenas a abertura/);
  await entrada(medico, "Só abertura");
  assert.match(saidas.at(-1).texto, /endereço/);
  await entrada(medico, "endereco: Rua Sintética 123");
  assert.match(saidas.at(-1).texto, /equipe/);
  ficha = (await casos(medico))[0].onboarding;
  assert.equal(ficha.dados.modalidadeServico, "AVULSO");
  assert.equal(ficha.dados.responsavelNome, "Caio");
  assert.equal(ficha.dados.qtdFuncionarios, undefined);
  const antesHumano = saidas.length; await entrada(medico, "Olá");
  assert.equal(saidas.length, antesHumano);
  ok("Coleta responde dúvida, aproveita atividade, oferece avulso e entrega ficha à equipe");

  await entrada(transferencia, "Trocar de contador", { interacao: "altan.comercial.transferencia.v1" });
  assert.equal(saidas.at(-1).texto, "Qual é o CNPJ da empresa?");
  await entrada(transferencia, "11.222.333/0001-81");
  assert.match(saidas.at(-1).texto, /EMPRESA SINTÉTICA/);
  assert.match(saidas.at(-1).texto, /não comprova regularidade fiscal/);
  ficha = (await casos(transferencia))[0].onboarding;
  assert.equal(ficha.cnpj, "11222333000181");
  assert.equal(await db.trabalhoFiscalLead.count({ where: { onboardingId: ficha.id } }), 0);
  ok("Seleção de transferência coleta CNPJ numérico e consulta pública sem operação fiscal");

  await entrada(inativa, "Minha empresa está parada e não sei o que fazer");
  assert.equal(saidas.at(-1).texto, "Qual é o CNPJ da empresa?");
  await entrada(inativa, "Não sei");
  assert.match(saidas.at(-1).texto, /equipe/);
  assert.equal((await casos(inativa))[0].onboarding.cnpj, null);
  ok("Empresa parada sem CNPJ é encaminhada sem inventar dados nem repetir perguntas");

  await entrada(desconhecido, "Olá");
  await entrada(desconhecido, "quero falar com uma pessoa");
  assert.match(saidas.at(-1).texto, /equipe|atendimento/i);
  assert.equal((await casos(desconhecido)).length, 0);
  ok("Pedido de pessoa aciona equipe sem abrir solicitação comercial fictícia");
  const antesFora = saidas.length; await entrada(fora, "Quero abrir uma empresa");
  assert.equal(saidas.length, antesFora); assert.equal((await casos(fora)).length, 0);
  assert.equal(rede, 0); assert.equal(ia, 0);
  ok("Fora do piloto não ativa automação; nenhum cenário usa rede externa ou IA");
  console.log(JSON.stringify({ passed: checks.length, rede, ia }));
} catch (err) {
  console.error(err.message); process.exitCode = 1;
} finally {
  const conversas = await db.conversaWhatsapp.findMany({ where: { telefoneE164: { in: telefones }, mensagens: { some: { providerMessageId: { startsWith: run } } } }, select: { id: true } });
  const ids = conversas.map(c => c.id);
  const fichas = await db.atendimentoLead.findMany({ where: { conversaId: { in: ids } }, select: { onboardingId: true } });
  await db.coletaComercialWhatsapp.deleteMany({ where: { atendimentoLead: { conversaId: { in: ids } } } });
  await db.atendimentoLead.deleteMany({ where: { conversaId: { in: ids } } });
  await db.onboarding.deleteMany({ where: { id: { in: fichas.map(f => f.onboardingId).filter(Boolean) } } });
  await db.mensagemWhatsapp.deleteMany({ where: { conversaId: { in: ids } } });
  await db.conversaWhatsapp.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
}
