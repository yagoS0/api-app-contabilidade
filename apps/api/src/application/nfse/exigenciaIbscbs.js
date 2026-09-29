// Cronograma: CGNFS-e, orientação de 07/08/2026, Ato Conjunto 4/2026.
// A aceitação técnica sem o grupo em 2026 não dispensa sua informação.
export const FONTE_EXIGENCIA_IBSCBS = 'https://www.gov.br/nfse/pt-br/noticias/cgnfs-e-orienta-sobre-os-prazos-para%20destaque-de-ibs-cbs-nas-notas-fiscais-de-servico';
export function exigenciaIbscbs({ opSimpNac, dataReferencia, cTribNac, categoria }) {
  const data = String(dataReferencia ?? '').slice(0, 10);
  if (!opSimpNac || !data) return { obrigatorio: false, revisao: false };
  if (opSimpNac === '3') {
    // A opção efetivada não pode ser inferida de um perfil ou do simulador.
    return { obrigatorio: false, revisao: data >= '2027-01-01', motivo: 'Confirme a opção vigente do Simples para IBS/CBS antes de emitir nesta competência.' };
  }
  if (opSimpNac !== '1' || data < '2026-10-01') return { obrigatorio: false, revisao: false };
  if (data >= '2026-12-01') return { obrigatorio: true, revisao: false };
  const item = String(cTribNac ?? '').slice(0, 4);
  if (['0103', '0105', '0109', '1601'].includes(item) || ['PLATAFORMA', 'OUTROS'].includes(categoria)) return { obrigatorio: false, revisao: false };
  if (categoria === 'SERVICO_ISS') return { obrigatorio: true, revisao: false };
  return { obrigatorio: false, revisao: true, motivo: 'Confirme no perfil se o fornecimento é serviço sujeito ao ISS, operação de plataforma ou outra hipótese do cronograma IBS/CBS.' };
}
