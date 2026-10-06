import { workerRecorrenciaHabilitado } from '../recorrenciaConfiguracao.js';

test.each([
  [{}, 'producao', false],
  [{ NODE_ENV: 'development' }, 'producao', false],
  [{ NODE_ENV: 'production' }, 'producao', true],
  [{ NODE_ENV: 'production' }, 'homolog', false],
  [{ NODE_ENV: 'production', NFSE_RECORRENCIA_WORKER_ENABLED: '0' }, 'producao', false],
  [{ NODE_ENV: 'production', NFSE_RECORRENCIA_WORKER_ENABLED: 'false' }, 'producao', false],
  [{ NODE_ENV: 'development', NFSE_RECORRENCIA_WORKER_ENABLED: '1' }, 'homolog', true],
])('habilitação respeita ambiente e override %j / %s', (env, ambiente, esperado) => {
  expect(workerRecorrenciaHabilitado(env, ambiente)).toBe(esperado);
});
