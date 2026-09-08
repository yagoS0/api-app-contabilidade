import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CompanyDocumentsTab } from "../renderCompanyDocumentsTab";
import { CompanyNotesTab } from "../renderCompanyNotesTab";
import { CompanyCertificatePanel } from "../../../certificate/components/CompanyCertificatePanel";

const base = () => ({ documentos: [], tipos: ["CONTRATO_SOCIAL"], tipoLabels: {}, carregando: false, selecionados: new Set(), alternarSelecao: jest.fn(), limparSelecao: jest.fn(), enviarArquivo: jest.fn(), excluir: jest.fn(), enviarPorEmail: jest.fn(), baixar: jest.fn(), baixarSelecionados: jest.fn() });

test("upload recusado preserva arquivo, nome e fila para repetir", async () => {
  const docs = base();
  docs.enviarArquivo.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const { container } = render(<CompanyDocumentsTab docs={docs} />);
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File(["a"], "primeiro.pdf"), new File(["b"], "segundo.pdf")] } });
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Contrato revisado" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Nome")).toHaveValue("Contrato revisado");
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => expect(screen.getByLabelText("Nome")).toHaveValue("segundo.pdf"));
});

test("exclusão parcial informa arquivo pendente e não limpa seleção", async () => {
  const docs = base();
  docs.documentos = [{ id: "1", nome: "primeiro.pdf" }, { id: "2", nome: "segundo.pdf" }];
  docs.selecionados = new Set(["1", "2"]);
  docs.excluir.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  render(<CompanyDocumentsTab docs={docs} />);
  fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Excluir" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 não excluído(s): segundo.pdf"));
  expect(docs.limparSelecao).not.toHaveBeenCalled();
});

test("envio exige destinatário visível e usa exatamente o endereço informado", async () => {
  const docs = base(); docs.documentos = [{ id: "1", nome: "contrato.pdf" }]; docs.selecionados = new Set(["1"]);
  render(<CompanyDocumentsTab docs={docs} />);
  fireEvent.click(screen.getByRole("button", { name: /Enviar por e-mail/ }));
  const enviar = screen.getByRole("button", { name: "Enviar 1 documento(s)" });
  expect(enviar).toBeDisabled();
  fireEvent.change(screen.getByLabelText("E-mail do destinatário"), { target: { value: "cliente@example.com" } });
  fireEvent.click(enviar);
  expect(docs.enviarPorEmail).toHaveBeenCalledWith("cliente@example.com");
});

test("falha de notas não afirma ausência", () => {
  render(<CompanyNotesTab notes={{ fixada: null, demais: [], erro: "Sem rede", ordenarPor: "data", recarregar: jest.fn() }} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Sem rede");
  expect(screen.queryByText(/Nenhuma anotação ainda/)).not.toBeInTheDocument();
});

test("falha de leitura do A1 permite repetir e não afirma ausência", async () => {
  const api = { getCompanyCert: jest.fn().mockRejectedValueOnce(new Error("Sem rede")).mockResolvedValue({ hasCertificate: false }) };
  render(<CompanyCertificatePanel api={api} companyId="1" />);
  await screen.findByRole("alert");
  expect(screen.queryByText(/Nenhum A1 próprio cadastrado/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  await screen.findByText(/Nenhum A1 próprio cadastrado/);
});
