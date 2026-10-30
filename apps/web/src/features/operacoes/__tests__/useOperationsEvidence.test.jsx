import {renderHook,waitFor,act} from '@testing-library/react';
import {useOperationsEvidence} from '../useOperationsEvidence';
const companies=[{companyId:'a'}];
const data=competencia=>({items:[{companyId:'a',competencia,revision:'r1',status:'CONFIRMED'}],total:1,competencia});
test('leitura em lote preserva competência e descarta retorno tardio',async()=>{
 let finish;const api={getOperationEvidence:jest.fn(c=>c==='2026-09'?new Promise(r=>{finish=r;}):Promise.resolve(data(c)))};
 const {result,rerender}=renderHook(({comp})=>useOperationsEvidence(api,comp,companies),{initialProps:{comp:'2026-09'}});
 await waitFor(()=>expect(finish).toBeDefined());rerender({comp:'2026-10'});await waitFor(()=>expect(result.current.items).toEqual(data('2026-10').items));await act(async()=>finish(data('2026-09')));expect(result.current.items).toEqual(data('2026-10').items);expect(api.getOperationEvidence).toHaveBeenCalledTimes(2);
});
test.each([{items:[],total:1,competencia:'2026-10'}, {...data('2026-10'),items:[{companyId:'a',competencia:'2026-09',revision:'r'}]}, {...data('2026-10'),ok:false}])('resposta incompleta/negativa não comprova conferência',async response=>{
 const api={getOperationEvidence:async()=>response};const {result}=renderHook(()=>useOperationsEvidence(api,'2026-10',companies));await waitFor(()=>expect(result.current.error).toBeTruthy());expect(result.current.items).toEqual([]);
});
test('sem capacidade não simula aprovações',async()=>{
 const {result}=renderHook(()=>useOperationsEvidence(null,'2026-10',companies));await waitFor(()=>expect(result.current.error).toMatch(/indisponíveis/));expect(result.current.items).toEqual([]);
});
