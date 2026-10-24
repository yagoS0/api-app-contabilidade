import { xmlNfeData, CHAVE_NFE, CNPJ_DATAS } from "../__fixtures__/dataEmissaoNotas.js";
import { reconciliarDatasNotas } from '../reconciliarDatasNotas.js';
import { camposDataEmissao, extrairDataEmissao } from '../dataEmissaoNota.js';
const xml = xmlNfeData();
const row = { id: 'n', clientId: 'a', chaveAcesso: CHAVE_NFE, emitenteDoc: CNPJ_DATAS, xmlRaw: xml, xmlResumo: null, issueDate: new Date('2026-09-27'), competencia: new Date('2026-08-01'), updatedAt: new Date('2026-10-01'), competenciaPosFechamento: true };
const db = data => ({ portalInvoice: { findMany: jest.fn(async () => data), updateMany: jest.fn(async () => ({ count: 1 })) } });
test('dry-run is default and exposes scope, hashes and differences without writing', async () => {
  const prisma = db([row]); const out = await reconciliarDatasNotas(prisma, { clientId: 'a', ids: ['n', 'other'] });
  expect(out).toMatchObject({ dryRun: true, contagens: { DIFERENCA: 1, NAO_ENCONTRADA_NO_ESCOPO: 1 } });
  expect(out.resultados.find(r => r.id === 'n').hash).toHaveLength(64);
  expect(prisma.portalInvoice.updateMany).not.toHaveBeenCalled();
  expect(prisma.portalInvoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'a', id: { in: ['n', 'other'] } } }));
});
test('write compares source/revision, preserves closing and is idempotent', async () => {
  const prisma = db([row]);
  await reconciliarDatasNotas(prisma, { clientId: 'a', ids: ['n'], aplicar: true, confirmarBancoDescartavel: true });
  const { where, data } = prisma.portalInvoice.updateMany.mock.calls[0][0];
  expect(where).toMatchObject({ clientId: 'a', id: 'n', xmlRaw: xml, updatedAt: row.updatedAt });
  expect(Object.keys(data).sort()).toEqual(['dataEmissaoCivil', 'dataEmissaoEvidencia', 'dataEmissaoInstante']);
  const again = db([{ ...row, ...data }]);
  expect((await reconciliarDatasNotas(again, { clientId: 'a', ids: ['n'], aplicar: true, confirmarBancoDescartavel: true })).contagens).toEqual({ SEM_ALTERACAO: 1 });
  expect(again.portalInvoice.updateMany).not.toHaveBeenCalled();
  prisma.portalInvoice.updateMany.mockResolvedValue({ count: 0 });
  expect((await reconciliarDatasNotas(prisma, { clientId: 'a', ids: ['n'], aplicar: true, confirmarBancoDescartavel: true })).contagens).toEqual({ FONTE_ALTERADA: 1 });
});
test('wrong company, wrong identity, absence of XML and stronger source are protected', async () => {
  await expect(reconciliarDatasNotas(db([row]), { clientId: 'b', ids: ['n'] })).rejects.toThrow('escopo');
  expect((await reconciliarDatasNotas(db([{ ...row, chaveAcesso: '2'.repeat(44) }]), { clientId: 'a', ids: ['n'] })).contagens).toEqual({ IDENTIDADE_DIVERGENTE: 1 });
  expect((await reconciliarDatasNotas(db([{ ...row, xmlRaw: null }]), { clientId: 'a', ids: ['n'] })).contagens).toEqual({ INDETERMINADA: 1 });
  const stronger = { ...row, ...camposDataEmissao(extrairDataEmissao(xml)), xmlRaw: null };
  expect((await reconciliarDatasNotas(db([stronger]), { clientId: 'a', ids: ['n'] })).contagens).toEqual({ FONTE_MAIS_FORTE_PRESERVADA: 1 });
});
