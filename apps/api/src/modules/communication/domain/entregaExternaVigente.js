export function avaliarEntregaExternaVigente(envio, guia, { documentoValido, revisaoEntrega }) {
  const prova = envio?.historicoTentativas?.find(t => t.id === envio.tentativaAtualId)?.snapshot;
  return envio?.canal === 'EXTERNO' && envio.status === 'declarado_externo' && documentoValido(guia) && prova?.atorId && prova?.registradoEm
    && prova.guideId === guia.id && prova.companyId === guia.portalClientId && prova.revisaoDocumento === revisaoEntrega(guia) ? prova : null;
}
