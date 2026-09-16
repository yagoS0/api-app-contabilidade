import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConversaoModal } from "../ConversaoModal";

const ficha = { razaoSocial: "Exemplo LTDA", cnpj: "11222333000181", responsavelNome: "Ana", responsavelEmail: "ana@example.invalid", emailJaCadastrado: true, dados: { capitalSocialPretendido: "25.000,50", responsavelTelefone: "11900000001", socios: [{ nome: "Ana", cpf: "52998224725", participacao: "100" }] } };
test("contador revisa sócios, capital e endereço antes de enviar a ficha completa", async () => {
  const converter = jest.fn().mockResolvedValue({});
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  render(<ConversaoModal onboarding={ficha} onConverter={converter} onFechar={() => {}} />);
  expect(screen.getByLabelText("Nome do sócio 1")).toHaveValue("Ana");
  expect(screen.getByLabelText("Capital social (R$)")).toHaveValue("25.000,50");
  expect(screen.getByRole("button", { name: "Criar empresa" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Regime tributário"), { target: { value: "SIMPLES" } });
  fireEvent.change(screen.getByLabelText("CNAE principal"), { target: { value: "7020400" } });
  fireEvent.change(screen.getByLabelText("CNAEs secundários"), { target: { value: "8599604" } });
  for (const [campo, valor] of [["Rua", "Rua de Teste"], ["Número", "100"], ["Bairro", "Centro"], ["Cidade", "São Paulo"], ["UF", "SP"], ["CEP", "01001000"]]) fireEvent.change(screen.getByLabelText(new RegExp(`^${campo}`)), { target: { value: valor } });
  const revisao = screen.getByRole("checkbox", { name: /Conferi os dados definitivos/ });
  expect(screen.getByRole("button", { name: "Criar empresa" })).toBeDisabled();
  fireEvent.click(revisao);
  fireEvent.change(screen.getByLabelText("Capital social (R$)"), { target: { value: "30.000,75" } });
  expect(revisao).not.toBeChecked();
  fireEvent.click(revisao); fireEvent.click(screen.getByRole("button", { name: "Criar empresa" }));
  await waitFor(() => expect(converter).toHaveBeenCalledTimes(1));
  expect(converter.mock.calls[0][0]).toMatchObject({ ownerEmail: ficha.responsavelEmail, contato: { telefone: "11900000001", whatsappAutorizado: false }, company: { cnpj: "11222333000181", capitalSocial: "30.000,75", socios: ficha.dados.socios, cnaesSecundarios: ["8599604"], endereco: { numero: "100" } } });
  expect(converter.mock.calls[0][0].ownerPassword).toBeUndefined();
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("CNPJ 11222333000181")); confirm.mockRestore();
});
