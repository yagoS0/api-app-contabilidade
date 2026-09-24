// Relatórios têm janela própria de 12 meses; Notas e Guias conservam a competência operacional compartilhada.
import { StrictMode } from 'react';
import { act,fireEvent,render,screen } from '@testing-library/react';
import { api } from '../../../api';
import { AppShell } from '../AppShell';
import { competenciaPadrao,competenciasRecentes } from '../../../lib/format';
import { disponibilidadeRelatorios,moverMesPortal } from '../../../../../../packages/shared/src/analise/portalCliente.js';
import { analisePlanejamentoMock } from '../../../../../web/src/api/mock/analisePlanejamentoMock';
const atual=competenciaPadrao(),outro=competenciasRecentes(12).find(m=>m!==atual);
const acesso={ok:true,...disponibilidadeRelatorios(Array.from({length:12},(_,i)=>moverMesPortal(atual,-i-1)),atual)};
beforeEach(()=>{
 window.localStorage.clear();window.location.hash='';
 jest.spyOn(api,'getCompanies').mockResolvedValue([{companyId:'pc-001',razao:'ACME',cnpj:'11222333000181',myRole:'OWNER'}]);
 jest.spyOn(api,'getFechamentosRelatorio').mockResolvedValue(acesso);
 jest.spyOn(api,'getAnalisePlanejamento').mockImplementation((id,f)=>Promise.resolve(analisePlanejamentoMock(id,f)));
 jest.spyOn(api,'getInvoices').mockResolvedValue({data:[],page:1,limit:25,total:0,summary:{totalInvoices:0,totalAmount:0,pageAmount:0}});
 jest.spyOn(api,'getGuides').mockResolvedValue({data:[],page:1,limit:25,total:0});
});
afterEach(()=>{window.location.hash='';jest.restoreAllMocks();});
async function abrir(){render(<StrictMode><AppShell user={{defaultClientId:'pc-001'}}/></StrictMode>);await act(async()=>{});}
async function ir(aba){fireEvent.click(screen.getByRole('link',{name:aba}));await act(async()=>{await new Promise(r=>setTimeout(r,0));});await act(async()=>{});}
test('relatório inicia em 12 meses, independentemente da competência das notas',async()=>{
 await abrir();expect(api.getAnalisePlanejamento).toHaveBeenLastCalledWith('pc-001',{de:acesso.de,ate:acesso.ate,comparar:'anterior'});
 await ir('Notas');fireEvent.change(screen.getByLabelText('Competência'),{target:{value:outro}});await act(async()=>{});
 await ir('Início');expect(api.getAnalisePlanejamento).toHaveBeenLastCalledWith('pc-001',{de:acesso.de,ate:acesso.ate,comparar:'anterior'});expect(document.querySelector('#competencia-home')).toBeNull();
});
test('filtrar o relatório não altera a competência de notas ou guias',async()=>{
 await abrir();fireEvent.click(screen.getByRole('button',{name:/Filtrar período/}));fireEvent.click(screen.getByRole('button',{name:'3 meses'}));fireEvent.click(screen.getByRole('button',{name:'Aplicar período'}));await act(async()=>{});
 await ir('Notas');expect(document.querySelector('#competencia-notas').value).toBe(atual);
 fireEvent.change(screen.getByLabelText('Competência'),{target:{value:outro}});await act(async()=>{});await ir('Guias');expect(document.querySelector('#competencia-guias').value).toBe(outro);expect(api.getGuides).toHaveBeenLastCalledWith('pc-001',expect.objectContaining({competencia:outro}));
});
test('Todas nas notas não amplia o relatório para competências abertas',async()=>{
 await abrir();await ir('Notas');fireEvent.change(screen.getByLabelText('Competência'),{target:{value:''}});await act(async()=>{});await ir('Início');expect(api.getAnalisePlanejamento).toHaveBeenLastCalledWith('pc-001',{de:acesso.de,ate:acesso.ate,comparar:'anterior'});
});
test('links preservam navegação do navegador por modificadores',async()=>{
 await abrir();const notas=screen.getByRole('link',{name:'Notas'});expect(notas.getAttribute('href')).toBe('#/notas');expect(fireEvent.click(notas,{ctrlKey:true})).toBe(true);expect(fireEvent.click(notas,{metaKey:true})).toBe(true);expect(fireEvent.click(notas)).toBe(false);await act(async()=>{});
});