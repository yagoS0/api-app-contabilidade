// Módulo Fiscal M2 — parser do texto do "Relatório da Declaração Completa - DCTFWeb"
// (a CONSDECCOMPLETA33 só devolve PDF; extraímos o texto via pdf-parse e parseamos aqui).
//
// Estrutura confirmada em produção (spike): blocos regulares
//   Código da Receita → Descrição → ... → Débito Apurado → Saldo a Pagar
// Códigos reais: PIS 8109, COFINS 2172 (mensal); IRPJ 2089, CSLL 2372 (trimestral).
//
// Função PURA (sem I/O) — fácil de testar. NÃO decide nada fiscal; só estrutura o dado.

// Mapa código de receita (4 primeiros dígitos) → tributo.
const CODIGO_TRIBUTO = {
  "8109": "PIS",
  "2172": "COFINS",
  "2089": "IRPJ",
  "2372": "CSLL",
};

function parseValorBR(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  // "1.234,56" → 1234.56 ; "114,89" → 114.89
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function campoDepoisDe(texto, rotulo) {
  // Pega o primeiro valor não-vazio na linha seguinte ao rótulo.
  const re = new RegExp(rotulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\n\\s*([^\\n]+)", "i");
  const m = texto.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Faz o parse do texto do relatório da DCTFWeb.
 * @returns {{
 *   cabecalho: { cnpj, competencia, numeroRecibo, reciboRetificada, dataTransmissao,
 *               formaTributacao, regimePisCofins, ausenciaFatosGeradores },
 *   debitos: Array<{ codigoReceita, tributo, descricao, debitoApurado, saldoAPagar }>,
 *   totais: { debitoApurado, saldoAPagar, porTributo }
 * }}
 */
export function parseDctfwebDeclaracao(pdfTexto) {
  const texto = String(pdfTexto || "");

  const cabecalho = {
    cnpj: (campoDepoisDe(texto, "CNPJ") || "").replace(/\D+/g, "") || null,
    competencia: campoDepoisDe(texto, "Período apuração"),
    numeroRecibo: campoDepoisDe(texto, "Número do Recibo"),
    reciboRetificada: campoDepoisDe(texto, "Número do Recibo da Declaração Retificada"),
    dataTransmissao: campoDepoisDe(texto, "Transmissão"),
    formaTributacao: campoDepoisDe(texto, "Forma de tributação"),
    regimePisCofins: campoDepoisDe(texto, "Regime PIS/COFINS"),
    ausenciaFatosGeradores: campoDepoisDe(texto, "Ausência de Fatos Geradores"),
  };

  // Blocos de débito: "Código da Receita\n<cod>\nDescrição\n<desc>\n...\nDébito Apurado\n<v>\nSaldo a Pagar\n<v>"
  const re = /Código da Receita\s*\n\s*([0-9A-Za-z.\-/]+)\s*\n\s*Descrição\s*\n\s*([^\n]+)[\s\S]*?Débito Apurado\s*\n\s*([\d.]*,\d{2})\s*\n\s*Saldo a Pagar\s*\n\s*([\d.]*,\d{2})/g;

  const debitos = [];
  let m;
  while ((m = re.exec(texto)) !== null) {
    const codigoReceita = m[1].trim();
    const cod4 = codigoReceita.replace(/\D+/g, "").slice(0, 4);
    debitos.push({
      codigoReceita,
      tributo: CODIGO_TRIBUTO[cod4] || null,
      descricao: m[2].trim(),
      debitoApurado: parseValorBR(m[3]),
      saldoAPagar: parseValorBR(m[4]),
    });
  }

  const porTributo = {};
  let totDeb = 0;
  let totSaldo = 0;
  for (const d of debitos) {
    totDeb += d.debitoApurado || 0;
    totSaldo += d.saldoAPagar || 0;
    const key = d.tributo || d.codigoReceita;
    porTributo[key] = round2((porTributo[key] || 0) + (d.debitoApurado || 0));
  }

  return {
    cabecalho,
    debitos,
    totais: { debitoApurado: round2(totDeb), saldoAPagar: round2(totSaldo), porTributo },
  };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
