import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { DIALOGOS_LEADS } from './fixtures/dialogos-leads-openai.mjs';
import { carregarAmbienteOpenAI } from './lib/ambienteOpenAI.mjs';
import { OrcamentoEnsaio } from './lib/orcamentoEnsaio.mjs';
import { LeadsOpenAIClient, RESERVA_LEADS_CENTAVOS } from '../src/application/assistente/LeadsOpenAIClient.js';
import { MODELO_LEADS, ESFORCO_LEADS, PROMPT_LEADS, SCHEMA_LEADS } from '../src/application/assistente/interpretacaoLeadIa.js';
const args = carregarAmbienteOpenAI(process.argv.slice(2));
const val = k => args.find(a => a.startsWith(`${k}=`))?.slice(k.length + 1);
assert(args.every(a => /^--(?:db|saida|conjunto|repeticoes|orcamento|max-usd|grupo)=/.test(a)), 'Argumento inválido.');
const url = new URL(val('--db'));
assert(url.hostname === '127.0.0.1' && url.port === '55444' && url.username === 'lead_test' && url.pathname === '/dialogos_ia_check', 'Somente banco descartável.');
assert(process.env.OPENAI_API_KEY?.trim(), 'Chave ausente.');
const conjunto = val('--conjunto') || 'desenvolvimento', repeticoes = Number(val('--repeticoes') || 1);
assert(['todos', 'desenvolvimento', 'reservado'].includes(conjunto));
assert(Number.isInteger(repeticoes) && repeticoes >= 1 && repeticoes <= 5);
const casos = DIALOGOS_LEADS.filter(c => (conjunto === 'todos' || c.reservado === (conjunto === 'reservado')) && (!val('--grupo') || c.grupo === val('--grupo')));
assert(casos.length > 0);
Object.assign(process.env, { DATABASE_URL: url.href, LOG_LEVEL: 'fatal', NODE_ENV: 'test', IA_LEADS_OPENAI: '0', INTEGRACAO_IA_COMERCIAL: '0', INTEGRACAO_WHATSAPP: '0', WHATSAPP_IDENTIDADE_V2: '0', WHATSAPP_MULTICANAL: '0' });
const fetchReal = globalThis.fetch;
let rawModelo = null, redesBloqueadas = 0;
globalThis.fetch = http.get = http.request = https.get = https.request = () => { redesBloqueadas++; throw Error('Rede não autorizada.'); };
const client = new LeadsOpenAIClient({ chave: process.env.OPENAI_API_KEY.trim(), fetchImpl: async (endpoint, options) => {
  assert.equal(endpoint, 'https://api.openai.com/v1/responses');
  const response = await fetchReal(endpoint, options);
  if (response.ok) {
    const data = await response.clone().json();
    // Somente a saída do modelo sobre personagens fictícios; nunca headers/chave.
    rawModelo = data.output?.filter(o => o.type === 'message').flatMap(o => o.content || []).filter(o => o.type === 'output_text').map(o => o.text);
  }
  return response;
} });
const { prisma: db } = await import('../src/infrastructure/db/prisma.js');
const { coletarComercialWhatsapp } = await import('../src/application/onboarding/ColetaComercialWhatsappService.js');
const budget = new OrcamentoEnsaio(val('--orcamento'), Number(val('--max-usd')));
const dir = path.resolve(val('--saida')); fs.mkdirSync(dir, { recursive: true });
const gastoInicial = budget.gasto, resultados = []; let chamadas = 0, parou = false, contador = 0;
const hash = crypto.createHash('sha256').update(PROMPT_LEADS + JSON.stringify(SCHEMA_LEADS) + ESFORCO_LEADS).digest('hex');
const arquivosHash = Object.fromEntries([
  '../src/application/onboarding/ColetaComercialWhatsappService.js',
  '../src/application/onboarding/preatendimentoComercial.js',
  '../src/application/onboarding/interpretacaoComercialWhatsapp.js',
  '../src/application/assistente/interpretacaoLeadIa.js',
  '../src/application/assistente/LeadsOpenAIClient.js',
  './fixtures/dialogos-leads-openai.mjs',
  './lib/orcamentoEnsaio.mjs',
].map(p => [p, crypto.createHash('sha256').update(fs.readFileSync(new URL(p, import.meta.url))).digest('hex')]));
const salvar = () => fs.writeFileSync(path.join(dir, 'dialogos.json'), JSON.stringify({ modelo: MODELO_LEADS, esforco: ESFORCO_LEADS, promptSchemaHash: hash, arquivosHash, conjunto, repeticoes, planejados: casos.length * repeticoes, chamadas,
  custoRodadaUsd: (budget.gasto - gastoInicial) / 1e6, custoAcumuladoUsd: budget.gasto / 1e6, tetoUsd: budget.estado.tetoMicrousd / 1e6, parou, redesBloqueadas,
  aprovados: resultados.filter(r => r.passou).length, resultados }, null, 2), { flush: true });
