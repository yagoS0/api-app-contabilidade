import { conferirEnvioParcelaMock } from "./guiaParcelaEnvioMock";
const copy = (v) => JSON.parse(JSON.stringify(v));
const stores = new Map();
function mesAtual() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function mesAnterior(mes, n) { const d = new Date(`${mes}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); }
function estado(companyId, empresas) {
  if (!stores.has(companyId)) {
    const empresa = empresas.find(c => c.companyId === companyId);
    const qtd = empresa?.parcelamentoDemoAtrasos || 0;
    stores.set(companyId, { contratos: [], parcelas: [], indicacoes: qtd ? [{ id: `indicacao-${companyId}`, status: "PENDENTE", modalidade: "PARCSN", numeroParcelamento: null, parcelasEmAtraso: qtd, origem: "SITFIS", evidenciaEm: new Date().toISOString(), descricao: `Simulação: Simples Nacional em parcelamento; ${qtd} parcelas em atraso.`, parcelamentoId: null }] : [], ultimoResultado: null });
  }
  return stores.get(companyId);
}

export function criarMockAcompanhamentoParcelamentos({ empresas = [], guias = new Map() } = {}) {
  const state = id => estado(id, empresas);
  const contrato = (id, contratoId) => {
    const c = state(id).contratos.find(c => c.id === contratoId);
    if (!c) throw new Error("Parcelamento não encontrado nesta empresa.");
    return c;
  };
  function snapshot(id) {
    const s = state(id), mes = mesAtual();
    const itens = s.indicacoes.filter(i => i.status === "PENDENTE").map(i => ({ id: `indicacao:${i.id}`, indicacaoId: i.id, portalClientId: id, tipo: i.modalidade, estado: "IDENTIFICAR", acao: "identificar", label: "Identificar parcelamento indicado no relatório", atrasada: Number(i.parcelasEmAtraso) > 0, anterior: false, pagamentoConfirmado: false }));
    for (const c of s.contratos) {
      const parcelas = s.parcelas.filter(p => p.parcelamentoId === c.id);
      if (!parcelas.length && c.status === "ATIVO") itens.push({ id: `contrato:${c.id}`, portalClientId: id, parcelamentoId: c.id, tipo: c.tipo, numeroParcelamento: c.numeroParcelamento, estado: "CONFERIR_PARCELA", acao: "conferir_parcela", label: "Conferir as parcelas deste acordo", anterior: false, atrasada: false });
      for (const p of parcelas) {
        const g = (guias.get(id) || []).find(g => g.id === p.guideId);
        if (g?.paymentStatus === "PAID") p.pagamentoConfirmado = true;
        const enviada = g?.emailStatus === "SENT";
        const pago = Boolean(p.pagamentoConfirmado);
        const status = p.contabilizada || g?.baixada ? "RESOLVIDA" : p.divergencia ? "DIVERGENCIA" : pago ? "CONTABILIZAR" : c.formaPagamento === "DEBITO_AUTOMATICO" ? "CONSULTAR_PAGAMENTO" : !g ? "OBTER_GUIA" : p.documentoPendente ? "CONFERIR_DOCUMENTO" : enviada ? "CONSULTAR_PAGAMENTO" : "ENVIAR";
        itens.push({ ...p, id: `parcela:${p.id}`, parcelaId: p.id, portalClientId: id, tipo: c.tipo, formaPagamento: c.formaPagamento, enviada, numeroParcelamento: c.numeroParcelamento, estado: status, acao: status.toLowerCase(), label: p.divergencia ? "Pagamento parcial: conferir valores" : pago ? "Pagamento confirmado, sem lançamento automático" : status === "ENVIAR" ? "Guia disponível para envio" : "Parcela em acompanhamento", anterior: p.referencia < mes, atrasada: !pago && Boolean(p.vencimento) && p.vencimento.slice(0, 10) < new Date().toISOString().slice(0, 10), pagamentoConfirmado: pago, contabilizacaoPendente: pago && status !== "RESOLVIDA" });
      }
    }
    return { ok: true, mesOperacional: mes, indicacoes: copy(s.indicacoes), contratos: copy(s.contratos), itens: copy(itens), resumo: { total: itens.length, pendentes: itens.filter(i => i.estado !== "RESOLVIDA").length, atrasadas: itens.filter(i => i.atrasada).length, anteriores: itens.filter(i => i.anterior).length, contabilizar: itens.filter(i => i.contabilizacaoPendente).length } };
  }
  function criar(id, body) {
    const numero = String(body.numeroParcelamento || "").trim();
    if (!numero) throw new Error("Informe o número do parcelamento.");
    const s = state(id);
    const existing = s.contratos.find(c => c.tipo === body.tipo && c.numeroParcelamento === numero);
    if (existing) return existing;
    const c = { id: `acomp-${id}-${body.tipo}-${numero}`, portalClientId: id, tipo: body.tipo, numeroParcelamento: numero, label: body.label || "Acordo acompanhado", formaPagamento: body.formaPagamento || null, status: "ATIVO", fiscalSituacao: "NAO_CONFERIDO", fiscalConfirmadoEm: null, ultimaConsultaParcelasEm: null, ultimaConsultaParcelasResultado: null, aberturaEntryId: null, totalValue: null, principalTotal: null, numParcelas: null, principalPerParcela: null, competenciaInicial: null };
    s.contratos.push(c); return c;
  }
  return {
    registrarGuiaAvulsaParcelamento(id, guide, metadata) {
      const s = state(id);
      const indicacao = metadata.indicacaoId ? s.indicacoes.find(i => i.id === metadata.indicacaoId) : null;
      if (metadata.indicacaoId && !indicacao) throw new Error("Indicação não encontrada nesta empresa.");
      const c = { id: `avulso-${guide.id}`, portalClientId: id, tipo: metadata.parcelamentoTipo, numeroParcelamento: null,
        origem: "GUIA_AVULSA", status: "ATIVO", fiscalSituacao: "GUIA_AVULSA", aberturaEntryId: null, numParcelas: null, totalValue: null, principalPerParcela: null, competenciaInicial: null, formaPagamento: null };
      s.contratos.push(c);
      Object.assign(guide, { parcelamentoId: c.id, parcelamentoTipo: c.tipo, parcelamentoAvulso: true,
        numeroParcela: metadata.numeroParcela == null ? null : Number(metadata.numeroParcela), anoMesParcela: guide.competencia,
        extracted: { ...guide.extracted, indicacaoId: indicacao?.id || null, conferenciaDocumentoPendente: !(Number(guide.valor) > 0 && guide.vencimento) } });
      s.parcelas.push({ id: `parcela-${guide.id}`, parcelamentoId: c.id, guideId: guide.id, numeroParcela: guide.numeroParcela,
        referencia: guide.competencia, vencimento: guide.vencimento, valor: guide.valor, documentoPendente: guide.extracted.conferenciaDocumentoPendente, pagamentoConfirmado: false });
      return guide;
    },
    vincularGuiaAvulsaParcelamento(id, guide, destino, numeroParcela) {
      const s = state(id), old = guide.parcelamentoId;
      const p = s.parcelas.find(p => p.guideId === guide.id);
      let c = s.contratos.find(c => c.id === destino.id);
      if (!c) { c = { ...destino, portalClientId: id }; s.contratos.push(c); }
      if (p) { p.parcelamentoId = destino.id; p.numeroParcela = numeroParcela; }
      Object.assign(guide, { parcelamentoId: destino.id, parcelamentoAvulso: false, parcelamentoTipo: destino.tipo, parcelamentoNumero: destino.numeroParcelamento, numeroParcela });
      if (old !== destino.id && !s.parcelas.some(p => p.parcelamentoId === old)) s.contratos = s.contratos.filter(c => c.id !== old || c.origem !== "GUIA_AVULSA");
      return guide;
    },
    conferirEnvioGuiaAcompanhamento(id, guideId) {
      const s = state(id), g = (guias.get(id) || []).find(g => g.id === guideId);
      if (!g) return;
      const p = s.parcelas.find(p => p.guideId === guideId);
      const c = s.contratos.find(c => c.id === g.parcelamentoId);
      conferirEnvioParcelaMock({ ...g, parcelamento: c || g.parcelamento, parcela: p ? { pagamentoStatus: p.pagamentoConfirmado ? "CONFIRMADO" : null, baixadaEm: p.contabilizada ? true : null } : g.parcela,
        extracted: { ...g.extracted, conferenciaDocumentoPendente: Boolean(p?.documentoPendente || g.extracted?.conferenciaDocumentoPendente) } });
    },
    async getAcompanhamentoParcelamentos(id) { return snapshot(id); },
    async reprocessarIndiciosParcelamento(id) { return { ...snapshot(id), message: "Relatório salvo conferido. Nenhum lançamento foi criado." }; },
    async criarAcompanhamentoParcelamento(id, body) { return { ok: true, contrato: copy(criar(id, body)) }; },
    async editarAcompanhamentoParcelamento(id, contratoId, body) {
      const c = contrato(id, contratoId);
      if (![null, "GUIA_MENSAL", "DEBITO_AUTOMATICO"].includes(body.formaPagamento)) throw new Error("Forma de pagamento inválida.");
      c.formaPagamento = body.formaPagamento;
      if (body.label != null) c.label = body.label;
      return { ok: true, contrato: copy(c) };
    },
    async localizarParcelamentos(id, { modalidades = ["PARCSN", "PARCMEI"] } = {}) {
      const s = state(id);
      if (s.cenario === "erro") throw new Error("Não foi possível consultar a Receita. Verifique a procuração e tente novamente.");
      const pendentes = s.indicacoes.filter(i => i.status === "PENDENTE");
      for (const tipo of modalidades) {
        if (tipo === "PARCMEI" && s.indicacoes.length) continue;
        const c = criar(id, { tipo, numeroParcelamento: tipo === "PARCSN" ? "990001" : "990002", formaPagamento: "GUIA_MENSAL" });
        c.fiscalSituacao = "ATIVO"; c.fiscalConfirmadoEm = new Date().toISOString();
        // Número desconhecido no SITFIS requer vínculo deliberado após conferir o acordo.
      }
      return { ...snapshot(id), message: "Acordos localizados. O acompanhamento não criou provisões contábeis." };
    },
    async resolverIndicacaoParcelamento(id, indicacaoId, body) {
      const s = state(id), i = s.indicacoes.find(i => i.id === indicacaoId);
      if (!i) throw new Error("Indicação não encontrada nesta empresa.");
      if (String(body.motivo || "").trim().length < 5) throw new Error("Informe o motivo da conferência.");
      if (!["VINCULADO", "DESCARTADO"].includes(body.status)) throw new Error("Resultado de conferência inválido.");
      if (body.status === "VINCULADO") contrato(id, body.parcelamentoId);
      Object.assign(i, { status: body.status, motivo: body.motivo, parcelamentoId: body.parcelamentoId || null, resolvidaEm: new Date().toISOString() });
      return { ok: true };
    },
    async capturarContratoParcelamento(id, contratoId) {
      const s = state(id), c = contrato(id, contratoId);
      if (!["PARCSN", "PARCMEI"].includes(c.tipo)) throw new Error("Esta modalidade requer acompanhamento manual.");
      if (s.cenario === "erro") { c.ultimaConsultaParcelasResultado = "ERROR"; throw new Error("A consulta de parcelas falhou. Os documentos anteriores foram preservados."); }
      c.fiscalSituacao = "ATIVO"; c.fiscalConfirmadoEm ||= new Date().toISOString();
      const atraso = s.indicacoes.find(i => i.parcelamentoId === c.id)?.parcelasEmAtraso || 1;
      const retorno = [];
      for (let n = 0; n <= atraso; n += 1) {
        const ref = mesAnterior(mesAtual(), n);
        let p = s.parcelas.find(p => p.parcelamentoId === c.id && p.referencia === ref);
        if (!p) { p = { id: `${c.id}-${ref}`, parcelamentoId: c.id, numeroParcela: atraso + 1 - n, referencia: ref, vencimento: `${ref}-20T00:00:00.000Z`, vencimentoPrevisto: false, valor: 620, guideId: null, pagamentoConfirmado: false }; s.parcelas.push(p); }
        if (!p.guideId && c.formaPagamento !== "DEBITO_AUTOMATICO") {
          p.guideId = `guia-${p.id}`;
          const g = { id: p.guideId, portalClientId: id, tipo: "SIMPLES", competencia: ref, anoMesParcela: ref, numeroParcela: p.numeroParcela, valor: p.valor, vencimento: p.vencimento, parcelamentoId: c.id, parcelamentoTipo: c.tipo, parcelamentoNumero: c.numeroParcelamento, numeroDocumento: `MOCK-${ref.replace("-", "")}`, status: "PROCESSED", source: "SERPRO", paymentStatus: "OPEN", emailStatus: "PENDING", fileName: `Parcela-${ref}.pdf`, hasPdf: true };
          guias.set(id, [...(guias.get(id) || []), g]);
        }
        if (s.cenario === "documento") {
          p.documentoPendente = true;
          const documento = (guias.get(id) || []).find(g => g.id === p.guideId);
          if (documento) documento.extracted = { ...documento.extracted, conferenciaDocumentoPendente: true };
        }
        retorno.push({ anoMes: ref, guideId: p.guideId, status: "ok" });
      }
      c.ultimaConsultaParcelasEm = new Date().toISOString(); c.ultimaConsultaParcelasResultado = "OK";
      return { ok: true, parcelas: retorno };
    },
    async consultarPagamentoParcela(id, parcelaId) {
      const s = state(id), p = s.parcelas.find(p => p.id === parcelaId);
      if (!p) throw new Error("Parcela não encontrada nesta empresa.");
      if (p.pagamentoConfirmado || p.contabilizada || (guias.get(id) || []).some(g => g.id === p.guideId && (g.paymentStatus === "PAID" || g.baixada))) return { ok: true, pago: true, skipped: "already_paid" };
      if (s.cenario === "erro") throw new Error("Pagamento não consultado: serviço indisponível.");
      if (s.cenario === "nao_localizado") return { ok: true, status: "NAO_LOCALIZADO", message: "Pagamento ainda não localizado. O acompanhamento continua ativo." };
      if (s.cenario === "parcial") { p.divergencia = true; return { ok: true, status: "DIVERGENTE", message: "Pagamento parcial encontrado. Confira a composição antes da baixa." }; }
      p.pagamentoConfirmado = true;
      p.divergencia = false;
      p.valorPago ??= p.valor;
      p.dataPagamento ||= p.vencimento;
      const g = (guias.get(id) || []).find(g => g.id === p.guideId);
      if (g) { g.paymentStatus = "PAID"; g.paymentValue ??= p.valorPago; g.paymentConfirmedAt ||= p.dataPagamento; }
      return { ok: true, status: "CONFIRMADO", message: "Pagamento confirmado. Nenhum lançamento contábil foi criado." };
    },
    async getDocumentoParcela(id, parcelaId) {
      const p = state(id).parcelas.find(p => p.id === parcelaId);
      if (!p?.guideId) throw new Error("Documento não encontrado nesta empresa.");
      const c = contrato(id, p.parcelamentoId);
      return { documento: { guideId: p.guideId, cnpj: empresas.find(c => c.companyId === id)?.cnpj || "00000000000100", numeroParcelamento: c.numeroParcelamento, anoMesParcela: p.referencia.replace("-", ""), valor: p.valor, vencimento: p.vencimento, hash: `mock-hash-${p.guideId}`, pdfUrl: null } };
    },
    async conferirDocumentoParcela(id, parcelaId, body) {
      const { documento } = await this.getDocumentoParcela(id, parcelaId);
      if (!body.confirmado || body.hash !== documento.hash || body.numeroParcelamento !== documento.numeroParcelamento || body.anoMesParcela !== documento.anoMesParcela) throw new Error("O documento não corresponde à parcela. Confira os identificadores.");
      const p = state(id).parcelas.find(p => p.id === parcelaId);
      p.documentoPendente = false; p.valor = body.valor; p.vencimento = body.vencimento;
      const g = (guias.get(id) || []).find(g => g.id === p.guideId);
      if (g) { g.valor = body.valor; g.vencimento = body.vencimento; g.extracted = { ...g.extracted, conferenciaDocumentoPendente: false }; }
      return { ok: true };
    },
    // Controle explícito de demonstração, disponível somente no adaptador mock.
    async definirCenarioAcompanhamento(id, cenario) { state(id).cenario = cenario; return { ok: true }; },
    snapshotAcompanhamentoParcelamentos: snapshot,
    vincularContabilizacaoAcompanhamento(id, novo) {
      const c = state(id).contratos.find(c => c.tipo === novo.tipo && c.numeroParcelamento === novo.numeroParcelamento);
      if (!c) return novo;
      const fiscal = state(id).parcelas.filter(p => p.parcelamentoId === c.id);
      novo.id = c.id;
      novo.aberturaEntryId = `abertura-${c.id}`;
      novo.fiscalSituacao = c.fiscalSituacao;
      novo.guides = (guias.get(id) || []).filter(g => g.parcelamentoId === c.id);
      novo.parcelasContratadas = novo.parcelasContratadas.map(p => {
        const origem = fiscal.find(f => f.referencia === p.vencimento?.slice(0, 7));
        if (!origem) return p;
        return { ...p, id: origem.id, guia: origem.guideId ? { id: origem.guideId } : null, pagamentoConfirmado: origem.pagamentoConfirmado, pagamentoEm: origem.dataPagamento, valorPago: origem.valorPago, valorPrevisto: origem.valor, comprovante: origem.pagamentoConfirmado ? { principal: origem.valorPago, juros: 0, multa: 0, total: origem.valorPago, dataArrecadacao: origem.dataPagamento } : null };
      });
      Object.assign(c, { aberturaEntryId: novo.aberturaEntryId, numParcelas: novo.numParcelas, principalTotal: novo.principalTotal, totalValue: novo.totalValue });
      return novo;
    },
    registrarBaixaAcompanhamento(id, parcelaId) {
      const p = state(id).parcelas.find(p => p.id === parcelaId);
      if (p) p.contabilizada = true;
    },
    complianceAcompanhamentoParcelamentos(id, original) {
      const out = snapshot(id);
      if (!out.itens.length) return original;
      const pendentes = out.itens.filter(i => i.estado !== "RESOLVIDA");
      const faltante = out.itens.some(i => !i.pagamentoConfirmado && !i.guideId && i.formaPagamento !== "DEBITO_AUTOMATICO");
      const tratadas = out.itens.every(i => i.pagamentoConfirmado || i.enviada || i.formaPagamento === "DEBITO_AUTOMATICO");
      return { ...original, hasPendenciasParcelamento: pendentes.length > 0, parcDas: { required: true, ok: !faltante, state: faltante ? "missing" : tratadas ? "enviada" : "gerada", itens: out.itens, quantidade: out.itens.length, pendencias: pendentes.length, atrasadas: out.resumo.atrasadas, atrasada: out.resumo.atrasadas > 0, pendenciaOperacional: pendentes.length > 0 }, ok: original.ok && !pendentes.length };
    },
  };
}
