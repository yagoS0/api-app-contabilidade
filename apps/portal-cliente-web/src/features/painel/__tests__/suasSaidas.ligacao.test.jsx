// ⚠⚠ AS SAÍDAS QUE O CLIENTE ACRESCENTA — a ligação (29/08/2026).
//
// > Dono: *"o cliente pode modificar as saídas, podendo colocar novas saídas, **apenas para
// > visualização deles**"* · *"as duas coisas"* (avulsa e recorrente) · ***"só acrescentar"***.
//
// ⚠⚠ O que este arquivo protege é a distância entre PLANEJAR e LANÇAR. O que sai daqui é previsão
// no fluxo do cliente e uma linha na fila do contador — nunca `D despesa / C caixa`, que afirmaria
// que o dinheiro saiu.

import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { api } from "../../../api";
import { SuasSaidas } from "../SuasSaidas";

const avulsa = (extra = {}) => ({
  fonte: "SAIDA_DO_CLIENTE", direcao: "SAIDA", procedencia: "PREVISAO",
  competencia: "2026-09", dia: 10, valor: 3000, rotulo: "Reforma da sala",
  base: { doCliente: true, estadoDaSaida: "PENDENTE" },
  referencia: { tipo: "saidaAvulsa", id: "sa-1" }, ...extra,
});

const declarada = (competencia, extra = {}) => ({
  fonte: "SERIE_DESPESA", direcao: "SAIDA", procedencia: "PREVISAO",
  competencia, dia: null, valor: 1200, rotulo: "Aluguel",
  base: { origem: "DECLARADA", periodicidade: "MENSAL" },
  referencia: { tipo: "serie", id: "sr-1" }, ...extra,
});

const mesesCom = (...linhasPorMes) => linhasPorMes.map((linhas, i) => ({
  competencia: `2026-0${8 + i}`, linhas,
}));

function abrir(meses = [], props = {}) {
  const aoMudar = jest.fn();
  render(<SuasSaidas companyId="pc-001" meses={meses} aoMudar={aoMudar} {...props} />);
  return { aoMudar };
}

const clicar = async (nome) => {
  await act(async () => { screen.getByRole("button", { name: nome }).click(); });
};

const digitar = (rotulo, valor) => {
  fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
};

