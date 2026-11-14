import { consultarConciliacaoDas445 } from '../consultarConciliacaoDas445.js';
import { projetarFiscal445 } from '../../../fiscal/publicConciliacaoDas445.js';
import { projetarGuias445 } from '../../../guides/publicConciliacaoDas445.js';
import { projetarContabilidade445 } from '../../../accounting/publicConciliacaoDas445.js';
const input = { companyId: 'a', competencia: '2026-10' };
const page = (items = [], extra = {}) => ({ items, truncated: false, limit: 50, lacunas: [], ...extra });
const guia = (patch = {}) => ({ id: 'g', estadoLocal: 'PROCESSED', numeroDocumento: '12345678901234567', valor: '100', pagamento: {}, ...patch });
function fixture(values = {}) {
  const ports = { autorizar: jest.fn(async () => {}), agora: () => new Date('2026-11-14T12:00:00Z'),
    projetarFiscal: projetarFiscal445, projetarGuias: projetarGuias445, projetarContabilidade: projetarContabilidade445 };
  for (const name of ['chamadas','cache','despachos','guias','pagamentos','circular','lancamentos','execucoes','worker']) ports[name] = jest.fn(async () => page(values[name] || []));
  return { ports, run: () => consultarConciliacaoDas445(input, ports) };
}
test('uncertain reservation without cache stays uncertain', async () => {
  const f = fixture({ chamadas: [{ estadoLocal: 'incerta' }] }); const r = await f.run();
  expect(r.fiscal.estado).toBe('Incerto'); expect(r.fiscal.lacunas).toContain('NENHUMA_AUTORIZACAO_DE_RETRY');
});
test('uncertain reservation with valid cache remains unresolved', async () => {
  const r = await fixture({ chamadas: [{ estadoLocal: 'incerta' }], cache: [{ vigente: true }] }).run();
  expect(r.fiscal.estado).toBe('Incerto'); expect(r.lacunas).toContain('CACHE_SEM_GUIA_NO_RECORTE');
});
test('cache without guide does not imply documentary success', async () => {
  const r = await fixture({ cache: [{ vigente: true }] }).run(); expect(r.guias.estado).toBe('Não verificável');
});
test('guide without circular is explicit', async () => {
  expect((await fixture({ guias: [guia()] }).run()).lacunas).toContain('GUIA_SEM_CIRCULAR_NO_RECORTE');
});
test('circular without provision never means accounting completion', async () => {
  const r = await fixture({ circular: [{ id: 'c', metadata: {} }] }).run();
  expect(r.contabilidade.estado).toBe('Parcial'); expect(r.contabilidade.lacunas).toContain('SEM_LANCAMENTO_NO_RECORTE_NAO_COMPROVA_PROVISAO_CONCLUIDA');
});
test('reused guide with empty generated entries is not a provision', async () => {
  const r = await fixture({ guias: [guia()] }).run(); expect(r.contabilidade.lacunas).toContain('GUIA_SEM_PROVISAO_VINCULADA:g');
});
test('paid guide and receipt remain separate from accounting and delivery', async () => {
  const r = await fixture({ guias: [guia({ pagamento: { estadoLocal: 'PAID', origem: 'CLIENTE', referenciaComprovante: true } })] }).run();
  expect(r.guias.guias.items[0].pagamento.origem).toBe('CLIENTE'); expect(r.guias.lacunas).toContain('ENTREGA_NAO_VERIFICADA');
  expect(r.contabilidade.estado).toBe('Não verificável');
});
test('multiple documents are not silently deduplicated', async () => {
  const r = await fixture({ guias: [guia(), guia({ id: 'g2' })] }).run();
  expect(r.guias.guias.items).toHaveLength(2); expect(r.guias.lacunas).toContain('MULTIPLAS_GUIAS_REVISAO_VIGENTE_NAO_DETERMINADA');
});
test('requested absent/foreign document never broadens scope', async () => {
  const f = fixture(); await consultarConciliacaoDas445({ ...input, documentoId: 'foreign' }, f.ports);
  expect(f.ports.guias).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'a', documentoId: 'foreign' }));
});
test('accounting closure is its own evidence', async () => {
  const r = await fixture({ circular: [{ id: 'c', metadata: {}, fechadoContabilEm: '2026-11-01' }] }).run();
  expect(r.contabilidade.estado).toBe('Bloqueado');
});
test('completed with accounting.ok:false cannot be reconstructed from persisted counters', async () => {
  const r = await fixture({ execucoes: [{ status: 'completed', entriesGenerated: 0 }] }).run();
  expect(r.operacoes.lacunas).toContain('ACCOUNTING_OK_NAO_PERSISTIDO'); expect(r.contabilidade.estado).toBe('Não verificável');
});
test('no evidence is not zero tax or reconciliation', async () => {
  const r = await fixture().run(); for (const key of ['fiscal','guias','contabilidade','operacoes']) expect(r[key].estado).toBe('Não verificável');
  expect(r).not.toHaveProperty('conciliado');
});
test('contradictory identified guide and circular totals are explicit', async () => {
  const r = await fixture({ guias: [guia()], circular: [{ id: 'c', metadata: {}, numeroDocumento: '12345678901234567', dasTotal: '999' }] }).run();
  expect(r.lacunas).toContain('VALOR_GUIA_CIRCULAR_DIVERGENTE');
});
test('partial failure is not empty, does not retry or leak error details', async () => {
  const f = fixture({ guias: [guia()] }); f.ports.chamadas.mockRejectedValue(Error('credentials SECRET'));
  const r = await f.run(); expect(r.fiscal.chamadas).toMatchObject({ consulta: 'falhou', items: null });
  expect(f.ports.chamadas).toHaveBeenCalledTimes(1); expect(f.ports.cache).not.toHaveBeenCalled();
  expect(r.guias.guias.items).toHaveLength(1); expect(JSON.stringify(r)).not.toContain('SECRET');
});
test.each([{ companyId: '' }, { competencia: '2026-13' }, { competencia: '26-10' }, { servico: 'TRANSDECLARACAO11' }, { documentoId: {} }, { limit: 101 }])('input validation %j precedes authorization', async patch => {
  const f = fixture(); await expect(consultarConciliacaoDas445({ ...input, ...patch }, f.ports)).rejects.toMatchObject({ code: 'ENTRADA_INVALIDA' });
  expect(f.ports.autorizar).not.toHaveBeenCalled(); expect(f.ports.guias).not.toHaveBeenCalled();
});
test('truncated evidence remains named, not absence', async () => {
  const f = fixture(); f.ports.guias.mockResolvedValue(page([guia()], { truncated: true }));
  expect((await f.run()).lacunas).toContain('RECORTE_TRUNCADO:guias');
});

