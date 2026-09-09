// Integração real, exclusivamente em banco descartável LOCAL. Provedores são dublês.
import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";

const url = new URL(process.env.WHATSAPP_TEST_DATABASE_URL || "postgresql://unused@127.0.0.1/invalid");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.endsWith("_check")) {
  throw new Error("Use WHATSAPP_TEST_DATABASE_URL apontando para banco local com sufixo _check.");
}
process.env.DATABASE_URL = url.toString();
process.env.INTEGRACAO_WHATSAPP_IA = "0";
globalThis.fetch = async () => { throw new Error("PROVEDORES EXTERNOS PROIBIDOS NESTE TESTE"); };
const { prisma } = await import("../src/infrastructure/db/prisma.js");
const { garantirConversa, registrarMensagemRecebida, registrarMensagemEnviada, listarMensagens, pertenceAFilaWhatsapp, alterarExclusaoConversa } = await import("../src/application/whatsapp/ConversaWhatsappService.js");
const { persistirWebhookWhatsapp, processarInboxWhatsappUmaVez } = await import("../src/application/whatsapp/WhatsappInboxService.js");
const { adquirirLease, renovarLease, liberarLease } = await import("../src/application/whatsapp/WhatsappLeaseService.js");
const { enfileirarTurnoIa, processarTurnosIaUmaVez } = await import("../src/application/assistente/TurnoIaWhatsappService.js");
const { autorizarChamadaIa, concluirChamadaIa } = await import("../src/application/assistente/GuardaIaService.js");
const { responderMensagem } = await import("../src/application/assistente/AssistenteService.js");
const { enviarMensagemRastreada, aplicarStatusMensagem } = await import("../src/application/whatsapp/SaidaWhatsappService.js");
const { resumoWhatsapp } = await import("../src/application/whatsapp/resumoWhatsapp.js");
const log = { info() {}, warn() {}, error() {} };
const checks = [];
const prefix = randomUUID();
const ids = (nome) => `${prefix}:${nome}`;
const wamid = (nome) => `wamid.test.${ids(nome)}`;
const telefone = "5511999999988";
const resultados = (nome) => { checks.push(nome); console.log(`PASS ${nome}`); };

