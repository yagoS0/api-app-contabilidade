import React, {useEffect} from 'react';
import {act,renderHook,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {useManageCompaniesWorkspace} from '../useManageCompaniesWorkspace';
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject}};
const row=competencia=>[{companyId:'A',fluxoCarteira:{competencia}}];
function setup(url='/companies'){
 const requests=[];
 const api={listCompanies:jest.fn(comp=>{const d=deferred();requests.push({comp,...d});return d.promise}),getSerproSettings:jest.fn(()=>new Promise(()=>{})),getSerproStatus:jest.fn(()=>new Promise(()=>{}))};
 const feedback={clearFeedback:jest.fn(),setError:jest.fn(),setMessage:jest.fn()};
 const wrapper=({children})=><MemoryRouter initialEntries={[url]} future={{v7_startTransition:true,v7_relativeSplatPath:true}}>{children}</MemoryRouter>;
 return {api,feedback,requests,wrapper};
}
test('reload URL agosto inicia somente leituras de agosto',()=>{
 const s=setup('/companies?competencia=2026-08&operacoesCompetencia=2026-08');
 const h=renderHook(()=>useManageCompaniesWorkspace({api:s.api,page:'companies',feedback:s.feedback}),{wrapper:s.wrapper});
 expect(h.result.current.dashboardCompetencia).toBe('2026-08');
 expect(s.requests.length).toBeGreaterThan(0);expect(s.requests.every(r=>r.comp==='2026-08')).toBe(true);
});
test('resposta do mês antigo após mês novo não substitui carteira',async()=>{
 const s=setup();const h=renderHook(()=>useManageCompaniesWorkspace({api:s.api,page:'companies',feedback:s.feedback}),{wrapper:s.wrapper});
 const old=[...s.requests];act(()=>h.result.current.changeDashboardCompetencia('2026-08'));
 const latest=s.requests.at(-1);await act(async()=>latest.resolve(row('2026-08')));
 await act(async()=>old.forEach(r=>r.resolve(row(r.comp))));
 expect(h.result.current.companiesState.companies).toEqual(row('2026-08'));
});
test('falha antiga não encerra loading nem mostra erro da nova leitura',async()=>{
 const s=setup();const h=renderHook(()=>useManageCompaniesWorkspace({api:s.api,page:'companies',feedback:s.feedback}),{wrapper:s.wrapper});
 const old=[...s.requests];act(()=>h.result.current.changeDashboardCompetencia('2026-08'));
 await act(async()=>old.forEach(r=>r.reject(Error('setembro antigo'))));
 expect(h.result.current.companiesState.loadingCompanies).toBe(true);expect(s.feedback.setError).not.toHaveBeenCalled();
 await act(async()=>s.requests.at(-1).resolve(row('2026-08')));
 expect(h.result.current.companiesState.loadingCompanies).toBe(false);
});
test('efeito filho restaura agosto antes de efeitos iniciais do proprietário',async()=>{
 const s=setup();
 function Child({w}){useEffect(()=>{w.changeDashboardCompetencia('2026-08')},[]);return <span>{w.dashboardCompetencia}:{w.companiesState.companies[0]?.fluxoCarteira.competencia || '-'}</span>}
 function Parent(){const w=useManageCompaniesWorkspace({api:s.api,page:'companies',feedback:s.feedback});return <Child w={w}/>}
 render(<s.wrapper><Parent/></s.wrapper>);
 expect(s.requests.every(r=>r.comp==='2026-08')).toBe(true);
 await act(async()=>s.requests.forEach(r=>r.resolve(row(r.comp))));
 expect(screen.getByText('2026-08:2026-08')).toBeTruthy();
});
test('reset invalida leitura e impede repovoar carteira',async()=>{
 const s=setup();const h=renderHook(()=>useManageCompaniesWorkspace({api:s.api,page:'companies',feedback:s.feedback}),{wrapper:s.wrapper});
 act(()=>h.result.current.resetWorkspace());await act(async()=>s.requests.forEach(r=>r.resolve(row(r.comp))));
 expect(h.result.current.companiesState.companies).toEqual([]);
});
test('falha vigente continua visível e carregamento termina',async()=>{
 const s=setup();const h=renderHook(()=>useManageCompaniesWorkspace({api:s.api,page:'companies',feedback:s.feedback}),{wrapper:s.wrapper});
 await act(async()=>s.requests.forEach(r=>r.reject(Error('falha vigente'))));
 expect(s.feedback.setError).toHaveBeenLastCalledWith('falha vigente');expect(h.result.current.companiesState.loadingCompanies).toBe(false);
});
test('duas atualizações da mesma competência preservam a mais recente',async()=>{
 const s=setup();const h=renderHook(()=>useManageCompaniesWorkspace({api:s.api,page:'companies',feedback:s.feedback}),{wrapper:s.wrapper});
 const old=[...s.requests];act(()=>{h.result.current.loadCompanies()});
 await act(async()=>s.requests.at(-1).resolve([]));await act(async()=>old.forEach(r=>r.resolve(row(r.comp))));
 expect(h.result.current.companiesState.companies).toEqual([]);expect(h.result.current.companiesState.loadingCompanies).toBe(false);
});
test('login durante leitura não repovoa dados',async()=>{
 const s=setup();const h=renderHook(({page})=>useManageCompaniesWorkspace({api:s.api,page,feedback:s.feedback}),{wrapper:s.wrapper,initialProps:{page:'companies'}});
 h.rerender({page:'login'});await act(async()=>s.requests.forEach(r=>r.resolve(row(r.comp))));
 expect(h.result.current.companiesState.companies).toEqual([]);
});
test('callback anterior sem competência recarrega o mês atual',async()=>{
 const s=setup();const h=renderHook(()=>useManageCompaniesWorkspace({api:s.api,page:'companies',feedback:s.feedback}),{wrapper:s.wrapper});
 const oldCallback=h.result.current.loadCompanies;act(()=>h.result.current.changeDashboardCompetencia('2026-08'));
 act(()=>{oldCallback()});expect(s.requests.at(-1).comp).toBe('2026-08');
 await act(async()=>s.requests.forEach(r=>r.resolve(row(r.comp))));expect(h.result.current.companiesState.companies).toEqual(row('2026-08'));
});
test('URL com mês impossível conserva competência padrão válida',()=>{
 const s=setup('/companies?competencia=2026-13');const h=renderHook(()=>useManageCompaniesWorkspace({api:s.api,page:'companies',feedback:s.feedback}),{wrapper:s.wrapper});
 expect(h.result.current.dashboardCompetencia).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
});

