import { reconciliarCalculoOperacoes } from '../OperationsCalculationService.js';
const requestId='11111111-1111-4111-8111-111111111111',companyId='a',competencia='2026-11';
function fixture(){
 const key=`operations_calculation:${companyId}:${competencia}`,value={attemptId:requestId,companyId,competencia,status:'UNCERTAIN',proof:{context:'origin',inputHash:'input'},fs12Expected:{revisao:2,contextoRevisao:'context'},preparedReceita:100};
 const rows=new Map([[key,value],[`${key}:request:${requestId}`,value]]);
 const command={id:'cmd',tentativaId:'try',intencao:'SIMULAR',revisaoFs12:2,contextoHash:'context',esperado:{preparacao:{operationsRequestId:requestId}}};
 const db={user:{findUnique:jest.fn(async()=>({id:'user',role:'admin',status:'active'}))},appSetting:{findUnique:jest.fn(async({where})=>rows.has(where.key)?{value:rows.get(where.key)}:null),upsert:jest.fn(async({create,update})=>rows.set(create.key,update.value))},fs12Comando:{findUnique:jest.fn(async()=>command)},fs12ComandoCalculo:{findMany:jest.fn(async()=>[{comandoId:'cmd',vinculoId:'binding'}])},apuracaoSnapshot:{findUnique:jest.fn(async()=>({idempotencyKey:'calc'}))},$queryRaw:jest.fn(async()=>[])};db.$transaction=fn=>fn(db);
 const recover=jest.fn(async()=>({ok:true,comandoId:'cmd',tentativaId:'try',operationsRequestId:requestId,calculoId:'calc',dasValor:6,snapshot:{idempotencyKey:'calc'}}));
 return {db,rows,key,command,recover,input:{companyId,competencia,userId:'user',requestId}};
}
test('projeção fiscal causal atualiza somente tentativa própria e replay não recupera novamente',async()=>{
 const f=fixture();const result=await reconciliarCalculoOperacoes(f.db,f.input,{recover:f.recover});
 expect(result.attempt).toMatchObject({status:'CALCULATED',requestId,calculation:{calculoId:'calc',imposto:6,receita:100}});
 expect(f.db.fs12ComandoCalculo.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({vinculo:{calculoId:'calc',contextoHash:'context'}})}));
 await reconciliarCalculoOperacoes(f.db,f.input,{recover:f.recover});expect(f.recover).toHaveBeenCalledTimes(1);
});
test('requestId de outro comando é recusado antes da recuperação',async()=>{
 const f=fixture();f.command.esperado.preparacao.operationsRequestId='other';
 await expect(reconciliarCalculoOperacoes(f.db,f.input,{recover:f.recover})).rejects.toThrow('causal');
 expect(f.recover).not.toHaveBeenCalled();expect(f.db.appSetting.upsert).not.toHaveBeenCalled();
});
test.each([{estado:'DESCONHECIDA',ok:true},{ok:true,historico:true,operationsRequestId:requestId,comandoId:'cmd',calculoId:'calc',snapshot:null},{ok:true,operationsRequestId:'other',comandoId:'cmd',calculoId:'calc',snapshot:{idempotencyKey:'calc'}}])('sem prova suficiente mantém UNCERTAIN %j',async result=>{
 const f=fixture();f.recover.mockResolvedValue(result);
 try{await reconciliarCalculoOperacoes(f.db,f.input,{recover:f.recover});}catch(error){expect(error.message).toMatch(/não comprova/);}
 expect(f.rows.get(f.key).status).toBe('UNCERTAIN');expect(f.db.appSetting.upsert).not.toHaveBeenCalled();
});
test('troca tentativa durante recuperação não sobrescreve pedido mais novo',async()=>{
 const f=fixture();const result=await f.recover();f.recover.mockImplementation(async()=>{f.rows.set(f.key,{...f.rows.get(f.key),attemptId:'new'});return result;});
 await expect(reconciliarCalculoOperacoes(f.db,f.input,{recover:f.recover})).rejects.toThrow('mudou');expect(f.db.appSetting.upsert).not.toHaveBeenCalled();
});

