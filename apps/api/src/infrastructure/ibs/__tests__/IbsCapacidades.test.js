import { criarClienteIbsBloqueado, obterCapacidadesIbs } from '../IbsCapacidades.js';
test.each(['HOMOLOGACAO','PRODUCAO'])('ambiente %s nunca infere disponibilidade', ambiente => {
  const c = obterCapacidadesIbs({ ambiente }); expect(c.runtimeHabilitado).toBe(false); expect(c.ambiente).toBe(ambiente); expect(Object.values(c.capacidades).every(x => x.disponivel === false)).toBe(true); expect(Object.isFrozen(c.capacidades)).toBe(true); expect(Object.values(c.capacidades).every(Object.isFrozen)).toBe(true);
});
test.each(Object.keys(obterCapacidadesIbs().capacidades))('%s não executa com flag local', async acao => { const client = criarClienteIbsBloqueado({ habilitado: true, runtimeHabilitado: true }); await expect(client.executar(acao)).rejects.toMatchObject({ code: 'IBS_CONTRATO_INCOMPLETO' }); });
test.each(['__proto__','constructor','outro'])('operação desconhecida %s recusada', async acao => { await expect(criarClienteIbsBloqueado().executar(acao)).rejects.toMatchObject({ code: 'IBS_OPERACAO_INVALIDA' }); });
test('ambiente inválido recusado', () => expect(() => obterCapacidadesIbs({ ambiente: 'TESTE' })).toThrow());
