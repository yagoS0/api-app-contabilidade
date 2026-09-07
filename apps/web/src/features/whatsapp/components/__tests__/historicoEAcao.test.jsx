import { act, renderHook, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useConversasWhatsapp } from "../../hooks/useConversasWhatsapp";
import { WhatsappPage } from "../../pages/renderWhatsappPage";
import { FioDaConversa } from "../FioDaConversa";
const conversa={id:"cv",portalClientId:"pc",contato:{nome:"Contato teste"},janela:{situacao:"ABERTA"}};
const mensagem=(id,statusEnvio)=>({id,direcao:"out",tipo:"text",corpo:id,statusEnvio,registradaEm:`2026-09-07T10:00:0${id.slice(-1)}Z`});
const apiBase=()=>({listarConversasWhatsapp:jest.fn(async()=>({conversas:[conversa],temMais:false})),getMensagensWhatsapp:jest.fn(async()=>({conversa,mensagens:[],temMais:false}))});
test("mensagens anteriores permanecem durante polling e status recente atualiza",async()=>{
 const api=apiBase();api.getMensagensWhatsapp.mockImplementation(async(id,{cursor}={})=>cursor?{conversa,mensagens:[mensagem("m1","lido")],temMais:false,proximoCursor:null}:{conversa,mensagens:[mensagem("m2","enviado")],temMais:true,proximoCursor:"m2"});
 const {result}=renderHook(()=>useConversasWhatsapp({api}));await waitFor(()=>expect(result.current.conversas).toHaveLength(1));
 await act(async()=>{await result.current.abrir("cv")});await act(async()=>{await result.current.carregarAnteriores()});
 expect(result.current.aberta.mensagens.map(m=>m.id)).toEqual(["m1","m2"]);
 api.getMensagensWhatsapp.mockResolvedValue({conversa,mensagens:[mensagem("m2","falhou")],temMais:true,proximoCursor:"m2"});
 await act(async()=>{await result.current.abrir("cv",true)});
 expect(result.current.aberta.mensagens.map(m=>m.id)).toEqual(["m1","m2"]);expect(result.current.aberta.mensagens[1].statusEnvio).toBe("falhou");expect(result.current.cursorFio).toBeNull();
});
test("mais conversas são acumuladas, trocar filtro descarta página antiga",async()=>{
 const api=apiBase();api.listarConversasWhatsapp.mockImplementation(async(f,{cursor})=>({conversas:[{...conversa,id:cursor?"antiga":f}],temMais:!cursor,proximoCursor:cursor?null:"proxima"}));
 const {result}=renderHook(()=>useConversasWhatsapp({api}));await waitFor(()=>expect(result.current.cursorLista).toBe("proxima"));
 await act(async()=>{await result.current.carregarMais()});expect(result.current.conversas).toHaveLength(2);
 act(()=>result.current.setFiltro("nao-vinculadas"));await waitFor(()=>expect(result.current.conversas.map(c=>c.id)).toEqual(["nao-vinculadas"]));
});
test("assumir recusado fica visível mesmo com recarga bem sucedida e sem feedback externo",async()=>{
 const api={...apiBase(),assumirConversaWhatsapp:jest.fn(async()=>{throw new Error("Conversa assumida por outra pessoa")})};
 render(<WhatsappPage api={api}/>);fireEvent.click(await screen.findByTestId("conversa-cv"));
 fireEvent.click(await screen.findByRole("button",{name:"Assumir"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("Conversa assumida por outra pessoa");
});
test("balão distingue aceite, entrega, falha e histórico não verificado",()=>{
 render(<FioDaConversa fio={{conversa:{...conversa,escopoVerificado:false},mensagens:[mensagem("m1","enviado"),mensagem("m2","entregue"),{...mensagem("m3","falhou"),erroEnvio:{mensagem:"Meta recusou"}}]}} hook={{}}/>);
 expect(screen.getByText(/Aceita pela Meta · aguardando entrega/)).toBeInTheDocument();expect(screen.getByText("Entregue")).toBeInTheDocument();expect(screen.getByText(/Não entregue: Meta recusou/)).toBeInTheDocument();expect(screen.getByText(/Histórico legado sem vínculo verificado/)).toBeInTheDocument();
});
