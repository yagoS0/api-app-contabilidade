jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../parcelamento/ComposicaoParcelamentoService.js', () => ({ composicaoHabilitada: () => false }));
import { executarBaixaProvisaoTx } from '../BaixaProvisaoService.js';

const provisao = { id: 'p', portalClientId: 'emp', tipo: 'PROVISAO', subtipo: 'DAS', eventType: 'DAS_SIMPLES', statusPagamento: 'ABERTO', updatedAt: new Date('2026-10-01'), lines: [{ tipo: 'D', conta: 'despesa', valor: 100 }, { tipo: 'C', conta: 'passivo', valor: 100 }], baixas: [] };
const args = { portalClientId: 'emp', entryId: 'p', dataPagamento: '2026-10-15', historico: 'Pagamento confirmado pelo cliente', userId: 'cliente', sourceGuideId: 'g', codigoTributo: '1234', lines: [{ tipo: 'D', conta: 'passivo', papel: 'PRINCIPAL', valor: 100 }, { tipo: 'D', conta: '501', papel: 'JUROS', valor: 2 }, { tipo: 'D', conta: '506', papel: 'MULTA', valor: 3 }, { tipo: 'C', conta: 'caixa', valor: 105 }] };
function tx() {
  return {
    companyMonthlyCircular: { findUnique: jest.fn(async () => null) },
    appSetting: { findUnique: jest.fn(async () => null) },
    accountingEntry: {
      findFirst: jest.fn(async () => provisao), updateMany: jest.fn(async () => ({ count: 1 })),
      create: jest.fn(async ({ data }) => ({ ...data, id: data.tipoLinha })),
      update: jest.fn(async () => ({ ...provisao, statusPagamento: 'PAGO' })),
      findUnique: jest.fn(async ({ where }) => ({ id: where.id, lines: [] })),
    }, accountingEntryLine: { createMany: jest.fn(async () => ({ count: 2 })) },
  };
}
test('baixa selecionada separa principal/juros/multa, mantém guia/código e mês de pagamento', async () => {
  const db = tx(); const result = await executarBaixaProvisaoTx(db, args);
  expect(result.entryIds).toEqual(['PRINCIPAL', 'JUROS', 'MULTA']);
  expect(db.accountingEntry.create.mock.calls.map(([a]) => a.data)).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceGuideId: 'g', codigoTributo: '1234', competencia: '2026-10', tipoLinha: 'PRINCIPAL', eventType: 'BAIXA_DAS_SIMPLES' }),
    expect.objectContaining({ tipoLinha: 'JUROS', eventType: null }), expect.objectContaining({ tipoLinha: 'MULTA', eventType: null }),
  ]));
  for (const [call] of db.accountingEntryLine.createMany.mock.calls) { expect(call.data).toHaveLength(2); expect(call.data[0].valor).toBe(call.data[1].valor); }
  expect(db.accountingEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ portalClientId: 'emp', id: 'p', updatedAt: provisao.updatedAt }) }));
});
test('fechamento no mês do pagamento impede escrita, mês tributário não é confundido', async () => {
  const db = tx(); db.companyMonthlyCircular.findUnique.mockResolvedValue({ fechadoContabilEm: new Date() });
  await expect(executarBaixaProvisaoTx(db, args)).rejects.toMatchObject({ code: 'MES_FECHADO', competencia: '2026-10' });
  expect(db.accountingEntry.create).not.toHaveBeenCalled(); expect(db.accountingEntry.updateMany).not.toHaveBeenCalled();
});
test('reserva concorrente não cria baixa', async () => {
  const db = tx(); db.accountingEntry.updateMany.mockResolvedValue({ count: 0 });
  await expect(executarBaixaProvisaoTx(db, args)).rejects.toMatchObject({ code: 'BAIXA_CONCORRENTE' });
  expect(db.accountingEntry.create).not.toHaveBeenCalled();
});
test('provisão de outro escopo e dados incompletos são recusados', async () => {
  const db = tx(); db.accountingEntry.findFirst.mockResolvedValue(null);
  await expect(executarBaixaProvisaoTx(db, args)).rejects.toMatchObject({ code: 'lancamento_nao_encontrado' });
  const db2 = tx();
  await expect(executarBaixaProvisaoTx(db2, { ...args, lines: args.lines.slice(1) })).rejects.toMatchObject({ code: 'BAIXA_DESBALANCEADA' });
  expect(db2.accountingEntry.create).not.toHaveBeenCalled();
});
test('cada débito mantém lançamento próprio mesmo com dois juros', async () => {
  const db = tx();
  await executarBaixaProvisaoTx(db, { ...args, sourceGuideId: null, lines: [...args.lines.slice(0, 3), { tipo: 'D', conta: '501', papel: 'JUROS', valor: 1 }, { tipo: 'C', conta: 'caixa', valor: 106 }] });
  expect(db.accountingEntry.create).toHaveBeenCalledTimes(4);
});

test('origem legada mantém MANUAL; R25 persiste CLIENTE e autoria completa na correção',async()=>{
 const antigo=tx();await executarBaixaProvisaoTx(antigo,args);expect(antigo.accountingEntry.create.mock.calls.every(([c])=>c.data.origem==='MANUAL')).toBe(true);
 const db=tx(),autor={id:'contador',origem:'CLIENTE',confirmadoPor:{contatoId:'ct'},confirmacaoId:'cf',canal:'WHATSAPP'};
 db.appSetting.findUnique.mockResolvedValue({value:{revision:1,active:{id:'corr'},history:[]}});db.appSetting.updateMany=jest.fn(async()=>({count:1}));db.appSetting.create=jest.fn();db.companyMonthlyCircular.updateMany=jest.fn();
 await executarBaixaProvisaoTx(db,{...args,origem:'CLIENTE',autorAuditoria:autor});
 expect(db.accountingEntry.create.mock.calls.every(([c])=>c.data.origem==='CLIENTE')).toBe(true);
 expect(db.appSetting.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({value:expect.objectContaining({tipo:'CORRECAO_ALTERACAO',autor})})}));
});
