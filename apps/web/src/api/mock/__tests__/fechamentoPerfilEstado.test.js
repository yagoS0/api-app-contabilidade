import { createMockApi } from '../mockApi';
it('perfil salvo conserva escolhas ao reler e separa empresas', async () => {
  const api = createMockApi();
  const original = await api.getPerfilFiscal('perfil-A');
  const candidatos = original.candidatos.map(c => ({ ...c, aliquotaIss: 4 }));
  expect((await api.savePerfilFiscal('perfil-A', candidatos)).candidatos).toEqual(candidatos);
  expect((await api.getPerfilFiscal('perfil-A')).candidatos).toEqual(candidatos);
  expect((await api.getPerfilFiscal('perfil-B')).candidatos).not.toEqual(candidatos);
});
it('simulação salva, transmite uma vez e reabertura exige novo cálculo', async () => {
  const api = createMockApi(), company = 'estado-A', mes = '2026-08';
  const form = { atividades: [{ idAtividade: 1, valorInterno: 500 }], folhaMensal12: [], regimeApuracao: 'COMPETENCIA' };
  const { result } = await api.calcularFechamento(company, mes, form);
  expect(result.calculoId).toBeTruthy();
  expect((await api.getApuracaoSnapshot(company, mes)).snapshot.dasSimuladoSerpro).toBe(result.dasValor);
  expect((await api.gerarRelatorioFaturamento(company, mes)).relatorio.dados.preApurado.oficial.dasSimuladoSerpro).toBe(result.dasValor);
  expect((await api.salvarFechamento(company, mes, { ...form, calculoId: result.calculoId })).ok).toBe(true);
  expect((await api.getFechamento(company, mes)).dados.estado).toBe('fechada');
  expect((await api.salvarFechamento(company, mes, { ...form, atividades: [], calculoId: result.calculoId })).ok).toBe(false);
  expect((await api.transmitirFechamento('outro', mes, mes, result.calculoId)).ok).toBe(false);
  const envio = api.transmitirFechamento(company, mes, mes, result.calculoId);
  expect((await api.transmitirFechamento(company, mes, mes, result.calculoId)).ok).toBe(false);
  expect((await envio).ok).toBe(true);
  expect((await api.getFechamento(company, mes)).dados.estado).toBe('transmitida');
  await api.reabrirFechamento(company, mes, 'Conferir receita');
  expect((await api.transmitirFechamento(company, mes, mes, result.calculoId)).ok).toBe(false);
  const novo = await api.calcularFechamento(company, mes, form);
  expect(novo.result.calculoId).not.toBe(result.calculoId);
  expect((await api.transmitirFechamento(company, mes, mes, result.calculoId)).ok).toBe(false);
  expect((await api.calcularFechamento(company, mes, { ...form, regimeApuracao: 'CAIXA' })).error).toBe('REGIME_APURACAO_NAO_SUPORTADO');
});

it('auditoria abre exatamente as notas sem competência e registra conferência por empresa', async () => {
  const api = createMockApi();
  const { auditoria } = await api.getAuditoriaNotas('A', '2026-08');
  for (const ref of auditoria.foraDaConferencia.notas) {
    const { nota } = await api.getNota('A', ref.notaId);
    expect(nota.numero).toBe(ref.numero); expect(nota.competencia).toBeNull();
  }
  const [p] = await api.listPendenciasPosFechamento('A');
  await api.resolverPendenciaPosFechamento('A', p.id);
  expect(await api.listPendenciasPosFechamento('A')).toEqual([]);
  expect(await api.listPendenciasPosFechamento('B')).toHaveLength(1);
});
