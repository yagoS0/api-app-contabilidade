import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConferirIdentificacao } from "../ConferirIdentificacao";
const conversa = { id: "cv1", interlocutorId: "p1", identidade: { versao: 3 }, capacidades: { conferirIdentidade: true } };
const apiBase = () => ({ whatsappContratoV2: true, conferirIdentificacaoWhatsapp: jest.fn(async () => ({ ok: true })), listarConversasWhatsapp: jest.fn(async () => ({ conversas: [] })) });
function iniciar() { fireEvent.click(screen.getByRole("button", { name: "Conferir identificação" })); }

test("novo titular exige prévia das consequências e versão conferida", async () => {
 const api = apiBase(); render(<ConferirIdentificacao conversa={conversa} api={api} />); iniciar();
 fireEvent.change(screen.getByLabelText("Resultado"), { target: { value: "NOVO_TITULAR" } });
 fireEvent.change(screen.getByLabelText("Evidência da conferência"), { target: { value: "Confirmação pelo cadastro já verificado" } });
 fireEvent.click(screen.getByRole("button", { name: "Revisar identificação" }));
 expect(api.conferirIdentificacaoWhatsapp).not.toHaveBeenCalled();
 expect(screen.getByText(/O novo titular não receberá o histórico/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: "Confirmar registro da identificação" }));
 await waitFor(() => expect(api.conferirIdentificacaoWhatsapp).toHaveBeenCalledWith("cv1", expect.objectContaining({ acao: "NOVO_TITULAR", versao: 3 })));
});

test("polling de versão não aprova evidência preparada antes da mudança", () => {
 const api = apiBase(); const ui = render(<ConferirIdentificacao conversa={conversa} api={api} />); iniciar();
 fireEvent.change(screen.getByLabelText("Evidência da conferência"), { target: { value: "Conferência anterior documentada" } });
 fireEvent.click(screen.getByRole("button", { name: "Revisar identificação" }));
 ui.rerender(<ConferirIdentificacao conversa={{ ...conversa, identidade: { versao: 4 } }} api={api} />);
 expect(screen.queryByRole("button", { name: "Confirmar registro da identificação" })).not.toBeInTheDocument();
 expect(screen.getByRole("alert")).toHaveTextContent("O cadastro mudou");
 expect(api.conferirIdentificacaoWhatsapp).not.toHaveBeenCalled();
});

test("associação busca pessoa e exige seleção e as duas versões", async () => {
 const api = apiBase(); api.listarConversasWhatsapp.mockResolvedValue({ conversas: [
  { ...conversa, id: "sem-permissao", interlocutorId: "outro", contato: { nome: "Oculto" }, capacidades: {} },
  { ...conversa, id: "cv2", interlocutorId: "p2", contato: { nome: "Liz" }, telefoneMascarado: "(21) *****-7196", identidade: { versao: 7 } }
 ] });
 render(<ConferirIdentificacao conversa={conversa} api={api} />); iniciar();
 fireEvent.change(screen.getByLabelText("Resultado"), { target: { value: "ASSOCIAR_NUMERO" } });
 fireEvent.change(screen.getByLabelText("Buscar contato já conhecido"), { target: { value: "Liz" } });
 fireEvent.click(await screen.findByRole("button", { name: /Liz.*7196/ }));
 expect(screen.queryByRole("button", { name: /Oculto/ })).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText("Evidência da conferência"), { target: { value: "Liz confirmou ambos os números pelo cadastro verificado" } });
 fireEvent.click(screen.getByRole("button", { name: "Revisar identificação" }));
 expect(screen.getByText(/não transfere destinatários/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: "Confirmar registro da identificação" }));
 await waitFor(() => expect(api.conferirIdentificacaoWhatsapp).toHaveBeenCalledWith("cv1", expect.objectContaining({ acao: "ASSOCIAR_NUMERO", versao: 3, destinoConversaId: "cv2", versaoDestino: 7 })));
});

