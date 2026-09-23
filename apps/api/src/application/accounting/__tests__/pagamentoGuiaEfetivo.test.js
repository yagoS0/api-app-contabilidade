import { resolverPagamentoGuia, resumirBaixas } from '../pagamentoGuiaEfetivo.js';
const guia = { id: 'g', portalClientId: 'a', valor: 1100 };
const baixa = (id, tipoLinha, valor, extra = {}) => ({ id, tipo: 'BAIXA', tipoLinha,
  sourceGuideId: 'g', portalClientId: 'a', status: 'RASCUNHO', data: '2026-06-20',
  lines: [{ tipo: 'D', valor }, { tipo: 'C', valor }], ...extra });
const resolver = (baixas, g = guia) => resolverPagamentoGuia({ guia: g, baixas, portalClientId: 'a' });

it('baixa corrigida prevalece sobre cobrança, sem somar contrapartida ou duplicar ids', () => {
  const b = baixa('b', 'PRINCIPAL', 1000);
  expect(resolver([b, b])).toMatchObject({ total: 1000, principal: 1000, juros: 0, multa: 0,
    fonte: 'BAIXA_CONTABIL', estadoContabil: 'RASCUNHO', valorDocumento: 1100 });
  expect(guia.valor).toBe(1100);
});
it('soma componentes independentes e conserva encargos reais', () => {
  expect(resolver([baixa('p', 'PRINCIPAL', 1000), baixa('j', 'JUROS', 70), baixa('m', 'MULTA', 30)]))
    .toMatchObject({ total: 1100, principal: 1000, juros: 70, multa: 30 });
});
it('TOTAL não inventa composição e diferentes datas conservam os pagamentos separados', () => {
  const r = resolver([baixa('a', 'TOTAL', 400), baixa('b', 'TOTAL', 600, { data: '2026-07-20' })]);
  expect(r).toMatchObject({ total: 1000, principal: null, juros: null, composicaoConhecida: false, data: null });
  expect(r.pagamentos.map(p => p.total)).toEqual([400, 600]);
});
it('estorno retira baixa vigente sem produzir recebimento fictício', () => {
  const b = baixa('b', 'PRINCIPAL', 1100);
  const e = { ...b, id: 'e', tipo: 'ESTORNO', estornoDeEntryId: 'b' };
  expect(resolver([b, e])).toBeNull();
  expect(resolver([b, e, baixa('nova', 'PRINCIPAL', 1000)]).total).toBe(1000);
});
it('comprovante zero encargos é válido e continua evidência após estorno contábil', () => {
  const g = { ...guia, extracted: { comprovante: { total: 1000, principal: 1000, juros: 0, multa: 0, dataArrecadacao: '2026-06-20' } } };
  expect(resolver([], g)).toMatchObject({ total: 1000, principal: 1000, fonte: 'COMPROVANTE' });
  expect(resolver([baixa('b', 'PRINCIPAL', 900)], g)).toMatchObject({ total: 900, divergencia: true });
});
it('não atribui guia de outra empresa nem fonte apenas PAID ao valor pago', () => {
  expect(resolver([baixa('b', 'PRINCIPAL', 1000, { portalClientId: 'outra' })], { ...guia, paymentStatus: 'PAID' })).toBeNull();
  expect(resolver([baixa('b', 'PRINCIPAL', 1000, { sourceGuideId: 'outra' })])).toBeNull();
});
it('baixa ligada à provisão integra a mesma guia e valores inválidos não viram zero', () => {
  expect(resolver([baixa('b', 'PRINCIPAL', 1000, { sourceGuideId: null, openEntry: { sourceGuideId: 'g' } })]).total).toBe(1000);
  expect(resumirBaixas([baixa('b', 'PRINCIPAL', 'erro')])).toMatchObject({ total: null, pendencia: 'BAIXA_SEM_VALOR_CONFIAVEL' });
});
it.each([['20/06/2026', '2026-06-20'], ['05/06/2026', '2026-06-05'], ['31/02/2026', null]])('interpreta data civil %s sem normalizar data impossível', (data, esperado) => {
  const r = resolver([], { ...guia, extracted: { comprovante: { total: 1000, dataArrecadacao: data } } });
  expect(r.data?.slice(0, 10) || null).toBe(esperado);
});
it('baixa inválida permanece pendência mesmo com comprovante válido', () => {
  expect(resolver([baixa('b', 'TOTAL', 'inválido')], { ...guia, extracted: { comprovante: { total: 1000 } } }))
    .toMatchObject({ fonte: 'BAIXA_CONTABIL', total: null, pendencia: 'BAIXA_SEM_VALOR_CONFIAVEL' });
});
it('data divergente também exige conferência, sem trocar a data editada', () => {
  const g = { ...guia, extracted: { comprovante: { total: 1000, dataArrecadacao: '2026-06-21' } } };
  expect(resolver([baixa('b', 'PRINCIPAL', 1000)], g)).toMatchObject({ data: '2026-06-20T00:00:00.000Z', divergencia: true });
});
