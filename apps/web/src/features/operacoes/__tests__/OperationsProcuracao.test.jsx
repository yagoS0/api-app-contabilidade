import {render,screen,fireEvent} from '@testing-library/react';
import {OperationsProcuracao} from '../OperationsProcuracao';
jest.mock('../../whatsapp/components/ChatDaEmpresa',()=>({ChatDaEmpresa:props=><div data-testid="chat" data-company={props.companyId} data-selection={String(props.selecionarContato)}>{props.sugestao}</div>}));
test('pedido abre chat da empresa com sugestão e seleção explícita, sem invocar ações',()=>{
 const api={responderConversaWhatsapp:jest.fn(),assumirConversaWhatsapp:jest.fn(),devolverConversaWhatsapp:jest.fn()};const close=jest.fn();render(<OperationsProcuracao api={api} company={{companyId:'a',razao:'Alfa'}} onClose={close}/>);
 expect(screen.getByTestId('chat')).toHaveAttribute('data-company','a');expect(screen.getByTestId('chat')).toHaveAttribute('data-selection','true');expect(screen.getByTestId('chat')).toHaveTextContent('procuração da empresa Alfa');expect(screen.getByRole('link')).toHaveAttribute('href','/companies/a/comunicacao');for(const fn of Object.values(api))expect(fn).not.toHaveBeenCalled();fireEvent.keyDown(document,{key:'Escape'});expect(close).toHaveBeenCalled();
});
