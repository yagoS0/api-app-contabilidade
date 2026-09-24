import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { api } from '../../../api';
import { PainelPage } from '../PainelPage';
import { analisePlanejamentoMock } from '../../../../../web/src/api/mock/analisePlanejamentoMock';
import { disponibilidadeRelatorios, moverMesPortal } from '../../../../../../packages/shared/src/analise/portalCliente.js';
const hoje = new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}).slice(0,7);
const meses=Array.from({length:12},(_,i)=>moverMesPortal(hoje,-i-1));
const acesso={ok:true,...disponibilidadeRelatorios(meses,hoje)};
const empresa={companyId:'pc-001',razao:'Empresa de teste'};
async function abrir(fechamentos=acesso){
 jest.spyOn(api,'getFechamentosRelatorio').mockResolvedValue(fechamentos);
 jest.spyOn(api,'getAnalisePlanejamento').mockImplementation((id,filtros)=>Promise.resolve(analisePlanejamentoMock(id,filtros)));
 jest.spyOn(api,'getFluxoCaixa').mockRejectedValue(Error('Não consultar fluxo'));
 jest.spyOn(api,'getInvoices').mockRejectedValue(Error('Não consultar resumo antigo'));
 const vista=render(<PainelPage empresa={empresa}/>);await act(async()=>{});return vista;
}
afterEach(()=>jest.restoreAllMocks());
test('início usa 12 meses e os cinco cards antes das seções, sem horizonte nem resumo antigo',async()=>{
 await abrir();await screen.findByText('Entradas');
 expect(api.getAnalisePlanejamento).toHaveBeenCalledWith('pc-001',{de:acesso.de,ate:acesso.ate,comparar:'anterior'});
 expect([...document.querySelectorAll('.portal-resumo .bi-card > span')].map(e=>e.textContent)).toEqual(['Entradas','Saídas','Folha','Impostos','Resultado']);
 const nav=screen.getByRole('navigation',{name:'Seções da análise'});expect(document.querySelector('.portal-resumo').compareDocumentPosition(nav)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Horizonte'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/Projeção financeira/})).not.toBeInTheDocument();expect(api.getFluxoCaixa).not.toHaveBeenCalled();expect(api.getInvoices).not.toHaveBeenCalled();
});
test('não revela cards nem solicita análise sem os três fechamentos recentes',async()=>{
 await abrir({...acesso,liberado:false,pendentes:[meses[0]]});expect(await screen.findByText('Relatórios em preparação')).toBeInTheDocument();expect(api.getAnalisePlanejamento).not.toHaveBeenCalled();expect(screen.queryByText('Entradas')).not.toBeInTheDocument();
});
test('cliente reduz o período e todas as visões recebem o intervalo escolhido',async()=>{
 await abrir();await screen.findByText('Entradas');fireEvent.click(screen.getByRole('button',{name:/Filtrar período/}));fireEvent.click(screen.getByRole('button',{name:'3 meses'}));fireEvent.click(screen.getByRole('button',{name:'Aplicar período'}));
 await waitFor(()=>expect(api.getAnalisePlanejamento).toHaveBeenLastCalledWith('pc-001',{de:moverMesPortal(acesso.ate,-2),ate:acesso.ate,comparar:'anterior'}));
 const clientes=jest.spyOn(api,'getAnaliseClientes').mockImplementation(()=>new Promise(()=>{}));fireEvent.click(screen.getByRole('button',{name:'Clientes',exact:true}));await waitFor(()=>expect(clientes).toHaveBeenCalledWith('pc-001',{de:moverMesPortal(acesso.ate,-2),ate:acesso.ate,comparar:'anterior'}));
});
test('resultado não oferece edição do contador nem links internos de empresa',async()=>{
 await abrir();await screen.findByText('Entradas');fireEvent.click(screen.getByRole('button',{name:'Resultado',exact:true}));expect(await screen.findByText('DRE gerencial comparativa')).toBeInTheDocument();expect(screen.queryByText(/Conferir pagamentos de/)).not.toBeInTheDocument();expect(document.querySelector('a[href^="/companies/"]')).toBeNull();
});