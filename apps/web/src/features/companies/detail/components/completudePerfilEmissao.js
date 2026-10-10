export function completudePerfilEmissao(perfil) {
  const campos = [['codigoServicoNacional', 'serviço nacional'], ['codigoServicoMunicipal', 'complemento municipal'],
    ['codigoNbs', 'NBS'], ['categoriaObrigacaoIbscbs', 'categoria de IBS/CBS'], ['ibscbsCIndOp', 'operação IBS/CBS'],
    ['ibscbsCst', 'CST'], ['ibscbsCClassTrib', 'classificação tributária']];
  const faltantes = campos.filter(([id]) => perfil?.[id] == null || String(perfil[id]).trim() === '').map(([, nome]) => nome);
  return faltantes.length ? `Campos não configurados: ${faltantes.join(', ')}.` : 'Campos de classificação preenchidos; confira a aplicação por competência e operação.';
}