test.each([false,true])('encerramento causal sem despacho retorna REVIEW somente sem marker (%s)',async markerPresent=>{
 const f=fixture();Object.assign(f.command,{portalClientId:companyId,companyId:'legacy',competencia,autorId:'user'});
 const value={...f.rows.get(f.key),userId:'user'};f.rows.set(f.key,value);f.rows.set(`${f.key}:request:${requestId}`,value);
 f.db.fs12ComandoReserva={findUnique:jest.fn(async()=>({comandoId:'cmd',reservaId:'reservation'}))};
 f.rows.set('fs12_comando_sem_despacho:cmd',{versao:1,evento:'COMANDO_ENCERRADO_ANTES_DESPACHO',comandoId:'cmd',tentativaId:'try',portalClientId:companyId,companyId:'legacy',competencia,autorId:'user',encerradoEm:'2026-11-25T00:00:00Z',motivo:'CONFERENCIA_EXPLICITA_SEM_MARCADOR',reservaId:'reservation'});
 if(markerPresent)f.rows.set('serpro_dispatch:reservation',{started:true});
 f.recover.mockResolvedValue({ok:true,encerradaSemDespacho:true,estado:'NAO_TRANSMITIDA',comandoId:'cmd',tentativaId:'try'});
 if(markerPresent){await expect(reconciliarCalculoOperacoes(f.db,f.input,{recover:f.recover})).rejects.toThrow('bloqueio preservado');expect(f.rows.get(f.key).status).toBe('UNCERTAIN');}
 else{const out=await reconciliarCalculoOperacoes(f.db,f.input,{recover:f.recover});expect(out.attempt.status).toBe('REVIEW');expect(out.attempt.calculation).toBeNull();expect(out.attempt.errorCode).toBe('FS12_ENCERRADA_SEM_DESPACHO');}
 expect(f.db.fs12ComandoCalculo.findMany).not.toHaveBeenCalled();
});

test.each([false,true])('recusa causal precisa T3a/marker exatos; não vira cálculo (%s)',async tampered=>{
 const f=fixture();Object.assign(f.command,{portalClientId:companyId,companyId:'legacy',competencia,autorId:'user'});f.command.esperado.custodia={respostaId:'response'};
 const original={...f.rows.get(f.key),userId:'user'};f.rows.set(f.key,original);f.rows.set(`${f.key}:request:${requestId}`,original);
 f.db.fs12ComandoReserva={findUnique:jest.fn(async()=>({reservaId:'reservation'}))};
 f.db.fs12ComandoResposta={findUnique:jest.fn(async()=>({id:'response',comandoId:'cmd',reservaId:'reservation',marcadorKey:'serpro_dispatch:reservation',marcadorObservado:{started:true}}))};
 f.rows.set('serpro_dispatch:reservation',{started:!tampered});
 f.recover.mockResolvedValue({ok:false,estado:'REJEITADA',comandoId:'cmd',tentativaId:'try',operationsRequestId:requestId,respostaId:'response',revisaoFs12:2,portalClientId:companyId,competencia,motivo:'Série incompleta',mensagens:[{codigo:'[EntradaIncorreta-PGDASD-MSG_ISN_029]',texto:'Fixture rejeitada'}]});
 if(tampered){await expect(reconciliarCalculoOperacoes(f.db,f.input,{recover:f.recover})).rejects.toThrow('Custódia');expect(f.rows.get(f.key).status).toBe('UNCERTAIN');}
 else{const out=await reconciliarCalculoOperacoes(f.db,f.input,{recover:f.recover});expect(out.attempt.status).toBe('REVIEW');expect(out.attempt.calculation).toBeNull();expect(out.attempt.warnings[0]).toContain('029');}
 expect(f.db.fs12ComandoCalculo.findMany).not.toHaveBeenCalled();
});

test('conferência comum não solicita encerramento; intenção explícita é repassada separadamente',async()=>{
 const f=fixture();f.recover.mockResolvedValue({ok:true,estado:'DESCONHECIDA'});
 await reconciliarCalculoOperacoes(f.db,f.input,{recover:f.recover});
 expect(f.recover).toHaveBeenLastCalledWith(expect.objectContaining({encerrarSemDespacho:false}));
 await reconciliarCalculoOperacoes(f.db,{...f.input,encerrarSemDespacho:true,confirmEncerramentoSemDespacho:true,confirmCompetencia:competencia},{recover:f.recover});
 expect(f.recover).toHaveBeenLastCalledWith(expect.objectContaining({encerrarSemDespacho:true}));expect(f.db.appSetting.upsert).not.toHaveBeenCalled();
});

test('encerramento sem dupla confirmação/competência não chega à recuperação fiscal',async()=>{
 const f=fixture();await expect(reconciliarCalculoOperacoes(f.db,{...f.input,encerrarSemDespacho:true},{recover:f.recover})).rejects.toThrow('Confirme explicitamente');
 expect(f.recover).not.toHaveBeenCalled();expect(f.db.appSetting.upsert).not.toHaveBeenCalled();
});