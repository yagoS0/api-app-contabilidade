import { criarMockComercial } from '../../../../api/mock/comercialMock';

async function preparado() {
  const o = { id: 'ficha-sintetica', origem: 'ABERTURA', versao: 1, dados: { atividadePretendida: 'Consultoria', municipioAtendimento: 'Cidade de teste', enderecoPretendido: 'Rua de exemplo, 10' } };
  const api = criarMockComercial({ onboardings: new Map([[o.id, o]]), persistir: jest.fn() });
  const base = `/onboardings/${o.id}`;
  const { diagnostico } = await api.comercial(`${base}/jornada/diagnostico`, { versao: 1, achados: 'Atividade e endereço conferidos.', servicos: 'Abertura e acompanhamento mensal.' });
  await api.comercial(`${base}/jornada/apresentacao`, { versao: 1, diagnosticoId: diagnostico.id, meio: 'Reunião de teste', evidencia: 'Escopo apresentado ao interessado.' });
  return { api, base, diagnostico };
}

test('corrigir dados de contato e orçamento não descarta diagnóstico nem apresentação no mock', async () => {
  const { api, base, diagnostico } = await preparado();
  const campos = { responsavelEmail: 'pessoa@example.test', modalidadeServico: 'RECORRENTE', regimePretendido: 'SIMPLES', qtdFuncionarios: 0, notasRecebidasMes: 0, consultoriaMensal: false };
  await api.comercial(`${base}/campos`, { versao: 1, operacoes: Object.entries(campos).map(([campo, valor]) => ({ campo, valor, acao: 'set' })) });
  const r = await api.comercial(base);
  expect(r.onboarding.versao).toBe(2);
  expect(r.jornada.diagnostico.id).toBe(diagnostico.id);
  expect(r.jornada.diagnosticoAnterior).toBeNull();
  expect(r.jornada.devolutiva.concluida).toBe(true);
});

test.each(['enderecoPretendido', 'municipioAtendimento', 'atividadePretendida', 'cnpj'])('alterar %s conserva rascunho e exige novo diagnóstico/apresentação', async campo => {
  const { api, base, diagnostico } = await preparado();
  await api.comercial(`${base}/campos`, { versao: 1, operacoes: [{ campo, valor: campo === 'cnpj' ? '11222333000181' : 'Dado novo para revisar', acao: 'set' }] });
  const r = await api.comercial(base);
  expect(r.jornada.diagnostico).toBeNull();
  expect(r.jornada.diagnosticoDesatualizado).toBe(true);
  expect(r.jornada.diagnosticoAnterior).toMatchObject({ achados: diagnostico.dados.achados, servicos: diagnostico.dados.servicos });
  expect(r.jornada.devolutiva.concluida).toBe(false);
  await expect(api.comercial(`${base}/jornada/apresentacao`, { versao: 2, diagnosticoId: diagnostico.id, meio: 'Reunião antiga', evidencia: 'Apresentação antiga não valida dado novo.' })).rejects.toThrow();
  const nova = await api.comercial(`${base}/jornada/diagnostico`, { versao: 2, achados: 'Dados atualizados conferidos.', servicos: 'Escopo revisto para a abertura.' });
  expect(nova.diagnostico.id).not.toBe(diagnostico.id);
  expect((await api.comercial(base)).jornada.devolutiva.concluida).toBe(false);
});
