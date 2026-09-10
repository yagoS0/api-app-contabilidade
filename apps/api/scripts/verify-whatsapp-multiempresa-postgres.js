// Banco descartável real; contatos, transportes, ferramentas e atos fiscais sintéticos.
// O alvo vem exclusivamente de --url, nunca de .env ou de variáveis de produção.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';

const pos = process.argv.indexOf('--url');
const url = new URL(pos >= 0 ? process.argv[pos + 1] : 'invalid:');
assert(url.protocol === 'postgresql:' && url.hostname === '127.0.0.1' && url.port === '55443'
  && url.pathname === '/altan_whatsapp_test' && url.username === 'altan_test',
'Use apenas PostgreSQL de teste em 127.0.0.1:55443/altan_whatsapp_test, usuário altan_test.');
process.env.DATABASE_URL = url.href;
process.env.NODE_ENV = 'test';
process.env.INTEGRACAO_WHATSAPP_IA = '0';
process.env.INTEGRACAO_WHATSAPP = '0';
process.env.INTEGRACAO_IA_COMERCIAL = '0';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'fixture-channel';
process.env.ANTHROPIC_API_KEY = 'TESTE-SEM-MODELOS';
process.env.OPENAI_API_KEY = 'TESTE-SEM-MODELOS';
const redeProibida = () => { throw new Error('Rede, modelo ou executor não simulado nesta verificação'); };
globalThis.fetch = redeProibida;
http.request = http.get = https.request = https.get = redeProibida;

const { prisma } = await import('../src/infrastructure/db/prisma.js');
const { garantirConversa } = await import('../src/application/whatsapp/ConversaWhatsappService.js');
const { resolverVinculoPorTelefone } = await import('../src/application/whatsapp/ContatoWhatsappService.js');
const { empresasAutorizadas } = await import('../src/application/whatsapp/selecaoEmpresaWhatsapp.js');
const { garantirAtendimentoResponsavel, resolverContextoDaMensagem, atenderContextoResponsavel,
  carregarMensagemResolvida, conferirContextoResponsavel, alterarAtendimentoHumano,
  selecionarEmpresaDoEscritorio } = await import('../src/application/whatsapp/AtendimentoResponsavelWhatsappService.js');
const { responderMenuWhatsapp } = await import('../src/application/whatsapp/MenuWhatsappService.js');
const { processarEventoWhatsapp } = await import('../src/application/whatsapp/ProcessarEventoWhatsappService.js');
const { iniciarColeta } = await import('../src/application/assistente/coletaEmissaoWhatsapp.js');
const { confirmarEExecutar, autorizarPermissaoDaAcao } = await import('../src/application/assistente/AcoesPendentesService.js');
const { grupoNoEscopo, filtroMensagensDoGrupo, resumoDoGrupo } = await import('../src/routes/firm/whatsappAtendimento.js');
const log = { info() {}, warn() {}, error() {} };
const prefixo = `multi-check-${randomUUID()}`;
const ids = { empresas: [], usuarios: [], conversas: [], atendimentos: [] };
let usuario;
let contador;
let checks = 0;
const ok = nome => console.log(`PASS ${++checks}: ${nome}`);
const json = valor => JSON.parse(JSON.stringify(valor));
const checkpoint = id => prisma.atendimentoResponsavelWhatsapp.findUniqueOrThrow({ where: { id } });
const recibo = mensagemId => prisma.resolucaoContextoWhatsapp.findUniqueOrThrow({ where: { mensagemId } });
const draft = conversaId => prisma.rascunhoEmissaoWhatsapp.findUnique({ where: { conversaId } });

