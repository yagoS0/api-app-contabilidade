import { lerMarcosAgenda } from '../lerMarcosAgenda';
import { criarLeiturasAgenda } from '../leiturasAgenda';

test('consulta só marcos, preserva os globais e filtra período e empresa',async()=>{
 const api={listMarcosFiscais:jest.fn(async()=>({ok:true,marcos:[
  {id:'global',data:'2026-10-01T00:00:00.000Z',portalClientId:null},
  {id:'a',data:'2026-10-02',portalClientId:'a'},
  {id:'b',data:'2026-10-02',portalClientId:'b'},
  {id:'fora',data:'2026-11-01',portalClientId:'a'}]})),getCalendario:jest.fn()};
 const cache=criarLeiturasAgenda();
 expect((await lerMarcosAgenda(api,cache,['2026-09-28','2026-10-04'],'a')).map(i=>i.id)).toEqual(['global','a']);
 await lerMarcosAgenda(api,cache,['2026-10-01','2026-10-07'],'a');
 expect(api.listMarcosFiscais).toHaveBeenCalledTimes(1);
 expect(api.getCalendario).not.toHaveBeenCalled();
});
