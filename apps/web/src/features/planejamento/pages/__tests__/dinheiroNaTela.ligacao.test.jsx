// ⚠⚠ A LIGAÇÃO DO DINHEIRO — e ela é obrigatória, não redundante.
//
// A lição está escrita neste projeto, sobre esta mesma tela: *"um experimento voltou ZERO vermelhos
// — a regra pura tinha 17 testes e a LIGAÇÃO tinha nenhum"*. `dinheiroDoPlanejamento.test.js` prova
// que `mascararDinheiro`/`colarDinheiro` estão certos; ele continuaria verde com a página nunca
// chamando nenhum dos dois.
//
// O que este arquivo mede é a corrente: **tecla → campo → número que o motor recebe**.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlanejamentoPage } from "../renderPlanejamentoPage.jsx";

function montar() {
  return render(<PlanejamentoPage api={{}} />);
}

const receita = () => screen.getByLabelText(/Receita anual/i);
const folha = () => screen.getByLabelText(/Folha anual/i);

/** Digitar de verdade é um `change` com o conteúdo bruto — é o que o navegador entrega. */
function digitar(campo, texto) {
  fireEvent.change(campo, { target: { value: texto } });
}

function colar(campo, texto) {
  fireEvent.paste(campo, { clipboardData: { getData: () => texto } });
}

describe("⚠⚠ o campo de dinheiro na TELA — o ×100 não é mais escrevível", () => {
  it("⚠⚠ `1234.56` vira R$ 1.234,56 no campo — ele virava 123.456 no motor", () => {
    montar();
    digitar(receita(), "1234.56");
    // O ponto não entra: o que resta são os dígitos, e eles empurram as casas decimais.
    expect(receita()).toHaveValue("1.234,56");
  });

  it("⚠ e o valor cresce dígito a dígito, como campo de banco", () => {
    montar();
    digitar(receita(), "1");
    expect(receita()).toHaveValue("0,01");
    digitar(receita(), "150000");
    expect(receita()).toHaveValue("1.500,00");
  });

  it("apagar tudo devolve o campo VAZIO — nunca `0,00`", () => {
    montar();
    digitar(receita(), "150000");
    digitar(receita(), "");
    expect(receita()).toHaveValue("");
  });

  it("⚠⚠ a FOLHA distingue vazio de zero, e a tela preserva a distinção", () => {
    // `folhaAusenteNaoEZero`: vazio ⇒ o Simples sai `indisponivel`; zero digitado ⇒ calcula.
    // Se a máscara fabricasse "0,00" num campo em branco, a empresa cairia no Anexo V (a alíquota
    // maior) por causa de um zero que ninguém digitou.
    montar();
    expect(folha()).toHaveValue("");
    digitar(folha(), "0");
    expect(folha()).toHaveValue("0,00");
  });
});

describe("⚠⚠ colar na tela: o que tem uma leitura entra, o que tem duas é RECUSADO com o motivo", () => {
  it("⚠ `R$ 889.286,09` — o valor copiado da PRÓPRIA tela — entra", () => {
    montar();
    colar(receita(), "R$ 889.286,09");
    expect(receita()).toHaveValue("889.286,09");
  });

  it("⚠⚠ `1,500.00` (planilha em inglês) entra como mil e quinhentos, não como 1,5", () => {
    montar();
    colar(receita(), "1,500.00");
    expect(receita()).toHaveValue("1.500,00");
  });

  it("⚠⚠ `1.500` é RECUSADO, o campo fica como estava, e a tela DIZ por quê", async () => {
    montar();
    digitar(receita(), "12300");
    colar(receita(), "1.500");
    // Campo intocado mais uma frase é melhor que um número plausível e errado: "1.500" é mil e
    // quinhentos em pt-BR e um e meio em en-US, e não há como escolher.
    expect(receita()).toHaveValue("123,00");
    await waitFor(() => expect(screen.getByText(/duas leituras possíveis/i)).toBeInTheDocument());
  });

  it("⚠ a recusa fica ao lado do CAMPO que a causou, não numa barra global", () => {
    montar();
    colar(folha(), "1,500");
    const frase = screen.getByText(/duas leituras possíveis/i);
    // O `<label>` do campo é o ancestral: é ele que amarra a frase ao campo certo quando há quatro
    // campos de dinheiro na mesma tela.
    expect(frase.closest("label")).toBe(folha().closest("label"));
  });
});

describe("⚠⚠ percentual NÃO ganhou a máscara de moeda — e o ponto virou decimal", () => {
  const iss = () => screen.getByLabelText(/Alíquota de ISS/i);
  const margem = () => screen.getByLabelText(/Margem/i);

  it("⚠ `5` continua `5`, e não vira `0,05`", () => {
    montar();
    digitar(iss(), "5");
    expect(iss()).toHaveValue("5");
  });

  it("⚠⚠ margem NEGATIVA é recusada e a tela diz — ela produzia IMPOSTO NEGATIVO", () => {
    montar();
    digitar(margem(), "-5");
    expect(screen.getByText(/A margem de lucro precisa ser um percentual/i)).toBeInTheDocument();
  });

  it("⚠ e um percentual válido não acende recusa nenhuma", () => {
    montar();
    digitar(margem(), "12,5");
    expect(screen.queryByText(/A margem de lucro precisa ser um percentual/i)).toBeNull();
  });
});
