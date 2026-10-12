import { createHash } from 'node:crypto';
import { carregarGrupo, transacao } from './ApuracaoConsumoService.js';
import { LIMITE_ARQUIVO_CBS, validarEnvelopeArquivoCbs } from './ColetaCbsService.js';

const falha = (status, message) => Object.assign(new Error(message), { status });
const numero = Symbol('numeroJSON');

// Parser limitado: números nunca passam por IEEE-754. Chaves repetidas são
// ambíguas e recusadas, inclusive se uma delas usar escape Unicode.
export function lerJsonExato(bytes) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > LIMITE_ARQUIVO_CBS) throw new Error();
    const fonte = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    let p = 0;
    const branco = () => { while (/[\x20\t\r\n]/.test(fonte[p] || '\0')) p++; };
    const string = () => {
      const inicio = p++;
      while (p < fonte.length) {
        if (fonte[p] === '\\') { p += 2; continue; }
        if (fonte[p++] === '"') return JSON.parse(fonte.slice(inicio, p));
      }
      throw new Error();
    };
    const valor = (nivel = 0) => {
      if (nivel > 64) throw new Error();
      branco();
      const c = fonte[p];
      if (c === '"') return string();
      if (c === '{' || c === '[') {
        p++; branco();
        const lista = c === '[', fim = lista ? ']' : '}', resultado = lista ? [] : Object.create(null);
        if (fonte[p] === fim) { p++; return resultado; }
        while (p < fonte.length) {
          branco();
          if (lista) resultado.push(valor(nivel + 1));
          else {
            if (fonte[p] !== '"') throw new Error();
            const chave = string(); branco();
            if (Object.hasOwn(resultado, chave) || fonte[p++] !== ':') throw new Error();
            resultado[chave] = valor(nivel + 1);
          }
          branco();
          if (fonte[p] === fim) { p++; return resultado; }
          if (fonte[p++] !== ',') throw new Error();
        }
        throw new Error();
      }
      for (const [literal, v] of [['true', true], ['false', false], ['null', null]]) {
        if (fonte.startsWith(literal, p)) { p += literal.length; return v; }
      }
      const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(fonte.slice(p));
      if (!token) throw new Error();
      p += token[0].length;
      return { [numero]: token[0] };
    };
    const doc = valor(); branco();
    if (p !== fonte.length) throw new Error();
    return doc;
  } catch { throw falha(422, 'Arquivo JSON inválido, ambíguo ou acima dos limites de processamento.'); }
}

function centavos(v) {
  const raw = v?.[numero];
  if (typeof raw !== 'string' || !/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(raw)) return null;
  const [inteiro, decimal = ''] = raw.split('.');
  return (BigInt(inteiro) * 100n + BigInt(decimal.padEnd(2, '0'))).toString();
}

const debitos = { apurado: true, saldoDevedor: true, excedente: true, inexigivel: true, suspenso: true, extinto: true };
const creditos = { apurado: true, excedentes: true, apropriacao: { inapropriavel: true, suspenso: true, prescrito: true,
  aApropriar: true, apropriado: true, utilizacao: { inutilizavel: true, utilizado: true, restabelecido: true,
    naoUtilizado: { saldoCredor: true, pedidoRessarcimento: true } } } };

export function inspecionarArquivoCbs(bytes, identidade) {
  validarEnvelopeArquivoCbs(bytes, identidade);
  const doc = lerJsonExato(bytes), campo = identidade.recurso === 'DEBITOS' ? 'debitos' : 'creditos';
  let itens = 0, valoresInvalidos = 0;
  const amostra = [], periodos = [];
  for (const [indicePeriodo, periodo] of doc.apuracao.entries()) {
    periodos.push({ competencia: `${periodo.pa.slice(3)}-${periodo.pa.slice(0, 2)}`, quantidade: periodo[campo].length });
    for (const [indiceItem, item] of periodo[campo].entries()) {
      itens++;
      const valores = Object.create(null);
      const percorrer = (v, caminho, contrato) => {
        if (contrato === true) {
          const cents = centavos(v);
          if (cents === null) valoresInvalidos++;
          valores[caminho] = { centavos: cents, valido: cents !== null };
        } else if (v && typeof v === 'object' && !Array.isArray(v) && !Object.hasOwn(v, numero)) {
          for (const [k, n] of Object.entries(v)) {
            if (!Object.hasOwn(contrato, k)) { valoresInvalidos++; continue; }
            percorrer(n, `${caminho}.${k}`, contrato[k]);
          }
        } else {
          valoresInvalidos++;
        }
      };
      if (!item?.cbs || typeof item.cbs !== 'object' || Array.isArray(item.cbs) || !Object.hasOwn(item.cbs, 'apurado')) valoresInvalidos++;
      if (identidade.recurso === 'DEBITOS' && !Object.hasOwn(item?.cbs || {}, 'saldoDevedor')) valoresInvalidos++;
      if (item?.cbs) percorrer(item.cbs, 'cbs', identidade.recurso === 'DEBITOS' ? debitos : creditos);
      if (amostra.length < 100) amostra.push({ indicePeriodo, indiceItem, valores });
    }
  }
  return { versaoParser: 'CBS_INSPECAO_1', sha256: createHash('sha256').update(bytes).digest('hex'),
    recurso: identidade.recurso, periodos, quantidadeItens: itens, valoresInvalidos, amostra, truncada: itens > amostra.length,
    cobertura: 'NAO_VALIDADA', identidadeItens: 'NAO_HOMOLOGADA', totaisOficiais: null,
    aviso: 'Inspeção local do arquivo preservado. As posições identificam somente esta evidência; atualizações não são somadas e não comprovam cobertura ou conferência.' };
}

export async function reprocessarArquivoCbs(db, companyId, coletaId, entrada, usuario, deps = {}) {
  if (!entrada || Object.keys(entrada).some(k => k !== 'ambiente') || !['HOMOLOGACAO', 'PRODUCAO'].includes(entrada.ambiente)) throw falha(400, 'Informe somente o ambiente do arquivo.');
  return transacao(db, async tx => {
    const grupo = await carregarGrupo(tx, companyId, usuario, true);
    const coleta = grupo && await tx.apuracaoCbsColeta.findFirst({ where: { id: coletaId, contribuinteId: grupo.id, ambiente: entrada.ambiente } });
    if (!coleta) throw falha(404, 'Coleta não encontrada neste contexto.');
    const arquivo = await tx.apuracaoCbsArquivo.findFirst({ where: { coletaId, contribuinteId: grupo.id, ambiente: entrada.ambiente } });
    if (!arquivo) throw falha(409, 'Ainda não há arquivo preservado nesta coleta.');
    if (typeof deps.protecao?.decifrar !== 'function') throw falha(503, 'A chave de leitura desta evidência não está disponível.');
    let bytes;
    try {
      bytes = await deps.protecao.decifrar(Buffer.from(arquivo.conteudoCifrado), { contribuinteId: grupo.id, ambiente: entrada.ambiente, coletaId, finalidade: 'arquivo' });
      if (!Buffer.isBuffer(bytes) || bytes.length !== arquivo.tamanhoBytes || createHash('sha256').update(bytes).digest('hex') !== arquivo.sha256) throw new Error();
    } catch { throw falha(409, 'Não foi possível verificar a integridade da evidência.'); }
    return inspecionarArquivoCbs(bytes, { cnpjBase: grupo.cnpjBase, ticket: coleta.ticket, recurso: coleta.recurso });
  });
}