function comPrazo(promise, nome) {
  let timer;
  const prazo = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Barreira não alcançada: ${nome}`)), 15000); });
  return Promise.race([promise, prazo]).finally(() => clearTimeout(timer));
}

async function conferirBanco() {
  const [server] = await prisma.$queryRaw`SELECT current_database() AS db, current_user AS usuario, current_setting('server_version') AS versao`;
  assert.equal(server.db, 'altan_whatsapp_test');
  assert.equal(server.usuario, 'altan_test');
  assert.match(server.versao, /^16\./);
}

async function novoCaso(nome) {
  const telefone = `55119${(BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`) % 100000000n).toString().padStart(8, '0')}`;
  assert.equal(await prisma.conversaWhatsapp.count({ where: { telefoneE164: telefone } }), 0, 'Telefone da fixture precisa estar vazio');
  assert.equal(await prisma.atendimentoResponsavelWhatsapp.count({ where: { telefoneE164: telefone } }), 0, 'Atendimento da fixture precisa estar vazio');
  assert.equal(await prisma.contatoWhatsapp.count({ where: { OR: [{ telefoneE164: telefone }, { waId: telefone }] } }), 0);
  const empresas = [];
  for (const letra of ['Alfa', 'Beta', 'Gama']) {
    const documentoSintetico = (BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 14)}`) % 100000000000000n).toString().padStart(14, '0');
    const empresa = await prisma.portalClient.create({ data: { razao: `${letra} ${prefixo} ${nome}`, cnpj: documentoSintetico, emissaoClienteLiberada: true } });
    ids.empresas.push(empresa.id);
    empresas.push(empresa);
    await prisma.companyClientUser.create({ data: { companyId: empresa.id, userId: usuario.id, role: 'OWNER', status: 'ACTIVE' } });
    await prisma.contatoWhatsapp.create({ data: { portalClientId: empresa.id, nome: `Responsável ${prefixo}`, telefoneE164: telefone, userId: usuario.id, ativo: true,
      permissoesAssistente: ['EMISSAO_NFSE', 'GUIAS', 'NOTAS_DANFSE', 'DOCUMENTOS_EMPRESA'] } });
  }
  const neutra = await garantirConversa({ telefone, client: prisma });
  ids.conversas.push(neutra.id);
  const vinculo = await resolverVinculoPorTelefone(telefone, { client: prisma });
  const acesso = empresasAutorizadas(vinculo);
  assert.equal(acesso.userId, usuario.id);
  assert.equal(acesso.empresas.length, 3);
  const atendimento = await garantirAtendimentoResponsavel({ conversa: neutra, empresas: acesso.empresas, userId: acesso.userId, client: prisma });
  ids.atendimentos.push(atendimento.id);
  const segmentos = await prisma.conversaWhatsapp.findMany({ where: { atendimentoId: atendimento.id } });
  for (const segmento of segmentos) if (!ids.conversas.includes(segmento.id)) ids.conversas.push(segmento.id);
  const daEmpresa = id => segmentos.find(c => c.portalClientId === id);
  let ultimoInstante = Date.now();
  const envios = [];
  const auditoriaEnvios = [];
  const consultas = [];
  const preparacoes = [];
  const execucoes = [];
  const enviar = async args => {
    assert.equal(args.telefone, telefone, 'O transporte sintético não pode receber outro telefone');
    const saida = await prisma.mensagemWhatsapp.findFirstOrThrow({ where: { conversa: { is: { atendimentoId: atendimento.id } }, direcao: 'out', statusEnvio: 'enviando' }, orderBy: { registradaEm: 'desc' } });
    const referenciaTurno = /^(?:empresa|menu):(.+)$/.exec(saida.turnoIaId || '');
    if (referenciaTurno) {
      const entradaPersistida = await prisma.mensagemWhatsapp.findUniqueOrThrow({ where: { id: referenciaTurno[1] } });
      const contextoPersistido = await recibo(entradaPersistida.id);
      assert.equal(entradaPersistida.direcao, 'in');
      assert.equal(contextoPersistido.atendimentoId, atendimento.id);
      auditoriaEnvios.push({ mensagemId: entradaPersistida.id, entradaTipo: entradaPersistida.tipo, reciboTipo: contextoPersistido.tipo,
        reciboEstado: contextoPersistido.estado, saidaTipo: saida.tipo });
    }
    envios.push(json(args));
    return { wamid: `wamid.fixture.out.${randomUUID()}` };
  };
  const cloud = { enviarTexto: enviar, enviarLista: enviar, enviarBotoes: enviar, enviarDocumento: redeProibida };
  const empresaDoContexto = ctx => {
    const empresa = empresas.find(e => e.id === ctx.sessao.portalClientId);
    assert(empresa, 'Ferramenta não pode consultar outra fixture/empresa');
    assert.equal(ctx.conversa.portalClientId, empresa.id);
    assert.equal(ctx.sessao.userId, usuario.id);
    return empresa;
  };
  const executar = async (ferramenta, input, ctx) => {
    const empresa = empresaDoContexto(ctx);
    consultas.push({ ferramenta, empresaId: empresa.id });
    if (ferramenta === 'quanto_devo' && nome === 'reacoes-menu-guias') return { ok: true, guias: [{ tipo: 'DAS', competencia: '2026-08', valorFormatado: 'R$ 125,50', vencimento: `20/${String(ctx.agora.getUTCMonth() + 1).padStart(2, '0')}/${ctx.agora.getUTCFullYear()}` }] };
    if (ferramenta === 'tomadores_conhecidos') return { ok: true, tomadores: [] };
    if (ferramenta === 'quanto_devo') return { ok: true, guias: [], quantidade: 0, observacao: `Guia sintética de ${empresa.razao}` };
    assert.equal(ferramenta, 'preparar_emissao', 'Ferramenta não simulada');
    preparacoes.push({ empresaId: empresa.id, dados: json(input) });
    const preparada = await ctx.servicos.criarPendencia({ conversaId: ctx.conversa.id, portalClientId: empresa.id, userId: usuario.id,
      tipo: 'EMITIR_NFSE', payload: { fixture: true, emissor: empresa.id, configuracaoFiscal: `fiscal:${empresa.id}`, dados: input },
      corpo: `Resumo sintético da empresa ${empresa.razao}: valor ${input.valor}`, agora: ctx.agora, client: ctx.prisma });
    return { ok: true, textoDeConfirmacao: preparada.texto, codigo: preparada.codigo, origens: { fiscal: { empresaId: empresa.id, fixture: true } } };
  };
  const executarEmissao = async ({ acao }) => {
    assert.equal(acao.payload.fixture, true);
    assert.equal(acao.payload.emissor, acao.portalClientId);
    assert.equal(acao.payload.configuracaoFiscal, `fiscal:${acao.portalClientId}`);
    assert(empresas.some(e => e.id === acao.portalClientId));
    execucoes.push({ acaoId: acao.id, empresaId: acao.portalClientId, contextoVersao: acao.contextoVersao });
    return { texto: 'Nota sintética emitida, número 83.', filaHumana: false, resultado: { status: 'issued', numero: '83', fixture: true, emissor: acao.portalClientId } };
  };
  const depsAcoes = {
    autorizarPermissaoDaAcao,
    autorizarEmissaoDoCliente: async ({ portalClientId, userId, client }) => {
      const empresa = await client.portalClient.findUnique({ where: { id: portalClientId } });
      const membro = await client.companyClientUser.findUnique({ where: { companyId_userId: { companyId: portalClientId, userId } } });
      return { ok: Boolean(empresa?.emissaoClienteLiberada && membro?.status === 'ACTIVE' && membro?.role === 'OWNER') };
    },
  };
  const servicosColeta = {
    prepararTomadorDoCliente: async ({ portalClientId, tomadorDoc }) => {
      assert(empresas.some(e => e.id === portalClientId));
      consultas.push({ ferramenta: 'prepararTomadorDoCliente', empresaId: portalClientId, tomadorDoc });
      return { ok: true, tomador: { cnpjCpf: tomadorDoc, nome: `Tomador sintético ${portalClientId}`, endereco: { CEP: '20040002', cMun: '3304557', xLgr: 'Rua Sintética', nro: '10', xBairro: 'Centro' } }, camposParaPerguntar: [], origens: { tomadorNome: 'memoria' } };
    },
    executores: { EMITIR_NFSE: executarEmissao, CANCELAR_NFSE: redeProibida, RECALCULAR_GUIA: redeProibida },
    acoesDeps: depsAcoes,
  };
  const entrada = async (texto, { interacao = null, origemId = neutra.id, respostaAProviderMessageId = null } = {}) => {
    ultimoInstante = Math.max(Date.now() + 5, ultimoInstante + 5);
    const mensagem = await prisma.mensagemWhatsapp.create({ data: { conversaId: origemId, direcao: 'in', tipo: interacao ? 'interactive' : 'text', corpo: texto,
      providerMessageId: `wamid.fixture.in.${randomUUID()}`, registradaEm: new Date(ultimoInstante), respostaAProviderMessageId } });
    const conversa = await prisma.conversaWhatsapp.findUniqueOrThrow({ where: { id: origemId } });
    return { registro: { conversa, mensagem, vinculo: await resolverVinculoPorTelefone(telefone, { client: prisma }), duplicada: false }, item: { corpo: texto, tipo: mensagem.tipo, interacao } };
  };
  const resolver = (inbound, client = prisma) => resolverContextoDaMensagem({ registro: inbound.registro, atendimento, texto: inbound.item.corpo,
    interacao: inbound.item.interacao, agora: new Date(inbound.registro.mensagem.registradaEm), client });
  const processar = (inbound, client = prisma) => atenderContextoResponsavel({ ...inbound, agora: new Date(inbound.registro.mensagem.registradaEm), client, cloud, log,
    flag: true, piloto: empresas.map(e => e.id), telefonesPiloto: [], conferirJanela: async () => ({ situacao: 'ABERTA' }),
    processar: (registro, item, lease) => responderMenuWhatsapp({ registro, texto: item.corpo, interacao: item.interacao, agora: new Date(registro.mensagem.registradaEm), client,
      cloud, logger: log, executar, servicosColeta, conferirJanela: async () => ({ situacao: 'ABERTA' }), textoLivreDisponivel: false, ...lease }),
  });
  const responder = async (texto, extra = {}) => { const inbound = await entrada(texto, extra); return { inbound, resultado: await processar(inbound) }; };
  let sequenciaProvedor = 0;
  const receberWebhook = async (texto, { interacao = null, tipoEvento = null, providerMessageId = `wamid.fixture.webhook.${randomUUID()}` } = {}) => {
    const tipo = tipoEvento || (interacao ? 'interactive' : 'text');
    const mensagemMeta = { from: telefone, id: providerMessageId, timestamp: String(Math.floor(Date.now() / 1000) + sequenciaProvedor++), type: tipo,
      ...(tipo === 'reaction' ? { reaction: { message_id: 'wamid.fixture.reacao', emoji: '👍' } }
        : interacao ? { interactive: { type: 'list_reply', list_reply: { id: interacao.id, title: interacao.titulo || 'Escolher empresa' } } } : { text: { body: texto } }) };
    const payload = { object: 'whatsapp_business_account', entry: [{ id: 'fixture-account', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { phone_number_id: 'fixture-channel' },
      contacts: [{ wa_id: telefone, profile: { name: 'Responsável sintético' } }], messages: [mensagemMeta],
    } }] }] };
    const resumo = await processarEventoWhatsapp(payload, { agora: new Date(), logger: log,
      // O ramo da IA fica elegível para denunciar qualquer fallback acidental: não existe modelo.
      ia: { flag: true, piloto: empresas.map(e => e.id) }, menu: { flag: true, piloto: empresas.map(e => e.id), telefonesPiloto: [], leads: false },
      responder: async () => { throw new Error('WEBHOOK_CHAMOU_IA_EM_FLUXO_DETERMINISTICO'); },
      atenderContexto: args => atenderContextoResponsavel({ ...args, client: prisma, cloud, conferirJanela: async () => ({ situacao: 'ABERTA' }) }),
      responderMenu: args => responderMenuWhatsapp({ ...args, client: prisma, cloud, executar, servicosColeta, conferirJanela: async () => ({ situacao: 'ABERTA' }) }),
    });
    assert.deepEqual(resumo.erros, [], 'O webhook deve completar o fluxo sem fallback de IA nem erro silencioso');
    assert.equal(resumo.mensagens.total, 1);
    assert.equal(resumo.mensagens.recusadas, 0);
    const mensagem = await prisma.mensagemWhatsapp.findUniqueOrThrow({ where: { providerMessageId } });
    return { resumo, mensagem, contexto: tipo === 'reaction' ? await prisma.resolucaoContextoWhatsapp.findUnique({ where: { mensagemId: mensagem.id } }) : await recibo(mensagem.id) };
  };
  const selecionar = async (empresa = empresas[0]) => {
    const inbound = await entrada(`empresa: ${empresa.razao}`);
    const r = await resolver(inbound);
    assert.equal(r.recibo.portalClientId, empresa.id);
    return { inbound, ...r };
  };
  const ateRevisao = async (empresa = empresas[0], documentoTomador = '11222333000181') => {
    await responder(`emitir uma nota pela ${empresa.razao}`);
    await responder(documentoTomador);
    await responder('Descrição: Serviço sintético; valor: 125,50');
    await responder('atual');
    const pendencia = await prisma.acaoPendenteWhatsapp.findFirstOrThrow({ where: { conversaId: daEmpresa(empresa.id).id, status: 'pendente' } });
    assert.equal(pendencia.portalClientId, empresa.id);
    assert.equal(pendencia.atendimentoId, atendimento.id);
    assert.equal(pendencia.contextoVersao, (await checkpoint(atendimento.id)).versao);
    return pendencia;
  };
  return { telefone, empresas, neutra, atendimento, segmentos, daEmpresa, entrada, resolver, processar, responder, receberWebhook, selecionar, ateRevisao, envios, auditoriaEnvios, consultas, preparacoes, execucoes, executarEmissao, depsAcoes };
}

async function semearRevisao(caso, empresa, codigo) {
  const conversa = caso.daEmpresa(empresa.id);
  const contexto = await checkpoint(caso.atendimento.id);
  const estado = iniciarColeta({ agora: new Date() }).estado;
  Object.assign(estado, { status: 'REVISAO', etapa: 'REVISAO', codigo, tomadorPreparado: true,
    dados: { endereco: {}, tomadorDoc: '11222333000181', tomadorNome: 'Tomador sintético', descricao: 'Serviço sintético', valor: 125.5, competencia: '2026-09' } });
  const rascunho = await prisma.rascunhoEmissaoWhatsapp.create({ data: { conversaId: conversa.id, portalClientId: empresa.id, userId: usuario.id,
    atendimentoId: contexto.id, contextoVersao: contexto.versao, estado, ultimaMensagemEm: new Date(), expiraEm: new Date(Date.now() + 86400000) } });
  const pendencia = await prisma.acaoPendenteWhatsapp.create({ data: { conversaId: conversa.id, portalClientId: empresa.id, userId: usuario.id,
    atendimentoId: contexto.id, contextoVersao: contexto.versao, tipo: 'EMITIR_NFSE', codigo,
    payload: { fixture: true, emissor: empresa.id }, textoDeConfirmacao: `Resumo sintético ${codigo}`, expiraEm: new Date(Date.now() + 900000) } });
  return { rascunho, pendencia };
}

async function limparFixtures() {
  // Restrict preserva a auditoria na aplicação. Aqui removemos apenas IDs criados pelo script,
  // primeiro resoluções e ações, depois segmentos, atendimento e seus cadastros sintéticos.
  if (ids.atendimentos.length) {
    await prisma.resolucaoContextoWhatsapp.deleteMany({ where: { atendimentoId: { in: ids.atendimentos } } });
    await prisma.turnoIaWhatsapp.deleteMany({ where: { atendimentoId: { in: ids.atendimentos } } });
    await prisma.acaoPendenteWhatsapp.deleteMany({ where: { atendimentoId: { in: ids.atendimentos } } });
    await prisma.whatsappLease.deleteMany({ where: { id: { in: ids.atendimentos.map(id => `responsavel:${id}`) } } });
  }
  if (ids.conversas.length) await prisma.conversaWhatsapp.deleteMany({ where: { id: { in: ids.conversas } } });
  if (ids.atendimentos.length) await prisma.atendimentoResponsavelWhatsapp.deleteMany({ where: { id: { in: ids.atendimentos } } });
  if (ids.empresas.length) await prisma.portalClient.deleteMany({ where: { id: { in: ids.empresas } } });
  if (ids.usuarios.length) await prisma.user.deleteMany({ where: { id: { in: ids.usuarios } } });
}

const posRetomar = process.argv.indexOf('--retomar');
if (posRetomar >= 0) {
  try {
    await conferirBanco();
    const [atendimentoId, mensagemId] = process.argv.slice(posRetomar + 1);
    const mensagem = await prisma.mensagemWhatsapp.findUniqueOrThrow({ where: { id: mensagemId } });
    const conversa = await prisma.conversaWhatsapp.findUniqueOrThrow({ where: { id: mensagem.conversaId } });
    const vinculo = await resolverVinculoPorTelefone(conversa.telefoneE164, { client: prisma });
    const resultado = await resolverContextoDaMensagem({ registro: { conversa, mensagem, vinculo }, atendimento: { id: atendimentoId }, texto: 'NÃO REINTERPRETAR ESTE TEXTO', client: prisma, resolverVinculo: redeProibida });
    console.log(`RETOMADA:${JSON.stringify({ recibo: resultado.recibo, origemId: mensagem.conversaId })}`);
  } finally { await prisma.$disconnect(); }
} else {
  try {
    await conferirBanco();
    usuario = await prisma.user.create({ data: { email: `${prefixo}-responsavel@example.invalid`, passwordHash: 'FIXTURE-SEM-LOGIN', status: 'active' } });
    ids.usuarios.push(usuario.id);
    contador = await prisma.user.create({ data: { email: `${prefixo}-contador@example.invalid`, passwordHash: 'FIXTURE-SEM-LOGIN', status: 'active' } });
    ids.usuarios.push(contador.id);

    const jornada = await novoCaso('reacoes-menu-guias');
    const antesDaReacao = await checkpoint(jornada.atendimento.id);
    for (let i = 0; i < 2; i++) {
      const reacao = await jornada.receberWebhook('', { tipoEvento: 'reaction' });
      assert.equal(reacao.contexto, null);
    }
    assert.equal(jornada.envios.length, 0, 'Reações não abrem menu');
    assert.deepEqual(await checkpoint(jornada.atendimento.id), antesDaReacao, 'Reações não alteram seleção');
    await jornada.receberWebhook('oi');
    const botaoEmpresa = jornada.envios.at(-1).linhas.find(o => o.id.endsWith(`.${jornada.empresas[1].id}`));
    await jornada.receberWebhook('', { tipoEvento: 'reaction' });
    await jornada.receberWebhook(botaoEmpresa.titulo, { interacao: botaoEmpresa });
    const menuDaEmpresa = jornada.envios.at(-1);
    const botaoGuias = menuDaEmpresa.botoes.find(o => o.titulo === 'Guias do mês');
    assert.match(botaoGuias.id, /^altan\.ctx\.v1:/);
    const antesDasGuias = await checkpoint(jornada.atendimento.id);
    const pedidoGuias = await jornada.receberWebhook('Guias do mês', { interacao: botaoGuias });
    assert.equal(pedidoGuias.contexto.portalClientId, jornada.empresas[1].id);
    assert.equal((await checkpoint(jornada.atendimento.id)).versao, antesDasGuias.versao);
    assert.equal(jornada.envios.filter(e => e.tituloBotao === 'Escolher empresa').length, 1);
    assert.equal(jornada.consultas.filter(c => c.ferramenta === 'quanto_devo').length, 1);
    assert.equal(jornada.consultas.find(c => c.ferramenta === 'quanto_devo').empresaId, jornada.empresas[1].id);
    assert.match(jornada.envios.at(-1).texto, /Guias liberadas[\s\S]*DAS/);
    await jornada.receberWebhook('Guias do mês', { interacao: botaoGuias, providerMessageId: pedidoGuias.mensagem.providerMessageId });
    assert.equal(jornada.consultas.filter(c => c.ferramenta === 'quanto_devo').length, 1, 'Reentrega não consulta nem responde de novo');
    ok('webhook real: reações → empresa → menu → guias e reentrega sem modelo');

    const selecao = await novoCaso('selecao-recibo');
    const textoInicial = 'preciso emitir uma nota; valor: 125,50; serviço: consulta sintética';
    const primeiro = await selecao.entrada(textoInicial);
    assert.equal((await selecao.processar(primeiro)).motivo, 'SELECAO_EMPRESA');
    const estadoSelecao = await checkpoint(selecao.atendimento.id);
    assert.equal(estadoSelecao.pedidoPendente, textoInicial);
    assert.equal(selecao.envios.length, 1);
    assert.equal(selecao.envios[0].linhas.length, 3);
    await selecao.processar(primeiro);
    assert.equal(selecao.envios.length, 1, 'Reentrega não reenvia seletor já rastreado');
    assert.equal((await checkpoint(selecao.atendimento.id)).versao, estadoSelecao.versao);
    const escolhida = selecao.empresas[1];
    const botao = selecao.envios[0].linhas.find(o => o.id.endsWith(`.${escolhida.id}`));
    const escolha = await selecao.entrada('Escolher empresa', { interacao: { id: botao.id } });
    const escolhidaResolvida = await selecao.resolver(escolha);
    assert.equal(escolhidaResolvida.recibo.portalClientId, escolhida.id);
    assert.equal(escolhidaResolvida.recibo.texto, textoInicial);
    assert.equal((await prisma.mensagemWhatsapp.findUniqueOrThrow({ where: { id: escolha.registro.mensagem.id } })).conversaId, selecao.neutra.id);
    assert.equal(await prisma.mensagemWhatsapp.count({ where: { providerMessageId: escolha.registro.mensagem.providerMessageId } }), 1);
    const carregada = await carregarMensagemResolvida({ conversa: escolhidaResolvida.registro.conversa, mensagemId: escolha.registro.mensagem.id, client: prisma });
    assert.equal(carregada.mensagem.conversaId, selecao.daEmpresa(escolhida.id).id);
    assert.equal(carregada.mensagem.corpo, textoInicial);
    await assert.rejects(carregarMensagemResolvida({ conversa: selecao.daEmpresa(selecao.empresas[0].id), mensagemId: escolha.registro.mensagem.id, client: prisma }), e => e.codigo === 'CONTEXTO_INVALIDO');
    await assert.rejects(prisma.mensagemWhatsapp.delete({ where: { id: escolha.registro.mensagem.id } }), e => e.code === 'P2003');
    assert.deepEqual((await selecao.resolver(escolha)).recibo, escolhidaResolvida.recibo);
    await assert.rejects(prisma.resolucaoContextoWhatsapp.create({ data: { mensagemId: escolha.registro.mensagem.id, atendimentoId: selecao.atendimento.id, versao: 1, estado: 'SELECAO' } }), e => e.code === 'P2002');
    await selecao.processar(escolha);
    const rascunhoInicial = await draft(selecao.daEmpresa(escolhida.id).id);
    assert.equal(rascunhoInicial.estado.dados.valor, 125.5);
    assert.equal(rascunhoInicial.estado.dados.descricao, 'consulta sintética');
    ok('três empresas: seletor idempotente, pedido inicial preservado e resolução sem mover mensagem');

    const filho = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--url', url.href, '--retomar', selecao.atendimento.id, escolha.registro.mensagem.id],
      { encoding: 'utf8', windowsHide: true, timeout: 30000, env: process.env });
    assert.equal(filho.status, 0, filho.stderr || filho.error?.message);
    const retomada = JSON.parse(filho.stdout.split(/\r?\n/).find(l => l.startsWith('RETOMADA:')).slice('RETOMADA:'.length));
    assert.deepEqual(retomada, { recibo: json(escolhidaResolvida.recibo), origemId: selecao.neutra.id });
    ok('processo novo recupera resolução persistida sem reinterpretar o pedido nem consultar serviços');

    const numerica = await novoCaso('numero-revogado');
    const inicioNumerico = await numerica.entrada('manda a guia');
    await numerica.resolver(inicioNumerico);
    const ordem = (await checkpoint(numerica.atendimento.id)).empresaIdsOferecidos;
    const idRevogado = ordem[1];
    await prisma.companyClientUser.update({ where: { companyId_userId: { companyId: idRevogado, userId: usuario.id } }, data: { status: 'REMOVED' } });
    const tentativaRevogada = await numerica.resolver(await numerica.entrada('2'));
    assert.equal(tentativaRevogada.recibo.estado, 'SELECAO');
    assert.equal(tentativaRevogada.recibo.portalClientId, null, 'Número revogado não pode selecionar a antiga opção 3');
    const novaOrdem = (await checkpoint(numerica.atendimento.id)).empresaIdsOferecidos;
    const numero = await numerica.resolver(await numerica.entrada('1'));
    assert.equal(numero.recibo.portalClientId, novaOrdem[0]);
    assert.equal(numero.recibo.texto, 'manda a guia');
    ok('resposta numérica usa a lista persistida e revogação não desloca a escolha antiga');

    const emissao = await novoCaso('emissao-completa');
    const emissora = emissao.empresas[1];
    const pendente = await emissao.ateRevisao(emissora, emissao.empresas[0].cnpj);
    assert(emissao.consultas.every(c => c.empresaId === emissora.id));
    assert(emissao.preparacoes.every(p => p.empresaId === emissora.id));
    assert.equal(emissao.preparacoes[0].dados.tomadorDoc, emissao.empresas[0].cnpj, 'CNPJ de outra empresa é tomador, sem trocar emissora');
    assert(pendente.textoDeConfirmacao.includes(`Empresa emissora: ${emissora.razao}`));
    const versaoAntesDocumento = (await checkpoint(emissao.atendimento.id)).versao;
    // Uma entrada textual igual a um nome cadastrado também não representa troca na revisão.
    const nomeTomador = await emissao.entrada(emissao.empresas[0].razao);
    const nomeResolvido = await emissao.resolver(nomeTomador);
    assert.equal(nomeResolvido.recibo.portalClientId, emissora.id);
    assert.equal((await checkpoint(emissao.atendimento.id)).versao, versaoAntesDocumento);
    const confirmar = await emissao.responder(`CONFIRMAR ${pendente.codigo}`);
    assert.equal((await recibo(confirmar.inbound.registro.mensagem.id)).texto, `CONFIRMAR ${pendente.codigo}`, 'Código do turno não pode virar menu');
    assert.equal(emissao.execucoes.length, 1);
    assert.equal(emissao.execucoes[0].empresaId, emissora.id);
    assert.equal((await prisma.acaoPendenteWhatsapp.findUniqueOrThrow({ where: { id: pendente.id } })).status, 'executada');
    await emissao.processar(confirmar.inbound);
    assert.equal(emissao.execucoes.length, 1);
    ok('Menu → coleta → confirmação executa uma vez com a configuração da emissora fixada');

    const webhook = await novoCaso('webhook-completo');
    const empresaWebhook = webhook.empresas[2];
    const pedidoWebhook = 'preciso emitir uma nota; valor: 230,75; serviço: atendimento sintético';
    const primeiroWebhook = await webhook.receberWebhook(pedidoWebhook);
    assert.equal(primeiroWebhook.mensagem.tipo, 'text');
    assert.equal(primeiroWebhook.mensagem.conversaId, webhook.neutra.id);
    assert.equal(primeiroWebhook.contexto.estado, 'SELECAO');
    assert.deepEqual(webhook.auditoriaEnvios[0], { mensagemId: primeiroWebhook.mensagem.id, entradaTipo: 'text', reciboTipo: null, reciboEstado: 'SELECAO', saidaTipo: 'interactive' });
    const opcaoWebhook = webhook.envios[0].linhas.find(o => o.id.endsWith(`.${empresaWebhook.id}`));
    assert(opcaoWebhook, 'Seletor precisa oferecer a empresa autorizada');
    const escolhaWebhook = await webhook.receberWebhook(null, { interacao: { id: opcaoWebhook.id, titulo: opcaoWebhook.titulo } });
    assert.equal(escolhaWebhook.mensagem.tipo, 'interactive', 'O tipo bruto recebido da Meta permanece imutável');
    assert.equal(escolhaWebhook.mensagem.corpo, opcaoWebhook.titulo);
    assert.equal(escolhaWebhook.mensagem.conversaId, webhook.neutra.id);
    assert.equal(escolhaWebhook.contexto.tipo, 'text', 'Um clique que retoma pedido digitado precisa alimentar o roteiro como texto');
    assert.equal(escolhaWebhook.contexto.texto, pedidoWebhook);
    assert.equal(escolhaWebhook.contexto.portalClientId, empresaWebhook.id);
    assert.deepEqual(webhook.auditoriaEnvios.find(e => e.mensagemId === escolhaWebhook.mensagem.id), {
      mensagemId: escolhaWebhook.mensagem.id, entradaTipo: 'interactive', reciboTipo: 'text', reciboEstado: 'RESOLVIDA', saidaTipo: 'text',
    });
    const dadosWebhook = (await draft(webhook.daEmpresa(empresaWebhook.id).id)).estado.dados;
    assert.equal(dadosWebhook.valor, 230.75);
    assert.equal(dadosWebhook.descricao, 'atendimento sintético');
    await webhook.receberWebhook(webhook.empresas[0].cnpj);
    await webhook.receberWebhook('atual');
    const acaoWebhook = await prisma.acaoPendenteWhatsapp.findFirstOrThrow({ where: { conversaId: webhook.daEmpresa(empresaWebhook.id).id, status: 'pendente' } });
    const confirmacaoWebhook = await webhook.receberWebhook(`CONFIRMAR ${acaoWebhook.codigo}`);
    assert.equal(confirmacaoWebhook.contexto.tipo, 'text');
    assert.equal(confirmacaoWebhook.contexto.texto, `CONFIRMAR ${acaoWebhook.codigo}`);
    assert.equal(webhook.execucoes.length, 1);
    assert.equal(webhook.execucoes[0].empresaId, empresaWebhook.id);
    assert.equal((await prisma.acaoPendenteWhatsapp.findUniqueOrThrow({ where: { id: acaoWebhook.id } })).status, 'executada');
    assert(webhook.consultas.every(c => c.empresaId === empresaWebhook.id));
    const saidasAntesReentrega = webhook.envios.length;
    const reentregaWebhook = await webhook.receberWebhook(`CONFIRMAR ${acaoWebhook.codigo}`, { providerMessageId: confirmacaoWebhook.mensagem.providerMessageId });
    assert.equal(reentregaWebhook.resumo.mensagens.duplicadas, 1);
    assert.equal(webhook.execucoes.length, 1);
    assert.equal(webhook.envios.length, saidasAntesReentrega);
    assert.equal(await prisma.turnoIaWhatsapp.count({ where: { atendimentoId: webhook.atendimento.id } }), 0);
    ok('webhook real persiste entrada → contexto → saída, retoma clique como texto e confirma sem IA nem duplicação');

    const troca = await novoCaso('troca-retomada');
    const a = troca.empresas[0];
    const b = troca.empresas[1];
    const antesTroca = await troca.ateRevisao(a);
    const contextoA = await checkpoint(troca.atendimento.id);
    await troca.responder(`trocar para ${b.razao}`);
    assert.equal((await prisma.acaoPendenteWhatsapp.findUniqueOrThrow({ where: { id: antesTroca.id } })).status, 'cancelada');
    assert.equal((await draft(troca.daEmpresa(a.id).id)).estado.status, 'PAUSADO');
    assert.equal((await draft(troca.daEmpresa(a.id).id)).estado.codigo, undefined);
    assert((await checkpoint(troca.atendimento.id)).versao > contextoA.versao);
    await troca.responder(`trocar para ${a.razao}`);
    await troca.responder(`CONFIRMAR ${antesTroca.codigo}`);
    assert.equal(troca.execucoes.length, 0, 'Código anterior não executa ao voltar à mesma empresa');
    await troca.responder(`emitir uma nota pela ${a.razao}`);
    const renovada = await prisma.acaoPendenteWhatsapp.findFirstOrThrow({ where: { conversaId: troca.daEmpresa(a.id).id, status: 'pendente' } });
    assert.notEqual(renovada.id, antesTroca.id);
    assert.notEqual(renovada.codigo, antesTroca.codigo);
    assert.equal(renovada.contextoVersao, (await checkpoint(troca.atendimento.id)).versao);
    assert.equal((await draft(troca.daEmpresa(a.id).id)).estado.dados.valor, 125.5);
    ok('trocar pausa rascunho e cancela código; voltar exige nova revisão sem perder os dados');

    const atomica = await novoCaso('rollback-contexto');
    await atomica.selecionar(atomica.empresas[0]);
    const semeada = await semearRevisao(atomica, atomica.empresas[0], 'ABCD');
    const contextoAntes = await checkpoint(atomica.atendimento.id);
    const entradaRollback = await atomica.entrada(`trocar para ${atomica.empresas[1].razao}`);
    const falhaRecibo = prisma.$extends({ query: { resolucaoContextoWhatsapp: { create() { throw new Error('FALHA_RECIBO_CONTEXTO'); } } } });
    await assert.rejects(atomica.resolver(entradaRollback, falhaRecibo), /FALHA_RECIBO_CONTEXTO/);
    assert.deepEqual(await checkpoint(atomica.atendimento.id), contextoAntes);
    assert.equal((await draft(atomica.daEmpresa(atomica.empresas[0].id).id)).versao, semeada.rascunho.versao);
    assert.equal((await draft(atomica.daEmpresa(atomica.empresas[0].id).id)).estado.status, 'REVISAO');
    assert.equal((await prisma.acaoPendenteWhatsapp.findUniqueOrThrow({ where: { id: semeada.pendencia.id } })).status, 'pendente');
    assert.equal(await prisma.resolucaoContextoWhatsapp.count({ where: { mensagemId: entradaRollback.registro.mensagem.id } }), 0);
    await atomica.resolver(entradaRollback);
    assert.equal((await checkpoint(atomica.atendimento.id)).portalClientId, atomica.empresas[1].id);
    assert.equal((await prisma.acaoPendenteWhatsapp.findUniqueOrThrow({ where: { id: semeada.pendencia.id } })).status, 'cancelada');
    ok('falha no recibo reverte seleção, pausa e cancelamento na mesma transação; retry conclui');

    const corrida = await novoCaso('cas-contexto');
    await corrida.selecionar(corrida.empresas[0]);
    const base = await checkpoint(corrida.atendimento.id);
    const m1 = await corrida.entrada(`trocar para ${corrida.empresas[1].razao}`);
    const m2 = await corrida.entrada(`trocar para ${corrida.empresas[2].razao}`);
    let leituras = 0;
    let liberar;
    const ambasLeram = new Promise(resolve => { liberar = resolve; });
    const barreira = prisma.$extends({ query: { atendimentoResponsavelWhatsapp: { async findUnique({ args, query }) {
      const r = await query(args);
      if (args.where.id === corrida.atendimento.id && ++leituras <= 2) {
        if (leituras === 2) liberar();
        await comPrazo(ambasLeram, 'duas leituras do contexto');
      }
      return r;
    } } } });
    const resultados = await Promise.allSettled([corrida.resolver(m1, barreira), corrida.resolver(m2, barreira)]);
    assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(resultados.find(r => r.status === 'rejected')?.reason?.codigo, 'CONTEXTO_CONCORRENTE');
    assert.equal((await checkpoint(corrida.atendimento.id)).versao, base.versao + 1);
    assert.equal(await prisma.resolucaoContextoWhatsapp.count({ where: { mensagemId: { in: [m1.registro.mensagem.id, m2.registro.mensagem.id] } } }), 1);
    ok('CAS real admite uma troca por versão; a concorrente não grava recibo nem substitui emissora');

    const humana = await novoCaso('humano-revogacao');
    const rHumana = await humana.selecionar(humana.empresas[0]);
    for (let i = 0; i < humana.empresas.length; i++) await semearRevisao(humana, humana.empresas[i], ['EFGH', 'JKLM', 'NPQR'][i]);
    await prisma.turnoIaWhatsapp.create({ data: { atendimentoId: humana.atendimento.id, contextoVersao: rHumana.recibo.versao, mensagemId: randomUUID(), conversaId: humana.daEmpresa(humana.empresas[1].id).id, portalClientId: humana.empresas[1].id, status: 'processando', reservaToken: 'fixture-reserva' } });
    await alterarAtendimentoHumano({ conversa: rHumana.registro.conversa, atendidaPor: contador.id, atendidaDesde: new Date(), client: prisma });
    const segmentosHumanos = await prisma.conversaWhatsapp.findMany({ where: { atendimentoId: humana.atendimento.id } });
    assert(segmentosHumanos.every(c => c.atendidaPor === contador.id && c.atendidaDesde));
    assert.equal(await prisma.acaoPendenteWhatsapp.count({ where: { atendimentoId: humana.atendimento.id, status: 'pendente' } }), 0);
    assert.equal(await prisma.turnoIaWhatsapp.count({ where: { atendimentoId: humana.atendimento.id, status: 'ignorado', reservaToken: null } }), 1);
    assert.equal((await humana.resolver(await humana.entrada('manda a guia'))).suspenso, true);
    await assert.rejects(conferirContextoResponsavel({ conversa: rHumana.registro.conversa, mensagem: rHumana.registro.mensagem, contexto: rHumana.recibo, client: prisma }), e => e.codigo === 'CONTEXTO_ALTERADO');
    await alterarAtendimentoHumano({ conversa: rHumana.registro.conversa, client: prisma });
    assert.equal((await checkpoint(humana.atendimento.id)).aguardandoSelecao, true);
    const reativada = await humana.selecionar(humana.empresas[0]);
    await prisma.companyClientUser.update({ where: { companyId_userId: { companyId: humana.empresas[0].id, userId: usuario.id } }, data: { status: 'REMOVED' } });
    await assert.rejects(conferirContextoResponsavel({ conversa: reativada.registro.conversa, mensagem: reativada.registro.mensagem, contexto: reativada.recibo, client: prisma }), e => e.codigo === 'ACESSO_REVOGADO');
    ok('humano assume todos os segmentos e jobs; devolver exige seleção e revogação bloqueia acesso');

    const carteira = await novoCaso('carteira-historico');
    const resolucaoA = await carteira.selecionar(carteira.empresas[0]);
    const mensagemA = resolucaoA.inbound.registro.mensagem;
    const mensagemB = await carteira.resolver(await carteira.entrada(`empresa: ${carteira.empresas[1].razao}`));
    const neutraPrivada = await prisma.mensagemWhatsapp.create({ data: { conversaId: carteira.neutra.id, direcao: 'in', tipo: 'text', corpo: 'DADOS NEUTROS DE TODAS AS EMPRESAS', providerMessageId: `wamid.fixture.${randomUUID()}` } });
    const saidaB = await prisma.mensagemWhatsapp.create({ data: { conversaId: carteira.daEmpresa(carteira.empresas[1].id).id, direcao: 'out', tipo: 'document', corpo: 'GUIA PRIVADA B', providerMessageId: `wamid.fixture.${randomUUID()}` } });
    const grupoParcial = await grupoNoEscopo({ conversa: carteira.daEmpresa(carteira.empresas[0].id), visiveis: [carteira.empresas[0].id], client: prisma });
    assert.equal(grupoParcial.segmentos.length, 1);
    assert.equal(grupoParcial.segmentosNeutros.length, 0);
    const visiveis = await prisma.mensagemWhatsapp.findMany({ where: filtroMensagensDoGrupo(grupoParcial), include: { contexto: true } });
    assert.deepEqual(visiveis.map(m => m.id), [mensagemA.id]);
    const resumoParcial = resumoDoGrupo(grupoParcial, carteira.daEmpresa(carteira.empresas[0].id));
    assert.equal(resumoParcial.atendimento.empresaAtual, null);
    assert.equal(resumoParcial.atendimento.empresaAtualId, null);
    assert(!JSON.stringify(resumoParcial).includes(carteira.empresas[1].id));
    const grupoCompleto = await grupoNoEscopo({ conversa: carteira.daEmpresa(carteira.empresas[0].id), visiveis: carteira.empresas.map(e => e.id), client: prisma });
    const todos = await prisma.mensagemWhatsapp.findMany({ where: filtroMensagensDoGrupo(grupoCompleto) });
    assert(todos.some(m => m.id === neutraPrivada.id));
    assert(todos.some(m => m.id === saidaB.id));
    assert(todos.some(m => m.id === mensagemB.recibo.mensagemId));
    const filtroA = await prisma.mensagemWhatsapp.findMany({ where: filtroMensagensDoGrupo(grupoCompleto, carteira.empresas[0].id) });
    assert.deepEqual(filtroA.map(m => m.id), [mensagemA.id]);
    assert.equal((await prisma.mensagemWhatsapp.findUniqueOrThrow({ where: { id: mensagemA.id } })).conversaId, carteira.neutra.id);
    ok('SQL do grupo respeita carteira parcial, oculta neutro e outra empresa e mantém origem histórica');

    const referencia = await novoCaso('guia-citada');
    await referencia.selecionar(referencia.empresas[0]);
    await semearRevisao(referencia, referencia.empresas[0], 'STUV');
    const antesDaGuia = await checkpoint(referencia.atendimento.id);
    const documentoB = await prisma.mensagemWhatsapp.create({ data: { conversaId: referencia.daEmpresa(referencia.empresas[1].id).id, direcao: 'out', tipo: 'document',
      corpo: 'Guia sintética identificada da empresa Beta', providerMessageId: `wamid.fixture.guia.${randomUUID()}` } });
    assert.deepEqual(await checkpoint(referencia.atendimento.id), antesDaGuia, 'Saída agendada não altera o contexto corrente');
    const respostaDeColeta = await referencia.resolver(await referencia.entrada(referencia.empresas[1].cnpj, { respostaAProviderMessageId: documentoB.providerMessageId }));
    assert.equal(respostaDeColeta.recibo.portalClientId, referencia.empresas[0].id, 'CNPJ do tomador não usa empresa da mensagem citada');
    const consultaCitada = await referencia.resolver(await referencia.entrada('manda essa guia', { respostaAProviderMessageId: documentoB.providerMessageId }));
    assert.equal(consultaCitada.recibo.portalClientId, referencia.empresas[1].id);
    assert.equal((await draft(referencia.daEmpresa(referencia.empresas[0].id).id)).estado.status, 'PAUSADO');
    const origemErrada = await carteira.entrada('manda essa guia', { respostaAProviderMessageId: documentoB.providerMessageId });
    const consultaDeOutroResponsavel = await carteira.resolver(origemErrada);
    assert.notEqual(consultaDeOutroResponsavel.recibo.portalClientId, referencia.empresas[1].id, 'Wamid de outro responsável nunca autoriza empresa');
    ok('guia citada exige mesmo responsável e acesso; CNPJ da coleta e envio agendado não trocam emissora');

    const reservada = await novoCaso('reserva-troca');
    const acaoReservada = await reservada.ateRevisao(reservada.empresas[0]);
    const entradaConfirmacao = await reservada.entrada(`CONFIRMAR ${acaoReservada.codigo}`);
    const resolvidaConfirmacao = await reservada.resolver(entradaConfirmacao);
    let avisarExecutor;
    let liberarExecutor;
    const entrouNoExecutor = new Promise(resolve => { avisarExecutor = resolve; });
    const executorLiberado = new Promise(resolve => { liberarExecutor = resolve; });
    const execucao = confirmarEExecutar({ acaoId: acaoReservada.id, conversaId: acaoReservada.conversaId, portalClientId: acaoReservada.portalClientId, userId: usuario.id,
      contexto: resolvidaConfirmacao.recibo, confirmacao: { mensagemId: entradaConfirmacao.registro.mensagem.id, registradaEm: entradaConfirmacao.registro.mensagem.registradaEm, mensagensConhecidas: [entradaConfirmacao.registro.mensagem.id] },
      client: prisma, deps: reservada.depsAcoes, log,
      executores: { EMITIR_NFSE: async args => { avisarExecutor(); await comPrazo(executorLiberado, 'resultado do executor reservado'); return reservada.executarEmissao(args); } },
    }).then(value => ({ value }), error => ({ error }));
    try {
      await comPrazo(entrouNoExecutor, 'reserva fiscal antes da troca');
      assert.equal((await prisma.acaoPendenteWhatsapp.findUniqueOrThrow({ where: { id: acaoReservada.id } })).status, 'confirmada');
      await selecionarEmpresaDoEscritorio({ conversa: resolvidaConfirmacao.registro.conversa, portalClientId: reservada.empresas[1].id, client: prisma });
    } finally { liberarExecutor(); }
    const resultadoReservado = await execucao;
    assert.ifError(resultadoReservado.error);
    assert.equal(resultadoReservado.value.executou, true);
    const finalReservada = await prisma.acaoPendenteWhatsapp.findUniqueOrThrow({ where: { id: acaoReservada.id } });
    assert.equal(finalReservada.status, 'executada');
    assert.equal(finalReservada.portalClientId, reservada.empresas[0].id);
    assert.equal(finalReservada.resultado.emissor, reservada.empresas[0].id);
    assert.equal((await checkpoint(reservada.atendimento.id)).portalClientId, reservada.empresas[1].id);
    assert.equal(reservada.execucoes.length, 1);
    ok('troca após início do executor não transfere nem apaga o resultado da empresa original');

    console.log(`PASS: ${checks} verificações multiempresa em PostgreSQL real; nenhum modelo, envio ou ato fiscal externo.`);
  } finally {
    try { await limparFixtures(); } finally { await prisma.$disconnect(); }
  }
}
