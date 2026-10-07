import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {DividasCircular} from '../DividasCircular';
const itens=[{chave:'a',tributo:'PIS',competencia:'2026-01',saldo:100,elegivel:true},{chave:'b',tributo:'COFINS',competencia:'2026-01',saldo:200,elegivel:false,motivo:'Já incluído em outro acordo.'}];
test('seleção de tabela considera só elegíveis e não grava antes da confirmação',async()=>{
 const onSelecionar=jest.fn(),onAplicar=jest.fn(),listar=jest.fn(async()=>({habilitado:true,debitos:itens}));
 const {rerender}=render(<DividasCircular listar={listar} tipo="LUCRO_PRESUMIDO" onSelecionar={onSelecionar} onAplicar={onAplicar}/>);
 await screen.findByText('COFINS');expect(screen.getByLabelText('Selecionar COFINS 2026-01')).toBeDisabled();
 fireEvent.click(screen.getByLabelText('Selecionar todas as dívidas visíveis'));expect(onSelecionar).toHaveBeenCalledWith([itens[0]]);expect(onAplicar).not.toHaveBeenCalled();
 rerender(<DividasCircular listar={listar} tipo="LUCRO_PRESUMIDO" selecionadas={[itens[0]]} onSelecionar={onSelecionar} onAplicar={onAplicar}/>);
 fireEvent.click(screen.getByText('Sugerir lançamentos'));expect(onAplicar).toHaveBeenCalledWith([itens[0]]);
 fireEvent.click(screen.getByText('Limpar seleção'));expect(onSelecionar).toHaveBeenLastCalledWith([]);
});
test('falha de consulta não aparece como ausência de dívidas',async()=>{
 render(<DividasCircular listar={async()=>{throw new Error('Sem conexão');}} tipo="INSS" onSelecionar={()=>{}}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão');expect(screen.queryByText('Nenhuma dívida encontrada neste filtro.')).not.toBeInTheDocument();
});

test('seleção fora do filtro é informada e permanece selecionada', async () => {
 const selecionar=jest.fn();
 render(<DividasCircular listar={async()=>({habilitado:true,debitos:itens})} tipo="LUCRO_PRESUMIDO" selecionadas={[itens[0]]} onSelecionar={selecionar}/>);
 await screen.findByText('COFINS');
 fireEvent.change(screen.getByLabelText('Filtrar dívidas da Circular'),{target:{value:'COFINS'}});
 expect(screen.getByText(/1 fora do filtro/)).toBeInTheDocument();
 expect(selecionar).not.toHaveBeenCalled();
 expect(screen.getByLabelText('Selecionar todas as dívidas visíveis')).toBeDisabled();
});
