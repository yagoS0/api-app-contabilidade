import {chaveAvisoRotina,elegivelLimparAviso,estadoExecucaoRotina} from '../rotinasPresentation';
const row={routine:'das',enabled:true,alive:true,lastRun:{status:'FAILED',scheduledAt:'2026-10-14T10:00:00Z',finishedAt:'2026-10-14T10:01:00Z',error:'forbidden',result:{failed:1}}};
test('visto não altera resultado fiscal e usa identificação exata',()=>{const before=JSON.stringify(row),key=chaveAvisoRotina(row);expect(elegivelLimparAviso(row)).toBe(true);expect(estadoExecucaoRotina(row,true)).toBe('Falha já vista');expect(JSON.stringify(row)).toBe(before);for(const patch of[{scheduledAt:'2026-11-14T10:00:00Z'},{finishedAt:'2026-10-14T10:02:00Z'},{error:'Outro erro'},{result:{failed:2}}])expect(chaveAvisoRotina({...row,lastRun:{...row.lastRun,...patch}})).not.toBe(key);});
test.each([{status:'RUNNING'},{finishedAt:null},{finishedAt:'inválido'},{error:'SCHEDULE_LEASE_LOST'},{error:'CONSULTA_NAO_CONCLUIDA'},{result:{results:[{status:'INDETERMINADO'}]}},{result:{outcomeUnknown:true}},{error:'Consulta sem conclusão.'}])('não permite limpar execução sem conclusão segura %o',patch=>{const r={...row,lastRun:{...row.lastRun,...patch}};expect(elegivelLimparAviso(r)).toBe(false);expect(estadoExecucaoRotina(r,true)).not.toBe('Falha já vista');});
test('problemas atuais do executor precedem falha vista',()=>{expect(estadoExecucaoRotina({...row,interrupted:true},true)).toBe('Execução interrompida');expect(elegivelLimparAviso({...row,interrupted:true})).toBe(false);expect(estadoExecucaoRotina({...row,alive:false},true)).toBe('Sem sinal do executor');expect(estadoExecucaoRotina({...row,enabled:false},true)).toBe('Desativada');});

test.each([
 [{interrupted:true,lastRun:{status:'RUNNING'}},'Execução interrompida'],
 [{alive:false,lastRun:{status:'RUNNING'}},'Sem sinal do executor'],
 [{},'Consultar falha'],
 [{overdue:true,lastRun:null},'Horário não executado'],
])('pausa preserva diagnóstico existente %o', (patch,diagnostico)=>{
 for(const gate of [{automationPaused:true},{automationPolicyUnavailable:true}]){
  const input={...row,...patch,...gate},before=JSON.stringify(input);
  expect(estadoExecucaoRotina(input)).toContain(diagnostico);
  expect(estadoExecucaoRotina(input)).toContain(gate.automationPaused?'Pausa geral ativa':'novas execuções bloqueadas');
  expect(estadoExecucaoRotina(input)).not.toContain('retorno em andamento');
  expect(JSON.stringify(input)).toBe(before);
 }
});
test('pausa só informa retorno em andamento para execução viva e sem indeterminação',()=>{
 const running={...row,lastRun:{status:'RUNNING'},automationPaused:true};
 expect(estadoExecucaoRotina(running)).toBe('Pausa ativa · retorno em andamento');
 expect(estadoExecucaoRotina({...running,lastRun:{status:'RUNNING',error:'SCHEDULE_LEASE_LOST'}})).toBe('Pausa geral ativa · Resultado a conferir');
 expect(estadoExecucaoRotina({...row,automationPaused:true},true)).toBe('Pausa geral ativa · Falha já vista');
});