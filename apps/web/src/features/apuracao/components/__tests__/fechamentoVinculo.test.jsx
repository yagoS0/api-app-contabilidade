import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FechamentoModal } from '../FechamentoModal';
const atividade={idAtividade:1,descricao:'Serviço',anexoImplicito:'III',sujeitoFatorR:true,valorInterno:100,valorExterno:0};
function montar(over={}) {
 const api={getFechamento:jest.fn(async()=>({dados:{atividades:[atividade],regimeApuracao:'COMPETENCIA',faturamento:{total:100},cadastroCompleto:true,semMovimentoDisponivel:true}})),listAtividadesPgdasd:jest.fn(async()=>({atividades:[atividade]})),calcularFechamento:jest.fn(async()=>({ok:true,result:{calculoId:'token-1',dasValor:6}})),salvarFechamento:jest.fn(async()=>({ok:true})),...over};
 const props={api,portalClientId:'A',competencia:'2026-06',feedback:{notifySuccess:jest.fn(),notifyError:jest.fn()}};
 const view=render(<FechamentoModal {...props}/>);return {api,props,...view};
}
async function calcular(){fireEvent.click(await screen.findByRole('button',{name:/Calcular.*simulação/}));await waitFor(()=>expect(screen.getByRole('button',{name:/Salvar/})).toBeEnabled());}
it('editar receita invalida cálculo e obriga nova simulação',async()=>{
 montar();await calcular();fireEvent.change(screen.getAllByRole('spinbutton')[0],{target:{value:'200'}});
 expect(screen.getByRole('button',{name:/Salvar/})).toBeDisabled();expect(screen.getByRole('button',{name:/Transmitir/})).toBeDisabled();
});
it('editar folha também invalida cálculo',async()=>{
 montar();await calcular();const inputs=screen.getAllByRole('spinbutton');fireEvent.change(inputs[inputs.length-1],{target:{value:'20'}});
 expect(screen.getByRole('button',{name:/Salvar/})).toBeDisabled();
});
it('salvar leva o identificador da simulação aprovada',async()=>{
 const {api}=montar();await calcular();fireEvent.click(screen.getByRole('button',{name:/Salvar/}));
 await waitFor(()=>expect(api.salvarFechamento).toHaveBeenCalledWith('A','2026-06',expect.objectContaining({calculoId:'token-1'})));
});
it('resultado atrasado da outra empresa não habilita transmissão',async()=>{
 let resolve;const pendente=new Promise(r=>{resolve=r;});
 const {rerender,props}=montar({calcularFechamento:jest.fn(()=>pendente)});
 fireEvent.click(await screen.findByRole('button',{name:/Calcular.*simulação/}));
 rerender(<FechamentoModal {...props} portalClientId="B"/>);
 await screen.findByRole('button',{name:/Calcular.*simulação/});
 await act(async()=>resolve({ok:true,result:{calculoId:'de-A',dasValor:999}}));
 expect(screen.getByRole('button',{name:/Salvar/})).toBeDisabled();expect(props.feedback.notifySuccess).not.toHaveBeenCalled();
});
