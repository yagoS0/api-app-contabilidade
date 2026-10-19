import { preflightHomologacao, ambienteDoHarness } from '../preflight-homologacao-whatsapp-nfse.js';

const fixture = {
  databaseUrl: 'postgresql://fixture:synthetic@127.0.0.1:5439/nfse_governance_test',
  ambiente: 'homolog', baseUrl: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
  transporte: 'fake', confirmacao: 'BANCO_DESCARTAVEL_SEM_REDE_EXTERNA',
};
describe('preflight puro; não conecta nem lê ambiente/segredos', () => {
  test('aceita somente plano local e não certifica homologação externa', () => {
    expect(preflightHomologacao(fixture)).toMatchObject({ databaseName: 'nfse_governance_test', externaValidada: false });
  });
  test.each([
    'postgresql://fixture@remote.invalid/nfse_governance_test',
    'postgresql://fixture@localhost/nfse_governance_test',
    'postgresql://fixture@127.0.0.1/production',
    'postgresql://fixture@127.0.0.1/nfse_governance_test?host=remote.invalid',
    'postgresql://fixture@127.0.0.1/nfse_governance_test#fragment',
    'postgresql://fixture@127.0.0.1/nfse_governance_test/other',
    'postgresql://fixture@127.0.0.1/%6efse_governance_test',
    'https://127.0.0.1/nfse_governance_test', '',
  ])('recusa banco inseguro sem rede: %s', databaseUrl => {
    expect(() => preflightHomologacao({ ...fixture, databaseUrl })).toThrow();
  });
  test.each([
    { ambiente: 'producao' }, { transporte: 'real' }, { confirmacao: undefined },
    { baseUrl: 'https://sefin.nfse.gov.br/homolog' },
  ])('falha fechada para configuração insegura %j', override => {
    expect(() => preflightHomologacao({ ...fixture, ...override })).toThrow();
  });
  test('processo filho recebe allowlist, sem segredos/proxies/flags/Node preload', () => {
    const env = ambienteDoHarness(preflightHomologacao(fixture), {
      PATH: '/synthetic/bin', DATABASE_URL: 'real', DIRECT_URL: 'real',
      WHATSAPP_TOKEN: 'secret', AWS_SECRET_ACCESS_KEY: 'secret', HTTPS_PROXY: 'secret',
      NODE_OPTIONS: '--require unsafe.js', PRISMA_QUERY_ENGINE_LIBRARY: 'unsafe',
      INTEGRACAO_WHATSAPP: '1', NFSE_CERT_PFX_PATH: '/secret',
    }, '/synthetic/absent-env');
    expect(env.PATH).toBe('/synthetic/bin');
    expect(env.DATABASE_URL).toBe(fixture.databaseUrl);
    expect(env.DIRECT_URL).toBe(fixture.databaseUrl);
    expect(env.NFSE_ENV).toBe('homolog');
    for (const key of ['WHATSAPP_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'HTTPS_PROXY', 'NODE_OPTIONS',
      'PRISMA_QUERY_ENGINE_LIBRARY', 'INTEGRACAO_WHATSAPP', 'NFSE_CERT_PFX_PATH']) expect(env[key]).toBeUndefined();
  });
});
