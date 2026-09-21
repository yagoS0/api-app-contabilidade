// Os cards e seus detalhes usam a mesma classificação já adotada pelo fluxo.
export const CARDS_FLUXO = [
  { chave: 'entrada', rotulo: 'Entradas' },
  { chave: 'saidas', rotulo: 'Saídas', descricao: 'Despesas e impostos, sem folha' },
  { chave: 'folha', rotulo: 'Folha' },
  { chave: 'resultado', rotulo: 'Resultado', descricao: 'Entradas − saídas − folha' },
];

export function resumoMensal(mes, agregar) {
  const total = agregar(mes);
  const parcelas = [total.saida, total.impostos].filter(Boolean);
  const saidas = parcelas.length ? {
    valor: Math.round(parcelas.reduce((s, p) => s + Math.round(p.valor * 100), 0)) / 100,
    status: parcelas.every(p => p.status === 'confirmed') ? 'confirmed' : 'forecast',
  } : null;
  return { ...total, saidas };
}

export function linhasDoCard(mes, chave, agregar) {
  return (mes?.linhas || []).filter(l => {
    const total = agregar({ linhas: [l] });
    if (chave === 'resultado') return Boolean(total.resultado);
    if (chave === 'saidas') return Boolean(total.saida || total.impostos);
    return Boolean(total[chave]);
  });
}
