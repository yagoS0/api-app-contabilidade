// A versão do atributo XML não identifica sozinha uma revisão do pacote de esquemas.
export const CONTRATO_NACIONAL = Object.freeze({
  id: 'nfse-nacional-dps-1.01-20260727',
  versaoDps: '1.01',
  schemas: 'docs/leiaute-nfse/documentacao-tecnica/rtc-2026-10-05/xsd-20260727',
  publicacao: '2026-07-27',
  producaoPrevistaNoComunicado: '2026-08-10',
});

// Impede que um pedido de ajuste seja silenciosamente convertido em nota regular.
export function recursoAindaNaoSuportado(payload) {
  if (payload?.finNFSe != null && String(payload.finNFSe) !== '0') return 'finNFSe';
  for (const campo of ['gIBSCBSAjuste', 'gPgtoVinc', 'vAjusteBC', 'regApIBSCBSSN', 'cAtvSN', 'gTribSN', 'vReceitaBrutaSN']) {
    if (payload?.[campo] != null || payload?.servico?.[campo] != null) return campo;
  }
  return null;
}
