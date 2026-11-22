import { validarVinculoDocumentoAdn } from '../../../modules/nfse/public.js';

const EMPRESA = '66233216000105';
const ESCRITORIO = '11222333000144';
const TERCEIRO = '99888777000166';

describe('política real de vínculo da NFS-e', () => {
  test.each([
    [{ cnpjPrestador: EMPRESA, cnpjTomador: TERCEIRO }, 'EMIT'],
    [{ cnpjPrestador: TERCEIRO, cnpjTomador: EMPRESA }, 'DEST'],
    [{ cnpjTomador: EMPRESA }, 'DEST'],
  ])('participante comprovado %j', (metadata, papel) => {
    expect(validarVinculoDocumentoAdn(EMPRESA, metadata)).toMatchObject({ pertence: true, papel });
  });
  test.each([
    { cnpjPrestador: ESCRITORIO, cnpjTomador: TERCEIRO },
    { cnpjPrestador: TERCEIRO, cnpjTomador: ESCRITORIO },
    { cnpjPrestador: '66233216000288' },
  ])('escritório, terceiros e filial não equivalem à empresa %j', metadata => {
    expect(validarVinculoDocumentoAdn(EMPRESA, metadata).pertence).toBe(false);
  });
  test('máscara preserva identidade do estabelecimento', () => {
    expect(validarVinculoDocumentoAdn('66.233.216/0001-05', { cnpjPrestador: EMPRESA }))
      .toMatchObject({ pertence: true, papel: 'EMIT', empresa: EMPRESA });
  });
  test.each([
    [EMPRESA, {}],
    [EMPRESA, { cnpjPrestador: null, cnpjTomador: '' }],
    ['', { cnpjPrestador: TERCEIRO, cnpjTomador: ESCRITORIO }],
  ])('identidade insuficiente é inconclusiva, não nota alheia nem autorização', (empresa, metadata) => {
    expect(() => validarVinculoDocumentoAdn(empresa, metadata))
      .toThrow(expect.objectContaining({ code: 'ADN_VINCULO_DOCUMENTAL_INCONCLUSIVO' }));
  });
});
