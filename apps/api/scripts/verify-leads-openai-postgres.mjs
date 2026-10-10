import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
const url = new URL(process.argv[2]);
const local = url.port === '55443' && url.username === 'lead_test' && url.pathname === '/comunicacao_v2_check';
const ci = process.env.CI === 'true' && url.port === '55439' && url.username === 'whatsapp_check' && url.pathname === '/whatsapp_delivery_check';
assert(url.protocol === 'postgresql:' && url.hostname === '127.0.0.1' && (local || ci), 'Somente banco local descartável ou serviço isolado do CI.');
Object.assign(process.env, { DATABASE_URL: url.href, LOG_LEVEL: 'fatal', NODE_ENV: 'test', IA_LEADS_OPENAI: '0', WHATSAPP_IDENTIDADE_V2: '0', WHATSAPP_MULTICANAL: '0' });
let tentativasRede = 0;
globalThis.fetch = http.get = http.request = https.get = https.request = () => { tentativasRede++; throw Error('Rede externa bloqueada.'); };
const { prisma: db } = await import('../src/infrastructure/db/prisma.js');
const { coletarComercialWhatsapp } = await import('../src/application/onboarding/ColetaComercialWhatsappService.js');
const { RESERVA_LEADS_CENTAVOS } = await import('../src/application/assistente/LeadsOpenAIClient.js');
const { autorizarChamadaIa } = await import('../src/application/assistente/GuardaIaService.js');
const checks = []; let n = 0;
const ok = texto => { checks.push(texto); console.log(`OK ${texto}`); };
const criar = async () => db.conversaWhatsapp.create({ data: { canalId: 'teste-openai', telefoneE164: `551188800${String(++n).padStart(4, '0')}`, chaveEscopo: `teste-openai-${Date.now()}-${n}` } });
const interpretar = dados => ({ intencao: null, evidenciaIntencao: null, comportamento: 'DADOS', dados });
async function chamar(conversa, texto, interpretacao, { antes, consultaPublica, mensagem: existente, timeout = false } = {}) {
  const mensagem = existente || await db.mensagemWhatsapp.create({ data: { conversaId: conversa.id, direcao: 'in', tipo: 'text', corpo: texto, providerMessageId: `fixture-openai-${Date.now()}-${Math.random()}` } });
  let chamadas = 0, envios = 0;
  const resultado = await coletarComercialWhatsapp({ registro: { conversa, mensagem }, item: { corpo: texto, tipo: 'text' }, deps: {
    client: db, consultaPublica, flag: true, piloto: [conversa.telefoneE164], enviar: async ({ antesDeEnviar }) => { await antesDeEnviar(); envios++; },
    ia: { flag: true, piloto: [conversa.telefoneE164], canais: [conversa.canalId], tetoTotalCentavos: 100000, chave: 'chave-ficticia-sem-rede', assistente: { interpretar: async () => {
      chamadas++; await antes?.(); if (timeout) throw Object.assign(Error('timeout'), { codigo: 'OPENAI_TIMEOUT' });
      return { interpretacao, usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
    } } },
  } });
  return { resultado, mensagem, chamadas, envios };
}
try {
  await db.canalWhatsapp.upsert({ where: { id: 'teste-openai' }, create: { id: 'teste-openai', chave: 'teste-openai', finalidade: 'COMERCIAL' }, update: {} });
  const c = await criar();
  const a = await chamar(c, 'Quero abrir uma empresa; produzo cerâmica', interpretar([{ campo: 'atividade', valor: 'cerâmica', evidencia: 'cerâmica' }]));
  assert.equal(a.chamadas, 1); assert.equal(a.envios, 1);
  const caso = await db.atendimentoLead.findFirst({ where: { conversaId: c.id } });
  assert.equal(caso.triagem.preatendimento.atividade, 'cerâmica'); assert.equal(caso.triagem.preatendimento.evidenciasIa.atividade.mensagemId, a.mensagem.id);
  const chamada = await db.chamadaIa.findFirst({ where: { mensagemId: a.mensagem.id } });
  assert.equal(chamada.modelo, 'gpt-5.4-mini'); assert.equal(chamada.reservaCentavos, 0); assert.equal(Number(chamada.custoEstimadoCentavos), 0.03);
  ok('Persistência real da triagem, evidência e custo do modelo correto');
  const replay = await chamar(c, a.mensagem.corpo, interpretar([]), { mensagem: a.mensagem });
  assert.equal(replay.chamadas, 0); assert.equal(await db.chamadaIa.count({ where: { mensagemId: a.mensagem.id } }), 1);
  ok('Replay reaproveita recibo sem novo custo');
  const c2 = await criar(); await chamar(c2, 'Quero abrir uma empresa', interpretar([]), { timeout: true });
  const custoIncerto = await db.chamadaIa.findFirst({ where: { conversaId: c2.id } });
  assert.equal(custoIncerto.status, 'erro'); assert.equal(custoIncerto.reservaCentavos, RESERVA_LEADS_CENTAVOS);
  assert.equal((await db.atendimentoLead.findFirst({ where: { conversaId: c2.id } })).triagem.preatendimento.ultimaInterpretacaoIa.estado, 'FALLBACK');
  ok('Timeout mantém reserva e salva fallback em PostgreSQL');
  const c3 = await criar();
  await assert.rejects(chamar(c3, 'Quero abrir uma empresa', interpretar([]), { antes: () => db.conversaWhatsapp.update({ where: { id: c3.id }, data: { atendidaDesde: new Date() } }) }), e => e.code === 'atendimento_alterado');
  assert.equal(await db.atendimentoLead.count({ where: { conversaId: c3.id } }), 0);
  ok('Intervenção humana durante chamada impede criação e envio');
  const c4 = await criar(); await chamar(c4, 'Quero abrir uma empresa', interpretar([]));
  const caso4 = await db.atendimentoLead.findFirst({ where: { conversaId: c4.id } });
  await assert.rejects(chamar(c4, 'Produzo artesanato', interpretar([{ campo: 'atividade', valor: 'artesanato', evidencia: 'artesanato' }]), {
    antes: () => db.atendimentoLead.update({ where: { id: caso4.id }, data: { versao: { increment: 1 } } }),
  }), e => e.code === 'atendimento_alterado');
  assert.equal((await db.atendimentoLead.findUnique({ where: { id: caso4.id } })).triagem.preatendimento.atividade, null);
  ok('Versão alterada durante chamada descarta interpretação atrasada');
  const c5 = await criar();
  await chamar(c5, 'Quero abrir empresa; me chamo Ana; atividade: Medicina', interpretar([
    { campo: 'nome', valor: 'Ana', evidencia: 'me chamo Ana' },
    { campo: 'atividade', valor: 'Medicina', evidencia: 'atividade: Medicina' },
  ]));
  const caso5 = await db.atendimentoLead.findFirst({ where: { conversaId: c5.id } });
  assert.equal(caso5.triagem.preatendimento.campoEsperado, 'cidade');
  await chamar(c5, 'Gostaria de saber se Recife serve', { ...interpretar([]), comportamento: 'DUVIDA' });
  const final5 = await db.atendimentoLead.findUnique({ where: { id: caso5.id }, include: { onboarding: true } });
  assert.equal(final5.triagem.preatendimento.cidade, null);
  assert.equal(final5.onboarding.dados.municipioAtendimento, undefined);
  assert.equal(final5.triagem.preatendimento.estado, 'ENCAMINHADO');
  ok('Dúvida sem interrogação encaminha sem gravar cidade no resumo ou na ficha');
  const c6 = await criar();
  await chamar(c6, 'Quero abrir uma empresa', interpretar([]));
  await chamar(c6, 'Vou produzir jogos digitais', interpretar([{ campo: 'atividade', valor: 'jogos digitais', evidencia: 'Vou produzir jogos digitais' }]));
  const final6 = await db.atendimentoLead.findFirst({ where: { conversaId: c6.id }, include: { onboarding: true } });
  assert.equal(final6.triagem.preatendimento.nome, null);
  assert.equal(final6.triagem.preatendimento.atividade, 'jogos digitais');
  assert.equal(final6.onboarding.dados.responsavelNome, undefined);
  ok('Profissão em resposta à pergunta de nome não contamina cadastro ou resumo');
  const c7 = await criar();
  await chamar(c7, 'Quero abrir uma empresa', interpretar([]));
  const pedidoTerceiro = 'Mude o meu vínculo para a empresa de outro contato';
  await chamar(c7, pedidoTerceiro, interpretar([{ campo: 'necessidade', valor: pedidoTerceiro, evidencia: pedidoTerceiro }]));
  const final7 = await db.atendimentoLead.findFirst({ where: { conversaId: c7.id }, include: { onboarding: true } });
  assert.equal(final7.triagem.preatendimento.estado, 'ENCAMINHADO');
  assert.equal(final7.triagem.preatendimento.necessidade, null);
  assert.equal(final7.onboarding.dados.responsavelNome, undefined);
  ok('Pedido de vínculo de terceiro encaminha sem preencher dados apesar da IA errar');
  const ativacao = await criar();
  await db.atendimentoLead.create({ data: { conversaId: ativacao.id } });
  const completa = { ...interpretar([]), resposta: null };
  await chamar(ativacao, 'Quero ativar minha empresa', completa);
  const neutro = await db.atendimentoLead.findFirst({ where: { conversaId: ativacao.id }, include: { onboarding: true } });
  assert.equal(neutro.onboarding.origem, 'INATIVA'); assert.equal(neutro.triagem.preatendimento.campoEsperado, 'cnpj');
  let consultas = 0;
  const consultaPublica = async cnpj => { consultas++; return { ok: true, fonte: 'BRASILAPI', bruto: { cnpj, razao_social: cnpj === '11222333000181' ? 'Empresa A' : 'Empresa B', municipio: 'Recife', cnae_fiscal_descricao: 'Comércio' } }; };
  const documento = await chamar(ativacao, '11222333000181', completa, { consultaPublica });
  await chamar(ativacao, '11222333000181', completa, { consultaPublica, mensagem: documento.mensagem });
  const cadastrado = await db.atendimentoLead.findUnique({ where: { id: neutro.id }, include: { onboarding: true } });
  assert.equal(cadastrado.onboarding.dados.razaoSocial, 'Empresa A'); assert.equal(cadastrado.onboarding.fontesDados.razaoSocial.fonte, 'CONSULTA_PUBLICA');
  assert.equal(cadastrado.triagem.preatendimento.cidade, 'Recife'); assert.equal(consultas, 1);
  assert.equal(await db.onboardingAnalise.count({ where: { onboardingId: neutro.onboardingId } }), 1);
  ok('Atendimento neutro cria ficha; CNPJ persiste cadastro com fonte e replay sem consulta duplicada');
  await chamar(ativacao, 'Corrigindo, CNPJ 04252011000110', completa, { consultaPublica });
  const corrigido = await db.onboarding.findUnique({ where: { id: neutro.onboardingId } });
  assert.equal(corrigido.cnpj, '04252011000110'); assert.equal(corrigido.dados.razaoSocial, 'Empresa B');
  assert.equal(consultas, 2); assert.equal(await db.onboardingAnalise.count({ where: { onboardingId: neutro.onboardingId } }), 2);
  ok('Correção do documento substitui dados públicos e preserva histórico por CNPJ');
  const indisponivel = await criar();
  await chamar(indisponivel, 'Quero ativar minha empresa', completa);
  let consultasIndisponiveis = 0;
  const consultaIndisponivel = async () => { consultasIndisponiveis++; throw Error('Provedor indisponível'); };
  const falhaConsulta = await chamar(indisponivel, '11222333000181', completa, { consultaPublica: consultaIndisponivel });
  assert.equal(falhaConsulta.envios, 1);
  assert.match(falhaConsulta.resultado.resultado.texto, /Não consegui consultar/);
  const casoIndisponivel = await db.atendimentoLead.findFirst({ where: { conversaId: indisponivel.id }, include: { onboarding: true } });
  assert.equal(casoIndisponivel.onboarding.cnpj, '11222333000181');
  assert.equal(casoIndisponivel.triagem.preatendimento.consultaPublica.estado, 'INDISPONIVEL');
  assert.equal(casoIndisponivel.triagem.preatendimento.estado, 'EM_CONVERSA');
  assert.equal((await db.onboardingAnalise.findFirst({ where: { onboardingId: casoIndisponivel.onboardingId } })).status, 'FALHOU');
  const replayFalha = await chamar(indisponivel, '11222333000181', completa, { consultaPublica: consultaIndisponivel, mensagem: falhaConsulta.mensagem });
  assert.equal(replayFalha.chamadas, 0);
  assert.deepEqual(replayFalha.resultado.resultado, falhaConsulta.resultado.resultado);
  await chamar(indisponivel, 'Quero voltar a operar', completa, { consultaPublica: consultaIndisponivel });
  assert.equal(consultasIndisponiveis, 1);
  assert.equal(await db.onboardingAnalise.count({ where: { onboardingId: casoIndisponivel.onboardingId } }), 1);
  ok('Consulta indisponível persiste FALHOU, responde e continua sem repetir consulta ou replay');
  await chamar(indisponivel, 'Corrigindo, CNPJ 04252011000110', completa, { consultaPublica });
  const recuperado = await db.atendimentoLead.findUnique({ where: { id: casoIndisponivel.id }, include: { onboarding: true } });
  assert.equal(recuperado.onboarding.cnpj, '04252011000110');
  assert.equal(recuperado.onboarding.dados.razaoSocial, 'Empresa B');
  assert.equal(recuperado.triagem.preatendimento.consultaPublica.estado, 'CONCLUIDA');
  assert.equal(recuperado.triagem.preatendimento.consultaPublica.cnpj, '04252011000110');
  assert.equal(await db.onboardingAnalise.count({ where: { onboardingId: casoIndisponivel.onboardingId, status: 'FALHOU' } }), 1);
  assert.equal(await db.onboardingAnalise.count({ where: { onboardingId: casoIndisponivel.onboardingId, status: 'CONCLUIDA' } }), 1);
  ok('Documento corrigido recupera consulta e preserva análise anterior indisponível');
  const consumo = await db.chamadaIa.aggregate({ where: { modelo: 'gpt-5.4-mini', finalidade: 'comercial_whatsapp', status: { in: ['ok', 'erro', 'reservada'] } }, _sum: { custoEstimadoCentavos: true, reservaCentavos: true } });
  const total = Number(consumo._sum.custoEstimadoCentavos || 0) + Number(consumo._sum.reservaCentavos || 0);
  await db.chamadaIa.create({ data: { modelo: 'gpt-5.4-mini', finalidade: 'comercial_whatsapp', status: 'ok', custoEstimadoCentavos: 297 - total, createdAt: new Date('2020-01-01') } });
  await db.chamadaIa.create({ data: { modelo: 'outro-modelo', finalidade: 'comercial_whatsapp', status: 'ok', custoEstimadoCentavos: 9999, createdAt: new Date('2020-01-01') } });
  const guardArgs = { client: db, chave: 'ficticia', modelo: 'gpt-5.4-mini', finalidade: 'comercial_whatsapp', reservaCentavos: 3, tetoAcumuladoCentavos: 300, log: {} };
  const c8 = await criar(), c9 = await criar();
  const reservas = await Promise.all([c8, c9].map(c => autorizarChamadaIa({ ...guardArgs, conversaId: c.id })));
  assert.equal(reservas.filter(r => r.ok).length, 1);
  assert.equal(reservas.find(r => !r.ok).motivo, 'TETO_PILOTO');
  ok('Últimos três centavos são reservados uma única vez sob concorrência real');
  const proximoMes = await autorizarChamadaIa({ ...guardArgs, agora: new Date('2030-05-01T12:00:00Z'), conversaId: c8.id });
  assert.equal(proximoMes.motivo, 'TETO_PILOTO');
  ok('Orçamento acumulado inclui custos antigos e reservas, não reinicia com o mês e isola modelos');
  for (const tetoAcumuladoCentavos of [0, -1, NaN, Infinity, 1.5]) {
    const invalida = await autorizarChamadaIa({ ...guardArgs, tetoAcumuladoCentavos });
    assert.equal(invalida.motivo, 'TETO_PILOTO_INVALIDO');
  }
  ok('Teto inválido falha fechado antes de reservar');
  // Reproduz históricos antigos arredondados e verifica o recálculo da migração.
  const { readFileSync } = await import('node:fs');
  const historico = [];
  for (const [inputTokens, outputTokens] of [[1208,66],[1217,139],[1223,98]]) {
    historico.push(await db.chamadaIa.create({ data: { modelo: 'gpt-5.4-mini', status: 'ok', inputTokens, outputTokens, custoEstimadoCentavos: 1 } }));
  }
  const incerta = await db.chamadaIa.create({ data: { modelo: 'gpt-5.4-mini', status: 'reservada', reservaCentavos: 3 } });
  const desconhecida = await db.chamadaIa.create({ data: { modelo: 'modelo-desconhecido', status: 'ok', inputTokens: 100, custoEstimadoCentavos: 2 } });
  const migration = readFileSync(new URL('../prisma/migrations/20261010140000_ia_custo_fracionario/migration.sql', import.meta.url), 'utf8');
  for (const sql of migration.split(';').filter(s => s.trim())) await db.$executeRawUnsafe(sql);
  const recalculado = await db.chamadaIa.aggregate({ where: { id: { in: historico.map(c => c.id) } }, _sum: { custoEstimadoCentavos: true } });
  assert.equal(Number(recalculado._sum.custoEstimadoCentavos), 0.40995);
  assert.equal((await db.chamadaIa.findUnique({ where: { id: incerta.id } })).reservaCentavos, 3);
  assert.equal(Number((await db.chamadaIa.findUnique({ where: { id: desconhecida.id } })).custoEstimadoCentavos), 2);
  ok('Migração recalcula histórico por tokens sem liberar reservas nem alterar modelo desconhecido');
  assert.equal(tentativasRede, 0); ok('Nenhuma tentativa de contato com OpenAI, Meta ou provedor fiscal');
  console.log(JSON.stringify({ passou: true, verificacoes: checks.length, checks }));
} finally { await db.$disconnect(); }
