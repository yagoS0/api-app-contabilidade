import { createMockApi } from '../mockApi';

it('baixa documental atualiza fila, contrato e conferência sem atingir outra empresa', async () => {
  const api = createMockApi(), a = 'parcelamento-estado-A', b = 'parcelamento-estado-B';
  const guia = 'mock-guia-pendente-baixa';
  const antes = (await api.listParcelamentos(a)).find(p => p.id === 'parc-ok');
  expect((await api.lancarBaixaParcela(a, guia)).ok).toBe(true);
  expect((await api.listParcelasPendentesBaixa(a)).parcelas.some(p => p.guideId === guia)).toBe(false);
  expect((await api.listParcelasPendentesBaixa(b)).parcelas.some(p => p.guideId === guia)).toBe(true);
  const contrato = (await api.listParcelamentos(a)).find(p => p.id === 'parc-ok');
  expect(contrato.guides.find(g => g.id === guia).baixada).toBe(true);
  expect(contrato.saldoPassivo).toBeCloseTo(antes.saldoPassivo - 1180.22, 2);
  expect((await api.getConferenciaParcelas(a)).items).toEqual([expect.objectContaining({ guideId: guia, estado: 'PAGA_A_CONFERIR' })]);
  expect((await api.getConferenciaParcelas(b)).items).toEqual([]);
  expect((await api.aprovarConferenciaParcelas(a, [guia, guia])).aprovadas).toBe(1);
  expect((await api.getConferenciaParcelas(a)).items).toEqual([]);
  expect((await api.lancarBaixaParcela(a, guia)).motivo).toBe('ja_baixada');
});

it('baixa manual atualiza prestação e permanece separada de outras empresas', async () => {
  const api = createMockApi(), a = 'manual-A', b = 'manual-B', id = 'parc-migrado-60-p1';
  const dados = { dataPagamento: '2026-09-21', valorJuros: 10, valorMulta: 0, totalConferido: 1210 };
  await api.lancarBaixaManualParcela(a, id, dados);
  expect((await api.listParcelasSemGuiaPendentes(a)).parcelas.some(p => p.parcelaId === id)).toBe(false);
  expect((await api.listParcelasSemGuiaPendentes(b)).parcelas.some(p => p.parcelaId === id)).toBe(true);
  const contrato = (await api.listParcelamentos(a)).find(p => p.id === 'parc-migrado-60');
  expect(contrato.parcelasContratadas.find(p => p.id === id).origemBaixa).toBe('MANUAL');
  expect(contrato.parcelasPagas).toBe(1);
  expect(contrato.risco.emAtraso).toBe(0);
  expect(contrato.risco.parcelasEmAtraso).toEqual([]);
  await expect(api.lancarBaixaManualParcela(a, id, dados)).rejects.toMatchObject({ code: 'parcela_ja_baixada' });
});

it('registro e desfazimento da rescisão atualizam fila sem apagar contrato', async () => {
  const api = createMockApi(), a = 'rescisao-A', b = 'rescisao-B';
  await api.rescindirParcelamento(a, 'parc-migrado-60');
  expect((await api.listParcelamentos(a)).find(p => p.id === 'parc-migrado-60').status).toBe('RESCINDIDO');
  expect((await api.listParcelasSemGuiaPendentes(a)).parcelas.some(p => p.parcelamentoId === 'parc-migrado-60')).toBe(false);
  expect((await api.listParcelamentos(b)).find(p => p.id === 'parc-migrado-60').status).toBe('ATIVO');
  await api.desfazerRescisaoParcelamento(a, 'parc-migrado-60', { motivo: 'Registro incorreto' });
  expect((await api.listParcelasSemGuiaPendentes(a)).parcelas.some(p => p.parcelamentoId === 'parc-migrado-60')).toBe(true);
});

it('contas salvas e busca de pagamento pertencem à empresa', async () => {
  const api = createMockApi(), a = 'config-A', b = 'config-B';
  const body = { configPagamento: { CAIXA: '111' } };
  await api.saveParcelamentoConfig(a, 'parc-ok', body);
  expect((await api.getParcelamentoConfig(a, 'parc-ok')).parcelamento.configPagamento).toEqual(body.configPagamento);
  expect((await api.getParcelamentoConfig(b, 'parc-ok')).parcelamento.configPagamento).toBeNull();
  await api.buscarPagamentoGuia('mock-guia-ok-3', { companyId: a });
  expect((await api.listParcelasPendentesBaixa(a)).parcelas.some(p => p.guideId === 'mock-guia-ok-3')).toBe(true);
  expect((await api.listParcelasPendentesBaixa(b)).parcelas.some(p => p.guideId === 'mock-guia-ok-3')).toBe(false);
});
