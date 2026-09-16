// Jornada sintética de ponta a ponta, sem tokens de IA ou acesso a provedores.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { CATALOGO_SINTETICO } from "../src/application/onboarding/__tests__/fixtures/catalogoSintetico.js";

const url = new URL(process.argv[2]);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "55440" || url.username !== "lead_test" || url.pathname !== "/lead_flow_check") throw Error("Use somente o PostgreSQL local descartável lead_test:55440/lead_flow_check.");
const pasta = process.env.OPENING_TEST_OUTPUT || await fs.mkdtemp(path.join(os.tmpdir(), "abertura-completa-"));
await fs.mkdir(pasta, { recursive: true });
Object.assign(process.env, { DATABASE_URL: url.href, NODE_ENV: "test", INTEGRACAO_IA_COMERCIAL: "0", INTEGRACAO_WHATSAPP: "0", INTEGRACAO_FISCAL_LEADS: "0", GUIDE_STORAGE_PROVIDER: "LOCAL", GUIDE_LOCAL_STORAGE_DIR: path.join(pasta, "storage"), CERT_SECRET_KEY: "SOMENTE-TESTE-LOCAL-ABERTURA-SEM-DADOS-REAIS", AWS_KMS_CERT_KEY_ID: "", LOG_LEVEL: "fatal" });
let acessosExternos = 0;
const semRede = () => { acessosExternos++; throw Error("Provedores externos proibidos na simulação de abertura."); };
globalThis.fetch = http.get = http.request = https.get = https.request = semRede;
const { prisma: db } = await import("../src/infrastructure/db/prisma.js");
const { iniciarAtendimento, registrarCampos } = await import("../src/application/onboarding/LeadService.js");
const { criarServicoComercial } = await import("../src/application/onboarding/ComercialService.js");
const { criarPropostasComerciais } = await import("../src/application/onboarding/PropostasComerciaisService.js");
const { criarRecursosComerciais } = await import("../src/application/onboarding/RecursosComerciaisService.js");
const { criarJornadaLead } = await import("../src/application/onboarding/JornadaLeadService.js");
const { concluirEtapa, converter } = await import("../src/application/onboarding/OnboardingService.js");
const { listar, baixarBuffer } = await import("../src/application/companies/CompanyDocumentsService.js");
const { gerarContratoPdf } = await import("../src/application/onboarding/ContratoComercialPdf.js");
const { enviarProposta } = await import("../src/application/onboarding/EnvioPropostaService.js");
const { default: PDFDocument } = await import("pdfkit");
const { prepararConversao, aplicarConsultaNaConversao, payloadConversao } = await import("../../web/src/features/onboarding/lib/conversaoEmpresa.js");
const { mapearParaFormularioEmpresa } = await import("../../web/src/features/onboarding/lib/brasilApi.js");
const pdfSintetico = titulo => new Promise(resolve => { const d = new PDFDocument({ size: "A4", margin: 50 }), partes = []; d.on("data", b => partes.push(b)); d.on("end", () => resolve(Buffer.concat(partes))); d.fontSize(20).text("SIMULAÇÃO — SEM VALIDADE JURÍDICA"); d.moveDown().fontSize(14).text(titulo); d.moveDown().fontSize(11).text("Arquivo exclusivamente sintético para validar o armazenamento da abertura. Nenhum registro, assinatura ou pagamento real foi realizado."); d.end(); });
const checks = [], conversa = [], hash = b => crypto.createHash("sha256").update(b).digest("hex");
const ok = texto => { checks.push(texto); console.log(`OK ${texto}`); };
const run = crypto.randomUUID();
let user, owner, atendimento, chat, portal, legacy, cliente;
const recursosIds = [], chartIds = [];
const entrada = async texto => { conversa.push({ autor: "LEAD SINTÉTICO", texto }); return db.mensagemWhatsapp.create({ data: { conversaId: chat.id, providerMessageId: `wamid.OPENING.IN.${crypto.randomUUID()}`, direcao: "in", tipo: "text", corpo: texto } }); };
let nSaidas = 0;
const cloud = { enviarTexto: async ({ texto }) => { conversa.push({ autor: "ESCRITÓRIO (transporte simulado)", texto }); return { wamid: `wamid.OPENING.OUT.${run}.${++nSaidas}` }; }, enviarDocumento: async ({ conteudo, nomeArquivo, legenda }) => { assert.equal(conteudo.subarray(0, 5).toString(), "%PDF-"); await fs.writeFile(path.join(pasta, path.basename(nomeArquivo)), conteudo); conversa.push({ autor: "ESCRITÓRIO (transporte simulado)", texto: legenda, arquivo: nomeArquivo }); return { wamid: `wamid.OPENING.OUT.${run}.${++nSaidas}` }; } };
try {
  assert.equal(await db.portalClient.count({ where: { cnpj: "11222333000181" } }), 0, "CNPJ sintético deve estar livre neste banco descartável.");
  user = await db.user.create({ data: { name: "Contador da simulação", email: `contador-${run}@example.invalid`, passwordHash: "inutilizavel", role: "contador", accountType: "FIRM", status: "active" } });
  // Conta existente: prova que a segunda empresa do mesmo responsável não exige nova senha.
  owner = await db.user.create({ data: { name: "Marina Exemplo", email: `marina-${run}@example.invalid`, passwordHash: "inutilizavel", role: "cliente", accountType: "CLIENT", status: "active" } });
  for (const [i, tipo] of ["ATIVO", "PASSIVO", "RECEITA", "DESPESA", "PATRIMONIO"].entries()) {
    const c = await db.chartOfAccount.create({ data: { codigo: `TEST-${run}-${i}`, nome: `Conta sintética ${tipo}`, tipo } }); chartIds.push(c.id);
  }
  chat = await db.conversaWhatsapp.create({ data: { telefoneE164: "5511900000001", chaveEscopo: `abertura:${run}` } });
  const msg = await entrada("Olá, quero abrir uma empresa de consultoria e contratar a contabilidade. Ainda não tenho CNPJ.");
  atendimento = await iniciarAtendimento({ conversaId: chat.id, origem: "ABERTURA", atorId: user.id, client: db });
  const id = atendimento.onboardingId;
  let ficha = await registrarCampos({ onboardingId: id, versao: 0, mensagemId: msg.id, atorId: user.id, client: db, operacoes: [{ campo: "responsavelNome", acao: "set", valor: "Marina Exemplo" }, { campo: "atividadePretendida", acao: "set", valor: "Consultoria em gestão empresarial" }, { campo: "modalidadeServico", acao: "set", valor: "RECORRENTE" }] });
  ok("Contato de abertura cria atendimento e preenche a mesma ficha a partir da conversa");
  const comercial = criarServicoComercial({ db }), propostas = criarPropostasComerciais({ db }), recursos = criarRecursosComerciais({ db });
  const link = await comercial.emitirLink(id, user);
  ficha = await db.onboarding.findUnique({ where: { id } });
  const dados = { ...ficha.dados, razaoSocial: "SIMULAÇÃO AURORA CONSULTORIA LTDA", tipoEmpresa: "LTDA", responsavelEmail: owner.email, responsavelTelefone: "11900000001", responsavelCargo: "Sócia administradora", municipioAtendimento: "São Paulo/SP", municipioPretendido: "São Paulo/SP", enderecoPretendido: "Rua de Teste, 100, Centro, São Paulo/SP", capitalSocialPretendido: "25.000,50", socios: [{ nome: "Marina Exemplo", cpf: "52998224725", participacao: "60,5" }, { nome: "Paulo Exemplo", cpf: "11144477735", participacao: "39,5" }], regimePretendido: "SIMPLES", temProLabore: true, qtdFuncionarios: 0, notasRecebidasMes: 5, consultoriaMensal: false };
  await comercial.publico(link.token, { versao: ficha.versao, dados, finalizar: true });
  ficha = await db.onboarding.findUnique({ where: { id } });
  assert.equal(ficha.status, "RECEBIDO"); assert.equal(ficha.cnpj, null); assert.equal(ficha.dados.socios.length, 2);
  await assert.rejects(comercial.publico(link.token), e => e.code === "link_invalido");
  ok("Formulário público completa a ficha sem exigir CNPJ inexistente e encerra o link após envio");
  const jornada = criarJornadaLead({ db, cloud, janela: async () => ({ situacao: "ABERTA" }) });
  const diagnostico = await jornada.diagnosticar(id, user, { versao: ficha.versao, achados: "SIMULAÇÃO: endereço e atividade conferidos pelo contador; viabilidade e registro serão realizados externamente.", servicos: "Abertura da sociedade e contabilidade mensal, conforme proposta sintética." });
  await jornada.enviarDevolutiva(id, user, { diagnosticoId: diagnostico.id });
  assert.equal((await jornada.carregar(id, user)).devolutiva.concluida, true);
  ok("Contador revisa viabilidade e escopo, e a devolutiva fica registrada no chat");
  const catalogo = await recursos.criar({ tipo: "CATALOGO", chave: "honorarios", titulo: "Catálogo SINTÉTICO", dados: CATALOGO_SINTETICO }, user); recursosIds.push(catalogo.id); await recursos.aprovar(catalogo.id, user);
  const proposta = await propostas.gerar(id, user, { versao: ficha.versao, ajustes: { aberturaCentavos: 89500, justificativa: "Valores fictícios exclusivamente para a simulação." } });
  await propostas.aprovar(id, proposta.id, user);
  await enviarProposta(id, proposta.id, user, { db, cloud, webUrl: "https://example.invalid", janela: async () => ({ situacao: "ABERTA" }) });
  const textoProposta = conversa.at(-1).texto;
  const token = /token=([A-Za-z0-9_-]{43})/.exec(textoProposta)[1];
  await entrada("Aceito a abertura com contabilidade mensal da proposta.");
  await propostas.publico(token, { versao: proposta.versao, opcao: "RECORRENTE", confirmado: true });
  ok("Preço calculado, PDF enviado pelo transporte simulado e aceite vinculado à opção recorrente");
  const modelo = await recursos.criar({ tipo: "CONTRATO", chave: `contrato-${run}`, titulo: "Contrato SINTÉTICO", texto: "SIMULAÇÃO SEM VALIDADE JURÍDICA\nContratante: {{nome}}\nServiços: {{servico}}\nValores: {{honorarios}}\nCondições: {{condicoes}}", dados: { recorrente: true, permitePreCnpj: true } }, user); recursosIds.push(modelo.id); await recursos.aprovar(modelo.id, user);
  const contrato = await propostas.contrato(id, proposta.id, user, { modeloId: modelo.id });
  await fs.writeFile(path.join(pasta, "contrato-emitido.pdf"), await gerarContratoPdf(contrato));
  await propostas.aprovarContrato(id, contrato.id, user);
  const anexos = [];
  for (const nome of ["contrato-servicos-assinatura-SIMULADA.pdf", "contrato-social-SIMULADO.pdf", "cartao-cnpj-SIMULADO.pdf", "documentos-socios-SIMULADOS.pdf"]) {
    const buffer = await pdfSintetico(nome); await fs.writeFile(path.join(pasta, nome), buffer);
    const doc = await propostas.salvarDocumento(id, user, { buffer, mimetype: "application/pdf", originalname: nome }); anexos.push({ ...doc, buffer });
  }
  await propostas.conferirAssinatura(id, contrato.id, user, anexos[0].id);
  await assert.rejects(converter(id, {}, { atorId: user.id }), e => e.code === "pagamento_pendente");
  await jornada.confirmarPagamento(id, user, { contratoId: contrato.id, evidencia: "SIMULAÇÃO: pagamento conferido manualmente, sem cobrança bancária real." });
  ok("Contrato preenchido, PDF recebido e conferência manual da assinatura e do pagamento registrados");
  for (const etapa of await db.onboardingEtapa.findMany({ where: { onboardingId: id, acao: null } })) await concluirEtapa(id, etapa.id, { concluida: true, observacao: "SIMULAÇÃO: etapa externa conferida, sem registro real.", atorId: user.id });
  ficha = await db.onboarding.findUnique({ where: { id } });
  const inicial = prepararConversao(ficha);
  assert.equal(inicial.regimeTributario, ""); assert.equal(inicial.socios.length, 2);
  // Resposta pública simulada; nenhuma consulta sobre um CNPJ de terceiro é feita.
  const consulta = mapearParaFormularioEmpresa({ razao_social: dados.razaoSocial, nome_fantasia: "Aurora — simulação", cnae_fiscal: 7020400, cnaes_secundarios: [{ codigo: 8599604 }], capital_social: 25000.5, codigo_natureza_juridica: 2062, descricao_porte: "MICRO EMPRESA", data_inicio_atividade: "2026-09-16", descricao_tipo_de_logradouro: "Rua", logradouro: "de Teste", numero: "100", complemento: "Sala 2", bairro: "Centro", municipio: "São Paulo", uf: "SP", cep: "01001000" });
  const form = { ...aplicarConsultaNaConversao(inicial, consulta), cnpj: "11222333000181", regimeTributario: "SIMPLES", inscricaoMunicipal: "SIMULACAO100", cadastroConferido: true };
  const payload = payloadConversao(form, { senhaExigida: false });
  await db.propostaComercial.update({ where: { id: proposta.id }, data: { revogadaEm: new Date() } });
  await assert.rejects(converter(id, payload, { atorId: user.id }), e => e.code === "contrato_recorrente_necessario");
  await db.propostaComercial.update({ where: { id: proposta.id }, data: { revogadaEm: null } });
  ok("Proposta revogada não permite contornar assinatura e pagamento como se fosse uma ficha antiga");
  await fs.writeFile(path.join(pasta, "revisao-cadastro.json"), JSON.stringify({ onboarding: ficha, form }, null, 2));
  const original = await db.documentoOnboarding.findUnique({ where: { id: anexos[2].id } });
  await db.documentoOnboarding.update({ where: { id: original.id }, data: { sha256: "arquivo-corrompido" } });
  await assert.rejects(converter(id, payload, { atorId: user.id }), e => e.code === "arquivo_conversao_indisponivel");
  assert.equal(await db.portalClient.count({ where: { cnpj: payload.company.cnpj } }), 0);
  await db.documentoOnboarding.update({ where: { id: original.id }, data: { sha256: original.sha256 } });
  ok("Documento divergente impede a criação e preserva a ficha para nova tentativa");
  await assert.rejects(converter(id, { ...payload, contato: { ...payload.contato, telefone: "invalido" } }, { atorId: user.id }), e => e.code === "contato_invalido");
  assert.equal(await db.portalClient.count({ where: { cnpj: payload.company.cnpj } }), 0);
  assert.equal(await db.companyDocument.count(), 0);
  assert.equal((await db.onboarding.findUnique({ where: { id } })).status, "EM_TRILHA");
  ok("Falha após provisionamento reverte empresa, documentos e vínculo na mesma transação");
  const tentativas = await Promise.allSettled([1, 2].map(() => converter(id, payload, { atorId: user.id, portalIds: [], log: { warn() {}, error() {} } })));
  assert.equal(tentativas.filter(t => t.status === "fulfilled").length, 1, JSON.stringify(tentativas));
  const convertido = tentativas.find(t => t.status === "fulfilled").value;
  portal = await db.portalClient.findUnique({ where: { id: convertido.portalClientId } }); legacy = portal.companyId;
  portal.company = await db.company.findUnique({ where: { id: legacy }, include: { partners: true } }); cliente = portal.company.clientId;
  assert.equal(convertido.onboarding.status, "CONVERTIDO"); assert.equal(portal.company.partners.length, 2); assert.equal(Number(portal.company.capitalSocial), 25000.5); assert.equal(Number(portal.company.partners.find(s => s.name === "Marina Exemplo").participacao), 60.5);
  assert.deepEqual(portal.company.cnaesSecundarios, ["8599604"]); assert.equal(portal.company.enderecoJson.numero, "100"); assert.equal(portal.guideNotificationEmail, owner.email);
  const documentos = await listar({ portalClientId: portal.id });
  await fs.writeFile(path.join(pasta, "resultado.json"), JSON.stringify({ empresa: portal, documentos, checks, conversa, simulado: ["WhatsApp", "assinatura", "pagamento", "registro/CNPJ"], provedoresExternos: 0 }, null, 2));
  assert.equal(documentos.length, anexos.length + 2, "Anexos, proposta aceita e minuta emitida devem estar arquivados");
  for (const doc of documentos) {
    const lido = await baixarBuffer({ portalClientId: portal.id, documentId: doc.id });
    assert.equal(lido.buffer.length, doc.bytes);
    assert.equal(lido.buffer.subarray(0, 5).toString(), "%PDF-");
    await assert.rejects(baixarBuffer({ portalClientId: "outra-empresa", documentId: doc.id }), e => e.code === "documento_nao_encontrado");
  }
  for (const anexo of anexos) { const doc = documentos.find(d => d.nome === anexo.nome); assert.ok(doc, anexo.nome); const lido = await baixarBuffer({ portalClientId: portal.id, documentId: doc.id }); assert.equal(hash(lido.buffer), anexo.sha256); }
  ok("Ficha final contém sócios, capital, endereço, CNAEs, contato e documentos baixáveis idênticos aos originais");
  const contato = await db.contatoWhatsapp.findFirst({ where: { portalClientId: portal.id } });
  assert.equal(contato.telefoneE164, chat.telefoneE164); assert.equal(contato.email, owner.email); assert.equal(contato.userId, owner.id); assert.equal(contato.optInEm, null); assert.deepEqual(contato.permissoesAssistente, []);
  assert.ok((await db.atendimentoLead.findUnique({ where: { id: atendimento.id } })).encerradoEm);
  assert.equal(await db.documentoOnboarding.count({ where: { onboardingId: id } }), anexos.length);
  await assert.rejects(propostas.salvarDocumento(id, user, { buffer: anexos[0].buffer, mimetype: "application/pdf", originalname: "tardio.pdf" }), e => e.code === "atendimento_encerrado");
  ok("Contato chega à empresa sem consentimento inventado; atendimento encerra, originais ficam preservados");
  await assert.rejects(converter(id, payload, { atorId: user.id }), e => e.code === "onboarding_convertido");
  assert.equal((await listar({ portalClientId: portal.id })).length, documentos.length);
  ok("Conversão simultânea ou repetida não duplica a empresa nem os documentos");
  assert.equal(acessosExternos, 0);
  const linkArquivo = nome => path.join(pasta, nome).replaceAll("\\", "/");
  const linhas = ["# Simulação completa de abertura", "", "**Resultado: ficha da empresa preenchida e seis documentos armazenados e baixados com sucesso.**", "", "Dados e valores fictícios. PostgreSQL e armazenamento local reais; WhatsApp, assinatura, pagamento e registro/CNPJ simulados. Nenhuma chamada externa nem token de IA utilizado. Os registros de teste são removidos do banco ao fim; os arquivos abaixo preservam a evidência.", "", "## Ficha final", "", "| Campo | Resultado |", "| --- | --- |", `| Empresa | ${portal.razao} |`, `| CNPJ de teste | ${portal.cnpj} |`, `| Regime escolhido na revisão | ${portal.company.regimeTributario} |`, `| Capital social | R$ ${Number(portal.company.capitalSocial).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} |`, `| CNAE principal | ${portal.company.cnaePrincipal} |`, `| CNAEs secundários | ${portal.company.cnaesSecundarios.join(", ")} |`, `| Endereço | ${portal.company.endereco} |`, `| Responsável | Marina Exemplo · WhatsApp ${contato.telefoneE164} |`, `| Sócios | ${portal.company.partners.map(s => `${s.name}: ${s.participacao}%`).join("; ")} |`, "", "## Documentos na empresa", "", ...documentos.map(d => `- [${d.nome}](<${linkArquivo(`storage/${d.fileKey}`)}>) — ${d.bytes} bytes.`), "", "## Verificações aprovadas", "", ...checks.map(c => `- ${c}.`), "", `Dados completos: [resultado.json](<${linkArquivo("resultado.json")}>) · [revisão do cadastro](<${linkArquivo("revisao-cadastro.json")}>)`, "", "O teste não executa atos de abertura nos órgãos públicos, valida assinatura gov.br, realiza cobrança nem avalia um modelo de linguagem real. A criação efetiva exige o contador conferir os documentos e o CNPJ obtido externamente."];
  await fs.writeFile(path.join(pasta, "relatorio.md"), linhas.join("\n"));
  await fs.writeFile(path.join(pasta, "resultado.json"), JSON.stringify({ empresa: portal, documentos, checks, conversa, simulado: ["WhatsApp", "assinatura", "pagamento", "registro/CNPJ"], provedoresExternos: 0 }, null, 2));
  console.log(JSON.stringify({ ok: true, checks: checks.length, pasta }));
} finally {
  // Somente registros identificados desta execução; os PDFs de evidência ficam no diretório de saída.
  if (atendimento) { const id = atendimento.onboardingId; await db.onboardingEvento.deleteMany({ where: { onboardingId: id } }); await db.onboardingEtapa.deleteMany({ where: { onboardingId: id } }); await db.onboardingLink.deleteMany({ where: { onboardingId: id } }); await db.contratoComercial.deleteMany({ where: { onboardingId: id } }); await db.propostaComercial.deleteMany({ where: { onboardingId: id } }); await db.documentoOnboarding.deleteMany({ where: { onboardingId: id } }); await db.atendimentoLead.deleteMany({ where: { onboardingId: id } }); await db.onboarding.delete({ where: { id } }); }
  if (chat) { await db.mensagemWhatsapp.deleteMany({ where: { conversaId: chat.id } }); await db.conversaWhatsapp.delete({ where: { id: chat.id } }); }
  if (portal) await db.portalClient.delete({ where: { id: portal.id } });
  if (legacy) { await db.partner.deleteMany({ where: { companyId: legacy } }); await db.company.delete({ where: { id: legacy } }); }
  if (cliente) await db.client.delete({ where: { id: cliente } });
  await db.recursoComercial.deleteMany({ where: { id: { in: recursosIds } } });
  await db.chartOfAccount.deleteMany({ where: { id: { in: chartIds } } });
  if (owner) await db.user.delete({ where: { id: owner.id } });
  if (user) await db.user.delete({ where: { id: user.id } });
  await db.$disconnect();
}
