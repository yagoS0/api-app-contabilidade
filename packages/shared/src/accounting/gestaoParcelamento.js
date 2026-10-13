const mes = value => typeof value === 'string' ? value.slice(0, 7) : value?.toISOString?.().slice(0, 7);
export function quadroGestaoParcelamento(acordo, referencia) {
  const guias = new Map((acordo.guides || []).map(g => [g.id, g]));
  const parcelas = (acordo.parcelasContratadas || []).map(p => {
    const guia = guias.get(p.guiaId || p.guia?.id) || p.guia;
    const historica = p.origemBaixa === 'HISTORICO';
    const baixada = !historica && Boolean(p.origemBaixa || guia?.baixada);
    const confirmada = historica || baixada || p.pagamentoStatus === 'CONFIRMADO' || guia?.paymentStatus === 'PAID';
    const origem = guia?.paymentStatus === 'PAID' && guia?.paymentStatusSource === 'SERPRO' || p.pagamentoStatus === 'CONFIRMADO' && (p.origem === 'SERPRO' || p.pagamentoEvidencia?.resultado === 'CONFIRMADO')
      ? 'SERPRO' : guia?.clienteConfirmouEm ? 'Cliente' : confirmada ? historica ? 'Histórico' : 'Manual' : 'Não confirmado';
    const competencia = p.competencia || mes(p.vencimento);
    const vencimento = guia?.vencimento || p.vencimento;
    return {...p, guia, competencia, vencimento, historica, baixada, confirmada, origemConfirmacao: origem,
      doMes: mes(vencimento) === referencia,
      valorPago: baixada && p.valorBaixa!=null ? p.valorBaixa : p.valorPago ?? guia?.comprovante?.total ?? guia?.extracted?.comprovante?.total ?? null,
      contabilizacao: historica ? 'Histórico anterior' : baixada ? 'Baixada' : confirmada ? 'A lançar' : 'Não lançada'};
  }).sort((a,b) => (a.numeroParcela ?? Infinity) - (b.numeroParcela ?? Infinity));
  const inconsistencias = [];
  let anterior;
  for (const p of parcelas) {
    const atual = mes(p.vencimento);
    if (anterior && atual && atual < anterior.mes) inconsistencias.push(`Parcela ${p.numeroParcela}: vencimento anterior ao da parcela ${anterior.numero}.`);
    if (atual) anterior = {mes:atual, numero:p.numeroParcela};
    if (p.guia && p.guia.numeroParcela != null && p.guia.numeroParcela !== p.numeroParcela) inconsistencias.push(`Parcela ${p.numeroParcela}: numeração da guia divergente.`);
  }
  return {parcelas, inconsistencias, doMes:parcelas.filter(p=>p.doMes).map(p=>p.numeroParcela),
    confirmadas:parcelas.filter(p=>p.confirmada).length, baixadas:parcelas.filter(p=>p.baixada).length,
    historicas:parcelas.filter(p=>p.historica).length, aLancar:parcelas.filter(p=>p.confirmada&&!p.baixada&&!p.historica).length,
    aConferir:parcelas.filter(p=>!p.confirmada && mes(p.vencimento) && mes(p.vencimento)<=referencia).length};
}