try {
  const [a, b] = await Promise.all(["A", "B"].map((nome) => prisma.portalClient.create({ data: {
    id: ids(nome), razao: `Teste ${nome}`, cnpj: ids(`cnpj-${nome}`),
  } })));
  const [ca, cb] = await Promise.all([a, b].map((empresa) => garantirConversa({ telefone, portalClientId: empresa.id })));
  assert.notEqual(ca.id, cb.id);
  await registrarMensagemEnviada({ telefone, portalClientId: a.id, corpo: "Documento exclusivo A", providerMessageId: wamid("a") });
  await registrarMensagemEnviada({ telefone, portalClientId: b.id, corpo: "Documento exclusivo B", providerMessageId: wamid("b") });
  const historicoB = await listarMensagens({ portalClientId: b.id, conversaId: cb.id });
  assert.deepEqual(historicoB.map((m) => m.corpo), ["Documento exclusivo B"]);
  await assert.rejects(prisma.conversaWhatsapp.update({ where: { id: ca.id }, data: { portalClientId: b.id } }));
  assert.equal(pertenceAFilaWhatsapp({ ...ca, portalClientId: null }), false);
  assert.equal(pertenceAFilaWhatsapp({ portalClientId: null, chaveEscopo: `legado:${a.id}:exemplo` }), false);
  resultados("histórico isolado e imutável, inclusive após exclusão da empresa");

  const entrada = { entry: [{ changes: [{ field: "messages", value: { messages: [{ id: wamid("inbox"), from: telefone, type: "text", text: { body: "oi" } }] } }] }] };
  const envelopes = await Promise.all(Array.from({ length: 12 }, () => persistirWebhookWhatsapp(entrada)));
  assert.equal(new Set(envelopes.map((x) => x.id)).size, 1);
  let agora = new Date(Date.now() + 1000);
  await processarInboxWhatsappUmaVez({ agora, log, processar: async () => { throw new Error("indisponível"); } });
  assert.equal((await prisma.inboxWebhookWhatsapp.findUnique({ where: { id: envelopes[0].id } })).status, "falhou");
  agora = new Date(Date.now() + 6000);
  await processarInboxWhatsappUmaVez({ agora, log, processar: async () => ({ erros: [], statuses: { semEnvio: 1 } }) });
  assert.equal((await prisma.inboxWebhookWhatsapp.findUnique({ where: { id: envelopes[0].id } })).erroCodigo, "STATUS_AGUARDANDO_CORRELACAO");
  await processarInboxWhatsappUmaVez({ agora: new Date(Date.now() + 30000), log, processar: async () => ({ erros: [], statuses: { semEnvio: 0 } }) });
  assert.equal((await prisma.inboxWebhookWhatsapp.findUnique({ where: { id: envelopes[0].id } })).status, "concluido");
  resultados("inbox deduplica 12 entregas e recupera falha/status antecipado");

  const concorrentes = await Promise.all(Array.from({ length: 12 }, () => adquirirLease(ids("lease"))));
  const dono = concorrentes.find(Boolean);
  assert.equal(concorrentes.filter(Boolean).length, 1);
  await prisma.whatsappLease.update({ where: { id: dono.id }, data: { expiraEm: new Date(0) } });
  const novoDono = await adquirirLease(dono.id);
  assert.ok(novoDono);
  assert.equal(await renovarLease(dono), false);
  await liberarLease(dono);
  assert.equal((await prisma.whatsappLease.findUnique({ where: { id: dono.id } })).token, novoDono.token);
  await liberarLease(novoDono);
  resultados("lease tem um dono, não renova vencido e antigo não libera novo");

  const mj = await prisma.mensagemWhatsapp.create({ data: { conversaId: ca.id, direcao: "in", providerMessageId: wamid("turno-a"), tipo: "text", corpo: "primeira", ocorridaEmProvedor: new Date() } });
  const primeiroTurno = await enfileirarTurnoIa({ conversaId: ca.id, mensagemId: mj.id, portalClientId: a.id });
  let chamadas = 0;
  const responder = async () => { chamadas += 1; return { feito: true, motivo: "RESPONDIDA" }; };
  // Avança o relógio injetado, sem sleeps: o worker respeita a pausa para agrupar bolhas.
  await processarTurnosIaUmaVez({ flag: true, piloto: [a.id], log, responder, agora: new Date(primeiroTurno.proximaTentativaEm.getTime() - 1) });
  assert.equal(chamadas, 0);
  assert.equal((await prisma.turnoIaWhatsapp.findUnique({ where: { id: primeiroTurno.id } })).tentativas, 0);
  const bloqueio = await adquirirLease(`ia:${ca.id}`);
  assert.ok(bloqueio);
  await processarTurnosIaUmaVez({ flag: true, piloto: [a.id], log, responder, agora: primeiroTurno.proximaTentativaEm });
  assert.equal(chamadas, 0);
  assert.equal((await prisma.turnoIaWhatsapp.findUnique({ where: { id: primeiroTurno.id } })).status, "pendente");
  await liberarLease(bloqueio);
  let segundoTurno;
  await processarTurnosIaUmaVez({ flag: true, piloto: [a.id], log, agora: primeiroTurno.proximaTentativaEm, responder: async () => {
    chamadas += 1;
    const mb = await prisma.mensagemWhatsapp.create({ data: { conversaId: ca.id, direcao: "in", providerMessageId: wamid("turno-b"), tipo: "text", corpo: "cheguei durante o modelo" } });
    segundoTurno = await enfileirarTurnoIa({ conversaId: ca.id, mensagemId: mb.id, portalClientId: a.id });
    return { feito: true };
  } });
  assert.equal(chamadas, 1);
  assert.ok(segundoTurno);
  await processarTurnosIaUmaVez({ flag: true, piloto: [a.id], log, responder, agora: segundoTurno.proximaTentativaEm });
  assert.equal(chamadas, 2);
  assert.equal(await prisma.turnoIaWhatsapp.count({ where: { portalClientId: a.id, status: "respondido" } }), 2);
  resultados("mensagem recebida com fio ocupado permanece e é processada no ciclo seguinte");

  const falhaMsg = await prisma.mensagemWhatsapp.create({ data: { conversaId: ca.id, direcao: "in", providerMessageId: wamid("timeout"), tipo: "text" } });
  const job = await enfileirarTurnoIa({ conversaId: ca.id, mensagemId: falhaMsg.id, portalClientId: a.id });
  await assert.rejects(enviarMensagemRastreada({ conversa: ca, turnoIaId: job.id, corpo: "tentativa", enviar: async () => { throw new Error("timeout"); } }));
  await prisma.turnoIaWhatsapp.update({ where: { id: job.id }, data: { status: "falhou" } });
  await processarTurnosIaUmaVez({ flag: true, piloto: [a.id], log, responder, agora: job.proximaTentativaEm });
  assert.equal((await prisma.turnoIaWhatsapp.findUnique({ where: { id: job.id } })).status, "indeterminado");
  assert.equal(chamadas, 2);
  resultados("timeout de saída não provoca reenvio automático após falha do turno");

  const saida = await enviarMensagemRastreada({ conversa: ca, corpo: "rastrear", enviar: async () => ({ wamid: wamid("status") }) });
  await aplicarStatusMensagem({ providerMessageId: saida.wamid, status: "read" });
  await aplicarStatusMensagem({ providerMessageId: saida.wamid, status: "failed", erroCodigo: "META_TESTE" });
  await aplicarStatusMensagem({ providerMessageId: saida.wamid, status: "sent" });
  assert.equal((await prisma.mensagemWhatsapp.findUnique({ where: { id: saida.mensagem.id } })).statusEnvio, "lido");
  resultados("texto/documento mantém confirmação de leitura diante de eventos atrasados");

  const semRegra = await prisma.portalClient.create({ data: { id: ids("budget"), razao: "Teste orçamento", cnpj: ids("cnpj-budget") } });
  const reservas = await Promise.all(Array.from({ length: 12 }, () => autorizarChamadaIa({ portalClientId: semRegra.id, chave: "chave-falsa-sem-rede", log, reservaCentavos: 100 })));
  const ok = reservas.filter((r) => r.ok);
  assert.ok(ok.length > 0 && ok.length <= 4);
  const saldo = await prisma.chamadaIa.aggregate({ where: { portalClientId: semRegra.id }, _sum: { reservaCentavos: true } });
  assert.ok(saldo._sum.reservaCentavos <= 400);
  await concluirChamadaIa(ok[0].contexto, { usage: { input_tokens: 1000, output_tokens: 100 } }, { log });
  assert.equal((await prisma.chamadaIa.findUnique({ where: { id: ok[0].contexto.chamadaId } })).reservaCentavos, 0);
  resultados("12 chamadas concorrentes reservam orçamento sem exceder teto da empresa");

  const erroBudget = await prisma.portalClient.create({ data: { id: ids("budget-erro"), razao: "Teste consumo ambíguo", cnpj: ids("cnpj-budget-erro") } });
  const reservaErro = await autorizarChamadaIa({ portalClientId: erroBudget.id, chave: "falsa", log, reservaCentavos: 100 });
  assert.equal(reservaErro.ok, true);
  await concluirChamadaIa(reservaErro.contexto, { erroCodigo: "IA_CONEXAO" }, { log });
  let consumoErro = await prisma.chamadaIa.findUnique({ where: { id: reservaErro.contexto.chamadaId } });
  assert.equal(consumoErro.reservaCentavos, 100);
  await concluirChamadaIa(reservaErro.contexto, { erroCodigo: "IA_CONEXAO", usage: { input_tokens: 10000, output_tokens: 2000 } }, { log });
  consumoErro = await prisma.chamadaIa.findUnique({ where: { id: reservaErro.contexto.chamadaId } });
  assert.equal(consumoErro.reservaCentavos, 100);
  assert.ok(consumoErro.custoEstimadoCentavos > 0);
  const negada = await autorizarChamadaIa({ portalClientId: erroBudget.id, chave: "falsa", log, reservaCentavos: 400 });
  assert.equal(negada.ok, false);
  await concluirChamadaIa(reservaErro.contexto, { erroCodigo: "IA_CONEXAO", usageCompleto: true, usage: { input_tokens: 10000, output_tokens: 2000 } }, { log });
  assert.equal((await prisma.chamadaIa.findUnique({ where: { id: reservaErro.contexto.chamadaId } })).reservaCentavos, 0);
  resultados("erro sem usage e parcial conserva orçamento reservado até reconciliação explícita");

  const u = await prisma.user.create({ data: { id: ids("u"), email: `${prefix}@example.invalid`, passwordHash: "INUTILIZAVEL", status: "active" } });
  await prisma.companyClientUser.create({ data: { companyId: a.id, userId: u.id, role: "CLIENT_ADMIN", status: "ACTIVE" } });
  const alias = `5511${randomInt(80000000, 89999999)}`;
  await prisma.contatoWhatsapp.create({ data: { portalClientId: a.id, nome: "Contato teste", telefoneE164: `55119${alias.slice(4)}`, waId: alias, userId: u.id } });
  const recebida = await registrarMensagemRecebida({ telefone: alias, providerMessageId: wamid("alias"), tipo: "text", corpo: "oi", ocorridaEmProvedor: new Date() });
  let modeloChamado = 0;
  const deps = { client: prisma, flag: true, piloto: [a.id], chaveIa: "chave-falsa-sem-rede", log,
    assistente: { responder: async () => { modeloChamado += 1; return { texto: "Resposta de teste", usage: { input_tokens: 1, output_tokens: 1 }, iteracoes: 1 }; } },
    cloud: { enviarTexto: async () => ({ wamid: wamid(`resposta-${randomUUID()}`) }) },
  };
  const r = await responderMensagem({ conversaId: recebida.conversa.id, mensagemId: recebida.mensagem.id, deps });
  assert.equal(r.motivo, "RESPONDIDA");
  assert.equal(modeloChamado, 1);
  const legado = await prisma.conversaWhatsapp.create({ data: { chaveEscopo: `legado:${a.id}:${prefix}`, telefoneE164: alias, portalClientId: a.id, escopoVerificado: false } });
  const velha = await prisma.mensagemWhatsapp.create({ data: { conversaId: legado.id, direcao: "in", providerMessageId: wamid("legado"), tipo: "text" } });
  const recusada = await responderMensagem({ conversaId: legado.id, mensagemId: velha.id, deps });
  assert.equal(recusada.motivo, "SEM_ESCOPO_VERIFICADO");
  assert.equal(modeloChamado, 1);
  resultados("waId identifica pessoa corretamente; legado não entra no modelo");

  // A lixeira preserva dados e o responsável. Reentrega antiga não deve reabrir atendimento.
  await prisma.conversaWhatsapp.update({ where: { id: recebida.conversa.id }, data: { atendidaPor: u.id, atendidaDesde: new Date() } });
  const jobExcluido = await enfileirarTurnoIa({ conversaId: recebida.conversa.id, mensagemId: recebida.mensagem.id, portalClientId: a.id });
  const naLixeira = await alterarExclusaoConversa({ conversaId: recebida.conversa.id, excluir: true });
  assert.ok(naLixeira.excluidaEm);
  assert.ok(naLixeira.automacaoInvalidadaEm);
  assert.equal((await prisma.turnoIaWhatsapp.findUnique({ where: { id: jobExcluido.id } })).status, "ignorado");
  const resumoNaLixeira = await resumoWhatsapp([a.id]);
  assert.equal(resumoNaLixeira.lixeiraConversas, 1);
  assert.equal(resumoNaLixeira.historicoConversas, 1);
  // Sem empresa só entra pela fila; o mesmo telefone na empresa B não entra na carteira A.
  const resumosEmpresaB = await resumoWhatsapp([b.id]);
  assert.equal(resumosEmpresaB.lixeiraConversas, 0);
  assert.equal(resumosEmpresaB.historicoConversas, 0);
  const restaurada = await alterarExclusaoConversa({ conversaId: recebida.conversa.id, excluir: false });
  assert.equal(restaurada.excluidaEm, null);
  assert.equal(restaurada.automacaoInvalidadaEm.getTime(), naLixeira.automacaoInvalidadaEm.getTime());
  const excluidaNovamente = await alterarExclusaoConversa({ conversaId: recebida.conversa.id, excluir: true });
  const excluidaEm = excluidaNovamente.excluidaEm;
  const repetida = await registrarMensagemRecebida({ telefone: alias, providerMessageId: wamid("alias"), tipo: "text", corpo: "oi" });
  assert.equal(repetida.duplicada, true);
  assert.equal(repetida.conversa.excluidaEm.getTime(), excluidaEm.getTime());
  assert.equal(await prisma.mensagemWhatsapp.count({ where: { id: recebida.mensagem.id } }), 1);
  const proxima = await registrarMensagemRecebida({ telefone: alias, providerMessageId: wamid("reabrir"), tipo: "text", corpo: "nova mensagem", ocorridaEmProvedor: new Date() });
  assert.equal(proxima.duplicada, false);
  assert.equal(proxima.conversa.id, recebida.conversa.id);
  assert.equal(proxima.conversa.excluidaEm, null);
  assert.equal(proxima.conversa.atendidaPor, u.id);
  assert.equal((await prisma.conversaWhatsapp.findUnique({ where: { id: recebida.conversa.id } })).excluidaEm, null);
  const preservadas = await listarMensagens({ portalClientId: a.id, conversaId: recebida.conversa.id });
  assert.ok(preservadas.some((m) => m.id === recebida.mensagem.id));
  assert.ok(preservadas.some((m) => m.id === proxima.mensagem.id));
  const atuais = await prisma.conversaWhatsapp.findMany({ where: { portalClientId: a.id, telefoneE164: alias, excluidaEm: null, NOT: { chaveEscopo: { startsWith: "legado:" } } } });
  assert.deepEqual(atuais.map((c) => c.id), [recebida.conversa.id]);
  assert.equal((await prisma.conversaWhatsapp.findUnique({ where: { id: legado.id } })).escopoVerificado, false);
  resultados("lixeira preserva histórico, reentrega não reabre e mensagem nova reabre o mesmo chat sem liberar a IA");

  await prisma.conversaWhatsapp.update({ where: { id: proxima.conversa.id }, data: { atendidaPor: null, atendidaDesde: null } });
  const duranteModelo = await registrarMensagemRecebida({ telefone: alias, providerMessageId: wamid("excluir-durante-modelo"), tipo: "text", corpo: "consulta de teste", ocorridaEmProvedor: new Date() });
  let enviosAposExclusao = 0;
  let geracoesEmDisputa = 0;
  const interrompida = await responderMensagem({ conversaId: duranteModelo.conversa.id, mensagemId: duranteModelo.mensagem.id, deps: {
    ...deps,
    assistente: { responder: async () => {
      geracoesEmDisputa += 1;
      await alterarExclusaoConversa({ conversaId: duranteModelo.conversa.id, excluir: true });
      await alterarExclusaoConversa({ conversaId: duranteModelo.conversa.id, excluir: false });
      return { texto: "Esta resposta antiga não pode sair", usage: { input_tokens: 1, output_tokens: 1 }, iteracoes: 1 };
    } },
    cloud: { enviarTexto: async () => { enviosAposExclusao += 1; return { wamid: wamid("nao-pode-enviar") }; } },
  } });
  assert.equal(geracoesEmDisputa, 1);
  assert.equal(interrompida.motivo, "AUTOMACAO_INVALIDADA");
  assert.equal(enviosAposExclusao, 0);
  resultados("excluir e restaurar durante geração não libera resposta antiga no PostgreSQL real");

  console.log(JSON.stringify({ ok: true, checks: checks.length, banco: url.pathname.slice(1), chamadasProvedoresReais: 0 }));
} finally {
  await prisma.$disconnect();
}
