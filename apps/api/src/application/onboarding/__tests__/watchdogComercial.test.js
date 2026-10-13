jest.mock('../ContingenciaComercialService.js',()=>({encaminharContingenciaComercial:jest.fn()}));
import { processarContingenciasComerciaisUmaVez, consultaContingenciasComerciais } from '../WatchdogComercialService.js';

it('encaminha sem envio, pede revalidação transacional e isola uma falha dos demais atendimentos',async()=>{
 const client={$queryRaw:jest.fn().mockResolvedValue([
  {conversaId:'a',mensagemId:'m1',motivo:'RESPOSTA_ATRASADA'},
  {conversaId:'b',mensagemId:'m2',motivo:'FALHA_ENVIO'},
  {conversaId:'c',mensagemId:'m3',motivo:'TURNO_ESGOTADO'},
 ])};
 const encaminhar=jest.fn().mockRejectedValueOnce({code:'DB_OFF'}).mockResolvedValueOnce({encaminhado:true}).mockResolvedValueOnce({encaminhado:false});
 const agora=new Date('2026-10-13T12:00:00Z');const log={error:jest.fn()};
 expect(await processarContingenciasComerciaisUmaVez({client,agora,encaminhar,log})).toEqual({encontrados:3,encaminhados:1,falhas:1});
 expect(encaminhar).toHaveBeenNthCalledWith(2,{conversaId:'b',mensagemId:'m2',motivo:'FALHA_ENVIO',client,agora,exigirSemResposta:true});
 expect(log.error).toHaveBeenCalledTimes(1);
});

it('mantém janela de cinco minutos e limite pequeno parametrizados no SQL',()=>{
 const q=consultaContingenciasComerciais({agora:new Date('2026-10-13T12:00:00Z'),limite:10000});
 expect(q.values).toContain('2026-10-13T11:55:00.000Z');
 expect(q.values.at(-1)).toBe(100);
});

