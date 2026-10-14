import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { HistoricoPgdas } from "../HistoricoPgdas";
const historico={ok:true,versoes:[{id:'v1',numeroDeclaracao:'123',receitaBruta:100,dasTotal:6,temDeclaracao:true,temRecibo:true,atual:true,legado:true}]};
const cliente=()=>({getPgdasHistorico:jest.fn(async()=>historico),syncPgdasCircular:jest.fn(async()=>({ok:true,result:{circular:{serproSyncStatus:'SUCCESS',pgdasNumeroDeclaracao:'124',pgdasDeclaracaoFileId:'d',pgdasReciboFileId:'r'}}})),fetchPgdasPdfBlob:jest.fn()});
test('abrir e atualizar histórico não consultam Receita; conferência é explícita e documental',async()=>{
 const api=cliente();render(<HistoricoPgdas api={api} key="a:2026-09" companyId="a" competencia="2026-09" onClose={()=>{}}/>);
 await screen.findByText(/Declaração 123 ·/);expect(api.syncPgdasCircular).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Atualizar histórico'}));
 await waitFor(()=>expect(api.getPgdasHistorico).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Conferir na Receita'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Conferir na Receita'}));fireEvent.click(screen.getByRole('button',{name:'Confirmar consulta paga'}));
 await screen.findByText(/Conferência concluída/);
 expect(api.syncPgdasCircular).toHaveBeenCalledTimes(1);
 expect(api.syncPgdasCircular).toHaveBeenCalledWith('a','2026-09',{somenteDocumentos:true,atualizar:true});
});
test('recusa mantém histórico e não repete chamada',async()=>{
 const api=cliente();api.syncPgdasCircular.mockRejectedValue(Error('Procuração insuficiente'));
 render(<HistoricoPgdas api={api} key="a:2026-09" companyId="a" competencia="2026-09" onClose={()=>{}}/>);
 await screen.findByText(/Declaração 123 ·/);fireEvent.click(screen.getByRole('button',{name:'Conferir na Receita'}));fireEvent.click(screen.getByRole('button',{name:'Confirmar consulta paga'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Procuração insuficiente');
 expect(screen.getByText(/Declaração 123 ·/)).toBeInTheDocument();expect(api.syncPgdasCircular).toHaveBeenCalledTimes(1);
});
test('resposta tardia desmontada não atualiza outra empresa',async()=>{
 let resolver;const api=cliente(),atualizado=jest.fn();api.syncPgdasCircular.mockImplementation(()=>new Promise(r=>{resolver=r;}));
 const {unmount}=render(<HistoricoPgdas api={api} key="a:2026-09" companyId="a" competencia="2026-09" onClose={()=>{}} onAtualizado={atualizado}/>);
 await screen.findByText(/Declaração 123 ·/);fireEvent.click(screen.getByRole('button',{name:'Conferir na Receita'}));fireEvent.click(screen.getByRole('button',{name:'Confirmar consulta paga'}));unmount();
 await act(async()=>resolver({ok:true,result:{circular:{}}}));expect(atualizado).not.toHaveBeenCalled();
});


test('declaração recuperada por fora não vira ausência de apuração nem transmite novamente',async()=>{
 const api=cliente();api.getPgdasHistorico.mockResolvedValue({...historico,entregaSemTransmissaoInterna:true,estadoInterno:'aberta'});
 render(<HistoricoPgdas api={api} key="a:2026-09" companyId="a" competencia="2026-09" onClose={()=>{}}/>);
 expect(await screen.findByText(/Apuração comprovada na Receita/)).toHaveTextContent('O estado interno permanece aberta');
 expect(api.syncPgdasCircular).not.toHaveBeenCalled();
});

test('carregamento, vazio e falha de leitura não iniciam consulta fiscal',async()=>{
 const api=cliente();let resolver;api.getPgdasHistorico.mockImplementationOnce(()=>new Promise(r=>{resolver=r;}));
 render(<HistoricoPgdas api={api} key="a:2026-09" companyId="a" competencia="2026-09" onClose={()=>{}}/>);
 expect(screen.getByText(/Carregando registros/)).toBeVisible();expect(screen.getByRole('button',{name:'Conferir na Receita'})).toBeDisabled();
 await act(async()=>resolver({ok:true,versoes:[]}));expect(screen.getByText(/Nenhuma declaração registrada/)).toBeVisible();
 api.getPgdasHistorico.mockRejectedValueOnce(Error('Falha de conexão.'));fireEvent.click(screen.getByRole('button',{name:'Atualizar histórico'}));expect(await screen.findByRole('alert')).toHaveTextContent('Falha de conexão.');expect(api.syncPgdasCircular).not.toHaveBeenCalled();
});

test('bloqueio mantém leitura salva e PDF ausente desabilitado',async()=>{
 const api=cliente();api.getPgdasHistorico.mockResolvedValue({...historico,versoes:[{...historico.versoes[0],temRecibo:false}]});render(<HistoricoPgdas api={api} key="a:2026-09" companyId="a" competencia="2026-09" bloqueado onClose={()=>{}}/>);
 await screen.findByText(/Declaração 123/);expect(screen.getByRole('button',{name:'Conferir na Receita'})).toBeDisabled();expect(screen.getByRole('button',{name:/Recibo.*123/})).toBeDisabled();expect(screen.getByRole('button',{name:'Atualizar histórico'})).toBeEnabled();expect(api.syncPgdasCircular).not.toHaveBeenCalled();
});

test('consulta exige confirmação e busy bloqueia repetição e fechamento',async()=>{
 const api=cliente(),close=jest.fn();let resolver;api.syncPgdasCircular.mockImplementation(()=>new Promise(r=>{resolver=r;}));render(<HistoricoPgdas api={api} key="a:2026-09" companyId="a" competencia="2026-09" onClose={close}/>);
 await screen.findByText(/Declaração 123/);fireEvent.click(screen.getByRole('button',{name:'Conferir na Receita'}));expect(api.syncPgdasCircular).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Confirmar consulta paga'})).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Confirmar consulta paga'}));fireEvent.keyDown(document,{key:'Escape'});expect(close).not.toHaveBeenCalled();expect(api.syncPgdasCircular).toHaveBeenCalledTimes(1);await act(async()=>resolver({ok:true,result:{circular:{}}}));expect(screen.getByText(/Conferência sem documentação completa/)).toBeVisible();
});

