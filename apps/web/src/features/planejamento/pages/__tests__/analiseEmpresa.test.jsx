import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnaliseEmpresa } from '../../components/AnaliseEmpresa';
import { analisePlanejamentoMock } from '../../../../api/mock/analisePlanejamentoMock';
const api=()=>({getAnalisePlanejamento:jest.fn((id,f)=>Promise.resolve(analisePlanejamentoMock(id,f))),getAnaliseLancamentos:jest.fn(()=>Promise.resolve({ok:true,linhas:[],temMais:false}))});
test('mostra demonstração, compara períodos e abre composição',async()=>{const a=api();render(<AnaliseEmpresa api={a} empresaId="demo"/>);await screen.findByText(/Dados fictícios para testes/);fireEvent.click(screen.getByRole('button',{name:/Filtrar período/}));fireEvent.click(screen.getByText('Acumulado no ano'));fireEvent.click(screen.getByText('Aplicar período'));await waitFor(()=>expect(a.getAnalisePlanejamento.mock.calls.at(-1)[1].de).toMatch(/-01$/));fireEvent.click(screen.getByRole('button',{name:'Resultado',exact:true}));expect(screen.getByText('DRE gerencial comparativa')).toBeInTheDocument();});
test('falha não é tela vazia e permite repetir',async()=>{const a=api();a.getAnalisePlanejamento.mockRejectedValueOnce(new Error('Falha de teste'));render(<AnaliseEmpresa api={a} empresaId="demo"/>);await screen.findByRole('alert');fireEvent.click(screen.getByText('Tentar novamente'));await screen.findByText(/Dados fictícios para testes/);});
test('resposta de empresa antiga não substitui a nova',async()=>{const a=api();let resolver; a.getAnalisePlanejamento.mockImplementationOnce(()=>new Promise(r=>{resolver=r;}));const v=render(<AnaliseEmpresa api={a} empresaId="antiga"/>);await waitFor(()=>expect(resolver).toBeDefined());v.rerender(<AnaliseEmpresa api={a} empresaId="nova007"/>);await screen.findByText(/Dados fictícios para testes/);resolver(analisePlanejamentoMock('antiga',a.getAnalisePlanejamento.mock.calls[0][1]));await waitFor(()=>expect(screen.getAllByText('Sem dados').length).toBeGreaterThan(0));});

test('variação de margem usa pontos percentuais sem formatação monetária',async()=>{
 const a=api();render(<AnaliseEmpresa api={a} empresaId="demo"/>);await screen.findByText(/Dados fictícios para testes/);
 const card=screen.getByRole('button',{name:/Margem líquida/});expect(card.textContent).toContain('p.p.');expect(card.textContent).not.toContain('R$');
});
