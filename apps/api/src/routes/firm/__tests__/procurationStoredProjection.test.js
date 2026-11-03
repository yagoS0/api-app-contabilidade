jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../../../application/fiscal/serpro/SerproRuntimeSettings.js', () => ({ getSerproRuntimeSettings: jest.fn(), getResolvedSerproCredentials: jest.fn() }));
jest.mock('../../../application/fiscal/serpro/SerproHttpClient.js', () => ({ SerproHttpClient: jest.fn() }));
import { getStoredProcurationProjection, projetarProcuracaoSalva } from '../../../application/fiscal/serpro/SerproProcurationService.js';
import { SerproHttpClient } from '../../../application/fiscal/serpro/SerproHttpClient.js';

const evidence = { status: 'ATIVA', cnpj: '11222333000181', procuradorCnpj: '12345678000199', systems: ['SITFIS'], validUntil: '2099-12-31' };
function fixture(company = { id: 'a', cnpj: evidence.cnpj }, saved = evidence) {
  const attempt = { ...evidence, status: 'ERRO', iniciadaEm: '2026-11-03T10:00:00Z', codigo: 'FALHA_VERIFICACAO' };
  const db = { portalClient: { findUnique: jest.fn(async () => company) }, appSetting: { findUnique: jest.fn(async ({ where }) => ({ value: where.key.includes('attempt:') ? attempt : saved })), upsert: jest.fn() } };
  const settings = jest.fn(async () => ({ certificate: { document: evidence.procuradorCnpj } }));
  return { db, settings, attempt };
}
test('detalhe e carteira compartilham projeção contextual sem gravação ou cliente fiscal', async () => {
  const f = fixture(); const result = await getStoredProcurationProjection('a', f.db, f.settings);
  expect(result).toMatchObject({ companyId: 'a', status: 'ATIVA', vinculoConfirmado: true, ...projetarProcuracaoSalva(evidence, f.attempt, evidence) });
  expect(f.db.portalClient.findUnique).toHaveBeenCalledWith({ where: { id: 'a' }, select: { id: true, cnpj: true } });
  expect(f.db.appSetting.upsert).not.toHaveBeenCalled(); expect(SerproHttpClient).not.toHaveBeenCalled();
});
test.each([undefined, '', '99999999000100'])('CNPJ ausente/divergente não confirma vínculo: %s', async cnpj => {
  const f = fixture({ id: 'a', cnpj }); expect((await getStoredProcurationProjection('a', f.db, f.settings)).vinculoConfirmado).toBe(false);
});
test.each([undefined, '', '99999999000100'])('procurador ausente/divergente não confirma vínculo: %s', async document => {
  const f = fixture(); expect((await getStoredProcurationProjection('a', f.db, async () => ({ certificate: { document } }))).vinculoConfirmado).toBe(false);
});
test.each([null, { id: 'outra', cnpj: evidence.cnpj }])('recusa identidade empresarial indisponível', async company => {
  const f = fixture(company); await expect(getStoredProcurationProjection('a', f.db, f.settings)).rejects.toThrow('company_identity_unavailable');
});
test('falha de leitura permanece erro', async () => {
  const f = fixture(); f.db.appSetting.findUnique.mockRejectedValue(Error('indisponível'));
  await expect(getStoredProcurationProjection('a', f.db, f.settings)).rejects.toThrow('indisponível');
});

test('sem evidência salva mantém desconhecida e sem vínculo', async () => {
 const f = fixture(undefined, {});const result=await getStoredProcurationProjection('a',f.db,f.settings);
 expect(result).toMatchObject({status:'DESCONHECIDA',vinculoConfirmado:false,systems:[]});expect(f.db.appSetting.upsert).not.toHaveBeenCalled();
});
