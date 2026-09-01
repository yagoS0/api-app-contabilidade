// ⚠⚠ A LIGAÇÃO DO IBS/CBS. `ibsCbsNoSimples.test.js` prova a REGRA e continuaria verde com a
// página nunca renderizando o bloco — é a lição que este projeto já pagou nesta mesma tela
// ("um experimento voltou ZERO vermelhos: a regra pura tinha 17 testes e a ligação tinha nenhum").
//
// O que se mede aqui é a corrente: receita digitada → motor → anexo/faixa/alíquota → bloco.

import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PlanejamentoPage } from "../renderPlanejamentoPage.jsx";

function montar() {
  return render(<PlanejamentoPage api={{}} />);
}

/** Uma receita que põe a empresa numa faixa conhecida do Anexo III. */
function comReceita(valorEmCentavos = "10000000") {
  fireEvent.change(screen.getByLabelText(/Receita anual/i), { target: { value: valorEmCentavos } });
}

const bloco = () => screen.getByRole("region", { name: /IBS e CBS no Simples Nacional/i });
const irPara = (nome) => fireEvent.click(within(bloco()).getByRole("button", { name: nome }));

describe("⚠⚠ 2026 na TELA: zero, e dito com todas as letras", () => {
  it("o bloco abre em 2026 e mostra R$ 0,00 — não um traço", () => {
    montar();
    comReceita();
    // ⚠ Traço cinza aqui seria lido como "não deu para calcular". O dono pediu que a tela MOSTRE
    // que é zero.
    expect(within(bloco()).getByText("R$ 0,00")).toBeInTheDocument();
    expect(within(bloco()).getByText(/não recolhe IBS nem CBS/i)).toBeInTheDocument();
  });

  it("⚠ e cita o dispositivo — a afirmação não fica sem fundamento", () => {
    montar();
    comReceita();
    expect(within(bloco()).getByText(/art\. 348, III, "c"/)).toBeInTheDocument();
  });

  it("⚠ diz que as alíquotas de teste EXISTEM — o que não existe é elas alcançarem o optante", () => {
    // Sem isso, o contador conclui que não há IBS/CBS em 2026 para ninguém.
    montar();
    comReceita();
    expect(within(bloco()).getAllByText(/não alcançam/i).length).toBeGreaterThan(0);
  });

  it("⚠⚠ e NÃO há campo de CBS em 2026 — não há o que estimar", () => {
    montar();
    comReceita();
    expect(within(bloco()).queryByLabelText(/Alíquota da CBS/i)).toBeNull();
  });
});

describe("⚠⚠ 2027–2028 na TELA: por dentro × por fora", () => {
  it("o crédito 'por dentro' aparece calculado, sem precisar digitar nada", () => {
    // É a metade EXATA: ela sai do Anexo e da alíquota efetiva, sem estimativa nenhuma.
    montar();
    comReceita();
    irPara("2027–2028");
    expect(within(bloco()).getByText(/do valor da operação vira crédito para quem compra desta empresa/i))
      .toBeInTheDocument();
  });

  it("⚠⚠ sem a CBS digitada, o 'por fora' DIZ que não estima — nunca mostra um número", () => {
    montar();
    comReceita();
    irPara("2027–2028");
    expect(within(bloco()).getByText(/Não estimamos esse número por você/i)).toBeInTheDocument();
  });

  it("digitada a CBS, os dois lados aparecem e a diferença é dita", () => {
    montar();
    comReceita();
    irPara("2027–2028");
    fireEvent.change(within(bloco()).getByLabelText(/Alíquota da CBS/i), { target: { value: "8,8" } });
    expect(within(bloco()).getByText(/A diferença é de/i)).toBeInTheDocument();
    expect(within(bloco()).queryByText(/Não estimamos esse número por você/i)).toBeNull();
  });

  it("⚠⚠ o IBS é dito como VINDO DA LEI, e o campo é só da CBS", () => {
    montar();
    comReceita();
    irPara("2027–2028");
    expect(within(bloco()).getByText(/O IBS não se digita/i)).toBeInTheDocument();
    expect(within(bloco()).getByText(/art\. 344/)).toBeInTheDocument();
  });

  it("⚠⚠ a CBS informada é marcada como estimativa, com o prazo do Senado", () => {
    montar();
    comReceita();
    irPara("2027–2028");
    expect(within(bloco()).getByText(/15\/12\/2026/)).toBeInTheDocument();
  });

  it("⚠⚠ a janela é anunciada como LEGAL, e a tela NÃO afirma que o procedimento está disponível", () => {
    // O § 10 remete a forma à regulamentação do CGSN, e não há prova de que o ato exista.
    montar();
    comReceita();
    irPara("2027–2028");
    expect(within(bloco()).getByText(/setembro e março/i)).toBeInTheDocument();
    expect(within(bloco()).getByText(/não confirma que o procedimento já está disponível/i))
      .toBeInTheDocument();
  });

  it("⚠ a trava de saída é 'corrente ou anterior', nunca 'no ano seguinte'", () => {
    montar();
    comReceita();
    irPara("2027–2028");
    expect(within(bloco()).getByText(/corrente ou anterior/i)).toBeInTheDocument();
  });

  it("⚠ e a tela lembra que crédito só vale para quem compra no regime regular", () => {
    // O número sozinho não decide: para consumidor final, crédito não vale nada.
    montar();
    comReceita();
    irPara("2027–2028");
    fireEvent.change(within(bloco()).getByLabelText(/Alíquota da CBS/i), { target: { value: "8,8" } });
    // ⚠ `getAllByText`: o <strong> e o <p> que o envolve casam os dois — é a marcação, não defeito.
    expect(within(bloco()).getAllByText(/regime regular/i).length).toBeGreaterThan(0);
  });
});

