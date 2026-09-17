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
