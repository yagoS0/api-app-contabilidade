import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";

// Prova curta independente: aceita somente os alvos descartáveis de teste. Não
// requer banco vazio e não altera/limpa fixtures de outros verificadores.
const url = new URL(process.argv[2]);
const local = url.hostname === "127.0.0.1" && url.port === "55443" && url.pathname === "/lead_flow_check_v2" && url.username === "lead_test";
const ci = url.hostname === "127.0.0.1" && url.port === "55439" && url.pathname === "/whatsapp_delivery_check" && url.username === "whatsapp_check" && url.password === "ci_test_only";
if (url.protocol !== "postgresql:" || !(local || ci)) throw Error("Use apenas o PostgreSQL descartável explicitamente permitido.");
Object.assign(process.env, { DATABASE_URL: url.href, NODE_ENV: "test", LOG_LEVEL: "fatal", INTEGRACAO_WHATSAPP: "0", INTEGRACAO_IA_COMERCIAL: "0", INTEGRACAO_FISCAL_LEADS: "0" });
let chamadasExternas = 0;
const semRede = () => { chamadasExternas++; throw Error("Rede externa proibida nesta prova."); };
globalThis.fetch = http.get = http.request = https.get = https.request = semRede;

const { prisma: db } = await import("../src/infrastructure/db/prisma.js");
const { criarJornadaLead } = await import("../src/application/onboarding/JornadaLeadService.js");
const { criarPropostasComerciais } = await import("../src/application/onboarding/PropostasComerciaisService.js");
const { criarRecursosComerciais } = await import("../src/application/onboarding/RecursosComerciaisService.js");
const { montarJornadaComercial } = await import("../src/application/onboarding/PoliticaJornadaComercial.js");
const { CATALOGO_SINTETICO } = await import("../src/application/onboarding/__tests__/fixtures/catalogoSintetico.js");
const prefixo = `jornada-manual-${randomUUID()}`;
const checks = [];
const ok = titulo => checks.push(titulo);
const ids = {};
const cnpj = "11222333000181";
const manual = { fonte: "Documento cadastral sintético apresentado pelo cliente", evidencia: "Conferidos CNPJ, razão social e atividade no documento sintético recebido." };
try {
  const user = await db.user.create({ data: { name: "Contador da prova manual", email: `${prefixo}@example.invalid`, passwordHash: "sem-login-de-teste", role: "contador", accountType: "FIRM", status: "active" } });
  ids.usuario = user.id;
  const ficha = await db.onboarding.create({ data: { origem: "TRANSFERENCIA", criadoPorId: user.id, cnpj, responsavelNome: "Responsável sintético", razaoSocial: "Empresa da prova manual", dados: { cnpj, modalidadeServico: "AVULSO" } } });
  ids.ficha = ficha.id;
  const j = criarJornadaLead({ db });
  const propostas = criarPropostasComerciais({ db, cifrar: async s => `TEST:${s}`, decifrar: async s => s.slice(5) });
  const atual = () => db.onboarding.findUnique({ where: { id: ficha.id } });
  const conferir = (versao, evidencia = manual.evidencia) => j.conferirAnalise(ficha.id, user, { tipo: "PUBLICA", versao, manual: { ...manual, evidencia } });
  await assert.rejects(j.conferirAnalise(ficha.id, user, { tipo: "PUBLICA", versao: 0, manual: { fonte: "", evidencia: "ok" } }), e => e.code === "conferencia_manual_invalida");
  await assert.rejects(j.conferirAnalise(ficha.id, { ...user, role: "cliente" }, { tipo: "PUBLICA", versao: 0, manual }), e => e.code === "forbidden");
  assert.equal(await db.onboardingEvento.count({ where: { onboardingId: ficha.id } }), 0);
  ok("Permissão e evidência obrigatórias, sem gravação parcial");

  const corrida = await Promise.allSettled([conferir(0), conferir(0, `${manual.evidencia} Segunda conferência concorrente.`)]);
  assert.equal(corrida.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(corrida.find(r => r.status === "rejected").reason.code, "formulario_alterado");
  const evento = corrida.find(r => r.status === "fulfilled").value;
  assert.equal(evento.tipo, "JORNADA_PUBLICA_MANUAL_CONFERIDA");
  assert.equal(evento.atorId, user.id); assert.equal(evento.dados.cnpj, cnpj); assert.equal(evento.dados.fonte, manual.fonte);
  assert.ok(evento.dados.evidencia.includes(manual.evidencia)); assert.equal(evento.dados.fichaVersao, 0);
  assert.equal((await atual()).versao, 1);
  assert.equal(await db.onboardingEvento.count({ where: { onboardingId: ficha.id, tipo: evento.tipo } }), 1);
  assert.equal(await db.onboardingAnalise.count({ where: { onboardingId: ficha.id } }), 0);
  assert.equal((await conferir(0, evento.dados.evidencia)).id, evento.id);
  ok("CAS PostgreSQL aceita somente uma conferência concorrente e repetições não criam análise fictícia");

  const diagnosticar = async () => j.diagnosticar(ficha.id, user, { versao: (await atual()).versao, achados: "Dados cadastrais conferidos manualmente para o serviço solicitado.", servicos: "Atualização cadastral sintética com escopo restrito.", dispensaConsultaPrivada: "Não foi consultada a situação fiscal privada; serviço restrito à atualização cadastral." });
  const apresentar = async d => j.registrarApresentacao(ficha.id, user, { versao: (await atual()).versao, diagnosticoId: d.id, meio: "Reunião sintética", evidencia: "O interessado conferiu o escopo limitado na reunião de teste." });
  const diagnostico = await diagnosticar(); await apresentar(diagnostico);
  const carregada = await j.carregar(ficha.id, user);
  assert.equal(carregada.publicaConferencia.modo, "MANUAL"); assert.equal(carregada.publicaConferencia.id, evento.id);
  assert.equal(carregada.publicaConferida, true); assert.equal(carregada.fiscalConferido, false); assert.equal(carregada.analises.length, 0);
  assert.equal(typeof diagnostico.dados.conferenciaCadastro.conferidaEm, "string");
  assert.equal(montarJornadaComercial({ onboarding: await atual(), jornada: carregada }).comandosPermitidos.aprovarProposta, true);
  ok("Origem manual persiste em JSON real e libera diagnóstico limitado com apresentação humana");

  const recursos = criarRecursosComerciais({ db });
  const cat = await recursos.criar({ tipo: "CATALOGO", chave: "honorarios", titulo: `Catálogo sintético ${prefixo}`, dados: CATALOGO_SINTETICO }, user);
  await recursos.aprovar(cat.id, user); ids.catalogo = cat.id;
  const gerar = async () => propostas.gerar(ficha.id, user, { versao: (await atual()).versao, ajustes: { servicoCentavos: 24680, escopoAvulso: "Atualização cadastral sintética.", justificativa: "Valor sintético conferido para a prova." } });
  const primeira = await gerar(); await propostas.aprovar(ficha.id, primeira.id, user);
  const primeiroLink = await propostas.emitirLink(ficha.id, primeira.id, user);
  assert.equal((await propostas.publico(primeiroLink.token)).proposta.conferenciaCadastro.modo, "MANUAL");
  const nova = await conferir((await atual()).versao, "Fonte sintética reconferida após correção do documento; substitui a conferência anterior.");
  assert.notEqual(nova.id, evento.id); assert.equal((await atual()).versao, 2);
  const revista = await j.carregar(ficha.id, user);
  assert.equal(revista.diagnostico, null); assert.equal(revista.diagnosticoDesatualizado, true); assert.equal(revista.devolutiva.concluida, false);
  await assert.rejects(propostas.publico(primeiroLink.token, { versao: primeira.versao, opcao: "AVULSO", confirmado: true }), e => e.code === "proposta_desatualizada");
  await assert.rejects(propostas.documentoProposta(ficha.id, primeira.id, user), e => e.code === "proposta_indisponivel");
  ok("Nova conferência invalida diagnóstico, apresentação, PDF e aceite da proposta antiga");

  const novoDiagnostico = await diagnosticar(); await apresentar(novoDiagnostico);
  const segunda = await gerar(); await propostas.aprovar(ficha.id, segunda.id, user);
  const segundoLink = await propostas.emitirLink(ficha.id, segunda.id, user);
  const aceito = await propostas.publico(segundoLink.token, { versao: segunda.versao, opcao: "AVULSO", confirmado: true });
  assert.equal(aceito.proposta.status, "ACEITA"); assert.deepEqual(aceito.proposta.conferenciaCadastro, { modo: "MANUAL" });
  assert.equal(JSON.stringify(aceito).includes(manual.evidencia), false);
  const modelo = await recursos.criar({ tipo: "CONTRATO", chave: `manual-${randomUUID()}`, titulo: "Contrato sintético manual", texto: "{{nome}} — {{servico}} — {{honorarios}}", dados: { recorrente: false } }, user);
  await recursos.aprovar(modelo.id, user);
  const contrato = await propostas.contrato(ficha.id, segunda.id, user, { modeloId: modelo.id, variaveis: { honorarios: "0", servico: "não usar" } });
  assert.equal(contrato.dados.opcao.unicoCentavos, 24680); assert.ok(contrato.texto.includes("246,80")); assert.ok(!contrato.texto.includes("não usar"));
  ids.proposta = segunda.id; ids.contrato = contrato.id;
  ok("Proposta manual aceita mantém escopo e valores exatos no contrato, sem expor evidências internas");

  await propostas.aprovarContrato(ficha.id, contrato.id, user);
  const documento = await propostas.salvarDocumento(ficha.id, user, { buffer: Buffer.from("%PDF-1.4\nDocumento sintético, sem assinatura real\n%%EOF"), mimetype: "application/pdf", originalname: "assinatura-sintetica.pdf" });
  await propostas.conferirAssinatura(ficha.id, contrato.id, user, documento.id);
  await j.confirmarPagamento(ficha.id, user, { contratoId: contrato.id, evidencia: "Pagamento fictício conferido para testar a conclusão manual." });
  await propostas.concluirAvulso(ficha.id, user, "Serviço sintético entregue e conferido, sem execução externa.");
  assert.equal((await atual()).status, "CONCLUIDO_AVULSO"); assert.equal(await db.onboardingAnalise.count({ where: { onboardingId: ficha.id } }), 0);
  ok("Assinatura por arquivo, pagamento e conclusão avulsa funcionam sem consulta automática ou provedor");

  const outra = await db.onboarding.create({ data: { origem: "INATIVA", cnpj, criadoPorId: user.id, dados: { modalidadeServico: "AVULSO" } } });
  ids.fichaCnpjAlterado = outra.id;
  await j.conferirAnalise(outra.id, user, { tipo: "PUBLICA", versao: 0, manual });
  const corpo = { versao: 1, achados: "Cadastro sintético conferido manualmente.", servicos: "Serviço cadastral delimitado pelo contador.", dispensaConsultaPrivada: "Sem análise fiscal privada neste escopo sintético." };
  await j.diagnosticar(outra.id, user, corpo);
  await db.onboarding.update({ where: { id: outra.id }, data: { cnpj: "99888777000166", versao: { increment: 1 } } });
  const alterada = await j.carregar(outra.id, user);
  assert.equal(alterada.publicaConferida, false); assert.equal(alterada.publicaConferencia, null); assert.equal(alterada.diagnostico, null);
  await assert.rejects(j.diagnosticar(outra.id, user, { ...corpo, versao: 2 }), e => e.code === "analise_pendente");
  ok("CNPJ alterado exige outra conferência e não reaproveita o diagnóstico anterior");

  assert.equal(chamadasExternas, 0);
  const resultado = { ok: true, prefixo, checks, ids, chamadasExternas };
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(resultado, null, 2));
  console.log(JSON.stringify(resultado, null, 2));
} finally {
  await db.$disconnect();
}
