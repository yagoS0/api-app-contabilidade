jest.mock('../../../config.js', () => ({ log: { warn: jest.fn() } }));
jest.mock('../../notas/persistirDocumentoNota.js', () => ({ bloquearDocumentosDaEmpresa: jest.fn(), prepararDocumentoNota: jest.fn() }));
jest.mock('../../notas/pendenciasDoPeriodo.js', () => ({ situacaoDoPeriodo: jest.fn(), registrarPendenciaDoPeriodo: jest.fn() }));
jest.mock('../../notas/notaItens.js', () => ({ substituirItensPreservandoClassificacao: jest.fn() }));
import { validarVinculoDocumentoAdn } from '../../../modules/nfse/public.js';
import { upsertNfseFromItem } from '../../notas/ingestaoNfse.js';
import { bloquearDocumentosDaEmpresa } from '../../notas/persistirDocumentoNota.js';

const A = '11111111000191', B = '22222222000191';
test.each([
  [{ cnpjPrestador: A }, 'EMIT'], [{ cnpjTomador: A }, 'DEST'],
  [{ cnpjPrestador: '11.111.111/0001-91' }, 'EMIT'],
])('titularidade integral normalizada %j', (metadata, papel) => {
  expect(validarVinculoDocumentoAdn(A, metadata)).toMatchObject({ pertence: true, papel });
});
test('filial e documento alheio não são titularidade', () => {
  expect(validarVinculoDocumentoAdn(A, { cnpjPrestador: '11111111000272', cnpjTomador: B }).pertence).toBe(false);
});
test.each([{}, { cnpjPrestador: null, cnpjTomador: null }])('identidade ausente bloqueia antes de persistir', async metadata => {
  const tx = {};
  await expect(upsertNfseFromItem(tx, { portalClientId: 'a', companyCnpj: A, metadata: { numeroNfse: '1', ...metadata } }))
    .rejects.toMatchObject({ code: 'ADN_VINCULO_DOCUMENTAL_INCONCLUSIVO' });
  expect(bloquearDocumentosDaEmpresa).not.toHaveBeenCalled();
});
test('documento alheio preserva recusa existente sem qualquer acesso de escrita', async () => {
  const result = await upsertNfseFromItem({}, { portalClientId: 'a', companyCnpj: A,
    metadata: { numeroNfse: '1', cnpjPrestador: B } });
  expect(result.status).toBe('rejeitada_outro_cnpj');
  expect(bloquearDocumentosDaEmpresa).not.toHaveBeenCalled();
});

test('CNPJ correto com PortalClient de outra empresa é recusado antes da escrita', async () => {
  const tx = { portalClient: { findUnique: jest.fn().mockResolvedValue({ cnpj: B }) } };
  await expect(upsertNfseFromItem(tx, { portalClientId: 'outro', companyCnpj: A,
    metadata: { numeroNfse: '1', cnpjPrestador: A } })).rejects.toMatchObject({ code: 'ADN_DESTINO_DOCUMENTAL_DIVERGENTE' });
  expect(bloquearDocumentosDaEmpresa).not.toHaveBeenCalled();
});
