// Módulo Fiscal (Frente B) — parser da COMPOSIÇÃO de um DARF/guia de arrecadação:
// extrai principal / multa / juros / total por código de receita.
//
// O dado já existe no PDF (DARF DCTFWeb, DAS Simples) mas hoje é descartado (só o Total é lido).
// Serve para a circular guardar o valor ORIGINAL (principal) separado do ACRÉSCIMO (juros+multa)
// quando a guia é recalculada após o vencimento.
//
// Função PURA (sem I/O). Layout confirmado no spike (DARF DCTFWeb):
//   "Composição do Documento de Arrecadação"
//   "2172COFINS - CONTRIB P/ FIN. SEG. SOCIAL"
//   "530,2624,495,30560,05"           ← principal / multa / juros / total (BR concatenados)
// e a linha "Totais\n645,156,4429,79681,38".

function parseBR(raw) {
  const s = String(raw || "").trim();
  if (!s) return 0;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

// Extrai os valores BR (\d+,\d{2}, com milhar opcional) em ordem de uma string,
// mesmo quando concatenados sem separador ("530,2624,49" → [530.26, 24.49]).
function extrairValoresBR(linha) {
  const m = String(linha || "").match(/\d[\d.]*,\d{2}/g);
  return m ? m.map(parseBR) : [];
}

// 4 valores = principal/multa/juros/total; 3 = principal/(multa+juros?)/total (best-effort);
// 2 = principal/total; 1 = principal=total.
function distribuir(vals) {
  if (vals.length >= 4) return { principal: vals[0], multa: vals[1], juros: vals[2], total: vals[3] };
  if (vals.length === 3) return { principal: vals[0], multa: 0, juros: vals[1], total: vals[2] };
  if (vals.length === 2) return { principal: vals[0], multa: 0, juros: 0, total: vals[1] };
  if (vals.length === 1) return { principal: vals[0], multa: 0, juros: 0, total: vals[0] };
  return null;
}

/**
 * @param {string} pdfTexto  texto extraído do PDF (pdf-parse)
 * @returns {{ itens: Array<{codigo,denominacao,principal,multa,juros,total}>,
 *            totais: {principal,multa,juros,total} }}
 */
export function parseArrecadacaoComposicao(pdfTexto) {
  const text = String(pdfTexto || "");
  // Foca na seção de composição, se houver (reduz falso positivo com valores do cabeçalho).
  const idx = text.search(/Composição do Documento de Arrecadação/i);
  const secao = idx >= 0 ? text.slice(idx) : text;
  const linhas = secao.split(/\r?\n/);

  const itens = [];
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(/^(\d{4})\s*(.*)$/); // código de receita (4 díg) + denominação na mesma linha
    if (!m) continue;
    // procura, nas próximas linhas, a que traz os valores (>= 1 valor BR)
    for (let j = i + 1; j < Math.min(i + 4, linhas.length); j++) {
      const vals = extrairValoresBR(linhas[j]);
      if (vals.length >= 1) {
        const dist = distribuir(vals);
        if (dist) itens.push({ codigo: m[1], denominacao: (m[2] || "").trim() || null, ...dist });
        break;
      }
    }
  }

  // Totais: preferir a linha "Totais ..." se existir; senão somar os itens.
  let totais = null;
  const totLinha = secao.match(/Totais\s*\n?\s*([\d.,\s]+)/i);
  if (totLinha) {
    const vals = extrairValoresBR(totLinha[1]);
    if (vals.length >= 1) totais = distribuir(vals);
  }
  if (!totais) {
    totais = itens.reduce(
      (acc, it) => ({
        principal: Math.round((acc.principal + it.principal) * 100) / 100,
        multa: Math.round((acc.multa + it.multa) * 100) / 100,
        juros: Math.round((acc.juros + it.juros) * 100) / 100,
        total: Math.round((acc.total + it.total) * 100) / 100,
      }),
      { principal: 0, multa: 0, juros: 0, total: 0 }
    );
  }

  return { itens, totais };
}

export { parseBR };
