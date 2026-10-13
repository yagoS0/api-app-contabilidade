// A referência usa a mesma fotografia do cálculo recuperável validado pelo servidor.
// Sem esse envelope, mantém a referência atual; snapshot bruto/legado não prova recuperação.
export function baseTabelaAnexo(fechamento, snapshot) {
  const calculo = fechamento?.calculoRecuperavel;
  const formulario = calculo?.formulario;
  if (!calculo?.calculoId || !Array.isArray(formulario?.atividades) || !Array.isArray(formulario?.folhaMensal12)) {
    return { atividades: fechamento?.atividades, rbt12: fechamento?.rbt12, folha12m: snapshot?.folha12m };
  }
  const folha = formulario.folhaMensal12;
  const completa = folha.length > 0 && folha.every(item => item?.valor != null
    && String(item.valor).trim() !== '' && Number.isFinite(Number(item.valor)) && Number(item.valor) >= 0);
  return {
    atividades: formulario.atividades,
    rbt12: calculo.rbt12,
    folha12m: completa ? folha.reduce((total, item) => total + Number(item.valor), 0) : null,
  };
}
