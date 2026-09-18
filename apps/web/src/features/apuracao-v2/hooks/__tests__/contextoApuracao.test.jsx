import {act,renderHook,waitFor} from '@testing-library/react';
import {useApuracaoV2} from '../useApuracaoV2';
const feedback={notifyError:jest.fn()};
const apiBase=()=>({getCadastroFiscal:jest.fn(async id=>({cadastro:{id}})),getPerfilFiscal:jest.fn(async id=>({ok:true,id})),listProdutosServicos:jest.fn(async()=>({items:[]})),listPendencias:jest.fn(async()=>({items:[],counts:[]}))});
it('resposta tardia não mistura cadastro nem pendências de empresas',async()=>{
 const api=apiBase();let resolveA;api.getCadastroFiscal.mockImplementation(id=>id==='A'?new Promise(r=>{resolveA=r;}):Promise.resolve({cadastro:{id}}));
 const {result,rerender}=renderHook(({companyId,competencia})=>useApuracaoV2({api,feedback,companyId,competencia}),{initialProps:{companyId:'A',competencia:'2026-07'}});
 rerender({companyId:'B',competencia:'2026-08'});await waitFor(()=>expect(result.current.cadastro?.id).toBe('B'));
 await act(async()=>resolveA({cadastro:{id:'A'}}));expect(result.current.cadastro.id).toBe('B');
 expect(api.listPendencias).toHaveBeenLastCalledWith('B',{resolvida:false,competencia:'2026-08'});
});
it('falha de leitura fica explícita sem afirmar cadastro inexistente',async()=>{
 const api=apiBase();api.getCadastroFiscal.mockRejectedValue(new Error('indisponível'));
 const {result}=renderHook(()=>useApuracaoV2({api,feedback,companyId:'A',competencia:'2026-07'}));
 await waitFor(()=>expect(result.current.loadError).toBe('indisponível'));expect(result.current.loading).toBe(false);
});
