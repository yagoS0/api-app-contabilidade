// Q21 (spec v2) — ÚNICO arquivo do sistema que conhece os nomes de campo das respostas
// do SERPRO Integra-Parcelamento (OBTERPARC164 / DETPAGTOPARC165).
//
// Mapeamento CONFIRMADO contra as fixtures oficiais (handoff 2026-06-16). Campos marcados
// [NÃO CONFIRMADO] na doc (alteracaoDivida, demonstrativoPagamento) NÃO são modelados —
// ficam opcionais/ignorados até captura real no sandbox.

// idSistema do Integra Contador por modalidade (mesmo contrato; muda só o idSistema).
export const MODALIDADE_SISTEMA = {
  PARCSN: "PARCSN", PARCSN_ESPECIAL: "PARCSN-ESP", PERT_SN: "PERTSN", RELP_SN: "RELPSN",
  PARCMEI: "PARCMEI", PARCMEI_ESPECIAL: "PARCMEI-ESP", PERT_MEI: "PERTMEI", RELP_MEI: "RELPMEI",
};

// Q22: idServico de EMITIR DAS da parcela por modalidade (confirmados no sandbox/doc 2026-06-17).
// PARCMEI/PERT_MEI/PARCMEI_ESPECIAL/PARCSN_ESPECIAL-? não confirmados → ausência = MODALIDADE_NAO_SUPORTADA.
export const EMITIR_DAS_SERVICO = {
  PARCSN: "GERARDAS161",
  PARCSN_ESPECIAL: "GERARDAS171",
  RELP_SN: "GERARDAS191",
  // PARCMEI / PERT_SN / PERT_MEI / RELP_MEI: TODO(sandbox) — IDs não confirmados.
};

// Q22: idServico de LISTAR competências geráveis por modalidade.
// Confirmado para PARCSN-ESP; analógos por modalidade TODO.
export const PARCELAS_GERAVEIS_SERVICO = {
  PARCSN_ESPECIAL: "PARCELASPARAGERAR172",
  // PARCSN / RELP_SN / outras: TODO(sandbox).
};

export function emitirDasServico(tipo) {
  const id = EMITIR_DAS_SERVICO[String(tipo).toUpperCase()];
  if (!id) {
    const err = new Error(`Emissão de DAS de parcela não suportada para a modalidade ${tipo} (idServico não confirmado).`);
    err.code = "MODALIDADE_NAO_SUPORTADA";
    throw err;
  }
  return id;
}

// Envelope Integra Contador: `dados` é uma STRING JSON aninhada → parse duplo.
// `status` pode vir número (200) ou string ("200") → normalizar.
function parseEnvelope(raw, servico) {
  const env = typeof raw === "string" ? JSON.parse(raw) : raw;
  const status = Number(env?.status);
  if (status !== 200) {
    const msg = Array.isArray(env?.mensagens) && env.mensagens[0]
      ? `${env.mensagens[0].codigo || ""} ${env.mensagens[0].texto || ""}`.trim()
      : `status ${env?.status}`;
    const err = new Error(`SERPRO ${servico} falhou: ${msg}`);
    err.code = "SERPRO_PARC_STATUS_ERRO";
    throw err;
  }
  const dados = typeof env?.dados === "string" ? JSON.parse(env.dados) : env?.dados;
  if (!dados || typeof dados !== "object") {
    const err = new Error(`SERPRO ${servico}: campo 'dados' ausente/ilegível.`);
    err.code = "SERPRO_PARC_DADOS_VAZIO";
    throw err;
  }
  return dados;
}

