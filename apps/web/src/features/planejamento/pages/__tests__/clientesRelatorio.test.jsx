import { render,screen,fireEvent,waitFor } from '@testing-library/react';
import { ClientesRelatorio } from '../../components/ClientesRelatorio';
import { clientesAnaliseMock } from '../../../../api/mock/clientesAnaliseMock';
const filtros={de:'2026-08',ate:'2026-08',comparar:'anterior'};
test('relatório tem gráficos, números e detalhe das notas',async()=>{const api={getAnaliseClientes:jest.fn(async(id,f)=>clientesAnaliseMock(id,f))};render(<ClientesRelatorio api={api} empresaId="demo" {...filtros}/>);await screen.findByText('Carteira de clientes');expect(screen.getByRole('img',{name:'Faturamento identificado · 12 meses'})).toBeInTheDocument();fireEvent.click(screen.getAllByRole('button',{name:'Clínica Aurora · Exemplo'})[0]);expect(screen.getByText('Notas que compõem o período')).toBeInTheDocument();expect(screen.getByText('Acumulado até a referência')).toBeInTheDocument();});
test('trocar empresa descarta resposta tardia',async()=>{let resolve;const api={getAnaliseClientes:jest.fn().mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockImplementation(async(id,f)=>clientesAnaliseMock(id,f))};const view=render(<ClientesRelatorio api={api} empresaId="a" {...filtros}/>);await waitFor(()=>expect(resolve).toBeDefined());view.rerender(<ClientesRelatorio api={api} empresaId="b007" {...filtros}/>);await screen.findByText('Sem faturamento identificado para calcular concentração.');resolve(clientesAnaliseMock('a',filtros));await waitFor(()=>expect(screen.queryByText('Clínica Aurora · Exemplo')).not.toBeInTheDocument());});
test('erro tem retentativa sem fabricar demonstração',async()=>{const api={getAnaliseClientes:jest.fn().mockRejectedValueOnce(new Error('Falha')).mockImplementation(async(id,f)=>clientesAnaliseMock(id,f))};render(<ClientesRelatorio api={api} empresaId="a" {...filtros}/>);await screen.findByRole('alert');fireEvent.click(screen.getByText('Recarregar clientes'));await screen.findByText('Carteira de clientes');});

test('revalida fechamento antes de imprimir e bloqueia mês reaberto',async()=>{
 const print=jest.spyOn(window,'print').mockImplementation(()=>{});
 const api={getAnaliseClientes:jest.fn().mockImplementationOnce(async(id,f)=>clientesAnaliseMock(id,f)).mockResolvedValueOnce({ok:false,message:'Feche a contabilidade de 08/2026.'})};
 render(<ClientesRelatorio api={api} empresaId="demo" {...filtros}/>);
 await screen.findByText('Carteira de clientes');
 fireEvent.click(screen.getByRole('button',{name:'Imprimir / salvar PDF'}));
 await screen.findByRole('alert');
 expect(screen.getByText(/Feche a contabilidade/)).toBeInTheDocument();
 expect(api.getAnaliseClientes).toHaveBeenCalledTimes(2);expect(print).not.toHaveBeenCalled();print.mockRestore();
});

test('comparação e recorrência indisponíveis não viram zero na apresentação',async()=>{
 const base=clientesAnaliseMock('demo',filtros);
 base.comparacaoDisponivel=false;base.recorrenciaDisponivel=false;
 base.resumo.anterior=null;base.resumo.semFaturamento=null;base.resumo.recorrentes=null;
 base.ponte=Object.fromEntries(Object.keys(base.ponte).map(k=>[k,null]));
 const api={getAnaliseClientes:jest.fn(async()=>base)};
 render(<ClientesRelatorio api={api} empresaId="demo" {...filtros}/>);
 await screen.findByText('Carteira de clientes');
 expect(screen.getByText('Recorrência indisponível')).toBeInTheDocument();
 expect(screen.getByText('Comparação indisponível até o fechamento contábil dos meses comparados.')).toBeInTheDocument();
 expect(screen.queryByText(/Diferença de R\$ 0,00/)).not.toBeInTheDocument();
});
