// Anexo II v1.01-20260122. HTTP e aceite de transporte não são fatos fiscais.
export function decidirConfirmacaoFiscalCancelamento(evidencia, contexto) {
  const desconhecido = { situacao: 'INCONCLUSIVO', cancelada: false };
  if (!evidencia || evidencia.integridadeVerificada !== true || evidencia.origemVerificada !== true) return desconhecido;
  if (!contexto?.companyId || evidencia.companyId !== contexto.companyId || evidencia.chaveAcesso !== contexto.chaveAcesso || evidencia.ambiente !== contexto.ambiente) return desconhecido;
  const tipo = String(evidencia.tipoEvento || '');
  const seq = String(evidencia.sequencia || '').padStart(3, '0');
  if (!/^\d{50}$/.test(contexto.chaveAcesso) || !/^\d{3}$/.test(seq) || Number(seq) !== 1) return desconhecido;
  if (evidencia.id !== `EVT${contexto.chaveAcesso}${tipo}${seq}` || evidencia.pedidoId !== `PRE${contexto.chaveAcesso}${tipo}`) return desconhecido;
  if (tipo === '101101' || tipo === '105104') return { situacao: 'CONFIRMADO', cancelada: true };
  if (tipo === '101103') return { situacao: 'PENDENTE', cancelada: false };
  if (tipo === '105105') return { situacao: 'INDEFERIDO', cancelada: false };
  return desconhecido;
}