test('unavailable circular is not reported as absent', async () => {
  const f = fixture({ guias: [guia()] }); f.ports.circular.mockRejectedValue(Error('down'));
  const r = await f.run(); expect(r.lacunas).not.toContain('GUIA_SEM_CIRCULAR_NO_RECORTE');
  expect(r.lacunas).toContain('FONTE_NAO_VERIFICAVEL:circular');
});
test('unavailable guides do not imply cache without guide', async () => {
  const f = fixture({ cache: [{ vigente: true }] }); f.ports.guias.mockRejectedValue(Error('down'));
  const r = await f.run(); expect(r.lacunas).not.toContain('CACHE_SEM_GUIA_NO_RECORTE');
  expect(f.ports.guias).toHaveBeenCalledTimes(1);
});
test.each([false, true])('failed or truncated entries do not prove missing provision: %s', async truncated => {
  const f = fixture({ guias: [guia()] });
  if (truncated) f.ports.lancamentos.mockResolvedValue(page([], { truncated: true }));
  else f.ports.lancamentos.mockRejectedValue(Error('down'));
  expect((await f.run()).contabilidade.lacunas).not.toContain('GUIA_SEM_PROVISAO_VINCULADA:g');
});
test('one document on a truncated page cannot prove unique revision', async () => {
  const f = fixture(); f.ports.guias.mockResolvedValue(page([guia()], { truncated: true }));
  expect((await f.run()).guias.estado).toBe('Parcial');
});
test.each([['9007199254740992.01', '9007199254740992.02', true], ['00100.00', '100', false]])('decimal comparison preserves exact values %s %s', async (a,b,different) => {
  const r = await fixture({ guias: [guia({ valor: a })], circular: [{ id: 'c', metadata: {}, numeroDocumento: '12345678901234567', dasTotal: b }] }).run();
  expect(r.lacunas.includes('VALOR_GUIA_CIRCULAR_DIVERGENTE')).toBe(different);
});
