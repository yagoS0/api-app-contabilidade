export async function lerMarcosAgenda(api, leituras, dias, companyId) {
  const inicio = dias[0], fim = dias.at(-1);
  if (api.listMarcosFiscais) {
    const out = await leituras.ler('marcos', () => api.listMarcosFiscais());
    return (out.marcos || []).filter(m => {
      const data = String(m.data).slice(0, 10);
      return data >= inicio && data <= fim && (!companyId || !m.portalClientId || m.portalClientId === companyId);
    }).map(m => ({ ...m, tipo:'marco', companyId:m.portalClientId, doEscritorio:!m.portalClientId,
      data:String(m.data).slice(0,10), dataInicio:String(m.data).slice(0,10), dataFim:String(m.data).slice(0,10) }));
  }
  const meses = [...new Set(dias.map(d => d.slice(0,7)))];
  const calendarios = await Promise.all(meses.map(m => leituras.ler(`fiscal:${m}`, () => api.getCalendario(m, companyId))));
  return [...new Map(calendarios.flatMap(c => (c.dias || []).flatMap(d => d.itens.filter(i => i.tipo === 'marco').map(i => ({ ...i, dataInicio:i.dataInicio || d.data, dataFim:i.dataFim || d.data, data:d.data })))).map(i => [`${i.tipo}|${i.id}`,i])).values()];
}