test.each([false, undefined])('sem capacidade não oferece identificação (%s)', capacidade => {
 const api=apiBase();render(<ConferirIdentificacao conversa={{...conversa,capacidades:{conferirIdentidade:capacidade}}} api={api}/>);expect(screen.queryByRole('button',{name:'Conferir identificação'})).not.toBeInTheDocument();expect(api.conferirIdentificacaoWhatsapp).not.toHaveBeenCalled();
});
test('prévia recebe foco e cancelar retorna ao gatilho',()=>{
 render(<ConferirIdentificacao conversa={conversa} api={apiBase()}/>);iniciar();expect(screen.getByLabelText('Resultado')).toHaveFocus();expect(screen.getByLabelText('Evidência da conferência')).toHaveAccessibleDescription(/mínimo de 10/);fireEvent.change(screen.getByLabelText('Evidência da conferência'),{target:{value:'Documento conferido pessoalmente'}});fireEvent.click(screen.getByRole('button',{name:'Revisar identificação'}));expect(screen.getByRole('heading',{name:'Confira a consequência'})).toHaveFocus();fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));expect(screen.getByRole('button',{name:'Conferir identificação'})).toHaveFocus();
});
test('salvamento ocupado anuncia progresso e impede duplo registro',async()=>{
 const api=apiBase();let reject;api.conferirIdentificacaoWhatsapp.mockImplementation(()=>new Promise((_,r)=>{reject=r}));render(<ConferirIdentificacao conversa={conversa} api={api}/>);iniciar();fireEvent.change(screen.getByLabelText('Evidência da conferência'),{target:{value:'Documento conferido pessoalmente'}});fireEvent.click(screen.getByRole('button',{name:'Revisar identificação'}));fireEvent.click(screen.getByRole('button',{name:'Confirmar registro da identificação'}));expect(screen.getByRole('status')).toHaveTextContent('Registrando');expect(screen.getByRole('button',{name:'Cancelar'})).toBeDisabled();expect(screen.getByLabelText('Resultado')).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Registrando…'}));expect(api.conferirIdentificacaoWhatsapp).toHaveBeenCalledTimes(1);reject(Object.assign(Error('IDENTIDADE_ALTERADA'),{code:'IDENTIDADE_ALTERADA'}));expect(await screen.findByRole('alert')).toHaveTextContent('Feche e prepare');expect(screen.getByLabelText('Evidência da conferência')).toHaveValue('Documento conferido pessoalmente');
});
test('busca recusada traduz acesso e não oferece associação',async()=>{
 const api=apiBase();api.listarConversasWhatsapp.mockRejectedValue(Error('forbidden'));render(<ConferirIdentificacao conversa={conversa} api={api}/>);iniciar();fireEvent.change(screen.getByLabelText('Resultado'),{target:{value:'ASSOCIAR_NUMERO'}});fireEvent.change(screen.getByLabelText('Buscar contato já conhecido'),{target:{value:'Maria'}});expect(await screen.findByRole('alert')).toHaveTextContent('Seu acesso');expect(screen.getByRole('button',{name:'Revisar identificação'})).toBeDisabled();expect(api.conferirIdentificacaoWhatsapp).not.toHaveBeenCalled();
});

test('editar a evidência após prévia mantém foco no campo e exige nova revisão',()=>{
 render(<ConferirIdentificacao conversa={conversa} api={apiBase()}/>);iniciar();const campo=screen.getByLabelText('Evidência da conferência');fireEvent.change(campo,{target:{value:'Documento conferido pessoalmente'}});fireEvent.click(screen.getByRole('button',{name:'Revisar identificação'}));campo.focus();fireEvent.change(campo,{target:{value:'Documento conferido pessoalmente e revisado'}});expect(campo).toHaveFocus();expect(screen.queryByRole('button',{name:'Confirmar registro da identificação'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Revisar identificação'})).toBeEnabled();
});
