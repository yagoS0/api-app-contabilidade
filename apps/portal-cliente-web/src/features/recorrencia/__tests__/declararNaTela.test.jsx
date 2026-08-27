// A TELA DE DECLARAR RECORRÊNCIA — a regra chegando à tela.
//
// ⚠ A REGRA tem teste próprio (`../lib/__tests__/declaracaoDeRecorrencia.test.js`). O que se prende
// aqui é o que só se vê montando: que a consequência é dita ANTES do botão, que o valor passa pela
// máscara, que nenhuma conta aparece, e que os dois desfechos do envio não se parecem.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeclararRecorrenciaPage } from "../DeclararRecorrenciaPage";

// ⚠⚠ A FIXTURE TRAZ SÓ `companyId`, NUNCA `id` — e isto é a lição de 26/08/2026: a tela do extrato
// quebrou no navegador com `empresa.id`, e o teste passou porque a fixture era mais generosa que o
// dado real. Fixture mais generosa que a produção esconde exatamente esta classe de defeito.
const EMPRESA = { companyId: "pc-001", razao: "CLIENTE TESTE LTDA" };

function montar(props = {}) {
  const declararRecorrencia = props.declararRecorrencia
    || jest.fn(async () => ({ ok: true, jaDecidida: false, serie: { id: "s-1" } }));
  const aoVoltar = jest.fn();
  const utils = render(
    <DeclararRecorrenciaPage
      empresa={props.empresa ?? EMPRESA}
      api={{ declararRecorrencia }}
      aoVoltar={aoVoltar}
    />,
  );
  return { ...utils, declararRecorrencia, aoVoltar };
}

/** Preenche o formulário inteiro, como uma pessoa faria. */
function preencher({ rotulo = "Anuidade do Conselho", valor = "120000", periodicidade = "ANUAL" } = {}) {
  fireEvent.change(screen.getByLabelText(/O que é\?/i), { target: { value: rotulo } });
  // ⚠ A máscara lê o teclado como FLUXO DE DÍGITOS: "120000" vira "1.200,00".
  fireEvent.change(screen.getByLabelText(/Quanto costuma ser/i), { target: { value: valor } });
  fireEvent.change(screen.getByLabelText(/De quanto em quanto tempo/i), { target: { value: periodicidade } });
}

describe("⚠⚠ a consequência é dita ANTES do botão", () => {
  it("a tela diz que nada entra no fluxo sem o contador", () => {
    montar();
    expect(screen.getByText(/Nada entra no fluxo de caixa até ele confirmar/i)).toBeInTheDocument();
  });

  it("⚠⚠ e diz que o OBSERVADO VENCE — o número do cliente pode ser substituído", () => {
    montar();
    expect(screen.getByText(/o que aconteceu de verdade vale mais/i)).toBeInTheDocument();
  });
});

