// Padrão offline. Modo live exige opt-in, teto explícito e chave em variável de ambiente.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CORPUS_LEADS } from './fixtures/corpus-leads-openai.mjs';
import { LeadsOpenAIClient, RESERVA_LEADS_CENTAVOS, prepararPedidoLead } from '../src/application/assistente/LeadsOpenAIClient.js';
import { prepararPreatendimento } from '../src/application/onboarding/preatendimentoComercial.js';
import { OrcamentoEnsaio } from './lib/orcamentoEnsaio.mjs';
import { MODELO_LEADS, ESFORCO_LEADS, PROMPT_LEADS, SCHEMA_LEADS } from '../src/application/assistente/interpretacaoLeadIa.js';
import { carregarAmbienteOpenAI } from './lib/ambienteOpenAI.mjs';

const args = carregarAmbienteOpenAI(process.argv.slice(2)), live = args.includes('--live');
const valor = nome => args.find(a => a.startsWith(`${nome}=`))?.slice(nome.length + 1);
for (const a of args) assert(a === '--live' || a === '--dry-run' || /^--(?:max-usd|max-requests|grupo|repeat-critical|orcamento|conjunto)=/.test(a), 'Argumento desconhecido. Não informe a chave pela linha de comando.');
assert(!(live && args.includes('--dry-run')), 'Escolha live ou dry-run.');
const teto = Number(valor('--max-usd')) * 100, maxRequests = Number(valor('--max-requests') || 400);
if (live) {
  assert(Number.isFinite(teto) && teto > 0 && teto <= 500, 'Informe --max-usd entre 0 e 5.');
  assert(Number.isInteger(maxRequests) && maxRequests > 0 && maxRequests <= 500, 'Máximo de 500 chamadas.');
  assert(process.env.OPENAI_API_KEY?.trim(), 'Configure OPENAI_API_KEY no ambiente, nunca em argumento ou corpus.');
  assert(valor('--orcamento'), 'Informe --orcamento: arquivo compartilhado por todas as rodadas autorizadas.');
}
assert.equal(CORPUS_LEADS.length, 100); assert.equal(new Set(CORPUS_LEADS.map(c => c.id)).size, 100);
assert.equal(CORPUS_LEADS.filter(c => c.reservado).length, 20);
const repeticoes = Number(valor('--repeat-critical') || 1);
assert(Number.isInteger(repeticoes) && repeticoes >= 1 && repeticoes <= 5, 'Repetições críticas entre 1 e 5.');
const conjunto = valor('--conjunto') || 'todos';
assert(['todos', 'desenvolvimento', 'reservado'].includes(conjunto), 'Conjunto inválido.');
const selecionados = CORPUS_LEADS.filter(c => (!valor('--grupo') || c.grupo === valor('--grupo'))
  && (conjunto === 'todos' || c.reservado === (conjunto === 'reservado')));
