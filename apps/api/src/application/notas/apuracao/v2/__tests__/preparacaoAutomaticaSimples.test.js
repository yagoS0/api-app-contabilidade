jest.mock('../../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../../../../fiscal/serpro/SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { hasCertificate: true, document: '11111111111111' } })) }));
jest.mock('../FolhaDerivadaService.js', () => ({ derivarFolha12m: jest.fn(async () => ({ total: 10 })) }));
import { prepararSimplesConsistente, conferirProvaAutomatica } from '../PreparacaoAutomaticaSimples.js';
import { getDadosFechamento } from '../FechamentoService.js';
import { derivarFolha12m } from '../FolhaDerivadaService.js';
import { criarVinculoCalculo, validarCalculoConfirmado, hashCalculo } from '../CalculoConfirmado.js';

const args = { portalClientId: 'fixture-snapshot', competencia: '2026-10' };
function fixture() {
  const model = value => ({ findUnique: jest.fn(async () => value), findMany: jest.fn(async () => Array.isArray(value) ? value : []) });
  const tx = {
    portalClient: model({ id: args.portalClientId, cnpj: '11222333000181', razao: 'SINTETICA', companyId: null }),
    cadastroFiscal: model({ regime: 'SIMPLES_NACIONAL', regimeApuracao: 'COMPETENCIA', cnaePrincipal: '6201501' }),
    company: model(null), companyMonthlyCircular: model(null), entregaObrigacaoArquivo: model(null),
    portalInvoice: model([{ id: 'nota1', total: 100, competencia: new Date('2026-10-01'), itens: [{ id: 'item1', valor: 100, tipoReceita: 'SERVICO', flagExportacao: false }] }]),
    apuracaoConfigMemory: model(null), atividadePgdasd: model([{ idAtividade: 1, tipoReceita: 'SERVICO', mercado: 'INTERNO', sujeitoFatorR: false, anexoImplicito: 'III' }]),
    cnaeAnexo: model(null), rbtExtratoCache: model(null), accountingEntry: model([]), apuracaoSnapshot: model(null),
    appSetting: model(null), apuracaoPeriodoRecusado: model([]), serproChamada: { findFirst: jest.fn(async () => null) },
  };
  const db = { portalClient: tx.portalClient, $transaction: jest.fn(async (run, options) => {
    expect(options).toEqual({ isolationLevel: 'RepeatableRead' });
    return run(tx);
  }) };
  return { db, tx };
}
beforeEach(() => jest.clearAllMocks());

test('captura real propaga tx a todos os helpers, sem prisma global, escrita ou diagnóstico de folha', async () => {
  const { db, tx } = fixture();
  const result = await prepararSimplesConsistente(args, { db });
  expect(result.dados.faturamento.total).toBe(100);
  expect(result.prova.atividades).toEqual(expect.arrayContaining([expect.objectContaining({ valorInterno: 100, sujeitoFatorR: false })]));
  expect(result.hash).toBe(hashCalculo(result.prova));
  expect(result.dados.folhaDerivada).toBeNull();
  expect(derivarFolha12m).not.toHaveBeenCalled();
  for (const name of ['portalClient', 'cadastroFiscal', 'companyMonthlyCircular', 'entregaObrigacaoArquivo', 'apuracaoConfigMemory', 'atividadePgdasd', 'cnaeAnexo', 'rbtExtratoCache', 'accountingEntry', 'apuracaoSnapshot']) expect(tx[name].findUnique.mock.calls.length + tx[name].findMany.mock.calls.length).toBeGreaterThan(0);
  expect(db.$transaction).toHaveBeenCalledTimes(1);
});
test('modo manual mantém diagnóstico de folha; modo automático nunca o substitui por zero', async () => {
  const { tx } = fixture();
  // Sem escrita de cache: registro legado SIMULACAO só neste teste manual de apresentação.
  tx.rbtExtratoCache.findUnique.mockResolvedValue({ rbt12: 20, origem: 'SIMULACAO', detalhePorMes: [] });
  expect((await getDadosFechamento({ ...args, db: tx })).folhaDerivada).toEqual({ total: 10 });
  expect(derivarFolha12m).toHaveBeenCalledWith({ ...args, client: tx });
});
test.each(['companyMonthlyCircular', 'entregaObrigacaoArquivo', 'cnaeAnexo', 'accountingEntry'])('falha %s não produz prova/default apto', async name => {
  const { db, tx } = fixture();
  const error = new Error(`falha ${name}`);
  tx[name].findUnique.mockRejectedValue(error); tx[name].findMany.mockRejectedValue(error);
  await expect(prepararSimplesConsistente(args, { db })).rejects.toThrow(error);
});
test('falha no catálogo da memória é estrita e não vira lista vazia', async () => {
  const { db, tx } = fixture();
  tx.apuracaoConfigMemory.findUnique.mockResolvedValue({ atividadesEscolhidas: [{ idAtividade: 1, sujeitoFatorR: false }] });
  tx.atividadePgdasd.findMany.mockRejectedValue(new Error('catálogo indisponível'));
  await expect(prepararSimplesConsistente(args, { db })).rejects.toThrow('catálogo indisponível');
});
test('falha no fallback Company é estrita', async () => {
  const { db, tx } = fixture();
  tx.portalClient.findUnique.mockResolvedValue({ cnpj: '11222333000181', companyId: 'company' });
  tx.cadastroFiscal.findUnique.mockResolvedValue(null);
  tx.company.findUnique.mockRejectedValue(new Error('Company indisponível'));
  await expect(prepararSimplesConsistente(args, { db })).rejects.toThrow('Company indisponível');
});
test('tx sem garantia RepeatableRead é recusado como raiz da captura', async () => {
  const { tx } = fixture();
  await expect(prepararSimplesConsistente(args, { db: tx })).rejects.toMatchObject({ code: 'CALCULO_DESATUALIZADO' });
});
test('marcador automático impede remover prova ou trocar versão; legado v1 permanece válido', () => {
  const formulario = { atividades: [], folhaMensal12: [], regimeApuracao: 'COMPETENCIA' };
  const prova = { fonte: 'sintetica' };
  const v = criarVinculoCalculo({ ...args, formulario, preparacaoAutomatica: { versao: 1, attemptId: 'a', revision: 1, hash: hashCalculo(prova), prova } });
  const snap = { idempotencyKey: v.calculoId, atividadesEscolhidas: [], folhaMensal12: [], simulacaoSerpro: { _portalCalculo: v } };
  expect(validarCalculoConfirmado(snap, { ...args, calculoId: v.calculoId })).toEqual(v);
  for (const patch of [{ preparacaoAutomatica: undefined }, { preparacaoAutomatica: { ...v.preparacaoAutomatica, versao: 2 } }, { origemCalculo: undefined }]) {
    const modified = { ...v, ...patch }; const { calculoId: _, ...data } = modified;
    modified.calculoId = `fech:auto:sintetico:${hashCalculo(data)}`;
    expect(() => validarCalculoConfirmado({ ...snap, idempotencyKey: modified.calculoId, simulacaoSerpro: { _portalCalculo: modified } }, { ...args, calculoId: modified.calculoId })).toThrow();
  }
  const old = criarVinculoCalculo({ ...args, formulario });
  expect(validarCalculoConfirmado({ ...snap, idempotencyKey: old.calculoId, simulacaoSerpro: { _portalCalculo: old } }, { ...args, calculoId: old.calculoId })).toEqual(old);
});
test('prova íntegra sem vínculo persistido da tentativa não libera cálculo automático', async () => {
  const { db } = fixture(); db.appSetting = { findUnique: jest.fn(async () => null) };
  const prova = { fonte: 'sintetica' };
  const v = criarVinculoCalculo({ ...args, formulario: { atividades: [], folhaMensal12: [], regimeApuracao: 'COMPETENCIA' }, preparacaoAutomatica: { versao: 1, attemptId: 'a', revision: 1, prova, hash: hashCalculo(prova) } });
  await expect(conferirProvaAutomatica({ idempotencyKey: v.calculoId, simulacaoSerpro: { _portalCalculo: v } }, args, { db })).rejects.toMatchObject({ code: 'CALCULO_DESATUALIZADO' });
});

test('ordem de conjuntos não muda prova; ordem capturada do payload não é reescrita', async () => {
  const { db, tx } = fixture();
  const notes = [
    { id: 'n1', total: 100, competencia: new Date('2026-10-01'), itens: [{ id: 'i1', valor: 100, tipoReceita: 'SERVICO', flagExportacao: false }] },
    { id: 'n2', total: 20, competencia: new Date('2026-10-01'), itens: [{ id: 'i2', valor: 20, tipoReceita: 'COMERCIO', flagExportacao: false }] },
  ];
  tx.portalInvoice.findMany.mockResolvedValue(notes);
  tx.atividadePgdasd.findMany.mockResolvedValue([
    { idAtividade: 1, tipoReceita: 'SERVICO', mercado: 'INTERNO', sujeitoFatorR: false },
    { idAtividade: 2, tipoReceita: 'COMERCIO', mercado: 'INTERNO', sujeitoFatorR: false },
  ]);
  const first = await prepararSimplesConsistente(args, { db });
  tx.portalInvoice.findMany.mockResolvedValue([...notes].reverse());
  const second = await prepararSimplesConsistente(args, { db });
  expect(second.hash).toBe(first.hash);
  expect(second.dados.atividades.map(a => a.idAtividade)).toEqual(first.dados.atividades.map(a => a.idAtividade).reverse());
});

test('recusas capturadas e cache de períodos aceitos preservam a mesma prova/payload após sucesso', async () => {
  const { db, tx } = fixture();
  const cache = { rbt12: 0, origem: 'PARCIAL_LOCAL', detalhePorMes: [], periodosAceitos: null, periodosAceitosEm: null };
  tx.rbtExtratoCache.findUnique.mockImplementation(async ({ select }) => select ? Object.fromEntries(Object.keys(select).map(key => [key, cache[key]])) : { ...cache });
  const first = await prepararSimplesConsistente(args, { db });
  const pa = first.parametrosPreparados.receitasBrutasAnteriores[0].pa;
  const hashOriginal = tx.apuracaoPeriodoRecusado.findMany.mock.calls[0][0].where.insumosHash;
  tx.apuracaoPeriodoRecusado.findMany.mockImplementation(async ({ where }) => where.insumosHash === hashOriginal ? [{ lista: 'receitas', pa }] : []);
  const second = await prepararSimplesConsistente(args, { db });
  expect(second.parametrosPreparados.receitasBrutasAnteriores.some(p => p.pa === pa)).toBe(false);
  expect(first.parametrosPreparados.receitasBrutasAnteriores.some(p => p.pa === pa)).toBe(true);
  expect(second.hash).not.toBe(first.hash);
  // O salvamento existente grava apenas estes dois campos, sem tocar origem/RBT.
  cache.periodosAceitos = { receitas: second.parametrosPreparados.receitasBrutasAnteriores.map(p => p.pa), folhas: [] };
  cache.periodosAceitosEm = new Date();
  const afterSuccess = await prepararSimplesConsistente(args, { db });
  expect(afterSuccess.parametrosOriginais).not.toEqual(second.parametrosOriginais);
  expect(afterSuccess.parametrosPreparados).toEqual(second.parametrosPreparados);
  expect(afterSuccess.hash).toBe(second.hash);
  expect(tx.apuracaoPeriodoRecusado).not.toHaveProperty('upsert');
  expect(db.$transaction).toHaveBeenCalledTimes(3);
});
