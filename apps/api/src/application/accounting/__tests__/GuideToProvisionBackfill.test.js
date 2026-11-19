import { executarBackfillDeProvisoes } from '../../../modules/accounting/application/backfillProvisionsFromExistingGuides.js';
import { competenciasProtegidasBackfill } from '../../../modules/accounting/domain/backfillDeProvisoes.js';
const date = new Date('2026-11-01T00:00:00Z');
const selecionada = { id: 'g', portalClientId: 'p', competencia: '2026-10', updatedAt: date };
function fixture(overrides = {}) {
  const ordem = [];
  const guia = { ...selecionada, status: 'PROCESSED', tipo: 'ISS', accountingEntries: [], vencimento: new Date('2026-11-20'), ...overrides };
  const tx = { bloquear: jest.fn(async () => ordem.push('bloquear')), ler: jest.fn(async () => { ordem.push('ler'); return guia; }), mesFechado: jest.fn(async () => { ordem.push('fechamento'); return false; }), gerar: jest.fn(async () => { ordem.push('gerar'); return { ok: true, entries: [{ action: 'created' }] }; }) };
  const portas = { listar: jest.fn(async () => [selecionada]), emTransacao: jest.fn(async f => f(tx)) };
  const entrada = { portalClientId: 'p', competencia: '2026-10', executar: true, logger: { info: jest.fn() } };
  return { guia, tx, portas, entrada, ordem };
}
test('prévia padrão não abre transação e não escreve', async () => {
  const f = fixture(); delete f.entrada.executar;
  expect((await executarBackfillDeProvisoes(f.entrada, f.portas)).preview).toBe(true);
  expect(f.portas.emTransacao).not.toHaveBeenCalled(); expect(f.tx.gerar).not.toHaveBeenCalled();
});
test.each([{}, { portalClientId: 'p' }, { portalClientId: 'p', competencia: '2026-13' }])('escopo explícito obrigatório %j', async entrada => {
  const f = fixture(); await expect(executarBackfillDeProvisoes(entrada, f.portas)).rejects.toMatchObject({ code: 'ESCOPO_BACKFILL_OBRIGATORIO' }); expect(f.portas.listar).not.toHaveBeenCalled();
});
test('proteção precede releitura, fechamento e geração', async () => {
  const f = fixture(); expect((await executarBackfillDeProvisoes(f.entrada, f.portas)).ok).toBe(1); expect(f.ordem).toEqual(['bloquear', 'ler', 'fechamento', 'gerar']);
});
test('competência fechada nunca gera provisão', async () => {
  const f = fixture(); f.tx.mesFechado.mockResolvedValue(true);
  expect((await executarBackfillDeProvisoes(f.entrada, f.portas)).resultados[0].status).toBe('MES_FECHADO'); expect(f.tx.gerar).not.toHaveBeenCalled();
});
test('protege também mês da data contábil legada sem mudar gerador', async () => {
  const f = fixture({ vencimento: new Date('2026-12-20') }); f.tx.mesFechado.mockImplementation(async (_, pa) => pa === '2026-11');
  expect((await executarBackfillDeProvisoes(f.entrada, f.portas)).resultados[0].status).toBe('MES_FECHADO');
  expect(f.tx.mesFechado.mock.calls).toEqual([['p','2026-10'],['p','2026-11']]); expect(f.tx.gerar).not.toHaveBeenCalled();
});
test.each([{ portalClientId: 'outro' }, { competencia: '2026-09' }, { updatedAt: new Date('2026-11-01T00:00:00.001Z') }, { accountingEntries: [{id:'e'}] }, { status:'ERROR' }, { extracted:{contabilizacaoPendente:{motivo:'MES_FECHADO'}} }, { parcelamentoId:'parc' }])('guia alterada, contabilizada ou pendente não é reescrita %j', async patch => {
  const f = fixture(patch); expect((await executarBackfillDeProvisoes(f.entrada, f.portas)).skipped).toBe(1); expect(f.tx.gerar).not.toHaveBeenCalled();
});
test('erro/conflito interrompe sem repetição ou próxima guia', async () => {
  const f = fixture(); f.portas.listar.mockResolvedValue([selecionada, {...selecionada,id:'g2'}]); f.tx.gerar.mockRejectedValue(Object.assign(Error('conflict'),{code:'P2034'}));
  await expect(executarBackfillDeProvisoes(f.entrada,f.portas)).rejects.toMatchObject({code:'P2034'}); expect(f.portas.emTransacao).toHaveBeenCalledTimes(1); expect(f.tx.gerar).toHaveBeenCalledTimes(1);
});
test('escrita diferente de criação exige rollback', async () => { const f=fixture();f.tx.gerar.mockResolvedValue({ok:true,entries:[{action:'updated'}]});await expect(executarBackfillDeProvisoes(f.entrada,f.portas)).rejects.toMatchObject({code:'BACKFILL_ESCRITA_INESPERADA'}); });
test('data desconhecida bloqueia; sem vencimento protege competência',()=> {expect(competenciasProtegidasBackfill({...selecionada,vencimento:'invalid'})).toBeNull();expect(competenciasProtegidasBackfill(selecionada)).toEqual(['2026-10']);});
