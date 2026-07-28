// Lê o COMPROVANTE DE ARRECADAÇÃO (PAGTOWEB/COMPARRECADACAO72) e extrai o que permite dar baixa
// com os dados REAIS do pagamento: data de arrecadação e a quebra principal/juros/multa.
//
// Calibrado com o texto REAL de um comprovante de INSS pago em atraso via PIX (27/07/2026).
// Duas características do texto extraído que ditam o parse:
//
//  1. Rótulos e valores saem SEPARADOS e às vezes GRUDADOS entre si:
//       "BancoData de Arrecadação"
//       "AgênciaEstabelecimentoValor Reservado/RestituídoReferência"
//       "13/07/2026Documento pago via PIX"
//     → a data de arrecadação é a 1ª data que aparece DEPOIS do rótulo. Buscar antes pegaria a
//       data de EMISSÃO do comprovante ("Comprovante emitido às…de 27/07/2026").
//
//  2. Os valores da linha de totais vêm COLADOS, sem separador:
//       "178,3112,941,78193,03"  =  178,31 | 12,94 | 1,78 | 193,03
//     → separados por regex de moeda (cada valor termina em ",dd").
//
// ⚠ AUTOVERIFICAÇÃO: só devolvemos a quebra se principal+juros+multa == total (tolerância de 1
// centavo). Se não fechar, o split dos números colados não é confiável e devolvemos null — nunca
// um valor "provável". Baixa contábil com valor chutado é pior do que baixa manual.

// Sem \b: no texto extraído a data vem COLADA no texto seguinte ("13/07/2026Documento pago via
// PIX"). Dígito seguido de letra NÃO é fronteira de palavra, então o \b final fazia o match falhar
// justamente na data de arrecadação — que é o dado mais importante do comprovante.
const RE_DATA = /(\d{2}\/\d{2}\/\d{4})/;
const RE_DATA_G = /\d{2}\/\d{2}\/\d{4}/g;
const RE_MOEDA_G = /\d{1,3}(?:\.\d{3})*,\d{2}/g;

function parseValorBR(txt) {
  const n = Number(String(txt).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function parseDataBR(txt) {
  const m = String(txt || "").match(RE_DATA);
  if (!m) return null;
  const [d, mes, a] = m[1].split("/").map(Number);
  const dt = new Date(Date.UTC(a, mes - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * @param {string} texto  texto extraído do PDF do comprovante
 * @returns {{
 *   dataArrecadacao: Date|null, dataArrecadacaoBR: string|null,
 *   principal: number|null, juros: number|null, multa: number|null, total: number|null,
 *   meioPagamento: string|null, confiavel: boolean,
 * }}
 */
export function parseComprovanteArrecadacao(texto) {
  const t = String(texto || "");
  const out = {
    dataArrecadacao: null, dataArrecadacaoBR: null,
    principal: null, juros: null, multa: null, total: null,
    meioPagamento: null, confiavel: false,
  };
  if (!t.trim()) return out;

  // ── Data de arrecadação: 1ª data APÓS o rótulo (antes dele está a data de emissão) ──────────
  const idxRotulo = t.search(/Data\s+de\s+Arrecada[çc][ãa]o/i);
  if (idxRotulo >= 0) {
    const depois = t.slice(idxRotulo);
    const m = depois.match(RE_DATA_G);
    if (m && m.length) {
      out.dataArrecadacaoBR = m[0];
      out.dataArrecadacao = parseDataBR(m[0]);
    }
    const mPag = depois.match(/Documento\s+pago\s+via\s+([A-Za-zÀ-ú]+)/i);
    if (mPag) out.meioPagamento = mPag[1].toUpperCase();
  }

  // ── Totais: a linha logo após o rótulo "Totais" traz principal, juros, multa e total ────────
  // (nesta ordem — o cabeçalho sai invertido no texto, mas os VALORES seguem esta sequência).
  const linhas = t.split(/\r?\n/).map((l) => l.trim());
  const iTotais = linhas.findIndex((l) => /^totais$/i.test(l));
  let valores = [];
  if (iTotais >= 0) {
    for (let j = iTotais + 1; j < Math.min(iTotais + 4, linhas.length); j += 1) {
      const achados = linhas[j].match(RE_MOEDA_G);
      if (achados && achados.length >= 3) { valores = achados; break; }
    }
  }
  // Sem bloco "Totais" (comprovante de 1 item): usa a linha de composição, que tem o código antes.
  if (!valores.length) {
    const linhaComp = linhas.find((l) => /^\d{4}\D/.test(l) && (l.match(RE_MOEDA_G) || []).length >= 3);
    if (linhaComp) valores = linhaComp.match(RE_MOEDA_G) || [];
  }

  if (valores.length >= 4) {
    const [p, j, m, tot] = valores.slice(-4).map(parseValorBR);
    const soma = r2((p || 0) + (j || 0) + (m || 0));
    // A soma tem que bater com o total; senão o split dos números colados errou.
    if (tot != null && Math.abs(soma - tot) <= 0.01) {
      out.principal = p; out.juros = j; out.multa = m; out.total = tot;
      out.confiavel = true;
    } else {
      // Guarda só o total (última posição é sempre o total no layout observado) — sem inventar quebra.
      out.total = tot;
    }
  } else if (valores.length === 1) {
    out.total = parseValorBR(valores[0]);
  }

  return out;
}
