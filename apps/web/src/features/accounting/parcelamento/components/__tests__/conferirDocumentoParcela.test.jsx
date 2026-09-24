import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConferirDocumentoParcela } from "../ConferirDocumentoParcela";
test("conferência usa versão do documento, exige ciência e não registra pagamento", async () => {
  const api = { getDocumentoParcela: jest.fn().mockResolvedValue({ documento: { hash: "hash1", cnpj: "11222333000181", numeroParcelamento: "123", anoMesParcela: "202609", valor: 620, vencimento: "2026-09-20" } }), conferirDocumentoParcela: jest.fn().mockResolvedValue({ ok: true }) };
  const saved = jest.fn();
  render(<ConferirDocumentoParcela api={api} companyId="c1" item={{ parcelaId: "p1" }} onSaved={saved} onClose={jest.fn()} />);
  await screen.findByLabelText("CNPJ");
  expect(screen.getByRole("button", { name: "Confirmar documento" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar documento" }));
  await waitFor(() => expect(api.conferirDocumentoParcela).toHaveBeenCalledWith("c1", "p1", expect.objectContaining({ hash: "hash1", confirmado: true, valor: 620 })));
  expect(api.conferirDocumentoParcela.mock.calls[0][2].paymentStatus).toBeUndefined();
});
