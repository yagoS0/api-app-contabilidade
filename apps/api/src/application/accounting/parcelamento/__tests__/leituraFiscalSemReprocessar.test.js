jest.mock('../../../../infrastructure/db/prisma.js', () => ({prisma:{
  parcelamento:{findMany:jest.fn(async()=>[])},
  parcelamentoIndicacao:{findMany:jest.fn(async()=>[])},
  appSetting:{findMany:jest.fn(async()=>[])},
  guide:{findMany:jest.fn(async()=>[])},
  companyMonthlyCircular:{findMany:jest.fn(async()=>[])},
}}));
jest.mock('../../../fiscal/serpro/ParcelamentoDescobertaService.js', () => ({reprocessarSitfisParcelamentos:jest.fn()}));
jest.mock('../../../guides/EnvioGuiaService.js', () => ({enviosPorGuia:jest.fn(async()=>new Map())}));
import { listarPendenciasParcelamento } from '../ParcelamentoAcompanhamentoService.js';
import { reprocessarSitfisParcelamentos } from '../../../fiscal/serpro/ParcelamentoDescobertaService.js';
import { prisma } from '../../../../infrastructure/db/prisma.js';
import { computeGuideComplianceMap } from '../../../guides/guideCompliance.js';

test('leitura fiscal sem escrita e relatório por vencimento com o comportamento anterior', async () => {
  const entrada={portalClientIds:['empresa'],mesOperacional:'2026-10'};
  await listarPendenciasParcelamento({...entrada,porCompetencia:true});
  expect(reprocessarSitfisParcelamentos).not.toHaveBeenCalled();
  await listarPendenciasParcelamento(entrada);
  expect(reprocessarSitfisParcelamentos).toHaveBeenCalledTimes(1);
  expect(reprocessarSitfisParcelamentos).toHaveBeenCalledWith({portalClientId:'empresa'});
});

test('a projeção da carteira divulga cobertura inconclusiva por empresa antes de qualquer obrigação mensal', async () => {
  prisma.parcelamentoIndicacao.findMany.mockResolvedValueOnce([{id:'i',portalClientId:'a',status:'PENDENTE'}]);
  const rows=['a','b'].map(portalId=>({portalId,legacy:{regimeTributario:'MEI'}}));
  const resultado=await computeGuideComplianceMap(rows,'2026-10');
  expect(resultado.get('a')).toMatchObject({expectativaParcelamentoInconclusiva:true,parcDas:{required:false}});
  expect(resultado.get('b')).toMatchObject({expectativaParcelamentoInconclusiva:false,parcDas:{required:false}});
});
