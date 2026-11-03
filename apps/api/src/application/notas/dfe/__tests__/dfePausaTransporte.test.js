jest.mock('axios', () => ({ post: jest.fn(async () => ({ status: 200, data: '<xml/>' })) }));
jest.mock('../../pfxToTls.js', () => ({ extractTlsMaterialFromPfx: () => ({ cert: 'ficticio', key: 'ficticia' }) }));
jest.mock('../../../fiscal/automacaoCicloFiscalContext.js', () => ({ conferirContribuinteCicloFiscal: jest.fn() }));
import axios from 'axios';
import { conferirContribuinteCicloFiscal } from '../../../fiscal/automacaoCicloFiscalContext.js';
import { fetchDistNSU } from '../DfeClient.js';
const args = { cnpj: '11222333000181', ultNSU: 0, pfxBuffer: Buffer.from('ficticio'), password: 'ficticia' };
beforeEach(() => jest.clearAllMocks());
test.each(['CICLO_FISCAL_PAUSADO', 'AUTOMACAO_EMPRESA_PAUSADA', 'AUTOMACAO_EMPRESA_IDENTIDADE_INVALIDA'])('recusa %s preservada antes da saída HTTP', async code => {
  conferirContribuinteCicloFiscal.mockRejectedValueOnce(Object.assign(new Error('Bloqueado'), { code }));
  await expect(fetchDistNSU(args)).rejects.toMatchObject({ code });
  expect(axios.post).not.toHaveBeenCalled();
});
test('contexto apto mantém transporte de distribuição e identifica contribuinte', async () => {
  conferirContribuinteCicloFiscal.mockResolvedValueOnce(undefined);
  expect(await fetchDistNSU(args)).toEqual({ status: 200, xml: '<xml/>' });
  expect(conferirContribuinteCicloFiscal).toHaveBeenCalledWith(args.cnpj);
  expect(axios.post).toHaveBeenCalledTimes(1);
});
