import { render,screen,fireEvent } from '@testing-library/react';
import { BaseSocios } from '../../components/BaseSocios';
test('base ausente exige conferência e fonte antes de salvar pagamentos',async()=>{
 const api={getBaseSociosGerencial:jest.fn(async()=>({registros:[]})),salvarBaseSociosGerencial:jest.fn(async()=>({ok:true}))};
 render(<BaseSocios api={api} empresaId="a" de="2026-07" ate="2026-08" resultado={5000}/>);
 await screen.findByText(/Falta confirmação em 2026-07, 2026-08/);
 fireEvent.click(screen.getByText('Conferir pagamentos de 2026-08'));
 expect(screen.getByText('Salvar declaração de 2026-08')).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Mês conferido'),{target:{value:'2026-07'}});
 ['Pró-labore pago','Distribuição de lucros paga','Outras retiradas pagas'].forEach(l=>fireEvent.change(screen.getByLabelText(l),{target:{value:'0'}}));
 fireEvent.change(screen.getByLabelText('Documento ou controle de origem'),{target:{value:'Conferência de comprovantes'}});
 fireEvent.click(screen.getByLabelText('Conferi os pagamentos; zeros também foram confirmados.'));
 fireEvent.click(screen.getByText('Salvar declaração de 2026-07'));
 await screen.findByText('Conferir pagamentos de 2026-08');
 expect(api.salvarBaseSociosGerencial).toHaveBeenCalledWith('a',expect.objectContaining({competencia:'2026-07',confirmado:true}));
});
