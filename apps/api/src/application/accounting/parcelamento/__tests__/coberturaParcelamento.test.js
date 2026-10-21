import { coberturaParcelamentoDoMes, guiasParcelamentoDoMes, projetarPendenciasParcelamento } from '../pendenciasParcelamento.js';
const item = extra => ({ id: 'parcela:p1', parcelaId: 'p1', parcelamentoId: 'c1', tipo: 'PARCSN', formaPagamento: 'GUIA_MENSAL', referencia: '2026-09', vencimento: '2026-09-20', ...extra });

test('documento presente e enviado continua na cobertura, sem reabrir alerta mensal', () => {
  const entrada = item({ guideId: 'g1', documentoDisponivel: true, documentoConferido: true, enviada: true, pagamentoConfirmado: false });
  expect(guiasParcelamentoDoMes([entrada], '2026-09')).toEqual([]);
  expect(coberturaParcelamentoDoMes([entrada], '2026-09')).toEqual([expect.objectContaining({ id: entrada.id, documento: 'disponivel', comunicacao: 'enviada', pagamentoConfirmado: false })]);
});

test('contratos do mesmo tipo permanecem distintos; anteriores e indícios cobertos não duplicam documentos', () => {
  const itens = [item({ guideId: 'g1', documentoDisponivel: true, documentoConferido: true }), item({ id: 'parcela:p2', parcelaId: 'p2', parcelamentoId: 'c2' }), item({ id: 'antiga', vencimento: '2026-08-20', anterior: true }), item({ id: 'indicio', guiaDoMesPresente: true })];
  expect(coberturaParcelamentoDoMes(itens, '2026-09').map(i => [i.parcelamentoId, i.documento])).toEqual([['c1', 'disponivel'], ['c2', 'faltante']]);
  expect(coberturaParcelamentoDoMes([itens[0], itens[0]], '2026-09')).toHaveLength(1);
});

describe.each([
  ['conferência pendente', { extracted: { conferenciaDocumentoPendente: true } }],
  ['valor ausente', { valor: null }],
  ['valor zerado', { valor: 0 }],
  ['vencimento inválido', { vencimento: 'invalido' }],
])('documento com %s', (_nome, alteracao) => {
  test.each(['aberta', 'enviada', 'paga'])('preserva revisão documental da parcela %s', situacao => {
    const guia = { id: 'g1', status: 'PROCESSED', pdfDisponivel: true, valor: 100, vencimento: '2026-09-20', ...alteracao };
    const itens = projetarPendenciasParcelamento({ mesOperacional: '2026-09', agora: new Date('2026-09-01'),
      enviada: () => situacao === 'enviada', contratos: [{ id: 'c1', status: 'ATIVO', formaPagamento: 'GUIA_MENSAL',
        parcelas: [{ id: 'p1', competencia: '2026-09', pagamentoStatus: situacao === 'paga' ? 'CONFIRMADO' : null, guia }] }] }).itens;
    expect(itens[0]).toMatchObject({ documentoDisponivel: true, documentoConferido: false });
    expect(coberturaParcelamentoDoMes(itens, '2026-09')[0]).toMatchObject({ documento: 'a_conferir',
      comunicacao: situacao === 'enviada' ? 'enviada' : 'aguarda_documento', pagamentoConfirmado: situacao === 'paga' });
  });
});

test('débito automático exige fato cadastrado e não comprova pagamento; guia em processamento pede conferência', () => {
  const rows = coberturaParcelamentoDoMes([item({ formaPagamento: 'DEBITO_AUTOMATICO', pagamentoConfirmado: false }), item({ id: 'sem-forma', formaPagamento: null }), item({ id: 'processando', guideId: 'g2' })], '2026-09');
  expect(rows[0]).toMatchObject({ documento: 'nao_exigido', comunicacao: 'nao_exigida', pagamentoConfirmado: false });
  expect(rows[1].documento).toBe('a_conferir');
  expect(rows[2].documento).toBe('a_conferir');
  expect(() => coberturaParcelamentoDoMes([], '2026-99')).toThrow();
});
