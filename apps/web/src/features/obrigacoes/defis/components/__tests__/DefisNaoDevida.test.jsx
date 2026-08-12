// A LIGAÇÃO entre a regra e a tela — não a regra de novo (essa tem teste próprio em
// `lib/__tests__/obrigatoriedadeDefis.test.js`).
//
// O que se trava aqui é o critério que originou o conserto: **dispensa NÃO é sumir**. A tela mostra
// a empresa dispensada, com o motivo e a fonte, no lugar do fluxo — e o painel não pode virar um
// beco sem saída para o caso que a própria regra documenta (empresa que saiu do Simples continua
// devendo a DEFIS do ano em que foi optante).

import { render, screen } from "@testing-library/react";
import { DefisNaoDevida } from "../DefisNaoDevida";
import { obrigatoriedadeDefis } from "../../lib/obrigatoriedadeDefis";

/** O painel sempre é alimentado pela MESMA leitura da tela — nunca por texto escrito à mão aqui. */
function renderPara(regime, extras = {}) {
  const veredito = obrigatoriedadeDefis({ regime, anoCalendario: 2025 });
  render(<DefisNaoDevida anoCalendario={2025} veredito={veredito} {...extras} />);
  return veredito;
}

describe("DefisNaoDevida — a dispensa aparece, com o motivo", () => {
  it("⚠ Lucro Presumido: o motivo está NA TELA, não escondido", () => {
    const veredito = renderPara("LUCRO_PRESUMIDO");
    expect(screen.getByText("NÃO DEVIDA")).toBeInTheDocument();
    expect(screen.getByText(veredito.motivo)).toBeInTheDocument();
  });

  it("⚠ a FONTE aparece — dispensa sem norma citada é palavra do portal contra a do contador", () => {
    const veredito = renderPara("LUCRO_PRESUMIDO");
    expect(screen.getByText(veredito.fonte)).toBeInTheDocument();
    expect(screen.getByText(/Res\. CGSN 140\/2018, art\. 72/)).toBeInTheDocument();
  });

  it("o ano-calendário fica visível — a resposta é sobre o ANO, não sobre 'hoje'", () => {
    renderPara("LUCRO_PRESUMIDO");
    expect(screen.getByText(/ano-calendário 2025/)).toBeInTheDocument();
  });

  it("⚠ sem regime cadastrado a tela diz NÃO DÁ PARA DIZER — não afirma dispensa", () => {
    const veredito = renderPara("");
    expect(screen.getByText("NÃO DÁ PARA DIZER")).toBeInTheDocument();
    expect(screen.queryByText("NÃO DEVIDA")).not.toBeInTheDocument();
    expect(screen.getByText(veredito.acao)).toBeInTheDocument();
  });

  it("as hipóteses que derrubariam a dispensa estão na tela", () => {
    renderPara("LUCRO_PRESUMIDO");
    expect(screen.getByText(/A empresa foi optante pelo Simples Nacional em algum período/)).toBeInTheDocument();
    expect(screen.getByText(/processo administrativo/i)).toBeInTheDocument();
  });
});

describe("⚠ a dispensa não vira beco sem saída", () => {
  it("dispensada oferece abrir mesmo assim, quando a tela passa a saída", () => {
    renderPara("LUCRO_PRESUMIDO", { onAbrirMesmoAssim: () => {} });
    expect(screen.getByRole("button", { name: /Abrir o espelho de 2025 mesmo assim/ })).toBeInTheDocument();
  });

  it("indefinida NÃO oferece contorno — ali a ação certa é cadastrar o regime", () => {
    // A tela não passa a saída para `indefinida`; e sem ela o botão não existe.
    renderPara("", { onAbrirMesmoAssim: null });
    expect(screen.queryByRole("button", { name: /mesmo assim/ })).not.toBeInTheDocument();
  });

  it("sem saída oferecida, o painel continua informando — ele nunca fica mudo", () => {
    const veredito = renderPara("MEI");
    expect(screen.getByText(veredito.motivo)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mesmo assim/ })).not.toBeInTheDocument();
  });
});