afterEach(() => { jest.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a fronteira: isto NÃO é contabilidade", () => {
  it("⚠⚠ a tela DIZ que não lança nada — sem a frase, o cliente cobraria um lançamento que não existe", () => {
    abrir();
    expect(screen.getByText(/não lança nada na contabilidade/i)).toBeInTheDocument();
    expect(screen.getByText(/entra no seu fluxo como/i)).toBeInTheDocument();
  });

  it("⚠⚠ o botão tem RÓTULO — `+` mudo é o vocabulário de quem edita a contabilidade na grade", () => {
    abrir();
    const b = screen.getByRole("button", { name: /Saída/ });
    expect(b.textContent.trim()).not.toBe("+");
    expect(b.textContent).toMatch(/Saída/);
  });

  it("⚠⚠ NÃO existe editar — a resposta do dono foi 'só acrescentar'", () => {
    abrir(mesesCom([avulsa()]));
    for (const b of screen.getAllByRole("button")) {
      expect(b.textContent).not.toMatch(/editar|alterar|corrigir/i);
    }
  });

  it("⚠ vazio DIZ que está vazio — a seção não some quando não há nada", () => {
    abrir();
    expect(screen.getByText(/ainda não acrescentou nenhuma saída/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Saída/ })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ acrescentar — as duas formas, num formulário só", () => {
  it("a AVULSA manda tipo, descrição, valor e DATA", async () => {
    const criar = jest.spyOn(api, "criarSaidaDoFluxo").mockResolvedValue({ ok: true });
    const { aoMudar } = abrir();
    await clicar("+ Saída");
    digitar("O que é", "Reforma da sala");
    digitar("Valor", "300000");
    digitar("Data em que você pretende pagar", "2026-09-10");
    await act(async () => { screen.getByRole("button", { name: "Acrescentar" }).click(); });

    expect(criar).toHaveBeenCalledWith("pc-001", {
      tipo: "AVULSA", descricao: "Reforma da sala", valor: 3000, data: "2026-09-10",
    });
    expect(aoMudar).toHaveBeenCalled();
  });

  it("a RECORRENTE manda a PERIODICIDADE e NENHUMA data", async () => {
    // ⚠ Ela guarda ciclo, não data — mandar uma data aqui seria inventar o dia de um compromisso
    // que a pessoa descreveu como "todo mês".
    const criar = jest.spyOn(api, "criarSaidaDoFluxo").mockResolvedValue({ ok: true });
    abrir();
    await clicar("+ Saída");
    digitar("O que é", "Aluguel");
    digitar("Valor", "120000");
    fireEvent.click(screen.getByLabelText(/Se repete/));
    await act(async () => { screen.getByRole("button", { name: "Acrescentar" }).click(); });

    expect(criar).toHaveBeenCalledWith("pc-001", {
      tipo: "RECORRENTE", descricao: "Aluguel", valor: 1200, periodicidade: "MENSAL",
    });
    expect(criar.mock.calls[0][1]).not.toHaveProperty("data");
  });

  it("⚠⚠ o VALOR passa pela máscara de centavos — a mesma da emissão de nota", async () => {
    // O que ela substituiu emitia nota por 1/1000 do valor: `Number("1.500,00")` é NaN.
    abrir();
    await clicar("+ Saída");
    digitar("Valor", "1500");
    expect(screen.getByLabelText("Valor").value).toBe("15,00");
    digitar("Valor", "150000");
    expect(screen.getByLabelText("Valor").value).toBe("1.500,00");
  });

  it("⚠⚠ ZERO não passa — `required` do HTML deixaria", async () => {
    const criar = jest.spyOn(api, "criarSaidaDoFluxo").mockResolvedValue({ ok: true });
    abrir();
    await clicar("+ Saída");
    digitar("O que é", "Nada");
    digitar("Valor", "0");
    digitar("Data em que você pretende pagar", "2026-09-10");
    await act(async () => { screen.getByRole("button", { name: "Acrescentar" }).click(); });
    expect(criar).not.toHaveBeenCalled();
    expect(screen.getByText(/maior que zero/i)).toBeInTheDocument();
  });

  it("⚠ sem descrição também não sai, e a tela diz o que falta", async () => {
    const criar = jest.spyOn(api, "criarSaidaDoFluxo").mockResolvedValue({ ok: true });
    abrir();
    await clicar("+ Saída");
    digitar("Valor", "10000");
    digitar("Data em que você pretende pagar", "2026-09-10");
    await act(async () => { screen.getByRole("button", { name: "Acrescentar" }).click(); });
    expect(criar).not.toHaveBeenCalled();
    expect(screen.getByText(/Escreva o que é esta saída/i)).toBeInTheDocument();
  });

  it("⚠ avulsa sem data não sai — a data é o que a distingue da recorrente", async () => {
    const criar = jest.spyOn(api, "criarSaidaDoFluxo").mockResolvedValue({ ok: true });
    abrir();
    await clicar("+ Saída");
    digitar("O que é", "Reforma");
    digitar("Valor", "10000");
    await act(async () => { screen.getByRole("button", { name: "Acrescentar" }).click(); });
    expect(criar).not.toHaveBeenCalled();
    expect(screen.getByText(/Escolha a data/i)).toBeInTheDocument();
  });

  it("⚠⚠ a recusa do SERVIDOR aparece com a frase DELE — a tela não a reescreve", async () => {
    jest.spyOn(api, "criarSaidaDoFluxo").mockRejectedValue({
      code: "valor_invalido", corpo: { message: "O valor precisa ser um número maior que zero." },
    });
    abrir();
    await clicar("+ Saída");
    digitar("O que é", "X");
    digitar("Valor", "10000");
    digitar("Data em que você pretende pagar", "2026-09-10");
    await act(async () => { screen.getByRole("button", { name: "Acrescentar" }).click(); });
    expect(screen.getByText(/precisa ser um número maior que zero/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a lista — uma linha por SAÍDA, nunca por ocorrência", () => {
  it("a recorrente aparece UMA vez, com a contagem e o total do horizonte", () => {
    abrir(mesesCom([declarada("2026-08")], [declarada("2026-09")], [declarada("2026-10")]));
    const itens = screen.getAllByRole("listitem");
    expect(itens).toHaveLength(1);
    expect(itens[0].textContent).toMatch(/Aluguel/);
    expect(itens[0].textContent).toMatch(/Todo mês/);
    expect(itens[0].textContent).toMatch(/3× na tabela/);
  });

  it("⚠ a avulsa diz o DIA e o mês", () => {
    abrir(mesesCom([avulsa()]));
    expect(screen.getByRole("listitem").textContent).toMatch(/dia 10 de setembro de 2026/i);
  });

  it("⚠⚠ a série DETECTADA não entra — ela é do sistema, e o cliente não a criou", () => {
    abrir(mesesCom([declarada("2026-08", { base: { origem: "DETECTADA" } })]));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ remover — só o que ele criou, e só enquanto o contador não decidiu", () => {
  it("a PENDENTE tem botão, e o `tipo` viaja", async () => {
    const remover = jest.spyOn(api, "removerSaidaDoFluxo").mockResolvedValue({ ok: true });
    const { aoMudar } = abrir(mesesCom([avulsa()]));
    await act(async () => {
      within(screen.getByRole("listitem")).getByRole("button", { name: "Remover" }).click();
    });
    // ⚠ Sem o `tipo` o servidor tentaria apagar a AVULSA com o id de uma série — "não encontrada"
    // sobre uma linha que está na frente da pessoa.
    expect(remover).toHaveBeenCalledWith("pc-001", "sa-1", { tipo: "AVULSA" });
    expect(aoMudar).toHaveBeenCalled();
  });

  it("⚠ e a RECORRENTE manda `RECORRENTE` — são duas tabelas", async () => {
    const remover = jest.spyOn(api, "removerSaidaDoFluxo").mockResolvedValue({ ok: true });
    abrir(mesesCom([declarada("2026-08")]));
    await act(async () => {
      within(screen.getByRole("listitem")).getByRole("button", { name: "Remover" }).click();
    });
    expect(remover).toHaveBeenCalledWith("pc-001", "sr-1", { tipo: "RECORRENTE" });
  });

  it("⚠⚠ a CONFERIDA perde o botão e ganha a FRASE — o conserto não é esperar, é falar com o contador", () => {
    abrir(mesesCom([avulsa({ base: { doCliente: true, estadoDaSaida: "CONFIRMADA" } })]));
    const item = screen.getByRole("listitem");
    expect(within(item).queryByRole("button", { name: "Remover" })).toBeNull();
    expect(item.textContent).toMatch(/Conferida pelo seu contador/i);
  });

  it("⚠⚠ a SÉRIE já marcada pelo contador (ATIVA) também perde o botão — achado no navegador", () => {
    // No mock, duas séries DECLARADAS já confirmadas apareciam com "Remover", e o servidor as
    // recusaria com `serie_ja_decidida`. A causa era o servidor não mandar o estado da SÉRIE — só
    // o da avulsa. São dois vocabulários (CONFIRMADA × ATIVA) com um PENDENTE em comum.
    abrir(mesesCom([declarada("2026-08", { base: { origem: "DECLARADA", estadoDaSerie: "ATIVA" } })]));
    const item = screen.getByRole("listitem");
    expect(within(item).queryByRole("button", { name: "Remover" })).toBeNull();
    expect(item.textContent).toMatch(/Conferida pelo seu contador/i);
  });

  it("⚠⚠ a recusa do servidor aparece — o botão não pode só falhar em silêncio", async () => {
    jest.spyOn(api, "removerSaidaDoFluxo").mockRejectedValue({ code: "saida_ja_decidida" });
    abrir(mesesCom([avulsa()]));
    await act(async () => {
      within(screen.getByRole("listitem")).getByRole("button", { name: "Remover" }).click();
    });
    expect(screen.getByText(/já conferiu esta saída/i)).toBeInTheDocument();
  });

  it("⚠ o estado é auditável no DOM, como `data-status` e `data-estado-nota`", () => {
    abrir(mesesCom([avulsa()]));
    expect(screen.getByRole("listitem").getAttribute("data-estado")).toBe("PENDENTE");
  });
});
