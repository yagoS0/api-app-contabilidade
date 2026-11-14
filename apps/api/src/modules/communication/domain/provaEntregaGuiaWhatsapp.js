const dataCivil = value => {
  const d = new Date(value || '');
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
};

export function possuiProvaEntregaGuiaWhatsapp(tentativas, guia, telefone, vinculoNumeroId, revisaoDocumentoGuia) {
  return guia.hash && tentativas.some(t => {
    const s = t.snapshot;
    // Histórico sem revisão integral continua consultável, mas não comprova a
    // composição atual para uma nova cobrança. Não completar prova por inferência.
    return s?.revisaoDocumento === revisaoDocumentoGuia(guia) && t.arquivoSha256 === guia.hash && s?.guideId === guia.id
      && s.portalClientId === guia.portalClientId && s.telefone === telefone
      && (!vinculoNumeroId || s.vinculoNumeroId === vinculoNumeroId)
      && s.competencia === guia.competencia
      && Number(s.valor) === Number(guia.valor)
      && dataCivil(s.vencimento) === dataCivil(guia.vencimento);
  });
}
