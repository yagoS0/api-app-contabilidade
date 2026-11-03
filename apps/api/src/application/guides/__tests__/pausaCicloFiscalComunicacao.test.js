jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { avisarPagamentoNaoConfirmado } from '../AvisoPagamentoService.js';
test('aviso automático pausado não lê guias, cria token ou transporta', async () => {
  const db = { appSetting: { findUnique: jest.fn(async () => ({ value: { paused: true, version: 1, reason: 'Teste', actor: { id: 'u' }, changedAt: '2026-11-01T10:00:00Z', resumedAt: null } })), create: jest.fn() }, feriado: { findMany: jest.fn() } };
  const transporte = { whatsapp: jest.fn(), destinatarios: jest.fn() };
  await expect(avisarPagamentoNaoConfirmado({ guideId: 'g', scheduledAt: '2026-11-01T11:00:00Z' }, { db, transporte })).rejects.toMatchObject({ code: 'CICLO_FISCAL_PAUSADO' });
  expect(transporte.whatsapp).not.toHaveBeenCalled(); expect(db.appSetting.create).not.toHaveBeenCalled(); expect(db.feriado.findMany).not.toHaveBeenCalled();
});
test('consulta manual não inventa aviso nem depende da pausa', async () => {
  const db = { appSetting: { findUnique: jest.fn(() => { throw new Error('offline'); }) } };
  expect(await avisarPagamentoNaoConfirmado({ guideId: 'g' }, { db })).toEqual({ status: 'IGNORADO', motivo: 'CONSULTA_MANUAL' });
  expect(db.appSetting.findUnique).not.toHaveBeenCalled();
});