test.each(['forbidden','unauthorized'])('PDF com recusa %s não é tratado como arquivo ausente',async code=>{
 const api=cliente();api.fetchPgdasPdfBlob.mockRejectedValue(Object.assign(Error('O arquivo não está mais no armazenamento.'),{code}));render(<HistoricoPgdas api={api} key="a:2026-09" companyId="a" competencia="2026-09" onClose={()=>{}}/>);await screen.findByText(/Declaração 123/);fireEvent.click(screen.getByRole('button',{name:/Declaração PDF 123/}));const alert=await screen.findByRole('alert');expect(alert).not.toHaveTextContent('não está mais no armazenamento');expect(alert).not.toHaveTextContent(code);expect(api.fetchPgdasPdfBlob).toHaveBeenCalledWith('a','2026-09','declaracao','v1');expect(api.syncPgdasCircular).not.toHaveBeenCalled();
});

test('troca de key do consumidor ignora leitura antiga e carrega empresa atual',async()=>{
 const api=cliente();let antigo;api.getPgdasHistorico.mockImplementationOnce(()=>new Promise(r=>{antigo=r;})).mockResolvedValue({ok:true,versoes:[]});const view=render(<HistoricoPgdas api={api} key="a:2026-09" companyId="a" competencia="2026-09" onClose={()=>{}}/>);view.rerender(<HistoricoPgdas api={api} key="b:2026-10" companyId="b" competencia="2026-10" onClose={()=>{}}/>);await waitFor(()=>expect(api.getPgdasHistorico).toHaveBeenCalledWith('b','2026-10'));await act(async()=>antigo(historico));expect(screen.queryByText(/Declaração 123/)).not.toBeInTheDocument();expect(screen.getByText(/Nenhuma declaração registrada/)).toBeVisible();
});

test.each(['insufficient_role','MES_FECHADO'])('recusa %s mantém versões e não repete consulta',async code=>{
 const api=cliente();api.syncPgdasCircular.mockRejectedValue(Object.assign(Error(code),{code}));render(<HistoricoPgdas api={api} key="a:2026-09" companyId="a" competencia="2026-09" onClose={()=>{}}/>);await screen.findByText(/Declaração 123/);fireEvent.click(screen.getByRole('button',{name:'Conferir na Receita'}));fireEvent.click(screen.getByRole('button',{name:'Confirmar consulta paga'}));const alert=await screen.findByRole('alert');expect(alert).not.toHaveTextContent(code);expect(screen.getByText(/Declaração 123/)).toBeVisible();expect(api.syncPgdasCircular).toHaveBeenCalledTimes(1);
});

test('PDF em andamento bloqueia duplicação e erro arquivo ausente preserva histórico',async()=>{
 const api=cliente();let rejeitar;api.fetchPgdasPdfBlob.mockImplementation(()=>new Promise((resolve,reject)=>{rejeitar=reject;}));render(<HistoricoPgdas api={api} key="a:2026-09" companyId="a" competencia="2026-09" onClose={()=>{}}/>);await screen.findByText(/Declaração 123/);const botao=screen.getByRole('button',{name:/Declaração PDF 123/});fireEvent.click(botao);fireEvent.click(botao);expect(api.fetchPgdasPdfBlob).toHaveBeenCalledTimes(1);await act(async()=>rejeitar(Object.assign(Error('O arquivo não está mais no armazenamento.'),{code:'pdf_not_available'})));expect(screen.getByRole('alert')).toHaveTextContent('PDF não está disponível');expect(screen.getByText(/Declaração 123/)).toBeVisible();expect(api.syncPgdasCircular).not.toHaveBeenCalled();
});

test('consulta tardia após remontagem por empresa não atualiza nem relê contexto antigo',async()=>{
 const api=cliente(),atualizado=jest.fn();let resolver;api.syncPgdasCircular.mockImplementation(()=>new Promise(r=>{resolver=r;}));const props={api,companyId:'a',competencia:'2026-09',onClose:()=>{},onAtualizado:atualizado};const view=render(<HistoricoPgdas key="a" {...props}/>);await screen.findByText(/Declaração 123/);fireEvent.click(screen.getByRole('button',{name:'Conferir na Receita'}));fireEvent.click(screen.getByRole('button',{name:'Confirmar consulta paga'}));api.getPgdasHistorico.mockResolvedValue({ok:true,versoes:[]});view.rerender(<HistoricoPgdas key="b" {...props} companyId="b"/>);await screen.findByText(/Nenhuma declaração registrada/);const count=api.getPgdasHistorico.mock.calls.length;await act(async()=>resolver({ok:true,result:{circular:{}}}));expect(atualizado).not.toHaveBeenCalled();expect(api.getPgdasHistorico).toHaveBeenCalledTimes(count);expect(screen.queryByText(/Conferência sem documentação completa/)).not.toBeInTheDocument();
});
