import { persistirDocumentoDas } from '../persistirDocumentoDas.js';
function fixture(numeroDeclaracao) {
  const mapped = { parsed: { competencia: '2026-10', tipo: 'SIMPLES', valor: 100 }, pdfBuffer: Buffer.from('%PDF-1.4'), numeroDocumento: 'das', rawPayload: { dados: 'fixture' }, ...(numeroDeclaracao ? { pgdasNumeroDeclaracao: numeroDeclaracao } : {}) };
  const entrada = { mapped, portalClient: { id: 'p', cnpj: '12345678000199' }, sourceFileId: 'source', labels: { sourcePath: 'SERPRO', checkResult: 'FOUND' }, normalizedCompetencia: '2026-10', resolvedServiceId: 'GERARDAS12', procuradorCnpj: '99999999000199' };
  const portas = { lerGuiaPorSourceFileId: jest.fn(async () => ({ id: 'g', paymentStatus: 'PAID', paymentStatusSource: 'MANUAL', paymentConfirmedAt: new Date('2026-11-01') })), createOrUpdateGuideFromProcessing: jest.fn(async input => ({ id: 'g', ...input })), hashPdf: () => 'hash', clock: () => new Date('2026-11-18') };
  return { entrada, portas };
}
test('vínculo estrito persiste em extracted sem mudar identidade, PDF ou pagamento', async () => {
  const { entrada, portas } = fixture('decl'); const result = await persistirDocumentoDas(entrada, portas);
  expect(result.guide.extracted.pgdasNumeroDeclaracao).toBe('decl');
  expect(result.guide.paymentStatus).toBe('PAID'); expect(result.guide.paymentStatusSource).toBe('MANUAL');
  expect(result.guide.pdfBytes).toBe(entrada.mapped.pdfBuffer); expect(result.guide.sourceFileId).toBe('source');
});
test('sem vínculo estrito, DTO legado do funil é idêntico salvo campo aditivo ausente', async () => {
  const legado = fixture(); const strict = fixture('decl');
  await persistirDocumentoDas(legado.entrada, legado.portas); await persistirDocumentoDas(strict.entrada, strict.portas);
  const antigo = legado.portas.createOrUpdateGuideFromProcessing.mock.calls[0][0];
  const novo = strict.portas.createOrUpdateGuideFromProcessing.mock.calls[0][0];
  expect(antigo.extracted).not.toHaveProperty('pgdasNumeroDeclaracao');
  delete novo.extracted.pgdasNumeroDeclaracao; expect(novo).toEqual(antigo);
});
