import { MODELO_LEADS, ESFORCO_LEADS, PROMPT_LEADS, SCHEMA_LEADS, validarInterpretacaoLead } from './interpretacaoLeadIa.js';
import { custoEstimadoCentavos } from './precosIa.js';
import { ORDEM_QUALIFICACAO, ordemQualificacao } from '../onboarding/qualificacaoComercial.js';

export const MAX_BYTES_PEDIDO_LEADS = 24000;
export const MAX_TOKENS_SAIDA_LEADS = 1400;
// Um token nunca representa menos que um byte; inclui margem para framing.
export const RESERVA_LEADS_CENTAVOS = custoEstimadoCentavos({ input_tokens: MAX_BYTES_PEDIDO_LEADS + 2048, output_tokens: MAX_TOKENS_SAIDA_LEADS }, MODELO_LEADS);
const erro = (codigo, usage) => Object.assign(new Error(codigo), { codigo, usage });

async function codigoHttp(response) {
  if (response.status === 429) {
    // Apenas código conhecido; nunca expor mensagem/corpo do provedor.
    try { if ((await response.json())?.error?.code === 'insufficient_quota') return 'OPENAI_SALDO_INSUFICIENTE'; } catch { /* status ainda é suficiente */ }
    return 'OPENAI_LIMITE';
  }
  return ({ 400: 'OPENAI_PEDIDO_INVALIDO', 401: 'OPENAI_AUTENTICACAO', 403: 'OPENAI_PERMISSAO', 404: 'OPENAI_MODELO_INDISPONIVEL' })[response.status]
    || (response.status >= 500 ? 'OPENAI_SERVIDOR' : 'OPENAI_HTTP');
}

export function normalizarUsageOpenAI(usage) {
  if (!usage || ![usage.input_tokens, usage.output_tokens].every(n => Number.isSafeInteger(n) && n >= 0)) return null;
  const cache = usage.input_tokens_details?.cached_tokens ?? 0;
  if (!Number.isSafeInteger(cache) || cache < 0 || cache > usage.input_tokens) return null;
  return { input_tokens: usage.input_tokens - cache, output_tokens: usage.output_tokens, cache_read_input_tokens: cache, cache_creation_input_tokens: 0 };
}

export function prepararPedidoLead({ texto, intencao = null, campoEsperado = null, resumo = null }) {
  if (typeof texto !== 'string' || !texto.trim() || texto.length > 4000) throw erro('ENTRADA_LEAD_INVALIDA');
  const dadosColetados = resumo ? Object.fromEntries(['nome', 'atividade', 'cidade', 'necessidade', 'estrutura', 'faturamento', 'urgencia', 'preferenciaContato', 'cnpj', 'periodoPendencias', 'tipoPendencias', 'situacaoOperacional']
    .filter(k => typeof resumo[k] === 'string' && resumo[k].trim() && (k !== 'cnpj' || /^\d{14}$/.test(resumo[k]))).map(k => [k, resumo[k].slice(0, k === 'nome' ? 120 : 700)])) : null;
  const ordem = intencao ? ordemQualificacao({ ...resumo, intencao }) : ORDEM_QUALIFICACAO;
  const conteudo = { mensagemAtual: texto, contexto: { intencao, campoEsperado, ...(dadosColetados ? { dadosColetados } : {}),
    ordemQualificacao: ordem,
    ...(resumo?.investigacaoPendencias === true ? { investigacaoPendencias: true } : {}),
    dispensados: Array.isArray(resumo?.dispensados) ? resumo.dispensados.filter(k => [...Object.values(ORDEM_QUALIFICACAO).flat(), 'periodoPendencias', 'tipoPendencias', 'situacaoOperacional'].includes(k)) : [],
    ultimaResposta: typeof resumo?.ultimaResposta === 'string' ? resumo.ultimaResposta.slice(0, 600) : null } };
  const body = {
    model: MODELO_LEADS, store: false, reasoning: { effort: ESFORCO_LEADS }, max_output_tokens: MAX_TOKENS_SAIDA_LEADS,
    instructions: PROMPT_LEADS,
    input: [{ role: 'user', content: JSON.stringify(conteudo) }],
    text: { format: { type: 'json_schema', name: 'preatendimento_lead', strict: true, schema: SCHEMA_LEADS } },
  };
  let serializado = JSON.stringify(body);
  if (Buffer.byteLength(serializado, 'utf8') > MAX_BYTES_PEDIDO_LEADS) throw erro('CONTEXTO_LEAD_EXCEDIDO');
  // O relato integral fica no atendimento. A janela recente respeita o teto do
  // pedido e nunca torna uma conversa válida grande demais para a próxima etapa.
  const relatos = Array.isArray(resumo?.relatosCliente) ? resumo.relatosCliente.filter(r => typeof r?.texto === 'string' && r.texto.trim()).slice(-40) : [];
  const incluidos = [];
  for (const relato of relatos.reverse()) {
    const candidato = { ...(typeof relato.mensagemId === 'string' ? { mensagemId: relato.mensagemId.slice(0, 128) } : {}), texto: relato.texto.slice(0, 1000) };
    const propostos = [candidato, ...incluidos];
    if (Buffer.byteLength(JSON.stringify(propostos), 'utf8') > 6000) break;
    conteudo.contexto.relatosCliente = propostos;
    body.input[0].content = JSON.stringify(conteudo);
    const pedido = JSON.stringify(body);
    if (Buffer.byteLength(pedido, 'utf8') > MAX_BYTES_PEDIDO_LEADS) break;
    incluidos.unshift(candidato);
    serializado = pedido;
  }
  return serializado;
}

export class LeadsOpenAIClient {
  constructor({ chave, fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
    this.chave = chave; this.fetch = fetchImpl; this.timeoutMs = timeoutMs;
  }
  async interpretar(entrada) {
    const body = prepararPedidoLead(entrada);
    if (!this.chave) throw erro('OPENAI_SEM_CHAVE');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let usage;
    try {
      // Sem retries: timeout pode ter consumido tokens. A guarda conserva a reserva.
      const response = await this.fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${this.chave}`, 'Content-Type': 'application/json' }, body, signal: controller.signal,
      });
      if (!response.ok) throw erro(await codigoHttp(response));
      const data = await response.json();
      usage = normalizarUsageOpenAI(data.usage);
      if (!usage) throw erro('OPENAI_USO_AUSENTE');
      if (data.status !== 'completed') throw erro('OPENAI_INCOMPLETA', usage);
      const partes = (data.output || []).filter(o => o.type === 'message').flatMap(o => o.content || []);
      if (partes.some(p => p.type === 'refusal')) throw erro('OPENAI_RECUSA', usage);
      const textos = partes.filter(p => p.type === 'output_text');
      if (textos.length !== 1 || typeof textos[0].text !== 'string') throw erro('OPENAI_SAIDA_INVALIDA', usage);
      let parsed;
      try { parsed = JSON.parse(textos[0].text); } catch { throw erro('OPENAI_JSON_INVALIDO', usage); }
      const interpretacao = validarInterpretacaoLead(parsed, entrada.texto);
      if (!interpretacao) throw erro('OPENAI_EVIDENCIA_INVALIDA', usage);
      return { interpretacao, usage, modelo: MODELO_LEADS };
    } catch (e) {
      // Não propagar corpo HTTP, texto do usuário, chave nem mensagens de erro do transporte.
      throw erro(e?.codigo?.startsWith('OPENAI_') ? e.codigo : controller.signal.aborted ? 'OPENAI_TIMEOUT' : 'OPENAI_REDE', usage);
    } finally { clearTimeout(timer); }
  }
}
