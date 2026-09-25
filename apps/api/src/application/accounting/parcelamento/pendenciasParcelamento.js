const MESES = /^\d{4}-(0[1-9]|1[0-2])$/;
const dataCivil = (v) => v && Number.isFinite(new Date(v).getTime()) ? new Date(v).toISOString().slice(0, 10) : null;
const valor = (v) => v == null ? null : Number(v);
export function mesAtualOperacional(agora = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(agora);
  return `${parts.find(p => p.type === "year").value}-${parts.find(p => p.type === "month").value}`;
}

export function mesOperacionalDaCompetencia(competencia) {
  if (!MESES.test(String(competencia))) throw new Error("Competência inválida.");
  const d = new Date(`${competencia}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
}

export function parcelaPagamentoConfirmado(p, { aceitarDeclaracaoCliente = true } = {}) {
  return Boolean(p?.origemBaixa || p?.baixadaEm || p?.pagamentoStatus === "CONFIRMADO"
    || p?.guia?.baixada || (p?.guia?.paymentStatus === "PAID"
      && (aceitarDeclaracaoCliente || p.guia.paymentStatusSource !== "CLIENTE")));
}

export function complianceParcelamentos(itens) {
  if (!itens.length) return { required: false, ok: true, state: "na", itens: [], quantidade: 0, pendencias: 0, atrasadas: 0, pendenciaOperacional: false };
  const pendencias = itens.filter(i => i.estado !== "RESOLVIDA").length;
  const faltante = itens.some(i => !i.pagamentoConfirmado && !i.guideId && i.formaPagamento !== "DEBITO_AUTOMATICO");
  const tratadas = itens.every(i => i.pagamentoConfirmado || i.enviada || i.formaPagamento === "DEBITO_AUTOMATICO");
  const primeiro = itens[0];
  return { required: true, ok: !faltante, state: faltante ? "missing" : tratadas ? "enviada" : "gerada",
    guideId: primeiro.guideId, tipoParcelamento: primeiro.tipo, numeroParcelamento: primeiro.numeroParcelamento,
    numeroParcela: primeiro.numeroParcela, quantidadeParcelas: null, atrasada: itens.some(i => i.atrasada),
    itens, quantidade: itens.length, pendencias, atrasadas: itens.filter(i => i.atrasada).length, pendenciaOperacional: pendencias > 0 };
}

/** Uma projeção operacional; não altera obrigações, documentos nem lançamentos. */
export function projetarPendenciasParcelamento({ contratos = [], indicacoes = [], mesOperacional, enviada = () => false, agora = new Date() }) {
  if (!MESES.test(String(mesOperacional))) throw Object.assign(new Error("Mês operacional inválido."), { code: "MES_OPERACIONAL_INVALIDO", status: 400 });
  const partesHoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(agora);
  const hoje = ["year", "month", "day"].map(tipo => partesHoje.find(p => p.type === tipo).value).join("-");
  const itens = [];
  const indicacoesPendentes = indicacoes.filter(i => i.status === "PENDENTE" && !i.parcelamentoId);
  for (const i of indicacoesPendentes) {
    const cobertaNoMes = contratos.some(c => c.status !== "EXCLUIDO" && c.portalClientId === i.portalClientId
      && (!i.modalidade || i.modalidade === c.tipo) && (c.parcelas || []).some(p => {
        const g = p.guia;
        return g?.status === "PROCESSED" && Boolean(g.pdfDisponivel || g.pdfBytes?.length || g.storageKey)
          && (dataCivil(g.vencimento)?.slice(0, 7) || g.competencia) === mesOperacional
          && (g.extracted?.indicacaoParcelamentoId
            ? g.extracted.indicacaoParcelamentoId === i.id
            : i.numeroParcelamento
              ? i.numeroParcelamento === c.numeroParcelamento
              : indicacoesPendentes.filter(j => j.portalClientId === i.portalClientId && (!j.modalidade || j.modalidade === c.tipo)).length === 1);
      }));
    if (cobertaNoMes && !(Number(i.parcelasEmAtraso) > 0)) continue;
    itens.push({ id: `indicacao:${i.id}`, indicacaoId: i.id, portalClientId: i.portalClientId,
      parcelamentoId: null, parcelaId: null, guideId: null, tipo: i.modalidade, numeroParcelamento: i.numeroParcelamento,
      numeroParcela: null, referencia: cobertaNoMes ? null : mesOperacional, vencimento: null, valor: null, estado: "IDENTIFICAR", acao: "identificar",
      label: cobertaNoMes ? "Parcelas anteriores em atraso informadas no relatório" : "Falta guia de parcelamento",
      anterior: cobertaNoMes, somenteAnteriores: cobertaNoMes, guiaDoMesPresente: cobertaNoMes, atrasada: Number(i.parcelasEmAtraso) > 0,
      atrasosInformados: i.parcelasEmAtraso ?? null, evidenciaEm: i.evidenciaEm, origem: i.origem,
      pagamentoConfirmado: false, contabilizacaoPendente: false });
  }
  for (const c of contratos) {
    if (c.status === "EXCLUIDO") continue;
    const ativas = c.origem !== "GUIA_AVULSA" && c.status === "ATIVO" && !["QUITADO", "RESCINDIDO"].includes(c.fiscalSituacao);
    let possuiMes = false;
    for (const p of c.parcelas || []) {
      const g = p.guia;
      const vencimento = dataCivil(g?.vencimento || p.vencimento);
      const referencia = p.anoMesParcela && /^\d{6}$/.test(p.anoMesParcela)
        ? `${p.anoMesParcela.slice(0, 4)}-${p.anoMesParcela.slice(4)}` : p.competencia;
      const mes = vencimento?.slice(0, 7) || referencia;
      if (mes && mes > mesOperacional) continue;
      if (mes === mesOperacional) possuiMes = true;
      const pago = parcelaPagamentoConfirmado(p);
      const contabilizado = Boolean(p.origemBaixa || p.baixadaEm || g?.baixada);
      const anterior = Boolean(mes && mes < mesOperacional);
      if (pago && contabilizado && anterior) continue;
      // Contratos encerrados não geram novas cobranças pelo calendário projetado.
      const residualOficial = !ativas && anterior && p.origem === "SERPRO";
      if (!ativas && !g && !pago && !residualOficial) continue;
      const enviado = g ? enviada(g) : false;
      const contabilizacaoPendente = pago && !contabilizado;
      const falhou = Boolean(p.pagamentoErro);
      const divergente = p.pagamentoStatus === "DIVERGENTE";
      const automatico = c.formaPagamento === "DEBITO_AUTOMATICO";
      const temPdf = Boolean(g?.pdfDisponivel || g?.pdfBytes?.length || g?.storageKey);
      const documentoConferido = g?.status === "PROCESSED" && temPdf && Boolean(dataCivil(g.vencimento))
        && Number(g.valor) > 0 && !g.extracted?.conferenciaDocumentoPendente;
      let estado = "CONFERIR_PARCELA", acao = "conferir_parcela", label = "Conferir parcela";
      if (pago) { estado = contabilizacaoPendente ? "CONTABILIZAR" : "RESOLVIDA"; acao = contabilizacaoPendente ? "contabilizar" : null; label = contabilizacaoPendente ? "Contabilizar pagamento" : "Pagamento confirmado"; }
      else if (divergente) { estado = "DIVERGENCIA"; acao = "conferir_divergencia"; label = "Conferir divergência"; }
      else if (falhou) { estado = "CONSULTA_FALHOU"; acao = "consultar_pagamento"; label = "Resolver consulta"; }
      else if (residualOficial || automatico || enviado) { estado = "CONSULTAR_PAGAMENTO"; acao = "consultar_pagamento"; label = "Conferir pagamento"; }
      else if (g && temPdf && !documentoConferido) { estado = "CONFERIR_DOCUMENTO"; acao = "conferir_documento"; label = "Conferir documento"; }
      else if (documentoConferido) { estado = "ENVIAR"; acao = "enviar"; label = "Enviar guia"; }
      else if (c.formaPagamento === "GUIA_MENSAL") { estado = "OBTER_GUIA"; acao = "obter_guia"; label = "Obter guia"; }
      // Data prevista indica necessidade de conferência, nunca atraso oficial.
      const atrasada = !pago && Boolean(g?.vencimento && vencimento < hoje);
      itens.push({ id: `parcela:${p.id}`, portalClientId: c.portalClientId, parcelamentoId: c.id,
        parcelaId: p.id, guideId: g?.id || null, tipo: c.tipo || c.kind, numeroParcelamento: c.numeroParcelamento,
        numeroParcela: p.numeroParcela, referencia: referencia || null, vencimento,
        vencimentoPrevisto: !g?.vencimento && Boolean(p.vencimento), valor: pago ? valor(p.valorEfetivoPago ?? p.valorPago ?? g?.extracted?.comprovante?.total) : valor(g?.valor ?? p.valorPrevisto),
        estado, acao, label, anterior, atrasada, enviada: enviado, pagamentoConfirmado: pago, contabilizacaoPendente,
        pagamentoConsultadoEm: p.pagamentoConsultadoEm, consultaErro: p.pagamentoErro || null,
        divergenciaMotivo: divergente ? p.pagamentoErro || "PAGAMENTO_DIVERGENTE" : null,
        valorPago: valor(p.valorEfetivoPago ?? p.valorPago ?? p.pagamentoEvidencia?.comprovante?.total ?? p.pagamentoEvidencia?.valorPago),
        documentoErro: g?.extracted?.parcelamentoFiscal?.leituraErro || null,
        formaPagamento: c.formaPagamento, contabilizado: Boolean(c.aberturaEntryId) });
    }
    // Contrato confirmado sem calendário/PDF não desaparece entre duas consultas.
    if (ativas && !possuiMes) {
      itens.push({ id: `contrato:${c.id}:${mesOperacional}`, portalClientId: c.portalClientId,
        parcelamentoId: c.id, parcelaId: null, guideId: null, tipo: c.tipo || c.kind,
        numeroParcelamento: c.numeroParcelamento, numeroParcela: null, referencia: mesOperacional,
        vencimento: null, valor: null, estado: "CONFERIR_PARCELA", acao: "conferir_parcela", label: "Conferir parcela do mês",
        anterior: false, atrasada: false, pagamentoConfirmado: false, contabilizacaoPendente: false,
        formaPagamento: c.formaPagamento,
        consultaEm: c.ultimaConsultaParcelasEm, consultaResultado: c.ultimaConsultaParcelasResultado });
    }
  }
  itens.sort((a, b) => Number(b.atrasada) - Number(a.atrasada) || Number(b.anterior) - Number(a.anterior)
    || String(a.vencimento || "9999").localeCompare(String(b.vencimento || "9999")) || a.id.localeCompare(b.id));
  return { mesOperacional, itens, resumo: { total: itens.length, pendentes: itens.filter(i => i.estado !== "RESOLVIDA").length,
    atrasadas: itens.filter(i => i.atrasada).length, anteriores: itens.filter(i => i.anterior && i.estado !== "RESOLVIDA").length,
    contabilizar: itens.filter(i => i.contabilizacaoPendente).length } };
}
