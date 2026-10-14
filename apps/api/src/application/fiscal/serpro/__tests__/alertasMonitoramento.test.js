import { alertasMonitoramento, anexarAlertasMonitoramento } from '../alertasMonitoramento';
const agora = new Date('2026-10-14T18:00:00Z');
const empresa = {portalClientId:'a',cnpj:'123',regime:'SIMPLES',estado:'aberta'};
const ativa = {procurationStatus:'ATIVA',checkedAt:'2026-10-14T17:00:00Z',validUntil:'2030-12-31',vinculoConfirmado:true};
const codigos = (item=empresa, proc=ativa, mes='2026-09') => alertasMonitoramento(item,proc,mes,agora).map(a=>a.codigo);
test('alerta vencimento e ausência sem inferir atraso de declaração',()=>{
 expect(codigos(empresa,{...ativa,validUntil:'2026-10-13'})).toEqual(['PROCURACAO_VENCIDA','PGDAS_COMPROVACAO_PENDENTE']);
 expect(codigos(empresa,{...ativa,procurationStatus:'AUSENTE',validUntil:null})).toEqual(['PROCURACAO_AUSENTE','PGDAS_COMPROVACAO_PENDENTE']);
 expect(codigos(empresa,{...ativa,validUntil:'2026-10-13',vinculoConfirmado:false})[0]).toBe('PROCURACAO_REVALIDAR');
 expect(codigos(empresa,{...ativa,procurationStatus:'AUSENTE',checkedAt:'2026-09-01'})[0]).toBe('PROCURACAO_REVALIDAR');
});
test.each(['ERROR','INCOMPLETE','RUNNING'])('falha %s é inconclusiva, não falta de entrega',extratoStatus=>{
 expect(codigos({...empresa,entregaPgdas:{extratoStatus}})).toEqual(['PGDAS_CONSULTA_INCONCLUSIVA']);
});
test('negativa explícita e desconhecimento têm alertas distintos',()=>{
 expect(codigos({...empresa,entregaPgdas:{extratoStatus:'NOT_FOUND'}})).toEqual(['PGDAS_NAO_LOCALIZADO']);
 expect(codigos()).toEqual(['PGDAS_COMPROVACAO_PENDENTE']);
});
test('prova externa ou interna prevalece sobre erro e mês aberto; documentos completos encerram alerta',()=>{
 const entregaPgdas={numeroDeclaracaoRfb:'123',temPdfDaDeclaracao:true,temRecibo:true,extratoStatus:'ERROR'};
 expect(codigos({...empresa,entregaPgdas})).toEqual([]);
 expect(codigos({...empresa,estado:'transmitida',numeroDeclaracao:'123',entregaPgdas:{temPdfDaDeclaracao:true,temRecibo:true}})).toEqual([]);
 expect(codigos({...empresa,entregaPgdas:{...entregaPgdas,temRecibo:false}})).toEqual(['PGDAS_DOCUMENTOS_INCOMPLETOS']);
});
test('mês corrente, futuro ou regime não confirmado não geram pendência fiscal presumida',()=>{
 expect(codigos(empresa,ativa,'2026-10')).toEqual([]);expect(codigos(empresa,ativa,'2026-11')).toEqual([]);
 expect(codigos({...empresa,regime:null})).toEqual([]);expect(codigos({...empresa,regime:'LUCRO_PRESUMIDO'})).toEqual([]);
});
test('releitura é determinística e elimina pendência quando comprovação chega',()=>{
 const primeiro=alertasMonitoramento(empresa,ativa,'2026-09',agora);
 expect(alertasMonitoramento(empresa,ativa,'2026-09',agora)).toEqual(primeiro);
 expect(new Set(primeiro.map(a=>a.id)).size).toBe(primeiro.length);
 expect(codigos({...empresa,entregaPgdas:{numeroDeclaracaoRfb:'123',temPdfDaDeclaracao:true,temRecibo:true}})).toEqual([]);
});
test('anexa somente à carteira recebida usando leitura salva, sem alterar estado',async()=>{
 const leitura=jest.fn(async()=>[{companyId:'a',serproStatus:ativa},{companyId:'outra',serproStatus:ativa}]);
 const out=await anexarAlertasMonitoramento([empresa],leitura,'2026-09',agora);
 expect(leitura).toHaveBeenCalledWith([{companyId:'a',cnpj:'123'}]);expect(out).toHaveLength(1);expect(out[0].estado).toBe('aberta');expect(empresa.alertasFiscais).toBeUndefined();
});
test('falha de leitura não impede fluxo original nem afirma zero alertas',async()=>{
 const out=await anexarAlertasMonitoramento([empresa],async()=>{throw Error('DB')},'2026-09',agora);
 expect(out).toEqual([{...empresa,monitoramentoErro:true}]);
});

test('não exige comprovante anterior à abertura/opção conhecidas',()=>{
 expect(codigos({...empresa,inicioMonitoramentoPgdas:'2026-10'})).toEqual([]);
 expect(codigos({...empresa,inicioMonitoramentoPgdas:'2026-09'})).toEqual(['PGDAS_COMPROVACAO_PENDENTE']);
});
