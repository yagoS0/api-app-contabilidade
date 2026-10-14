import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AbaFiscalPanel } from "../AbaFiscalPanel";
import { MotorPanel } from "../MotorPanel";

test("atividade mantém aviso de perfil não salvo e salva depois dos campos", async () => {
  const savePerfil = jest.fn().mockResolvedValue({});
  render(<AbaFiscalPanel panel={{ perfil: { temCadastro: false, candidatos: [{ cnae: "6201501", ativo: true, padrao: false }] }, savePerfil }} />);
  const campo = screen.getByLabelText("Alíquota ISS do CNAE 6201501");
  const salvar = screen.getByRole("button", { name: "Salvar perfil" });
  expect(campo.compareDocumentPosition(salvar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText(/Este perfil ainda NÃO está salvo/)).toBeVisible();
  fireEvent.change(campo, { target: { value: "2.5" } });
  fireEvent.click(salvar);
  await waitFor(() => expect(savePerfil).toHaveBeenCalledWith([expect.objectContaining({ cnae: "6201501", aliquotaIss: 2.5 })]));
});

test("estimativa mantém consequência visível e detalhe recolhido sem alterar cálculo", async () => {
  const apurarV2 = jest.fn().mockResolvedValue({ ok: true, dasCalculadoLocal: 0, rbt12: 0 });
  render(<MotorPanel panel={{ apurarV2 }} />);
  expect(screen.getByText(/Não transmite declaração à Receita/)).toBeVisible();
  expect(screen.getByText(/usa o último valor da empresa/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Folha 12m (R$):"), { target: { value: "15000" } });
  fireEvent.click(screen.getByRole("button", { name: "Calcular estimativa" }));
  const detalhes = await screen.findByText("Detalhes por anexo");
  expect(detalhes.closest("details")).not.toHaveAttribute("open");
  expect(apurarV2).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/), { folha12m: 15000 });
});
