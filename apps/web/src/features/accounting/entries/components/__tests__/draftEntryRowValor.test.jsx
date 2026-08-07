// A CÉLULA DE VALOR NA TELA — a LIGAÇÃO entre a regra e a linha de lançamento.
//
// A aritmética e a leitura do separador têm cobertura própria em `../../lib/__tests__/valorFormula.test.js`
// e NÃO são reexercitadas aqui. O que esta suíte protege são as três junções onde a regra encontra
// o componente, e onde um erro não apareceria em teste de lib nenhum:
//
//   1. a prévia mostra o que vai ser gravado (é ela que torna a leitura do separador conferível);
//   2. fórmula quebrada DESABILITA o Salvar — nunca grava 0 em silêncio;
//   3. o payload leva o NÚMERO calculado, não o texto digitado.
//
// A (3) é a mais importante: `Number("=10+10")` é `NaN`, e o `|| 0` que existia ali transformaria
// toda fórmula num lançamento de R$ 0,00 sem uma palavra na tela.

import { render, screen, fireEvent } from "@testing-library/react";
import { DraftEntryRow } from "../renderAccountingEntriesParts.jsx";

const CONTAS = [
  { codigo: "426", nome: "Pró-labore" },
  { codigo: "5", nome: "Caixa" },
];

function montar(onSave = jest.fn()) {
  render(
    <table><tbody>
      <DraftEntryRow accounts={CONTAS} onSave={onSave} saving={false} activeComp="2026-07" onClose={() => {}} />
    </tbody></table>,
  );
  const valor = screen.getByPlaceholderText(/=10\+10/);
  // Preenche o resto para o Salvar depender só do valor. Lançamento de uma perna é válido.
  fireEvent.change(screen.getByPlaceholderText("Dia"), { target: { value: "10" } });
  fireEvent.change(screen.getByPlaceholderText("D"), { target: { value: "426" } });
  fireEvent.change(screen.getByPlaceholderText(/Histórico/i), { target: { value: "Teste" } });
  return { valor, onSave, salvar: () => screen.getByRole("button", { name: /Salvar/i }) };
}

describe("célula de valor — a ligação com a regra", () => {
  it("⚠ o input é type=text — com type=number o browser zera o campo ao ver '='", () => {
    // Não é preferência de estilo: é o que permite a fórmula chegar ao handler. Se alguém "corrigir"
    // isto de volta para number, a feature inteira para de funcionar sem quebrar teste nenhum —
    // por isso o teste é explícito.
    const { valor } = montar();
    expect(valor).toHaveAttribute("type", "text");
    expect(valor).toHaveAttribute("inputMode", "decimal");
  });

  it("a prévia mostra o resultado enquanto se digita", () => {
    const { valor } = montar();
    fireEvent.change(valor, { target: { value: "=10+10" } });
    expect(screen.getByText("= 20,00")).toBeInTheDocument();
  });

  it("⚠ a prévia aparece também SEM fórmula — é o que torna o separador conferível", () => {
    // "1.500" pode ser mil e quinhentos ou um e meio. Se a prévia só existisse com "=", esse caso
    // continuaria virando 1.500,00 em silêncio, que é exatamente o buraco que ela existe para tapar.
    const { valor } = montar();
    fireEvent.change(valor, { target: { value: "1.500" } });
    expect(screen.getByText("= 1.500,00")).toBeInTheDocument();
  });

  it("fórmula quebrada mostra o motivo e DESABILITA o Salvar", () => {
    const { valor, salvar } = montar();
    fireEvent.change(valor, { target: { value: "=10+10" } });
    expect(salvar()).toBeEnabled();

    fireEvent.change(valor, { target: { value: "=10+" } });
    expect(screen.getByText(/Fórmula incompleta/i)).toBeInTheDocument();
    expect(salvar()).toBeDisabled();
  });

  it("resultado zero não salva — e diz por quê", () => {
    const { valor, salvar } = montar();
    fireEvent.change(valor, { target: { value: "=10-10" } });
    expect(screen.getByText(/maior que zero/i)).toBeInTheDocument();
    expect(salvar()).toBeDisabled();
  });

  it("⚠ o payload leva o NÚMERO calculado, não o texto", async () => {
    const onSave = jest.fn().mockResolvedValue({ id: "x" });
    const { valor, salvar } = montar(onSave);
    fireEvent.change(valor, { target: { value: "=1.234,56+10" } });
    fireEvent.click(salvar());

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.lines[0].valor).toBe(1244.56);
    // Nunca a string, nunca NaN, nunca 0.
    expect(typeof payload.lines[0].valor).toBe("number");
  });

  it("ao sair do campo, a fórmula VIRA o resultado", () => {
    const { valor } = montar();
    fireEvent.change(valor, { target: { value: "=10+10" } });
    fireEvent.blur(valor);
    expect(valor.value).toBe("20,00");
  });

  it("⚠ fórmula quebrada NÃO é apagada ao sair do campo", () => {
    // Resolver só quando deu certo. Limpar o campo faria a pessoa perder o que digitou sem saber
    // o que estava errado — e o motivo do erro sumiria junto.
    const { valor } = montar();
    fireEvent.change(valor, { target: { value: "=10+" } });
    fireEvent.blur(valor);
    expect(valor.value).toBe("=10+");
  });

  it("Enter não salva com fórmula inválida", () => {
    const onSave = jest.fn();
    const { valor } = montar(onSave);
    fireEvent.change(valor, { target: { value: "=(10+2" } });
    fireEvent.keyDown(valor, { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();
  });
});
