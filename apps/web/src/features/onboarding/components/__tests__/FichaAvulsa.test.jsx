import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FichaAvulsa, ApresentacaoManual } from "../FichaAvulsa";
const dados = { cnpj: "12345678000199", razaoSocial: "Empresa avulsa", regimeTributario: "SIMPLES", cnaePrincipal: "6201501", endereco: { rua: "Rua Um", numero: "1", bairro: "Centro", cidade: "Rio de Janeiro", uf: "RJ", cep: "20000000" }, socios: [] };
const fichaAvulsa = { cnpj: dados.cnpj, dados, versao: 1, documentos: [{ id: "doc1", nome: "Contrato assinado.pdf" }] };
const onboarding = { id: "o1", versao: 3, cnpj: dados.cnpj };

test("ficha avulsa preserva documento, exige conferência e não ativa portal", async () => {
 const api = { comercial: jest.fn(async () => ({ fichaAvulsa })), salvarFichaAvulsa: jest.fn(async () => ({ fichaAvulsa: { ...fichaAvulsa, versao: 2 } })) };
 render(<FichaAvulsa api={api} onboarding={onboarding} />);
 await screen.findByDisplayValue("Empresa avulsa");
 expect(screen.getByRole("button", { name: "Contrato assinado.pdf" })).toBeInTheDocument();
 expect(screen.getByRole("button", { name: "Salvar ficha da empresa avulsa" })).toBeDisabled();
 fireEvent.click(screen.getByRole("checkbox"));
 fireEvent.click(screen.getByRole("button", { name: "Salvar ficha da empresa avulsa" }));
 await waitFor(() => expect(api.salvarFichaAvulsa).toHaveBeenCalledWith("o1", { versao: 3, dados }));
 expect(screen.getByText(/não ativa contabilidade mensal/)).toBeInTheDocument();
 expect(screen.getByRole("button", { name: "Copiar CNPJ da empresa avulsa" })).toHaveTextContent(dados.cnpj);
});

test("mudança do onboarding não troca a versão do rascunho editado", async () => {
 const api = { comercial: jest.fn(async () => ({ fichaAvulsa })), salvarFichaAvulsa: jest.fn(async () => { throw new Error("A ficha mudou; confira novamente."); }) };
 const ui = render(<FichaAvulsa api={api} onboarding={onboarding} />);
 fireEvent.change(await screen.findByLabelText("Razão social"), { target: { value: "Nome conferido" } });
 ui.rerender(<FichaAvulsa api={api} onboarding={{ ...onboarding, versao: 4 }} />);
 fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Salvar ficha da empresa avulsa" }));
 await screen.findByRole("alert");
 expect(api.salvarFichaAvulsa).toHaveBeenCalledWith("o1", expect.objectContaining({ versao: 3 }));
 expect(screen.getByLabelText("Razão social")).toHaveValue("Nome conferido");
});

test("apresentação manual exige evidência e não se apresenta como envio WhatsApp", () => {
 const salvar = jest.fn(); render(<ApresentacaoManual onSalvar={salvar} versao={2} diagnosticoId="d1" />);
 fireEvent.click(screen.getByText("Já apresentei por reunião ou outro meio"));
 expect(screen.getByRole("button", { name: "Conferi: registrar apresentação" })).toBeDisabled();
 fireEvent.change(screen.getByLabelText("Meio e data"), { target: { value: "Reunião em 16/09/2026" } });
 fireEvent.change(screen.getByLabelText("Evidência e observações"), { target: { value: "Cliente confirmou leitura em reunião" } });
 fireEvent.click(screen.getByRole("button", { name: "Conferi: registrar apresentação" }));
 expect(salvar).toHaveBeenCalledWith(expect.objectContaining({ diagnosticoId: "d1", versao: 2 }));
 expect(screen.getByText(/Não cria recibo de envio/)).toBeInTheDocument();
});
