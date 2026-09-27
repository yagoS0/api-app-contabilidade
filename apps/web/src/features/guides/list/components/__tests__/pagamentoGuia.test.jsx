import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PagamentoGuia } from "../PagamentoGuia";

const guia = { guideId: "g1", tipo: "INSS", competencia: "2026-08", paymentStatus: "PAID", paymentStatusSource: "CLIENTE", paymentConfirmedAt: "2026-09-20T00:00:00.000Z" };
const arquivo = { id: "a1", nomeArquivo: "Recibo.pdf", estado: "DISPONIVEL" };
beforeEach(() => { URL.createObjectURL = jest.fn(() => "blob:comprovante"); URL.revokeObjectURL = jest.fn(); });
test.each([["CLIENTE", "Informado pelo cliente"], ["SERPRO", "Confirmado na Receita"], ["MANUAL", "Confirmado pelo contador"]])("distingue origem %s e data civil", (origem, rotulo) => {
  render(<PagamentoGuia guide={{ ...guia, paymentStatusSource: origem }} />);
  expect(screen.getByText(rotulo)).toBeInTheDocument();
  expect(screen.getByText("20/09/2026")).toBeInTheDocument();
  expect(screen.queryByRole("button")).toBeNull();
});
test("abre original da empresa no modal e libera conteúdo ao fechar", async () => {
  const api = { getConteudoArquivoWhatsapp: jest.fn(async () => ({ nomeArquivo: "Recibo.pdf", mimeType: "application/pdf", base64: btoa("PDF") })) };
  render(<PagamentoGuia guide={{ ...guia, comprovantesCliente: [arquivo] }} companyId="empresa1" api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "Ver comprovante" }));
  fireEvent.click(screen.getByRole("button", { name: "Abrir comprovante" }));
  expect(await screen.findByTitle("Comprovante de pagamento")).toHaveAttribute("src", "blob:comprovante");
  expect(api.getConteudoArquivoWhatsapp).toHaveBeenCalledWith("empresa1", "a1");
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:comprovante");
});
test("erro de acesso aparece sem disponibilizar documento", async () => {
  const api = { getConteudoArquivoWhatsapp: jest.fn(async () => { throw Error("Sem acesso ao arquivo"); }) };
  render(<PagamentoGuia guide={{ ...guia, comprovantesCliente: [arquivo] }} companyId="empresa1" api={api} />);
  fireEvent.click(screen.getByText("Ver comprovante")); fireEvent.click(screen.getByText("Abrir comprovante"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Sem acesso ao arquivo");
  expect(screen.queryByTitle("Comprovante de pagamento")).toBeNull();
});
test("guia aberta não herda confirmação antiga", () => {
  render(<PagamentoGuia guide={{ ...guia, paymentStatus: "OPEN" }} fallback="Em aberto" />);
  expect(screen.getByText("Em aberto")).toBeInTheDocument();
  expect(screen.queryByText("20/09/2026")).toBeNull();
});
