/** Um vínculo da Circular não transfere a propriedade da provisão ao contrato. */
export function origensLegadasDoContrato(lancamentos, contrato) {
  return lancamentos.filter(e => e.tipo === 'PROVISAO' && e.id !== contrato.aberturaEntryId
    && !String(e.subtipo || '').startsWith('PARC_')
    && !String(e.loteImportacao || '').startsWith('PARCV2-'));
}
export function exigirOrigensLegadasSeparadas(lancamentos, contrato) {
  const origens = origensLegadasDoContrato(lancamentos, contrato);
  if (origens.length) throw Object.assign(new Error('Este acordo contém provisões da Circular vinculadas pelo modelo antigo. Separe a composição antes de excluir ou rescindir; as provisões originais serão preservadas.'), {
    code:'ORIGENS_LEGADAS_PENDENTES', status:409, entryIds:origens.map(e=>e.id),
  });
}
