import { mesSeguinte, sinalizarPendenciaFechamento, projetarPendenciasContabeis } from '@contabilidade/shared/pendencias-contabeis';
const entry = { id: 'iss', subtipo: 'ISS', competencia: '2025-12', statusPagamento: 'PARCIAL', valor: 1000, saldo: 600 };
const fechado = { '2026-01': { fechadoEm: '2026-02-05T12:00:00Z' } };
test('fecha o mês do pagamento, inclusive na virada do ano, e projeta só saldo', () => {
  expect(mesSeguinte('2026-01', -1)).toBe('2025-12');
  const e = sinalizarPendenciaFechamento(entry, fechado);
  expect(e).toMatchObject({ competenciaPagamento: '2026-01', pendenciaFechamento: true });
  expect(projetarPendenciasContabeis([e])[0]).toMatchObject({ total: 60000, origem: 'CONTABILIDADE', estado: 'VENCIDO' });
});
test('fechar só a provisão não antecipa o pagamento do próximo mês', () => {
  expect(sinalizarPendenciaFechamento(entry, { '2025-12': fechado['2026-01'] }).pendenciaFechamento).toBe(false);
});
test('prioriza vencimento real sobre o mês seguinte inferido', () => {
  expect(sinalizarPendenciaFechamento({ ...entry, sourceGuide: { vencimento: '2026-02-20T00:00:00Z' } }, fechado).pendenciaFechamento).toBe(false);
});
test.each([{ statusPagamento: 'PAGO' }, { saldo: 0 }, { placeholder: true }, { parcelamentoId: 'acordo' }])('não acusa débito quitado, previsto ou em acordo %j', patch => {
  expect(sinalizarPendenciaFechamento({ ...entry, ...patch }, fechado).pendenciaFechamento).toBe(false);
});
test('reabrir remove o alerta; estornar e restaurar saldo devolve', () => {
  expect(projetarPendenciasContabeis([sinalizarPendenciaFechamento(entry, {})])).toEqual([]);
  expect(projetarPendenciasContabeis([sinalizarPendenciaFechamento(entry, fechado)])).toHaveLength(1);
});

import { pagamentosDisponiveis } from '@contabilidade/shared/pendencias-contabeis';
test('contador inclui meses anteriores e saldo parcial, exclui pagos e provisões sem baixa disponível', () => {
  const base = { ...entry, tipo: 'PROVISAO' };
  const lista = [base, {...base,id:'antigo',competencia:'2025-08'}, {...base,id:'pago',statusPagamento:'PAGO'}, {...base,id:'mes',competencia:'2026-01'}, {...base,id:'zero',saldo:0}, {...base,id:'synthetic-das-1'}, {...base,id:'acordo',parcelamentoId:'1'}];
  expect(pagamentosDisponiveis(lista,'2026-01').map(e=>e.id)).toEqual(['iss','antigo']);
});
