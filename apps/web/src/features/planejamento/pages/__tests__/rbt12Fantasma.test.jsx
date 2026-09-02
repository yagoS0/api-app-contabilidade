// ⚠⚠ O RBT12 FANTASMA — o campo mostrava vazio e o ESTADO continuava cheio.
//
// `value={mesesInicioAtividade ? "" : rbt12}` esconde a EXIBIÇÃO e não toca no estado. Com a
// empresa em início de atividade o RBT12 passa a ser DERIVADO (proporcionalizado, Res. CGSN
// 140/2018 art. 22), mas o valor digitado antes continuava viajando em `entradas.rbt12` — e daí
// saíam DOIS números na mesma tela:
//
//   · `GaugeFatorR`     lê `resultado.fatorR`, calculado sobre o RBT12 PROPORCIONALIZADO
//   · `PainelProLabore` lia `entradas.rbt12`, que era o FANTASMA
//
// Os dois aparecem um embaixo do outro, com percentuais de Fator R diferentes para a MESMA empresa.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PlanejamentoPage } from "../renderPlanejamentoPage.jsx";

function montar() {
  return render(<PlanejamentoPage api={{}} />);
}

const receita = () => screen.getByLabelText(/Receita anual/i);
const rbt12 = () => screen.getByLabelText(/RBT12/i);
const meses = () => screen.getByLabelText(/Meses de atividade/i);

describe("⚠⚠ ligar 'meses de atividade' LIMPA o RBT12, não só o esconde", () => {
  it("o estado do campo fica vazio de verdade", async () => {
    montar();
    fireEvent.change(receita(), { target: { value: "88928609" } });
    fireEvent.change(rbt12(), { target: { value: "71803609" } });
    expect(rbt12()).toHaveValue("718.036,09");

    fireEvent.change(meses(), { target: { value: "6" } });
    await waitFor(() => expect(rbt12()).toHaveValue(""));
    expect(rbt12()).toBeDisabled();
  });

  it("⚠⚠ e desligar NÃO ressuscita o fantasma — o campo continua vazio", async () => {
    // É esta a metade que prova que o estado foi limpo e não apenas escondido: se ele tivesse
    // sobrevivido, o valor antigo voltaria à tela ao desligar, e teria estado na conta o tempo todo.
    montar();
    fireEvent.change(receita(), { target: { value: "88928609" } });
    fireEvent.change(rbt12(), { target: { value: "71803609" } });
    fireEvent.change(meses(), { target: { value: "6" } });
    await waitFor(() => expect(rbt12()).toHaveValue(""));

    fireEvent.change(meses(), { target: { value: "" } });
    await waitFor(() => expect(rbt12()).not.toBeDisabled());
    expect(rbt12()).toHaveValue("");
  });

  it("⚠ e a tela DIZ que o RBT12 passou a ser proporcionalizado", async () => {
    montar();
    fireEvent.change(receita(), { target: { value: "88928609" } });
    fireEvent.change(meses(), { target: { value: "6" } });
    // Campo vazio sem explicação se leria como "faltou preencher". A frase é o que impede isso.
    await waitFor(() => expect(rbt12()).toHaveValue(""));
    expect(rbt12()).toHaveAttribute("placeholder", expect.stringMatching(/proporcionalizado/i));
  });
});
