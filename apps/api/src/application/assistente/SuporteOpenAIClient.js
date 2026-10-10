import { normalizarUsageOpenAI } from './LeadsOpenAIClient.js';
import { custoEstimadoCentavos, somarUsage } from './precosIa.js';

export const MODELO_SUPORTE = 'gpt-5.4-mini';
export const MAX_BYTES_SUPORTE = 180000;
export const MAX_OUTPUT_SUPORTE = 2400;
const erro = codigo => Object.assign(new Error(codigo), { codigo });
const TEXTO_ENCAMINHADO = 'Encaminhei sua mensagem para a equipe continuar o atendimento por aqui.';

export function pedidoHumanoExplicito(texto) {
  const t = String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim();
  // Frases completas e inequívocas; negações, perguntas gerais e citações ficam com o modelo.
  return /^(?:por favor,? )?(?:(?:quero|preciso de|preciso da) (?:atendimento humano|(?:um |uma |a )?(?:atendente|pessoa|equipe humana))|quero falar com (?:uma pessoa|um atendente|o contador)|me passa para (?:o contador|um atendente)|(?:chama|chame) o escritorio(?: para mim)?|encaminhe minha duvida ao contador|nao quero robo,? quero um atendente)(?:,? por favor)?$/.test(t);
}

// JSON Schema simples: a validação fiscal continua nas ferramentas de domínio.
export function argumentosValidos(valor, schema) {
  if (!schema || typeof schema !== 'object') return false;
  if (schema.anyOf) return schema.anyOf.some(s => argumentosValidos(valor, s));
  if (schema.enum && !schema.enum.includes(valor)) return false;
  const tipos = Array.isArray(schema.type) ? schema.type : [schema.type];
  return tipos.some(tipo => {
    if (tipo === 'null') return valor === null;
    if (tipo === 'object') return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
      && (schema.required || []).every(k => Object.hasOwn(valor, k))
      && Object.entries(valor).every(([k, v]) => schema.properties?.[k] ? argumentosValidos(v, schema.properties[k]) : schema.additionalProperties !== false);
    if (tipo === 'array') return Array.isArray(valor) && valor.every(v => argumentosValidos(v, schema.items));
    if (tipo === 'integer' || tipo === 'number') return typeof valor === 'number' && Number.isFinite(valor)
      && (tipo !== 'integer' || Number.isInteger(valor)) && (schema.minimum === undefined || valor >= schema.minimum)
      && (schema.maximum === undefined || valor <= schema.maximum);
    if (tipo === 'string') return typeof valor === 'string' && (schema.minLength === undefined || valor.length >= schema.minLength)
      && (schema.maxLength === undefined || valor.length <= schema.maxLength);
    return tipo === 'boolean' && typeof valor === 'boolean';
  });
}

export class SuporteOpenAIClient {
  constructor({ chave, fetchImpl = globalThis.fetch, timeoutMs = 45000, maxIteracoes = 6, autorizar, concluir } = {}) {
    this.modelo = MODELO_SUPORTE;
    this.chave = chave; this.fetch = fetchImpl; this.timeoutMs = timeoutMs;
    this.maxIteracoes = Math.min(8, Math.max(1, Number(maxIteracoes) || 6));
    this.autorizar = autorizar; this.concluir = concluir;
  }

