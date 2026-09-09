// Persistência real, fornecedores/atos fiscais sintéticos. Nunca lê .env para escolher o alvo.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";

const pos = process.argv.indexOf("--url");
const url = new URL(pos >= 0 ? process.argv[pos + 1] : "invalid:");
assert(url.protocol === "postgresql:" && url.hostname === "127.0.0.1" && url.port === "55443"
  && url.pathname === "/altan_whatsapp_test" && url.username === "altan_test",
"Use apenas PostgreSQL de teste em 127.0.0.1:55443/altan_whatsapp_test, usuário altan_test.");
process.env.DATABASE_URL = url.href;
process.env.NODE_ENV = "test";
process.env.INTEGRACAO_WHATSAPP_IA = "0";
process.env.INTEGRACAO_WHATSAPP = "0";
const redeProibida = () => { throw new Error("Rede externa proibida nesta verificação de persistência"); };
globalThis.fetch = redeProibida;
http.request = http.get = https.request = https.get = redeProibida;

const { prisma } = await import("../src/infrastructure/db/prisma.js");
const { processarEmissaoGuiada } = await import("../src/application/whatsapp/EmissaoGuiadaWhatsappService.js");
const log = { info() {}, warn() {}, error() {} };
const prefixo = `coleta-check-${randomUUID()}`;
const conversas = [];
const empresas = [];
let usuario;
let checks = 0;
const ok = (nome) => console.log(`PASS ${++checks}: ${nome}`);
const checkpoint = (conversaId) => prisma.rascunhoEmissaoWhatsapp.findUnique({ where: { conversaId } });

function conferirAcessoPara(conversa, mensagem, sessao) {
  return async () => {
    const atual = await prisma.conversaWhatsapp.findUnique({ where: { id: conversa.id } });
    assert(atual && atual.portalClientId === sessao.portalClientId && atual.escopoVerificado && !atual.excluidaEm
      && !atual.atendidaPor && !atual.atendidaDesde && (!atual.automacaoInvalidadaEm || atual.automacaoInvalidadaEm < mensagem.registradaEm), "Acesso à coleta mudou");
  };
}

async function caso(nome) {
  const empresa = await prisma.portalClient.create({ data: { razao: `${prefixo} ${nome}`, cnpj: `${prefixo}-${nome}` } });
  empresas.push(empresa.id);
  const conversa = await prisma.conversaWhatsapp.create({ data: { portalClientId: empresa.id, telefoneE164: "5511999999966", chaveEscopo: `empresa:${empresa.id}:5511999999966`, escopoVerificado: true } });
  conversas.push(conversa.id);
  const sessao = { ok: true, userId: usuario.id, portalClientId: empresa.id, papel: "CLIENT_ADMIN", permissoesAssistente: ["EMISSAO_NFSE"] };
  let sequencia = 0;
  let preparacoes = 0;
  let execucoes = 0;
  const servicos = {
    prepararTomadorDoCliente: async ({ tomadorDoc }) => ({ ok: true, tomador: { cnpjCpf: tomadorDoc, nome: "Tomador sintético", endereco: { CEP: "20040002", cMun: "3304557", xLgr: "Rua Sintética", nro: "10", xBairro: "Centro" } }, camposParaPerguntar: [], origens: { tomadorNome: "memoria" } }),
    executores: { EMITIR_NFSE: async () => { execucoes++; return { texto: "Nota sintética emitida, número 71.", filaHumana: false, resultado: { status: "issued", numero: "71", fixture: true } }; } },
    acoesDeps: { autorizarPermissaoDaAcao: async () => ({ ok: true }), autorizarEmissaoDoCliente: async () => ({ ok: true }) },
  };
  const executar = async (nome, input, ctx) => {
    if (nome === "tomadores_conhecidos") return { ok: true, tomadores: [] };
    assert.equal(nome, "preparar_emissao", "O teste não permite ferramentas não simuladas");
    preparacoes++;
    const preparada = await ctx.servicos.criarPendencia({ conversaId: conversa.id, portalClientId: empresa.id, userId: usuario.id,
      tipo: "EMITIR_NFSE", payload: { fixture: true, dados: input }, corpo: `Resumo sintético: valor ${input.valor}`,
      agora: ctx.agora, client: ctx.prisma });
    return { ok: true, textoDeConfirmacao: preparada.texto, codigo: preparada.codigo, origens: { fiscal: { fixture: true } } };
  };
  const entrada = (texto) => prisma.mensagemWhatsapp.create({ data: { conversaId: conversa.id, direcao: "in", tipo: "text", corpo: texto,
    registradaEm: new Date(Date.now() + (++sequencia) * 1000), providerMessageId: `wamid.fixture.${randomUUID()}` } });
  const processar = (mensagem, client = prisma) => processarEmissaoGuiada({ conversa, mensagem, sessao, texto: mensagem.corpo,
    agora: new Date(mensagem.registradaEm), client, servicos, executar, log, conferirAcesso: conferirAcessoPara(conversa, mensagem, sessao) });
  const responder = async (texto, client) => { const mensagem = await entrada(texto); return { mensagem, resultado: await processar(mensagem, client) }; };
  const ateCompetencia = async () => {
    await responder("emitir nota");
    await responder("11222333000181");
    await responder("Descrição: Serviço sintético; valor: 125,50");
  };
  return { conversa, sessao, entrada, processar, responder, ateCompetencia, preparacoes: () => preparacoes, execucoes: () => execucoes };
}

