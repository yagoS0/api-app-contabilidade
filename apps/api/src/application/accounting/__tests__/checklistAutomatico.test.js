import { checklistDosLancamentos, checklistPendentes } from '../fechamentoBlockers';
const lancamento = (tipo, extra = {}) => ({ id: tipo, tipo, competencia: '2026-01', lines: [{ conta: '100', tipo: 'D', valor: 100 }, { conta: '200', tipo: 'C', valor: 100 }], ...extra });
test('marca somente categorias com lançamentos válidos, não consultas nem placeholders', () => {
  expect(checklistDosLancamentos([]).receitas).toBe(false);
  expect(checklistDosLancamentos([lancamento('RECEITA')])).toMatchObject({ receitas: true, pagamentos: false });
  expect(checklistDosLancamentos([lancamento('PROVISAO', { lines: [] })]).provisoes).toBe(false);
  expect(checklistDosLancamentos([lancamento('RECEITA', { lines: [{ conta: '', tipo: 'D', valor: 100 }] })]).receitas).toBe(false);
});
test('pagamento parcial é lançamento; estorno na mesma competência remove o automático', () => {
  const baixa = lancamento('BAIXA');
  expect(checklistDosLancamentos([baixa]).pagamentos).toBe(true);
  expect(checklistDosLancamentos([baixa, lancamento('ESTORNO', { estornoDeEntryId: baixa.id })]).pagamentos).toBe(false);
});
test('conferência manual sem movimento permanece possível', () => {
  expect(checklistPendentes({ receitasOk: true }, {}).some(p => p.chave === 'receitas')).toBe(false);
  expect(checklistPendentes({}, { pagamentos: true }).some(p => p.chave === 'pagamentos')).toBe(false);
});
test('folha em lote balanceia como grupo, mantendo o contrato do fechamento', () => {
  const grupo = ['D','C'].map((tipo,i) => lancamento('FOLHA', { id: String(i), loteImportacao: 'FOLHA-1', lines: [{ conta: '100', tipo, valor: 100 }] }));
  expect(checklistDosLancamentos(grupo).folhaProlabore).toBe(true);
  expect(checklistDosLancamentos([grupo[0]]).folhaProlabore).toBe(false);
});
