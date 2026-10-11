import { percentualSimplesDaPrevia } from '../percentualSimplesDaPrevia.js';
const apuracao = { competencia: '2026-10', estado: 'fechada', dasCalculadoLocalProcedencia: 'MOTOR_LOCAL', receitaPorTipo: { SERVICO_ANEXO_III: 10000 }, aliquotaEfetivaPorAnexo: { III: { receita: 10000, efetiva: 0.06 } } };
const circular = { competencia: '2026-10', pgdasNumeroDeclaracao: 'declaracao', metadata: { integrationSource: 'SERPRO_PGDASD_DECLARACAO', parsedPgdas: { receitaBruta: 10000, impostoApurado: 600, atividades: [{ receita: 10000, categoria: 'servico' }] } } };
function preparar(aps = [], cs = []) {
 const db = { apuracaoSnapshot: { findMany: jest.fn(async () => aps) }, companyMonthlyCircular: { findMany: jest.fn(async () => cs) } };
 return { db, run: (extra = {}) => percentualSimplesDaPrevia({ db, portalClientId: 'empresa', competencia: '2026-10-11', servicoUnico: true, ...extra }) };
}
test('preenche apuração da competência, convertendo fração em percentual e mantendo escopo', async () => {
 const {run,db}=preparar([apuracao]);expect(await run()).toMatchObject({estado:'AUTOMATICO',valor:6,fonte:'APURACAO_LOCAL',competencia:'2026-10'});
 expect(db.apuracaoSnapshot.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{portalClientId:'empresa',competencia:{lte:'2026-10'}}}));
});
test('PGDAS-D é referência conferível, sem usar DAS pago nem notas capturadas', async () => {
 expect(await preparar([], [{...circular,dasTotal:9999}]).run()).toMatchObject({estado:'REFERENCIA',valor:6,fonte:'PGDAS_D',referencia:'declaracao'});
});
test('competência anterior nunca é automática',async()=>expect(await preparar([{...apuracao,competencia:'2026-09'}]).run()).toMatchObject({estado:'REFERENCIA',exata:false}));
test('divergência com PGDAS-D exige confirmação',async()=>expect(await preparar([{...apuracao,aliquotaEfetivaPorAnexo:{III:{receita:10000,efetiva:0.08}}}],[circular]).run()).toMatchObject({estado:'REFERENCIA',mensagem:expect.stringContaining('divergem')}));
test.each([null, '', -0.1, 2])('alíquota inválida %s não preenche',async efetiva=>expect(await preparar([{...apuracao,aliquotaEfetivaPorAnexo:{III:{receita:10000,efetiva}}}]).run()).toMatchObject({estado:'INDISPONIVEL',valor:null}));
test('zero válido é preservado',async()=>expect(await preparar([{...apuracao,aliquotaEfetivaPorAnexo:{III:{receita:10000,efetiva:0}}}]).run()).toMatchObject({valor:0}));
test('receitas mistas e procedência ambígua não viram percentual do serviço',async()=>{
 expect(await preparar([{...apuracao,receitaPorTipo:{SERVICO_ANEXO_III:5000,REVENDA_MERCADORIA:5000}}]).run()).toMatchObject({estado:'INDISPONIVEL'});
 expect(await preparar([{...apuracao,dasCalculadoLocalProcedencia:'AMBIGUO'}]).run()).toMatchObject({estado:'INDISPONIVEL'});
 expect(await preparar([], [{...circular,metadata:{...circular.metadata,parsedPgdas:{...circular.metadata.parsedPgdas,atividades:[{receita:5000,categoria:'servico'},{receita:5000,categoria:'venda'}]}}}]).run()).toMatchObject({estado:'INDISPONIVEL'});
});
test('serviços diferentes exigem conferência e erro de leitura não libera valor',async()=>{
 const {run,db}=preparar([apuracao]);expect(await run({servicoUnico:false})).toMatchObject({estado:'INDISPONIVEL'});expect(db.apuracaoSnapshot.findMany).not.toHaveBeenCalled();
 db.apuracaoSnapshot.findMany.mockRejectedValue(new Error());expect(await run()).toMatchObject({estado:'INDISPONIVEL'});
});
