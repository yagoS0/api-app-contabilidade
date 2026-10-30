import {act,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {ChatDaEmpresa} from '../ChatDaEmpresa';
const person=(id,nome)=>({id,telefoneE164:'5521999998888',telefoneMascarado:'+55…8888',contato:{id,nome},portalClientId:'a',empresa:{id:'a',razao:'Alfa'},janela:{situacao:'ABERTA'},naoLidas:0});
function fixture(contacts){return {listarConversasWhatsapp:jest.fn(async()=>({ok:true,conversas:contacts,temMais:false})),getMensagensWhatsapp:jest.fn(async id=>({ok:true,conversa:contacts.find(c=>c.id===id),mensagens:[],temMais:false})),assumirConversaWhatsapp:jest.fn(),devolverConversaWhatsapp:jest.fn(),responderConversaWhatsapp:jest.fn()};}
test('ambiguidade exige escolha e sugestão é editável sem envio/assunção/reativação',async()=>{
 const api=fixture([person('c1','Maria'),person('c2','João')]);render(<ChatDaEmpresa api={api} companyId="a" selecionarContato sugestao="Pedido de procuração"/>);
 const select=await screen.findByRole('combobox',{name:'Contato da conversa'});expect(select).toHaveValue('');expect(api.getMensagensWhatsapp).not.toHaveBeenCalled();expect(api.listarConversasWhatsapp).toHaveBeenCalledWith('todas',{empresa:'a'});
 fireEvent.change(select,{target:{value:'c2'}});await waitFor(()=>expect(api.getMensagensWhatsapp).toHaveBeenCalledWith('c2'));const text=await screen.findByRole('textbox',{name:'Mensagem sugerida'});fireEvent.change(text,{target:{value:'Mensagem revisada'}});expect(text).toHaveValue('Mensagem revisada');
 fireEvent.click(screen.getByRole('button',{name:'Preparar mensagem no compositor'}));
 expect(screen.getByRole('textbox',{name:'Responder ao cliente'})).toHaveValue('Mensagem revisada');
 fireEvent.change(text,{target:{value:'Não substituir rascunho'}});
 fireEvent.click(screen.getByRole('button',{name:'Preparar mensagem no compositor'}));
 expect(screen.getByRole('textbox',{name:'Responder ao cliente'})).toHaveValue('Mensagem revisada');
 expect(screen.getByText(/Você já tem um rascunho/)).toBeInTheDocument();
 fireEvent.change(select,{target:{value:'c1'}});
 await waitFor(()=>expect(screen.getByRole('textbox',{name:'Responder ao cliente'})).toHaveValue(''));
 for(const key of ['assumirConversaWhatsapp','devolverConversaWhatsapp','responderConversaWhatsapp'])expect(api[key]).not.toHaveBeenCalled();
});

test('retorno tardio de outro contato não prepara sugestão no destinatário atual',async()=>{
 const contacts=[person('c1','Maria'),person('c2','João')],api=fixture(contacts);let finish;
 api.getMensagensWhatsapp.mockImplementation(id=>id==='c1'?new Promise(resolve=>{finish=resolve;}):Promise.resolve({ok:true,conversa:contacts[1],mensagens:[],temMais:false}));
 render(<ChatDaEmpresa api={api} companyId="a" selecionarContato sugestao="Pedido"/>);
 const select=await screen.findByRole('combobox',{name:'Contato da conversa'});
 fireEvent.change(select,{target:{value:'c1'}});fireEvent.change(select,{target:{value:'c2'}});
 await screen.findByRole('textbox',{name:'Mensagem sugerida'});
 await act(async()=>finish({ok:true,conversa:contacts[0],mensagens:[],temMais:false}));
 expect(select).toHaveValue('c2');
 await waitFor(()=>expect(screen.getByRole('button',{name:'Preparar mensagem no compositor'})).toBeEnabled());
 await waitFor(()=>expect(screen.getByRole('textbox',{name:'Responder ao cliente'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Preparar mensagem no compositor'}));
 await waitFor(()=>expect(screen.getByRole('textbox',{name:'Responder ao cliente'})).toHaveValue('Pedido'));
 for(const key of ['assumirConversaWhatsapp','devolverConversaWhatsapp','responderConversaWhatsapp'])expect(api[key]).not.toHaveBeenCalled();
});
test('sem contato não inventa fio ou mensagem',async()=>{
 const api=fixture([]);render(<ChatDaEmpresa api={api} companyId="a" selecionarContato sugestao="Pedido"/>);await screen.findByTestId('chat-sem-fio');expect(api.getMensagensWhatsapp).not.toHaveBeenCalled();expect(screen.queryByRole('textbox',{name:'Mensagem sugerida'})).not.toBeInTheDocument();
});

test('troca de canal preserva rascunhos e prepara somente o canal escolhido sem transporte',async()=>{
 const contact={...person('c1','Maria'),interlocutorId:'p1',canalId:'fiscal',canais:[
  {id:'fiscal',nome:'Fiscal',conversaId:'c1',janela:{situacao:'ABERTA'}},
  {id:'comercial',nome:'Comercial',conversaId:'c2',janela:{situacao:'ABERTA'}},
 ]};
 const api=fixture([contact]);render(<ChatDaEmpresa api={api} companyId="a" selecionarContato sugestao="Pedido"/>);
 fireEvent.change(await screen.findByRole('combobox',{name:'Contato da conversa'}),{target:{value:'p1'}});
 const composer=await screen.findByRole('textbox',{name:'Responder ao cliente'});
 fireEvent.change(composer,{target:{value:'Rascunho fiscal'}});
 fireEvent.click(screen.getByRole('button',{name:'Ações da mensagem e arquivos'}));
 fireEvent.change(screen.getByRole('combobox',{name:'Canal da mensagem'}),{target:{value:'comercial'}});
 await waitFor(()=>expect(composer).toHaveValue(''));
 fireEvent.click(screen.getByRole('button',{name:'Preparar mensagem no compositor'}));expect(composer).toHaveValue('Pedido');
 fireEvent.click(screen.getByRole('button',{name:'Ações da mensagem e arquivos'}));
 fireEvent.change(screen.getByRole('combobox',{name:'Canal da mensagem'}),{target:{value:'fiscal'}});
 await waitFor(()=>expect(composer).toHaveValue('Rascunho fiscal'));
 for(const key of ['assumirConversaWhatsapp','devolverConversaWhatsapp','responderConversaWhatsapp'])expect(api[key]).not.toHaveBeenCalled();
});

test('canal indisponível desabilita preparo e orienta resolução',async()=>{
 const contact={...person('c1','Maria'),canalId:'fiscal',canais:[{id:'fiscal',nome:'Fiscal',conversaId:'c1',podeResponder:false,janela:{situacao:'ABERTA'}}]};
 const api=fixture([contact]);render(<ChatDaEmpresa api={api} companyId="a" selecionarContato sugestao="Pedido"/>);
 fireEvent.change(await screen.findByRole('combobox',{name:'Contato da conversa'}),{target:{value:'c1'}});
 expect(await screen.findByRole('button',{name:'Preparar mensagem no compositor'})).toBeDisabled();
 expect(screen.getByText(/Selecione um canal disponível no compositor/)).toBeInTheDocument();
 for(const key of ['assumirConversaWhatsapp','devolverConversaWhatsapp','responderConversaWhatsapp'])expect(api[key]).not.toHaveBeenCalled();
});
