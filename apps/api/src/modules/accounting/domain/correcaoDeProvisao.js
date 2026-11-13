function emCentavos(valor) {
  return Math.round(Number(valor) * 100);
}

function permiteAlterarProvisao(lancamento, companyId) {
  return lancamento.portalClientId === companyId
    && lancamento.status === "RASCUNHO"
    && lancamento.tipo === "PROVISAO"
    && lancamento.statusPagamento !== "PAGO"
    && lancamento.baixas.length === 0
    && !lancamento.parcelamentoId
    && !lancamento.circularId
    && !lancamento.openEntryId
    && !lancamento.estornoDeEntryId;
}

function partidasCorrespondemAGuia(linhas, valorAtual, novoValor) {
  if (linhas.length !== 2) return false;
  const debito = linhas.find(linha => linha.tipo === "D");
  const credito = linhas.find(linha => linha.tipo === "C");
  if (!debito || !credito) return false;

  const valorEmCentavos = emCentavos(debito.valor);
  return valorEmCentavos === emCentavos(credito.valor)
    && (valorEmCentavos === emCentavos(valorAtual) || valorEmCentavos === emCentavos(novoValor));
}

export function motivoImpedimentoDaProvisao(entradas, companyId, valorAtual, novoValor) {
  if (entradas.length > 1) {
    return { code: "provisao_composta", message: "Há mais de um lançamento vinculado. Revise a composição antes de corrigir." };
  }
  if (entradas.length === 0) return null;

  const [lancamento] = entradas;
  if (!permiteAlterarProvisao(lancamento, companyId)) {
    return { code: "provisao_nao_editavel", message: "O lançamento vinculado exige revisão contábil antes da correção." };
  }
  if (!partidasCorrespondemAGuia(lancamento.lines, valorAtual, novoValor)) {
    return { code: "provisao_divergente", message: "Os valores do lançamento não correspondem à guia. Revise o lançamento." };
  }
  return null;
}

export function motivoImpedimentoPorFechamento(competenciasFechadas) {
  if (competenciasFechadas.size) {
    return { code: "competencia_fechada", message: "A competência está fechada e não permite esta correção." };
  }
  return null;
}