// Intercalar categorias preserva cobertura caso o orçamento se encerre.
const filas = [...new Set(selecionados.map(c => c.grupo))].map(g => selecionados.filter(c => c.grupo === g));
const unicos = [];
while (filas.some(f => f.length)) for (const f of filas) if (f.length) unicos.push(f.shift());
const casos = unicos.flatMap(c => Array.from({ length: c.critico ? repeticoes : 1 }, (_, repeticao) => ({ ...c, repeticao: repeticao + 1 })));
assert(casos.length > 0, 'Grupo inexistente.');
for (const c of casos) for (const texto of c.turnos) prepararPedidoLead({ texto });
if (!live) {
  console.log(JSON.stringify({ modo: 'offline', cenariosUnicos: unicos.length, execucoes: casos.length, mensagens: casos.reduce((s, c) => s + c.turnos.length, 0), reservadosUnicos: unicos.filter(c => c.reservado).length, chamadasExternas: 0, custo: 0, validacao: 'Estrutura e limites do corpus. Não mede a qualidade do modelo.' }));
} else {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const dir = path.join(root, 'test-evidence', `eval-leads-${Date.now()}`); fs.mkdirSync(dir, { recursive: true });
  const orcamento = new OrcamentoEnsaio(valor('--orcamento'), teto / 100);
  const gastoInicial = orcamento.gasto;
  const client = new LeadsOpenAIClient({ chave: process.env.OPENAI_API_KEY.trim() });
  const resultados = []; let chamadas = 0, esgotado = false;
  const resumo = () => ({ modelo: MODELO_LEADS, esforco: ESFORCO_LEADS, conjunto, promptSchemaHash: crypto.createHash('sha256').update(PROMPT_LEADS + JSON.stringify(SCHEMA_LEADS) + ESFORCO_LEADS).digest('hex'), executadoEm: new Date().toISOString(), cenariosPlanejados: casos.length, cenariosExecutados: resultados.length, chamadas,
    custoRodadaUsd: (orcamento.gasto - gastoInicial) / 1_000_000, custoAcumuladoComReservasUsd: orcamento.gasto / 1_000_000,
    tetoCompartilhadoUsd: teto / 100, moeda: 'USD', esgotado,
    aprovadosAutomaticamente: resultados.filter(r => r.passou).length, revisaoHumana: 'PENDENTE', resultados });
  const salvar = () => fs.writeFileSync(path.join(dir, 'resultados.json'), JSON.stringify(resumo(), null, 2), { flush: true });
  console.log(JSON.stringify({ inicio: true, evidencia: dir, conjunto, cenarios: casos.length }));
  try {
  for (const c of casos) {
    let anterior = {}, ultimo, erro = null; const turnos = [];
    for (const [i, texto] of c.turnos.entries()) {
      if (chamadas >= maxRequests) { esgotado = true; erro = 'LIMITE_DO_ENSAIO'; break; }
      const reserva = orcamento.reservar(RESERVA_LEADS_CENTAVOS * 10000, `${path.basename(dir)}/${c.id}/${c.repeticao}/${i}`);
      if (reserva === null) { esgotado = true; erro = 'LIMITE_DO_ENSAIO'; break; }
      chamadas++;
      let r;
      try {
        r = await client.interpretar({ texto, intencao: anterior.intencao, campoEsperado: anterior.campoEsperado, resumo: anterior });
      } catch (e) {
        if (e.usage) orcamento.concluir(reserva, e.usage, MODELO_LEADS);
        erro = e.codigo || 'ERRO_ENSAIO';
        turnos.push({ entrada: texto, erro, usage: e.usage || null });
        break;
      }
      orcamento.concluir(reserva, r.usage, MODELO_LEADS);
      try {
        ultimo = r.interpretacao;
        const preparo = prepararPreatendimento({ texto, intencao: anterior.intencao || ultimo.intencao || 'ABERTURA', anterior, mensagemId: `${c.id}-${i}`, interpretacaoIa: ultimo });
        anterior = preparo.pre;
        turnos.push({ entrada: texto, interpretacao: ultimo, usage: r.usage, resumo: anterior, encaminhar: preparo.encaminhar, pergunta: preparo.pergunta, aguardar: preparo.leitura.aguardar, retomada: preparo.leitura.retomada });
        if (preparo.encaminhar && i < c.turnos.length - 1) { erro = 'ENCAMINHAMENTO_PREMATURO'; break; }
      } catch (e) { erro = e.codigo || 'ERRO_ENSAIO'; break; }
    }
    const esperado = c.esperado;
    const falhasAdicionais = [];
    for (const t of turnos.filter(t => t.resumo)) {
      for (const campo of ['nome', 'atividade', 'cidade', 'necessidade', 'origemDeclarada', 'urgencia', 'preferenciaContato']) {
        if (t.resumo[campo] && !t.resumo.evidenciasIa?.[campo] && !t.resumo.evidenciasDeclaradas?.[campo]) falhasAdicionais.push(`SEM_EVIDENCIA_${campo}`);
      }
      if (t.resumo.perguntasFeitas > 3) falhasAdicionais.push('PERGUNTAS_EXCEDIDAS');
      if (t.interpretacao.comportamento === 'HUMANO' && !t.encaminhar) falhasAdicionais.push('HUMANO_NAO_ENCAMINHADO');
      if (t.interpretacao.comportamento === 'PAUSAR' && !t.aguardar) falhasAdicionais.push('PAUSA_NAO_RESPEITADA');
      if (t.interpretacao.comportamento === 'RETOMAR' && !t.retomada) falhasAdicionais.push('RETOMADA_NAO_RESPEITADA');
    }
    const passou = !erro && !falhasAdicionais.length && (esperado.comportamento ? ultimo?.comportamento === esperado.comportamento
      : String(anterior[esperado.campo] || '').toLocaleLowerCase('pt-BR').includes(esperado.trecho.toLocaleLowerCase('pt-BR')));
    resultados.push({ id: c.id, repeticao: c.repeticao, grupo: c.grupo, reservado: c.reservado, critico: c.critico, esperado, passou, erro, falhasAdicionais, turnos });
    salvar();
    console.log(JSON.stringify({ progresso: resultados.length, planejados: casos.length, id: c.id, passou, erro, custoAcumuladoUsd: orcamento.gasto / 1_000_000 }));
    if (esgotado) break;
  }
  salvar();
  console.log(JSON.stringify({ ...resumo(), resultados: undefined, evidencia: dir }));
  if (esgotado || resultados.some(r => !r.passou)) process.exitCode = 1;
  } finally { orcamento.fechar(); }
}