// O mesmo executável, em um processo novo, só pode recuperar o recibo: qualquer ferramenta falha.
const posRetomar = process.argv.indexOf("--retomar");
if (posRetomar >= 0) {
  try {
    const [conversaId, mensagemId, userId] = process.argv.slice(posRetomar + 1);
    const conversa = await prisma.conversaWhatsapp.findUniqueOrThrow({ where: { id: conversaId } });
    const mensagem = await prisma.mensagemWhatsapp.findUniqueOrThrow({ where: { id: mensagemId } });
    const sessao = { ok: true, userId, portalClientId: conversa.portalClientId };
    const resultado = await processarEmissaoGuiada({ conversa, mensagem, sessao, texto: mensagem.corpo, client: prisma,
      conferirAcesso: conferirAcessoPara(conversa, mensagem, sessao), executar: redeProibida, log });
    console.log(`RETOMADA:${JSON.stringify({ resultado, versao: (await checkpoint(conversaId)).versao })}`);
  } finally { await prisma.$disconnect(); }
} else {
  try {
    const [server] = await prisma.$queryRaw`SELECT current_database() AS db, current_user AS usuario, current_setting('server_version') AS versao`;
    assert.equal(server.db, "altan_whatsapp_test");
    assert.equal(server.usuario, "altan_test");
    assert.match(server.versao, /^16\./);
    usuario = await prisma.user.create({ data: { email: `${prefixo}@example.invalid`, passwordHash: "FIXTURE-SEM-LOGIN", status: "active" } });

    const unica = await caso("recibo-restart");
    const inicio = await unica.responder("emitir nota");
    assert.equal((await checkpoint(unica.conversa.id)).versao, 1);
    assert.deepEqual(await unica.processar(inicio.mensagem), inicio.resultado);
    assert.equal((await checkpoint(unica.conversa.id)).versao, 1);
    await assert.rejects(prisma.etapaEmissaoWhatsapp.create({ data: { mensagemId: inicio.mensagem.id, conversaId: unica.conversa.id, portalClientId: unica.sessao.portalClientId, userId: usuario.id, resultado: { duplicado: true } } }), e => e.code === "P2002");
    assert.equal(await prisma.etapaEmissaoWhatsapp.count({ where: { conversaId: unica.conversa.id } }), 1);
    ok("recibo único por entrada e reentrega não avançam a versão");

    const filho = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--url", url.href, "--retomar", unica.conversa.id, inicio.mensagem.id, usuario.id], { encoding: "utf8", windowsHide: true, timeout: 30000, env: process.env });
    assert.equal(filho.status, 0, filho.stderr || filho.error?.message);
    const retomada = JSON.parse(filho.stdout.split(/\r?\n/).find(l => l.startsWith("RETOMADA:")).slice(9));
    assert.deepEqual(retomada, { resultado: inicio.resultado, versao: 1 });
    ok("novo processo recupera pergunta persistida sem consultar ferramentas");

    const atomica = await caso("rollback-recibo");
    await atomica.ateCompetencia();
    const antes = await checkpoint(atomica.conversa.id);
    const msgPreparar = await atomica.entrada("atual");
    const falhaRecibo = prisma.$extends({ query: { etapaEmissaoWhatsapp: { create() { throw new Error("FALHA_RECIBO_CONTROLADA"); } } } });
    await assert.rejects(atomica.processar(msgPreparar, falhaRecibo), /FALHA_RECIBO_CONTROLADA/);
    const depois = await checkpoint(atomica.conversa.id);
    assert.equal(depois.versao, antes.versao);
    assert.deepEqual(depois.estado, antes.estado);
    assert.equal(await prisma.acaoPendenteWhatsapp.count({ where: { conversaId: atomica.conversa.id } }), 0);
    assert.equal(await prisma.etapaEmissaoWhatsapp.count({ where: { mensagemId: msgPreparar.id } }), 0);
    ok("falha no recibo reverte rascunho e criação da pendência na mesma transação");
    const preparada = await atomica.processar(msgPreparar);
    assert.equal(preparada.motivo, "EMISSAO_REVISAR");
    assert.equal((await checkpoint(atomica.conversa.id)).versao, antes.versao + 1);
    assert.equal(await prisma.acaoPendenteWhatsapp.count({ where: { conversaId: atomica.conversa.id, status: "pendente" } }), 1);
    assert.equal(await prisma.etapaEmissaoWhatsapp.count({ where: { mensagemId: msgPreparar.id } }), 1);
    ok("retry da preparação conclui rascunho, resumo e recibo juntos");

    // Ignora deliberadamente o lease no teste para comprovar a defesa CAS do banco.
    const corrida = await caso("cas-versao");
    await corrida.ateCompetencia();
    const base = await checkpoint(corrida.conversa.id);
    const m1 = await corrida.entrada("09/2026");
    const m2 = await corrida.entrada("08/2026");
    let leituras = 0;
    let liberar;
    const ambasLeram = new Promise(resolve => { liberar = resolve; });
    const barreira = prisma.$extends({ query: { rascunhoEmissaoWhatsapp: { async findUnique({ args, query }) {
      const r = await query(args);
      if (args.where.conversaId === corrida.conversa.id && ++leituras <= 2) {
        if (leituras === 2) liberar();
        await ambasLeram;
      }
      return r;
    } } } });
    const resultados = await Promise.allSettled([corrida.processar(m1, barreira), corrida.processar(m2, barreira)]);
    assert.equal(resultados.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(resultados.find(r => r.status === "rejected")?.reason?.codigo, "COLETA_CONCORRENTE");
    assert.equal((await checkpoint(corrida.conversa.id)).versao, base.versao + 1);
    assert.equal(await prisma.etapaEmissaoWhatsapp.count({ where: { mensagemId: { in: [m1.id, m2.id] } } }), 1);
    assert.equal(await prisma.acaoPendenteWhatsapp.count({ where: { conversaId: corrida.conversa.id } }), 1);
    assert.equal(await prisma.acaoPendenteWhatsapp.count({ where: { conversaId: corrida.conversa.id, status: "pendente" } }), 1);
    ok("duas transições sobre a mesma versão: uma vence e a outra reverte resumo e recibo");

    // Uma segunda janela: A já leu o rascunho, mas só lê a pendência depois que B terminou.
    // Cancelar apenas pelo id OBSERVADO não basta: esse id já pode ser o resumo vencedor de B.
    const tardia = await caso("pendencia-apos-snapshot");
    await tardia.ateCompetencia();
    const snapshot = await checkpoint(tardia.conversa.id);
    const mensagemA = await tardia.entrada("09/2026");
    const mensagemB = await tardia.entrada("08/2026");
    let avisarSnapshot;
    let liberarLeitor;
    const snapshotCapturado = new Promise(resolve => { avisarSnapshot = resolve; });
    const leitorLiberado = new Promise(resolve => { liberarLeitor = resolve; });
    let reteve = false;
    const leitorAntigo = prisma.$extends({ query: { rascunhoEmissaoWhatsapp: { async findUnique({ args, query }) {
      const r = await query(args);
      if (args.where.conversaId === tardia.conversa.id && !reteve) {
        reteve = true;
        avisarSnapshot();
        await leitorLiberado;
      }
      return r;
    } } } });
    // Instala handlers já ao iniciar: uma falha antecipada nunca fica como unhandled rejection.
    const leitor = tardia.processar(mensagemA, leitorAntigo).then(value => ({ value }), error => ({ error }));
    await snapshotCapturado;
    let vencedora;
    try {
      assert.equal((await tardia.processar(mensagemB)).motivo, "EMISSAO_REVISAR");
      vencedora = await prisma.acaoPendenteWhatsapp.findFirstOrThrow({ where: { conversaId: tardia.conversa.id, status: "pendente" } });
    } finally { liberarLeitor(); }
    const atrasada = await leitor;
    assert.equal(atrasada.error?.codigo, "COLETA_CONCORRENTE");
    assert.equal((await checkpoint(tardia.conversa.id)).versao, snapshot.versao + 1);
    assert.equal(await prisma.etapaEmissaoWhatsapp.count({ where: { mensagemId: mensagemA.id } }), 0);
    assert.equal(await prisma.etapaEmissaoWhatsapp.count({ where: { mensagemId: mensagemB.id } }), 1);
    assert.equal(await prisma.acaoPendenteWhatsapp.count({ where: { conversaId: tardia.conversa.id } }), 1);
    assert.equal((await prisma.acaoPendenteWhatsapp.findUniqueOrThrow({ where: { id: vencedora.id } })).status, "pendente");
    ok("leitor antigo que observa a pendência nova não cancela o resumo vencedor antes de falhar no CAS");

    const acao = await prisma.acaoPendenteWhatsapp.findFirstOrThrow({ where: { conversaId: atomica.conversa.id, status: "pendente" } });
    const msgConfirmar = await atomica.entrada(`CONFIRMAR ${acao.codigo}`);
    await assert.rejects(atomica.processar(msgConfirmar, falhaRecibo), /FALHA_RECIBO_CONTROLADA/);
    assert.equal(atomica.execucoes(), 1);
    const executada = await prisma.acaoPendenteWhatsapp.findUniqueOrThrow({ where: { id: acao.id } });
    assert.equal(executada.status, "executada");
    assert.equal(executada.respostaAoCliente, "Nota sintética emitida, número 71.");
    assert.equal(await prisma.etapaEmissaoWhatsapp.count({ where: { mensagemId: msgConfirmar.id } }), 0);
    const recuperada = await atomica.processar(msgConfirmar);
    assert.equal(recuperada.texto, executada.respostaAoCliente);
    assert.equal(recuperada.codigo, "RESULTADO_RECUPERADO");
    assert.equal(atomica.execucoes(), 1);
    assert.equal(await prisma.etapaEmissaoWhatsapp.count({ where: { mensagemId: msgConfirmar.id } }), 1);
    ok("crash após executor e antes do recibo recupera texto salvo sem emitir outra vez");

    console.log(`PASS: ${checks} verificações de coleta em PostgreSQL real; nenhum modelo, envio ou ato fiscal externo.`);
  } finally {
    if (conversas.length) await prisma.conversaWhatsapp.deleteMany({ where: { id: { in: conversas } } });
    if (empresas.length) await prisma.portalClient.deleteMany({ where: { id: { in: empresas } } });
    if (usuario) await prisma.user.delete({ where: { id: usuario.id } });
    await prisma.$disconnect();
  }
}
