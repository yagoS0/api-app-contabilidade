import { executarComRetomada } from '../PeriodosRecusadosService.js';
import { executarComAjusteDePeriodos } from '../FechamentoService.js';

const params = {
  competencia: '2026-10', contratanteCnpj: '11111111000191', contribuinteCnpj: '22222222000191',
  atividades: [{ idAtividade: 11, valorInterno: 100 }],
  receitasBrutasAnteriores: ['2026-08', '2026-09'].map(pa => ({ pa, valorInterno: 10, valorExterno: 0 })),
  folhasSalario: [],
};
function contexto(tentativaUnica = true) {
  return {
    portalClientId: 'empresa-a', competencia: params.competencia, tentativaUnica,
    ajustarPeriodos: executarComAjusteDePeriodos,
    db: {
      apuracaoPeriodoRecusado: { findMany: jest.fn(async () => []), upsert: jest.fn(async ({ create }) => create) },
      serproChamada: { findFirst: jest.fn(async () => null) },
    },
  };
}
const recusa = () => Object.assign(new Error('Foi enviada receita bruta de um período desnecessário: 08/2026.'), { code: 'SERPRO_BUSINESS_ERROR', status: 400 });

test('automático registra recusa e encerra após uma simulação, sem chamar o payload ajustado', async () => {
  const ctx = contexto();
  const simular = jest.fn().mockRejectedValueOnce(recusa()).mockResolvedValue({ dasValor: 6 });
  await expect(executarComRetomada(simular, params, ctx)).rejects.toMatchObject({
    code: 'RECEITAS_ANTERIORES_NAO_CONVERGIU', detalhe: { tentativas: 1, ajusteConfirmado: false },
  });
  expect(simular).toHaveBeenCalledTimes(1);
  expect(ctx.db.apuracaoPeriodoRecusado.upsert).toHaveBeenCalledWith(expect.objectContaining({
    create: expect.objectContaining({ portalClientId: 'empresa-a', competencia: '2026-10', lista: 'receitas', pa: '2026-08' }),
  }));
  expect(params.receitasBrutasAnteriores).toHaveLength(2);
});

test('manual conserva ajuste de período e segunda simulação', async () => {
  const simular = jest.fn().mockRejectedValueOnce(recusa()).mockResolvedValue({ dasValor: 6 });
  const out = await executarComRetomada(simular, params, contexto(false));
  expect(out.resultado).toEqual({ dasValor: 6 });
  expect(simular).toHaveBeenCalledTimes(2);
  expect(simular.mock.calls[1][0].receitasBrutasAnteriores.map(r => r.pa)).toEqual(['2026-09']);
});

test('sucesso automático preserva a evidência de listas aceitas', async () => {
  const simular = jest.fn(async () => ({ dasValor: 6 }));
  const out = await executarComRetomada(simular, params, contexto());
  expect(simular).toHaveBeenCalledTimes(1);
  expect(out.receitasAceitas).toEqual(params.receitasBrutasAnteriores);
  expect(out.periodosRemovidos).toEqual({ receitas: [], folhas: [] });
});

test.each(['TIMEOUT', 'NETWORK_ERROR'])('resultado incerto %s não ajusta nem repete', async code => {
  const ctx = contexto();
  const erro = Object.assign(new Error('Sem resposta'), { code });
  const simular = jest.fn(async () => { throw erro; });
  await expect(executarComRetomada(simular, params, ctx)).rejects.toBe(erro);
  expect(simular).toHaveBeenCalledTimes(1);
  expect(ctx.db.apuracaoPeriodoRecusado.upsert).not.toHaveBeenCalled();
});

test('falha de leitura impede a primeira simulação automática', async () => {
  const ctx = contexto();
  ctx.db.apuracaoPeriodoRecusado.findMany.mockRejectedValue(new Error('Banco indisponível'));
  const simular = jest.fn();
  await expect(executarComRetomada(simular, params, ctx)).rejects.toMatchObject({ code: 'PERIODOS_RECUSADOS_REGISTRO_INDISPONIVEL' });
  expect(simular).not.toHaveBeenCalled();
});

test('falha ao guardar recusa não permite segunda chamada automática', async () => {
  const ctx = contexto();
  ctx.db.apuracaoPeriodoRecusado.upsert.mockRejectedValue(new Error('Banco indisponível'));
  const simular = jest.fn(async () => { throw recusa(); });
  await expect(executarComRetomada(simular, params, ctx)).rejects.toMatchObject({ code: 'PERIODOS_RECUSADOS_REGISTRO_INDISPONIVEL' });
  expect(simular).toHaveBeenCalledTimes(1);
});
