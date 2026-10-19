import { validarAmbienteNfse } from '../ambienteNfse.js';

const homolog = 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional';
const producao = 'https://sefin.nfse.gov.br/SefinNacional';

describe('isolamento de ambiente NFS-e (puro, sem rede)', () => {
  test.each([['homolog', homolog], ['producao', producao]])('aceita o host exato de %s', (ambiente, baseUrl) => {
    expect(validarAmbienteNfse({ ambiente, baseUrl, caminhos: ['/nfse', '/dps'] }).ambiente).toBe(ambiente);
  });
  test.each([
    ['homolog', producao], ['producao', homolog],
    ['homolog', `${producao}/homolog`],
    ['homolog', 'https://sefin.producaorestrita.nfse.gov.br.example.invalid'],
    ['homolog', 'https://homolog.example.invalid'],
    ['homolog', 'https://sefin.nfse.gov.br./homolog'],
    ['homolog', 'https://127.0.0.1'],
  ])('recusa cruzamento ou host desconhecido: %s %s', (ambiente, baseUrl) => {
    expect(() => validarAmbienteNfse({ ambiente, baseUrl })).toThrow(expect.objectContaining({
      code: 'NFSE_ENV_HOST_MISMATCH', antesDoPost: true,
    }));
  });
  test.each([
    '', '//sefin.producaorestrita.nfse.gov.br', homolog.replace('https:', 'http:'),
    `${homolog}?homolog=1`, `${homolog}#homolog`,
    'https://user:secret@sefin.producaorestrita.nfse.gov.br',
    'https://sefin.producaorestrita.nfse.gov.br:444',
  ])('recusa URL ambígua sem expor seu conteúdo', baseUrl => {
    let error;
    try { validarAmbienteNfse({ ambiente: 'homolog', baseUrl }); } catch (e) { error = e; }
    expect(error?.code).toBe('NFSE_INVALID_BASE_URL');
    expect(error.message).not.toContain('secret');
  });
  test.each(['https://sefin.nfse.gov.br/nfse', '//sefin.nfse.gov.br/nfse', '/\\sefin.nfse.gov.br', '/nfse\n'])('não permite endpoint substituir origem: %s', caminho => {
    expect(() => validarAmbienteNfse({ ambiente: 'homolog', baseUrl: homolog, caminhos: [caminho] }))
      .toThrow(expect.objectContaining({ code: 'NFSE_INVALID_PATH' }));
  });
  test.each([undefined, '', 'sandbox', 'production', 'typo'])('não infere ambiente %s', ambiente => {
    expect(() => validarAmbienteNfse({ ambiente, baseUrl: homolog }))
      .toThrow(expect.objectContaining({ code: 'NFSE_INVALID_ENV' }));
  });
});