// Inteiro AAAAMMDD (20180629) ou AAAAMMDDHHmmss (20180619155825) → Date (UTC) | null.
function parseDataInt(v) {
  if (v == null) return null;
  const s = String(v).replace(/\D+/g, "");
  if (s.length < 8) return null;
  const y = Number(s.slice(0, 4)), m = Number(s.slice(4, 6)), d = Number(s.slice(6, 8));
  const hh = Number(s.slice(8, 10) || 0), mm = Number(s.slice(10, 12) || 0), ss = Number(s.slice(12, 14) || 0);
  const dt = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** OBTERPARC164 → ParcelamentoDTO (cabeçalho consolidado). */
export function mapearParcelamento(raw, { tipo, numeroParcelamento } = {}) {
  const d = parseEnvelope(raw, "OBTERPARC164");
  const cons = d.consolidacaoOriginal || {};
  return {
    tipo,
    numeroParcelamento: d.numero != null ? String(d.numero) : (numeroParcelamento != null ? String(numeroParcelamento) : null),
    situacao: d.situacao || null,
    dataAdesao: parseDataInt(d.dataDoPedido),
    valorTotal: cons.valorConsolidadoDaDivida ?? null,
    quantidadeParcelas: cons.quantidadeParcelasDeEntrada ?? null,
    // principal/multa/juros consolidados NÃO vêm neste serviço → null (provisão usa o detalhe/manual).
    valorPrincipal: null, valorMulta: null, valorJuros: null,
    origem: "SERPRO",
  };
}

/** DETPAGTOPARC165 → ParcelaDTO (+ tributos). Achata pagamentoDebitos[].discriminacoesDebito[]. */
export function mapearParcela(raw, { numeroParcela, anoMesParcela } = {}) {
  const d = parseEnvelope(raw, "DETPAGTOPARC165");
  const debitos = Array.isArray(d.pagamentoDebitos) ? d.pagamentoDebitos : [];
  const tributos = [];
  for (const pd of debitos) {
    const periodo = pd.paDebito;
    for (const x of (Array.isArray(pd.discriminacoesDebito) ? pd.discriminacoesDebito : [])) {
      tributos.push({
        codigoTributo: String(x.tributo || "").trim(),
        nomeTributo: x.tributo || null,
        principal: x.principal, multa: x.multa, juros: x.juros, total: x.total,
        periodo, // metadado (não usado no lançamento; preserva rastreio)
      });
    }
  }
  const valorTotal = tributos.reduce((s, t) => s + (Number(t.total) || 0), 0);
  return {
    numeroParcela: d.numeroParcela != null ? Number(d.numeroParcela) : (numeroParcela != null ? Number(numeroParcela) : null),
    numeroParcelamento: d.numeroParcelamento != null ? String(d.numeroParcelamento) : null,
    numeroDas: d.numeroDas || null,
    anoMesParcela: anoMesParcela != null ? String(anoMesParcela) : null,
    vencimento: parseDataInt(d.dataVencimento),
    valorTotal,
    tributos,
  };
}

/** GERARDAS16x → PDF (base64 docArrecadacaoPdfB64). Retorna Buffer. */
export function mapearEmissaoDasParcela(raw) {
  const d = parseEnvelope(raw, "GERARDAS16x");
  const b64 = d.docArrecadacaoPdfB64 || d.docArrecadacaoPDFB64 || d.pdfBase64 || null;
  if (!b64 || typeof b64 !== "string") {
    const err = new Error("Emissão SERPRO sem PDF (docArrecadacaoPdfB64 ausente).");
    err.code = "SERPRO_PARC_PDF_AUSENTE";
    throw err;
  }
  const pdfBuffer = Buffer.from(b64, "base64");
  // Sanidade: PDF começa com "%PDF" (0x25 0x50 0x44 0x46).
  if (pdfBuffer.slice(0, 4).toString("latin1") !== "%PDF") {
    const err = new Error("Conteúdo emitido não é um PDF válido (prefixo %PDF ausente).");
    err.code = "SERPRO_PARC_PDF_INVALIDO";
    throw err;
  }
  return { pdfBuffer, numeroDas: d.numeroDas || null };
}

/** PARCELASPARAGERAR172 → lista de competências geráveis (AAAAMM, números).
 *  Estrutura exata do array a confirmar no sandbox → mapeamento DEFENSIVO. */
export function mapearParcelasGeraveis(raw) {
  const d = parseEnvelope(raw, "PARCELASPARAGERAR172");
  // Aceita: dados = [202306, ...]; ou { listaParcelas|parcelas|competencias: [...] } com itens
  // número (AAAAMM) ou objeto com campo de período.
  let lista = Array.isArray(d) ? d
    : (Array.isArray(d.listaParcelas) ? d.listaParcelas
      : Array.isArray(d.parcelas) ? d.parcelas
      : Array.isArray(d.competencias) ? d.competencias : []);
  const out = [];
  for (const item of lista) {
    let pa = null;
    if (typeof item === "number" || /^\d{6}$/.test(String(item))) pa = String(item);
    else if (item && typeof item === "object") {
      const cand = item.parcelaParaEmitir ?? item.anoMesParcela ?? item.competencia ?? item.pa ?? null;
      if (cand != null && /^\d{6}$/.test(String(cand))) pa = String(cand);
    }
    if (pa) out.push(pa); // AAAAMM
  }
  return out;
}