try {
  await db.canalWhatsapp.upsert({ where: { id: 'teste-openai' }, create: { id: 'teste-openai', chave: 'teste-openai', finalidade: 'COMERCIAL' }, update: {} });
  for (let repeticao = 1; repeticao <= repeticoes && !parou; repeticao++) for (const c of casos) {
    const conversa = await db.conversaWhatsapp.create({ data: { canalId: 'teste-openai', telefoneE164: `5511777${String(++contador).padStart(6, '0')}`, chaveEscopo: `dialogos-${Date.now()}-${contador}` } });
    const inicioCusto = budget.gasto, inicioChamadas = chamadas, turnos = [], falhas = [];
    let conclusao = false;
    for (const [i, esperado] of c.turnos.entries()) {
      if (conclusao) { falhas.push(`ENCAMINHAMENTO_ANTES_DO_TURNO_${i + 1}`); break; }
      const modelo = [], envios = []; rawModelo = null;
      const assistente = { interpretar: async entrada => {
        const inicio = Date.now(); let reserva, resposta, etapa = 'RESERVA_LOCAL';
        try {
          reserva = chamadas < 500 ? budget.reservar(RESERVA_LEADS_CENTAVOS * 10000, `${path.basename(dir)}/${c.id}/${repeticao}/${i}`) : null;
          if (reserva === null) { parou = true; throw Object.assign(Error('teto'), { codigo: 'LIMITE_DO_ENSAIO' }); }
          chamadas++; etapa = 'OPENAI';
          resposta = await client.interpretar(entrada);
          etapa = 'CONCLUSAO_LOCAL';
          budget.concluir(reserva, resposta.usage, MODELO_LEADS);
        }
        catch (e) {
          if (etapa === 'OPENAI' && e.usage) budget.concluir(reserva, e.usage, MODELO_LEADS);
          modelo.push({ entrada, erro: e.codigo || 'ERRO_LABORATORIO', etapa, usage: resposta?.usage || e.usage || null, rawModelo, ms: Date.now() - inicio }); throw e;
        }
        modelo.push({ entrada, ...resposta, rawModelo, ms: Date.now() - inicio }); return resposta;
      } };
      const mensagem = await db.mensagemWhatsapp.create({ data: { conversaId: conversa.id, direcao: 'in', tipo: esperado.tipo || 'text', corpo: esperado.texto, providerMessageId: `ficcao-${contador}-${i}` } });
      const deps = { client: db, flag: true, piloto: [conversa.telefoneE164], agora: new Date('2026-09-28T14:00:00Z'),
        enviar: async ({ texto, antesDeEnviar }) => { await antesDeEnviar(); envios.push(texto); },
        ia: { flag: true, piloto: [conversa.telefoneE164], canais: [conversa.canalId], tetoTotalCentavos: 100000, chave: process.env.OPENAI_API_KEY, assistente } };
      let resposta;
      try { resposta = await coletarComercialWhatsapp({ registro: { conversa, mensagem }, item: { corpo: esperado.texto, tipo: esperado.tipo || 'text' }, deps }); }
      catch (e) { falhas.push(e.code || 'ERRO_FLUXO'); break; }
      const caso = await db.atendimentoLead.findFirst({ where: { conversaId: conversa.id }, include: { onboarding: true } });
      const pre = caso?.triagem?.preatendimento || {};
      conclusao = Boolean(resposta.resultado?.encaminhar);
      if (conclusao !== esperado.encaminhar) falhas.push(`T${i + 1}_ENCAMINHAR_${esperado.encaminhar}`);
      if (!resposta.tratado || envios.length !== 1) falhas.push(`T${i + 1}_SEM_RESPOSTA_${resposta.motivo}`);
      for (const [campo, valor] of Object.entries(esperado.campos)) {
        const atual = pre[campo];
        if (valor instanceof RegExp ? !valor.test(String(atual || '')) : valor === null ? Boolean(atual) : atual !== valor)
          falhas.push(`T${i + 1}_${campo}: esperado ${String(valor)}, recebido ${JSON.stringify(atual)}`);
      }
      if (esperado.pausa && !/quando quiser continuar/i.test(envios.join(' '))) falhas.push(`T${i + 1}_PAUSA`);
      if (pre.perguntasFeitas > 3) falhas.push('MAIS_DE_TRES_PERGUNTAS');
      if (pre.ultimaInterpretacaoIa?.estado === 'FALLBACK') falhas.push(`T${i + 1}_FALLBACK_${pre.ultimaInterpretacaoIa.motivo}`);
      if (esperado.novoPedido && !caso?.triagem?.proximaSolicitacao) falhas.push('NOVO_PEDIDO_PERDIDO');
      if (envios.some(s => /reunião (?:está )?confirmada|R\$\s*\d|contrato assinado|consulta fiscal concluída/i.test(s))) falhas.push('PROMESSA_INDEVIDA');
      if (esperado.replay) {
        const antesCalls = chamadas;
        await coletarComercialWhatsapp({ registro: { conversa, mensagem }, item: { corpo: esperado.texto }, deps: { ...deps, enviar: async () => {} } });
        if (chamadas !== antesCalls) falhas.push('REPLAY_COM_NOVO_CUSTO');
      }
      turnos.push({ entrada: esperado.texto, tipo: esperado.tipo || 'text', saida: envios, motivo: resposta.motivo, encaminhar: conclusao, resumo: pre, ficha: caso?.onboarding?.dados || null, modelo });
      if (parou) break;
    }
    resultados.push({ id: c.id, grupo: c.grupo, reservado: c.reservado, repeticao, passou: falhas.length === 0, concluido: conclusao, chamadas: chamadas - inicioChamadas,
      custoUsd: (budget.gasto - inicioCusto) / 1e6, falhas, turnos });
    salvar(); console.log(JSON.stringify({ id: c.id, repeticao, progresso: resultados.length, passou: !falhas.length, falhas, custoAcumuladoUsd: budget.gasto / 1e6 }));
    if (parou) break;
  }
  if (parou || resultados.some(r => !r.passou)) process.exitCode = 1;
} finally { salvar(); budget.fechar(); await db.$disconnect(); }
