import { render, screen, fireEvent } from "@testing-library/react";
import { BatchEmailPage } from "../renderBatchEmailPage.jsx";

const row = { portalClientId: "c", razao: "Cliente", cnpj: "11.111.111/0001-11", competencia: "2026-09", mesVencimento: "2026-09",
  pendingGuideIds: ["das", "parcela"], assinatura: "conferida", faltantes: [{ parcelaId: "faltante", motivo: "Guia da parcela ainda não disponível", acordo: "A2", numeroParcela: 9, vencimento: "2026-09-30" }],
  documentos: [{ guideId: "das", tipo: "SIMPLES", competencia: "2026-08", vencimento: "2026-09-20", valor: 100 },
    { guideId: "parcela", parcelamentoId: "A1", acordo: "A1", numeroParcela: 9, competencia: "2026-09", vencimento: "2026-09-30", valor: 200 },
    { guideId: "paga", tipo: "INSS", paga: true, competencia: "2026-08", vencimento: "2026-09-20", valor: 300 }] };
function montar(extra = {}) {
  const onSend = jest.fn();
  const whatsapp = { canal: { disponivel: true }, prever: jest.fn(), limpar: jest.fn() };
  const result = render(<BatchEmailPage report={{ mesVencimento: "2026-09", simples: [row], presumidos: [], outros: [] }}
    onLoad={jest.fn()} onSend={onSend} whatsapp={whatsapp} {...extra} />);
  fireEvent.change(screen.getByLabelText("Mês de vencimento"), { target: { value: "2026-09" } });
  return { ...result, onSend, whatsapp };
}
test("mostra cada documento, referência preservada e parcela faltante", () => {
  montar();
  expect(screen.getByText(/Lote incompleto/)).toBeInTheDocument();
  expect(screen.getByText(/acordo A2/)).toBeInTheDocument();
  expect(screen.getByText("Paga — fora do envio")).toBeInTheDocument();
  expect(screen.getAllByText("2026-08")).toHaveLength(2);
});
test("e-mail e WhatsApp recebem os mesmos IDs; a guia paga não vai junto", () => {
  const { onSend, whatsapp } = montar();
  fireEvent.click(screen.getByLabelText("Selecionar Cliente"));
  fireEvent.click(screen.getByRole("button", { name: "Enviar por WhatsApp (1)" }));
  expect(whatsapp.prever).toHaveBeenCalledWith({ mesVencimento: "2026-09", portalClientIds: ["c"], guideIds: ["das", "parcela"] });
  fireEvent.click(screen.getByRole("button", { name: "Enviar e-mails (1)" }));
  expect(onSend).toHaveBeenCalledWith([{ portalClientId: "c", mesVencimento: "2026-09", guideIds: ["das", "parcela"], assinatura: "conferida" }]);
});
test("empresa só com parcela faltante continua visível e não pode ser enviada", () => {
  montar({ report: { mesVencimento: "2026-09", simples: [{ ...row, documentos: [], pendingGuideIds: [] }] } });
  expect(screen.getByLabelText("Selecionar Cliente")).toBeDisabled();
  expect(screen.getByText(/acordo A2/)).toBeVisible();
});
