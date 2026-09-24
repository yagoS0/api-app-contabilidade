import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import {EmailCodeLogin} from '../EmailCodeLogin';
import {api} from '../../../api';
import {limparSessao,lerSessao} from '../../../api/sessionStore';
import {ApiError} from '../../../api/ApiError';
afterEach(()=>{jest.restoreAllMocks();limparSessao();});
test('pede código, confirma e guarda somente tokens de sessão',async()=>{
 const request=jest.spyOn(api,'solicitarCodigoAcesso').mockResolvedValue({challengeId:'challenge',resendAfter:60});
 const verify=jest.spyOn(api,'confirmarCodigoAcesso').mockResolvedValue({accessToken:'access',refreshToken:'refresh',user:{id:'u'}});
 render(<EmailCodeLogin voltar={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('E-mail'),{target:{value:'cliente@example.com'}});fireEvent.click(screen.getByRole('button',{name:'Receber código'}));
 const input=await screen.findByLabelText('Código de 8 dígitos');expect(request).toHaveBeenCalledWith('cliente@example.com');
 expect(screen.getByRole('button',{name:/Reenviar em/})).toBeDisabled();
 fireEvent.change(input,{target:{value:'12345678'}});fireEvent.click(screen.getByRole('button',{name:'Confirmar código e entrar'}));
 await waitFor(()=>expect(verify).toHaveBeenCalledWith('challenge','12345678'));await waitFor(()=>expect(lerSessao().accessToken).toBe('access'));
 expect(localStorage.getItem('pcw.sessao')).not.toContain('12345678');
});
test('erro de código permite tentar de novo e trocar endereço sem autenticar',async()=>{
 jest.spyOn(api,'solicitarCodigoAcesso').mockResolvedValue({challengeId:'c',resendAfter:60});
 jest.spyOn(api,'confirmarCodigoAcesso').mockRejectedValue(new ApiError(401,'invalid_login_code'));
 render(<EmailCodeLogin voltar={()=>{}}/>);fireEvent.change(screen.getByLabelText('E-mail'),{target:{value:'a@b.com'}});fireEvent.click(screen.getByRole('button',{name:'Receber código'}));
 fireEvent.change(await screen.findByLabelText('Código de 8 dígitos'),{target:{value:'11111111'}});fireEvent.click(screen.getByRole('button',{name:'Confirmar código e entrar'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Código inválido ou expirado');expect(lerSessao().accessToken).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Alterar e-mail'}));expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
});
test('resposta tardia após sair da tela não autentica o cliente',async()=>{
 let finish;jest.spyOn(api,'solicitarCodigoAcesso').mockResolvedValue({challengeId:'c'});
 jest.spyOn(api,'confirmarCodigoAcesso').mockImplementation(()=>new Promise(r=>{finish=r;}));
 const view=render(<EmailCodeLogin voltar={()=>{}}/>);fireEvent.change(screen.getByLabelText('E-mail'),{target:{value:'a@b.com'}});fireEvent.click(screen.getByRole('button',{name:'Receber código'}));
 fireEvent.change(await screen.findByLabelText('Código de 8 dígitos'),{target:{value:'12345678'}});fireEvent.click(screen.getByRole('button',{name:'Confirmar código e entrar'}));
 view.unmount();await act(async()=>finish({accessToken:'late',refreshToken:'late',user:{id:'u'}}));expect(lerSessao().accessToken).toBeNull();
});
