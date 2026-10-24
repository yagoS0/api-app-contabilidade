jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: { companyFirmAccess: { findUnique: jest.fn() } } }));
jest.mock('../../../application/accounting/CorrecaoMesContabilService.js', () => ({
  corrigirMesFechado: jest.fn(), listarCorrecoesContabeis: jest.fn(), estadoCorrecaoTx: jest.fn(),
  CorrecaoContabilError: jest.requireActual('../../../application/accounting/CorrecaoMesContabilService.js').CorrecaoContabilError,
}));
jest.mock('../../../application/guides/ConfirmacaoPagamentoClienteService.js', () => ({
  listarConfirmacoesPagamento: jest.fn(), lerConfirmacaoPagamento: jest.fn(), tentarBaixaConfirmacao: jest.fn(),
}));
import express from 'express';
import request from 'supertest';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { corrigirMesFechado, listarCorrecoesContabeis, estadoCorrecaoTx } from '../../../application/accounting/CorrecaoMesContabilService.js';
import { listarConfirmacoesPagamento, lerConfirmacaoPagamento, tentarBaixaConfirmacao } from '../../../application/guides/ConfirmacaoPagamentoClienteService.js';
import { createAccountingEntriesRouter } from '../accountingEntries.js';
function app(user = { id: 'u', role: 'firm', name: 'Contador Teste' }) {
  const a = express(); a.use(express.json()); a.use((req, res, next) => { req.auth = { user }; next(); });
  a.use('/firm/companies/:companyId', createAccountingEntriesRouter({ log: { error: jest.fn(), warn: jest.fn() } })); return a;
}
beforeEach(() => { jest.clearAllMocks(); prisma.companyFirmAccess.findUnique.mockResolvedValue({ role: 'ACCOUNTANT', status: 'ACTIVE', scopes: [] }); });
const url = '/firm/companies/emp/fechamento-contabil/2026-09/reabrir';
test('reabertura passa empresa, motivo, versão e ator autenticado ao serviço', async () => {
  corrigirMesFechado.mockResolvedValue({ ok: true, fechado: false, correcao: { id: 'c' } });
  const r = await request(app()).post(url).send({ motivo: 'Corrigir duplicidade', versao: 'v1', autor: { id: 'forjado' } });
  expect(r.status).toBe(200);
  expect(corrigirMesFechado).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'emp', competencia: '2026-09', motivo: 'Corrigir duplicidade', versao: 'v1', autor: { id: 'u', nome: 'Contador Teste' } }), prisma);
});
test.each([['STAFF', 403], [null, 401]])('sem permissão %s não chama mutação', async (role, status) => {
  prisma.companyFirmAccess.findUnique.mockResolvedValue({ role, status: 'ACTIVE', scopes: [] });
  const r = await request(app(role ? undefined : null)).post(url).send({ motivo: 'x', versao: 'v' });
  expect(r.status).toBe(status); expect(corrigirMesFechado).not.toHaveBeenCalled();
});
test('versão antiga retorna conflito e nunca sucesso', async () => {
  corrigirMesFechado.mockRejectedValue(Object.assign(new Error('Atualize'), { code: 'VERSAO_ALTERADA', status: 409 }));
  const r = await request(app()).post(url).send({ motivo: 'x', versao: 'v' });
  expect(r.status).toBe(409); expect(r.body.ok).toBe(false);
});
test('contador e lista avisos usam mesmo mês de pagamento e histórico preservado', async () => {
  listarCorrecoesContabeis.mockResolvedValue({ correcoes: [{ id: 'c' }], historico: [{ id: 'h' }] });
  listarConfirmacoesPagamento.mockResolvedValue([
    { id: 'p', competenciaPagamento: '2026-09', estadoBaixa: 'PENDENTE' },
    { id: 'q', competenciaPagamento: '2026-08', estadoBaixa: 'PENDENTE' },
    { id: 'r', competenciaPagamento: '2026-09', estadoBaixa: 'CONCLUIDA' },
    { id: 's', competenciaPagamento: '2026-09', estadoBaixa: 'SUBSTITUIDA' },
  ]);
  const r = await request(app()).get('/firm/companies/emp/avisos-contabeis?competencia=2026-09');
  expect(r.status).toBe(200); expect(r.body.total).toBe(2); expect(r.body.pagamentos.map(p => p.id)).toEqual(['p']); expect(r.body.historico).toEqual([{ id: 'h' }]);
});
test('detalhe e retomada usam empresa autorizada e identidade do contador', async () => {
  lerConfirmacaoPagamento.mockResolvedValue(null);
  expect((await request(app()).get('/firm/companies/emp/confirmacoes-pagamento/p')).status).toBe(404);
  tentarBaixaConfirmacao.mockResolvedValue({ ok: true, confirmacao: { estadoBaixa: 'PENDENTE' } });
  const r = await request(app()).post('/firm/companies/emp/confirmacoes-pagamento/p/retomar');
  expect(r.body.confirmacao.estadoBaixa).toBe('PENDENTE');
  expect(tentarBaixaConfirmacao).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'emp', confirmacaoId: 'p', actor: expect.objectContaining({ userId: 'u' }) }), prisma);
});

test('fechar com token atual não reutiliza checklist de lançamentos anteriores', async () => {
  const tx = {$executeRaw:jest.fn(async()=>1),accountingEntry:{findMany:jest.fn(async()=>[])},companyMonthlyCircular:{update:jest.fn()}};
  prisma.$transaction = jest.fn(async cb=>cb(tx));
  estadoCorrecaoTx.mockResolvedValue({versao:'versao-atual',correcao:{id:'c'},atual:{circular:{id:'circ',folhaProlaboreOk:true,despesasOk:true,receitasOk:true,provisoesOk:true,pagamentosOk:true}},conferencia:{valida:false,campos:{}}});
  const r = await request(app()).post('/firm/companies/emp/fechamento-contabil/2026-09/fechar').send({versao:'versao-atual'});
  expect(r.status).toBe(409);
  expect(r.body.error).toBe('CONFERENCIA_DESATUALIZADA');
  expect(tx.companyMonthlyCircular.update).not.toHaveBeenCalled();
  expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'Serializable'});
});
