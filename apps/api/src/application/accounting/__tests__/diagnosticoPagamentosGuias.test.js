import { diagnosticarPagamentosGuias } from '../diagnosticoPagamentosGuias.js';
it('diagnóstico preserva documento, mostra baixa e bloqueios sem escrever', async () => {
  const client = {
    guide: { findMany: jest.fn(async () => [{ id: 'g', competencia: '2026-06', tipo: 'INSS', valor: 1100, valorOriginal: 1100 }]) },
    accountingEntry: { findMany: jest.fn(async () => [{ id: 'b', portalClientId: 'a', sourceGuideId: 'g', tipo: 'BAIXA',
      tipoLinha: 'PRINCIPAL', competencia: '2026-07', data: '2026-07-20', status: 'EXPORTADO', lines: [{ tipo: 'D', valor: 1000 }, { tipo: 'C', valor: 1000 }] }]) },
    companyMonthlyCircular: { findMany: jest.fn(async () => [{ competencia: '2026-07', fechadoContabilEm: new Date() }]) },
  };
  expect(await diagnosticarPagamentosGuias({ portalClientId: 'a', competencia: '2026-06', client })).toEqual([
    expect.objectContaining({ valorDocumento: 1100, pagamento: expect.objectContaining({ total: 1000 }), documentoDivergente: true,
      requerConferencia: false, competenciaFechada: true, possuiExportado: true }),
  ]);
  expect(client.guide.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { portalClientId: 'a', paymentStatus: 'PAID', competencia: '2026-06' } }));
});
it('recusa diagnóstico sem empresa ou competência inválida antes de acessar banco', async () => {
  await expect(diagnosticarPagamentosGuias({ client: {} })).rejects.toThrow('empresa');
  await expect(diagnosticarPagamentosGuias({ portalClientId: 'a', competencia: '2026-13', client: {} })).rejects.toThrow('Competência');
});
