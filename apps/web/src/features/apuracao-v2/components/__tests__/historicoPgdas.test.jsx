import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { HistoricoPgdas } from "../HistoricoPgdas";
const historico={ok:true,versoes:[{id:'v1',numeroDeclaracao:'123',receitaBruta:100,dasTotal:6,temDeclaracao:true,temRecibo:true,atual:true,legado:true}]};
const cliente=()=>({getPgdasHistorico:jest.fn(async()=>historico),syncPgdasCircular:jest.fn(async()=>({ok:true,result:{circular:{serproSyncStatus:'SUCCESS',pgdasNumeroDeclaracao:'124',pgdasDeclaracaoFileId:'d',pgdasReciboFileId:'r'}}})),fetchPgdasPdfBlob:jest.fn()});
test('abrir e atualizar histórico não consultam Receita; conferência é explícita e documental',async()=>{
 const api=cliente();render(<HistoricoPgdas api={api} companyId="a" competencia="2026-09" onClose={()=>{}}/>);
 await screen.findByText(/Declaração 123 ·/);expect(api.syncPgdasCircular).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Atualizar histórico salvo'}));
 await waitFor(()=>expect(api.getPgdasHistorico).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Conferir retificação na Receita'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Conferir retificação na Receita'}));
 await screen.findByText(/Conferência concluída/);
 expect(api.syncPgdasCircular).toHaveBeenCalledTimes(1);
 expect(api.syncPgdasCircular).toHaveBeenCalledWith('a','2026-09',{somenteDocumentos:true,atualizar:true});
});
test('recusa mantém histórico e não repete chamada',async()=>{
 const api=cliente();api.syncPgdasCircular.mockRejectedValue(Error('Procuração insuficiente'));
 render(<HistoricoPgdas api={api} companyId="a" competencia="2026-09" onClose={()=>{}}/>);
 await screen.findByText(/Declaração 123 ·/);fireEvent.click(screen.getByRole('button',{name:'Conferir retificação na Receita'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Procuração insuficiente');
 expect(screen.getByText(/Declaração 123 ·/)).toBeInTheDocument();expect(api.syncPgdasCircular).toHaveBeenCalledTimes(1);
});
test('resposta tardia desmontada não atualiza outra empresa',async()=>{
 let resolver;const api=cliente(),atualizado=jest.fn();api.syncPgdasCircular.mockImplementation(()=>new Promise(r=>{resolver=r;}));
 const {unmount}=render(<HistoricoPgdas api={api} companyId="a" competencia="2026-09" onClose={()=>{}} onAtualizado={atualizado}/>);
 await screen.findByText(/Declaração 123 ·/);fireEvent.click(screen.getByRole('button',{name:'Conferir retificação na Receita'}));unmount();
 await act(async()=>resolver({ok:true,result:{circular:{}}}));expect(atualizado).not.toHaveBeenCalled();
});


test('declaração recuperada por fora não vira ausência de apuração nem transmite novamente',async()=>{
 const api=cliente();api.getPgdasHistorico.mockResolvedValue({...historico,entregaSemTransmissaoInterna:true,estadoInterno:'aberta'});
 render(<HistoricoPgdas api={api} companyId="a" competencia="2026-09" onClose={()=>{}}/>);
 expect(await screen.findByText(/Apuração comprovada na Receita/)).toHaveTextContent('O estado interno permanece aberta');
 expect(api.syncPgdasCircular).not.toHaveBeenCalled();
});
