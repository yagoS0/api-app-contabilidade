import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AnaliseEmpresa } from '../../components/AnaliseEmpresa';
import { analisePlanejamentoMock } from '../../../../api/mock/analisePlanejamentoMock';
import { fechamentosRelatorioMock } from '../../../../api/mock/fechamentosRelatorioMock';
const competenciasFechadas=Array.from({length:8},(_,i)=>`2026-${String(i+1).padStart(2,'0')}`);
const api=()=>({getFechamentosRelatorio:jest.fn(async()=>({ok:true,competenciasFechadas})),getAnalisePlanejamento:jest.fn((id,f)=>Promise.resolve(analisePlanejamentoMock(id,f))),getAnaliseLancamentos:jest.fn(()=>Promise.resolve({ok:true,linhas:[],temMais:false}))});
test('mostra demonstração, compara períodos e abre composição',async()=>{const a=api();render(<AnaliseEmpresa api={a} empresaId="demo"/>);await screen.findByText(/Dados fictícios para testes/);fireEvent.click(screen.getByRole('button',{name:/Filtrar período/}));fireEvent.click(screen.getByText('Acumulado no ano'));fireEvent.click(screen.getByText('Aplicar período'));await waitFor(()=>expect(a.getAnalisePlanejamento.mock.calls.at(-1)[1].de).toMatch(/-01$/));await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Resultado',exact:true}));});expect(screen.getByText('DRE gerencial comparativa')).toBeInTheDocument();});
test('falha não é tela vazia e permite repetir',async()=>{const a=api();a.getAnalisePlanejamento.mockRejectedValueOnce(new Error('Falha de teste'));render(<AnaliseEmpresa api={a} empresaId="demo"/>);await screen.findByRole('alert');fireEvent.click(screen.getByText('Tentar novamente'));await screen.findByText(/Dados fictícios para testes/);});
test('resposta de empresa antiga não substitui a nova',async()=>{const a=api();let resolver; a.getAnalisePlanejamento.mockImplementationOnce(()=>new Promise(r=>{resolver=r;}));const v=render(<AnaliseEmpresa api={a} empresaId="antiga"/>);await waitFor(()=>expect(resolver).toBeDefined());v.rerender(<AnaliseEmpresa api={a} empresaId="nova007"/>);await screen.findByText(/Dados fictícios para testes/);resolver(analisePlanejamentoMock('antiga',a.getAnalisePlanejamento.mock.calls[0][1]));await waitFor(()=>expect(screen.getAllByText('Sem dados').length).toBeGreaterThan(0));});

test('variação de margem usa pontos percentuais sem formatação monetária',async()=>{
 const a=api();render(<AnaliseEmpresa api={a} empresaId="demo"/>);await screen.findByText(/Dados fictícios para testes/);
 const card=screen.getByRole('button',{name:/Margem líquida/});expect(card.textContent).toContain('p.p.');expect(card.textContent).not.toContain('R$');
});

test('consulta o último fechamento registrado, sem presumir o mês anterior do calendário',async()=>{
 const a=api();a.getFechamentosRelatorio.mockResolvedValue({ok:true,competenciasFechadas:['2024-03','2024-01']});
 render(<AnaliseEmpresa api={a} empresaId="empresa-fechada"/>);
 await waitFor(()=>expect(a.getAnalisePlanejamento).toHaveBeenCalledWith('empresa-fechada',{de:'2024-03',ate:'2024-03',comparar:'anterior'}));
 expect(a.getAnalisePlanejamento).toHaveBeenCalledTimes(1);
});

test('sem fechamento não consulta números nem oferece impressão',async()=>{
 const a=api();a.getFechamentosRelatorio.mockResolvedValue({ok:true,competenciasFechadas:[]});
 render(<AnaliseEmpresa api={a} empresaId="sem-fechamento"/>);
 await screen.findByText('Nenhum mês fechado na contabilidade');
 expect(a.getAnalisePlanejamento).not.toHaveBeenCalled();
 expect(screen.queryByRole('button',{name:/Imprimir relatório/})).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:/Conferir fechamentos/})).toHaveAttribute('href','/companies/sem-fechamento/lancamentos');
});

test('falha ao conferir fechamento não fabrica disponibilidade e permite nova consulta',async()=>{
 const a=api();a.getFechamentosRelatorio.mockRejectedValueOnce(new Error('Fechamentos temporariamente indisponíveis'));
 render(<AnaliseEmpresa api={a} empresaId="empresa"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Fechamentos temporariamente indisponíveis');
 expect(a.getAnalisePlanejamento).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));
 await screen.findByText(/Dados fictícios para testes/);
 expect(a.getFechamentosRelatorio).toHaveBeenCalledTimes(2);
});

test('fechamento tardio de outra empresa não habilita consulta na empresa nova',async()=>{
 const a=api();let resolver;
 a.getFechamentosRelatorio.mockImplementationOnce(()=>new Promise(r=>{resolver=r;})).mockResolvedValue({ok:true,competenciasFechadas:[]});
 const view=render(<AnaliseEmpresa api={a} empresaId="antiga"/>);
 await waitFor(()=>expect(resolver).toBeDefined());
 view.rerender(<AnaliseEmpresa api={a} empresaId="nova"/>);
 await screen.findByText('Nenhum mês fechado na contabilidade');
 await act(async()=>{resolver({ok:true,competenciasFechadas:['2026-08']});});
 expect(a.getAnalisePlanejamento).not.toHaveBeenCalled();
 expect(screen.getByText('Nenhum mês fechado na contabilidade')).toBeInTheDocument();
});

test('reabertura entre seleção e leitura bloqueia números e impressão',async()=>{
 const a=api();a.getAnalisePlanejamento.mockRejectedValue(Object.assign(new Error('A competência 2026-08 foi reaberta.'),{status:409,code:'CONTABILIDADE_ABERTA',payload:{mesesSemFechamento:['2026-08']}}));
 render(<AnaliseEmpresa api={a} empresaId="empresa"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('foi reaberta');
 expect(screen.queryByRole('button',{name:/Imprimir relatório/})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/Faturamento documental/})).not.toBeInTheDocument();
});

test('comparação aberta mantém o atual sem inventar crescimento ou pontos percentuais',async()=>{
 const id='demo-comparacao-aberta',fechados=fechamentosRelatorioMock(id),ultimo=[...fechados].sort().at(-1);
 const dados=analisePlanejamentoMock(id,{de:ultimo,ate:ultimo,comparar:'anterior'});
 expect(dados.atual.indicadores.faturamento).toBeGreaterThan(0);
 expect(dados.anterior.indisponivel).toBe(true);
 for(const variacao of Object.values(dados.variacoes)){
   expect(variacao.absoluta).toBeNull();
   expect(variacao.percentual).toBeNull();
   expect(variacao.texto).not.toContain('p.p.');
 }
 const a=api();a.getFechamentosRelatorio.mockResolvedValue({ok:true,competenciasFechadas:fechados});
 render(<AnaliseEmpresa api={a} empresaId={id}/>);
 await screen.findByText(/Comparação indisponível/);
 const card=screen.getByRole('button',{name:/Margem líquida/});
 expect(card).toHaveTextContent('Anterior: Sem dados');
 expect(card).not.toHaveTextContent('p.p.');
 expect(screen.getByRole('button',{name:/Faturamento documental/})).toBeInTheDocument();
});
