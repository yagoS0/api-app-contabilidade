import { executarConsultaAutomatica } from '../ConsultaPagamentoAutomaticaService.js';
jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../CompanySerproPolicy.js', () => ({ empresaDaChamada: jest.fn(), conferirPoliticaSerpro: jest.fn(), bloquearPoliticaEmpresa: jest.fn() }));
jest.mock('../SerproRespostaCache.js', () => ({ chaveResposta: jest.fn(), lerResposta: jest.fn(async () => null), guardarResposta: jest.fn() }));
jest.mock('../SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ baseUrl: 'https://invalid.test', timeoutMs: 100 })) }));
jest.mock('axios', () => ({ request: jest.fn(), isAxiosError: () => false }));
import axios from 'axios';
import { prisma } from '../../../../infrastructure/db/prisma.js';
import { autorizarDespacho, concluirChamada } from '../SerproCallGuard.js';
import * as callGuard from '../SerproCallGuard.js';
import { lerResposta } from '../SerproRespostaCache.js';
import { SerproHttpClient } from '../SerproHttpClient.js';
import { comAutomacaoCicloFiscal, comAutomacaoEmpresa, comVerificacaoTentativaAutomatica, conferirContextoCicloFiscal, conferirTentativaAutomaticaDespacho, conferirTentativaAutomaticaAntesSimulacao } from '../../automacaoCicloFiscalContext.js';
const paused = { paused: true, version: 1, reason: 'Pausa', actor: { id: 'u' }, changedAt: '2026-11-01T10:00:00Z', resumedAt: null };
afterEach(() => jest.restoreAllMocks());
beforeEach(() => {
  jest.clearAllMocks();
  lerResposta.mockResolvedValue(null);
  prisma.appSetting = { findUnique: jest.fn(async ({ where }) => where.key === 'automacao_ciclo_fiscal' ? { value: paused } : null), create: jest.fn() };
  prisma.serproChamada = { findUnique: jest.fn(async () => ({ id: 'r', status: 'reservada', portalClientId: null })), updateMany: jest.fn(async () => ({ count: 1 })) };
  prisma.$queryRaw = jest.fn(); prisma.$transaction = async run => run(prisma);
});

function tentativa(verificar, run, id = 'a') {
  return comAutomacaoCicloFiscal({ version: 0 }, () => comAutomacaoEmpresa(id, () => comVerificacaoTentativaAutomatica({ portalClientId: id, competencia: '2026-10', verificar }, run)));
}
function ativo() {
  prisma.appSetting.findUnique.mockResolvedValue(null);
  prisma.portalClient = { findUnique: jest.fn(async ({ where }) => ({ id: where.id, cnpj: '12345678000190' })) };
  prisma.serproChamada.findUnique.mockImplementation(async ({ where }) => ({ id: where.id, status: 'reservada', portalClientId: where.id === 'b' ? 'b' : 'a' }));
}

test.each([['LEGADO','RELATIVO_V1'],['RELATIVO_V1','LEGADO']])('modo %s→%s durante autenticação impede HTTP real',async(initial,next)=>{
 ativo();const records=new Map();
 if(initial!=='LEGADO')records.set('agenda_eventos_modo:v1:a',{schemaVersion:1,version:1,executionMode:initial,updatedAt:'2026-11-01T11:00:00Z',updatedBy:'u'});
 prisma.appSetting.findUnique.mockImplementation(async({where})=>records.has(where.key)?{key:where.key,value:records.get(where.key)}:null);
 prisma.appSetting.create.mockImplementation(async({data})=>{if(records.has(data.key))throw Object.assign(Error('duplicate'),{code:'P2002'});records.set(data.key,data.value);return data;});
 prisma.appSetting.update=jest.fn(async({where,data})=>{records.set(where.key,data.value);return data;});
 jest.spyOn(callGuard,'autorizarChamada').mockResolvedValue({id:'a',inicio:Date.now()});
 const auth={authenticate:jest.fn(async()=>{records.set('agenda_eventos_modo:v1:a',{schemaVersion:1,version:2,executionMode:next,updatedAt:'2026-11-02T11:00:00Z',updatedBy:'u'});return{};}),buildHttpsAgent:jest.fn(async()=>({}))};
 const input={companyId:'a',guideId:'g',scheduledAt:'2026-11-24T11:00:00Z',executionMode:initial};
 await expect(comAutomacaoCicloFiscal({version:0,scheduledAt:input.scheduledAt},()=>comAutomacaoEmpresa('a',()=>executarConsultaAutomatica(input,()=>new SerproHttpClient({authService:auth}).post('/Consultar',{contribuinte:{numero:'12345678000190'}}),prisma)))).rejects.toMatchObject({code:'AUTOMACAO_EMPRESA_AGENDA_ALTERADA'});
 expect(axios.request).not.toHaveBeenCalled();expect(records.has('serpro_dispatch:a')).toBe(false);
 expect(records.get('pagamento_auto_tentativa:guia:g')).toMatchObject({status:'REVISAO',executionMode:initial});
 const network=jest.fn();await executarConsultaAutomatica({...input,executionMode:next},network,prisma);expect(network).not.toHaveBeenCalled();
});
test('claim reutilizado revalida modo e não cria reserva por revisão nova',async()=>{
 ativo();const records=new Map();
 prisma.appSetting.findUnique.mockImplementation(async({where})=>records.has(where.key)?{key:where.key,value:records.get(where.key)}:null);
 prisma.appSetting.create.mockImplementation(async({data})=>{if(records.has(data.key))throw Object.assign(Error('duplicate'),{code:'P2002'});records.set(data.key,data.value);return data;});
 prisma.appSetting.update=jest.fn(async({where,data})=>{records.set(where.key,data.value);return data;});
 const input={companyId:'a',guideId:'g',scheduledAt:'2026-11-24T11:00:00Z'},network=jest.fn();
 await executarConsultaAutomatica(input,async()=>{
   records.set('agenda_eventos_modo:v1:a',{schemaVersion:1,version:1,executionMode:'RELATIVO_V1',updatedAt:'2026-11-02T11:00:00Z',updatedBy:'u'});
   expect(await executarConsultaAutomatica(input,network,prisma)).toMatchObject({skipped:'acompanhamento_exclusivo'});return {pago:false};
 },prisma);
 expect(network).not.toHaveBeenCalled();expect([...records.keys()].filter(k=>k.startsWith('pagamento_auto_tentativa:'))).toEqual(['pagamento_auto_tentativa:guia:g']);
});
