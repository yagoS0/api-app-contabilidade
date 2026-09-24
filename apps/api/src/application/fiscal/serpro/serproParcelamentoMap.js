// Q21 (spec v2) — ÚNICO arquivo do sistema que conhece os nomes de campo das respostas
// do SERPRO Integra-Parcelamento (OBTERPARC164 / DETPAGTOPARC165).
//
// Mapeamento CONFIRMADO contra as fixtures oficiais (handoff 2026-06-16). Campos marcados
// [NÃO CONFIRMADO] na doc (alteracaoDivida, demonstrativoPagamento) NÃO são modelados —
// ficam opcionais/ignorados até captura real no sandbox.

// Cada modalidade tem sistema e serviços próprios; não reaproveitar IDs de PARCSN no MEI.
export const MODALIDADE_SISTEMA = {
  PARCSN: "PARCSN", PARCSN_ESPECIAL: "PARCSN-ESP", PERT_SN: "PERTSN", RELP_SN: "RELPSN",
  PARCMEI: "PARCMEI", PARCMEI_ESPECIAL: "PARCMEI-ESP", PERT_MEI: "PERTMEI", RELP_MEI: "RELPMEI",
};

// Q22: idServico de EMITIR DAS da parcela por modalidade (confirmados no sandbox/doc 2026-06-17).
// A automação inicial usa PARCSN/PARCMEI ordinários. Outros IDs já conhecidos ficam preservados.
export const EMITIR_DAS_SERVICO = {
  PARCSN: "GERARDAS161",
  PARCMEI: "GERARDAS201",
  PARCSN_ESPECIAL: "GERARDAS171",
  RELP_SN: "GERARDAS191",
  // PERT_SN / PERT_MEI / RELP_MEI: dependem de validação específica.
};

// Q22: idServico de LISTAR competências geráveis por modalidade.
// Formas ordinárias verificadas na documentação oficial de 24/09/2026.
export const PARCELAS_GERAVEIS_SERVICO = {
  PARCSN: "PARCELASPARAGERAR162",
  PARCMEI: "PARCELASPARAGERAR202",
  PARCSN_ESPECIAL: "PARCELASPARAGERAR172",
  // RELP_SN / outras: dependem de validação específica.
};

export const PEDIDOS_SERVICO = { PARCSN: "PEDIDOSPARC163", PARCMEI: "PEDIDOSPARC203" };
export const OBTER_SERVICO = { PARCSN: "OBTERPARC164", PARCMEI: "OBTERPARC204" };
export const PAGAMENTO_SERVICO = { PARCSN: "DETPAGTOPARC165", PARCMEI: "DETPAGTOPARC205" };
export const MODALIDADES_AUTOMATICAS = Object.freeze(["PARCSN", "PARCMEI"]);

export function servicoDaModalidade(mapa, tipo) {
  const id = mapa[String(tipo || "").toUpperCase()];
  if (!id) throw Object.assign(new Error(`Consulta automática não disponível para ${tipo}. Use acompanhamento manual.`), { code: "MODALIDADE_NAO_SUPORTADA" });
  return id;
}

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
export function parseEnvelope(raw, servico) {
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

export function situacaoFiscalContrato(situacao) {
  const s = String(situacao || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
  if (["EM PARCELAMENTO", "ATIVO"].includes(s)) return "ATIVO";
  if (/^(LIQUIDADO|QUITADO)$/.test(s)) return "QUITADO";
  if (/^(RESCINDIDO|CANCELADO|DESISTENCIA|DESISTENTE)$/.test(s)) return "RESCINDIDO";
  return "A_CONFERIR";
}

export function mapearPedidosParcelamento(raw, { tipo } = {}) {
  const d = parseEnvelope(raw, "PEDIDOSPARC");
  if (!Array.isArray(d.parcelamentos)) throw Object.assign(new Error("Lista de parcelamentos em formato desconhecido."), { code: "SERPRO_PARC_FORMATO_DESCONHECIDO" });
  return d.parcelamentos.map(p => {
    if (!/^\d+$/.test(String(p?.numero ?? "")) || !String(p?.situacao || "").trim()) throw Object.assign(new Error("Pedido sem número ou situação fiscal."), { code: "SERPRO_PARC_FORMATO_DESCONHECIDO" });
    return { tipo, numeroParcelamento: String(p.numero), situacao: p.situacao, fiscalSituacao: situacaoFiscalContrato(p.situacao), dataAdesao: parseDataInt(p.dataDoPedido), dataSituacao: parseDataInt(p.dataDaSituacao) };
  });
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
    valorTotal: cons.valorConsolidadoDaDivida ?? cons.valorTotalConsolidado ?? null,
    // Quantidade de entradas não é a quantidade total do acordo.
    quantidadeParcelas: cons.quantidadeParcelas ?? null,
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
export function mapearParcelasDisponiveis(raw) {
  const d = parseEnvelope(raw, "PARCELASPARAGERAR172");
  // Aceita: dados = [202306, ...]; ou { listaParcelas|parcelas|competencias: [...] } com itens
  // número (AAAAMM) ou objeto com campo de período.
  let lista = Array.isArray(d) ? d
    : Array.isArray(d.listaParcela) ? d.listaParcela
    : (Array.isArray(d.listaParcelas) ? d.listaParcelas
      : Array.isArray(d.parcelas) ? d.parcelas
      : Array.isArray(d.competencias) ? d.competencias : null);
  if (!lista) throw Object.assign(new Error("Lista de parcelas em formato desconhecido."), { code: "SERPRO_PARC_FORMATO_DESCONHECIDO" });
  const out = [];
  for (const item of lista) {
    let pa = null;
    if (typeof item === "number" || /^\d{6}$/.test(String(item))) pa = String(item);
    else if (item && typeof item === "object") {
      const cand = item.parcela ?? item.parcelaParaEmitir ?? item.anoMesParcela ?? item.competencia ?? item.pa ?? null;
      if (cand != null && /^\d{6}$/.test(String(cand))) pa = String(cand);
    }
    if (!pa || Number(pa.slice(4)) < 1 || Number(pa.slice(4)) > 12) throw Object.assign(new Error("Referência inválida na lista de parcelas."), { code: "SERPRO_PARC_FORMATO_DESCONHECIDO" });
    const valor = item && typeof item === "object" && item.valor != null ? Number(item.valor) : null;
    if (valor != null && (!Number.isFinite(valor) || valor < 0)) throw Object.assign(new Error("Valor inválido na lista de parcelas."), { code: "SERPRO_PARC_FORMATO_DESCONHECIDO" });
    if (!out.some(p => p.anoMesParcela === pa)) out.push({ anoMesParcela: pa, valor });
  }
  return out;
}

export function mapearParcelasGeraveis(raw) { return mapearParcelasDisponiveis(raw).map(p => p.anoMesParcela); }
