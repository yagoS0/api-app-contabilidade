import { completarDocumentosOperacao } from '../OperationsDocuments.js';
import { recuperarDocumentosPgdas } from '../../../modules/fiscal/publicPgdas.js';

function fixture() {
  let circular = { pgdasNumeroDeclaracao: 'externa-1', dasTotal: 60 };
  let guide = null;
  const db = { companyMonthlyCircular: { findUnique: jest.fn(async () => circular) },
    guide: { findFirst: jest.fn(async () => guide) }, apuracaoSnapshot: { findUnique: jest.fn(async () => null) } };
  return { db, extrato: () => { circular = { ...circular, pgdasDeclaracaoFileId: 'd', pgdasReciboFileId: 'r' }; },
    das: () => { guide = { pdfBytes: Buffer.from('%PDF-fixture') }; } };
}
const entrada = { portalClientId: 'p1', competencia: '2026-10', userId: 'contador', confirmCompetencia: '2026-10' };
test('DAS pendente não apaga extrato ou declaração externa', async () => {
  const f = fixture();
  const out = await completarDocumentosOperacao(f.db, entrada, { sync: async () => f.extrato(), capture: async () => { throw new Error('temporário'); } });
  expect(out.extrato.ok).toBe(true);
  expect(out.guia.skipped).toBe(true);
  expect((await f.db.companyMonthlyCircular.findUnique()).pgdasNumeroDeclaracao).toBe('externa-1');
});
test('extrato ausente e DAS disponível são estados independentes', async () => {
  const f = fixture();
  const out = await completarDocumentosOperacao(f.db, entrada, { sync: async () => {}, capture: async () => f.das() });
  expect(out.extrato.ok).toBe(false);
  expect(out.guia.ok).toBe(true);
});
test('recuperação repetida reutiliza documentos sem novas consultas', async () => {
  const f = fixture(); f.extrato(); f.das();
  const deps = { sync: jest.fn(), capture: jest.fn() };
  expect(await completarDocumentosOperacao(f.db, entrada, deps)).toMatchObject({ extrato: { ok: true }, guia: { ok: true } });
  expect(deps.sync).not.toHaveBeenCalled(); expect(deps.capture).not.toHaveBeenCalled();
});
test('comando documental exige confirmação e não possui porta de transmissão', async () => {
  const completar = jest.fn(async () => ({ extrato: { ok: false }, guia: { ok: true } }));
  await expect(recuperarDocumentosPgdas({ ...entrada, confirmCompetencia: '2026-09' }, { completar })).rejects.toMatchObject({ code: 'PGDAS_CONSULTA_NAO_CONFIRMADA' });
  expect(completar).not.toHaveBeenCalled();
  const portas = { autorizar: jest.fn(async () => {}), ler: jest.fn(async () => ({ company: { cnpj: '12345678000199' } })), consultarIndice: jest.fn(async () => ({ status: 200, dados: '', mensagens: [{ codigo: '[Aviso-PGDASD-MSG_ISN_027]' }] })) };
  expect(await recuperarDocumentosPgdas(entrada, portas)).toMatchObject({ ok: true, completos: false, partial: true });
});
