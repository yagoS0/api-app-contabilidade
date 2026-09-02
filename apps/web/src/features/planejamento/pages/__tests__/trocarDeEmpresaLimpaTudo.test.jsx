// ⚠⚠⚠ O VAZAMENTO ENTRE EMPRESAS — o pior defeito desta tela, e ele não tinha teste nenhum.
//
// O efeito de prefill começa com `if (!prefill.temEmpresa) return` e só ESCREVE os campos que a
// empresa tem. Ele nunca limpou nada, e nem chega a rodar quando se volta para "Simulação livre".
// Resultado: todo o estado atravessava a troca de empresa.
//
// ⚠⚠ E UM DELES IMPRIME AFIRMAÇÃO FISCAL FALSA. `servicos16` é a confirmação do art. 15, § 4º da
// Lei 9.249/1995, e `lucroPresumido.js` escreve, com essas letras:
//
//     "IRPJ presumido a 16% POR CONFIRMAÇÃO DO CONTADOR"
//
// Confirmar "usar 16%" na empresa A e ir para a B fazia o PDF da B — que vai ao cliente — atribuir
// a uma PESSOA uma decisão que ela nunca tomou sobre AQUELA empresa. E o § 4º exclui serviços
// hospitalares, de transporte e de profissão regulamentada: a confirmação herdada pode ser ilegal
// para quem a herdou, e o imposto sai MENOR, que é o erro que ninguém confere.

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PlanejamentoPage } from "../renderPlanejamentoPage.jsx";

const EMPRESAS = [
  { id: "a", razao: "ALFA SERVICOS LTDA", cnpj: "11111111000111" },
  { id: "b", razao: "BETA COMERCIO SA", cnpj: "22222222000122" },
];

// ⚠ A forma é a MESMA de `planejamentoPrefillNaTela.test.jsx` — copiada de lá, não inventada:
// dois formatos de payload em dois testes da mesma tela é como um deles passa a medir ficção.
const ok = (valor, origem = "medido") => ({ valor, apurado: true, origem, motivoAusencia: null });
const nao = (motivoAusencia) => ({ valor: null, apurado: false, origem: null, motivoAusencia });

/** Receita pequena de propósito: é ela que faz a pergunta dos R$ 120.000 aparecer nas DUAS. */
function payload(id) {
  return {
    empresa: { id, razao: id === "a" ? "ALFA SERVICOS LTDA" : "BETA COMERCIO SA", cnpj: "11111111000111" },
    referencia: { competencia: "2026-08", janela: [], janelaRotulo: "08/2025 a 07/2026" },
    campos: {
      receitaAnual: ok(100_000),
      rbt12: ok(100_000),
      folhaAnual: nao("Não foi possível apurar a folha"),
      regimeAtual: ok("LUCRO_PRESUMIDO"),
      anexo: ok("III"),
      sujeitoFatorR: ok(false),
      aliquotaIss: nao("Escolha na tela."),
      atividadePresumido: nao("Escolha na tela."),
    },
  };
}

function montar() {
  const api = { getDadosPlanejamento: jest.fn(async (id) => payload(id)) };
  const r = render(<PlanejamentoPage api={api} empresas={EMPRESAS} onVoltar={() => {}} />);
  return { api, ...r };
}

// ⚠ Âncora exata: /empresa/i casa também com "Meses de atividade — só se a empresa…".
const seletorDeEmpresa = () => screen.getByRole("combobox", { name: /^Empresa$/ });
const escolher = async (id) => {
  await act(async () => { fireEvent.change(seletorDeEmpresa(), { target: { value: id } }); });
};
const radio16 = () => screen.getByLabelText(/Enquadra — usar 16%/i);
const receita = () => screen.getByLabelText(/Receita anual/i);
const margem = () => screen.getByLabelText(/Margem de lucro/i);

describe("⚠⚠⚠ a confirmação do art. 15 § 4º NÃO atravessa a troca de empresa", () => {
  it("confirmar 16% na ALFA e ir para a BETA deixa a BETA SEM resposta", async () => {
    montar();
    await escolher("a");
    await waitFor(() => expect(radio16()).toBeInTheDocument());

    fireEvent.click(radio16());
    expect(radio16()).toBeChecked();
    // Com a confirmação de pé, a tela para de avisar que a omissão custa caro.
    expect(screen.queryByText(/o comparativo usa 32%/i)).toBeNull();

    await escolher("b");
    await waitFor(() => expect(radio16()).toBeInTheDocument());
    // ⚠⚠ A asserção que importa: a BETA nasce SEM resposta, e a tela volta a dizer o que a
    // ausência custa. Herdada, ela imprimiria "POR CONFIRMAÇÃO DO CONTADOR" no PDF da BETA.
    expect(radio16()).not.toBeChecked();
    expect(screen.getByText(/o comparativo usa 32%/i)).toBeInTheDocument();
  });

  it("⚠⚠ e VOLTAR para a simulação livre também limpa — ali o prefill nem roda", async () => {
    // Este é o caminho que o conserto ingênuo (limpar dentro do prefill) deixaria aberto: sem
    // empresa, `prefill.temEmpresa` é falso e o efeito de prefill sai na primeira linha.
    montar();
    await escolher("a");
    await waitFor(() => expect(radio16()).toBeInTheDocument());
    fireEvent.click(radio16());
    expect(radio16()).toBeChecked();

    await escolher("");
    // ⚠ Em simulação livre o formulário fica VAZIO, e sem receita a pergunta dos R$ 120.000 nem
    // renderiza — o que por si só já mostra que a limpeza aconteceu, e prova pouco. A asserção
    // forte é reabrir a pergunta digitando uma receita e ver que a RESPOSTA não voltou junto.
    expect(screen.queryByLabelText(/Enquadra — usar 16%/i)).toBeNull();

    fireEvent.change(receita(), { target: { value: "10000000" } }); // R$ 100.000,00
    await waitFor(() => expect(radio16()).toBeInTheDocument());
    expect(radio16()).not.toBeChecked();
    expect(screen.getByText(/o comparativo usa 32%/i)).toBeInTheDocument();
  });
});

describe("⚠ o resto do formulário também não atravessa", () => {
  it("o que foi DIGITADO por cima some — não vira dado da empresa seguinte", async () => {
    montar();
    await escolher("a");
    await waitFor(() => expect(receita()).toHaveValue("100.000,00"));

    fireEvent.change(receita(), { target: { value: "77700000" } });
    fireEvent.change(margem(), { target: { value: "42" } });
    expect(receita()).toHaveValue("777.000,00");

    await escolher("b");
    // A receita volta a ser a da BETA (o prefill reescreve) e a margem — que a empresa NÃO tem —
    // fica em branco. Herdada, ela entraria na conta do Lucro Real da BETA.
    await waitFor(() => expect(receita()).toHaveValue("100.000,00"));
    expect(margem()).toHaveValue("");
  });

  it("⚠ e a limpeza NÃO apaga o que o prefill acabou de escrever — a ordem dos efeitos é o conserto", async () => {
    // A limpeza depende de `empresaId` e roda no instante da troca; o prefill depende da resposta
    // da API, que chega depois. Invertida, a limpeza apagaria os campos recém-preenchidos e a tela
    // ficaria em branco com uma empresa escolhida — o que se lê como "esta empresa não tem dado".
    montar();
    await escolher("a");
    await waitFor(() => expect(receita()).toHaveValue("100.000,00"));
    expect(receita()).not.toHaveValue("");
  });
});