describe("⚠⚠⚠ QUANTO A EMPRESA PAGA — defeito relatado pelo dono em 01/09/2026", () => {
  // > "o que não ficou claro no CBS e IBS é quanto meu cliente vai pagar de imposto; no caso ela
  // > só diz quanto de crédito ele vai gerar."
  //
  // O crédito transferido responde "quanto o cliente DO meu cliente ganha". Quem precisa decidir
  // entre ficar e sair precisa da outra metade, e ela vem PRIMEIRO na tela.

  it("⚠⚠ diz que o DAS NÃO MUDA ficando por dentro — a afirmação mais valiosa do bloco", () => {
    montar();
    comReceita();
    irPara("2027–2028");
    expect(within(bloco()).getByText(/Quanto esta empresa vai pagar/i)).toBeInTheDocument();
    // ⚠ `getAllByText`: a frase aparece no destaque E na explicação logo abaixo — de
    // propósito, porque a segunda é a que diz POR QUE ele não muda.
    expect(within(bloco()).getAllByText(/o DAS não muda/i).length).toBeGreaterThan(0);
  });

  it("⚠ e mostra quanto DO DAS já é CBS e IBS", () => {
    montar();
    comReceita();
    irPara("2027–2028");
    expect(within(bloco()).getByText(/é CBS/i)).toBeInTheDocument();
  });

  it("saindo por fora, mostra o que SAI do DAS e o débito que ENTRA", () => {
    montar();
    comReceita();
    irPara("2027–2028");
    fireEvent.change(within(bloco()).getByLabelText(/Alíquota da CBS/i), { target: { value: "8,8" } });
    expect(within(bloco()).getByText(/saem .* do DAS por ano/i)).toBeInTheDocument();
    expect(within(bloco()).getByText(/antes dos créditos das compras/i)).toBeInTheDocument();
  });

  it("⚠⚠⚠ e DIZ que a conta não fecha, com os dois motivos — isto É o produto", () => {
    // Um "total por fora" cravado seria número inventado num documento que vai ao cliente: faltam
    // os créditos das compras (a tela não sabe o que a empresa compra) e a fórmula de recomposição
    // do DAS, que a lei não traz.
    montar();
    comReceita();
    irPara("2027–2028");
    fireEvent.change(within(bloco()).getByLabelText(/Alíquota da CBS/i), { target: { value: "8,8" } });
    expect(within(bloco()).getByText(/Não dá para fechar esse total aqui/i)).toBeInTheDocument();
    expect(within(bloco()).getByText(/folha não gera crédito/i)).toBeInTheDocument();
    expect(within(bloco()).getByText(/não traz a fórmula de recomposição/i)).toBeInTheDocument();
  });

  it("⚠ o 'quanto paga' aparece ANTES do 'quanto de crédito' — é a ordem da decisão", () => {
    montar();
    comReceita();
    irPara("2027–2028");
    const texto = bloco().textContent;
    expect(texto.indexOf("Quanto esta empresa vai pagar"))
      .toBeLessThan(texto.indexOf("E quanto de crédito ela transfere"));
  });
});

describe("⚠ o bloco não aparece onde não faz pergunta", () => {
  it("sem receita não há anexo nem faixa — o bloco não renderiza", () => {
    montar();
    expect(screen.queryByRole("region", { name: /IBS e CBS/i })).toBeNull();
  });
});
