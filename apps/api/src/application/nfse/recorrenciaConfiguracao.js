// Produção disponibiliza a funcionalidade; cada agenda ainda exige autorização individual.
// Override explícito permite interromper o worker sem apagar as agendas.
export function workerRecorrenciaHabilitado(env, ambiente) {
  const flag = env.NFSE_RECORRENCIA_WORKER_ENABLED;
  if (flag !== undefined && flag !== '') return flag === '1';
  return env.NODE_ENV === 'production' && ambiente === 'producao';
}
