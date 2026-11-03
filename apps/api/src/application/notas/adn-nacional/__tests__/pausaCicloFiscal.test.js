jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('axios', () => ({ create: jest.fn() }));
import axios from 'axios';
import { fetchDfeNFSe } from '../AdnNacionalClient.js';
import { comAutomacaoCicloFiscal } from '../../../fiscal/automacaoCicloFiscalContext.js';
test('ADN automático pausado bloqueia antes do certificado e da rede', async () => {
  const db = { appSetting: { findUnique: jest.fn(async () => ({ value: { paused: true, version: 1, reason: 'Teste', actor: { id: 'u' }, changedAt: '2026-11-01T10:00:00Z', resumedAt: null } })) } };
  await expect(comAutomacaoCicloFiscal({ version: 0 }, () => fetchDfeNFSe({ cnpj: '123' }), db)).rejects.toMatchObject({ code: 'CICLO_FISCAL_PAUSADO' });
  expect(axios.create).not.toHaveBeenCalled();
});
test('ADN manual conserva validação própria sem ler política', async () => {
  await expect(fetchDfeNFSe({ cnpj: '123' })).rejects.toMatchObject({ code: 'INVALID_CNPJ' });
  expect(axios.create).not.toHaveBeenCalled();
});