  async responder({ system, messages, ferramentas = [], executar }) {
    if (messages?.at(-1)?.role !== 'user') throw erro('IA_HISTORICO_INVALIDO');
    if (pedidoHumanoExplicito(messages.at(-1).content) && ferramentas.some(f => f.name === 'chamar_escritorio')) {
      const saida = await executar('chamar_escritorio', { motivo: 'Cliente solicitou atendimento humano: ' + messages.at(-1).content });
      if (saida?.ok !== true) throw erro('IA_ENCAMINHAMENTO_FALHOU');
      return { texto: TEXTO_ENCAMINHADO, stopReason: 'end_turn', iteracoes: 0, recusou: false,
        usage: somarUsage([]), ferramentasChamadas: ['chamar_escritorio'] };
    }
    if (!this.chave) throw erro('OPENAI_SEM_CHAVE');
    if (!this.autorizar || !this.concluir) throw erro('OPENAI_SEM_GUARDA');
    const input = messages.map(m => ({ role: m.role, content: m.content }));
    const tools = ferramentas.map(f => ({ type: 'function', name: f.name, description: f.description,
      parameters: f.input_schema, strict: f.strict === true }));
    const usages = [], ferramentasChamadas = [];
    const instrucoes = typeof system === 'string' ? system : (system || []).map(b => b.text || '').join('\n');
    const codigos = new Set([...instrucoes.matchAll(/código ([A-Z0-9]{4,12})\b/g)].map(m => m[1]));
    const textoSeguro = texto => {
      const comandos = [...texto.matchAll(/\bCONFIRMAR\s+(<[^>\n]+>|\[[^\]\n]+\]|[A-Z0-9]{4,12}\b)/g)];
      if (comandos.some(m => !codigos.has(m[1]))) return 'O sistema envia um resumo do pedido com o código de confirmação. Confira os dados e siga a instrução desse resumo. A preparação sozinha não executa o pedido.';
      return texto;
    };
    const idsExecutados = new Set();
    const resultado = (texto, stopReason, iteracoes, recusou = false) => ({ texto, stopReason, iteracoes, recusou,
      usage: somarUsage(usages), ferramentasChamadas });
    for (let iteracoes = 1; iteracoes <= this.maxIteracoes; iteracoes++) {
      const body = JSON.stringify({ model: this.modelo, store: false, reasoning: { effort: 'low' },
        include: ['reasoning.encrypted_content'], max_output_tokens: MAX_OUTPUT_SUPORTE,
        instructions: typeof system === 'string' ? system : (system || []).map(b => b.text || '').join('\n\n'),
        input, ...(tools.length ? { tools, parallel_tool_calls: false } : {}) });
      const bytes = Buffer.byteLength(body, 'utf8');
      if (bytes > MAX_BYTES_SUPORTE) throw erro('OPENAI_CONTEXTO_EXCEDIDO');
      // Limite conservador por bytes + framing, inclusive ferramentas e histórico da rodada.
      const reservaCentavos = custoEstimadoCentavos({ input_tokens: bytes + 8192, output_tokens: MAX_OUTPUT_SUPORTE }, this.modelo);
      const guarda = await this.autorizar({ modelo: this.modelo, reservaCentavos });
      if (!guarda?.ok) throw erro(guarda?.motivo || 'IA_ORCAMENTO_RECUSADO');
      let data, usage = null, codigo = null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetch('https://api.openai.com/v1/responses', {
          method: 'POST', headers: { Authorization: `Bearer ${this.chave}`, 'Content-Type': 'application/json' }, body, signal: controller.signal,
        });
        if (!response.ok) throw erro(({ 401: 'OPENAI_AUTENTICACAO', 429: 'OPENAI_LIMITE' })[response.status] || 'OPENAI_HTTP');
        data = await response.json();
        usage = normalizarUsageOpenAI(data?.usage);
        if (!usage) throw erro('OPENAI_USO_AUSENTE');
      } catch (e) {
        codigo = /^OPENAI_[A-Z_]+$/.test(e?.codigo || '') ? e.codigo : controller.signal.aborted ? 'OPENAI_TIMEOUT' : 'OPENAI_REDE';
      } finally {
        clearTimeout(timer);
        await this.concluir(guarda.contexto, { usage, usageCompleto: Boolean(usage), iteracoes: 1,
          ferramentas: (data?.output || []).filter(o => o.type === 'function_call').map(o => o.name),
          stopReason: data?.status || null, erroCodigo: codigo });
      }
      if (codigo) throw erro(codigo);
      usages.push(usage);
      if (data.status !== 'completed') return resultado('', 'max_tokens', iteracoes);
      const partes = (data.output || []).filter(o => o.type === 'message').flatMap(o => o.content || []);
      if (partes.some(p => p.type === 'refusal')) return resultado('', 'refusal', iteracoes, true);
      const chamadas = (data.output || []).filter(o => o.type === 'function_call');
      if (!chamadas.length) {
        const textoFinal = textoSeguro(partes.filter(p => p.type === 'output_text').map(p => p.text || '').join('\n').trim());
        // Não deixa uma promessa de transferência substituir a ação que gera a fila/aviso.
        const prometeuTransferencia = /(?:^|\n|[.!?]\s+)(?:j[aá]\s+)?(?:encaminhei|vou encaminhar|vou transferir|transferi|vou passar)\b/i.test(textoFinal);
        if (prometeuTransferencia && ferramentas.some(f => f.name === 'chamar_escritorio')) {
          const encaminhamento = await executar('chamar_escritorio', { motivo: 'O atendimento requer revisão da equipe. Solicitação: ' + String(messages.at(-1).content).slice(0, 1500) });
          if (encaminhamento?.ok !== true) throw erro('IA_ENCAMINHAMENTO_FALHOU');
          ferramentasChamadas.push('chamar_escritorio');
          return resultado(TEXTO_ENCAMINHADO, 'end_turn', iteracoes);
        }
        return resultado(textoFinal, 'end_turn', iteracoes);
      }
      if (chamadas.length > 1) throw erro('OPENAI_FERRAMENTAS_PARALELAS');
      input.push(...data.output);
      for (const chamada of chamadas) {
        const definicao = ferramentas.find(f => f.name === chamada.name);
        let args;
        try { args = JSON.parse(chamada.arguments); } catch { throw erro('OPENAI_ARGUMENTOS_INVALIDOS'); }
        if (!definicao || !argumentosValidos(args, definicao.input_schema) || !chamada.call_id || idsExecutados.has(chamada.call_id)) throw erro('OPENAI_FERRAMENTA_INVALIDA');
        idsExecutados.add(chamada.call_id);
        ferramentasChamadas.push(chamada.name);
        // Falhas lançadas de permissão/contexto precisam interromper o turno, nunca virar dado ao modelo.
        const saida = await executar(chamada.name, args);
        if (saida?.ok && saida?.pendenciaCriada && typeof saida.codigo === 'string') codigos.add(saida.codigo);
        input.push({ type: 'function_call_output', call_id: chamada.call_id, output: JSON.stringify(saida ?? null) });
        if (saida?.ok === false && saida?.motivo === 'GUIA_SEM_PDF' && ferramentas.some(f => f.name === 'chamar_escritorio')) {
          const encaminhamento = await executar('chamar_escritorio', { motivo: 'Guia localizada, mas o PDF não está disponível para envio.' });
          if (encaminhamento?.ok !== true) throw erro('IA_ENCAMINHAMENTO_FALHOU');
          ferramentasChamadas.push('chamar_escritorio');
          return resultado(TEXTO_ENCAMINHADO, 'end_turn', iteracoes);
        }
        if (chamada.name === 'chamar_escritorio' || saida?.encaminharEscritorio === true || saida?.motivo === 'FERRAMENTA_FALHOU') return resultado(TEXTO_ENCAMINHADO, 'end_turn', iteracoes);
      }
    }
    return resultado('', 'max_iteracoes', this.maxIteracoes);
  }
}