describe("⚠⚠ NENHUMA CONTA aparece nesta tela", () => {
  it("o cliente não tem plano de contas, e isto é sobre CAIXA", () => {
    const { container } = montar();
    expect(container.textContent).not.toMatch(/plano de contas|conta contábil|débito|crédito/i);
  });

  it("⚠ e o vocabulário não é contabilês: 'dinheiro que sai', não 'despesa'", () => {
    montar();
    expect(screen.getByLabelText(/Dinheiro que sai/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Dinheiro que entra/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O VALOR — aqui o erro é de ORDEM DE GRANDEZA.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o campo de valor é mascarado", () => {
  it("o teclado vira centavos: 120000 → 1.200,00", () => {
    montar();
    fireEvent.change(screen.getByLabelText(/Quanto costuma ser/i), { target: { value: "120000" } });
    expect(screen.getByLabelText(/Quanto costuma ser/i)).toHaveValue("1.200,00");
  });

  it("⚠⚠ a grafia ambígua NÃO PODE SER DIGITADA — o ponto não entra", () => {
    // `1.500` é mil e quinhentos em pt-BR e um vírgula cinco em en-US. Ambiguidade que não pode ser
    // escrita não precisa ser resolvida.
    montar();
    fireEvent.change(screen.getByLabelText(/Quanto costuma ser/i), { target: { value: "1.500" } });
    expect(screen.getByLabelText(/Quanto costuma ser/i).value).not.toBe("1.500");
  });

  it("⚠ e o corpo leva o NÚMERO, não o texto mascarado", async () => {
    const { declararRecorrencia } = montar();
    preencher();
    fireEvent.click(screen.getByRole("button", { name: /Enviar ao meu contador/i }));
    await waitFor(() => expect(declararRecorrencia).toHaveBeenCalled());
    expect(declararRecorrencia).toHaveBeenCalledWith("pc-001", expect.objectContaining({ valor: 1200 }));
  });
});

describe("⚠⚠ o corpo do POST", () => {
  it("leva os quatro campos, com o `companyId` certo", async () => {
    const { declararRecorrencia } = montar();
    preencher();
    fireEvent.click(screen.getByRole("button", { name: /Enviar ao meu contador/i }));
    await waitFor(() => expect(declararRecorrencia).toHaveBeenCalled());
    const [companyId, corpo] = declararRecorrencia.mock.calls[0];
    // ⚠⚠ `companyId`, NÃO `id`: com `empresa.id` a chamada sairia com `undefined`.
    expect(companyId).toBe("pc-001");
    expect(Object.keys(corpo).sort()).toEqual(["lado", "periodicidade", "rotulo", "valor"]);
    expect(corpo).toMatchObject({ lado: "DESPESA", periodicidade: "ANUAL", rotulo: "Anuidade do Conselho" });
  });

  it("⚠⚠ nenhum ESTADO e nenhuma CHAVE viajam — quem decide os dois é o servidor", async () => {
    const { declararRecorrencia } = montar();
    preencher();
    fireEvent.click(screen.getByRole("button", { name: /Enviar ao meu contador/i }));
    await waitFor(() => expect(declararRecorrencia).toHaveBeenCalled());
    const corpo = declararRecorrencia.mock.calls[0][1];
    expect(corpo).not.toHaveProperty("estado");
    expect(corpo).not.toHaveProperty("chave");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ AS FALTAS
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ as faltas só aparecem depois da primeira tentativa", () => {
  it("o formulário NÃO abre acusando quem ainda não digitou nada", () => {
    montar();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("⚠⚠ e ao tentar, TODAS aparecem de uma vez — nunca uma por clique", async () => {
    const { declararRecorrencia } = montar();
    fireEvent.click(screen.getByRole("button", { name: /Enviar ao meu contador/i }));
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toMatch(/Diga o que se repete/i);
    expect(alerta.textContent).toMatch(/Informe quanto costuma ser/i);
    // ⚠ E nada foi enviado.
    expect(declararRecorrencia).not.toHaveBeenCalled();
  });

  it("⚠⚠ ZERO tem frase PRÓPRIA — 'não preenchi' e 'digitei zero' pedem consertos diferentes", async () => {
    montar();
    preencher({ valor: "0" });
    fireEvent.click(screen.getByRole("button", { name: /Enviar ao meu contador/i }));
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toMatch(/maior que zero/i);
    expect(alerta.textContent).not.toMatch(/Informe quanto costuma ser/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ OS DOIS DESFECHOS NÃO SE PARECEM.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ depois de enviar", () => {
  it("o sucesso diz que só passa a contar depois do contador", async () => {
    montar();
    preencher();
    fireEvent.click(screen.getByRole("button", { name: /Enviar ao meu contador/i }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/Anotado/);
    expect(status.textContent).toMatch(/depois que ele confirmar/i);
    expect(status.textContent).toMatch(/Anuidade do Conselho/);
  });

  it("⚠⚠ `jaDecidida` diz que NADA MUDOU — 'registramos' aqui seria mentira", async () => {
    const declararRecorrencia = jest.fn(async () => ({ ok: true, jaDecidida: true, serie: { id: "s-9" } }));
    montar({ declararRecorrencia });
    preencher();
    fireEvent.click(screen.getByRole("button", { name: /Enviar ao meu contador/i }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/já tinha decidido/i);
    expect(status.textContent).toMatch(/não mudou nada/i);
  });

  it("⚠ o formulário se limpa no sucesso — o segundo clique reescreveria a mesma série", async () => {
    montar();
    preencher();
    fireEvent.click(screen.getByRole("button", { name: /Enviar ao meu contador/i }));
    await screen.findByRole("status");
    expect(screen.getByLabelText(/O que é\?/i)).toHaveValue("");
    expect(screen.getByLabelText(/Quanto costuma ser/i)).toHaveValue("");
  });

  it("⚠ mexer no formulário apaga o desfecho — senão o 'anotado' se refere a outro texto", async () => {
    montar();
    preencher();
    fireEvent.click(screen.getByRole("button", { name: /Enviar ao meu contador/i }));
    await screen.findByRole("status");
    fireEvent.change(screen.getByLabelText(/O que é\?/i), { target: { value: "Outra coisa" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  /**
   * ⚠⚠ A RECUSA NOMEADA VIRA UMA FRASE DE CLIENTE — e este teste achou um defeito real.
   *
   * `mensagemDeErro` resolve por CÓDIGO e **não lê `err.message`**, por decisão escrita deste
   * portal. Sem uma entrada em `MENSAGENS`, o `recorrencia_indisponivel` caía no `padrao` ("não foi
   * possível enviar"), e o conserto — *falar com o contador* — nunca chegava ao olho de quem
   * precisa dele. É a mesma lição do `arquivo_grande_demais`.
   */
  it("⚠⚠ a recusa NOMEADA vira a frase do cliente, não 'não foi possível'", async () => {
    const declararRecorrencia = jest.fn(async () => {
      throw Object.assign(new Error("A tabela de recorrências ainda não existe neste banco."), {
        code: "recorrencia_indisponivel",
        status: 503,
      });
    });
    montar({ declararRecorrencia });
    preencher();
    fireEvent.click(screen.getByRole("button", { name: /Enviar ao meu contador/i }));
    // ⚠ O conserto do CLIENTE: ele não sabe o que é uma migration.
    expect(await screen.findByText(/Avise o seu contador/i)).toBeInTheDocument();
    // ⚠⚠ E o texto técnico do servidor NÃO vaza para a tela dele.
    expect(screen.queryByText(/migration|banco de dados|tabela/i)).not.toBeInTheDocument();
  });

  it("⚠ e o `code` nomeado é o que desarma o fallback para o mock (`api/index.js`)", () => {
    // Sem `code`, um 503 cairia no mock e o cliente leria um "anotado" FICTÍCIO — o defeito que o
    // `deveCairParaMock` já pagou com o `danfse_sem_qrcode` e com o 502 da emissão.
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "..", "..", "lib", "mensagens.js"), "utf8");
    expect(fonte).toMatch(/recorrencia_indisponivel:/);
  });
});

describe("⚠⚠ a guarda gêmea da troca de empresa", () => {
  it("trocar de empresa limpa o formulário — declarar para a empresa errada é o estrago", async () => {
    const { rerender } = montar();
    preencher();
    expect(screen.getByLabelText(/O que é\?/i)).toHaveValue("Anuidade do Conselho");

    rerender(
      <DeclararRecorrenciaPage
        empresa={{ companyId: "pc-002", razao: "OUTRA EMPRESA" }}
        api={{ declararRecorrencia: jest.fn() }}
        aoVoltar={jest.fn()}
      />,
    );
    expect(screen.getByLabelText(/O que é\?/i)).toHaveValue("");
  });
});

describe("⚠ o botão de voltar", () => {
  it("fecha o MODO — não navega", () => {
    const { aoVoltar } = montar();
    fireEvent.click(screen.getByRole("button", { name: /^Voltar$/ }));
    expect(aoVoltar).toHaveBeenCalled();
  });
});
