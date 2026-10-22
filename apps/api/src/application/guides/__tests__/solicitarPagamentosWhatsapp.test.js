jest.mock('../../fiscal/serpro/CompanyRotinasService.js',()=>({idsComRotinaAtiva:jest.fn()}));
import {solicitarPagamentosWhatsapp} from '../SolicitarPagamentosWhatsappService.js';
test('varre guias sem filtrar origem ou tributo, somente empresas habilitadas',async()=>{const db={feriado:{findMany:jest.fn(async()=>[])},guide:{findMany:jest.fn(async()=>[{id:'fgts',portalClientId:'c',vencimento:'2026-09-24'},{id:'iss',portalClientId:'c',vencimento:'2026-09-28'},{id:'futura',portalClientId:'c',vencimento:'2026-10-20'}])}};const avisar=jest.fn(async()=>({status:'ENVIADO'}));await solicitarPagamentosWhatsapp({scheduledAt:'2026-09-25',agora:new Date('2026-09-25T12:00Z')},{db,idsAtivos:async()=>['c'],avisar});const where=db.guide.findMany.mock.calls[0][0].where;expect(where).toMatchObject({portalClientId:{in:['c']},liberadaCliente:true,baixada:false});expect(where.source).toBeUndefined();expect(where.tipo).toBeUndefined();expect(avisar.mock.calls.map(c=>c[0].guideId)).toEqual(['fgts','iss']);});
test('execução manual não dispara solicitação automática',async()=>{const db={guide:{findMany:jest.fn()}};expect(await solicitarPagamentosWhatsapp({}, {db})).toEqual({total:0,resultados:[]});expect(db.guide.findMany).not.toHaveBeenCalled();});

test('pendências aparecem no resultado consumido pela tela de rotinas',async()=>{
 const db={feriado:{findMany:async()=>[]},guide:{findMany:async()=>[{id:'g',portalClientId:'c',vencimento:'2026-09-24'}]}};
 const aviso={status:'PENDENTE',razao:'Empresa',mensagem:'Guia sem entrega confirmada no WhatsApp.'};
 const r=await solicitarPagamentosWhatsapp({scheduledAt:'2026-09-25',agora:new Date('2026-09-25T12:00Z')},{db,idsAtivos:async()=>['c'],avisar:async()=>aviso});
 expect(r.avisosPendentes).toBe(1);expect(r.results).toEqual([{guideId:'g',...aviso}]);expect(r.results).toEqual(r.resultados);
});

test('empresa explicitamente solicitada fora da seleção não recebe aviso',async()=>{
 const db={guide:{findMany:jest.fn()}}; const avisar=jest.fn();
 await solicitarPagamentosWhatsapp({portalClientId:'desabilitada',scheduledAt:'2026-10-21'},{db,avisar,idsAtivos:async()=>['outra']});
 expect(avisar).not.toHaveBeenCalled();expect(db.guide.findMany).not.toHaveBeenCalled();
});

test('varredura inclui D0 e informa vencimento inválido sem chamar aviso nem inventar data', async () => {
 const db={feriado:{findMany:async()=>[]},guide:{findMany:async()=>[
  {id:'d0',portalClientId:'c',vencimento:'2026-09-25'},
  {id:'impossivel',portalClientId:'c',vencimento:'2026-02-30'},
  {id:'ausente',portalClientId:'c',vencimento:null},
 ]}};
 const avisar=jest.fn(async()=>({status:'ENVIADO'}));
 const r=await solicitarPagamentosWhatsapp({scheduledAt:'2026-09-25',agora:new Date('2026-09-25T12:00Z')},{db,idsAtivos:async()=>['c'],avisar});
 expect(avisar).toHaveBeenCalledTimes(1);expect(avisar.mock.calls[0][0].guideId).toBe('d0');
 expect(r.avisosPendentes).toBe(2);expect(r.results).toEqual([
  {guideId:'d0',status:'ENVIADO'},
  expect.objectContaining({guideId:'impossivel',status:'PENDENTE',motivo:'VENCIMENTO_INVALIDO'}),
  expect.objectContaining({guideId:'ausente',status:'PENDENTE',motivo:'VENCIMENTO_INVALIDO'}),
 ]);
});

test('consulta fiscal habilitada não seleciona empresa para lembretes', async () => {
 const db={guide:{findMany:jest.fn()}}; const avisar=jest.fn();
 const idsAtivos=jest.fn(async key=>key==='pagamento'?['c']:[]);
 await solicitarPagamentosWhatsapp({scheduledAt:'2026-09-25'}, {db,avisar,idsAtivos});
 expect(idsAtivos).toHaveBeenCalledWith('avisos_guias_whatsapp');
 expect(db.guide.findMany).not.toHaveBeenCalled();expect(avisar).not.toHaveBeenCalled();
});

test('revogação durante preparação é revalidada pelo callback antes do transporte', async () => {
 const db={feriado:{findMany:async()=>[]},guide:{findMany:async()=>[{id:'g',portalClientId:'c',vencimento:'2026-09-25'}]}};
 let selected=true;const send=jest.fn();
 const idsAtivos=jest.fn(async key=>key==='avisos_guias_whatsapp'&&selected?['c']:[]);
 const avisar=async ({assertActive})=>{selected=false;await assertActive();send();};
 const result=await solicitarPagamentosWhatsapp({scheduledAt:'2026-09-25',agora:new Date('2026-09-25T12:00Z')},{db,avisar,idsAtivos});
 expect(send).not.toHaveBeenCalled();expect(result.avisosPendentes).toBe(1);
 expect(idsAtivos.mock.calls.every(([key])=>key==='avisos_guias_whatsapp')).toBe(true);
});
